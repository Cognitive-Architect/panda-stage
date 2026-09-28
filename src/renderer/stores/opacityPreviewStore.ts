import { useSyncExternalStore } from 'react';
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

export interface OpacityPreviewSnapshot {
  readonly sessionId: number;
  readonly projectInstanceId: number;
  readonly projectId: string;
  readonly projectRoot: string;
  readonly revision: number;
  readonly shotId: string;
  readonly layerId: string;
  readonly opacity: number;
}

export interface OpacityPreviewHandle {
  readonly sessionId: number;
  setOpacity(opacity: number): boolean;
  /** Commit through the caller's formal owner, then clear the visual override. */
  finish(commit: (final: OpacityPreviewSnapshot) => void): boolean;
  cancel(): void;
}

export interface OpacityPreviewDependencies {
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

/** One ephemeral rendering override; the formal Layer remains the only saved truth. */
export class OpacityPreviewStore {
  private snapshot: OpacityPreviewSnapshot | null = null;
  private nextSessionId = 0;
  private readonly listeners = new Set<Listener>();
  private readonly unsubscribers: (() => void)[];

  constructor(private readonly dependencies: OpacityPreviewDependencies) {
    this.unsubscribers = [
      dependencies.editorStore.subscribe(() => this.reconcile()),
      dependencies.shotSelection.subscribe(() => this.reconcile()),
      dependencies.layerSelection.subscribe(() => this.reconcile()),
      dependencies.timeline.subscribe(() => this.reconcile()),
    ];
  }

  readonly getSnapshot = (): OpacityPreviewSnapshot | null => this.snapshot;

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  dispose(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.listeners.clear();
    this.snapshot = null;
  }

  begin(expectedLayerId: string): OpacityPreviewHandle | null {
    this.reconcile();
    const context = this.currentContext();
    if (!context || context.layerId !== expectedLayerId) return null;
    if (this.snapshot) this.clear();
    const sessionId = ++this.nextSessionId;
    const { formalOpacity, ...identity } = context;
    this.snapshot = { ...identity, sessionId, opacity: formalOpacity };
    this.emit();
    return {
      sessionId,
      setOpacity: (opacity) => this.setOpacity(sessionId, opacity),
      finish: (commit) => this.finish(sessionId, commit),
      cancel: () => this.cancel(sessionId),
    };
  }

  private currentContext(): (
    Omit<OpacityPreviewSnapshot, 'sessionId' | 'opacity'> & {
      formalOpacity: number;
    }
  ) | null {
    const { editorStore, shotSelection, layerSelection, timeline } =
      this.dependencies;
    const snapshot = editorStore.getSnapshot();
    const projectInstanceId = editorStore.getProjectInstanceId();
    const shotId = shotSelection.getCurrentShotId();
    const layerId = layerSelection.getSelectedLayerId();
    if (
      !snapshot ||
      projectInstanceId === null ||
      !shotId ||
      !layerId ||
      timeline.getSnapshot().currentTimeMs !== 0
    ) {
      return null;
    }
    const layer = snapshot.project.shots
      .find((shot) => shot.id === shotId)?.layers
      .find((candidate) => candidate.id === layerId);
    if (!layer || layer.locked) return null;
    return {
      projectInstanceId,
      projectId: snapshot.project.id,
      projectRoot: snapshot.projectRoot,
      revision: snapshot.revision,
      shotId,
      layerId,
      formalOpacity: layer.opacity,
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
      active.layerId === context.layerId,
    );
  }

  private setOpacity(sessionId: number, opacity: number): boolean {
    if (!this.valid(sessionId)) {
      this.reconcile();
      return false;
    }
    if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) return false;
    this.snapshot = { ...this.snapshot!, opacity };
    this.emit();
    return true;
  }

  private finish(
    sessionId: number,
    commit: (final: OpacityPreviewSnapshot) => void,
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

export const opacityPreviewStore = new OpacityPreviewStore({
  editorStore: editorProjectStore,
  shotSelection: shotStore,
  layerSelection: selectionStore,
  timeline: timelineUiStore,
});

export function useOpacityPreview(): OpacityPreviewSnapshot | null {
  return useSyncExternalStore(
    opacityPreviewStore.subscribe,
    opacityPreviewStore.getSnapshot,
  );
}
