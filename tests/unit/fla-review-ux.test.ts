import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readOrderedStylesheetSource } from '../helpers/read-stylesheet-source';

const session = readFileSync(
  'src/renderer/fla-import/FlaCompatibilityReviewSession.tsx',
  'utf8',
);
const snapshotReview = readFileSync(
  'src/renderer/fla-import/FlaStaticSnapshotReview.tsx',
  'utf8',
);
const unified = readFileSync(
  'src/renderer/fla-import/FlaUnifiedWorkbench.tsx',
  'utf8',
);
const selection = readFileSync(
  'src/renderer/fla-import/fla-unified-workbench-selection.ts',
  'utf8',
);
const stageA = readFileSync(
  'src/renderer/fla-import/FlaStageAInspecting.tsx',
  'utf8',
);
const stageAStyles = readFileSync(
  'src/renderer/styles/features/fla-import/review/fla-stage-a-compact-preparation.css',
  'utf8',
);
const styles = readOrderedStylesheetSource();
const issue255Styles = styles.slice(styles.indexOf('/* Issue #255:'));

describe('Issue #775 C03 unified FLA workbench UX contract', () => {
  it('keeps thumbnail focus and checkbox selection as separate actions', () => {
    expect(unified).toContain('onClick={() => onFocusCandidate(candidate)}');
    expect(unified).toContain('onChange={(event) => onToggleCandidate(candidate, event.currentTarget.checked)}');
    expect(unified).toContain('aria-pressed={candidate.identityKey === focusedCandidateIdentityKey}');
    expect(unified).toContain('disabled={!candidate.selectable || locked}');
    expect(unified).not.toContain('onClickCapture');
  });

  it('owns one foreground layer and suppresses background interaction', () => {
    expect(session).toContain('data-review-layout="portal"');
    expect(session).toContain('createPortal(surface, document.body)');
    expect(session).toContain('data-testid="fla-review-portal"');
    expect(session).toContain('data-testid="fla-review-backdrop"');
    expect(session).toContain('appRoot.inert = true');
    expect(session).toContain('appRoot.inert = wasInert');
    expect(issue255Styles).toMatch(
      /\.fla-review-portal\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?z-index:\s*1000;[\s\S]*?inset:\s*0;/u,
    );
    expect(issue255Styles).toContain('.fla-review-backdrop');
  });

  it('uses one two-column candidate grid, one preview, and a pinned footer', () => {
    expect(session).toContain('<FlaUnifiedWorkbench');
    expect(session).toContain('data-workbench-route="unified"');
    expect(unified).toContain('data-testid="fla-c03-candidate-grid"');
    expect(unified).toContain('data-testid="fla-c03-preview"');
    expect(unified).toContain('data-testid="fla-c03-import-footer"');
    expect(unified).toContain('inert={importing}');
    expect(unified).toContain('data-testid="fla-c03-import-overlay"');
    expect(session).not.toContain('fla-import-workbench-tabs');
    expect(session).not.toContain('fla-render-mode-tabs');
    expect(session).not.toContain('data-testid="fla-review-pagination"');
    expect(styles).toMatch(/\.fla-c03-candidate-grid\s*\{[\s\S]*?overflow:\s*auto;[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/u);
    expect(styles).toMatch(/\.fla-c03-session\s*\{[\s\S]*?grid-template-rows:\s*auto minmax\(0, 1fr\);/u);
    expect(styles).toContain('.fla-c03-preview');
    expect(styles).toMatch(/\.fla-c03-import-overlay-panel\s*\{[^}]*width:\s*min\(400px, 100%\);/u);
    expect(styles).toMatch(/\.fla-c03-import-overlay\s*\{[^}]*position:\s*absolute;[^}]*pointer-events:\s*auto;/u);
  });

  it('searches the display list while preserving checks and restores selected-view browsing', () => {
    expect(selection).toContain('matchesFlaUnifiedCandidateSearch');
    expect(selection).toContain('selectedOnly || matchesFlaUnifiedCandidateSearch(candidate, searchText)');
    expect(unified).toContain('browseScrollTopRef.current = candidateGridRef.current?.scrollTop ?? 0');
    expect(unified).toContain('restoreBrowseScrollRef.current = true');
    expect(unified).toContain('data-testid="fla-c03-selected-view"');
    expect(unified).toContain('`已选 ${selectedCount}`');
    expect(unified).toContain('aria-label="全选当前结果"');
    expect(unified).toContain('aria-label="清空全部已选素材"');
    expect(unified).toContain("selectedOnly ? '返回浏览'");
    expect(unified).toContain('正在查看已选 · 搜索已暂停');
  });

  it('confirms only when one action adds more than 50 unique eligible candidates', () => {
    expect(selection).toContain('FLA_UNIFIED_BULK_CONFIRM_THRESHOLD = 50');
    expect(selection).toContain('new Set<string>()');
    expect(selection).toContain('!candidate.selectable || candidate.checked');
    expect(unified).toContain('data-testid="fla-c03-bulk-confirmation"');
    expect(unified).toContain('data-testid="fla-c03-bulk-confirm"');
    expect(unified).toContain('即将勾选 {newEligibleCount} 项素材，暂不会导入。');
    expect(unified).toContain('确认勾选');
    expect(session).toContain('requiresFlaBulkSelectionConfirmation(items.length)');
  });

  it('keeps raw import diagnostics collapsed and gives safe default failure guidance', () => {
    expect(unified).toContain('className="fla-c03-receipt-diagnostics"');
    expect(unified).toContain('技术详情');
    expect(unified).toContain('请先检查素材库，避免重复导入。');
    expect(unified).not.toContain('{item.message}</small>');
    expect(unified).not.toContain('receipt.warnings.map((warning, index) => <p');
  });

  it('keeps the import action reachable while the receipt uses one scroll owner', () => {
    expect(styles).toMatch(/\.fla-c03-footer-summary\s*\{[\s\S]*?position:\s*sticky;[\s\S]*?top:\s*0;/u);
    expect(styles).toMatch(/\.fla-c03-footer-actions\s*\{[\s\S]*?position:\s*sticky;[\s\S]*?top:\s*0;/u);
    expect(styles).not.toMatch(/\.fla-c03-receipt-details\s*\{[^}]*overflow:\s*auto;/u);
    expect(styles).not.toMatch(/\.fla-c03-receipt-details\s*\{[^}]*max-height:/u);
  });

  it('keeps keyboard preview focus separate from Space checkbox selection', () => {
    expect(unified).toContain("event.key !== 'Enter' && event.key !== ' '");
    expect(unified).toContain('onFocusCandidate(candidate);');
    expect(unified).toContain("event.code !== 'Space'");
    expect(unified).toContain('onToggleCandidate(candidate, !candidate.checked)');
  });

  it('shows truthful preview states and keeps progressive ordering independent of readiness', () => {
    expect(unified).toContain("case 'unsupported':");
    expect(unified).toContain("case 'blank':");
    expect(unified).toContain("case 'error':");
    expect(unified).toContain(": '加载中…';");
    expect(unified).toContain("return '暂无法预览';");
    expect(unified).toContain("return '加载失败';");
    expect(unified).toContain("return '空白画面';");
    expect(snapshotReview).toContain("status: 'error', reason: message");
    expect(unified).not.toContain('fla-c03-preview-reason');
    expect(session).toContain('focusedSnapshotCandidate?.selectable');
    expect(unified).toContain('data-testid="fla-c03-catalog-progress"');
    expect(unified).toContain('aria-label={`预览 ${fullItemLabel}`}');
    expect(unified).toContain('aria-label={`选择 ${fullItemLabel}`}');
    expect(session).toContain('onCatalogProgressChange={setCatalogProgress}');
    expect(session).toContain('sortFlaWorkbenchCandidates([');
  });

  it('keeps one import action, an accessible receipt, and safe close guards', () => {
    expect(session).toContain('runFlaUnifiedImport({');
    expect(session).toContain('confirmed: true');
    expect(unified).toContain('data-testid="fla-unified-import"');
    expect(unified).toContain('data-testid="fla-unified-import-counts"');
    expect(unified).toContain('data-testid="fla-unified-import-items"');
    expect(session).toContain("event.key !== 'Escape'");
    expect(session).toContain('unifiedImportRunningRef.current || renderTerminalState !==');
    expect(unified).toContain('data-testid="fla-unified-import-stop"');
    expect(session).not.toContain('window.pandaStage.assets');
    expect(session).not.toContain('updateProject');
  });

  it('uses concise Chinese copy and keeps technical route names out of the persistent interface', () => {
    expect(session).not.toContain('<p>导入 FLA</p>');
    expect(session).toContain('<h1 title={ir.source.basename}>');
    expect(session).toContain('aria-label="关闭"');
    expect(session).toContain('FLA 导入工作台');
    expect(unified).toContain('搜索素材');
    expect(unified).toContain('已选择 ${selectedCount} 项');
    expect(unified).toContain('aria-label="恢复默认预览大小"');
    expect(unified).toContain('title="恢复默认预览大小"');
    expect(unified).toContain('适中');
    expect(unified).toContain('onClick={() => updateZoom(-0.25)}');
    expect(unified).toContain('onClick={() => setPreviewZoom(1)}');
    expect(unified).toContain('onClick={() => updateZoom(0.25)}');
    expect(session).not.toContain('组合素材');
    expect(session).not.toContain('原始位图 / 零件');
    expect(session).not.toContain('单帧');
    expect(session).not.toContain('场景组合');
    expect(stageA).toContain('正在准备素材…');
  });

  it('presents Stage A as a compact, accessible import-preparation dialog', () => {
    expect(stageA).toContain('aria-busy="true"');
    expect(stageA).toContain('aria-modal="true"');
    expect(stageA).toContain('aria-labelledby="fla-stage-a-title"');
    expect(stageA).toContain('id="fla-stage-a-title"');
    expect(stageA).toContain('>导入素材</h2>');
    expect(stageA).toContain('role="status"');
    expect(stageA).toContain('aria-live="polite"');
    expect(stageA).toContain('aria-hidden="true"');
    expect(stageA).toContain('正在准备素材…');
    expect(stageA).toContain('取消');
    expect(stageA.match(/data-testid="fla-review-cancel"/gu) ?? []).toHaveLength(1);
    expect(stageA).toContain('cancelButtonRef.current?.focus();');
    expect(stageA).not.toContain('FLA 导入工作台');
    expect(stageA).not.toContain('检查中');
    expect(stageA).not.toContain('正在检查 FLA');
    expect(stageA).not.toContain('检查完成后自动进入下一步');
    expect(stageA).not.toContain('不会修改原文件或当前项目');
    expect(stageA).not.toContain('fla-stage-a-quiet-pane');
    expect(stageA).not.toContain('fla-stage-a-footer');
    expect(stageAStyles).toContain('width: min(420px, calc(100vw - 24px));');
    expect(stageAStyles).toContain('position: relative;');
    expect(stageAStyles).toContain('top: auto;');
    expect(stageAStyles).toContain('left: auto;');
    expect(stageAStyles).toContain('transform: none;');
    expect(stageAStyles).toContain('height: 48px;');
    expect(stageAStyles).toContain('@media (max-width: 560px)');
    expect(stageAStyles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation:\s*none;/u,
    );
  });

  it('handles Escape during Stage A and keeps keyboard focus inside the dialog', () => {
    expect(session).toContain(
      "if (phase !== 'inspecting' && (!ir || !sessionId)) return undefined;",
    );
    expect(session).toContain('[closeSession, ir, phase, sessionId]');
    expect(session).toContain("if (event.key !== 'Escape') return;");
    expect(stageA).toContain("if (event.key !== 'Tab') return;");
    expect(stageA).toContain('cancelButtonRef.current?.focus();');
  });

  it('keeps compact toolbar, keyboard-only checkbox focus, and visible primary controls', () => {
    expect(styles).toMatch(/\.fla-c03-browser-tools\s*\{[^}]*flex-wrap:\s*nowrap;/u);
    expect(styles).toMatch(/\.fla-c03-search\s*\{[^}]*flex:\s*1 1 160px;/u);
    expect(styles).toMatch(/@media \(max-width: 560px\)[\s\S]*?\.fla-c03-browser-tools\s*\{[^}]*flex-wrap:\s*wrap;/u);
    expect(styles).toContain('.fla-c03-checkbox-hitbox:has(input:focus-visible)');
    expect(styles).not.toContain('.fla-c03-checkbox-hitbox:focus-within');
    expect(styles).toMatch(/\.fla-c03-header button\s*\{[^}]*min-width:\s*48px;[^}]*min-height:\s*48px;/u);
    expect(styles).toMatch(/\.fla-c03-zoom-tools button:first-child,[\s\S]*?font-size:\s*22px;/u);
    expect(styles).toMatch(/\.fla-c03-footer-actions \.fla-c03-import-primary\s*\{[^}]*min-height:\s*44px;[^}]*font-size:\s*14px;[^}]*font-weight:\s*800;[^}]*overflow-wrap:\s*anywhere;/u);
  });
});
