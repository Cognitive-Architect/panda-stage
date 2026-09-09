import { describe, expect, it } from 'vitest';
import {
  millisecondsToSeconds,
  normalizeManualDialogueTiming,
  secondsToMilliseconds,
} from '../../src/renderer/features/dialogue/DialogueInspector';

describe('DialogueInspector subtitle seconds timing', () => {
  it('converts seconds to integer milliseconds and derives the end', () => {
    expect(normalizeManualDialogueTiming('0.33', '3.17', 5_000)).toEqual({
      startMs: 330,
      endMs: 3_500,
    });
  });

  it('rounds fractional seconds deterministically at the ms boundary', () => {
    expect(secondsToMilliseconds('3.125')).toBe(3_125);
    expect(normalizeManualDialogueTiming('0.333', '3.125', 5_000)).toEqual({
      startMs: 333,
      endMs: 3_458,
    });
  });

  it('formats persisted integer milliseconds without unnecessary precision', () => {
    expect(millisecondsToSeconds(0)).toBe('0');
    expect(millisecondsToSeconds(330)).toBe('0.33');
    expect(millisecondsToSeconds(3_125)).toBe('3.125');
  });

  it.each([
    ['', '3.17'],
    ['0.33', ''],
    ['not-a-number', '3.17'],
    ['0.33', 'Infinity'],
  ])('rejects invalid seconds drafts %j / %j', (start, duration) => {
    expect(() => normalizeManualDialogueTiming(start, duration, 5_000)).toThrow(
      /不能为空|有效的秒数/,
    );
  });

  it.each([
    ['-0.01', '3.17', '开始时间不能小于'],
    ['0.33', '0', '时长必须大于'],
    ['4', '2', '不能超过当前镜头时长'],
  ])('rejects invalid computed intervals %j / %j', (start, duration, message) => {
    expect(() => normalizeManualDialogueTiming(start, duration, 5_000)).toThrow(
      message,
    );
  });
});
