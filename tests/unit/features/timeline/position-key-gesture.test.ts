import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isValidFrameTime } from '../../../../src/domain/timeline/frame-grid';
import { isolatePositionMarkerPointer } from '../../../../src/renderer/features/timeline/PositionKeyMarker';
import { positionActionPlacement, previewPositionKeyTime } from '../../../../src/renderer/features/timeline/positionKeyGesture';

const base = {
  fromTimeMs: 1_000,
  pixelsPerMs: 0.2,
  previousTimeMs: 0,
  nextTimeMs: 2_000,
  durationMs: 3_001,
};

const ACTION_OUTER_HEIGHT = 48 + 3 * 2 + 1 * 2;

describe('Issue #647 Position Key drag geometry', () => {
  it('stops marker pointer events before the parent Timeline seek handler', () => {
    let stopped = 0;
    isolatePositionMarkerPointer({ stopPropagation: () => { stopped += 1; } } as never);
    expect(stopped).toBe(1);
  });

  it('snaps to legal 24fps times in both directions', () => {
    expect(previewPositionKeyTime({ ...base, deltaPx: 9 })).toBe(1_042);
    expect(previewPositionKeyTime({ ...base, deltaPx: -9 })).toBe(958);
    expect(isValidFrameTime(previewPositionKeyTime({ ...base, deltaPx: 9 }))).toBe(true);
  });

  it('clamps strictly between immediate neighbours without collision or Base crossing', () => {
    expect(previewPositionKeyTime({ ...base, deltaPx: -100_000 })).toBe(42);
    expect(previewPositionKeyTime({ ...base, deltaPx: 100_000 })).toBe(1_958);
    expect(previewPositionKeyTime({ ...base, previousTimeMs: 958, nextTimeMs: 1_042, deltaPx: 20 })).toBe(1_000);
  });

  it('honours an off-grid Shot end for the final Key', () => {
    expect(previewPositionKeyTime({ ...base, nextTimeMs: null, deltaPx: 100_000 })).toBe(3_000);
    expect(previewPositionKeyTime({ ...base, pixelsPerMs: 0, deltaPx: 10 })).toBe(1_000);
  });

  it('places Delete inside viewport edges and hides it for scrolled-away Keys', () => {
    const marker = { left: 8, right: 52, top: 40, bottom: 84, width: 44 };
    const scrollViewport = { left: 0, right: 340, top: 0, bottom: 150, width: 340 };
    expect(positionActionPlacement({ marker, scrollViewport, viewportWidth: 340, viewportHeight: 300, portrait: false }))
      .toEqual({ top: 92, left: 8, below: true });
    expect(positionActionPlacement({ marker: { ...marker, left: 310, right: 354 }, scrollViewport,
      viewportWidth: 340, viewportHeight: 300, portrait: false })?.left).toBe(228);
    expect(positionActionPlacement({ marker: { ...marker, top: 110, bottom: 154 }, scrollViewport,
      viewportWidth: 340, viewportHeight: 300, portrait: false })?.below).toBe(false);
    expect(positionActionPlacement({ marker: { ...marker, left: 500, right: 544 }, scrollViewport,
      viewportWidth: 340, viewportHeight: 300, portrait: true })).toBeNull();
  });
});

describe('Issue #648 portrait Delete placement', () => {
  const scrollViewport = { left: 0, right: 340, top: 0, bottom: 300, width: 340 };
  const marker = { left: 148, right: 192, top: 40, bottom: 84, width: 44 };
  const place = (overrides: Partial<typeof marker>, portrait: boolean, viewportHeight = 300) =>
    positionActionPlacement({
      marker: { ...marker, ...overrides },
      scrollViewport: { ...scrollViewport, bottom: viewportHeight },
      viewportWidth: 340,
      viewportHeight,
      portrait,
    });

  it('prefers below for a portrait Key that has room below', () => {
    const placed = place({}, true);
    expect(placed?.below).toBe(true);
    expect(placed?.top).toBe(92);
    expect(placed!.top + ACTION_OUTER_HEIGHT).toBeLessThanOrEqual(300 - 8);
  });

  it('flips above for a portrait Key near the viewport bottom edge', () => {
    const bottomKey = { top: 244, bottom: 288 };
    const placed = place(bottomKey, true);
    expect(placed?.below).toBe(false);
    expect(placed?.top).toBe(188);
    expect(placed!.top + ACTION_OUTER_HEIGHT).toBeLessThanOrEqual(bottomKey.top);
    expect(placed!.top + ACTION_OUTER_HEIGHT).toBeLessThanOrEqual(300 - 8);
  });

  it('keeps a portrait Key above when even above space is tight', () => {
    // Marker sits at the very bottom: below cannot fit, so Delete must not hang off-screen.
    const placed = place({ top: 280, bottom: 296 }, true, 300);
    expect(placed?.below).toBe(false);
    expect(placed!.top).toBeGreaterThanOrEqual(8);
    expect(placed!.top + ACTION_OUTER_HEIGHT).toBeLessThanOrEqual(300 - 8);
  });

  it('leaves landscape above/below behaviour unchanged', () => {
    expect(place({ top: 40, bottom: 84 }, false)?.below).toBe(true);
    expect(place({ top: 110, bottom: 154 }, false)?.below).toBe(false);
    const above = place({ top: 110, bottom: 154 }, false);
    expect(above?.top).toBe(54);
    expect(above!.top + ACTION_OUTER_HEIGHT).toBeLessThanOrEqual(110);
  });

  it('keeps horizontal edge clamping in both orientations', () => {
    expect(place({ left: 8, right: 52 }, true)?.left).toBe(8);
    expect(place({ left: 310, right: 354 }, true)?.left).toBe(228);
    expect(place({ left: 310, right: 354 }, false)?.left).toBe(228);
  });

  it('still hides the action when the marker is scrolled out of the Timeline viewport', () => {
    expect(place({ left: 500, right: 544 }, true)).toBeNull();
    expect(place({ left: -100, right: -56 }, false)).toBeNull();
  });
});

describe('Issue #649 Delete overlay outer-height contract', () => {
  it('matches the rendered shared touch target, local padding and border', () => {
    const tokens = readFileSync('src/renderer/styles/tokens.css', 'utf8');
    const primitives = readFileSync('src/renderer/styles/primitives.css', 'utf8');
    const local = readFileSync('src/renderer/styles/features/timeline/pk06-position-lane.css', 'utf8');
    expect(tokens).toMatch(/--ui-touch-regular:\s*48px;/u);
    expect(primitives).toMatch(/button\[data-ui-button\]\s*\{[^}]*min-height:\s*var\(--ui-touch-regular\);/u);
    expect(local).toMatch(/\.position-key-action\s*\{[^}]*box-sizing:\s*border-box;[^}]*padding:\s*3px;[^}]*border:\s*1px /u);
    const localButtonRule = /\.position-key-action \[data-ui-button\]\s*\{([^}]*)\}/u.exec(local)?.[1];
    expect(localButtonRule).toBeDefined();
    expect(localButtonRule).not.toContain('min-height');
    expect(ACTION_OUTER_HEIGHT).toBe(56);
  });
});
