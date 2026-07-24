import {
  ProjectSchema,
  type Asset,
  type Project,
} from '../../domain';

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
  private readonly listeners = new Set<Listener>();

  readonly getSnapshot = (): EditorProjectSnapshot | null => this.snapshot;

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  open(projectRoot: string, rawProject: Project): void {
    this.snapshot = {
      projectRoot,
      project: ProjectSchema.parse(rawProject),
      dirty: false,
      revision: 0,
    };
    this.emit();
  }

  updateProject(rawProject: Project): void {
    const current = this.requireSnapshot();
    const project = ProjectSchema.parse(rawProject);
    this.assertSameProject(current.project, project);
    this.snapshot = {
      ...current,
      project,
      dirty: true,
      revision: current.revision + 1,
    };
    this.emit();
  }

  restore(rawProject: Project): void {
    this.updateProject(rawProject);
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
    if (current.revision === baseRevision) {
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
    this.emit();
    return 'current';
  }

  clear(): void {
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

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export const editorProjectStore = new EditorProjectStore();
