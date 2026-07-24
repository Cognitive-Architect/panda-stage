import { ProjectSchema, type Project } from '../../domain';

export interface EditorProjectSnapshot {
  projectRoot: string;
  project: Project;
  dirty: boolean;
  revision: number;
}

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

  markSaved(rawProject: Project): void {
    const current = this.requireSnapshot();
    const project = ProjectSchema.parse(rawProject);
    this.assertSameProject(current.project, project);
    this.snapshot = {
      ...current,
      project,
      dirty: false,
    };
    this.emit();
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
