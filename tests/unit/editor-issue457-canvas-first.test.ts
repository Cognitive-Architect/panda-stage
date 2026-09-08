import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  calculateViewportTransform,
  screenToStage,
  stageToScreen,
} from '../../src/domain';

function source(path: string): string {
  return readFileSync(path, 'utf8').replace(/\r\n/gu, '\n');
}

describe('Issue #457 Canvas-first workspace contract', () => {
  const stage = source('src/renderer/features/canvas/CanvasStage.tsx');
  const viewport = source('src/renderer/features/canvas/CanvasViewport.tsx');
  const toolbar = source('src/renderer/features/canvas/CanvasToolbar.tsx');
  const styles = source('src/renderer/styles.css');

  it('mounts feedback inside the existing CanvasViewport seam', () => {
    expect(stage).toContain('viewportChrome=');
    expect(stage).toContain('<CanvasToolbar');
    expect(stage).not.toMatch(
      /<\/CanvasViewport>[\s\S]*?<CanvasToolbar/u,
    );
    expect(viewport).toContain('viewportChrome?: ReactNode');
    expect(viewport).toContain('{viewportChrome}');
    expect(viewport).toContain('new ResizeObserver(update)');
    expect(viewport).toContain('screenToStage(');
  });

  it('gives the reclaimed row to the viewport and makes chrome non-flow', () => {
    expect(styles).toMatch(
      /\.project-canvas\s*\{[\s\S]*?grid-template-rows:\s*minmax\(0, 1fr\);[\s\S]*?\n\}/u,
    );
    expect(styles).toMatch(
      /\.project-canvas\[data-with-heading='true'\]\s*\{[\s\S]*?grid-template-rows:\s*auto minmax\(0, 1fr\);/u,
    );
    expect(styles).toMatch(
      /\.canvas-viewport\s*\{[\s\S]*?height:\s*auto;[\s\S]*?min-height:\s*0;/u,
    );
    expect(styles).toMatch(
      /\.canvas-viewport-chrome\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?inset:\s*0;[\s\S]*?pointer-events:\s*none;/u,
    );
    expect(stage).toContain("data-with-heading={showHeading ? 'true' : 'false'}");
  });

  it('keeps feedback readable but quiet when there is no pointer', () => {
    expect(toolbar).toContain('canvas-viewport-chrome');
    expect(toolbar).toContain('hidden={!point}');
    expect(toolbar).not.toContain('将指针移入画布查看坐标');
    expect(styles).toMatch(
      /\.canvas-viewport-chrome\s*\{[\s\S]*?align-items:\s*flex-end;[\s\S]*?justify-content:\s*space-between;/u,
    );
    expect(styles).toMatch(
      /\.canvas-viewport-chrome output\[hidden\]\s*\{[\s\S]*?display:\s*none;/u,
    );
  });

  it('preserves the existing fit, half, actual, and pointer mapping contract', () => {
    const container = { width: 1280, height: 720 };
    const fit = calculateViewportTransform(container, 'fit');
    const half = calculateViewportTransform(container, 'half');
    const actual = calculateViewportTransform(container, 'actual');

    expect(fit.scale).toBeCloseTo(2 / 3);
    expect(half.scale).toBe(0.5);
    expect(actual.scale).toBe(1);
    expect(actual.contentWidth).toBe(1920);
    expect(actual.contentHeight).toBe(1080);

    const point = { x: 640, y: 360 };
    expect(screenToStage(stageToScreen(point, fit), fit)).toMatchObject(point);
    expect(screenToStage(stageToScreen(point, half), half)).toMatchObject(point);
    expect(screenToStage(stageToScreen(point, actual), actual)).toMatchObject(point);
  });
});
