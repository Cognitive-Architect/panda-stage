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
    expect(flow).toContain('phase === \'inspecting\' || phase === \'preparing\' ? \'\' : statusMessage');
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
    expect(sessionGuard).toContain('if (flaCharacterCommitActiveRef.current)');
    expect(shell).toContain('角色保存结果尚未确认，请回到导入窗口查询保存结果后再关闭窗口。');
  });
});
