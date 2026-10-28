import { useCallback, useEffect, useRef, useState } from 'react';
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
  /** Quantized render-clock tick refreshes lookahead work; precise time comes from readMasterSnapshot. */
  syncTick?: number;
  readMasterSnapshot: (sampledAtMs: number) => ProductPreviewAudioMasterSnapshot;
}

/** A read-only sample from Product Preview's existing playback clock anchor. */
export interface ProductPreviewAudioMasterSnapshot {
  projectRoot: string;
  projectId: string;
  range: 'project' | 'shot';
  shotId: string | null;
  /** Shot-local time used by the current renderer frame and audio clip contract. */
  timeMs: number;
  /** Continuous project time; required by project-range future planning. */
  projectTimeMs?: number | null;
  sampledAtMs: number;
  playing: boolean;
  clockGeneration: number;
}

export interface ProductPreviewAudioStartPreparationResult {
  ready: boolean;
  reason: 'ready' | 'no-audio' | 'timeout' | 'failed' | 'cancelled';
  waitedMs: number;
}

export const PRODUCT_PREVIEW_AUDIO_CACHE_ENTRIES = 8;
export const PRODUCT_PREVIEW_AUDIO_CACHE_BYTES = 64 * 1024 * 1024;
export const PRODUCT_PREVIEW_AUDIO_MAX_READS = 4;
export const PRODUCT_PREVIEW_AUDIO_DRIFT_MS = 80;
export const PRODUCT_PREVIEW_AUDIO_LOOKAHEAD_MS = 400;
export const PRODUCT_PREVIEW_AUDIO_SYNC_INTERVAL_MS = 100;
export const PRODUCT_PREVIEW_AUDIO_STARTUP_TIMEOUT_MS = 500;
const AUDIO_READ_WARNING = '部分音频无法预览，画面和字幕将继续播放。';
const PREFETCH_PRIORITY = 2;

interface PlannedVoice {
  selection: ProductPreviewAudioSelection;
  shot: Shot;
  shotStartMs: number;
  clipStartMasterMs: number;
  clipEndMasterMs: number;
  priority: number;
}

interface Voice extends PlannedVoice {
  key: string;
  consumerId: string;
  state: 'waiting' | 'loading' | 'scheduled' | 'started' | 'ended' | 'failed';
  projectRoot: string;
  projectId: string;
  range: 'project' | 'shot';
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

interface AudioReadTask {
  key: string;
  assetKey: string;
  selection: ProductPreviewAudioSelection;
  request: AssetPreviewAudioReadRequest;
  epoch: number;
  priority: number;
  sequence: number;
  status: 'queued' | 'running';
  consumers: Set<string>;
  promise: Promise<AudioBuffer>;
  resolve: (buffer: AudioBuffer) => void;
  reject: (reason: unknown) => void;
}

/**
 * One session-owned graph, driven ONLY by the Product Preview master input.
 * AudioContext time schedules samples; it never advances Preview or picks a Shot.
 * Project-range clips may be prepared across one upcoming Shot boundary.
 */
export class ProductPreviewAudioTransport {
  private readonly createContext: () => ProductPreviewAudioContext;
  private readonly readAudio: NonNullable<ProductPreviewAudioTransportOptions['readAudio']>;
  private readonly onWarning: NonNullable<ProductPreviewAudioTransportOptions['onWarning']>;
  private context: ProductPreviewAudioContext | null = null;
  private readonly voices = new Map<string, Voice>();
  private readonly bufferCache = new Map<string, AudioBuffer>();
  /** Only IPC/decode work that has actually started is counted in this Map. */
  private readonly reads = new Map<string, Promise<AudioBuffer>>();
  private readonly readTasks = new Map<string, AudioReadTask>();
  private readonly readQueue: AudioReadTask[] = [];
  private readonly startConsumers = new Map<number, string[]>();
  private cancelStartupPreparation: (() => void) | null = null;
  private cacheBytes = 0;
  private cacheEpoch = 0;
  private readTaskSequence = 0;
  private startupGeneration = 0;
  private latestInput: ProductPreviewAudioSyncInput | null = null;
  private latestMasterSnapshot: ProductPreviewAudioMasterSnapshot | null = null;
  private warning: string | null = null;
  private startupWarning = false;
  private disposed = false;

  constructor(options: ProductPreviewAudioTransportOptions = {}) {
    this.createContext = options.createContext ?? (() => new AudioContext({ latencyHint: 'interactive' }));
    this.readAudio = options.readAudio ?? ((request) => window.pandaStage.assets.readAudio(request));
    this.onWarning = options.onWarning ?? (() => undefined);
  }

  /**
   * Boundedly reads/decodes the first playback window before Overlay creates its
   * playback anchor. A timeout lets picture continue with the existing warning.
   */
  async prepareForPlayback(
    input: ProductPreviewAudioSyncInput,
    startTimeMs: number,
  ): Promise<ProductPreviewAudioStartPreparationResult> {
    if (this.disposed) return { ready: false, reason: 'cancelled', waitedMs: 0 };
    this.cancelPendingStartPreparation();
    const generation = this.startupGeneration;
    const startedAt = performance.now();
    const clockSample = this.readMasterClockSample(input);
    if (!clockSample || !this.snapshotOwnerMatchesInput(clockSample.snapshot, input)) {
      this.startupWarning = true;
      this.publishWarning();
      return { ready: false, reason: 'failed', waitedMs: 0 };
    }

    const snapshot = this.snapshotAtStart(input, clockSample.snapshot, startTimeMs);
    const plan = this.planFor(input, snapshot, PRODUCT_PREVIEW_AUDIO_LOOKAHEAD_MS)
      .sort((left, right) => left.priority - right.priority);
    if (plan.length === 0) {
      this.startupWarning = false;
      this.publishWarning();
      return { ready: true, reason: 'no-audio', waitedMs: 0 };
    }

    this.latestInput = input;
    let context: ProductPreviewAudioContext;
    try {
      context = this.context ??= this.createContext();
    } catch {
      this.startupWarning = true;
      this.publishWarning();
      return { ready: false, reason: 'failed', waitedMs: Math.max(0, performance.now() - startedAt) };
    }
    const assets = new Map<string, ProductPreviewAudioSelection>();
    for (const item of plan) assets.set(this.assetKey(item.selection, input), item.selection);
    const consumers = [...assets.keys()].map((assetKey) => `startup:${generation}:${assetKey}`);
    this.startConsumers.set(generation, consumers);

    const preparations = [...assets.values()].map((selection, index) =>
      this.requestBuffer(selection, input, consumers[index]!, 0));
    let resume: Promise<void>;
    try {
      resume = context.state === 'suspended' ? context.resume() : Promise.resolve();
    } catch (error) {
      resume = Promise.reject(error);
    }
    const allReady = Promise.all([...preparations, resume]).then(() => 'ready' as const, () => 'failed' as const);
    let cancelPreparation!: () => void;
    const cancelled = new Promise<'cancelled'>((resolve) => {
      cancelPreparation = () => resolve('cancelled');
    });
    this.cancelStartupPreparation = cancelPreparation;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const outcome = await Promise.race([
      allReady,
      cancelled,
      new Promise<'timeout'>((resolve) => {
        timeoutId = setTimeout(() => resolve('timeout'), PRODUCT_PREVIEW_AUDIO_STARTUP_TIMEOUT_MS);
      }),
    ]);
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    if (this.cancelStartupPreparation === cancelPreparation) this.cancelStartupPreparation = null;
    this.detachConsumers(consumers);
    this.startConsumers.delete(generation);

    const waitedMs = Math.max(0, performance.now() - startedAt);
    if (outcome === 'cancelled' || generation !== this.startupGeneration || this.disposed) {
      return { ready: false, reason: 'cancelled', waitedMs };
    }
    this.startupWarning = outcome !== 'ready';
    this.publishWarning();
    return { ready: outcome === 'ready', reason: outcome, waitedMs };
  }

  cancelPendingStartPreparation(): void {
    this.startupGeneration += 1;
    this.cancelStartupPreparation?.();
    this.cancelStartupPreparation = null;
    this.detachConsumers([...this.startConsumers.values()].flat());
    this.startConsumers.clear();
  }

  cancelPlaybackImmediately(): void {
    if (this.disposed) return;
    this.cancelPendingStartPreparation();
    this.clearVoices();
  }

  sync(input: ProductPreviewAudioSyncInput): void {
    if (this.disposed) return;
    const previous = this.latestInput;
    const previousSnapshot = this.latestMasterSnapshot;
    this.latestInput = input;
    const clockSample = this.readMasterClockSample(input);
    const snapshot = clockSample?.snapshot ?? null;
    this.latestMasterSnapshot = snapshot;
    const projectChanged = previous &&
      (previous.projectRoot !== input.projectRoot || previous.project.id !== input.project.id);
    const snapshotOwnerChanged = previousSnapshot !== null &&
      (!snapshot || !this.sameSnapshotOwner(previousSnapshot, snapshot));
    const selectedShotChanged = input.range === 'shot' && previous?.shot?.id !== input.shot?.id;

    if (projectChanged) {
      this.cacheEpoch += 1;
      this.bufferCache.clear();
      this.cacheBytes = 0;
    }
    if (projectChanged || selectedShotChanged || previous?.range !== input.range ||
        previous?.seekRevision !== input.seekRevision || previous?.playing !== input.playing || snapshotOwnerChanged) {
      this.clearVoices();
    }
    if (!clockSample || !snapshot || !this.snapshotMatchesInput(snapshot, input) || !input.playing || !input.shot) {
      this.clearVoices();
      this.publishWarning();
      return;
    }

    const position = this.masterPosition(snapshot, input);
    const planned = this.planFor(input, snapshot, PRODUCT_PREVIEW_AUDIO_LOOKAHEAD_MS)
      .sort((left, right) => left.priority - right.priority);
    const desired = new Set(planned.map((item) => this.voiceKey(item, input.range)));
    for (const [key, voice] of this.voices) {
      if (!desired.has(key)) {
        this.releaseVoice(voice, false);
        this.voices.delete(key);
      }
    }

    for (const item of planned) {
      const key = this.voiceKey(item, input.range);
      let voice = this.voices.get(key);
      if (voice && (voice.state === 'started' || voice.state === 'scheduled') &&
          clockSample.audioContextTime !== null && clockSample.audioContextTime !== undefined &&
          voice.startedAt !== undefined && voice.masterAtStart !== undefined) {
        if (voice.state === 'scheduled' && clockSample.audioContextTime >= voice.startedAt) {
          voice.state = 'started';
        }
        const expectedMasterTime = voice.masterAtStart +
          (clockSample.audioContextTime - voice.startedAt) * 1_000;
        if (Math.abs(expectedMasterTime - position) > PRODUCT_PREVIEW_AUDIO_DRIFT_MS) {
          this.releaseVoice(voice, false);
          this.voices.delete(key);
          voice = undefined;
        }
      }
      if (!voice) {
        voice = {
          ...item,
          key,
          consumerId: `voice:${key}`,
          state: 'waiting',
          projectRoot: snapshot.projectRoot,
          projectId: snapshot.projectId,
          range: snapshot.range,
          clockGeneration: snapshot.clockGeneration,
        };
        this.voices.set(key, voice);
      } else {
        voice.selection = item.selection;
        voice.shot = item.shot;
        voice.shotStartMs = item.shotStartMs;
        voice.clipStartMasterMs = item.clipStartMasterMs;
        voice.clipEndMasterMs = item.clipEndMasterMs;
        voice.priority = item.priority;
        this.updateConsumerPriority(voice.consumerId, voice.priority);
      }
    }
    this.pumpReadQueue();
    this.pump();
    this.publishWarning();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelPendingStartPreparation();
    this.cacheEpoch += 1;
    this.latestInput = null;
    this.latestMasterSnapshot = null;
    this.clearVoices();
    this.bufferCache.clear();
    this.cacheBytes = 0;
    for (const task of [...this.readQueue]) this.dropQueuedTask(task, new Error('Audio transport disposed.'));
    if (this.context) void this.context.close().catch(() => undefined);
    this.context = null;
  }

  private pump(): void {
    if (this.disposed || !this.latestInput?.playing) return;
    const waiting = [...this.voices.entries()]
      .filter(([, voice]) => voice.state === 'waiting')
      .sort((left, right) => left[1].priority - right[1].priority ||
        left[1].clipStartMasterMs - right[1].clipStartMasterMs);
    for (const [key, voice] of waiting) {
      voice.state = 'loading';
      const input = this.latestInput;
      const assetKey = input ? this.assetKey(voice.selection, input) : null;
      const preparedBuffer = assetKey ? this.bufferCache.get(assetKey) : undefined;
      if (preparedBuffer && this.context?.state === 'running') {
        if (assetKey) {
          this.bufferCache.delete(assetKey);
          this.bufferCache.set(assetKey, preparedBuffer);
        }
        // Prepared startup buffers must reach Web Audio in the same Overlay
        // commit as the master anchor, before React can defer its passive sync.
        this.startVoiceWithBuffer(key, voice, preparedBuffer);
      } else {
        void this.startVoice(key, voice);
      }
    }
    this.pumpReadQueue();
  }

  private async startVoice(key: string, voice: Voice): Promise<void> {
    try {
      const input = this.latestInput;
      if (!input) return;
      const buffer = await this.requestBuffer(
        voice.selection,
        input,
        voice.consumerId,
        voice.priority,
      );
      this.detachConsumer(voice.consumerId);
      let clockSample = this.currentClockSampleForVoice(key, voice);
      if (!clockSample && this.isCurrentOwner(key, voice)) {
        voice.state = 'waiting';
        return;
      }
      if (!clockSample) return;

      const context = this.context!;
      if (context.state === 'suspended') await context.resume();
      clockSample = this.currentClockSampleForVoice(key, voice);
      if (!clockSample && this.isCurrentOwner(key, voice)) {
        voice.state = 'waiting';
        return;
      }
      if (!clockSample) return;
      if (context.state !== 'running') throw new Error('Audio context unavailable.');
      this.startVoiceWithBuffer(key, voice, buffer, clockSample);
    } catch {
      this.detachConsumer(voice.consumerId);
      if (!this.isCurrentOwner(key, voice)) return;
      voice.state = 'failed';
      this.publishWarning();
    }
  }

  private startVoiceWithBuffer(
    key: string,
    voice: Voice,
    buffer: AudioBuffer,
    sampledClock?: ProductPreviewAudioClockSample,
  ): void {
    this.detachConsumer(voice.consumerId);
    const clockSample = sampledClock ?? this.currentClockSampleForVoice(key, voice);
    if (!clockSample && this.isCurrentOwner(key, voice)) {
      voice.state = 'waiting';
      return;
    }
    if (!clockSample) return;

    try {
      const input = this.latestInput;
      const context = this.context;
      if (!input || !context || context.state !== 'running') {
        voice.state = 'waiting';
        return;
      }
      const snapshot = clockSample.snapshot;
      const position = this.masterPosition(snapshot, input);
      if (position >= voice.clipEndMasterMs ||
          position + PRODUCT_PREVIEW_AUDIO_LOOKAHEAD_MS < voice.clipStartMasterMs) {
        voice.state = 'ended';
        return;
      }
      const shotLocalTime = this.shotLocalTime(snapshot, voice, input);
      if (shotLocalTime >= voice.selection.clip.endMs) {
        voice.state = 'ended';
        return;
      }

      const audioNow = clockSample.audioContextTime ?? context.currentTime;
      const deltaMs = voice.clipStartMasterMs - position;
      const scheduledAt = audioNow + Math.max(0, deltaMs) / 1_000;
      const offsetMs = deltaMs > 0
        ? voice.selection.clip.offsetMs
        : productPreviewSourceTimeMs(shotLocalTime, voice.selection.clip, voice.selection.asset);
      const activeFromMs = Math.max(shotLocalTime, voice.selection.clip.startMs);
      const durationMs = Math.min(
        voice.selection.clip.endMs - activeFromMs,
        buffer.duration * 1_000 - offsetMs,
      );
      if (durationMs <= 0) { voice.state = 'ended'; return; }

      const source = context.createBufferSource();
      const gain = context.createGain();
      voice.source = source;
      voice.gain = gain;
      source.buffer = buffer;
      gain.gain.value = audioClipGain(voice.selection.clip.volume);
      source.connect(gain);
      gain.connect(context.destination);
      voice.startedAt = scheduledAt;
      voice.masterAtStart = deltaMs > 0 ? voice.clipStartMasterMs : position;
      source.onended = () => {
        if (this.voices.get(key) !== voice) return;
        this.releaseVoice(voice);
        voice.state = 'ended';
        this.voices.delete(key);
      };
      source.start(scheduledAt, offsetMs / 1_000, durationMs / 1_000);
      voice.state = scheduledAt > audioNow ? 'scheduled' : 'started';
    } catch {
      if (!this.isCurrentOwner(key, voice)) return;
      voice.state = 'failed';
      this.publishWarning();
    }
  }

  private readMasterClockSample(input: ProductPreviewAudioSyncInput): ProductPreviewAudioClockSample | null {
    const sampledAtMs = performance.now();
    if (!Number.isFinite(sampledAtMs)) return null;
    let snapshot: ProductPreviewAudioMasterSnapshot;
    try {
      snapshot = input.readMasterSnapshot(sampledAtMs);
    } catch {
      return null;
    }
    const audioContextTime = this.context?.currentTime ?? null;
    if (!Number.isFinite(snapshot.timeMs) || snapshot.sampledAtMs !== sampledAtMs ||
        !Number.isFinite(snapshot.clockGeneration) ||
        (snapshot.projectTimeMs !== undefined && snapshot.projectTimeMs !== null &&
          !Number.isFinite(snapshot.projectTimeMs))) return null;
    return { snapshot, audioContextTime };
  }

  private snapshotOwnerMatchesInput(snapshot: ProductPreviewAudioMasterSnapshot, input: ProductPreviewAudioSyncInput): boolean {
    return snapshot.projectRoot === input.projectRoot && snapshot.projectId === input.project.id &&
      snapshot.range === input.range;
  }

  private snapshotMatchesInput(snapshot: ProductPreviewAudioMasterSnapshot, input: ProductPreviewAudioSyncInput): boolean {
    if (!this.snapshotOwnerMatchesInput(snapshot, input) || snapshot.playing !== input.playing) return false;
    if (input.range === 'shot') return snapshot.shotId === (input.shot?.id ?? null);
    return snapshot.shotId === null
      ? input.project.shots.length === 0
      : input.project.shots.some((shot) => shot.id === snapshot.shotId);
  }

  private sameSnapshotOwner(left: ProductPreviewAudioMasterSnapshot, right: ProductPreviewAudioMasterSnapshot): boolean {
    return left.projectRoot === right.projectRoot && left.projectId === right.projectId &&
      left.range === right.range && left.playing === right.playing &&
      left.clockGeneration === right.clockGeneration &&
      (left.range === 'project' || left.shotId === right.shotId);
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
        snapshot.range !== voice.range || snapshot.clockGeneration !== voice.clockGeneration) return null;
    const position = this.masterPosition(snapshot, input);
    if (input.range === 'shot') return snapshot.shotId === voice.shot.id ? sample : null;
    if (!input.project.shots.some((shot) => shot.id === voice.shot.id) ||
        position < voice.clipStartMasterMs - PRODUCT_PREVIEW_AUDIO_LOOKAHEAD_MS ||
        position >= voice.clipEndMasterMs) return null;
    return sample;
  }

  private requestBuffer(
    selection: ProductPreviewAudioSelection,
    input: ProductPreviewAudioSyncInput,
    consumerId: string,
    priority: number,
  ): Promise<AudioBuffer> {
    const assetKey = this.assetKey(selection, input);
    const cached = this.bufferCache.get(assetKey);
    if (cached) {
      this.bufferCache.delete(assetKey);
      this.bufferCache.set(assetKey, cached);
      return Promise.resolve(cached);
    }
    const taskKey = `${this.cacheEpoch}\u0000${assetKey}`;
    let task = this.readTasks.get(taskKey);
    if (task) {
      task.consumers.add(consumerId);
      task.priority = Math.min(task.priority, priority);
      this.sortReadQueue();
      this.pumpReadQueue();
      return task.promise;
    }

    let resolve!: (buffer: AudioBuffer) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<AudioBuffer>((yes, no) => { resolve = yes; reject = no; });
    task = {
      key: taskKey,
      assetKey,
      selection,
      request: {
        projectRoot: input.projectRoot,
        assetId: selection.asset.id,
        sha256: selection.asset.sha256!,
      },
      epoch: this.cacheEpoch,
      priority,
      sequence: this.readTaskSequence++,
      status: 'queued',
      consumers: new Set([consumerId]),
      promise,
      resolve,
      reject,
    };
    this.readTasks.set(taskKey, task);
    this.readQueue.push(task);
    this.sortReadQueue();
    this.pumpReadQueue();
    return promise;
  }

  private pumpReadQueue(): void {
    if (this.disposed) return;
    while (this.reads.size < PRODUCT_PREVIEW_AUDIO_MAX_READS && this.readQueue.length > 0) {
      const eligibleIndex = this.readQueue.findIndex((task) =>
        task.priority < PREFETCH_PRIORITY || this.reads.size < PRODUCT_PREVIEW_AUDIO_MAX_READS - 1);
      if (eligibleIndex < 0) return;
      const [task] = this.readQueue.splice(eligibleIndex, 1);
      if (!task) continue;
      if (task.consumers.size === 0) {
        this.dropQueuedTask(task, new Error('Obsolete queued audio read.'));
        continue;
      }
      task.status = 'running';
      this.runReadTask(task);
    }
  }

  private runReadTask(task: AudioReadTask): void {
    const context = this.context ??= this.createContext();
    this.reads.set(task.key, task.promise);
    let readResult: Promise<AssetPreviewAudioReadResponse>;
    try {
      readResult = Promise.resolve(this.readAudio(task.request));
    } catch (error) {
      readResult = Promise.reject(error);
    }
    void readResult.then(async (response) => {
      if (this.disposed || task.epoch !== this.cacheEpoch) throw new Error('Obsolete audio read.');
      if (!response.ok || response.status !== 'ready') throw new Error('Audio read failed.');
      const buffer = await context.decodeAudioData(new Uint8Array(response.bytes).buffer);
      if (this.disposed || task.epoch !== this.cacheEpoch) throw new Error('Obsolete decode.');
      this.cacheBuffer(task.assetKey, buffer);
      return buffer;
    }).then((buffer) => {
      this.finishReadTask(task);
      task.resolve(buffer);
    }, (error: unknown) => {
      this.finishReadTask(task);
      task.reject(error);
    });
  }

  private finishReadTask(task: AudioReadTask): void {
    if (this.reads.get(task.key) === task.promise) this.reads.delete(task.key);
    if (this.readTasks.get(task.key) === task) this.readTasks.delete(task.key);
    this.pumpReadQueue();
  }

  private cacheBuffer(key: string, buffer: AudioBuffer): void {
    const bytes = this.bufferBytes(buffer);
    if (bytes > PRODUCT_PREVIEW_AUDIO_CACHE_BYTES) return;
    while (this.bufferCache.size >= PRODUCT_PREVIEW_AUDIO_CACHE_ENTRIES ||
        this.cacheBytes + bytes > PRODUCT_PREVIEW_AUDIO_CACHE_BYTES) {
      const oldest = this.bufferCache.keys().next().value as string | undefined;
      if (oldest === undefined) return;
      this.cacheBytes -= this.bufferBytes(this.bufferCache.get(oldest)!);
      this.bufferCache.delete(oldest);
    }
    this.bufferCache.set(key, buffer);
    this.cacheBytes += bytes;
  }

  private detachConsumer(consumerId: string): void {
    this.detachConsumers([consumerId]);
  }

  private detachConsumers(consumerIds: readonly string[]): void {
    if (consumerIds.length === 0) return;
    const consumers = new Set(consumerIds);
    for (const task of this.readTasks.values()) {
      for (const consumerId of consumers) task.consumers.delete(consumerId);
      if (task.status !== 'queued' || task.consumers.size > 0) continue;
      this.dropQueuedTask(task, new Error('Obsolete queued audio read.'));
    }
    this.sortReadQueue();
    this.pumpReadQueue();
  }

  private dropQueuedTask(task: AudioReadTask, reason: Error): void {
    if (task.status !== 'queued') return;
    const index = this.readQueue.indexOf(task);
    if (index >= 0) this.readQueue.splice(index, 1);
    if (this.readTasks.get(task.key) === task) this.readTasks.delete(task.key);
    task.reject(reason);
  }

  private updateConsumerPriority(consumerId: string, priority: number): void {
    for (const task of this.readTasks.values()) {
      if (task.status === 'queued' && task.consumers.has(consumerId)) {
        task.priority = Math.min(task.priority, priority);
      }
    }
    this.sortReadQueue();
  }

  private sortReadQueue(): void {
    this.readQueue.sort((left, right) => left.priority - right.priority || left.sequence - right.sequence);
  }

  private planFor(
    input: ProductPreviewAudioSyncInput,
    snapshot: ProductPreviewAudioMasterSnapshot,
    lookaheadMs: number,
  ): PlannedVoice[] {
    const position = this.masterPosition(snapshot, input);
    const horizon = position + lookaheadMs;
    const plan: PlannedVoice[] = [];
    if (input.range === 'shot') {
      const shot = input.shot;
      if (!shot) return plan;
      for (const clip of shot.audioClips) {
        if (clip.endMs <= position || clip.startMs >= horizon) continue;
        const selection = selectionFor(input.project, clip);
        if (!selection) continue;
        plan.push({ selection, shot, shotStartMs: 0, clipStartMasterMs: clip.startMs,
          clipEndMasterMs: clip.endMs, priority: clip.startMs <= position ? 1 : PREFETCH_PRIORITY });
      }
      return plan;
    }

    let shotStartMs = 0;
    for (const shot of input.project.shots) {
      for (const clip of shot.audioClips) {
        const clipStartMasterMs = shotStartMs + clip.startMs;
        const clipEndMasterMs = shotStartMs + clip.endMs;
        if (clipEndMasterMs <= position || clipStartMasterMs >= horizon) continue;
        const selection = selectionFor(input.project, clip);
        if (!selection) continue;
        plan.push({ selection, shot, shotStartMs, clipStartMasterMs, clipEndMasterMs,
          priority: clipStartMasterMs <= position ? 1 : PREFETCH_PRIORITY });
      }
      shotStartMs += shot.durationMs;
    }
    return plan;
  }

  private snapshotAtStart(
    input: ProductPreviewAudioSyncInput,
    current: ProductPreviewAudioMasterSnapshot,
    requestedTimeMs: number,
  ): ProductPreviewAudioMasterSnapshot {
    if (input.range === 'shot') {
      const shot = input.shot;
      const timeMs = shot
        ? Math.min(shot.durationMs, Math.max(0, requestedTimeMs))
        : 0;
      return { ...current, shotId: shot?.id ?? null, timeMs, projectTimeMs: null, playing: false };
    }
    const position = projectPosition(input.project, requestedTimeMs);
    return {
      ...current,
      shotId: position.shot?.id ?? null,
      timeMs: position.shotLocalTimeMs,
      projectTimeMs: position.projectTimeMs,
      playing: false,
    };
  }

  private masterPosition(snapshot: ProductPreviewAudioMasterSnapshot, input: ProductPreviewAudioSyncInput): number {
    if (input.range === 'shot') return snapshot.timeMs;
    if (typeof snapshot.projectTimeMs === 'number' && Number.isFinite(snapshot.projectTimeMs)) {
      return snapshot.projectTimeMs;
    }
    return projectPositionFromShot(input.project, snapshot.shotId, snapshot.timeMs);
  }

  private shotLocalTime(snapshot: ProductPreviewAudioMasterSnapshot, voice: Voice, input: ProductPreviewAudioSyncInput): number {
    return input.range === 'shot' ? snapshot.timeMs : this.masterPosition(snapshot, input) - voice.shotStartMs;
  }

  private voiceKey(item: PlannedVoice, range: 'project' | 'shot'): string {
    const { clip } = item.selection;
    return [range, item.shot.id, clip.id, item.selection.asset.id, item.selection.asset.sha256,
      clip.startMs, clip.endMs, clip.offsetMs, clip.volume].join('\u0000');
  }

  private assetKey(selection: ProductPreviewAudioSelection, input: ProductPreviewAudioSyncInput): string {
    return [input.projectRoot, input.project.id, selection.asset.id, selection.asset.sha256].join('\u0000');
  }

  private bufferBytes(buffer: AudioBuffer): number {
    return buffer.length * buffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT;
  }

  private releaseVoice(voice: Voice, pumpReads = true): void {
    if (pumpReads) this.detachConsumer(voice.consumerId);
    else this.detachConsumersWithoutPump([voice.consumerId]);
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
    const consumers = [...this.voices.values()].map((voice) => voice.consumerId);
    for (const voice of this.voices.values()) this.releaseVoice(voice, false);
    this.voices.clear();
    this.detachConsumersWithoutPump(consumers);
    this.pumpReadQueue();
  }

  private detachConsumersWithoutPump(consumerIds: readonly string[]): void {
    if (consumerIds.length === 0) return;
    const consumers = new Set(consumerIds);
    for (const task of this.readTasks.values()) {
      for (const consumerId of consumers) task.consumers.delete(consumerId);
      if (task.status === 'queued' && task.consumers.size === 0) {
        this.dropQueuedTask(task, new Error('Obsolete queued audio read.'));
      }
    }
    this.sortReadQueue();
  }

  private publishWarning(): void {
    if (this.disposed) return;
    const warning = this.startupWarning || [...this.voices.values()].some((voice) => voice.state === 'failed')
      ? AUDIO_READ_WARNING
      : null;
    if (warning !== this.warning) { this.warning = warning; this.onWarning(warning); }
  }
}

function projectPosition(project: Project, requestedTimeMs: number): {
  projectTimeMs: number;
  shot: Shot | null;
  shotStartMs: number;
  shotLocalTimeMs: number;
} {
  const totalDurationMs = project.shots.reduce((total, shot) => total + shot.durationMs, 0);
  const projectTimeMs = Math.min(totalDurationMs, Math.max(0, Number.isFinite(requestedTimeMs) ? requestedTimeMs : 0));
  let shotStartMs = 0;
  for (let index = 0; index < project.shots.length; index += 1) {
    const shot = project.shots[index]!;
    const shotEndMs = shotStartMs + shot.durationMs;
    if (projectTimeMs < shotEndMs || index === project.shots.length - 1) {
      return { projectTimeMs, shot, shotStartMs, shotLocalTimeMs: Math.min(shot.durationMs, Math.max(0, projectTimeMs - shotStartMs)) };
    }
    shotStartMs = shotEndMs;
  }
  return { projectTimeMs, shot: null, shotStartMs: 0, shotLocalTimeMs: 0 };
}

function projectPositionFromShot(project: Project, shotId: string | null, shotLocalTimeMs: number): number {
  let shotStartMs = 0;
  for (const shot of project.shots) {
    if (shot.id === shotId) return shotStartMs + shotLocalTimeMs;
    shotStartMs += shot.durationMs;
  }
  return shotLocalTimeMs;
}

export interface ProductPreviewAudioController {
  warning: string | null;
  prepareForPlayback: (startTimeMs: number) => Promise<ProductPreviewAudioStartPreparationResult>;
  cancelPendingStartPreparation: () => void;
  cancelPlaybackImmediately: () => void;
  syncImmediately: (input: ProductPreviewAudioSyncInput) => void;
}

export function useProductPreviewAudio(input: ProductPreviewAudioSyncInput): ProductPreviewAudioController {
  const [warning, setWarning] = useState<string | null>(null);
  const transportRef = useRef<ProductPreviewAudioTransport | null>(null);
  useEffect(() => {
    const transport = new ProductPreviewAudioTransport({ onWarning: setWarning });
    transportRef.current = transport;
    return () => { transport.dispose(); transportRef.current = null; };
  }, []);
  useEffect(() => { transportRef.current?.sync(input); }, [input]);
  const prepareForPlayback = useCallback((startTimeMs: number) => {
    const preparation = transportRef.current?.prepareForPlayback(input, startTimeMs);
    return preparation?.catch(() => {
      setWarning(AUDIO_READ_WARNING);
      return { ready: false, reason: 'failed' as const, waitedMs: 0 };
    }) ?? Promise.resolve({ ready: true, reason: 'no-audio' as const, waitedMs: 0 });
  }, [input]);
  const cancelPendingStartPreparation = useCallback(() => {
    transportRef.current?.cancelPendingStartPreparation();
  }, []);
  const cancelPlaybackImmediately = useCallback(() => {
    transportRef.current?.cancelPlaybackImmediately();
  }, []);
  const syncImmediately = useCallback((nextInput: ProductPreviewAudioSyncInput) => {
    transportRef.current?.sync(nextInput);
  }, []);
  return { warning, prepareForPlayback, cancelPendingStartPreparation, cancelPlaybackImmediately, syncImmediately };
}
