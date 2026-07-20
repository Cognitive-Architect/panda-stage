import { describe, expect, it } from 'vitest';
import {
  PROBE_AUDIO_ASSET_ID,
  PROBE_PROJECT,
  PROBE_SUBTITLE_CUES,
} from '../../src/shared/probe/probe-project';
import {
  evaluateSubtitleAtTime,
  SubtitleTrackSchema,
} from '../../src/shared/preview/subtitle-engine';

describe('subtitle engine', () => {
  it('registers a three-second WAV probe asset', () => {
    const audio = PROBE_PROJECT.assets.find(
      (asset) => asset.id === PROBE_AUDIO_ASSET_ID,
    );

    expect(audio).toMatchObject({
      kind: 'audio',
      mimeType: 'audio/wav',
      durationMs: 3_000,
      relativePath: 'probe/preview-tone.wav',
    });
  });

  it('selects cues on deterministic half-open time ranges', () => {
    const cues = SubtitleTrackSchema.parse(PROBE_SUBTITLE_CUES);

    expect(evaluateSubtitleAtTime(cues, 199)).toBeNull();
    expect(evaluateSubtitleAtTime(cues, 200)?.text).toContain('竹林');
    expect(evaluateSubtitleAtTime(cues, 1_399)?.text).toContain('竹林');
    expect(evaluateSubtitleAtTime(cues, 1_400)?.text).toContain('每一个故事');
    expect(evaluateSubtitleAtTime(cues, 2_849)?.text).toContain('每一个故事');
    expect(evaluateSubtitleAtTime(cues, 2_850)).toBeNull();
  });

  it('rejects overlapping subtitle cues', () => {
    expect(
      SubtitleTrackSchema.safeParse([
        {
          id: '51000000-0000-4000-8000-000000000001',
          startMs: 0,
          endMs: 1_000,
          text: 'first',
        },
        {
          id: '51000000-0000-4000-8000-000000000002',
          startMs: 900,
          endMs: 1_500,
          text: 'second',
        },
      ]).success,
    ).toBe(false);
  });

  it('rejects fractional evaluation time', () => {
    expect(() => evaluateSubtitleAtTime(PROBE_SUBTITLE_CUES, 1.5)).toThrow();
  });
});
