import { describe, expect, it } from 'vitest';
import {
  PreviewPlaybackEngine,
  type PreviewAudioRuntime,
  type PreviewAudioSource,
  type PreviewPlaybackSnapshot,
} from '../../src/renderer/preview/preview-playback-engine';

class FakeAudioSource implements PreviewAudioSource {
  active = false;
  startOffsetSeconds: number | null = null;

  constructor(
    private readonly runtime: FakeAudioRuntime,
    private readonly onEnded: () => void,
  ) {}

  start(offsetSeconds: number): void {
    this.startOffsetSeconds = offsetSeconds;
    this.active = true;
    this.runtime.sourceStarted();
  }

  stop(): void {
    if (this.active) {
      this.active = false;
      this.runtime.sourceStopped();
    }
  }

  dispose(): void {}

  finish(): void {
    if (!this.active) {
      return;
    }
    this.active = false;
    this.runtime.sourceStopped();
    this.onEnded();
  }
}

class FakeAudioRuntime implements PreviewAudioRuntime {
  now = 0;
  clockState = 'suspended';
  activeSources = 0;
  maximumActiveSources = 0;
  closed = false;
  readonly sources: FakeAudioSource[] = [];

  nowSeconds(): number {
    return this.now;
  }

  state(): string {
    return this.clockState;
  }

  async resume(): Promise<void> {
    this.clockState = 'running';
  }

  createSource(onEnded: () => void): PreviewAudioSource {
    const source = new FakeAudioSource(this, onEnded);
    this.sources.push(source);
    return source;
  }

  async close(): Promise<void> {
    this.closed = true;
    this.clockState = 'closed';
  }

  advance(seconds: number): void {
    this.now += seconds;
  }

  sourceStarted(): void {
    this.activeSources += 1;
    this.maximumActiveSources = Math.max(
      this.maximumActiveSources,
      this.activeSources,
    );
  }

  sourceStopped(): void {
    this.activeSources -= 1;
  }

  finishLatest(): void {
    this.sources.at(-1)?.finish();
  }
}

describe('PreviewPlaybackEngine', () => {
  it('uses the audio clock across play, pause, resume, replay and stop', async () => {
    const runtime = new FakeAudioRuntime();
    const changes: PreviewPlaybackSnapshot[] = [];
    const engine = new PreviewPlaybackEngine(runtime, 3_000, (snapshot) =>
      changes.push(snapshot),
    );

    await engine.play();
    runtime.advance(0.75);
    expect(engine.snapshot()).toMatchObject({
      status: 'playing',
      timeMs: 750,
      activeSourceCount: 1,
      clockKind: 'audio-context',
      clockState: 'running',
    });

    engine.pause();
    runtime.advance(0.5);
    expect(engine.snapshot()).toMatchObject({
      status: 'paused',
      timeMs: 750,
      activeSourceCount: 0,
    });

    await engine.play();
    expect(runtime.sources.at(-1)?.startOffsetSeconds).toBe(0.75);
    runtime.advance(0.25);
    expect(engine.snapshot().timeMs).toBe(1_000);

    await engine.replay();
    expect(engine.snapshot()).toMatchObject({
      status: 'playing',
      timeMs: 0,
      activeSourceCount: 1,
      sourceStartCount: 3,
      sourceStopCount: 2,
    });
    expect(runtime.maximumActiveSources).toBe(1);

    runtime.finishLatest();
    expect(engine.snapshot()).toMatchObject({
      status: 'ended',
      timeMs: 3_000,
      activeSourceCount: 0,
    });

    engine.stop();
    expect(engine.snapshot()).toMatchObject({ status: 'stopped', timeMs: 0 });
    expect(changes.length).toBeGreaterThan(0);
    await engine.destroy();
    expect(runtime.closed).toBe(true);
  });

  it('never stacks sources during repeated replay', async () => {
    const runtime = new FakeAudioRuntime();
    const engine = new PreviewPlaybackEngine(runtime, 3_000, () => {});

    await engine.replay();
    await engine.replay();
    await engine.replay();
    await engine.play();

    expect(engine.snapshot()).toMatchObject({
      activeSourceCount: 1,
      sourceStartCount: 3,
      sourceStopCount: 2,
    });
    expect(runtime.maximumActiveSources).toBe(1);

    engine.stop();
    expect(runtime.activeSources).toBe(0);
  });
});
