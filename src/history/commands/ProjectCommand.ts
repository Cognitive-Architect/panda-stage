import { scanAssetReferences, type Project } from '../../domain';
import type {
  HistoryCommand,
  HistoryReplayEffects,
} from '../HistoryCommand';

type ApplyProject = (project: Project) => void;

export class ProjectCommand implements HistoryCommand {
  constructor(
    readonly label: string,
    readonly before: Project,
    readonly after: Project,
    private readonly applyProject: ApplyProject,
    private readonly replayEffects: HistoryReplayEffects = {},
  ) {}

  get projectId(): string {
    return this.before.id;
  }

  undo(): void {
    this.applyProject(this.before);
    this.replayEffects.afterUndo?.();
  }

  redo(): void {
    this.applyProject(this.after);
    this.replayEffects.afterRedo?.();
  }

  referencesAsset(assetId: string): boolean {
    return (
      scanAssetReferences(this.before, assetId).length > 0 ||
      scanAssetReferences(this.after, assetId).length > 0
    );
  }

  referencesPoseSnapshotAsset(assetId: string): boolean {
    return [this.before, this.after].some((project) =>
      scanAssetReferences(project, assetId).some(
        (reference) => reference.kind === 'pose-animation-part',
      ),
    );
  }

  mergeWith(next: HistoryCommand): HistoryCommand | null {
    if (
      !(next instanceof ProjectCommand) ||
      next.projectId !== this.projectId ||
      this.replayEffects.afterUndo ||
      this.replayEffects.afterRedo ||
      next.replayEffects.afterUndo ||
      next.replayEffects.afterRedo
    ) {
      return null;
    }
    return new ProjectCommand(
      next.label,
      this.before,
      next.after,
      this.applyProject,
    );
  }
}
