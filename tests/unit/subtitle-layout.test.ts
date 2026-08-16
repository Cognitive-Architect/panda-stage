import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SUBTITLE_STYLE,
  layoutSubtitleText,
} from '../../src/shared/preview/subtitle-layout';
import {
  evaluateSubtitleAtTime,
  SubtitleTrackSchema,
} from '../../src/shared/preview/subtitle-engine';

const ID_A = '51000000-0000-4000-8000-000000000001';
const ID_B = '51000000-0000-4000-8000-000000000002';

describe('Day28 subtitle projection', () => {
  it('keeps ordinary copy inside two safe-area lines', () => {
    const layout = layoutSubtitleText('角色一：你好，世界。', {
      ...DEFAULT_SUBTITLE_STYLE,
      maxWidth: 1_000,
    });
    expect(layout.lineCount).toBeLessThanOrEqual(2);
    expect(layout.truncated).toBe(false);
    expect(layout.width).toBeLessThanOrEqual(1_000);
  });

  it('truncates long copy with a clear warning instead of overflowing', () => {
    const layout = layoutSubtitleText('长文本'.repeat(500), {
      ...DEFAULT_SUBTITLE_STYLE,
      maxWidth: 320,
    });
    expect(layout.lineCount).toBe(2);
    expect(layout.truncated).toBe(true);
    expect(layout.text.endsWith('…')).toBe(true);
    expect(layout.warning).toContain('两行');
  });

  it('chooses a deterministic winner even when a legacy cue track overlaps', () => {
    const cues = [
      { id: ID_A, startMs: 0, endMs: 1_000, text: 'first' },
      { id: ID_B, startMs: 500, endMs: 1_500, text: 'second' },
    ];
    expect(SubtitleTrackSchema.safeParse(cues).success).toBe(false);
    expect(evaluateSubtitleAtTime(cues, 600)?.text).toBe('second');
    expect(evaluateSubtitleAtTime(cues, 1_500)).toBeNull();
  });
});
