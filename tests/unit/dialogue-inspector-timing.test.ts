import { describe, expect, it } from 'vitest';
import { normalizeManualDialogueTiming } from '../../src/renderer/features/dialogue/DialogueInspector';

describe('DialogueInspector manual integer-ms timing', () => {
  it('preserves non-frame-aligned exact integer boundaries', () => {
    expect(normalizeManualDialogueTiming('459', '833', 3000)).toEqual({
      startMs: 459,
      endMs: 833,
    });
  });

  it('clamps exact integer input to shot bounds without frame snapping', () => {
    expect(normalizeManualDialogueTiming('-1', '4000', 3000)).toEqual({
      startMs: 0,
      endMs: 3000,
    });
  });

  it.each([
    ['', '833'],
    ['459', ''],
    ['459.5', '833'],
    ['459', '833.5'],
    ['Infinity', '833'],
  ])('rejects non-integer timing input %j–%j', (start, end) => {
    expect(() => normalizeManualDialogueTiming(start, end, 3000)).toThrow(
      '开始和结束时间必须是整数毫秒。',
    );
  });
});
