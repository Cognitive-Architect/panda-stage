import { useSyncExternalStore } from 'react';
import {
  evaluateLayerMotionAtTime,
  isValidFrameTime,
  PositionProjectServiceError,
  PROJECT_HEIGHT,
  PROJECT_WIDTH,
  recognizePositionChain,
  type Point,
  type PositionChain,
  type PositionProjectOperation,
} from '../../domain';
import type { EditorProjectSnapshot, EditorProjectStore } from './EditorProjectStore';
import {
  editorProjectStore,
} from './EditorProjectStore';
import type { LayerSelectionStore } from './selectionStore';
import { selectionStore } from './selectionStore';
import type { ShotStore } from './shotStore';
import { shotStore } from './shotStore';
import type { PositionStore } from './positionStore';
import { positionStore } from './positionStore';
import {
  timelineUiStore,
  type TimelineUiState,
} from '../features/timeline/timelineUiStore';

type Listener = () => void;

export interface PositionAuthoringTimelineSelection {
  getSnapshot: () => Pick<TimelineUiState, 'currentTimeMs'>;
  subscribe: (listener: Listener) => () => void;
}

export type PositionAuthoringErrorCode =
  | 'project-not-open'
  | 'shot-not-selected'
  | 'shot-not-found'
  | 'layer-not-selected'
  | 'layer-not-found'
  | 'background-target'
  | 'locked-target'
  | 'base-time'
  | 'invalid-time'
  | 'playback-only'
  | 'project-changed'
  | 'shot-changed'
  | 'layer-changed'
  | 'time-changed'
  | 'target-missing'
  | 'invalid-position'
  | 'operation-rejected'
  | 'stale-session'
  | 'commit-failed';

export class PositionAuthoringError extends Error {
  constructor(
    readonly code: PositionAuthoringErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'PositionAuthoringError';
  }
}

export interface PositionAuthoringSnapshot {
  readonly status: 'active';
  readonly sessionId: number;
  /** Changes after a successful commit so pre-commit callbacks cannot reuse it. */
  readonly generation: number;
  readonly projectId: string;
  readonly projectRoot: string;
  readonly shotId: string;
  readonly layerId: string;
  readonly timeMs: number;
  readonly draft: Point;
  /** The formal main Position, before any runtime Shake contribution. */
  readonly mainPosition: Point;
  readonly hasExistingKey: boolean;
}

export interface PositionAuthoringDraftResult {
  readonly ok: true;
  readonly snapshot: PositionAuthoringSnapshot;
}

export interface PositionAuthoringDraftRejected {
  readonly ok: false;
  readonly error: PositionAuthoringError;
}

export type PositionAuthoringDraftUpdateResult =
  | PositionAuthoringDraftResult
  | PositionAuthoringDraftRejected;

export interface PositionAuthoringSessionHandle {
  readonly sessionId: number;
  readonly generation: number;
  getSnapshot(): PositionAuthoringSnapshot | null;
  /** Update only the ephemeral draft; this never touches Project or History. */
  setDraft(position: Point): PositionAuthoringDraftUpdateResult;
  /** Commit the current draft, or an optional final pointer/numeric value. */
  commit(position?: Point): PositionAuthoringCommitResult;
  cancel(): void;
  exit(): void;
}

export interface PositionAuthoringBeginSuccess {
  readonly ok: true;
  readonly session: PositionAuthoringSessionHandle;
  readonly snapshot: PositionAuthoringSnapshot;
}

export interface PositionAuthoringBeginFailure {
  readonly ok: false;
  readonly error: PositionAuthoringError;
}

export type PositionAuthoringBeginResult =
  | PositionAuthoringBeginSuccess
  | PositionAuthoringBeginFailure;

export interface PositionAuthoringCommitSuccess {
  readonly status: 'committed';
  /** A fresh capability for another gesture in the rebased session. */
  readonly session: PositionAuthoringSessionHandle;
  readonly snapshot: PositionAuthoringSnapshot;
}

export interface PositionAuthoringNoOp {
  readonly status: 'no-op';
  readonly snapshot: PositionAuthoringSnapshot;
}

export interface PositionAuthoringCommitFailure {
  readonly status: 'rejected' | 'stale';
  readonly error: PositionAuthoringError;
  readonly snapshot: PositionAuthoringSnapshot | null;
}

export type PositionAuthoringCommitResult =
  | PositionAuthoringCommitSuccess
  | PositionAuthoringNoOp
  | PositionAuthoringCommitFailure;

export interface PositionAuthoringSessionDependencies {
  readonly editorStore: Pick<
    EditorProjectStore,
    'getSnapshot' | 'subscribe'
  >;
  readonly shotSelection: Pick<
    ShotStore,
    'getCurrentShotId' | 'subscribe'
  >;
  readonly layerSelection: Pick<
    LayerSelectionStore,
    'getSelectedLayerId' | 'subscribe'
  >;
  readonly timeline: PositionAuthoringTimelineSelection;
  readonly positionStore: Pick<PositionStore, 'applyOperation'>;
  readonly createEventId?: () => string;
}

interface PositionAuthoringContext {
  readonly snapshot: EditorProjectSnapshot;
  readonly shotId: string;
  readonly layerId: string;
  readonly timeMs: number;
  readonly shot: EditorProjectSnapshot['project']['shots'][number];
  readonly layer: EditorProjectSnapshot['project']['shots'][number]['layers'][number];
  readonly chain: PositionChain;
  readonly mainPosition: Point;
}

interface ActiveSession {
  readonly sessionId: number;
  generation: number;
  baselineSnapshot: EditorProjectSnapshot;
  readonly projectId: string;
  readonly projectRoot: string;
  readonly shotId: string;
  readonly layerId: string;
  readonly timeMs: number;
  draft: Point;
  mainPosition: Point;
  hasExistingKey: boolean;
}

interface CommitContext {
  readonly sessionId: number;
  readonly generation: number;
  editorChangeCount: number;
  contextChanged: boolean;
}

function copyPoint(point: Point): Point {
  return { x: point.x, y: point.y };
}

function pointsEqual(left: Point, right: Point): boolean {
  return left.x === right.x && left.y === right.y;
}

function positionIsFiniteAndInCanvas(point: Point): boolean {
  return (
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    point.x >= 0 &&
    point.x <= PROJECT_WIDTH &&
    point.y >= 0 &&
    point.y <= PROJECT_HEIGHT
  );
}

/**
 * Ephemeral Position-only authoring capability for PK-04.
 *
 * The store keeps no Project copy. It keeps only a reference to the formal
 * EditorProjectStore snapshot that granted the capability plus a Point draft.
 * Any Editor/Shot/Layer/Timeline context change invalidates that capability;
 * the only Project write goes through PositionStore.applyOperation().
 */
export class PositionAuthoringSessionStore {
  private readonly listeners = new Set<Listener>();
  private readonly unsubscribeEditor: () => void;
  private readonly unsubscribeShot: () => void;
  private readonly unsubscribeLayer: () => void;
  private readonly unsubscribeTimeline: () => void;
  private readonly createEventId: () => string;
  private active: ActiveSession | null = null;
  private snapshot: PositionAuthoringSnapshot | null = null;
  private commitContext: CommitContext | null = null;
  private nextSessionId = 0;

  constructor(private readonly dependencies: PositionAuthoringSessionDependencies) {
    this.createEventId =
      dependencies.createEventId ?? (() => crypto.randomUUID());
    this.unsubscribeEditor = dependencies.editorStore.subscribe(
      this.handleEditorChange,
    );
    this.unsubscribeShot = dependencies.shotSelection.subscribe(
      this.handleContextChange,
    );
    this.unsubscribeLayer = dependencies.layerSelection.subscribe(
      this.handleContextChange,
    );
    this.unsubscribeTimeline = dependencies.timeline.subscribe(
      this.handleContextChange,
    );
  }

  /** Cached for useSyncExternalStore; it changes only when emit() runs. */
  readonly getSnapshot = (): PositionAuthoringSnapshot | null =>
    this.snapshot;

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  begin(): PositionAuthoringBeginResult {
    const hadActiveSession = this.active !== null;
    this.clearActive();
    if (hadActiveSession) this.emit();

    const context = this.readContext();
    if (!context.ok) return context;

    const session: ActiveSession = {
      sessionId: ++this.nextSessionId,
      generation: 0,
      baselineSnapshot: context.snapshot,
      projectId: context.snapshot.project.id,
      projectRoot: context.snapshot.projectRoot,
      shotId: context.shotId,
      layerId: context.layerId,
      timeMs: this.dependencies.timeline.getSnapshot().currentTimeMs,
      draft: copyPoint(context.mainPosition),
      mainPosition: copyPoint(context.mainPosition),
      hasExistingKey: context.chain.points.some(
        (point) => point.kind === 'key' && point.timeMs === context.timeMs,
      ),
    };
    this.active = session;
    this.emit();
    const handle = this.createHandle(session.sessionId, session.generation);
    return {
      ok: true,
      session: handle,
      snapshot: this.snapshot!,
    };
  }

  dispose(): void {
    this.unsubscribeEditor();
    this.unsubscribeShot();
    this.unsubscribeLayer();
    this.unsubscribeTimeline();
    this.clearActive();
    this.snapshot = null;
    this.listeners.clear();
  }

  private readonly handleEditorChange = (): void => {
    if (!this.active) return;
    if (this.commitContextMatchesActive()) {
      this.commitContext!.editorChangeCount += 1;
      return;
    }
    this.invalidate();
  };

  private readonly handleContextChange = (): void => {
    if (!this.active) return;
    if (this.commitContextMatchesActive()) {
      this.commitContext!.contextChanged = true;
      return;
    }
    this.invalidate();
  };

  private createHandle(
    sessionId: number,
    generation: number,
  ): PositionAuthoringSessionHandle {
    return {
      sessionId,
      generation,
      getSnapshot: () => this.snapshotForToken(sessionId, generation),
      setDraft: (position) =>
        this.setDraft(sessionId, generation, position),
      commit: (position) => this.commit(sessionId, generation, position),
      cancel: () => this.exit(sessionId, generation),
      exit: () => this.exit(sessionId, generation),
    };
  }

  private setDraft(
    sessionId: number,
    generation: number,
    position: Point,
  ): PositionAuthoringDraftUpdateResult {
    const active = this.activeForToken(sessionId, generation);
    if (!active) {
      return {
        ok: false,
        error: this.staleSessionError(),
      };
    }
    if (pointsEqual(active.draft, position)) {
      return { ok: true, snapshot: this.snapshot! };
    }
    active.draft = copyPoint(position);
    this.emit();
    return { ok: true, snapshot: this.snapshot! };
  }

  private commit(
    sessionId: number,
    generation: number,
    finalPosition?: Point,
  ): PositionAuthoringCommitResult {
    const active = this.activeForToken(sessionId, generation);
    if (!active) return this.staleCommitResult();
    if (finalPosition && !pointsEqual(active.draft, finalPosition)) {
      active.draft = copyPoint(finalPosition);
      this.emit();
    }

    const context = this.readContext(active);
    if (!context.ok) {
      this.invalidate();
      return {
        status: 'stale',
        error: context.error,
        snapshot: null,
      };
    }

    if (!positionIsFiniteAndInCanvas(active.draft)) {
      return {
        status: 'rejected',
        error: new PositionAuthoringError(
          'invalid-position',
          'Position coordinates must remain finite and inside the canvas.',
        ),
        snapshot: this.snapshot,
      };
    }

    if (pointsEqual(active.draft, context.mainPosition)) {
      return {
        status: 'no-op',
        snapshot: this.snapshot!,
      };
    }

    const operation = this.operationFor(
      context.chain,
      context.timeMs,
      active.draft,
    );
    const baseline = context.snapshot;
    this.commitContext = {
      sessionId: active.sessionId,
      generation: active.generation,
      editorChangeCount: 0,
      contextChanged: false,
    };

    let resultProject: unknown;
    try {
      resultProject = this.dependencies.positionStore.applyOperation(
        active.shotId,
        active.layerId,
        operation,
        'Author Position',
      );
    } catch (error) {
      this.commitContext = null;
      const mapped = this.mapCommitError(error);
      if (mapped.code === 'invalid-position') {
        return {
          status: 'rejected',
          error: mapped,
          snapshot: this.snapshot,
        };
      }
      this.invalidate();
      return { status: 'stale', error: mapped, snapshot: null };
    }

    const current = this.dependencies.editorStore.getSnapshot();
    const commitState = this.commitContext;
    this.commitContext = null;
    if (
      !current ||
      !commitState ||
      commitState.sessionId !== active.sessionId ||
      commitState.generation !== active.generation ||
      commitState.editorChangeCount !== 1 ||
      commitState.contextChanged ||
      current.projectRoot !== baseline.projectRoot ||
      current.project.id !== baseline.project.id ||
      current.revision !== baseline.revision + 1 ||
      JSON.stringify(current.project) !== JSON.stringify(resultProject)
    ) {
      this.invalidate();
      return {
        status: 'stale',
        error: new PositionAuthoringError(
          'project-changed',
          'The Project changed while Position authoring was committing.',
        ),
        snapshot: null,
      };
    }

    active.baselineSnapshot = current;
    active.mainPosition = copyPoint(
      evaluateLayerMotionAtTime(
        context.layer,
        current.project.shots.find((shot) => shot.id === active.shotId)!
          .timelineEvents,
        active.timeMs,
      ).mainPosition,
    );
    active.draft = copyPoint(active.mainPosition);
    active.hasExistingKey = true;
    active.generation += 1;
    this.emit();
    const nextSession = this.createHandle(
      active.sessionId,
      active.generation,
    );
    return {
      status: 'committed',
      session: nextSession,
      snapshot: this.snapshot!,
    };
  }

  private operationFor(
    chain: PositionChain,
    timeMs: number,
    position: Point,
  ): PositionProjectOperation {
    if (chain.status === 'none') {
      return {
        type: 'create-first',
        input: {
          timeMs,
          position: copyPoint(position),
          eventId: this.createEventId(),
        },
      };
    }

    const existing = chain.points.find(
      (point) => point.kind === 'key' && point.timeMs === timeMs,
    );
    if (existing) {
      return {
        type: 'update',
        input: { timeMs, position: copyPoint(position) },
      };
    }

    const last = chain.points.at(-1)!;
    if (timeMs > last.timeMs) {
      return {
        type: 'append',
        input: {
          timeMs,
          position: copyPoint(position),
          eventId: this.createEventId(),
        },
      };
    }
    return {
      type: 'insert',
      input: {
        timeMs,
        position: copyPoint(position),
        eventId: this.createEventId(),
      },
    };
  }

  private readContext(
    active?: ActiveSession,
  ):
    | ({ readonly ok: true } & PositionAuthoringContext)
    | { readonly ok: false; readonly error: PositionAuthoringError } {
    const snapshot = this.dependencies.editorStore.getSnapshot();
    if (!snapshot) {
      return this.contextFailure(
        'project-not-open',
        'Open a Project before starting Position authoring.',
      );
    }
    if (active) {
      if (snapshot !== active.baselineSnapshot) {
        return this.contextFailure(
          'project-changed',
          'The Project snapshot changed after Position authoring began.',
        );
      }
      if (
        snapshot.projectRoot !== active.projectRoot ||
        snapshot.project.id !== active.projectId ||
        snapshot.revision !== active.baselineSnapshot.revision
      ) {
        return this.contextFailure(
          'project-changed',
          'The active Position authoring Project is no longer current.',
        );
      }
    }

    const shotId = this.dependencies.shotSelection.getCurrentShotId();
    if (!shotId) {
      return this.contextFailure(
        'shot-not-selected',
        'Select a Shot before starting Position authoring.',
      );
    }
    if (active && shotId !== active.shotId) {
      return this.contextFailure(
        'shot-changed',
        'The active Shot changed while Position authoring was open.',
      );
    }
    const shot = snapshot.project.shots.find(
      (candidate) => candidate.id === shotId,
    );
    if (!shot) {
      return this.contextFailure(
        active ? 'target-missing' : 'shot-not-found',
        `Shot ${shotId} is no longer present in the Project.`,
      );
    }

    const layerId = this.dependencies.layerSelection.getSelectedLayerId();
    if (!layerId) {
      return this.contextFailure(
        'layer-not-selected',
        'Select a Layer before starting Position authoring.',
      );
    }
    if (active && layerId !== active.layerId) {
      return this.contextFailure(
        'layer-changed',
        'The selected Layer changed while Position authoring was open.',
      );
    }
    const layer = shot.layers.find((candidate) => candidate.id === layerId);
    if (!layer) {
      return this.contextFailure(
        active ? 'target-missing' : 'layer-not-found',
        `Layer ${layerId} is no longer present in the Shot.`,
      );
    }
    if (shot.backgroundLayerId === layer.id) {
      return this.contextFailure(
        'background-target',
        'Position authoring does not target the Shot background.',
      );
    }
    if (layer.locked) {
      return this.contextFailure(
        'locked-target',
        'Unlock the selected Layer before starting Position authoring.',
      );
    }

    const timeMs = this.dependencies.timeline.getSnapshot().currentTimeMs;
    if (active && timeMs !== active.timeMs) {
      return this.contextFailure(
        'time-changed',
        'The Timeline time changed while Position authoring was open.',
      );
    }
    if (timeMs === 0) {
      return this.contextFailure(
        'base-time',
        'The 0:00 Base uses the existing Base editing path.',
      );
    }
    if (
      !Number.isInteger(timeMs) ||
      !isValidFrameTime(timeMs) ||
      timeMs < 0 ||
      timeMs > shot.durationMs
    ) {
      return this.contextFailure(
        'invalid-time',
        'Position authoring requires an already legal non-zero Timeline frame.',
      );
    }

    const recognition = recognizePositionChain({ shot, layer });
    if (recognition.status === 'playback-only') {
      return this.contextFailure(
        'playback-only',
        `This Position chain is playback-only: ${recognition.reason.message}`,
        recognition,
      );
    }
    const mainPosition = evaluateLayerMotionAtTime(
      layer,
      shot.timelineEvents,
      timeMs,
    ).mainPosition;
    return {
      ok: true,
      snapshot,
      shotId,
      layerId,
      shot,
      layer,
      chain: recognition.chain,
      timeMs,
      mainPosition,
    };
  }

  private contextFailure(
    code: PositionAuthoringErrorCode,
    message: string,
    cause?: unknown,
  ): { readonly ok: false; readonly error: PositionAuthoringError } {
    return {
      ok: false,
      error: new PositionAuthoringError(code, message, cause),
    };
  }

  private mapCommitError(error: unknown): PositionAuthoringError {
    if (error instanceof PositionAuthoringError) return error;
    if (error instanceof PositionProjectServiceError) {
      if (error.code === 'INVALID_POSITION') {
        return new PositionAuthoringError(
          'invalid-position',
          error.message,
          error,
        );
      }
      if (error.code === 'POSITION_CHAIN_PLAYBACK_ONLY') {
        return new PositionAuthoringError(
          'playback-only',
          error.message,
          error,
        );
      }
      return new PositionAuthoringError(
        'operation-rejected',
        error.message,
        error,
      );
    }
    return new PositionAuthoringError(
      'commit-failed',
      error instanceof Error
        ? error.message
        : 'Position authoring could not be committed.',
      error,
    );
  }

  private exit(sessionId: number, generation: number): void {
    if (!this.activeForToken(sessionId, generation)) return;
    this.invalidate();
  }

  private activeForToken(
    sessionId: number,
    generation: number,
  ): ActiveSession | null {
    return this.active?.sessionId === sessionId &&
      this.active.generation === generation
      ? this.active
      : null;
  }

  private commitContextMatchesActive(): boolean {
    return (
      this.active !== null &&
      this.commitContext !== null &&
      this.commitContext.sessionId === this.active.sessionId &&
      this.commitContext.generation === this.active.generation
    );
  }

  private snapshotForToken(
    sessionId: number,
    generation: number,
  ): PositionAuthoringSnapshot | null {
    return this.activeForToken(sessionId, generation) ? this.snapshot : null;
  }

  private snapshotFor(
    active: ActiveSession | null,
  ): PositionAuthoringSnapshot | null {
    if (!active) return null;
    return {
      status: 'active',
      sessionId: active.sessionId,
      generation: active.generation,
      projectId: active.projectId,
      projectRoot: active.projectRoot,
      shotId: active.shotId,
      layerId: active.layerId,
      timeMs: active.timeMs,
      draft: copyPoint(active.draft),
      mainPosition: copyPoint(active.mainPosition),
      hasExistingKey: active.hasExistingKey,
    };
  }

  private staleSessionError(): PositionAuthoringError {
    return new PositionAuthoringError(
      'stale-session',
      'This Position authoring capability is no longer current.',
    );
  }

  private staleCommitResult(): PositionAuthoringCommitFailure {
    return {
      status: 'stale',
      error: this.staleSessionError(),
      snapshot: null,
    };
  }

  private invalidate(): void {
    if (!this.active) return;
    this.clearActive();
    this.emit();
  }

  private clearActive(): void {
    this.active = null;
    this.commitContext = null;
  }

  private emit(): void {
    this.snapshot = this.snapshotFor(this.active);
    for (const listener of this.listeners) listener();
  }
}

export const positionAuthoringSessionStore =
  new PositionAuthoringSessionStore({
    editorStore: editorProjectStore,
    shotSelection: shotStore,
    layerSelection: selectionStore,
    timeline: timelineUiStore,
    positionStore,
  });

export function usePositionAuthoringSession(): PositionAuthoringSnapshot | null {
  return useSyncExternalStore(
    positionAuthoringSessionStore.subscribe,
    positionAuthoringSessionStore.getSnapshot,
  );
}
