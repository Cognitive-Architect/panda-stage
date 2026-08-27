import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { RightInspectorEmptyState } from '../../src/renderer/shell/RightInspector';

function source(path: string): string {
  return readFileSync(path, 'utf8').replace(/\r\n/gu, '\n');
}

describe('Issue #346 portrait Properties empty state', () => {
  it('renders a focused, accessible guide with truthful capability previews', () => {
    const markup = renderToStaticMarkup(
      createElement(RightInspectorEmptyState),
    );
    const inspector = source('src/renderer/shell/RightInspector.tsx');

    expect(markup).toContain('data-testid="right-inspector-empty-state"');
    expect(markup).toContain('data-selection-state="empty"');
    expect(markup).toContain('选择一个对象开始编辑');
    expect(markup).toContain(
      '点击上方画布中的角色、图片或背景，即可调整位置、缩放、外观与图层顺序。',
    );
    for (const label of [
      '变换',
      '位置 / 缩放 / 旋转',
      '外观',
      '透明度 / 背景填充',
      '图层',
      '顺序 / 锁定 / 删除',
    ]) {
      expect(markup).toContain(label);
    }
    expect(inspector).toContain('SquareDashedMousePointer');
    expect(markup).not.toContain('滤镜');
    expect(markup).not.toContain('可见性');
    expect(markup).not.toContain('<button');
  });

  it('uses the authoritative empty selection only for the portrait branch and omits panels', () => {
    const inspector = source('src/renderer/shell/RightInspector.tsx');

    expect(inspector).toContain(
      "compact === true && !dialogueMode && selection.state === 'empty'",
    );
    expect(inspector).toContain(
      'const inspectorSelection = portraitEmptyState ? (',
    );
    expect(inspector).toContain(
      '{!portraitEmptyState && compactSections ? (',
    );
    expect(inspector).toContain(
      ") : !portraitEmptyState ? (",
    );
    expect(inspector).toContain('<LayerTransformPanel');
    expect(inspector).toContain('<LayerBackgroundControl');
    expect(inspector).toContain('<LayerOrderControls');
  });

  it('keeps the close action accessible and replaces the Unicode glyph with Lucide X', () => {
    const inspector = source('src/renderer/shell/RightInspector.tsx');
    const styles = source('src/renderer/styles.css');

    expect(inspector).toContain('import {');
    expect(inspector).toContain('X,');
    expect(inspector).toContain('aria-label="关闭属性"');
    expect(inspector).toContain('icon={X}');
    expect(inspector).not.toContain('>×</button>');
    expect(styles).toContain('right-inspector-selection-empty');
    expect(styles).toContain('var(--ui-color-surface-panel)');
    expect(styles).toContain('var(--ui-color-separator)');
    expect(styles).toContain('right-inspector-empty-state-capabilities');
  });
});
