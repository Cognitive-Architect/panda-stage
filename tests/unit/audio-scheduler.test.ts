import { describe, expect, it } from 'vitest';
import {
  AudioScheduler,
  type AudioSchedulerSource,
} from '../../src/renderer/features/preview/AudioScheduler';

class FakeAudioSource implements AudioSchedulerSource {
  currentTime = 0;
  playbackRate = 1;
  volume = 1;
  paused = true;
  readonly playCalls: number[] = [];
  pauseCalls = 0;

  play(): void {
    this.paused = false;
    this.playCalls.push(this.currentTime);
  }

  pause(): void {
    this.paused = true;
    this.pauseCalls += 1;
  }
}

describe('Day28 AudioScheduler', () => {
  it('starts the selected clip at timeline offset and never stretches it', () => {
    const sources: FakeAudioSource[] = [];
    const scheduler = new AudioScheduler(
      [
        {
          id: 'clip-a',
          startMs: 1_000,
          endMs: 2_000,
          offsetMs: 50,
          volume: 0.75,
          url: 'data:audio/wav;base64,AA==',
        },
      ],
      () => {
        const source = new FakeAudioSource();
        sources.push(source);
        return source;
      },
    );

    scheduler.sync(1_250, true);
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      currentTime: 0.3,
      playbackRate: 1,
      volume: 0.75,
      paused: false,
    });
    scheduler.sync(1_300, true);
    expect(sources[0]!.playCalls).toHaveLength(1);
    scheduler.sync(2_000, false);
    expect(sources[0]!.paused).toBe(true);
    expect(scheduler.getActiveClipId()).toBeNull();
  });

  it('uses deterministic latest-start priority for legacy overlapping clips', () => {
    const sources: FakeAudioSource[] = [];
    const scheduler = new AudioScheduler(
      [
        {
          id: 'clip-first',
          startMs: 0,
          endMs: 1_000,
          offsetMs: 0,
          volume: 1,
          url: 'data:audio/wav;base64,AA==',
        },
        {
          id: 'clip-later',
          startMs: 500,
          endMs: 1_500,
          offsetMs: 0,
          volume: 1,
          url: 'data:audio/wav;base64,AA==',
        },
      ],
      (url) => {
        expect(url).toContain('data:audio');
        const source = new FakeAudioSource();
        sources.push(source);
        return source;
      },
    );
    scheduler.sync(600, true);
    expect(scheduler.getActiveClipId()).toBe('clip-later');
    expect(sources).toHaveLength(1);
  });
});
