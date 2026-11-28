import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readOrderedStylesheetSource } from '../helpers/read-stylesheet-source';
import {
  TIMELINE_EXPANDED_MAX_HEIGHT,
  TIMELINE_EXPANDED_MIN_HEIGHT,
} from '../../src/renderer/features/timeline/timelineUiStore';
import { canvasViewportStore } from '../../src/renderer/stores/canvasViewportStore';

function source(path: string): string {
  return readFileSync(path, 'utf8').replace(/\r\n/gu, '\n');
}

describe('Issue #436 LM-004 — Canvas visual flattening + viewport mode relocation', () => {
  it('flattens the outer .canvas-workspace chrome (no panel border / background / padding)', () => {
    const styles = readOrderedStylesheetSource();
    const mainBlock = styles.match(
      /^\.canvas-workspace\s*\{[\s\S]*?\n\}/um,
    )?.[0] ?? '';

    // The flattened state is: no 1px solid border, no non-zero border-radius,
    // no rgb() background, and padding is 0.
    expect(mainBlock).not.toMatch(/\bborder:\s*1px\s+solid\b/u);
    expect(mainBlock).not.toMatch(/\bborder-radius:\s*(?!0\b)\d+/u);
    expect(mainBlock).not.toMatch(/\bbackground:\s*rgb\(/u);
    expect(mainBlock).toMatch(/\bpadding:\s*0\b/u);
    expect(styles).toContain('Issue #436 LM-004');
  });

  it('flattens the inner .project-canvas panel chrome (no border / background / 1180px cap)', () => {
    const styles = readOrderedStylesheetSource();
    const mainBlock = styles.match(
      /^\.project-canvas\s*\{[\s\S]*?\n\}/um,
    )?.[0] ?? '';

    expect(mainBlock).not.toMatch(/\bborder:\s*1px\s+solid\b/u);
    expect(mainBlock).not.toMatch(/\bborder-radius:\s*(?!0\b)\d+/u);
    expect(mainBlock).not.toMatch(/\bbackground:\s*rgb\(/u);
    expect(mainBlock).not.toMatch(/max-width:\s*1180px/u);
    expect(mainBlock).toMatch(/\bpadding:\s*0\b/u);
  });

  it('keeps the functional .canvas-viewport, .canvas-viewport-content, .canvas-logical-stage layers intact', () => {
    const styles = readOrderedStylesheetSource();

    // The viewport, content wrapper, and logical stage must all still be
    // defined (fit calc, scroll, drop, transform, hit test).
    expect(styles).toMatch(/\.canvas-viewport\s*\{[\s\S]*?overflow/u);
    expect(styles).toMatch(/\.canvas-viewport-content\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0;/u);
    expect(styles).toMatch(
      /\.canvas-logical-stage\s*\{[\s\S]*?transform-origin/u,
    );

  });

  it('keeps the two viewport modes and their feedback on the canvas', () => {
    const toolbar = source('src/renderer/features/canvas/CanvasToolbar.tsx');
    const stage = source('src/renderer/features/canvas/CanvasStage.tsx');
    const tools = source('src/renderer/shell/ProjectToolsDrawer.tsx');
    const styles = readOrderedStylesheetSource();
    expect(toolbar).toContain('canvas-mode-fit');
    expect(toolbar).toContain('canvas-mode-actual');
    expect(toolbar).toContain('canvas-mode-feedback');
    expect(toolbar).toContain('canvas-pointer-coordinate');
    expect(stage).toContain('onViewModeChange={canvasViewportStore.setMode}');
    expect(stage).toContain('canvasViewportStore.subscribe');
    expect(stage).toContain('canvasViewportStore.getSnapshot');
    expect(tools).not.toContain('project-tools-view-mode-card');
    expect(styles).not.toContain('.project-tools-view-mode-segmented');
  });
  it('preserves the R1-R3 contracts (no Timeline geometry change, single right rail)', () => {
    const styles = readOrderedStylesheetSource();
    const timeline = source(
      'src/renderer/features/timeline/timelineUiStore.ts',
    );
    const right = source('src/renderer/shell/RightWorkspace.tsx');

    // R3 Timeline geometry: MIN/MAX (162/324) untouched.
    expect(TIMELINE_EXPANDED_MIN_HEIGHT).toBe(162);
    expect(TIMELINE_EXPANDED_MAX_HEIGHT).toBe(324);
    // The source still derives MAX as 2×MIN, so the relationship stays
    // auditable.
    expect(timeline).toMatch(
      /TIMELINE_EXPANDED_MAX_HEIGHT\s*=\s*TIMELINE_EXPANDED_MIN_HEIGHT\s*\*\s*2\b/u,
    );
    // The R3 hard cap on the live resize path must still be wired.
    expect(styles).toContain('Issue #432 R3');

    // R1-R3 right rail: only 字幕 / 属性 / 工具 activities.
    expect(right).toContain("{ id: 'subtitles', label: '字幕'");
    expect(right).toContain("{ id: 'properties', label: '属性'");
    expect(right).toContain("{ id: 'tools', label: '工具'");
    expect(right.match(/className="right-workspace-surface"/gu)).toHaveLength(
      1,
    );
  });

  it('drives the two mode controls through the live canvasViewportStore singleton', () => {
    const snapshot = canvasViewportStore.getSnapshot();
    expect(snapshot.mode).toBe('fit');
    canvasViewportStore.setMode('actual');
    expect(canvasViewportStore.getSnapshot().mode).toBe('actual');
    canvasViewportStore.reset();
    expect(canvasViewportStore.getSnapshot().mode).toBe('fit');
  });
});
