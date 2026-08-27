import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  formatLayerOrderPosition,
} from '../../src/renderer/features/properties/LayerOrderControls';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

describe('Issue #349 portrait Properties Layer refinement', () => {
  it('formats only a valid normal-layer position without creating state', () => {
    expect(formatLayerOrderPosition(1, 4)).toBe('2 / 4');
    expect(formatLayerOrderPosition(0, 1)).toBe('1 / 1');
    expect(formatLayerOrderPosition(-1, 4)).toBe('');
    expect(formatLayerOrderPosition(1, 4, true)).toBe('');
    expect(formatLayerOrderPosition(1, 0)).toBe('');
  });

  it('keeps the authoritative actions while exposing compact hierarchy and accessibility', () => {
    const order = source(
      'src/renderer/features/properties/LayerOrderControls.tsx',
    );
    const sections = source(
      'src/renderer/shell/PortraitPropertiesSections.tsx',
    );

    expect(order).toContain('compact?: boolean');
    expect(order).toContain('data-compact="true"');
    for (const action of ['forward', 'backward', 'front', 'back']) {
      expect(order).toContain(`reorder('${action}')`);
    }
    for (const icon of [
      'ArrowUp',
      'ArrowDown',
      'BringToFront',
      'SendToBack',
      'Lock',
      'Unlock',
      'ShieldCheck',
      'Trash2',
    ]) {
      expect(order).toContain(icon);
    }
    expect(order).toContain('role="switch"');
    expect(order).toContain('aria-checked={Boolean(layer?.locked)}');
    expect(order).toContain('layerStore.setLocked');
    expect(order).toContain('layerStore.deleteLayer');
    expect(order).toContain('selectionStore.clear');
    expect(order).toContain('layer-order-position');
    expect(order).toContain('layer-order-protected-state');
    expect(order).toContain('layer-order-danger-zone');
    expect(sections).toContain('<LayerOrderControls');
    expect(sections).toContain('compact\n          showLockControl');
  });

  it('scopes the hierarchy redesign to compact Cloud Touch portrait', () => {
    const styles = source('src/renderer/styles.css');
    const issue349Styles = styles.slice(styles.lastIndexOf('/* Issue #349:'));

    expect(issue349Styles).toContain(
      ".editor-shell[data-editor-device-mode='cloud-touch'][data-editor-shell-layout='portrait']",
    );
    expect(issue349Styles).toContain(
      ".layer-order-controls[data-compact='true']",
    );
    expect(issue349Styles).toContain(
      'grid-template-columns: repeat(2, minmax(0, 1fr));',
    );
    expect(issue349Styles).toContain('layer-order-protected-state');
    expect(issue349Styles).toContain('layer-order-danger-zone');
    expect(issue349Styles).toContain('min-height: 44px;');
    expect(issue349Styles).not.toContain("data-editor-shell-layout='landscape'");
  });
});
