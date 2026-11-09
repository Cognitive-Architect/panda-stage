import { describe, expect, it } from 'vitest';
import { isValidFrameTime } from '../../../../src/domain/timeline/frame-grid';
import { previewPartPoseKeyTime } from '../../../../src/renderer/features/timeline/partPoseTimelineGesture';

const base = {
  fromTimeMs: 1_000,
  pixelsPerMs: 0.2,
  previousTimeMs: 0,
  nextTimeMs: 2_000,
  durationMs: 3_000,
};

describe('Part Pose key drag preview', () => {
  it('snaps preview movement to the 24fps frame grid', () => {
    const forward = previewPartPoseKeyTime({ ...base, deltaPx: 9 });
    const backward = previewPartPoseKeyTime({ ...base, deltaPx: -9 });
    expect(forward).toBe(1_042);
    expect(backward).toBe(958);
    expect(isValidFrameTime(forward)).toBe(true);
    expect(isValidFrameTime(backward)).toBe(true);
  });

  it('stays strictly between the neighboring keys', () => {
    expect(previewPartPoseKeyTime({ ...base, deltaPx: -100_000 })).toBe(42);
    expect(previewPartPoseKeyTime({ ...base, deltaPx: 100_000 })).toBe(1_958);
    expect(previewPartPoseKeyTime({
      ...base,
      previousTimeMs: 958,
      nextTimeMs: 1_042,
      deltaPx: 100_000,
    })).toBe(1_000);
  });

  it('keeps the 3-second end at 2958ms and ignores unusable geometry', () => {
    expect(previewPartPoseKeyTime({
      ...base,
      fromTimeMs: 2_000,
      previousTimeMs: 1_000,
      nextTimeMs: null,
      deltaPx: 100_000,
    })).toBe(2_958);
    expect(previewPartPoseKeyTime({
      ...base,
      pixelsPerMs: 0,
      deltaPx: 9,
    })).toBe(base.fromTimeMs);
  });
});
