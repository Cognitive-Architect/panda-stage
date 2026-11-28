import { useSyncExternalStore } from 'react';
import type { Project } from '../../domain';
import {
  editorProjectStore,
  type EditorProjectStore,
} from './EditorProjectStore';
import { shotStore, type ShotStore } from './shotStore';
import {
  timelineUiStore,
  type TimelineUiState,
} from '../features/timeline/timelineUiStore';

type Listener = () => void;

export interface LayoutPreviewSnapshot {
  readonly projectInstanceId: number;
  readonly projectId: string;
  readonly projectRoot: string;
  readonly revision: number;
  readonly shotId: string;
  readonly timeMs: number;
  readonly label: string;
  readonly previewProject: Project;
}

export interface LayoutPreviewDependencies {
  readonly editorStore: Pick<
    EditorProjectStore,
    'getSnapshot' | 'getProjectInstanceId' | 'subscribe'
  >;
  readonly shotSelection: Pick<ShotStore, 'getCurrentShotId' | 'subscribe'>;
  readonly timeline: {
    getSnapshot: () => Pick<TimelineUiState, 'currentTimeMs'>;
    subscribe: (listener: Listener) => () => void;
  };
}

/**
 * Ephemeral live-preview store for batch layout operations (WF-02).
 * Never mutates EditorProjectStore or HistoryStore while previewing; clears
 * automatically when project, revision, shot, or playhead time changes.
 */
export class LayoutPreviewStore {
  private snapshot: LayoutPreviewSnapshot | null = null;
  private readonly listeners = new Set<Listener>();
  private readonly unsubscribers: (() => void)[];

  constructor(private readonly dependencies: LayoutPreviewDependencies) {
    this.unsubscribers = [
      dependencies.editorStore.subscribe(() => this.reconcile()),
      dependencies.shotSelection.subscribe(() => this.reconcile()),
      dependencies.timeline.subscribe(() => this.reconcile()),
    ];
  }

  readonly getSnapshot = (): LayoutPreviewSnapshot | null => this.snapshot;

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  setPreview(
    shotId: string,
    timeMs: number,
    label: string,
    previewProject: Project,
  ): boolean {
    const editor = this.dependencies.editorStore.getSnapshot();
    const projectInstanceId = this.dependencies.editorStore.getProjectInstanceId();
    const currentShotId = this.dependencies.shotSelection.getCurrentShotId();
    const currentTimeMs = this.dependencies.timeline.getSnapshot().currentTimeMs;

    if (
      !editor ||
      projectInstanceId === null ||
      currentShotId !== shotId ||
      currentTimeMs !== timeMs
    ) {
      this.clear();
      return false;
    }

    this.snapshot = {
      projectInstanceId,
      projectId: editor.project.id,
      projectRoot: editor.projectRoot,
      revision: editor.revision,
      shotId,
      timeMs,
      label,
      previewProject,
    };
    this.emit();
    return true;
  }

  clear(): void {
    if (!this.snapshot) return;
    this.snapshot = null;
    this.emit();
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.listeners.clear();
    this.snapshot = null;
  }

  private reconcile(): void {
    if (!this.snapshot) return;
    const editor = this.dependencies.editorStore.getSnapshot();
    const projectInstanceId = this.dependencies.editorStore.getProjectInstanceId();
    const currentShotId = this.dependencies.shotSelection.getCurrentShotId();
    const currentTimeMs = this.dependencies.timeline.getSnapshot().currentTimeMs;

    if (
      !editor ||
      projectInstanceId !== this.snapshot.projectInstanceId ||
      editor.project.id !== this.snapshot.projectId ||
      editor.projectRoot !== this.snapshot.projectRoot ||
      editor.revision !== this.snapshot.revision ||
      currentShotId !== this.snapshot.shotId ||
      currentTimeMs !== this.snapshot.timeMs
    ) {
      this.clear();
    }
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export const layoutPreviewStore = new LayoutPreviewStore({
  editorStore: editorProjectStore,
  shotSelection: shotStore,
  timeline: timelineUiStore,
});

export function useLayoutPreview(): LayoutPreviewSnapshot | null {
  return useSyncExternalStore(
    layoutPreviewStore.subscribe,
    layoutPreviewStore.getSnapshot,
  );
}
