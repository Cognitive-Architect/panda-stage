import {
  ProjectSchema,
  scanAssetReferences,
  type Asset,
  type Project,
} from '../../domain';
import type { ExecuteHistoryOptions } from '../../history/HistoryCommand';
import { HistoryStore } from '../../history/HistoryStore';
import { ProjectCommand } from '../../history/commands/ProjectCommand';

export interface EditorProjectSnapshot {
  projectRoot: string;
  project: Project;
  dirty: boolean;
  revision: number;
}

export type SaveAcknowledgement = 'current' | 'stale';

type Listener = () => void;

export class EditorProjectStore {
  private snapshot: EditorProjectSnapshot | null = null;
  private savedProjectJson: string | null = null;
  private readonly listeners = new Set<Listener>();

  constructor(readonly history = new HistoryStore()) {}

  readonly getSnapshot = (): EditorProjectSnapshot | null => this.snapshot;

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  open(projectRoot: string, rawProject: Project): void {
    this.history.clear();
    const project = ProjectSchema.parse(rawProject);
    this.savedProjectJson = JSON.stringify(project);
    this.snapshot = {
      projectRoot,
      project,
      dirty: false,
      revision: 0,
    };
    this.emit();
  }

  updateProject(
    rawProject: Project,
    label = 'Edit project',
    options: ExecuteHistoryOptions = {},
  ): void {
    const current = this.requireSnapshot();
    const project = ProjectSchema.parse(rawProject);
    this.assertSameProject(current.project, project);
    if (JSON.stringify(project) === JSON.stringify(current.project)) return;
    this.history.execute(
      new ProjectCommand(
        label,
        current.project,
        project,
        (next) => this.applyHistoryProject(next),
      ),
      options,
    );
  }

  restore(rawProject: Project): void {
    const current = this.requireSnapshot();
    const project = ProjectSchema.parse(rawProject);
    this.assertSameProject(current.project, project);
    this.history.clear();
    this.snapshot = {
      ...current,
      project,
      dirty: true,
      revision: current.revision + 1,
    };
    this.emit();
  }

  undo(): boolean {
    return this.history.undo();
  }

  redo(): boolean {
    return this.history.redo();
  }

  applyAssetImport(
    rawSavedProject: Project,
    importedAssets: readonly Asset[],
    baseRevision: number,
    savedRevision: number,
  ): SaveAcknowledgement {
    const current = this.requireSnapshot();
    const savedProject = ProjectSchema.parse(rawSavedProject);
    this.assertSameProject(current.project, savedProject);
    if (
      !Number.isInteger(baseRevision) ||
      baseRevision < 0 ||
      savedRevision !== baseRevision + 1
    ) {
      throw new Error(
        `Invalid asset import revisions: base=${baseRevision}, saved=${savedRevision}.`,
      );
    }
    if (current.revision < baseRevision) {
      throw new Error(
        `Asset import base revision ${baseRevision} is ahead of current editor revision ${current.revision}.`,
      );
    }
    this.history.clear();
    if (current.revision === baseRevision) {
      this.savedProjectJson = JSON.stringify(savedProject);
      this.snapshot = {
        ...current,
        project: savedProject,
        dirty: false,
        revision: savedRevision,
      };
      this.emit();
      return 'current';
    }

    const existingIds = new Set(
      current.project.assets.map((asset) => asset.id),
    );
    const project = ProjectSchema.parse({
      ...current.project,
      assets: [
        ...current.project.assets,
        ...importedAssets.filter((asset) => !existingIds.has(asset.id)),
      ],
    });
    this.snapshot = {
      ...current,
      project,
      dirty: true,
      revision: current.revision + 1,
    };
    this.emit();
    return 'stale';
  }

  applyAssetMetadata(
    rawSavedProject: Project,
    rawRefreshedAsset: Asset,
    baseRevision: number,
    savedRevision: number,
  ): SaveAcknowledgement {
    const current = this.requireSnapshot();
    const savedProject = ProjectSchema.parse(rawSavedProject);
    const refreshedAsset = savedProject.assets.find(
      (asset) => asset.id === rawRefreshedAsset.id,
    );
    this.assertSameProject(current.project, savedProject);
    if (
      !refreshedAsset ||
      !Number.isInteger(baseRevision) ||
      baseRevision < 0 ||
      savedRevision !== baseRevision + 1
    ) {
      throw new Error(
        `Invalid asset metadata acknowledgement: base=${baseRevision}, saved=${savedRevision}.`,
      );
    }
    if (current.revision < baseRevision) {
      throw new Error(
        `Asset metadata base revision ${baseRevision} is ahead of current editor revision ${current.revision}.`,
      );
    }
    this.history.clear();
    if (current.revision === baseRevision) {
      this.savedProjectJson = JSON.stringify(savedProject);
      this.snapshot = {
        ...current,
        project: savedProject,
        dirty: false,
        revision: savedRevision,
      };
      this.emit();
      return 'current';
    }

    const assetIndex = current.project.assets.findIndex(
      (asset) => asset.id === refreshedAsset.id,
    );
    if (assetIndex < 0) return 'stale';
    const assets = [...current.project.assets];
    assets[assetIndex] = refreshedAsset;
    this.snapshot = {
      ...current,
      project: ProjectSchema.parse({
        ...current.project,
        assets,
      }),
      dirty: true,
      revision: current.revision + 1,
    };
    this.emit();
    return 'stale';
  }

  applyAssetDelete(
    rawSavedProject: Project,
    deletedAssetId: string,
    baseRevision: number,
    savedRevision: number,
  ): SaveAcknowledgement {
    const current = this.requireSnapshot();
    const savedProject = ProjectSchema.parse(rawSavedProject);
    this.assertSameProject(current.project, savedProject);
    if (
      !Number.isInteger(baseRevision) ||
      baseRevision < 0 ||
      savedRevision !== baseRevision + 1 ||
      savedProject.assets.some((asset) => asset.id === deletedAssetId)
    ) {
      throw new Error(
        `Invalid asset delete acknowledgement: base=${baseRevision}, saved=${savedRevision}.`,
      );
    }
    if (current.revision < baseRevision) {
      throw new Error(
        `Asset delete base revision ${baseRevision} is ahead of current editor revision ${current.revision}.`,
      );
    }
    this.history.clear();
    if (current.revision === baseRevision) {
      this.savedProjectJson = JSON.stringify(savedProject);
      this.snapshot = {
        ...current,
        project: savedProject,
        dirty: false,
        revision: savedRevision,
      };
      this.emit();
      return 'current';
    }

    if (
      scanAssetReferences(current.project, deletedAssetId).length > 0
    ) {
      throw new Error(
        'Newer editor changes reference the deleted asset and cannot be merged safely.',
      );
    }
    const project = ProjectSchema.parse({
      ...current.project,
      assets: current.project.assets.filter(
        (asset) => asset.id !== deletedAssetId,
      ),
    });
    this.snapshot = {
      ...current,
      project,
      dirty: true,
      revision: current.revision + 1,
    };
    this.emit();
    return 'stale';
  }

  markSaved(
    rawProject: Project,
    savedRevision: number,
  ): SaveAcknowledgement {
    const current = this.requireSnapshot();
    const project = ProjectSchema.parse(rawProject);
    this.assertSameProject(current.project, project);
    if (!Number.isInteger(savedRevision) || savedRevision < 0) {
      throw new Error(
        `Saved revision must be a non-negative integer: ${savedRevision}.`,
      );
    }
    if (savedRevision > current.revision) {
      throw new Error(
        `Saved revision ${savedRevision} is ahead of current editor revision ${current.revision}.`,
      );
    }
    if (savedRevision < current.revision) {
      this.savedProjectJson = JSON.stringify(project);
      this.snapshot = {
        ...current,
        dirty: true,
      };
      this.emit();
      return 'stale';
    }
    this.snapshot = {
      ...current,
      project,
      dirty: false,
    };
    this.savedProjectJson = JSON.stringify(project);
    this.emit();
    return 'current';
  }

  clear(): void {
    this.history.clear();
    this.savedProjectJson = null;
    this.snapshot = null;
    this.emit();
  }

  private requireSnapshot(): EditorProjectSnapshot {
    if (!this.snapshot) throw new Error('No project is open.');
    return this.snapshot;
  }

  private assertSameProject(current: Project, next: Project): void {
    if (current.id !== next.id) {
      throw new Error(
        `Editor project identity mismatch: ${current.id} !== ${next.id}.`,
      );
    }
  }

  private applyHistoryProject(project: Project): void {
    const current = this.requireSnapshot();
    this.assertSameProject(current.project, project);
    this.snapshot = {
      ...current,
      project,
      dirty: JSON.stringify(project) !== this.savedProjectJson,
      revision: current.revision + 1,
    };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export const editorProjectStore = new EditorProjectStore();
export const historyStore = editorProjectStore.history;

// Diagnostic-only exposure (Issue #54 / Day 20 gate investigation).
// Guarded so the module stays safe under Node/SSR environments.
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__editorProjectStore =
    editorProjectStore;
}
