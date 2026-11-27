import { useSyncExternalStore } from 'react';
import type { Project } from '../../domain';
import {
  editorProjectStore,
  type EditorProjectStore,
} from './EditorProjectStore';

type Listener = () => void;

export interface ScenePreviewSnapshot {
  readonly projectInstanceId: number;
  readonly projectId: string;
  readonly projectRoot: string;
  readonly revision: number;
  readonly previewProject: Project;
  readonly previewShotId: string;
  readonly previewShotName: string;
  readonly shotIndex: number;
  readonly shotCount: number;
}

export interface ScenePreviewDependencies {
  readonly editorStore: Pick<
    EditorProjectStore,
    'getSnapshot' | 'getProjectInstanceId' | 'subscribe'
  >;
}

/**
 * Ephemeral read-only preview store for WF-03 automatic scene creation.
 * Never mutates EditorProjectStore or HistoryStore while previewing; clears
 * automatically whenever the open project or revision changes.
 */
export class ScenePreviewStore {
  private snapshot: ScenePreviewSnapshot | null = null;
  private readonly listeners = new Set<Listener>();
  private readonly unsubscribeEditor: () => void;

  constructor(private readonly dependencies: ScenePreviewDependencies) {
    this.unsubscribeEditor = dependencies.editorStore.subscribe(() =>
      this.reconcile(),
    );
  }

  readonly getSnapshot = (): ScenePreviewSnapshot | null => this.snapshot;

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  setPreview(input: {
    readonly previewProject: Project;
    readonly previewShotId: string;
    readonly previewShotName: string;
    readonly shotIndex: number;
    readonly shotCount: number;
  }): boolean {
    const editor = this.dependencies.editorStore.getSnapshot();
    const projectInstanceId =
      this.dependencies.editorStore.getProjectInstanceId();
    if (!editor || projectInstanceId === null) {
      this.clear();
      return false;
    }
    const shotExists = input.previewProject.shots.some(
      (shot) => shot.id === input.previewShotId,
    );
    if (!shotExists) {
      this.clear();
      return false;
    }
    this.snapshot = {
      projectInstanceId,
      projectId: editor.project.id,
      projectRoot: editor.projectRoot,
      revision: editor.revision,
      previewProject: input.previewProject,
      previewShotId: input.previewShotId,
      previewShotName: input.previewShotName,
      shotIndex: input.shotIndex,
      shotCount: input.shotCount,
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
    this.unsubscribeEditor();
    this.listeners.clear();
    this.snapshot = null;
  }

  private reconcile(): void {
    if (!this.snapshot) return;
    const editor = this.dependencies.editorStore.getSnapshot();
    const projectInstanceId =
      this.dependencies.editorStore.getProjectInstanceId();
    if (
      !editor ||
      projectInstanceId === null ||
      this.snapshot.projectInstanceId !== projectInstanceId ||
      this.snapshot.projectId !== editor.project.id ||
      this.snapshot.projectRoot !== editor.projectRoot ||
      this.snapshot.revision !== editor.revision
    ) {
      this.clear();
    }
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const scenePreviewStore = new ScenePreviewStore({
  editorStore: editorProjectStore,
});

export function useScenePreview(): ScenePreviewSnapshot | null {
  return useSyncExternalStore(
    scenePreviewStore.subscribe,
    scenePreviewStore.getSnapshot,
    scenePreviewStore.getSnapshot,
  );
}
