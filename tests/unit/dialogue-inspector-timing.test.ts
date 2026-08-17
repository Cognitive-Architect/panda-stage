import { readFileSync } from 'node:fs';
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

  it('exposes the current-project audio binding state without a second mutation owner', () => {
    const source = readFileSync(
      'src/renderer/features/dialogue/DialogueInspector.tsx',
      'utf8',
    );
    expect(source).toContain('data-testid="dialogue-inspector-audio"');
    expect(source).toContain('dialogueStore.bindAudio');
    expect(source).toContain('disabled={!timed}');
    expect(source).toContain('未绑定音频');
    expect(source).toContain('未定时对白不可绑定音频。');
  });
});
