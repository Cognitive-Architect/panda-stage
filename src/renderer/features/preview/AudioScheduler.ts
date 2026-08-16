import type { ProductPreviewAudioClip } from '../../shell/productPreviewModel';

export interface ScheduledAudioClip {
  id: string;
  startMs: number;
  endMs: number;
  offsetMs: number;
  volume: number;
  url: string;
}

export interface AudioSchedulerSource {
  currentTime: number;
  playbackRate: number;
  volume: number;
  paused: boolean;
  play(): Promise<void> | void;
  pause(): void;
  dispose?(): void;
}

export type AudioSchedulerSourceFactory = (url: string) => AudioSchedulerSource;

export function createHtmlAudioSource(url: string): AudioSchedulerSource {
  const element = new window.Audio(url);
  element.preload = 'auto';
  return {
    get currentTime() {
      return element.currentTime;
    },
    set currentTime(value: number) {
      element.currentTime = Math.max(0, value);
    },
    get playbackRate() {
      return element.playbackRate;
    },
    set playbackRate(value: number) {
      element.playbackRate = value;
    },
    get volume() {
      return element.volume;
    },
    set volume(value: number) {
      element.volume = Math.min(1, Math.max(0, value));
    },
    get paused() {
      return element.paused;
    },
    play: () => element.play(),
    pause: () => element.pause(),
    dispose: () => {
      element.pause();
      element.removeAttribute('src');
      element.load();
    },
  };
}

function normalizeClip(
  clip: ScheduledAudioClip,
): ScheduledAudioClip | null {
  if (
    !clip.url ||
    !Number.isInteger(clip.startMs) ||
    !Number.isInteger(clip.endMs) ||
    clip.endMs <= clip.startMs
  ) {
    return null;
  }
  return {
    ...clip,
    offsetMs: Number.isInteger(clip.offsetMs) && clip.offsetMs >= 0
      ? clip.offsetMs
      : 0,
    volume: Number.isFinite(clip.volume)
      ? Math.min(1, Math.max(0, clip.volume))
      : 1,
  };
}

/**
 * One-source preview audio scheduler. It follows integer-ms transport time,
 * keeps playbackRate at exactly 1, and never stretches a source to fit a
 * dialogue window. Overlapping legacy clips use the same latest-start
 * priority as subtitles; new authoring rejects overlaps before they reach it.
 */
export class AudioScheduler {
  private readonly clips: ScheduledAudioClip[];
  private readonly factory: AudioSchedulerSourceFactory;
  private source: AudioSchedulerSource | null = null;
  private activeClipId: string | null = null;

  constructor(
    clips: readonly ScheduledAudioClip[],
    factory: AudioSchedulerSourceFactory = createHtmlAudioSource,
  ) {
    this.clips = clips
      .map(normalizeClip)
      .filter((clip): clip is ScheduledAudioClip => clip !== null)
      .sort(
        (left, right) =>
          right.startMs - left.startMs ||
          right.endMs - left.endMs ||
          (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
      );
    this.factory = factory;
  }

  sync(timeMs: number, playing: boolean): void {
    const safeTimeMs = Math.max(0, Math.round(timeMs));
    const clip = this.clips.find(
      (candidate) =>
        safeTimeMs >= candidate.startMs && safeTimeMs < candidate.endMs,
    );
    if (!clip) {
      this.releaseSource();
      return;
    }

    if (!this.source || this.activeClipId !== clip.id) {
      this.releaseSource();
      this.source = this.factory(clip.url);
      this.activeClipId = clip.id;
      this.source.playbackRate = 1;
      this.source.volume = clip.volume;
    }

    const targetSeconds =
      (clip.offsetMs + safeTimeMs - clip.startMs) / 1_000;
    if (Math.abs(this.source.currentTime - targetSeconds) > 0.08) {
      this.source.currentTime = Math.max(0, targetSeconds);
    }
    // A clip's time base is always 1x. This assignment is intentional even if
    // a browser or a fake source had a different default.
    this.source.playbackRate = 1;
    if (playing && this.source.paused) {
      try {
        void Promise.resolve(this.source.play()).catch(() => undefined);
      } catch {
        // Audio is an optional preview enhancement; subtitles remain usable.
      }
    } else {
      this.source.pause();
    }
  }

  stop(): void {
    this.releaseSource();
  }

  destroy(): void {
    this.releaseSource();
  }

  getActiveClipId(): string | null {
    return this.activeClipId;
  }

  private releaseSource(): void {
    if (!this.source) {
      this.activeClipId = null;
      return;
    }
    this.source.pause();
    this.source.dispose?.();
    this.source = null;
    this.activeClipId = null;
  }
}

/** Converts project preview clips to scheduler inputs once their URLs exist. */
export function toScheduledAudioClip(
  entry: ProductPreviewAudioClip,
  url: string,
): ScheduledAudioClip {
  return {
    id: entry.clip.id,
    startMs: entry.clip.startMs,
    endMs: entry.clip.endMs,
    offsetMs: entry.clip.offsetMs,
    volume: entry.clip.volume,
    url,
  };
}
