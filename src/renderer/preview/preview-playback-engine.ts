export type PreviewPlaybackStatus =
  | 'stopped'
  | 'playing'
  | 'paused'
  | 'ended';

export interface PreviewAudioSource {
  start(offsetSeconds: number): void;
  stop(): void;
  dispose(): void;
}

export interface PreviewAudioRuntime {
  nowSeconds(): number;
  state(): string;
  resume(): Promise<void>;
  createSource(onEnded: () => void): PreviewAudioSource;
  close(): Promise<void>;
}

export interface PreviewPlaybackSnapshot {
  status: PreviewPlaybackStatus;
  timeMs: number;
  durationMs: number;
  activeSourceCount: 0 | 1;
  sourceStartCount: number;
  sourceStopCount: number;
  clockKind: 'audio-context';
  clockState: string;
}

export class PreviewPlaybackEngine {
  private status: PreviewPlaybackStatus = 'stopped';
  private positionMs = 0;
  private anchorSeconds = 0;
  private source: PreviewAudioSource | null = null;
  private sourceStartCount = 0;
  private sourceStopCount = 0;

  constructor(
    private readonly runtime: PreviewAudioRuntime,
    private readonly durationMs: number,
    private readonly onChange: (snapshot: PreviewPlaybackSnapshot) => void,
  ) {
    if (!Number.isInteger(durationMs) || durationMs <= 0) {
      throw new Error('Preview duration must be a positive integer.');
    }
  }

  async play(): Promise<void> {
    if (this.status === 'playing') {
      return;
    }
    if (this.positionMs >= this.durationMs) {
      this.positionMs = 0;
    }

    await this.runtime.resume();
    this.releaseSource();

    const source = this.runtime.createSource(() => this.handleEnded(source));
    this.source = source;
    this.anchorSeconds =
      this.runtime.nowSeconds() - this.positionMs / 1_000;
    this.status = 'playing';
    source.start(this.positionMs / 1_000);
    this.sourceStartCount += 1;
    this.emit();
  }

  pause(): void {
    if (this.status !== 'playing') {
      return;
    }
    this.positionMs = this.readClockPositionMs();
    this.releaseSource();
    this.status = 'paused';
    this.emit();
  }

  stop(): void {
    this.releaseSource();
    this.positionMs = 0;
    this.status = 'stopped';
    this.emit();
  }

  async replay(): Promise<void> {
    this.stop();
    await this.play();
  }

  snapshot(): PreviewPlaybackSnapshot {
    if (this.status === 'playing') {
      this.positionMs = this.readClockPositionMs();
    }

    return {
      status: this.status,
      timeMs: this.positionMs,
      durationMs: this.durationMs,
      activeSourceCount: this.source ? 1 : 0,
      sourceStartCount: this.sourceStartCount,
      sourceStopCount: this.sourceStopCount,
      clockKind: 'audio-context',
      clockState: this.runtime.state(),
    };
  }

  async destroy(): Promise<void> {
    this.releaseSource();
    await this.runtime.close();
  }

  private readClockPositionMs(): number {
    const elapsedMs = Math.floor(
      (this.runtime.nowSeconds() - this.anchorSeconds) * 1_000,
    );
    return Math.max(0, Math.min(this.durationMs, elapsedMs));
  }

  private releaseSource(): void {
    const source = this.source;
    if (!source) {
      return;
    }

    this.source = null;
    source.stop();
    source.dispose();
    this.sourceStopCount += 1;
  }

  private handleEnded(source: PreviewAudioSource): void {
    if (this.source !== source) {
      return;
    }

    source.dispose();
    this.source = null;
    this.positionMs = this.durationMs;
    this.status = 'ended';
    this.emit();
  }

  private emit(): void {
    this.onChange(this.snapshot());
  }
}
