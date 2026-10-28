import { useEffect, useRef, useState } from 'react';
import { audioClipGain, audioClipSourceTimeMs, isAudioClipActiveAtTime } from '../../domain';
import type { AudioAsset, AudioClip, Dialogue, Project, Shot } from '../../domain';
import type { AssetPreviewAudioReadRequest, AssetPreviewAudioReadResponse } from '../../shared/asset-preview-audio-api';

export interface ProductPreviewAudioSelection {
  clip: AudioClip;
  asset: AudioAsset;
  dialogue?: Dialogue;
}

function selectionFor(project: Project, clip: AudioClip): ProductPreviewAudioSelection | null {
  const asset = project.assets.find((candidate) => candidate.id === clip.assetId);
  if (!asset || asset.kind !== 'audio' || asset.durationMs === undefined || !asset.sha256 ||
      (asset.mimeType !== 'audio/mpeg' && asset.mimeType !== 'audio/wav')) return null;
  return { clip, asset };
}

/** Dialogue-only lookup for the Mouth/Dialogue contract, never the mixer gate. */
export function resolveProductPreviewAudio(project: Project, shot: Shot, activeDialogueId: string | null): ProductPreviewAudioSelection | null {
  const dialogue = shot.dialogues.find((candidate) => candidate.id === activeDialogueId);
  const clip = shot.audioClips.find((candidate) => candidate.id === dialogue?.audioClipId);
  if (!dialogue || !clip || clip.role !== 'dialogue') return null;
  const selection = selectionFor(project, clip);
  return selection ? { ...selection, dialogue } : null;
}

/** All roles use the same half-open Shot-local window, independently of active speaker. */
export function resolveProductPreviewAudios(project: Project, shot: Shot, timeMs: number): ProductPreviewAudioSelection[] {
  return shot.audioClips.flatMap((clip) => {
    if (!isAudioClipActiveAtTime(clip, timeMs)) return [];
    const selection = selectionFor(project, clip);
    return selection ? [selection] : [];
  });
}

export function productPreviewSourceTimeMs(timeMs: number, clip: AudioClip, asset: AudioAsset): number {
  return Math.min(asset.durationMs ?? 0, Math.max(0,
    audioClipSourceTimeMs(clip, Number.isFinite(timeMs) ? timeMs : clip.startMs)));
}

export function isProductPreviewAudioActiveAtTime(timeMs: number, selection: ProductPreviewAudioSelection): boolean {
  return isAudioClipActiveAtTime(selection.clip, timeMs);
}

export type ProductPreviewAudioContext = Pick<AudioContext,
  'currentTime' | 'state' | 'destination' | 'createBufferSource' | 'createGain' | 'decodeAudioData' | 'resume' | 'close'>;

export interface ProductPreviewAudioTransportOptions {
  createContext?: () => ProductPreviewAudioContext;
  readAudio?: (request: AssetPreviewAudioReadRequest) => Promise<AssetPreviewAudioReadResponse>;
  onWarning?: (message: string | null) => void;
}

export interface ProductPreviewAudioSyncInput {
  projectRoot: string;
  project: Project;
  shot: Shot | null;
  range: 'project' | 'shot';
  playing: boolean;
  seekRevision: number;
  readMasterSnapshot: (sampledAtMs: number) => ProductPreviewAudioMasterSnapshot;
}

/** A read-only sample from Product Preview's existing playback clock anchor. */
export interface ProductPreviewAudioMasterSnapshot {
  projectRoot: string;
  projectId: string;
  range: 'project' | 'shot';
  shotId: string | null;
  timeMs: number;
  sampledAtMs: number;
  playing: boolean;
  clockGeneration: number;
}

export const PRODUCT_PREVIEW_AUDIO_CACHE_ENTRIES = 8;
export const PRODUCT_PREVIEW_AUDIO_CACHE_BYTES = 64 * 1024 * 1024;
export const PRODUCT_PREVIEW_AUDIO_MAX_READS = 4;
export const PRODUCT_PREVIEW_AUDIO_DRIFT_MS = 80;
const AUDIO_READ_WARNING = '部分音频无法预览，画面和字幕将继续播放。';

interface Voice {
  selection: ProductPreviewAudioSelection;
  state: 'waiting' | 'loading' | 'started' | 'ended' | 'failed';
  projectRoot: string;
  projectId: string;
  range: 'project' | 'shot';
  shotId: string;
  clockGeneration: number;
  source?: AudioBufferSourceNode;
  gain?: GainNode;
  startedAt?: number;
  masterAtStart?: number;
}

interface ProductPreviewAudioClockSample {
  snapshot: ProductPreviewAudioMasterSnapshot;
  audioContextTime: number | null;
}

/**
 * One session-owned graph, driven ONLY by the Product Preview master input.
 * AudioContext time schedules samples; it never advances Preview or picks a Shot.
 * Explicit seeks/pause/handoff invalidate voice identity before async work settles.
 */
export class ProductPreviewAudioTransport {
  private readonly createContext: () => ProductPreviewAudioContext;
  private readonly readAudio: NonNullable<ProductPreviewAudioTransportOptions['readAudio']>;
  private readonly onWarning: NonNullable<ProductPreviewAudioTransportOptions['onWarning']>;
  private context: ProductPreviewAudioContext | null = null;
  private readonly voices = new Map<string, Voice>();
  private readonly bufferCache = new Map<string, AudioBuffer>();
  private readonly reads = new Map<string, Promise<AudioBuffer>>();
  private cacheBytes = 0;
  private cacheEpoch = 0;
  private latestInput: ProductPreviewAudioSyncInput | null = null;
  private latestMasterSnapshot: ProductPreviewAudioMasterSnapshot | null = null;
  private warning: string | null = null;
  private disposed = false;

  constructor(options: ProductPreviewAudioTransportOptions = {}) {
    this.createContext = options.createContext ?? (() => new AudioContext({ latencyHint: 'interactive' }));
    this.readAudio = options.readAudio ?? ((request) => window.pandaStage.assets.readAudio(request));
    this.onWarning = options.onWarning ?? (() => undefined);
  }

  sync(input: ProductPreviewAudioSyncInput): void {
    if (this.disposed) return;
    const previous = this.latestInput;
    const previousSnapshot = this.latestMasterSnapshot;
    this.latestInput = input;
    const clockSample = this.readMasterClockSample(input);
    const snapshot = clockSample?.snapshot ?? null;
    this.latestMasterSnapshot = snapshot;
    const projectChanged = previous && (previous.projectRoot !== input.projectRoot || previous.project.id !== input.project.id);
    const snapshotOwnerChanged = previousSnapshot !== null &&
      (!snapshot || !this.sameSnapshotOwner(previousSnapshot, snapshot));
    if (projectChanged) {
      this.cacheEpoch += 1;
      this.bufferCache.clear();
      this.cacheBytes = 0;
    }
    if (projectChanged || previous?.shot?.id !== input.shot?.id ||
        previous?.range !== input.range || previous?.seekRevision !== input.seekRevision ||
        previous?.playing !== input.playing || snapshotOwnerChanged) this.clearVoices();
    if (!snapshot || !this.snapshotMatchesInput(snapshot, input) || !input.playing || !input.shot) {
      this.clearVoices();
      this.publishWarning();
      return;
    }

    const selections = resolveProductPreviewAudios(input.project, input.shot, snapshot.timeMs);
    const desired = new Set(selections.map((selection) => this.voiceKey(selection)));
    for (const [key, voice] of this.voices) {
      if (!desired.has(key)) {
        this.releaseVoice(voice);
        this.voices.delete(key);
      }
    }
    for (const selection of selections) {
      const key = this.voiceKey(selection);
      let voice = this.voices.get(key);
      // Correct bounded drift against the incumbent master; ordinary ticks do not restart.
      if (voice?.state === 'started' && clockSample?.audioContextTime !== null &&
          clockSample?.audioContextTime !== undefined && voice.startedAt !== undefined && voice.masterAtStart !== undefined &&
          Math.abs(voice.masterAtStart + (clockSample.audioContextTime - voice.startedAt) * 1000 - snapshot.timeMs) > PRODUCT_PREVIEW_AUDIO_DRIFT_MS) {
        this.releaseVoice(voice);
        this.voices.delete(key);
        voice = undefined;
      }
      if (!voice) this.voices.set(key, {
        selection,
        state: 'waiting',
        projectRoot: snapshot.projectRoot,
        projectId: snapshot.projectId,
        range: snapshot.range,
        shotId: snapshot.shotId!,
        clockGeneration: snapshot.clockGeneration,
      });
    }
    this.pump();
    this.publishWarning();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cacheEpoch += 1;
    this.latestInput = null;
    this.latestMasterSnapshot = null;
    this.clearVoices();
    this.bufferCache.clear();
    this.cacheBytes = 0;
    this.reads.clear();
    if (this.context) void this.context.close().catch(() => undefined);
    this.context = null;
  }

  private pump(): void {
    if (this.disposed || !this.latestInput?.playing) return;
    for (const [key, voice] of this.voices) {
      if (voice.state !== 'waiting') continue;
      const assetKey = this.assetKey(voice.selection);
      if (!this.bufferCache.has(assetKey) && !this.reads.has(assetKey) && this.reads.size >= PRODUCT_PREVIEW_AUDIO_MAX_READS) continue;
      voice.state = 'loading';
      void this.startVoice(key, voice);
    }
  }

  private async startVoice(key: string, voice: Voice): Promise<void> {
    let waitForFreshInput = false;
    try {
      const buffer = await this.bufferFor(voice.selection);
      let clockSample = this.currentClockSampleForVoice(key, voice);
      if (!clockSample && this.isCurrentOwner(key, voice)) {
        voice.state = 'waiting';
        waitForFreshInput = true;
        return;
      }
      if (!clockSample) return;
      let { snapshot } = clockSample;
      if (!isAudioClipActiveAtTime(voice.selection.clip, snapshot.timeMs)) {
        voice.state = 'ended';
        return;
      }
      const context = this.context!;
      if (context.state === 'suspended') await context.resume();
      clockSample = this.currentClockSampleForVoice(key, voice);
      if (!clockSample && this.isCurrentOwner(key, voice)) {
        voice.state = 'waiting';
        waitForFreshInput = true;
        return;
      }
      if (!clockSample) return;
      ({ snapshot } = clockSample);
      if (!isAudioClipActiveAtTime(voice.selection.clip, snapshot.timeMs)) {
        voice.state = 'ended';
        return;
      }
      if (context.state !== 'running') throw new Error('Audio context unavailable.');
      const offset = productPreviewSourceTimeMs(snapshot.timeMs, voice.selection.clip, voice.selection.asset) / 1000;
      const duration = Math.min((voice.selection.clip.endMs - snapshot.timeMs) / 1000, buffer.duration - offset);
      if (duration <= 0) { voice.state = 'ended'; return; }
      const source = context.createBufferSource();
      const gain = context.createGain();
      voice.source = source;
      voice.gain = gain;
      source.buffer = buffer;
      gain.gain.value = audioClipGain(voice.selection.clip.volume);
      source.connect(gain);
      gain.connect(context.destination);
      voice.startedAt = clockSample.audioContextTime ?? context.currentTime;
      voice.masterAtStart = snapshot.timeMs;
      source.onended = () => {
        if (!this.currentClockSampleForVoice(key, voice)) return;
        this.releaseVoice(voice);
        // The next master tick, not the audio clock, decides whether to rebuild.
        this.voices.delete(key);
      };
      source.start(voice.startedAt, offset, duration);
      voice.state = 'started';
    } catch {
      const clockSample = this.currentClockSampleForVoice(key, voice);
      if (clockSample && isAudioClipActiveAtTime(voice.selection.clip, clockSample.snapshot.timeMs)) {
        this.releaseVoice(voice);
        voice.state = 'failed';
        this.publishWarning();
      }
    } finally {
      // A long renderer stall can leave an async decode/resume holding an old
      // master position. Let the next Preview sync drop expired clips first.
      if (!waitForFreshInput) this.pump();
    }
  }

  private readMasterClockSample(input: ProductPreviewAudioSyncInput): ProductPreviewAudioClockSample | null {
    const audioContextTime = this.context?.currentTime ?? null;
    const sampledAtMs = performance.now();
    if (!Number.isFinite(sampledAtMs)) return null;
    let snapshot: ProductPreviewAudioMasterSnapshot;
    try {
      snapshot = input.readMasterSnapshot(sampledAtMs);
    } catch {
      return null;
    }
    if (!Number.isFinite(snapshot.timeMs) || snapshot.sampledAtMs !== sampledAtMs ||
        !Number.isFinite(snapshot.clockGeneration)) return null;
    return { snapshot, audioContextTime };
  }

  private snapshotMatchesInput(snapshot: ProductPreviewAudioMasterSnapshot, input: ProductPreviewAudioSyncInput): boolean {
    return snapshot.projectRoot === input.projectRoot && snapshot.projectId === input.project.id &&
      snapshot.range === input.range && snapshot.shotId === (input.shot?.id ?? null) &&
      snapshot.playing === input.playing;
  }

  private sameSnapshotOwner(left: ProductPreviewAudioMasterSnapshot, right: ProductPreviewAudioMasterSnapshot): boolean {
    return left.projectRoot === right.projectRoot && left.projectId === right.projectId &&
      left.range === right.range && left.shotId === right.shotId &&
      left.playing === right.playing && left.clockGeneration === right.clockGeneration;
  }

  private isCurrentOwner(key: string, voice: Voice): boolean {
    return !this.disposed && this.voices.get(key) === voice && this.latestInput?.playing === true;
  }

  private currentClockSampleForVoice(key: string, voice: Voice): ProductPreviewAudioClockSample | null {
    const input = this.latestInput;
    if (!input || !this.isCurrentOwner(key, voice)) return null;
    const sample = this.readMasterClockSample(input);
    const snapshot = sample?.snapshot;
    if (!snapshot || !this.snapshotMatchesInput(snapshot, input) || !snapshot.playing ||
        snapshot.projectRoot !== voice.projectRoot || snapshot.projectId !== voice.projectId ||
        snapshot.range !== voice.range || snapshot.shotId !== voice.shotId ||
        snapshot.clockGeneration !== voice.clockGeneration) return null;
    return sample;
  }

  private bufferFor(selection: ProductPreviewAudioSelection): Promise<AudioBuffer> {
    const key = this.assetKey(selection);
    const cached = this.bufferCache.get(key);
    if (cached) {
      this.bufferCache.delete(key);
      this.bufferCache.set(key, cached);
      return Promise.resolve(cached);
    }
    const pending = this.reads.get(key);
    if (pending) return pending;
    const epoch = this.cacheEpoch;
    const context = this.context ??= this.createContext();
    const read = this.readAudio({ projectRoot: this.latestInput!.projectRoot, assetId: selection.asset.id, sha256: selection.asset.sha256! })
      .then(async (response) => {
        if (this.disposed || epoch !== this.cacheEpoch) throw new Error('Obsolete audio read.');
        if (!response.ok || response.status !== 'ready') throw new Error('Audio read failed.');
        const buffer = await context.decodeAudioData(new Uint8Array(response.bytes).buffer);
        if (this.disposed || epoch !== this.cacheEpoch) throw new Error('Obsolete decode.');
        const bytes = this.bufferBytes(buffer);
        // Oversized buffers can play but never remain in the session cache.
        if (bytes <= PRODUCT_PREVIEW_AUDIO_CACHE_BYTES) {
          while (this.bufferCache.size >= PRODUCT_PREVIEW_AUDIO_CACHE_ENTRIES || this.cacheBytes + bytes > PRODUCT_PREVIEW_AUDIO_CACHE_BYTES) {
            const oldest = this.bufferCache.keys().next().value!;
            this.cacheBytes -= this.bufferBytes(this.bufferCache.get(oldest)!);
            this.bufferCache.delete(oldest);
          }
          this.bufferCache.set(key, buffer);
          this.cacheBytes += bytes;
        }
        return buffer;
      }).finally(() => { if (this.reads.get(key) === read) this.reads.delete(key); });
    this.reads.set(key, read);
    return read;
  }

  private bufferBytes(buffer: AudioBuffer): number { return buffer.length * buffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT; }
  private assetKey(selection: ProductPreviewAudioSelection): string {
    return [this.latestInput!.projectRoot, this.latestInput!.project.id, selection.asset.id, selection.asset.sha256].join('\u0000');
  }
  private voiceKey({ clip, asset }: ProductPreviewAudioSelection): string {
    return [clip.id, asset.id, asset.sha256, clip.startMs, clip.endMs, clip.offsetMs, clip.volume].join('\u0000');
  }
  private releaseVoice(voice: Voice): void {
    if (voice.source) {
      voice.source.onended = null;
      try { voice.source.stop(); } catch { /* Source may already have ended. */ }
      voice.source.disconnect();
      voice.source.buffer = null;
      voice.source = undefined;
    }
    voice.gain?.disconnect();
    voice.gain = undefined;
  }
  private clearVoices(): void {
    for (const voice of this.voices.values()) this.releaseVoice(voice);
    this.voices.clear();
  }
  private publishWarning(): void {
    if (this.disposed) return;
    const warning = [...this.voices.values()].some((voice) => voice.state === 'failed') ? AUDIO_READ_WARNING : null;
    if (warning !== this.warning) { this.warning = warning; this.onWarning(warning); }
  }
}

export function useProductPreviewAudio(input: ProductPreviewAudioSyncInput): string | null {
  const [warning, setWarning] = useState<string | null>(null);
  const transportRef = useRef<ProductPreviewAudioTransport | null>(null);
  useEffect(() => {
    const transport = new ProductPreviewAudioTransport({ onWarning: setWarning });
    transportRef.current = transport;
    return () => { transport.dispose(); transportRef.current = null; };
  }, []);
  useEffect(() => { transportRef.current?.sync(input); }, [input]);
  return warning;
}
