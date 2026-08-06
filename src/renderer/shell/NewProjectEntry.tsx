import { validateProjectOpenCandidate } from './projectOpenFlow';

export interface NewProjectEntryProps {
  openCandidatePath: string;
  busy: boolean;
  newProjectDialogOpen: boolean;
  onOpenCandidatePathChange(value: string): void;
  onChooseProjectDirectory(): Promise<void>;
  onOpenProject(): Promise<void>;
  onRequestNewProject(): void;
}

export function NewProjectEntry({
  openCandidatePath,
  busy,
  newProjectDialogOpen,
  onOpenCandidatePathChange,
  onChooseProjectDirectory,
  onOpenProject,
  onRequestNewProject,
}: NewProjectEntryProps): React.JSX.Element {
  const validation = validateProjectOpenCandidate(openCandidatePath);
  return (
    <>
      <div className="recovery-open-row">
        <label>
          项目文件夹（.pandastage）
          <input
            onChange={(event) =>
              onOpenCandidatePathChange(event.target.value)
            }
            placeholder="输入 .pandastage 项目文件夹的完整路径"
            value={openCandidatePath}
          />
          <small className="open-path-hint">{validation.message}</small>
        </label>
        <button
          className="task4-hit-target"
          data-task4-core="open-project"
          data-testid="open-project"
          disabled={busy || !validation.valid}
          onClick={() => void onOpenProject()}
          type="button"
        >
          打开项目
        </button>
        <button
          className="choose-project-directory-button task4-hit-target"
          data-task4-core="choose-project-directory"
          data-testid="choose-project-directory"
          disabled={busy}
          onClick={() => void onChooseProjectDirectory()}
          type="button"
        >
          浏览…
        </button>
      </div>
      <button
        className="new-project-button task4-hit-target"
        data-task4-core="new-project"
        data-testid="new-project-button"
        disabled={busy || newProjectDialogOpen}
        onClick={onRequestNewProject}
        type="button"
      >
        新建项目
      </button>
    </>
  );
}
