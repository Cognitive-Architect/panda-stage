import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  formatScalePercent,
  parseScalePercentDraft,
  stepScalePercentDraft,
} from '../../src/renderer/features/properties/LayerTransformPanel';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

describe('Issue #338 portrait Properties refinement', () => {
  it('keeps scale editing in the existing domain range while presenting percentages', () => {
    expect(formatScalePercent(2)).toBe('200');
    expect(formatScalePercent(0.05)).toBe('5');
    expect(formatScalePercent(0.333333333333)).toBe('33.3333333333');
    expect(parseScalePercentDraft('200')).toBe('2');
    expect(stepScalePercentDraft('5', -1)).toBe('5');
    expect(stepScalePercentDraft('200', 1)).toBe('210');
    expect(stepScalePercentDraft('2000', 1)).toBe('2000');
    expect(stepScalePercentDraft('', 1)).toBeNull();
  });

  it('integrates the portrait close action and keeps lock/order ownership singular', () => {
    const inspector = source('src/renderer/shell/RightInspector.tsx');
    const transform = source(
      'src/renderer/features/properties/LayerTransformPanel.tsx',
    );

    expect(inspector).toContain('data-testid="inspector-inline-close"');
    expect(inspector).toContain('aria-label="关闭属性"');
    expect(inspector).toContain(
      '{!compact && !(landscapePresentation && dialogueMode) ? (',
    );
    expect(inspector).toContain(
      'showLockControl={!compact && !landscapePresentation}',
    );
    expect(inspector).toContain(
      'showLockControl={Boolean(compact) || landscapePresentation}',
    );
    expect(inspector.match(/<LayerTransformPanel/gu)).toHaveLength(1);
    expect(inspector.match(/<LayerOrderControls/gu)).toHaveLength(1);
    expect(transform).toContain('layerStore.updateTransform');
    expect(transform).toContain('layerStore.toggleFlipX');
    expect(transform).toContain('data-testid="layer-transform-scale"');
    expect(transform).toContain('data-testid="layer-transform-rotation"');
    expect(transform).not.toContain('setProject');
  });

  it('scopes the flattened hierarchy and touch controls to Cloud Touch portrait', () => {
    const styles = source('src/renderer/styles.css');
    const issue338Styles = styles.slice(
      styles.lastIndexOf('/* Issue #338:'),
      styles.indexOf('/* Issue #368:'),
    );

    expect(issue338Styles).toContain(
      ".editor-shell[data-editor-device-mode='cloud-touch'][data-editor-shell-layout='portrait']",
    );
    expect(issue338Styles).toContain('border: 0;');
    expect(issue338Styles).toContain('min-height: 44px;');
    expect(issue338Styles).toContain('.right-inspector-heading-close');
    expect(issue338Styles).toContain('.layer-transform-stepper');
    expect(issue338Styles).toContain("content: '›';");
    expect(issue338Styles).not.toContain("data-editor-shell-layout='landscape'");
  });
});
