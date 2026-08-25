import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

describe('Issue #329 portrait Properties first pass', () => {
  it('uses the product-facing portrait workspace label without changing the other tabs', () => {
    const switcher = source(
      'src/renderer/shell/AdaptiveWorkspaceSwitcher.tsx',
    );

    expect(switcher).toContain("{ value: 'properties', label: '属性' }");
    expect(switcher).toContain("{ value: 'canvas', label: '画布' }");
    expect(switcher).toContain("{ value: 'assets', label: '素材' }");
    expect(switcher).toContain("{ value: 'timeline', label: 'Timeline' }");
    expect(switcher).not.toContain("label: 'Properties'");
  });

  it('keeps selection, thumbnail projection, and existing panel owners single', () => {
    const inspector = source('src/renderer/shell/RightInspector.tsx');

    expect(inspector).toContain('selectionStore');
    expect(inspector).toContain('getRightInspectorLayerSummary');
    expect(inspector).toContain('readThumbnail');
    expect(inspector).toContain('thumbnailStateFromResponse');
    expect(inspector).toContain('data-testid="right-inspector-selection-summary"');
    expect(inspector.match(/<LayerTransformPanel/gu)).toHaveLength(1);
    expect(inspector.match(/<LayerBackgroundControl/gu)).toHaveLength(1);
    expect(inspector.match(/<LayerOrderControls/gu)).toHaveLength(1);
    expect(inspector).not.toContain('updateProject');
    expect(inspector).not.toContain('history');
  });

  it('makes transform primary and keeps lower-frequency controls collapsed', () => {
    const inspector = source('src/renderer/shell/RightInspector.tsx');
    const transform = source(
      'src/renderer/features/properties/LayerTransformPanel.tsx',
    );
    const styles = source('src/renderer/styles.css');

    expect(inspector).toContain('<summary>变换</summary>');
    expect(inspector).toContain('<summary>外观</summary>');
    expect(inspector).toContain('<summary>图层</summary>');
    expect(inspector).toContain('right-inspector-compact-sections');
    expect(inspector).toContain('compact={compact}');
    expect(transform).toContain('compact?: boolean');
    expect(transform).toContain('data-compact={String(compact)}');
    expect(styles).toContain('right-inspector-compact-sections');
    expect(styles).toContain('grid-template-columns: repeat(2, minmax(0, 1fr));');
    expect(styles).toContain('overflow: visible;');
  });

  it('removes only portrait Assets title/close chrome while retaining the owner path', () => {
    const dock = source('src/renderer/shell/ResourceActivityDock.tsx');
    const styles = source('src/renderer/styles.css');

    expect(dock).toContain('hidePortraitAssetsChrome');
    expect(dock).toContain('hidePortraitAssetsChrome ? null :');
    expect(dock).toContain('id="resource-activity-heading"');
    expect(dock).toContain('setAssetReviewCloseRequest');
    expect(styles).toContain(
      ".resource-activity-dock[data-active-activity='assets']",
    );
    expect(styles).toContain(
      ".resource-activity-dock[data-active-activity='assets']",
    );
  });

  it('does not invent staged Apply/Cancel or project-state ownership', () => {
    const inspector = source('src/renderer/shell/RightInspector.tsx');
    const transform = source(
      'src/renderer/features/properties/LayerTransformPanel.tsx',
    );

    expect(inspector).not.toContain('取消');
    expect(inspector).not.toContain('应用');
    expect(transform).toContain('layerStore.updateTransform');
    expect(transform).toContain('commitPendingDraft');
  });
});
