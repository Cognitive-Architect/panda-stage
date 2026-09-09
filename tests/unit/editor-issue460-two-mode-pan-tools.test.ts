import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  calculateViewportTransform,
  screenToStage,
  stageToScreen,
} from '../../src/domain';
import { calculateViewportPanScrollPosition } from '../../src/renderer/features/canvas/CanvasViewport';

function source(path: string): string {
  return readFileSync(path, 'utf8').replace(/\r\n/gu, '\n');
}

describe('Issue #460 two-mode Canvas and Tools workspace', () => {
  it('keeps only Fit and Actual Size without a hidden compatibility mode', () => {
    const geometry = source('src/domain/geometry/viewportTransform.ts');
    const tools = source('src/renderer/shell/ProjectToolsDrawer.tsx');
    const toolbar = source('src/renderer/features/canvas/CanvasToolbar.tsx');
    const styles = source('src/renderer/styles.css');

    expect(geometry).toContain("CanvasViewportMode = 'fit' | 'actual'");
    expect(geometry).not.toContain("'half'");
    expect(geometry).not.toContain('0.5');
    expect(tools.match(/testId: 'canvas-mode-/gu)).toHaveLength(2);
    expect(tools).toContain("testId: 'canvas-mode-fit'");
    expect(tools).toContain("testId: 'canvas-mode-actual'");
    expect(tools).not.toContain('canvas-mode-half');
    expect(tools).not.toContain('50%');
    expect(toolbar).not.toContain('50%');
    expect(styles).not.toContain('.canvas-viewport-half');
    expect(styles).toContain(
      'grid-template-columns: repeat(2, minmax(0, 1fr));',
    );
  });

  it('makes Tools a two-section surface without duplicating project navigation', () => {
    const tools = source('src/renderer/shell/ProjectToolsDrawer.tsx');

    expect(tools).toContain('<h2 id="project-tools-heading">');
    expect(tools).toContain(
      '<h3 id="project-tools-view-mode-heading">画布</h3>',
    );
    expect(tools).toContain(
      '<h3 id="project-tools-action-preset-heading">动作预设</h3>',
    );
    expect(tools).toContain('打开动作预设');
    expect(tools).not.toContain('ProjectRecoveryPanel');
    expect(tools).not.toContain('RecentProjectsPanel');
    expect(tools).not.toContain('编辑器工作区');
    expect(tools).not.toContain('画布显示');
    expect(tools).not.toContain('选择画布视口');
    expect(tools).not.toContain('兼容');
    expect(tools).not.toContain('当前对象');
    expect(tools.match(/data-testid="project-tools-action-presets"/gu)).toHaveLength(1);
  });

  it('pans the existing scroll position only through Actual Size pointer capture', () => {
    const start = {
      clientX: 500,
      clientY: 400,
      pointerId: 7,
      scrollLeft: 240,
      scrollTop: 110,
    };
    expect(
      calculateViewportPanScrollPosition(start, {
        clientX: 450,
        clientY: 350,
      }),
    ).toEqual({ left: 290, top: 160 });

    const viewport = source('src/renderer/features/canvas/CanvasViewport.tsx');
    const selectableLayer = source(
      'src/renderer/features/canvas/SelectableLayer.tsx',
    );
    expect(viewport).toContain("mode !== 'actual'");
    expect(viewport).toContain("event.button !== 0");
    expect(viewport).toContain("event.pointerType !== 'mouse'");
    expect(viewport).toContain("event.code !== 'Space'");
    expect(viewport).toContain('viewport.setPointerCapture(event.pointerId)');
    expect(viewport).toContain('viewport.scrollLeft = next.left');
    expect(viewport).toContain('viewport.scrollTop = next.top');
    expect(viewport).toContain('event.stopPropagation()');
    expect(viewport).toContain('data-pan-available');
    expect(viewport).toContain('data-pan-active');
    expect(viewport).not.toContain('editorProjectStore');
    expect(viewport).not.toContain('updateProject');
    expect(viewport).not.toContain('History');
    expect(selectableLayer).toContain('draggable={canTransform}');

    const fit = calculateViewportTransform({ width: 800, height: 600 }, 'fit');
    const actual = calculateViewportTransform(
      { width: 800, height: 600 },
      'actual',
    );
    expect(fit.scale).toBeCloseTo(5 / 12);
    expect(actual.scale).toBe(1);
    const point = { x: 640, y: 360 };
    expect(screenToStage(stageToScreen(point, actual), actual)).toEqual(point);
  });
});
