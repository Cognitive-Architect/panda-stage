import { useSyncExternalStore } from 'react';
import type { EditorProjectStore } from './EditorProjectStore';
import { editorProjectStore } from './EditorProjectStore';
import type { ShotStore } from './shotStore';
import { shotStore } from './shotStore';

type Listener = () => void;

/**
 * One Layer's runtime-only transform candidate. Position is always present;
 * scale only exists for actions that resize, such as equal height.
 */
export interface LayerLayoutPreviewTransform {
  readonly x: number;
  readonly y: number;
  readonly scaleX?: number;
  readonly scaleY?: number;
}

/** Identity of the Project/Shot/revision the candidates belong to. */
export interface LayerLayoutPreviewContext {
  readonly projectInstanceId: number;
  readonly projectId: string;
  readonly projectRoot: string;
  readonly revision: number;
  readonly shotId: string;
}

export interface LayerLayoutPreviewSnapshot extends LayerLayoutPreviewContext {
  readonly transforms: ReadonlyMap<string, LayerLayoutPreviewTransform>;
}

export interface LayerLayoutPreviewDependencies {
  editorStore: Pick<
    EditorProjectStore,
    'getSnapshot' | 'getProjectInstanceId' | 'subscribe'
  >;
  shotSelection: Pick<ShotStore, 'getCurrentShotId' | 'subscribe'>;
}

export function matchesLayerLayoutPreview(
  preview: LayerLayoutPreviewSnapshot,
  context: LayerLayoutPreviewContext,
): boolean {
  return (
    preview.projectInstanceId === context.projectInstanceId &&
    preview.projectId === context.projectId &&
    preview.projectRoot === context.projectRoot &&
    preview.revision === context.revision &&
    preview.shotId === context.shotId
  );
}

function finiteTransform(transform: LayerLayoutPreviewTransform): boolean {
  const scaleX = transform.scaleX;
  const scaleY = transform.scaleY;
  return (
    Number.isFinite(transform.x) &&
    Number.isFinite(transform.y) &&
    (scaleX === undefined || (Number.isFinite(scaleX) && scaleX > 0)) &&
    (scaleY === undefined || (Number.isFinite(scaleY) && scaleY > 0))
  );
}

/**
 * Runtime-only candidates for one align/distribute action over any number of
 * Layers. The formal Project stays the only saved truth: this store never
 * writes a revision, never saves, and never creates a History command.
 */
export class LayerLayoutPreviewStore {
  private snapshot: LayerLayoutPreviewSnapshot | null = null;
  private readonly listeners = new Set<Listener>();
  private readonly unsubscribers: (() => void)[];

  constructor(private readonly dependencies: LayerLayoutPreviewDependencies) {
    this.unsubscribers = [
      dependencies.editorStore.subscribe(() => this.reconcile()),
      dependencies.shotSelection.subscribe(() => this.reconcile()),
    ];
  }

  readonly getSnapshot = (): LayerLayoutPreviewSnapshot | null => this.snapshot;

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  dispose(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.listeners.clear();
    this.snapshot = null;
  }

  /** Publish one candidate batch; returns false when it cannot be shown. */
  show(transforms: ReadonlyMap<string, LayerLayoutPreviewTransform>): boolean {
    const context = this.currentContext();
    if (!context) {
      this.clear();
      return false;
    }
    if (transforms.size === 0) {
      this.clear();
      return false;
    }
    for (const transform of transforms.values()) {
      if (!finiteTransform(transform)) return false;
    }
    this.snapshot = { ...context, transforms };
    this.emit();
    return true;
  }

  clear(): void {
    if (!this.snapshot) return;
    this.snapshot = null;
    this.emit();
  }

  private currentContext(): LayerLayoutPreviewContext | null {
    const { editorStore, shotSelection } = this.dependencies;
    const snapshot = editorStore.getSnapshot();
    const projectInstanceId = editorStore.getProjectInstanceId();
    const shotId = shotSelection.getCurrentShotId();
    if (!snapshot || projectInstanceId === null || !shotId) return null;
    if (!snapshot.project.shots.some((shot) => shot.id === shotId)) {
      return null;
    }
    return {
      projectInstanceId,
      projectId: snapshot.project.id,
      projectRoot: snapshot.projectRoot,
      revision: snapshot.revision,
      shotId,
    };
  }

  private reconcile(): void {
    if (!this.snapshot) return;
    const context = this.currentContext();
    if (!context || !matchesLayerLayoutPreview(this.snapshot, context)) {
      this.clear();
    }
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export const layerLayoutPreviewStore = new LayerLayoutPreviewStore({
  editorStore: editorProjectStore,
  shotSelection: shotStore,
});

export function useLayerLayoutPreview(): LayerLayoutPreviewSnapshot | null {
  return useSyncExternalStore(
    layerLayoutPreviewStore.subscribe,
    layerLayoutPreviewStore.getSnapshot,
  );
}
