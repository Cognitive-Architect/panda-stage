import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

describe('F1-04 import transaction UI safeguards', () => {
  it('invalidates a selected preview before waiting for cancellation', () => {
    const flow = source('src/renderer/features/fla-import/FlaCharacterImportFlow.tsx');
    const prepare = flow.slice(
      flow.indexOf('const prepareTarget ='),
      flow.indexOf('const loadCandidateThumbnail ='),
    );
    const replacement = flow.slice(
      flow.indexOf('const replaceSourceFile ='),
      flow.indexOf('useEffect(() => {', flow.indexOf('const replaceSourceFile =')),
    );

    expect(prepare.indexOf('setPreview(null)')).toBeLessThan(prepare.indexOf('await Promise.all'));
    expect(prepare.indexOf("transition('preparing')")).toBeLessThan(prepare.indexOf('await Promise.all'));
    expect(replacement.indexOf('invalidatedRef.current = true')).toBeLessThan(
      replacement.indexOf('await cancelOwnedWork()'),
    );
    expect(replacement).toContain('sourceReplacementGenerationRef.current !== replacementGeneration');
  });

  it('queries a pending operation instead of resubmitting its create payload', () => {
    const flow = source('src/renderer/features/fla-import/FlaCharacterImportFlow.tsx');
    const create = flow.slice(
      flow.indexOf('const createCharacter ='),
      flow.indexOf("if (typeof document === 'undefined')"),
    );
    const pendingBranch = create.slice(
      create.indexOf('if (pendingCreateOperationRef.current)'),
      create.indexOf('if (', create.indexOf('if (pendingCreateOperationRef.current)') + 4),
    );

    expect(pendingBranch).toContain('await queryCharacterStatus();');
    expect(pendingBranch).toContain('return;');
    expect(flow).toContain('onQueryCharacterCreateStatus(');
    expect(flow).toContain("operationOutcome === 'RECOVERY_REQUIRED' && recoveryAction");
    expect(flow).toContain('hasPendingOperation && phase !== \'committing\' && !recoveryBusy');
    expect(flow).toContain(
      "if (phaseRef.current === 'committing' || pendingCreateOperationRef.current) return;",
    );
    expect(flow).toContain('onCommittingChange?.(Boolean(pendingCreateOperationRef.current));');
    const footer = flow.slice(
      flow.indexOf('className="fla-character-import-footer-actions"'),
      flow.indexOf('data-testid="fla-character-import-create"'),
    );
    expect(footer).toContain('{hasPendingOperation ? null : (');
    expect(footer).not.toContain('data-testid="fla-character-import-status"');
    expect(flow).toContain('className="fla-character-import-preview-status"');
    expect(flow).toContain("phase !== 'preview-ready' && Boolean(statusMessage)");
  });

  it('keeps the resource drawer and its navigation locked during the commit', () => {
    const dock = source('src/renderer/shell/ResourceActivityDock.tsx');

    expect(dock).toContain('if (!open && (flaCharacterImportCommittingRef.current');
    expect(dock).toContain('if (flaCharacterImportCommittingRef.current) return;');
    expect(dock).toContain('disabled={flaCharacterImportCommitting}');
    expect(dock).toContain('event.stopPropagation();');

    const shell = source('src/renderer/shell/EditorShell.tsx');
    const sessionGuard = shell.slice(
      shell.indexOf('const blockSessionChangeDuringExport ='),
      shell.indexOf('const clearExportTask ='),
    );
    expect(sessionGuard).toContain('if (flaCharacterCommitActiveRef.current && !allowPersistedFlaRecovery)');
    expect(shell).toContain('pendingRecord.credential.operationId === armedOperationId');
    expect(shell).toContain("flaCharacterOperationStateRef.current === 'safe-to-close'");
    expect(shell).toContain('角色保存仍待核对，请回到保存结果页面查询后再关闭窗口。');
  });

  it('persists the operation credential before starting the Main create request', () => {
    const flow = source('src/renderer/features/fla-import/FlaCharacterImportFlow.tsx');
    const create = flow.slice(
      flow.indexOf('const createCharacter ='),
      flow.indexOf("if (typeof document === 'undefined')"),
    );

    expect(create.indexOf('writePendingFlaCharacterCreateCredential(credential)')).toBeLessThan(
      create.indexOf('onCreateCharacter(preview, name.trim(), operationId)'),
    );
    expect(flow).toContain("setOperationSafetyState('in-progress')");

    const recovery = source('src/renderer/features/fla-import/FlaCharacterCreateRecoveryPanel.tsx');
    expect(recovery).toContain("status.status === 'IN_PROGRESS'");
    expect(recovery).toContain("onOperationStateChange('in-progress')");
    expect(recovery).toContain("status.status === 'RECOVERY_REQUIRED'");
    expect(recovery).toContain('onSafeExit(credential.operationId)');

    const queryBody = recovery.slice(
      recovery.indexOf('const query = async'),
      recovery.indexOf('const copyReceipt = async'),
    );
    const queryErrorBranch = queryBody.slice(
      queryBody.lastIndexOf('if (!status.ok) {'),
      queryBody.indexOf('} catch', queryBody.lastIndexOf('if (!status.ok) {')),
    );
    expect(queryErrorBranch).toContain("onOperationStateChange('unknown')");
    expect(queryErrorBranch).not.toContain("onOperationStateChange('safe-to-close')");
    expect(queryErrorBranch).not.toContain('setSafeExitAvailable(true)');

    const resultConflictBranch = queryBody.slice(
      queryBody.indexOf('if (!matchesPendingFlaCharacterCreateOutcome'),
      queryBody.indexOf("const resolved = await onResolved(credential, 'committed')"),
    );
    expect(resultConflictBranch).toContain("onOperationStateChange('unknown')");
    expect(resultConflictBranch).not.toContain("onOperationStateChange('safe-to-close')");
  });

  it('keeps assembled and source previews in one stable-height viewport', () => {
    const flow = source('src/renderer/features/fla-import/FlaCharacterImportFlow.tsx');
    const styles = source('src/renderer/styles/features/fla-import/f1-04--character-import.css');

    expect(flow).toContain('data-testid="fla-character-import-mode-assembled"');
    expect(flow).toContain('data-testid="fla-character-import-mode-source"');
    expect(flow).toContain('data-testid="fla-character-import-parts-toggle"');
    expect(flow).toContain('className="fla-character-import-preview-workspace"');
    expect(flow).not.toContain('查看原始整图');
    expect(styles).toContain('.fla-character-import-preview-workspace[data-parts-expanded=\'true\']');
    expect(styles).toContain('grid-template-rows: auto minmax(0, 1fr) auto;');
  });

  it('keeps character list entry actions paired and confines styling to landscape', () => {
    const dock = source('src/renderer/shell/ResourceActivityDock.tsx');
    const styles = source('src/renderer/styles/features/fla-import/f1-04--character-import.css');

    expect(dock).toContain('resource-activity-character-entry');
    expect(dock).toContain('<DecorativeIcon icon={FileInput} size={16} />');
    expect(dock).toContain('<DecorativeIcon icon={Plus} size={16} />');
    expect(styles).toContain(".editor-layout[data-shell-mode='landscape']");
    expect(styles).toContain('.resource-activity-character-entry:hover:not(:disabled)');
  });
});
