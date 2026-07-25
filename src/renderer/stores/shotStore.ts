import {
  ShotService,
  type CreateShotInput,
  type Project,
} from '../../domain';
import {
  EditorProjectStore,
  editorProjectStore,
} from './EditorProjectStore';

type Listener = () => void;

export class ShotStore {
  private currentShotId: string | null = null;
  private readonly listeners = new Set<Listener>();
  private readonly unsubscribeEditor: () => void;

  constructor(
    private readonly editorStore: EditorProjectStore,
    private readonly service: ShotService,
  ) {
    this.unsubscribeEditor = editorStore.subscribe(() => {
      this.reconcileSelection();
    });
    this.reconcileSelection();
  }

  readonly getCurrentShotId = (): string | null => this.currentShotId;

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  dispose(): void {
    this.unsubscribeEditor();
    this.listeners.clear();
  }

  select(shotId: string): void {
    const project = this.project();
    if (!project.shots.some((shot) => shot.id === shotId)) {
      throw new Error(`找不到镜头：${shotId}`);
    }
    this.setCurrentShotId(shotId);
  }

  create(input: CreateShotInput): Project {
    const project = this.apply((current) =>
      this.service.create(current, input),
    );
    this.setCurrentShotId(project.shots.at(-1)!.id);
    return project;
  }

  duplicate(shotId: string): Project {
    const sourceIndex = this.project().shots.findIndex(
      (shot) => shot.id === shotId,
    );
    const project = this.apply((current) =>
      this.service.duplicate(current, shotId),
    );
    this.setCurrentShotId(project.shots[sourceIndex + 1]!.id);
    return project;
  }

  rename(shotId: string, name: string): Project {
    return this.apply((project) =>
      this.service.rename(project, shotId, name),
    );
  }

  setDuration(shotId: string, durationMs: number): Project {
    return this.apply((project) =>
      this.service.setDuration(project, shotId, durationMs),
    );
  }

  move(shotId: string, targetIndex: number): Project {
    return this.apply((project) =>
      this.service.move(project, shotId, targetIndex),
    );
  }

  remove(shotId: string): Project {
    const current = this.project();
    const removedIndex = current.shots.findIndex(
      (shot) => shot.id === shotId,
    );
    const next = this.service.remove(current, shotId);
    if (this.currentShotId === shotId) {
      this.setCurrentShotId(
        next.shots[removedIndex]?.id ??
          next.shots[removedIndex - 1]?.id ??
          null,
      );
    }
    this.editorStore.updateProject(next);
    return next;
  }

  private apply(mutation: (project: Project) => Project): Project {
    const project = mutation(this.project());
    this.editorStore.updateProject(project);
    return project;
  }

  private project(): Project {
    const snapshot = this.editorStore.getSnapshot();
    if (!snapshot) throw new Error('请先打开项目。');
    return snapshot.project;
  }

  private reconcileSelection(): void {
    const project = this.editorStore.getSnapshot()?.project;
    const nextId =
      project?.shots.some((shot) => shot.id === this.currentShotId)
        ? this.currentShotId
        : project?.shots[0]?.id ?? null;
    this.setCurrentShotId(nextId);
  }

  private setCurrentShotId(shotId: string | null): void {
    if (shotId === this.currentShotId) return;
    this.currentShotId = shotId;
    for (const listener of this.listeners) listener();
  }
}

export const shotStore = new ShotStore(
  editorProjectStore,
  new ShotService(),
);
