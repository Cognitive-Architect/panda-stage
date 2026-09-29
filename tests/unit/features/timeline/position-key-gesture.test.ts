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
