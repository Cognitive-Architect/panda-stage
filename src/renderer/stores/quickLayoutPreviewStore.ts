import { useSyncExternalStore } from 'react';
import type { EditorProjectStore } from './EditorProjectStore';
import { editorProjectStore } from './EditorProjectStore';
import type { ShotStore } from './shotStore';
import { shotStore } from './shotStore';

type Listener = () => void;

export interface QuickLayoutPreviewPoint {
  readonly x: number;
  readonly y: number;
}

/** Identity of the Project/Shot/revision the candidate positions belong to. */
export interface QuickLayoutPreviewContext {
  readonly projectInstanceId: number;
  readonly projectId: string;
  readonly projectRoot: string;
  readonly revision: number;
  readonly shotId: string;
}

export interface QuickLayoutPreviewSnapshot extends QuickLayoutPreviewContext {
  readonly leftLayerId: string;
  readonly rightLayerId: string;
  readonly left: QuickLayoutPreviewPoint;
  readonly right: QuickLayoutPreviewPoint;
}

export interface QuickLayoutPreviewInput {
  readonly leftLayerId: string;
  readonly rightLayerId: string;
  readonly left: QuickLayoutPreviewPoint;
  readonly right: QuickLayoutPreviewPoint;
}

export interface QuickLayoutPreviewDependencies {
  editorStore: Pick<
    EditorProjectStore,
    'getSnapshot' | 'getProjectInstanceId' | 'subscribe'
  >;
  shotSelection: Pick<ShotStore, 'getCurrentShotId' | 'subscribe'>;
}

export function matchesQuickLayoutPreview(
  preview: QuickLayoutPreviewSnapshot,
  context: QuickLayoutPreviewContext,
): boolean {
  return (
    preview.projectInstanceId === context.projectInstanceId &&
    preview.projectId === context.projectId &&
    preview.projectRoot === context.projectRoot &&
    preview.revision === context.revision &&
    preview.shotId === context.shotId
  );
}

/**
 * One ephemeral candidate stance for two Character Layers. The formal Project
 * stays the only saved truth: this store never writes a revision, never saves,
 * and never creates a History command.
 */
export class QuickLayoutPreviewStore {
  private snapshot: QuickLayoutPreviewSnapshot | null = null;
  private readonly listeners = new Set<Listener>();
  private readonly unsubscribers: (() => void)[];

  constructor(private readonly dependencies: QuickLayoutPreviewDependencies) {
    this.unsubscribers = [
      dependencies.editorStore.subscribe(() => this.reconcile()),
      dependencies.shotSelection.subscribe(() => this.reconcile()),
    ];
  }

  readonly getSnapshot = (): QuickLayoutPreviewSnapshot | null =>
    this.snapshot;

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  dispose(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.listeners.clear();
    this.snapshot = null;
  }

  /** Publish one candidate stance; returns false when no Project/Shot is open. */
  show(input: QuickLayoutPreviewInput): boolean {
    const context = this.currentContext();
    if (!context) {
      this.clear();
      return false;
    }
    if (
      !Number.isFinite(input.left.x) ||
      !Number.isFinite(input.left.y) ||
      !Number.isFinite(input.right.x) ||
      !Number.isFinite(input.right.y)
    ) {
      return false;
    }
    this.snapshot = { ...context, ...input };
    this.emit();
    return true;
  }

  clear(): void {
    if (!this.snapshot) return;
    this.snapshot = null;
    this.emit();
  }

  private currentContext(): QuickLayoutPreviewContext | null {
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
    if (!context || !matchesQuickLayoutPreview(this.snapshot, context)) {
      this.clear();
    }
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export const quickLayoutPreviewStore = new QuickLayoutPreviewStore({
  editorStore: editorProjectStore,
  shotSelection: shotStore,
});

export function useQuickLayoutPreview(): QuickLayoutPreviewSnapshot | null {
  return useSyncExternalStore(
    quickLayoutPreviewStore.subscribe,
    quickLayoutPreviewStore.getSnapshot,
  );
}
