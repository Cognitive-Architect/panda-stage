import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formatPositionDisplay } from '../../src/renderer/features/properties/LayerTransformPanel';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

describe('Issue #347 portrait Properties Transform refinement', () => {
  it('formats only the displayed position precision', () => {
    const x = 381.6803873429777;
    const y = 728.2042833607907;

    expect(formatPositionDisplay(x)).toBe('381.7');
    expect(formatPositionDisplay(y)).toBe('728.2');
    expect(formatPositionDisplay(400)).toBe('400');
    expect(formatPositionDisplay(-0)).toBe('0');
    expect(formatPositionDisplay(Number.NaN)).toBe('');
    expect(x).toBe(381.6803873429777);
    expect(y).toBe(728.2042833607907);
  });

  it('keeps compact formatting at the presentation seam and preserves editing owners', () => {
    const transform = source(
      'src/renderer/features/properties/LayerTransformPanel.tsx',
    );

    expect(transform).toContain(
      'x: compact ? formatPositionDisplay(layer.x) : String(layer.x)',
    );
    expect(transform).toContain(
      'y: compact ? formatPositionDisplay(layer.y) : String(layer.y)',
    );
    expect(transform).toContain("updateDraft('x', event.target.value)");
    expect(transform).toContain("updateDraft('y', event.target.value)");
    expect(transform).toContain(
      'updateScalePercentDraft(event.target.value)',
    );
    expect(transform).toContain(
      "updateDraft('rotationDeg', event.target.value)",
    );
    expect(transform).toContain('commitPendingDraft');
    expect(transform).toContain('layerStore.updateTransform');
    expect(transform).toContain('layerStore.toggleFlipX');
  });

  it('keeps one aligned portrait row grid and grouped editable steppers', () => {
    const transform = source(
      'src/renderer/features/properties/LayerTransformPanel.tsx',
    );
    const styles = source('src/renderer/styles.css');
    const issue347Styles = styles.slice(
      styles.lastIndexOf('/* Issue #347:'),
      styles.indexOf('/* Issue #368:'),
    );

    expect(transform).toContain(
      'layer-transform-control-row layer-transform-position-row',
    );
    expect(transform).toContain(
      'layer-transform-control-row layer-transform-stepper-row',
    );
    expect(issue347Styles).toContain(
      ".editor-shell[data-editor-device-mode='cloud-touch'][data-editor-shell-layout='portrait']",
    );
    expect(issue347Styles).toContain(
      'grid-template-columns: 44px repeat(2, minmax(0, 1fr));',
    );
    expect(issue347Styles).toContain(
      'grid-template-columns: 44px minmax(0, 1fr) 44px;',
    );
    expect(issue347Styles).toContain('gap: 0;');
    expect(issue347Styles).toContain('border-radius: var(--ui-radius-small);');
    expect(issue347Styles).toContain('input:focus-visible');
    expect(issue347Styles).not.toContain("data-editor-shell-layout='landscape'");
  });

  it('gives Transform actions a single primary and keeps the helper lightweight', () => {
    const transform = source(
      'src/renderer/features/properties/LayerTransformPanel.tsx',
    );
    const inspector = source('src/renderer/shell/RightInspector.tsx');
    const styles = source('src/renderer/styles.css');
    const issue347Styles = styles.slice(
      styles.lastIndexOf('/* Issue #347:'),
      styles.indexOf('/* Issue #368:'),
    );

    for (const icon of ['FlipHorizontal2', 'RotateCcw', 'Check', 'Info']) {
      expect(transform).toContain(icon);
    }
    expect(transform).toContain('layer-transform-toggle-action');
    expect(transform).toContain('layer-transform-reset-action');
    expect(transform).toContain('layer-transform-primary-action');
    expect(transform).toContain('aria-pressed={compact ? layer.flipX : undefined}');
    expect(transform).toContain(
      'X / Y 为对象视觉中心；离开输入框或点击“应用变换”即可保存。',
    );
    expect(issue347Styles).toContain(
      'background: var(--ui-color-selected-border);',
    );
    expect(issue347Styles).toContain('background: transparent;');
    expect(issue347Styles).toContain('layer-transform-guidance-inline');
    expect(inspector).toContain("asset?.kind === 'audio' ? '音频素材图层' : '图片素材图层'");
    expect(inspector).toContain("return { asset, typeLabel: '角色图层' }");
    expect(inspector).toContain('const selectionTypeLabel = compact');
    expect(inspector).toContain('getPortraitLayerTypeLabel(layerSummary.typeLabel)');
  });
});
