import type { Project } from '../../domain';
import type { HistoryCommand } from '../HistoryCommand';

type ApplyProject = (project: Project) => void;

export class ProjectCommand implements HistoryCommand {
  constructor(
    readonly label: string,
    readonly before: Project,
    readonly after: Project,
    private readonly applyProject: ApplyProject,
  ) {}

  get projectId(): string {
    return this.before.id;
  }

  undo(): void {
    this.applyProject(this.before);
  }

  redo(): void {
    this.applyProject(this.after);
  }

  mergeWith(next: HistoryCommand): HistoryCommand | null {
    if (
      !(next instanceof ProjectCommand) ||
      next.projectId !== this.projectId
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
