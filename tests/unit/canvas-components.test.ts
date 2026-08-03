import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { calculateViewportTransform } from '../../src/domain';
import { CanvasToolbar } from '../../src/renderer/features/canvas/CanvasToolbar';

describe('canvas components', () => {
  it('renders explicit fit feedback, logical size, and pointer coordinates', () => {
    const markup = renderToStaticMarkup(
      createElement(CanvasToolbar, {
        mode: 'fit',
        point: { x: 960, y: 540 },
        transform: calculateViewportTransform(
          { width: 800, height: 600 },
          'fit',
        ),
        onModeChange: () => undefined,
      }),
    );

    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('适应窗口');
    expect(markup).toContain('41.7%');
    expect(markup).toContain('逻辑画布 1920 × 1080');
    expect(markup).toContain('x 960.0 · y 540.0');
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
        onModeChange: () => undefined,
      }),
    );

    expect(markup).toContain('实际尺寸');
    expect(markup).toContain('1:1 像素 · 可滚动查看');
    expect(markup).toContain('100.0%');
  });
});
