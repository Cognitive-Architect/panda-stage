import { useEffect } from 'react';
import {
  describeCloseConfirm,
  type CloseProjectChoice,
} from './closeProjectFlow';

export interface CloseConfirmDialogProps {
  /** Name of the project that is about to be closed. */
  projectName: string;
  /** Whether the open project still has unsaved changes. */
  dirty: boolean;
  /** Disables every branch while a close or save is already running. */
  busy: boolean;
  /** Feedback line, e.g. why a save-and-close attempt failed. */
  status: string;
  onChoose(choice: CloseProjectChoice): void;
}

/**
 * Renderer-only three-branch confirmation for closing the current project.
 *
 * The dialog itself performs no IPC, no save, and no store mutation: it only
 * reports the user's choice through `onChoose`, and `EditorShell` owns the
 * consequences. That keeps this surface independent from the native window `×`
 * guard, which continues to run in the Main Process.
 */
export function CloseConfirmDialog({
  projectName,
  dirty,
  busy,
  status,
  onChoose,
}: CloseConfirmDialogProps): React.JSX.Element {
  const presentation = describeCloseConfirm(dirty);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || busy) return;
      event.preventDefault();
      onChoose('cancel');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, onChoose]);

  return (
    <div
      aria-labelledby="close-confirm-heading"
      aria-modal="true"
      className="close-confirm-overlay"
      data-testid="close-confirm-dialog"
      role="dialog"
    >
      <div className="close-confirm-frame">
        <header className="close-confirm-header">
          <h3 id="close-confirm-heading">关闭当前项目</h3>
          <p className="close-confirm-project" data-testid="close-confirm-project">
            {projectName}
          </p>
        </header>
        <p className="close-confirm-prompt" data-testid="close-confirm-prompt">
          {presentation.prompt}
        </p>
        <p
          className="close-confirm-recovery-notice"
          data-testid="close-confirm-recovery-notice"
        >
          {presentation.recoveryNotice}
        </p>
        <output className="close-confirm-status" data-testid="close-confirm-status">
          {status}
        </output>
        <div className="close-confirm-actions">
          <button
            className="close-confirm-save"
            data-testid="close-confirm-save"
            disabled={busy || !presentation.saveEnabled}
            onClick={() => onChoose('save-and-close')}
            type="button"
          >
            保存后关闭
          </button>
          <button
            className="close-confirm-discard"
            data-testid="close-confirm-discard"
            disabled={busy}
            onClick={() => onChoose('close-without-saving')}
            type="button"
          >
            不保存关闭
          </button>
          <button
            className="close-confirm-cancel"
            data-testid="close-confirm-cancel"
            disabled={busy}
            onClick={() => onChoose('cancel')}
            type="button"
          >
            取消
          </button>
        </div>
        <p className="close-confirm-hint">
          仅关闭当前项目，应用窗口保持打开；点击窗口关闭按钮仍会走系统确认。
        </p>
      </div>
    </div>
  );
}
