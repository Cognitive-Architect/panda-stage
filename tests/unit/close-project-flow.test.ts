import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CLOSE_PROJECT_CLEAN_PROMPT,
  CLOSE_PROJECT_CLEAN_STATUS,
  CLOSE_PROJECT_DIRTY_PROMPT,
  CLOSE_PROJECT_DISCARDED_STATUS,
  CLOSE_PROJECT_RECOVERY_NOTICE,
  CLOSE_PROJECT_SAVED_STATUS,
  CLOSE_PROJECT_STALE_SAVE_MESSAGE,
  closeProjectErrorMessage,
  closeProjectSaveFailureMessage,
  closeProjectStatusMessage,
  describeCloseConfirm,
} from '../../src/renderer/shell/closeProjectFlow';

function readSource(relativePath: string): string {
  return readFileSync(
    path.join(process.cwd(), relativePath),
    'utf8',
  );
}

/**
 * Strips comments so "this module must not reference X" assertions describe
 * real code instead of documentation that explains the boundary.
 */
function readCode(relativePath: string): string {
  return readSource(relativePath)
    .replaceAll(/\/\*[\s\S]*?\*\//gu, '')
    .replaceAll(/^\s*\/\/.*$/gmu, '');
}

const dialogSource = readSource(
  'src/renderer/shell/CloseConfirmDialog.tsx',
);
const shellSource = readSource('src/renderer/shell/EditorShell.tsx');
const topBarSource = readSource('src/renderer/shell/EditorTopBar.tsx');
const controllerSource = readSource(
  'src/renderer/features/recovery/ProjectSessionController.ts',
);
const dialogCode = readCode('src/renderer/shell/CloseConfirmDialog.tsx');
const flowCode = readCode('src/renderer/shell/closeProjectFlow.ts');
const shellCode = readCode('src/renderer/shell/EditorShell.tsx');
const controllerCode = readCode(
  'src/renderer/features/recovery/ProjectSessionController.ts',
);

describe('in-app close project flow', () => {
  it('offers exactly three branches with save gated on unsaved changes', () => {
    const dirty = describeCloseConfirm(true);
    const clean = describeCloseConfirm(false);

    expect(dirty.saveEnabled).toBe(true);
    expect(dirty.prompt).toBe(CLOSE_PROJECT_DIRTY_PROMPT);
    expect(clean.saveEnabled).toBe(false);
    expect(clean.prompt).toBe(CLOSE_PROJECT_CLEAN_PROMPT);
    // The retention warning is unconditional: it is a property of the
    // "close without saving" branch, which is always offered.
    expect(dirty.recoveryNotice).toBe(CLOSE_PROJECT_RECOVERY_NOTICE);
    expect(clean.recoveryNotice).toBe(CLOSE_PROJECT_RECOVERY_NOTICE);
  });

  it('locks the recovery retention contract required by ruling 4', () => {
    expect(CLOSE_PROJECT_RECOVERY_NOTICE).toBe(
      '不保存关闭会保留恢复记录，下次打开该项目可能出现恢复候选。',
    );
    expect(CLOSE_PROJECT_DISCARDED_STATUS).toContain('恢复记录仍保留');
    // The dialog renders the constant instead of re-typing the sentence.
    expect(dialogSource).toContain('presentation.recoveryNotice');
    expect(dialogSource).toContain(
      'data-testid="close-confirm-recovery-notice"',
    );
  });

  it('maps each completed branch to its own status line', () => {
    expect(closeProjectStatusMessage('save-and-close', true)).toBe(
      CLOSE_PROJECT_SAVED_STATUS,
    );
    expect(closeProjectStatusMessage('close-without-saving', true)).toBe(
      CLOSE_PROJECT_DISCARDED_STATUS,
    );
    expect(closeProjectStatusMessage('save-and-close', false)).toBe(
      CLOSE_PROJECT_CLEAN_STATUS,
    );
    expect(closeProjectStatusMessage('close-without-saving', false)).toBe(
      CLOSE_PROJECT_CLEAN_STATUS,
    );
  });

  it('explains every failure branch without closing the project', () => {
    expect(closeProjectSaveFailureMessage('磁盘写入被拒绝。')).toBe(
      '保存失败，项目未关闭：磁盘写入被拒绝。',
    );
    expect(closeProjectSaveFailureMessage('   ')).toBe(
      '保存失败，项目未关闭，请稍后重试。',
    );
    expect(CLOSE_PROJECT_STALE_SAVE_MESSAGE).toContain('项目未关闭');
    expect(closeProjectErrorMessage(new Error('stop failed'))).toBe(
      '关闭项目失败，项目仍保持打开：stop failed',
    );
    expect(closeProjectErrorMessage(undefined)).toBe(
      '关闭项目失败，项目仍保持打开，请稍后重试。',
    );
  });

  it('keeps the flow module free of state, IPC, and DOM', () => {
    expect(flowCode).not.toContain('window.');
    expect(flowCode).not.toContain('pandaStage');
    expect(flowCode).not.toContain('useState');
    expect(flowCode).not.toContain('Store');
    expect(flowCode).not.toContain('document');
    expect(flowCode).not.toContain('import ');
  });
});

describe('in-app close project contract locks', () => {
  it('adds closeProject to the session controller without rewriting it', () => {
    // Additive: the pre-existing lifecycle methods must all survive.
    for (const method of [
      'async switchProject(',
      'async switchRecentProject(',
      'private async switchWith(',
      'clearRecoveryCandidate(',
      'async dispose(',
      'private sameRoot(',
    ]) {
      expect(controllerSource).toContain(method);
    }
    expect(controllerSource).toContain('async closeProject(');
    expect(
      controllerSource.match(/async closeProject\(/gu),
    ).toHaveLength(1);
  });

  it('closes by stopping autosave only, never by discarding recovery', () => {
    const closeBody = controllerCode.slice(
      controllerCode.indexOf('async closeProject('),
      controllerCode.indexOf('clearRecoveryCandidate('),
    );
    expect(closeBody).toContain('this.api.stop(trackedProjectRoot)');
    expect(closeBody).toContain('this.store.clear()');
    expect(closeBody).toContain('CLOSE_STOP_FAILED');
    // No discard, no ignore, no extra IPC of any kind.
    expect(closeBody).not.toContain('discard');
    expect(closeBody).not.toContain('ignore');
    expect(closeBody).not.toContain('this.api.open');
    expect(closeBody).not.toContain('this.api.track');
    expect(closeBody).not.toContain('this.api.detect');
    expect(closeBody).not.toContain('confirmSwitch');
    expect(closeBody).not.toContain('window.');
  });

  it('routes the close through the single owned editor shell session', () => {
    expect(shellSource).toContain('closeProject(): Promise<ProjectSessionSnapshot>');
    expect(shellSource).toContain('this.controller.closeProject()');
    expect(shellSource).toContain('runControllerTransition');
    expect(shellSource).toContain('await session.closeProject()');
    // The shell owns the consequences; the dialog only reports a choice.
    expect(dialogSource).not.toContain('pandaStage');
    expect(dialogSource).not.toContain('Store');
    expect(dialogSource).not.toContain('saveCurrentProject');
    expect(dialogSource).not.toContain('EditorShellSession');
    expect(dialogSource).not.toContain('ProjectSessionController');
    expect(dialogSource).toContain('onChoose(choice: CloseProjectChoice)');
  });

  it('keeps the native window close guard intact and separate', () => {
    // The Renderer close never reaches into the Main Process window guard.
    for (const code of [dialogCode, flowCode, shellCode]) {
      expect(code).not.toContain('UnsavedCloseGuard');
      expect(code).not.toContain('UnsavedCloseController');
      // `.requestClose(` is the Main guard entry point; the shell's own
      // `requestCloseProject` opener is a different, Renderer-local symbol.
      expect(code).not.toContain('.requestClose(');
      expect(code).not.toContain('window.close(');
    }
    const guardSource = readSource(
      'src/main/windows/unsaved-close-guard.ts',
    );
    const mainSource = readSource('src/main/index.ts');
    expect(guardSource).toContain('UnsavedCloseGuard');
    expect(mainSource).toContain('new UnsavedCloseGuard(');
    expect(mainSource).toContain('unsavedCloseController');
    // The in-app dialog says so out loud.
    expect(dialogSource).toContain(
      '仅关闭当前项目，应用窗口保持打开；点击窗口关闭按钮仍会走系统确认。',
    );
  });

  it('mounts the close dialog only from the shell, behind one entry', () => {
    expect(
      shellSource.match(/<CloseConfirmDialog/gu),
    ).toHaveLength(1);
    expect(shellSource).toContain('{closeConfirmOpen ? (');
    expect(topBarSource).toContain('data-testid="close-project-open"');
    expect(topBarSource).toContain('关闭当前项目');
    expect(topBarSource).toContain('disabled={busy || closeConfirmOpen}');
    expect(topBarSource).not.toContain('CloseConfirmDialog');
  });

  it('cancels without any session or store side effect', () => {
    const cancelBody = shellCode.slice(
      shellCode.indexOf('const cancelCloseProject'),
      shellCode.indexOf('const finishCloseProject'),
    );
    expect(cancelBody).toContain('setCloseConfirmOpen(false)');
    expect(cancelBody).toContain('已取消关闭，当前项目保持打开。');
    expect(cancelBody).not.toContain('session.');
    expect(cancelBody).not.toContain('store');
  });
});
