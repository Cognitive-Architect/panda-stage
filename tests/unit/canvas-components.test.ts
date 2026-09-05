import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { calculateViewportTransform } from '../../src/domain';
import { CanvasToolbar } from '../../src/renderer/features/canvas/CanvasToolbar';

describe('canvas components', () => {
  it('renders fit-mode feedback and pointer coordinates', () => {
    const markup = renderToStaticMarkup(
      createElement(CanvasToolbar, {
        mode: 'fit',
        point: { x: 960, y: 540 },
        transform: calculateViewportTransform(
          { width: 800, height: 600 },
          'fit',
        ),
      }),
    );

    // Issue #436 LM-004: the toolbar is now feedback-only.
    // Mode controls live in the right-side 工具 surface.
    expect(markup).toContain('data-testid="canvas-toolbar-feedback"');
    expect(markup).toContain('data-testid="canvas-mode-feedback"');
    expect(markup).toContain('data-testid="canvas-pointer-coordinate"');
    expect(markup).toContain('适应窗口');
    expect(markup).toContain('41.7%');
    expect(markup).toContain('x 960.0 · y 540.0');
    // No mode controls should live in the toolbar anymore.
    expect(markup).not.toContain('canvas-mode-fit');
    expect(markup).not.toContain('canvas-mode-half');
    expect(markup).not.toContain('canvas-mode-actual');
  });

  it('explains that actual size is 1:1 and scrollable', () => {
    const markup = renderToStaticMarkup(
      createElement(CanvasToolbar, {
        mode: 'actual',
        point: null,
        transform: calculateViewportTransform(
          { width: 800, height: 600 },
          'actual',
        ),
      }),
    );

    expect(markup).toContain('1:1 像素 · 可滚动查看');
    expect(markup).toContain('100.0%');
    expect(markup).toContain('将指针移入画布查看坐标');
  });
});
