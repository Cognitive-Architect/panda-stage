import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
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
    const styles = source('src/renderer/styles.css');
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
    const styles = source('src/renderer/styles.css');
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
    const styles = source('src/renderer/styles.css');

    // The viewport, content wrapper, and logical stage must all still be
    // defined (fit calc, scroll, drop, transform, hit test).
    expect(styles).toMatch(/\.canvas-viewport\s*\{[\s\S]*?overflow/u);
    expect(styles).toMatch(/\.canvas-viewport-content\s*\{[\s\S]*?min-height/u);
    expect(styles).toMatch(
      /\.canvas-logical-stage\s*\{[\s\S]*?transform-origin/u,
    );
    expect(styles).toMatch(
      /\.canvas-logical-stage\s*\{[\s\S]*?width:\s*1920px/u,
    );
    expect(styles).toMatch(
      /\.canvas-logical-stage\s*\{[\s\S]*?height:\s*1080px/u,
    );
  });

  it('exposes the three viewport mode controls inside the right-side 工具 surface', () => {
    const tools = source('src/renderer/shell/ProjectToolsDrawer.tsx');
    const styles = source('src/renderer/styles.css');

    expect(tools).toContain('project-tools-view-mode-card');
    expect(tools).toContain('project-tools-view-mode-heading');
    expect(tools).toContain('project-tools-view-mode-segmented');
    expect(tools).toContain('画布显示');
    // The three mode testids live in the option table; the JSX consumes
    // them through `data-testid={option.testId}`.
    expect(tools).toContain("testId: 'canvas-mode-fit'");
    expect(tools).toContain("testId: 'canvas-mode-half'");
    expect(tools).toContain("testId: 'canvas-mode-actual'");
    expect(tools).toContain('data-testid={option.testId}');
    expect(tools).toContain('适应窗口');
    expect(tools).toContain('50%');
    expect(tools).toContain('实际尺寸');
    expect(tools).toMatch(
      /canvasViewportStore\.setMode\(\s*option\.mode\s*\)/u,
    );
    expect(styles).toMatch(
      /\.project-tools-view-mode-segmented\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3/u,
    );
  });

  it('keeps canvasViewportStore as the single source of truth for viewport mode', () => {
    const tools = source('src/renderer/shell/ProjectToolsDrawer.tsx');
    const stage = source('src/renderer/features/canvas/CanvasStage.tsx');
    const viewport = source('src/renderer/features/canvas/CanvasViewport.tsx');
    const store = source('src/renderer/stores/canvasViewportStore.ts');

    // No second viewport state owner should have been introduced.
    expect(tools).not.toMatch(/setViewportMode|useState\([\s\S]*?['"]fit['"]/u);
    expect(tools).not.toMatch(/useState<CanvasViewportMode/u);
    expect(stage).not.toMatch(/useState<CanvasViewportMode/u);
    expect(viewport).not.toMatch(/useState<CanvasViewportMode/u);

    // The existing store class is the only owner of mode and is
    // consumed through its singleton export.
    expect(store).toContain('class CanvasViewportStore');
    expect(store).toContain("mode: 'fit'");
    expect(store).toContain('setMode(mode: CanvasViewportMode)');
    // The Tools section is now the only writer of the mode.
    expect(tools).toMatch(
      /canvasViewportStore\.setMode\(\s*option\.mode\s*\)/u,
    );
    // CanvasStage only reads the snapshot (no setMode call after the
    // toolbar-mode relocation).
    expect(stage).not.toMatch(/canvasViewportStore\.setMode\b/u);
    expect(stage).toContain('canvasViewportStore.subscribe');
    expect(stage).toContain('canvasViewportStore.getSnapshot');
    // The CanvasViewport consumes `mode` from props to compute transform.
    expect(viewport).toContain('calculateViewportTransform(container, mode)');
    // The Tools section subscribes via useSyncExternalStore to the same
    // singleton — not a duplicate.
    expect(tools).toContain('canvasViewportStore.subscribe');
    expect(tools).toContain('canvasViewportStore.getSnapshot');
  });

  it('removes the three mode controls from the CanvasToolbar (feedback only)', () => {
    const toolbar = source('src/renderer/features/canvas/CanvasToolbar.tsx');
    const stage = source('src/renderer/features/canvas/CanvasStage.tsx');

    // Toolbar source must no longer ship the three mode buttons.
    expect(toolbar).not.toContain('canvas-mode-fit');
    expect(toolbar).not.toContain('canvas-mode-half');
    expect(toolbar).not.toContain('canvas-mode-actual');
    expect(toolbar).not.toMatch(/onModeChange\(['"]fit['"]\)/u);
    expect(toolbar).not.toMatch(/onModeChange\(['"]half['"]\)/u);
    expect(toolbar).not.toMatch(/onModeChange\(['"]actual['"]\)/u);

    // Toolbar keeps the feedback outputs.
    expect(toolbar).toContain('canvas-mode-feedback');
    expect(toolbar).toContain('canvas-pointer-coordinate');
    expect(toolbar).toContain('data-testid="canvas-toolbar-feedback"');

    // The Stage no longer forwards onModeChange (the toolbar no longer
    // owns a mode switch).
    expect(stage).not.toMatch(/onModeChange=/u);
  });

  it('renders Tools 画布显示 inside RightWorkspace (not a duplicate on the Canvas)', () => {
    const right = source('src/renderer/shell/RightWorkspace.tsx');
    const stage = source('src/renderer/features/canvas/CanvasStage.tsx');
    const toolbar = source('src/renderer/features/canvas/CanvasToolbar.tsx');

    expect(right).toContain("<ProjectToolsDrawer");
    // 'tools' is the default fallthrough after subtitles/properties, so
    // the source wires it through the ternary else branch.
    expect(right).toMatch(/:\s*\(\s*[\s\S]{0,200}<ProjectToolsDrawer/u);
    expect(stage).not.toContain('canvas-mode-fit');
    expect(toolbar).not.toContain('canvas-mode-fit');
  });

  it('preserves the R1-R3 contracts (no Timeline geometry change, single right rail)', () => {
    const styles = source('src/renderer/styles.css');
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

  it('drives the three mode controls through the live canvasViewportStore singleton', () => {
    const snapshot = canvasViewportStore.getSnapshot();
    expect(snapshot.mode).toBe('fit');
    canvasViewportStore.setMode('half');
    expect(canvasViewportStore.getSnapshot().mode).toBe('half');
    canvasViewportStore.setMode('actual');
    expect(canvasViewportStore.getSnapshot().mode).toBe('actual');
    canvasViewportStore.reset();
    expect(canvasViewportStore.getSnapshot().mode).toBe('fit');
  });
});
