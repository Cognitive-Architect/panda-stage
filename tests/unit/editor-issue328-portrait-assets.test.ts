import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

describe('Issue #328 portrait Assets cleanup', () => {
  it('localizes only the portrait Assets top-level workspace label', () => {
    const switcher = source(
      'src/renderer/shell/AdaptiveWorkspaceSwitcher.tsx',
    );

    expect(switcher).toContain("{ value: 'assets', label: '素材' }");
    expect(switcher).not.toContain("{ value: 'assets', label: 'Assets' }");
    expect(switcher).toContain("label: '画布'");
    expect(switcher).toContain("label: '属性'");
    expect(switcher).toContain("label: 'Timeline'");
  });

  it('keeps one ResourceActivityDock and routes portrait Assets through its owners', () => {
    const dock = source('src/renderer/shell/ResourceActivityDock.tsx');
    const assets = source('src/renderer/features/assets/AssetLibrary.tsx');
    const imports = source(
      'src/renderer/features/assets/AssetImportPanel.tsx',
    );

    expect(dock).toContain(
      "(activeActivity === 'shots' || activeActivity === 'assets')",
    );
    expect(dock).toContain('hideHeading={hideLocalActivityTabs}');
    expect(assets).toContain('searchQuery');
    expect(assets).toContain('filterAssetLibraryEntries');
    expect(assets).toContain('ASSET_LIBRARY_FILTERS');
    expect(assets).toContain('compact={hideHeading}');
    expect(assets).toContain('onImportFla={openFlaReview}');
    expect(assets).toContain('if (!hideHeading) onViewChange(\'details\');');
    expect(imports).toContain('onImportFla: () => void');
    expect(imports).toContain('asset-import-panel-compact');
    expect(imports).toContain("if (compact) setStatus('');");
    expect(assets).toContain('previousHideHeading');
    expect(assets).not.toContain('selected-asset-preview');
  });

  it('keeps filtering and counts in the existing selector/source-of-truth boundary', () => {
    const selectors = source(
      'src/renderer/stores/assetLibrarySelectors.ts',
    );
    const styles = source('src/renderer/styles.css');

    expect(selectors).toContain("export type AssetLibraryFilter = 'all'");
    expect(selectors).toContain('ASSET_LIBRARY_FILTERS');
    expect(selectors).toContain('assetLibraryFilterCounts');
    expect(selectors).toContain('filterAssetLibraryEntries');
    expect(selectors).not.toContain('editorProjectStore');
    expect(styles).toContain(
      ".resource-activity-dock[data-active-activity='assets']",
    );
    expect(styles).toContain('grid-template-columns: repeat(4, minmax(0, 1fr));');
    expect(styles).toContain('grid-template-columns: repeat(2, minmax(0, 1fr));');
    expect(styles).toContain('.asset-card-selected');
  });
});
