import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const component = readFileSync(
  'src/renderer/fla-import/FlaCompatibilityReviewSession.tsx',
  'utf8',
);
const styles = readFileSync('src/renderer/styles.css', 'utf8');
const issue392Styles = styles.slice(styles.indexOf('/* Issue #392:'));
const route = readFileSync('src/renderer/fla-import/fla-content-route.ts', 'utf8');
const card = component.slice(
  component.indexOf('function FlaReviewMediaCard'),
  component.indexOf('function FlaReviewMediaDetail'),
);

describe('Issue #392 Stage B v1.1 raster review workbench contract', () => {
  it('adds stable pagination and page-size controls without changing the route', () => {
    expect(route).toContain('response.ir.media.length > 0');
    expect(route).toContain("? 'v1-raster-review'");
    expect(component).toContain('FLA_RASTER_REVIEW_PAGE_SIZES');
    expect(component).toContain('data-testid="fla-review-pagination"');
    expect(component).toContain('data-testid="fla-review-page-status"');
    expect(component).toContain('data-testid="fla-review-page-size"');
    expect(component).toContain('setRasterPage(1)');
    expect(component).toContain('flaReviewPageCount(filteredReviewItems.length, rasterPageSize)');
    expect(component).toContain('paginateFlaReviewMedia(filteredReviewItems, rasterPage, rasterPageSize)');
    expect(issue392Styles).toContain('grid-template-columns: repeat(4, minmax(0, 1fr));');
    expect(issue392Styles).not.toMatch(/\.fla-raster-workbench\s*\{[^}]*overflow-y:\s*auto;/u);
    expect(issue392Styles).not.toMatch(/\.fla-review-media-grid\s*\{[^}]*overflow-y:\s*auto;/u);
  });

  it('filters the visible collection while global selection stays collection-wide', () => {
    expect(component).toContain('data-testid={`fla-review-filter-${filter}`}');
    expect(component).toContain('data-testid="fla-review-search"');
    expect(component).toContain("filterFlaReviewMedia(reviewItems, rasterFilter, rasterSearch, selectedMediaIds)");
    expect(component).toContain('setSelectedMediaIds(allFlaReviewMediaIds(reviewItems));');
    expect(component).toContain('setSelectedMediaIds(new Set());');
    expect(component).toContain('pagedReviewItems.map((item) =>');
    expect(component).toContain('if (!pagedReviewItems.some(({ media }) => media.id === focusedMediaId))');
    expect(component).toContain('setFocusedMediaId(pagedReviewItems[0]!.media.id);');
  });

  it('keeps cards thumbnail-first and keeps truthful detail facts out of the card scan path', () => {
    expect(card).toContain('className="fla-review-thumbnail"');
    expect(card).toContain('{media.name}');
    expect(card).toContain('data-usage-state=');
    expect(card).not.toContain('media.width} × {media.height}');
    expect(card).not.toContain('media.sourceFormat.toUpperCase()');
    expect(card).not.toContain('media.sourceReference}');
    expect(component).toContain('data-testid="fla-raster-file-details"');
    expect(component).toContain('data-testid="fla-raster-structure"');
    expect(component).toContain('data-testid="fla-raster-compatibility-summary"');
    expect(component).toContain('⚠ ${warnings.length} 个兼容性提示');
    expect(component).toContain('查看兼容性说明');
    expect(component).toContain('data-testid="fla-review-detail-warnings"');
  });

  it('keeps the bottom bar task-focused with one confirmation action and a separate commit boundary', () => {
    expect(component).toContain('data-testid="fla-review-action-cancel"');
    expect(component).toContain('{selectedCount} 项将进入确认步骤');
    expect(component).toContain('className="fla-review-primary-action"');
    expect(component).toContain('确认 {selectedCount} 项');
    expect(component).toContain('createFlaRasterSelectionIntent');
    expect(component).toContain('window.pandaStage.fla.commitSelected');
    expect(component).toContain('confirmed: true');
    expect(component).not.toContain('updateProject');
    expect(component).not.toContain('window.pandaStage.assets');
  });
});
