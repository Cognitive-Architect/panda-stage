import { useSyncExternalStore } from 'react';
import {
  applyScopedLayerDepthEdit,
  canEditLayerDepth,
  LAYER_DEPTH_MAX,
  LAYER_DEPTH_MIN,
  type Project,
} from '../../domain';
import type { EditorProjectStore } from './EditorProjectStore';
import { editorProjectStore } from './EditorProjectStore';
import type { LayerSelectionStore } from './selectionStore';
import { selectionStore } from './selectionStore';
import type { ShotStore } from './shotStore';
import { shotStore } from './shotStore';
import {
  timelineUiStore,
  type TimelineUiState,
} from '../features/timeline/timelineUiStore';

type Listener = () => void;

export interface DepthPreviewSnapshot {
  readonly sessionId: number;
  readonly projectInstanceId: number;
  readonly projectId: string;
  readonly projectRoot: string;
  readonly revision: number;
  readonly shotId: string;
  readonly layerId: string;
  readonly timeMs: number;
  readonly depth: number;
  readonly previewProject: Project;
}

export interface DepthPreviewHandle {
  readonly sessionId: number;
  setDepth(depth: number): boolean;
  /** Commit through the caller's formal owner, then clear the visual override. */
  finish(commit: (final: DepthPreviewSnapshot) => void): boolean;
  cancel(): void;
}

export interface DepthPreviewDependencies {
  editorStore: Pick<
    EditorProjectStore,
    'getSnapshot' | 'getProjectInstanceId' | 'subscribe'
  >;
  shotSelection: Pick<ShotStore, 'getCurrentShotId' | 'subscribe'>;
  layerSelection: Pick<LayerSelectionStore, 'getSelectedLayerId' | 'subscribe'>;
  timeline: {
    getSnapshot: () => Pick<TimelineUiState, 'currentTimeMs'>;
    subscribe: (listener: Listener) => () => void;
  };
}

/**
 * Ephemeral live-preview store for parallax depth slider drags.
 * Never mutates EditorProjectStore or HistoryStore while dragging; cancels
 * automatically when project revision, shot, layer, playhead, or lock changes.
 */
export class DepthPreviewStore {
  private snapshot: DepthPreviewSnapshot | null = null;
  private nextSessionId = 0;
  private readonly listeners = new Set<Listener>();
  private readonly unsubscribers: (() => void)[];

  constructor(private readonly dependencies: DepthPreviewDependencies) {
    this.unsubscribers = [
      dependencies.editorStore.subscribe(() => this.reconcile()),
      dependencies.shotSelection.subscribe(() => this.reconcile()),
      dependencies.layerSelection.subscribe(() => this.reconcile()),
      dependencies.timeline.subscribe(() => this.reconcile()),
    ];
  }

  readonly getSnapshot = (): DepthPreviewSnapshot | null => this.snapshot;

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  dispose(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.listeners.clear();
    this.snapshot = null;
  }

  begin(expectedLayerId: string, initialDepth: number): DepthPreviewHandle | null {
    this.reconcile();
    const context = this.currentContext();
    if (!context || context.layerId !== expectedLayerId) return null;
    if (this.snapshot) this.clear();
    const clamped = Number.isFinite(initialDepth)
      ? Math.max(LAYER_DEPTH_MIN, Math.min(LAYER_DEPTH_MAX, initialDepth))
      : 0;
    const sessionId = ++this.nextSessionId;
    const { baseProject, ...identity } = context;
    this.snapshot = {
      ...identity,
      sessionId,
      depth: clamped,
      previewProject: baseProject,
    };
    this.emit();
    return {
      sessionId,
      setDepth: (depth) => this.setDepth(sessionId, depth),
      finish: (commit) => this.finish(sessionId, commit),
      cancel: () => this.cancel(sessionId),
    };
  }

  private currentContext(): (
    Omit<DepthPreviewSnapshot, 'sessionId' | 'depth' | 'previewProject'> & {
      baseProject: Project;
    }
  ) | null {
    const { editorStore, shotSelection, layerSelection, timeline } =
      this.dependencies;
    const snapshot = editorStore.getSnapshot();
    const projectInstanceId = editorStore.getProjectInstanceId();
    const shotId = shotSelection.getCurrentShotId();
    const layerId = layerSelection.getSelectedLayerId();
    if (!snapshot || projectInstanceId === null || !shotId || !layerId) {
      return null;
    }
    const shot = snapshot.project.shots.find((candidate) => candidate.id === shotId);
    const layer = shot?.layers.find((candidate) => candidate.id === layerId);
    if (!shot || !layer || !canEditLayerDepth(layer, shot)) return null;
    return {
      projectInstanceId,
      projectId: snapshot.project.id,
      projectRoot: snapshot.projectRoot,
      revision: snapshot.revision,
      shotId,
      layerId,
      timeMs: timeline.getSnapshot().currentTimeMs,
      baseProject: snapshot.project,
    };
  }

  private valid(sessionId: number): boolean {
    const active = this.snapshot;
    const context = this.currentContext();
    return Boolean(
      active &&
      active.sessionId === sessionId &&
      context &&
      active.projectInstanceId === context.projectInstanceId &&
      active.projectId === context.projectId &&
      active.projectRoot === context.projectRoot &&
      active.revision === context.revision &&
      active.shotId === context.shotId &&
      active.layerId === context.layerId &&
      active.timeMs === context.timeMs,
    );
  }

  private setDepth(sessionId: number, depth: number): boolean {
    if (!this.valid(sessionId)) {
      this.reconcile();
      return false;
    }
    if (!Number.isFinite(depth) || depth < LAYER_DEPTH_MIN || depth > LAYER_DEPTH_MAX) {
      return false;
    }
    const context = this.currentContext();
    if (!context) {
      this.reconcile();
      return false;
    }
    const normalized = Object.is(depth, -0) ? 0 : depth;
    const previewProject = applyScopedLayerDepthEdit(
      context.baseProject,
      context.shotId,
      context.layerId,
      context.timeMs,
      normalized,
    );
    this.snapshot = {
      ...this.snapshot!,
      depth: normalized,
      previewProject,
    };
    this.emit();
    return true;
  }

  private finish(
    sessionId: number,
    commit: (final: DepthPreviewSnapshot) => void,
  ): boolean {
    if (!this.valid(sessionId)) {
      this.reconcile();
      return false;
    }
    const result = this.snapshot!;
    try {
      commit(result);
    } finally {
      this.cancel(sessionId);
    }
    return true;
  }

  private cancel(sessionId: number): void {
    if (this.snapshot?.sessionId === sessionId) this.clear();
  }

  private reconcile(): void {
    if (this.snapshot && !this.valid(this.snapshot.sessionId)) this.clear();
  }

  private clear(): void {
    if (!this.snapshot) return;
    this.snapshot = null;
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export const depthPreviewStore = new DepthPreviewStore({
  editorStore: editorProjectStore,
  shotSelection: shotStore,
  layerSelection: selectionStore,
  timeline: timelineUiStore,
});

export function useDepthPreview(): DepthPreviewSnapshot | null {
  return useSyncExternalStore(
    depthPreviewStore.subscribe,
    depthPreviewStore.getSnapshot,
  );
}
