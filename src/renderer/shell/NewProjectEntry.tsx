import { validateProjectOpenCandidate } from './projectOpenFlow';

export interface NewProjectEntryProps {
  openCandidatePath: string;
  busy: boolean;
  onOpenCandidatePathChange(value: string): void;
  onChooseProjectDirectory(): Promise<void>;
  onOpenProject(): Promise<void>;
}

export function NewProjectEntry({
  openCandidatePath,
  busy,
  onOpenCandidatePathChange,
  onChooseProjectDirectory,
  onOpenProject,
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
          disabled={busy || !validation.valid}
          onClick={() => void onOpenProject()}
          type="button"
        >
          打开项目
        </button>
        <button
          className="choose-project-directory-button"
          data-testid="choose-project-directory"
          disabled={busy}
          onClick={() => void onChooseProjectDirectory()}
          type="button"
        >
          浏览…
        </button>
      </div>
      <button
        data-testid="new-project-button"
        disabled
        type="button"
      >
        新建项目（后续阶段启用）
      </button>
    </>
  );
}
