import { validateProjectOpenCandidate } from './projectOpenFlow';

export interface NewProjectEntryProps {
  openCandidatePath: string;
  busy: boolean;
  onOpenCandidatePathChange(value: string): void;
  onOpenProject(): Promise<void>;
}

export function NewProjectEntry({
  openCandidatePath,
  busy,
  onOpenCandidatePathChange,
  onOpenProject,
}: NewProjectEntryProps): React.JSX.Element {
  const validation = validateProjectOpenCandidate(openCandidatePath);
  return (
    <>
      <div className="recovery-open-row">
        <label>
          Project directory
          <input
            onChange={(event) =>
              onOpenCandidatePathChange(event.target.value)
            }
            placeholder="例如：D:\Projects\我的项目.pandastage"
            value={openCandidatePath}
          />
          <small className="open-path-hint">{validation.message}</small>
        </label>
        <button
          disabled={busy || !validation.valid}
          onClick={() => void onOpenProject()}
          type="button"
        >
          Open and check recovery
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
