import { validateNewProjectInput } from './projectCreateFlow';

export interface NewProjectDialogProps {
  parentDirectory: string;
  projectName: string;
  status: string;
  busy: boolean;
  onParentDirectoryChange(value: string): void;
  onProjectNameChange(value: string): void;
  onChooseParentDirectory(): Promise<void>;
  onCreateProject(): Promise<void>;
  onCancel(): void;
}

/**
 * Presentational new-project form.
 *
 * The component owns no project, session, or IPC state: it renders the two
 * submitted fields (parent directory + bare project name) and delegates every
 * action to the shell. It never assembles the final project root.
 */
export function NewProjectDialog({
  parentDirectory,
  projectName,
  status,
  busy,
  onParentDirectoryChange,
  onProjectNameChange,
  onChooseParentDirectory,
  onCreateProject,
  onCancel,
}: NewProjectDialogProps): React.JSX.Element {
  const validation = validateNewProjectInput(parentDirectory, projectName);
  return (
    <div
      aria-labelledby="new-project-heading"
      aria-modal="true"
      className="new-project-dialog"
      data-testid="new-project-dialog"
      role="dialog"
    >
      <div className="new-project-dialog-body">
        <h3 id="new-project-heading">新建项目</h3>
        <label className="new-project-field">
          存放文件夹
          <span className="new-project-field-row">
            <input
              data-testid="new-project-parent-directory"
              disabled={busy}
              onChange={(event) =>
                onParentDirectoryChange(event.target.value)
              }
              placeholder="选择或输入新项目的存放文件夹"
              value={parentDirectory}
            />
            <button
              data-testid="new-project-choose-directory"
              disabled={busy}
              onClick={() => void onChooseParentDirectory()}
              type="button"
            >
              浏览…
            </button>
          </span>
          <small className="new-project-hint">
            {validation.parentDirectory.message}
          </small>
        </label>
        <label className="new-project-field">
          项目名称
          <input
            data-testid="new-project-name"
            disabled={busy}
            onChange={(event) => onProjectNameChange(event.target.value)}
            placeholder="输入项目名称，无需填写后缀"
            value={projectName}
          />
          <small className="new-project-hint">
            {validation.projectName.message}
          </small>
        </label>
        <output className="new-project-status">{status}</output>
        <div className="new-project-actions">
          <button
            data-testid="new-project-confirm"
            disabled={busy || !validation.valid}
            onClick={() => void onCreateProject()}
            type="button"
          >
            创建项目
          </button>
          <button
            data-testid="new-project-cancel"
            disabled={busy}
            onClick={onCancel}
            type="button"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
