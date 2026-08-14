import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildProject } from '../../tests/unit/domain/testProject';
import { editorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { shotStore } from '../../src/renderer/stores/shotStore';
import {
  computePixelsPerMs,
  generateRulerTicks,
  pxToTime,
} from '../../src/renderer/features/timeline/timeGeometry';
import { timelineUiStore } from '../../src/renderer/features/timeline/timelineUiStore';

// Issue #199 behavioral contract.
//
// The human failure (FUNC-002) is: clicking / dragging the ruler never moves
// the playhead, the timecode stays at 00:00.000, and no ruler ticks render.
// The root cause is that the ruler width was measured only once on mount; when
// the ruler mounts *after* the dock (the active shot is selected once the
// project opens, or after a collapse→expand), `viewportWidth` stays frozen at
// 0. That makes `pixelsPerMs = 0`, which cascades to `pxToTime() = 0`,
// `generateRulerTicks() = []` and `timeToPx() = 0` — exactly the three
// symptoms. This test proves the seek pipeline behaves correctly *once a real
// width is measured* (the fixed state) and reproduces the stuck-at-0 signature
// when it is not, using the real geometry + store code paths.

const SHOT_DURATION = 4321;

/** Map a click at track-fraction `f` to a real time, given a measured width. */
function clickToTime(fraction: number, measuredWidth: number, durationMs: number, zoom = 1): number {
  const pixelsPerMs = computePixelsPerMs(measuredWidth, durationMs, zoom);
  const trackWidth = durationMs * pixelsPerMs;
  const px = fraction * trackWidth;
  return pxToTime(px, pixelsPerMs);
}

describe('timeline seek pipeline (Issue #199 behavior)', () => {
  it('renders no ticks and seeks to 0 when the ruler width was never measured', () => {
    // The un-measured / stuck-at-0 state: viewportWidth === 0.
    const pixelsPerMs = computePixelsPerMs(0, SHOT_DURATION);
    expect(pixelsPerMs).toBe(0);
    expect(generateRulerTicks(SHOT_DURATION, pixelsPerMs)).toHaveLength(0);

    // Clicking anywhere on the ruler computes time 0 → store no-ops.
    const timeAtMiddle = clickToTime(0.5, 0, SHOT_DURATION);
    expect(timeAtMiddle).toBe(0);

    const project = buildProject();
    const shot = project.shots[0]!;
    shot.durationMs = SHOT_DURATION;
    editorProjectStore.open('D:/issue199-unit', project);
    shotStore.select(shot.id);

    timelineUiStore.seek(timeAtMiddle, SHOT_DURATION);
    expect(timelineUiStore.getSnapshot().currentTimeMs).toBe(0);
  });

  it('moves the playhead within [0, duration] once the ruler width is measured', () => {
    const project = buildProject();
    const shot = project.shots[0]!;
    shot.durationMs = SHOT_DURATION;
    editorProjectStore.open('D:/issue199-unit', project);
    shotStore.select(shot.id);

    // A realistic measured viewport width (matches a laid-out ruler).
    const measuredWidth = 1000;
    const pixelsPerMs = computePixelsPerMs(measuredWidth, SHOT_DURATION);
    expect(pixelsPerMs).toBeGreaterThan(0);
    expect(generateRulerTicks(SHOT_DURATION, pixelsPerMs).length).toBeGreaterThan(0);

    // Clicking at 50% of the track maps to ~50% of the duration.
    const mid = clickToTime(0.5, measuredWidth, SHOT_DURATION);
    timelineUiStore.seek(mid, SHOT_DURATION);
    const afterMid = timelineUiStore.getSnapshot().currentTimeMs;
    expect(afterMid).toBeGreaterThan(0);
    expect(afterMid).toBeLessThanOrEqual(SHOT_DURATION);

    // Ordered positions: 10% < 50% < 90% of the duration.
    const t10 = clickToTime(0.1, measuredWidth, SHOT_DURATION);
    const t50 = clickToTime(0.5, measuredWidth, SHOT_DURATION);
    const t90 = clickToTime(0.9, measuredWidth, SHOT_DURATION);
    timelineUiStore.seek(t10, SHOT_DURATION);
    const after10 = timelineUiStore.getSnapshot().currentTimeMs;
    timelineUiStore.seek(t50, SHOT_DURATION);
    const after50 = timelineUiStore.getSnapshot().currentTimeMs;
    timelineUiStore.seek(t90, SHOT_DURATION);
    const after90 = timelineUiStore.getSnapshot().currentTimeMs;
    expect(after10).toBeGreaterThan(0);
    expect(after50).toBeGreaterThan(after10);
    expect(after90).toBeGreaterThan(after50);
    expect(after90).toBeLessThanOrEqual(SHOT_DURATION);

    // The click→time mapping is zoom-independent (track width scales with zoom).
    const midZoom8 = clickToTime(0.5, measuredWidth, SHOT_DURATION, 8);
    timelineUiStore.seek(midZoom8, SHOT_DURATION);
    const afterZoom8 = timelineUiStore.getSnapshot().currentTimeMs;
    expect(afterZoom8).toBeGreaterThan(0);
    expect(afterZoom8).toBeLessThanOrEqual(SHOT_DURATION);
  });

  it('never seeks past the shot end and never touches the project (UI-only)', () => {
    const project = buildProject();
    const shot = project.shots[0]!;
    shot.durationMs = SHOT_DURATION;
    editorProjectStore.open('D:/issue199-unit', project);
    shotStore.select(shot.id);

    const before = editorProjectStore.getSnapshot();
    const measuredWidth = 1000;
    const over = clickToTime(1.5, measuredWidth, SHOT_DURATION);
    timelineUiStore.seek(over, SHOT_DURATION);
    expect(timelineUiStore.getSnapshot().currentTimeMs).toBeLessThanOrEqual(SHOT_DURATION);

    // Seeking leaves the project snapshot, dirty flag and History untouched.
    expect(editorProjectStore.getSnapshot()).toBe(before);
    expect(editorProjectStore.getSnapshot()?.dirty).toBeFalsy();
  });
});

describe('Issue #199 real Electron gate coverage (verify-issue199-timeline-seek.cjs)', () => {
  const gate = readFileSync(
    `${__dirname}/../../scripts/verify-issue199-timeline-seek.cjs`,
    'utf8',
  );

  it('asserts ticks render (the measurement-succeeded proof) and real pointer seek', () => {
    expect(gate).toContain('timeline-ruler-track');
    expect(gate).toContain('timeline-tick');
    expect(gate).toContain('assertTicksPresent');
    expect(gate).toContain('viewportWidth stuck at 0');
    expect(gate).toContain('assertSeekBehavior');
    // The gate drives the UI with real PointerEvents (capture patched to no-op).
    expect(gate).toContain('setPointerCapture');
    expect(gate).toContain('PointerEvent');
  });

  it('covers the collapse→expand, resize and zoom lifecycles the human reported', () => {
    expect(gate).toContain('assertCollapseReopenSeek');
    expect(gate).toContain('assertResizeSeek');
    expect(gate).toContain('assertZoomSeek');
  });
});
