import { expect, it } from 'vitest';
import { buildWaveformPeaks, projectWaveformViewport } from '../../../../src/renderer/features/timeline/audioWaveformGeometry';

it('samples silence and transients from only the audible source interval of a scrolled, trimmed clip', () => {
  const pcm = new Float32Array(600);
  pcm[200] = 0.5;
  pcm[201] = -0.75;
  pcm[570] = 1;
  const peaks = buildWaveformPeaks({ numberOfChannels: 1, length: pcm.length, sampleRate: 1_000, getChannelData: () => pcm });
  const clip = { startMs: 500, endMs: 900, offsetMs: 50 };
  const view = projectWaveformViewport(clip, 1, 650, 300, 82);
  expect(view).toEqual({ fromPx: 150, width: 218, sourceStartMs: 200 });
  expect(peaks(view!.sourceStartMs, 202)).toEqual([-0.75, 0.5]);
  expect(peaks(202, 418)).toEqual([0, 0]);
  expect(projectWaveformViewport(clip, 2, 1_300, 300, 82))
    .toEqual({ fromPx: 300, width: 218, sourceStartMs: 200 });
  expect(projectWaveformViewport(clip, 1, 910, 300, 82)).toBeNull();
});
