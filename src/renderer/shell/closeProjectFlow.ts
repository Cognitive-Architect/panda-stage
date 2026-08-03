/**
 * Pure decision helpers for the in-app "close current project" flow.
 *
 * This module owns no state and touches no store, no IPC, and no DOM, so the
 * three-branch contract can be locked by node-environment unit tests. The
 * Renderer dialog (`CloseConfirmDialog`) and the shell wiring
 * (`EditorShell`) both read their copy from here so the strings cannot drift.
 *
 * Scope note: this flow closes the *project* while the window stays open. The
 * native window `×` keeps its own Main Process guard
 * (`UnsavedCloseController` / `UnsavedCloseGuard`); nothing here replaces it.
 */

/** The three branches the user can pick in the close confirmation. */
export type CloseProjectChoice =
  | 'save-and-close'
  | 'close-without-saving'
  | 'cancel';

/**
 * Ruling ④: the in-app "close without saving" branch never asks the Main
 * Process to discard, so the autosave recovery file is retained. The UI must
 * say so before the user commits to that branch.
 */
export const CLOSE_PROJECT_RECOVERY_NOTICE =
  '不保存关闭会保留恢复记录，下次打开该项目可能出现恢复候选。';

/** Prompt shown when the open project still has unsaved changes. */
export const CLOSE_PROJECT_DIRTY_PROMPT =
  '当前项目有未保存的更改，请选择关闭方式。';

/** Prompt shown when the open project is already clean. */
export const CLOSE_PROJECT_CLEAN_PROMPT =
  '当前项目暂无未保存更改，确认要关闭吗？';

/** Status written to the editor shell after a save-and-close succeeds. */
export const CLOSE_PROJECT_SAVED_STATUS =
  '项目已保存并关闭，请选择一个 .pandastage 项目文件夹。';

/** Status written to the editor shell after a close-without-saving. */
export const CLOSE_PROJECT_DISCARDED_STATUS =
  '项目已关闭，未保存的更改没有写入 project.json，恢复记录仍保留。';

/** Status written to the editor shell after closing a clean project. */
export const CLOSE_PROJECT_CLEAN_STATUS =
  '项目已关闭，请选择一个 .pandastage 项目文件夹。';

export interface CloseConfirmPresentation {
  /** Whether the "save and close" branch can run at all. */
  saveEnabled: boolean;
  /** Headline question rendered inside the dialog. */
  prompt: string;
  /** Retention warning required by ruling ④. */
  recoveryNotice: string;
}

/**
 * Describes the confirmation dialog for the current dirty state.
 *
 * A clean project has nothing to save, so the "save and close" branch is
 * disabled rather than removed: all three branches stay visible so the dialog
 * contract does not change shape between clean and dirty projects.
 */
export function describeCloseConfirm(
  dirty: boolean,
): CloseConfirmPresentation {
  return {
    saveEnabled: dirty,
    prompt: dirty
      ? CLOSE_PROJECT_DIRTY_PROMPT
      : CLOSE_PROJECT_CLEAN_PROMPT,
    recoveryNotice: CLOSE_PROJECT_RECOVERY_NOTICE,
  };
}

/**
 * Maps a completed close branch to the status line shown on the start screen.
 */
export function closeProjectStatusMessage(
  choice: Exclude<CloseProjectChoice, 'cancel'>,
  dirty: boolean,
): string {
  if (!dirty) return CLOSE_PROJECT_CLEAN_STATUS;
  return choice === 'save-and-close'
    ? CLOSE_PROJECT_SAVED_STATUS
    : CLOSE_PROJECT_DISCARDED_STATUS;
}

/**
 * Explains why a save-before-close attempt did not close the project.
 *
 * The project deliberately stays open on every failure branch so the user
 * never loses edits to a half-completed close.
 */
export function closeProjectSaveFailureMessage(reason: string): string {
  const detail = reason.trim();
  return detail.length > 0
    ? `保存失败，项目未关闭：${detail}`
    : '保存失败，项目未关闭，请稍后重试。';
}

/** Explains a stale save acknowledgement during save-and-close. */
export const CLOSE_PROJECT_STALE_SAVE_MESSAGE =
  '保存期间又产生了新的未保存更改，项目未关闭，请再次保存后关闭。';

/** Normalises an unexpected close failure into Chinese product copy. */
export function closeProjectErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return `关闭项目失败，项目仍保持打开：${error.message}`;
  }
  return '关闭项目失败，项目仍保持打开，请稍后重试。';
}
