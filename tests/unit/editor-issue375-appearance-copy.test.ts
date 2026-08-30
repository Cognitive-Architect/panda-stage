import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  getLandscapeBackgroundGuidance,
  type LayerBackgroundControlModel,
} from '../../src/renderer/features/properties/LayerBackgroundControl';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

function model(
  state: LayerBackgroundControlModel['state'],
  overrides: Partial<LayerBackgroundControlModel> = {},
): LayerBackgroundControlModel {
  return {
    state,
    canSet: state === 'available',
    canSelect: true,
    canClear: true,
    canFill: true,
    backgroundLayer: {
      id: 'background',
      name: 'Background',
      locked: false,
    } as LayerBackgroundControlModel['backgroundLayer'],
    message: 'implementation detail should not leak into landscape copy',
    ...overrides,
  };
}

describe('Issue #375 Cloud Touch landscape Appearance copy distillation', () => {
  it('silences normal available state while preserving contextual constrained copy', () => {
    expect(getLandscapeBackgroundGuidance(model('available'))).toBe('');
    expect(
      getLandscapeBackgroundGuidance(model('available'), '操作失败，请重试。'),
    ).toBe('操作失败，请重试。');

    expect(getLandscapeBackgroundGuidance(model('empty'))).toBe(
      '请先选择背景图层。',
    );
    expect(
      getLandscapeBackgroundGuidance(
        model('empty', { backgroundLayer: null }),
      ),
    ).toBe('请先选择图片对象。');
    expect(getLandscapeBackgroundGuidance(model('invalid'))).toBe(
      '当前选择不可用，请重新选择。',
    );
    expect(getLandscapeBackgroundGuidance(model('locked'))).toBe(
      '图层已锁定，解锁后可设为背景。',
    );
    expect(getLandscapeBackgroundGuidance(model('unsupported'))).toBe(
      '此对象不能设为背景，请选择图片对象。',
    );
    expect(
      getLandscapeBackgroundGuidance(
        model('background', {
          backgroundLayer: {
            id: 'background',
            name: 'Background',
            locked: true,
          } as LayerBackgroundControlModel['backgroundLayer'],
        }),
      ),
    ).toBe('当前背景已锁定，解锁后可编辑。');
    expect(
      getLandscapeBackgroundGuidance(
        model('background', {
          backgroundLayer: {
            id: 'background',
            name: 'Background',
            locked: true,
          } as LayerBackgroundControlModel['backgroundLayer'],
        }),
        '已选择当前背景，当前背景已锁定。',
      ),
    ).toBe('已选择当前背景，当前背景已锁定。');
  });

  it('removes redundant normal-state and implementation-oriented landscape copy', () => {
    const background = source(
      'src/renderer/features/properties/LayerBackgroundControl.tsx',
    );
    const start = background.indexOf(
      "compact && presentation === 'landscape' ? (",
    );
    const end = background.indexOf(') : compact ? (', start);
    const landscape = background.slice(start, end);

    expect(landscape).toContain('<h3>画布背景</h3>');
    expect(landscape).toContain('<span>当前背景</span>');
    for (const label of ['设为背景', '选择当前背景', '填充画布', '清除背景']) {
      expect(landscape).toContain(label);
    }
    for (const redundant of [
      '为当前镜头管理正式背景。',
      '为当前镜头选择或更换正式背景。',
      '直接图片图层',
      'Cover 填充几何',
    ]) {
      expect(landscape).not.toContain(redundant);
    }
    expect(landscape).toContain('landscapeGuidance ? (');
    expect(landscape).toContain('data-testid="layer-background-guidance"');
  });

  it('keeps the accepted action ownership and portrait copy path intact', () => {
    const background = source(
      'src/renderer/features/properties/LayerBackgroundControl.tsx',
    );

    expect(background).toContain('selectionStore.selectBackground()');
    expect(background).toContain('layerStore.setBackground(selectedLayerId)');
    expect(background).toContain('layerStore.clearBackground()');
    expect(background).toContain('layerStore.fillBackground()');
    expect(background).toContain('为当前镜头选择或更换正式背景。');
    expect(background).toContain('Cover 几何');
  });
});
