import { Button } from '../ui';
import { validateNewProjectInput } from './projectCreateFlow';

export interface NewProjectDialogProps {
  parentDirectory: string;
  projectName: string;
  status: string;
  busy: boolean;
  mode?: 'project' | 'from-template' | 'save-template';
  parentDirectoryTouched?: boolean;
  projectNameTouched?: boolean;
  onParentDirectoryChange(value: string): void;
  onParentDirectoryBlur?(): void;
  onProjectNameChange(value: string): void;
  onProjectNameBlur?(): void;
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
  mode = 'project',
  parentDirectoryTouched = false,
  projectNameTouched = false,
  onParentDirectoryChange,
  onParentDirectoryBlur,
  onProjectNameChange,
  onProjectNameBlur,
  onChooseParentDirectory,
  onCreateProject,
  onCancel,
}: NewProjectDialogProps): React.JSX.Element {
  const validation = validateNewProjectInput(parentDirectory, projectName);
  const savingTemplate = mode === 'save-template';
  const heading = savingTemplate ? '存为模板' : mode === 'from-template' ? '从模板创建工程' : '新建项目';
  const showParentDirectoryValidation =
    parentDirectoryTouched && !validation.parentDirectory.valid;
  const showProjectNameValidation =
    projectNameTouched && !validation.projectName.valid;

  return (
    <div
      aria-labelledby="new-project-heading"
      aria-modal="true"
      className="new-project-dialog"
      data-testid="new-project-dialog"
      role="dialog"
    >
      <div className="new-project-dialog-body">
        <h3 id="new-project-heading">{heading}</h3>
        <div
          aria-labelledby="new-project-parent-field-label"
          className="new-project-field"
          role="group"
        >
          <span className="sr-only" id="new-project-parent-field-label">
            存放文件夹
          </span>
          <span className="new-project-field-row">
            <input
              aria-invalid={showParentDirectoryValidation || undefined}
              aria-describedby={
                showParentDirectoryValidation
                  ? 'new-project-parent-directory-error'
                  : undefined
              }
              aria-labelledby="new-project-parent-field-label"
              data-testid="new-project-parent-directory"
              disabled={busy}
              onBlur={onParentDirectoryBlur}
              onChange={(event) => onParentDirectoryChange(event.target.value)}
              placeholder={savingTemplate ? '选择或输入模板的存放文件夹' : '选择或输入新项目的存放文件夹'}
              value={parentDirectory}
            />
            <Button
              variant="secondary"
              className="task4-hit-target"
              data-task4-core="new-project-choose-directory"
              data-testid="new-project-choose-directory"
              disabled={busy}
              onClick={() => void onChooseParentDirectory()}
              type="button"
            >
              浏览…
            </Button>
          </span>
          {showParentDirectoryValidation ? (
            <small
              className="new-project-hint"
              id="new-project-parent-directory-error"
              role="alert"
            >
              {validation.parentDirectory.message}
            </small>
          ) : null}
        </div>
        <label className="new-project-field">
          <span>{savingTemplate ? '模板名称' : '项目名称'}</span>
          <input
            aria-invalid={showProjectNameValidation || undefined}
            aria-describedby={
              showProjectNameValidation ? 'new-project-name-error' : undefined
            }
            autoFocus
            data-testid="new-project-name"
            disabled={busy}
            onBlur={onProjectNameBlur}
            onChange={(event) => onProjectNameChange(event.target.value)}
            placeholder={savingTemplate ? '输入模板名称' : '输入项目名称，无需填写后缀'}
            value={projectName}
          />
          {showProjectNameValidation ? (
            <small
              className="new-project-hint"
              id="new-project-name-error"
              role="alert"
            >
              {validation.projectName.message}
            </small>
          ) : null}
        </label>
        <output aria-live="polite" className="new-project-status">
          {status}
        </output>
        <div className="new-project-actions">
          <Button
            className="task4-hit-target"
            data-task4-core="new-project-confirm"
            data-testid="new-project-confirm"
            disabled={busy || !validation.valid}
            onClick={() => void onCreateProject()}
            type="button"
          >
            {savingTemplate ? '保存模板' : '创建项目'}
          </Button>
          <Button
            variant="secondary"
            className="task4-hit-target"
            data-task4-core="new-project-cancel"
            data-testid="new-project-cancel"
            disabled={busy}
            onClick={onCancel}
            type="button"
          >
            取消
          </Button>
        </div>
      </div>
    </div>
  );
}
