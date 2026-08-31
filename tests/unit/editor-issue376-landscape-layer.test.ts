import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  formatLayerOrderPosition,
  getLayerDeleteDescription,
  getLayerDeleteSuccessStatus,
  getLayerLockAriaLabel,
  getLayerLockLabel,
  getLayerOrderSuccessStatus,
  isLayerOrderActionDisabled,
  shouldDeleteSelectedLayer,
} from '../../src/renderer/features/properties/LayerOrderControls';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

describe('Issue #376 Cloud Touch landscape Layer hierarchy', () => {
  it('keeps the stable four-action grid and first/last boundaries', () => {
    expect(formatLayerOrderPosition(1, 4)).toBe('2 / 4');

    for (const action of ['forward', 'front'] as const) {
      expect(isLayerOrderActionDisabled(action, 0, 4, false)).toBe(false);
      expect(isLayerOrderActionDisabled(action, 3, 4, false)).toBe(true);
    }
    for (const action of ['backward', 'back'] as const) {
      expect(isLayerOrderActionDisabled(action, 0, 4, false)).toBe(true);
      expect(isLayerOrderActionDisabled(action, 3, 4, false)).toBe(false);
    }
    for (const action of [
      'forward',
      'backward',
      'front',
      'back',
    ] as const) {
      expect(isLayerOrderActionDisabled(action, 1, 4, false)).toBe(false);
      expect(isLayerOrderActionDisabled(action, 1, 4, true)).toBe(true);
      expect(isLayerOrderActionDisabled(action, -1, 4, false)).toBe(true);
    }
  });

  it('distills landscape lock, delete, and transient success copy without changing portrait copy', () => {
    expect(getLayerLockLabel(false, 'landscape')).toBe('未锁定');
    expect(getLayerLockLabel(true, 'landscape')).toBe('图层已锁定');
    expect(getLayerLockAriaLabel(false, 'landscape')).toBe('图层未锁定');
    expect(getLayerLockAriaLabel(true, 'landscape')).toBe('图层已锁定');
    expect(getLayerDeleteDescription('landscape')).toBe('从当前镜头中移除');
    expect(getLayerOrderSuccessStatus('landscape')).toBe('已调整层级。');
    expect(getLayerDeleteSuccessStatus('封面图片', 'landscape')).toBe(
      '已删除图层。',
    );

    expect(getLayerLockLabel(false)).toBe('锁定图层');
    expect(getLayerDeleteDescription()).toBe(
      '此操作会从当前镜头中移除此图层。',
    );
    expect(getLayerOrderSuccessStatus()).toBe(
      '图层顺序已写入项目并同步画布。',
    );
  });

  it('keeps the landscape hierarchy, neutral actions, protected branch, and action owners', () => {
    const order = source(
      'src/renderer/features/properties/LayerOrderControls.tsx',
    );
    const styles = source('src/renderer/styles.css');
    const issue376 = styles.slice(styles.lastIndexOf('/* Issue #376:'));

    expect(order).toContain("presentation?: 'portrait' | 'landscape'");
    expect(order).toContain('data-presentation={presentation}');
    expect(order).toContain('层级顺序');
    expect(order).toContain('图层状态');
    expect(order).toContain('危险操作');
    for (const action of [
      "reorder('forward')",
      "reorder('backward')",
      "reorder('front')",
      "reorder('back')",
    ]) {
      expect(order).toContain(action);
    }
    expect(order).toContain('role="switch"');
    expect(order).toContain('aria-checked={Boolean(layer?.locked)}');
    expect(order).toContain('layerStore.reorder');
    expect(order).toContain('layerStore.setLocked');
    expect(order).toContain('layerStore.deleteLayer');
    expect(order).toContain('selectionStore.clear');
    expect(order).toContain('layer-order-protected-state');
    expect(order).toContain("presentation === 'landscape' ? null");
    expect(order).toContain("if (presentation === 'landscape') setStatus('');");

    expect(issue376).toContain(
      ".editor-shell[data-editor-device-mode='cloud-touch'][data-editor-shell-layout='landscape']",
    );
    expect(issue376).toContain(".layer-order-controls[data-compact='true']");
    expect(issue376).toContain(
      'grid-template-columns: repeat(2, minmax(0, 1fr));',
    );
    expect(issue376).toContain('min-height: 48px;');
    expect(issue376).toContain('min-height: 56px;');
    expect(issue376).toContain('border-top: 1px solid var(--ui-color-separator);');
    expect(issue376).toContain('background: var(--ui-color-surface-overlay);');
    expect(issue376).toContain('.layer-order-danger-zone');
    expect(issue376).toContain('.layer-order-protected-state');
    expect(issue376).not.toContain("data-editor-shell-layout='portrait'");
    expect(issue376).not.toContain(
      'background: var(--ui-color-selected-border);',
    );
  });

  it('preserves Delete/Backspace safety boundaries', () => {
    const selectedLayerId = 'layer-1';
    expect(
      shouldDeleteSelectedLayer(
        { key: 'Delete', target: null, defaultPrevented: false },
        selectedLayerId,
      ),
    ).toBe(true);
    expect(
      shouldDeleteSelectedLayer(
        { key: 'Backspace', target: null, defaultPrevented: false },
        selectedLayerId,
        true,
      ),
    ).toBe(false);
    expect(
      shouldDeleteSelectedLayer(
        { key: 'Delete', target: null, defaultPrevented: true },
        selectedLayerId,
      ),
    ).toBe(false);
  });
});
