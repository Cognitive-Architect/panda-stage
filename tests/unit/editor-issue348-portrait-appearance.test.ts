import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  LayerOpacityControl,
  formatOpacityPercent,
} from '../../src/renderer/features/properties/LayerBackgroundControl';
import type { LayerTransformController } from '../../src/renderer/features/properties/LayerTransformPanel';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

describe('Issue #348 portrait Properties Appearance refinement', () => {
  it('formats the authoritative opacity value as a compact percentage', () => {
    expect(formatOpacityPercent(1)).toBe('100');
    expect(formatOpacityPercent(0.5)).toBe('50');
    expect(formatOpacityPercent(0.333)).toBe('33.3');
    expect(formatOpacityPercent(0)).toBe('0');
    expect(formatOpacityPercent(Number.NaN)).toBe('');
  });

  it('renders the range and percentage without introducing appearance state', () => {
    const controller = {
      draft: {
        x: '1',
        y: '2',
        scale: '1',
        rotationDeg: '0',
        opacity: '1',
      },
      layer: { locked: false },
      updateOpacityPercentDraft: () => undefined,
    } as unknown as LayerTransformController;
    const markup = renderOpacity(controller);

    expect(markup).toContain('data-testid="layer-opacity-control"');
    expect(markup).toContain('data-testid="layer-opacity-range"');
    expect(markup).toContain('type="range"');
    expect(markup).toContain('min="0"');
    expect(markup).toContain('max="100"');
    expect(markup).toContain('100%');
    expect(markup).toContain('0%');
    expect(markup).toContain('50%');
  });

  it('removes only portrait opacity presentation from Transform and shares its commit seam', () => {
    const transform = source(
      'src/renderer/features/properties/LayerTransformPanel.tsx',
    );
    const background = source(
      'src/renderer/features/properties/LayerBackgroundControl.tsx',
    );
    const sections = source(
      'src/renderer/shell/PortraitPropertiesSections.tsx',
    );

    expect(transform).not.toContain('layer-transform-appearance-field');
    expect(transform).not.toContain('外观 · 不透明度');
    expect(transform).toContain('updateOpacityPercentDraft');
    expect(transform).toContain('commitBoundaryRef');
    expect(transform).toContain('layerStore.updateTransform');
    expect(background).toContain('LayerOpacityControl');
    expect(background).toContain('对象外观');
    expect(background).toContain('画布背景');
    expect(background).toContain('为当前镜头选择或更换正式背景。');
    for (const icon of ['Droplet', 'Image', 'ImagePlus', 'CircleOff', 'Scan']) {
      expect(background).toContain(icon);
    }
    expect(sections).toContain('controller={transformController}');
    expect(sections).toContain('compact\n          transformController');
  });

  it('scopes appearance hierarchy and enabled primary styling to portrait Cloud Touch', () => {
    const styles = source('src/renderer/styles.css');
    const issue348Styles = styles.slice(
      styles.indexOf('/* Issue #348:'),
      styles.indexOf('/* Issue #368:'),
    );

    expect(issue348Styles).toContain(
      ".editor-shell[data-editor-device-mode='cloud-touch'][data-editor-shell-layout='portrait']",
    );
    expect(issue348Styles).toContain('layer-appearance-object-group');
    expect(issue348Styles).toContain('layer-canvas-background-group');
    expect(issue348Styles).toContain(
      '.layer-background-primary:not(:disabled)',
    );
    expect(issue348Styles).toContain('button:disabled');
    expect(issue348Styles).not.toContain("data-editor-shell-layout='landscape'");
  });
});

function renderOpacity(controller: LayerTransformController): string {
  // Keep the test independent from a mounted editor/store while exercising the
  // same production presentation component used by the compact inspector.
  return renderToStaticMarkup(
    createElement(LayerOpacityControl, { controller }),
  );
}
