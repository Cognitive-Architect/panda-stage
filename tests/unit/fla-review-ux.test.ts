import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const component = readFileSync(
  'src/renderer/fla-import/FlaCompatibilityReviewSession.tsx',
  'utf8',
);
const styles = readFileSync('src/renderer/styles.css', 'utf8');
const issue255Styles = styles.slice(styles.indexOf('/* Issue #255:'));
const reviewModel = readFileSync('src/renderer/fla-import/fla-review.ts', 'utf8');

describe('FLA Slice 2 review UX contract', () => {
  it('exposes full-card, thumbnail, and one checkbox selection paths without double toggling', () => {
    expect(component).toContain('data-selection-target="thumbnail"');
    expect(component).toContain('data-selection-target="checkbox"');
    expect(component).toContain('role="button"');
    expect(component).toContain('aria-pressed={selected}');
    expect(component).toContain('onClick={(event: ReactMouseEvent<HTMLElement>) =>');
    expect(component).toContain('onKeyDown={(event: ReactKeyboardEvent<HTMLElement>) =>');
    expect(component).toContain("target.closest('input, label, button, a')");
    expect(component.match(/onChange=\{onToggle\}/gu)).toHaveLength(1);
  });

  it('owns one top-level foreground layer and suppresses background interaction', () => {
    expect(component).toContain('data-review-layout="portal"');
    expect(component).toContain('createPortal(surface, document.body)');
    expect(component).toContain('data-testid="fla-review-portal"');
    expect(component).toContain('data-testid="fla-review-backdrop"');
    expect(component).toContain('appRoot.inert = true');
    expect(component).toContain('appRoot.inert = wasInert');
    expect(issue255Styles).toMatch(
      /\.fla-review-portal\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?z-index:\s*1000;[\s\S]*?inset:\s*0;/u,
    );
    expect(issue255Styles).toMatch(
      /\.fla-review-portal \.fla-review-session\s*\{[\s\S]*?position:\s*relative;[\s\S]*?z-index:\s*1;/u,
    );
    expect(issue255Styles).toContain('.fla-review-backdrop');
  });

  it('uses one primary review-body scroll and keeps the action row out of that scroll', () => {
    expect(component).toContain('data-testid="fla-review-header"');
    expect(component).toContain('data-testid="fla-review-selection-toolbar"');
    expect(component).toContain('data-testid="fla-review-body"');
    expect(component.indexOf('data-testid="fla-review-selection-toolbar"')).toBeLessThan(
      component.indexOf('data-testid="fla-review-body"'),
    );
    expect(issue255Styles).toMatch(
      /\.fla-review-portal \.fla-review-session\s*\{[\s\S]*?grid-template-rows:\s*auto auto auto minmax\(0, 1fr\);/u,
    );
    expect(issue255Styles).toMatch(
      /\.fla-review-body\s*\{[\s\S]*?overflow-x:\s*hidden;[\s\S]*?overflow-y:\s*auto;[\s\S]*?overscroll-behavior:\s*contain;/u,
    );
    expect(issue255Styles).toMatch(
      /\.fla-review-body \.fla-review-media-grid\s*\{[\s\S]*?overflow:\s*visible;/u,
    );
  });

  it('compacts compatibility notes while preserving all statuses and actions', () => {
    expect(component).toContain('data-testid="fla-compatibility-notes"');
    expect(component).toContain('兼容性说明（{warnings.length}）');
    expect(component).toContain('data-testid="fla-compatibility-warnings"');
    expect(component).toContain('FLA_COMPATIBILITY_LABELS[status]');
    expect(component).toContain('data-testid="fla-review-selected-count"');
    expect(component).toContain('data-testid="fla-review-select-all"');
    expect(component).toContain('data-testid="fla-review-clear-all"');
    expect(component).toContain('data-testid="fla-review-confirm"');
    expect(component).toContain('data-testid="fla-review-cancel"');
    expect(issue255Styles).toContain('.fla-review-compatibility-notes summary');
    expect(component).not.toContain('window.pandaStage.assets');
    expect(component).not.toContain('updateProject');
  });

  it('keeps Slice 3 commit as a separate explicit state-bound action', () => {
    expect(component).toContain('commitSelected');
    expect(component).toContain('confirmed: true');
    expect(component).toContain('data-testid="fla-review-commit-action"');
    expect(component).toContain('className="fla-review-commit-primary fla-review-primary-action"');
    expect(component).toContain('data-testid="fla-review-commit"');
    expect(component).toContain('data-testid="fla-review-commit-status"');
    expect(component).toContain('data-testid="fla-review-commit-success"');
    expect(component).toContain('data-imported-count={commitResponse.summary.importedCount}');
    expect(component).toContain('data-duplicate-count={commitResponse.summary.duplicateCount}');
    expect(component).toContain('data-renamed-count={commitResponse.summary.renamedCount}');
    expect(component).toContain("phase === 'committing'");
    expect(component).not.toContain('window.pandaStage.assets');
    expect(issue255Styles).toContain('.fla-review-commit-action');
    expect(issue255Styles).toContain('.fla-review-commit-primary');
  });

  it('uses Chinese-first copy for the normal review surface', () => {
    expect(component).toContain('FLA 兼容性预览');
    expect(component).toContain('取消');
    expect(component).toContain('已选择：');
    expect(component).toContain('全选');
    expect(component).toContain('清空');
    expect(component).toContain('确认选择');
    expect(component).toContain('只读导入预览');
    expect(component).toContain('在确认导入前，不会修改项目或原文件。');
    expect(component).toContain('正在读取所选 FLA');
    expect(component).toContain('正在检查源文件');
    expect(component).toContain('源文件');
    expect(component).toContain('舞台');
    expect(component).toContain('素材');
    expect(component).toContain('已使用');
    expect(component).toContain('仅素材库');
    expect(component).toContain('兼容性说明');
    expect(component).toContain('导入前检查');
    expect(component).toContain('FLA 素材工作台');
    expect(component).toContain('<dt>目标文件名</dt>');
    expect(component).not.toContain('FLA V1 · Slice 2');
    expect(component).not.toContain('第 3 阶段');
    expect(component).not.toContain('Slice 3');
    expect(reviewModel).toContain("exact: '完全兼容'");
    expect(reviewModel).toContain("degraded: '部分兼容'");
    expect(reviewModel).toContain("unsupported: '暂不支持'");
    expect(reviewModel).toContain("'not-present': '未出现'");
  });

  it('hides diagnostic identifiers from the default UI but retains internal contracts', () => {
    expect(component).not.toContain('<dt>SHA-256</dt>');
    expect(component).not.toContain('<code>{media.id}</code>');
    expect(component).not.toContain('requestId ?');
    expect(component).toContain('createFlaRasterSelectionIntent');
    expect(component).toContain('sessionId');
    expect(reviewModel).toContain('sha256: ir.source.sha256');
    expect(reviewModel).toContain('sessionId,');
  });

  it('V1.5-A surfaces archive-malformed and zero-raster diagnostics without jargon', () => {
    // Archive-malformed error state gets its own beginner-facing testid.
    expect(component).toContain('data-testid="fla-review-diagnostic"');
    expect(component).toContain('data-testid="fla-review-zero-raster"');
    // Zero-raster copy is explicit and non-alarming.
    expect(component).toContain('没有找到可直接导入的位图素材');
    // Primary copy must not surface developer-only archive internals.
    expect(component).not.toContain('centralDirectorySize');
    expect(component).not.toContain('EOCD');
    expect(component).not.toContain('lifeart/fla-viewer');
    expect(component).not.toContain('developerNote');
    // The helper keys on the response diagnostics, not on raw error messages.
    expect(component).toContain('flaDiagnosticUserMessage(response)');
  });

  it('preserves deep scroll across review updates and keeps media identity stable', () => {
    expect(component).toContain('data-preserves-scroll-position="true"');
    expect(component).toContain('reviewScrollTop.current = event.currentTarget.scrollTop');
    expect(component).toContain('body.scrollTop = nextScrollTop');
    expect(component).toContain('useLayoutEffect');
    expect(component).toContain('rememberReviewScroll();');
    expect(component).toContain('open={compatibilityNotesOpen}');
    expect(component).toContain('event.preventDefault();');
    expect(component).toContain('key={item.media.id}');
    expect(component).not.toContain('scrollIntoView');
    expect(issue255Styles).toContain('overflow-anchor: none;');
    expect(issue255Styles).toContain('scrollbar-gutter: stable;');
    expect(issue255Styles).toContain("scroll-behavior: auto;");
  });
});
