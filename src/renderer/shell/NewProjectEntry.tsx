export interface NewProjectEntryProps {
  projectRootInput: string;
  busy: boolean;
  onProjectRootInputChange(value: string): void;
  onOpenProject(): Promise<void>;
}

export function NewProjectEntry({
  projectRootInput,
  busy,
  onProjectRootInputChange,
  onOpenProject,
}: NewProjectEntryProps): React.JSX.Element {
  return (
    <>
      <div className="recovery-open-row">
        <label>
          Project directory
          <input
            onChange={(event) =>
              onProjectRootInputChange(event.target.value)
            }
            placeholder="D:\Projects\story.pandastage"
            value={projectRootInput}
          />
        </label>
        <button
          disabled={busy || !projectRootInput.trim()}
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
