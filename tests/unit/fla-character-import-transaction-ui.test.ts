import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FlaCharacterImportPartsControl } from '../../src/renderer/features/fla-import/FlaCharacterImportPartsControl';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

describe('F1-04 import transaction UI safeguards', () => {
  it('renders one collapsed canvas control or one expanded sidebar header', () => {
    const renderControl = (expanded: boolean): string => renderToStaticMarkup(
      createElement(FlaCharacterImportPartsControl, {
        disabled: false,
        expanded,
        onToggle: () => undefined,
        partCount: 5,
      }),
    );
    const collapsed = renderControl(false);
    const expanded = renderControl(true);

    expect(collapsed).toContain('class="fla-character-import-parts-toggle"');
    expect(collapsed).toContain('aria-label="展开零件，5 个"');
    expect(collapsed).toContain('aria-expanded="false"');
    expect(collapsed).toContain('<span>零件 5</span>');
    expect(collapsed).not.toContain('fla-character-import-parts-header');

    expect(expanded).toContain('class="fla-character-import-parts-header"');
    expect(expanded).toContain('<h2 class="fla-character-import-parts-heading">零件 5</h2>');
    expect(expanded).toContain('aria-label="收起零件"');
    expect(expanded).toContain('aria-expanded="true"');
    expect(expanded).toContain('class="fla-character-import-parts-collapse"');
    expect(expanded).not.toContain('class="fla-character-import-parts-toggle"');
  });

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
    expect(shell).toContain('decideFlaCharacterNativeClose({');
    expect(shell).toContain('assertSnapshotCanClose: (snapshot) =>');
    expect(shell).toContain("flaCharacterOperationStateRef.current !== 'safe-to-close'");
    expect(shell).toContain('角色保存仍待核对，窗口保持打开。');
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
    expect(flow).toContain('decideFlaCharacterCreateStatus(');
    expect(flow).toContain('decideFlaCharacterCreateQueryFailure(code)');
    expect(flow).not.toContain("code === 'RECOVERY_REQUIRED' || code === 'OPERATION_ID_CONFLICT'");

    const recovery = source('src/renderer/features/fla-import/FlaCharacterCreateRecoveryPanel.tsx');
    expect(recovery).toContain('decideFlaCharacterCreateStatus(');
    expect(recovery).toContain('decision.operationState');
    expect(recovery).toContain('if (decision.canClose)');
    expect(recovery).toContain('onSafeExit(credential.operationId)');

    const queryBody = recovery.slice(
      recovery.indexOf('const query = async'),
      recovery.indexOf('const copyReceipt = async'),
    );
    expect(queryBody).toContain('const decision = decideFlaCharacterCreateStatus');
    expect(queryBody).toContain('decision.kind === \'failed\' || decision.kind === \'not-found\'');
    expect(queryBody).toContain("onOperationStateChange('unknown')");
    expect(queryBody).not.toContain("status.status === 'RECOVERY_REQUIRED') {\n        setSafeExitAvailable(true)");
  });

  it('keeps the assembled preview, unsupported whole-image fallback, and part collapse in one viewport', () => {
    const flow = source('src/renderer/features/fla-import/FlaCharacterImportFlow.tsx');
    const partsControl = source('src/renderer/features/fla-import/FlaCharacterImportPartsControl.tsx');
    const styles = source('src/renderer/styles/features/fla-import/f1-04--character-import.css');

    expect(flow).not.toContain('data-testid="fla-character-import-mode-assembled"');
    expect(flow).not.toContain('data-testid="fla-character-import-mode-source"');
    expect(flow).toContain('editablePreview && !partsExpanded');
    expect(flow).toContain('FlaCharacterImportPartsControl');
    expect(flow).toContain('data-preview-mode="assembled"');
    expect(flow).toContain("phase === 'whole-image-only' || !previewImages.reassembled");
    expect(partsControl).toContain('aria-expanded="false"');
    expect(partsControl).toContain('aria-expanded="true"');
    expect(partsControl).toContain('aria-controls="fla-character-import-parts"');
    expect(partsControl).toContain('data-testid="fla-character-import-parts-toggle"');
    expect(partsControl).toContain('icon={Layers}');
    expect(partsControl).toContain('className="fla-character-import-parts-collapse"');
    expect(flow).toContain('data-testid="fla-character-import-parts-panel"');
    expect(flow).toContain('className="fla-character-import-preview-workspace"');
    expect(flow).toContain('sourceBasename || \'选择 FLA 文件\'');
    expect(flow).toContain('const showPreviewStatus = !centerLoading');
    expect(flow).not.toContain('查看原始整图');
    expect(styles).toContain('position: absolute;');
    expect(styles).toContain('right: var(--ui-space-2);');
    expect(styles).toContain('.fla-character-import-preview-workspace[data-parts-expanded=\'true\']');
    expect(styles).toContain('grid-template-rows: auto minmax(0, 1fr);');
    expect(styles).toContain('.fla-character-import-parts-header');
    expect(styles).toContain('min-height: var(--ui-touch-icon);');
    expect(styles).toContain('grid-template-rows: auto minmax(0, 1fr) auto;');
    expect(styles).toContain('width: clamp(240px, 22vw, 300px);');
    expect(styles).toContain('align-items: center;');
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
