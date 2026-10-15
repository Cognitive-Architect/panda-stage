import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const component = readFileSync(
  'src/renderer/fla-import/FlaCompatibilityReviewSession.tsx',
  'utf8',
);
const workbench = readFileSync('src/renderer/fla-import/FlaUnifiedWorkbench.tsx', 'utf8');
const selection = readFileSync('src/renderer/fla-import/fla-unified-workbench-selection.ts', 'utf8');
const c03Styles = readFileSync('src/renderer/styles/features/fla-import/c03-unified-workbench.css', 'utf8');
const route = readFileSync('src/renderer/fla-import/fla-content-route.ts', 'utf8');

describe('Issue #775 C03 keeps the full raster catalog in the unified workbench', () => {
  it('uses one scrollable candidate grid without a separate raster paging route', () => {
    expect(route).toContain('response.ir.media.length > 0');
    expect(route).toContain("? 'v1-raster-review'");
    expect(component).toContain('<FlaUnifiedWorkbench');
    expect(component).not.toContain('<FlaRenderWorkbench');
    expect(workbench).toContain('data-testid="fla-c03-candidate-grid"');
    expect(workbench).toContain('visibleCandidates.map((candidate) =>');
    expect(c03Styles).toMatch(/\.fla-c03-candidate-grid\s*\{[\s\S]*?overflow:\s*auto;[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/u);
    expect(workbench).not.toContain('data-testid="fla-review-pagination"');
    expect(workbench).not.toContain('data-testid="fla-review-page-size"');
  });

  it('searches the whole candidate catalog and keeps checked items global to the current view', () => {
    expect(workbench).toContain('filterFlaUnifiedCandidates(candidates, searchText, selectedOnly)');
    expect(workbench).toContain('data-testid="fla-c03-search"');
    expect(workbench).toContain('data-testid="fla-c03-selected-view"');
    expect(selection).toContain('newSelectableFlaUnifiedCandidates');
    expect(selection).toContain('!candidate.selectable || candidate.checked');
    expect(selection).toContain('const seen = new Set<string>()');
    expect(component).toContain('newSelectableFlaUnifiedCandidates(unifiedCandidates, searchText)');
    expect(component).toContain('const checkUnifiedCandidates = useCallback');
    expect(component).toContain('for (const item of items) next.set(item.key, item);');
    expect(component).not.toContain('rasterPageSize');
    expect(component).not.toContain('pagedReviewItems');
  });

  it('keeps cards recognizable and avoids exposing engineering identity in the visible content', () => {
    expect(workbench).toContain('className="fla-c03-thumbnail"');
    expect(workbench).toContain('candidate.displayLabel');
    expect(workbench).toContain('candidateStatus(candidate)');
    expect(workbench).toContain('aria-label={`预览 ${fullItemLabel}`}');
    expect(workbench).toContain('aria-label={`选择 ${fullItemLabel}`}');
    expect(workbench).not.toContain('candidate.provenance.renderTargetId}</strong>');
    expect(workbench).not.toContain('candidate.operation.target');
    expect(workbench).not.toContain('media.sourceReference');
  });

  it('keeps one common import action and preserves the existing Main commit boundary', () => {
    expect(workbench).toContain('data-testid="fla-unified-import"');
    expect(workbench).toContain('data-testid="fla-unified-import-counts"');
    expect(workbench).toContain('data-testid="fla-unified-import-items"');
    expect(workbench).toContain('导入 {selectedCount} 项');
    expect(component).toContain('runFlaUnifiedImport({');
    expect(component).toContain('window.pandaStage.fla.commitSelected');
    expect(component).toContain('confirmed: true');
    expect(component).not.toContain('data-testid="fla-review-confirm"');
    expect(component).not.toContain('updateProject');
    expect(component).not.toContain('window.pandaStage.assets');
  });
});
