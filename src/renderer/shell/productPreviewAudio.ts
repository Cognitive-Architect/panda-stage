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
  'currentTime' | 'state' | 'sampleRate' | 'destination' | 'createBufferSource' | 'createGain' | 'decodeAudioData' | 'resume' | 'close'>;

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
export const PRODUCT_PREVIEW_AUDIO_WORKING_SET_BYTES = 128 * 1024 * 1024;
export const PRODUCT_PREVIEW_AUDIO_RECENT_OVERSIZED_TTL_MS = 30_000;
export const PRODUCT_PREVIEW_AUDIO_WAV_PROXY_MIN_SOURCE_MS = 30_000;
export const PRODUCT_PREVIEW_AUDIO_WAV_PROXY_MAX_CLIP_MS = 10_000;
export const PRODUCT_PREVIEW_AUDIO_MAX_READS = 4;
export const PRODUCT_PREVIEW_AUDIO_DRIFT_MS = 80;
export const PRODUCT_PREVIEW_AUDIO_LOOKAHEAD_MS = 400;
export const PRODUCT_PREVIEW_AUDIO_SYNC_INTERVAL_MS = 100;
export const PRODUCT_PREVIEW_AUDIO_STARTUP_TIMEOUT_MS = 500;
const AUDIO_READ_WARNING = '部分音频无法预览，画面和字幕将继续播放。';
const PREFETCH_PRIORITY = 2;
const CURRENT_PLAYBACK_PRIORITY = 1;

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
  bufferRecord?: DecodedAudioBufferRecord;
  capacityDeferred?: boolean;
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
  status: 'queued' | 'reading' | 'decoding';
  consumers: Set<string>;
  promise: Promise<DecodedAudioBufferRecord>;
  resolve: (record: DecodedAudioBufferRecord) => void;
  reject: (reason: unknown) => void;
  readByteLength: number;
  additionalInFlightCompressedBytes: number;
  decodeReservationBytes: number;
  waveProxyRange: WaveProxyRange | null;
  cancelBeforeDecode?: boolean;
}

interface DecodedAudioBufferRecord {
  key: string;
  buffer: AudioBuffer;
  bytes: number;
  sourceStartMs: number;
  epoch: number;
  voiceLeases: Set<string>;
  consumerLeases: Set<string>;
  idleExpiresAtMs: number | null;
}

interface WaveProxyRange {
  sourceStartMs: number;
  durationMs: number;
}

interface WaveAudioMetadata {
  channels: number;
  sampleRate: number;
  blockAlign: number;
  durationSeconds: number;
  formatCode: number;
  bitsPerSample: number;
  dataBytes: number;
  dataOffset: number | null;
  formatChunkEnd: number | null;
  canonicalPcmChunks: boolean;
}

interface WaveAudioPreviewProxy {
  bytes: Uint8Array;
  sourceStartMs: number;
}

export interface ProductPreviewAudioWorkingSetSnapshot {
  contextState: AudioContextState | 'unavailable';
  actualInFlightReadCount: number;
  inFlightDecodeCount: number;
  inFlightCompressedBytes: number;
  queuedTaskCount: number;
  deferredFutureVoiceCount: number;
  decodeReservationBytes: number;
  retainedUniquePcmBytes: number;
  activeUniquePcmBytes: number;
  activeSourceCount: number;
  idleLruEntries: number;
  idleLruBytes: number;
  recentOversizedEntries: number;
  recentOversizedPcmBytes: number;
  workingSetLimitBytes: number;
  estimatedWorkingSetBytes: number;
  peakEstimatedWorkingSetBytes: number;
}

class AudioWorkingSetCapacityError extends Error {
  constructor() {
    super('Preview audio working-set capacity is exhausted.');
    this.name = 'AudioWorkingSetCapacityError';
  }
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
  /** Strong references cover only active/request leases, the idle LRU, and one expiring oversized record. */
  private readonly bufferRecords = new Map<string, DecodedAudioBufferRecord>();
  /** Only IPC/decode work that has actually started is counted in this Map. */
  private readonly reads = new Map<string, Promise<DecodedAudioBufferRecord>>();
  private readonly readTasks = new Map<string, AudioReadTask>();
  private readonly readQueue: AudioReadTask[] = [];
  private readonly startConsumers = new Map<number, string[]>();
  private cancelStartupPreparation: (() => void) | null = null;
  private cacheBytes = 0;
  private cacheEpoch = 0;
  private recentOversized: DecodedAudioBufferRecord | null = null;
  private recentOversizedTimer: ReturnType<typeof setTimeout> | null = null;
  private peakEstimatedWorkingSetBytes = 0;
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
    const assets = new Map<string, { selection: ProductPreviewAudioSelection; priority: number }>();
    for (const item of plan) {
      const assetKey = this.decodedBufferKey(item.selection, input);
      const current = assets.get(assetKey);
      if (!current || item.priority < current.priority) {
        assets.set(assetKey, { selection: item.selection, priority: item.priority });
      }
    }
    const readyCandidates = [...assets.entries()].filter(([, item]) =>
      item.priority < PREFETCH_PRIORITY ||
      this.canFitDecodedBuffer(this.estimatedDecodeBytes(item.selection, context, undefined,
        this.waveProxyRange(item.selection, input))));
    const consumers = readyCandidates.map(([assetKey]) => 'startup:' + generation + ':' + assetKey);
    this.startConsumers.set(generation, consumers);

    const preparations = readyCandidates.map(([, item], index) =>
      this.requestBuffer(item.selection, input, consumers[index]!, item.priority));
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
      this.discardObsoleteReadWork();
    }
    if (projectChanged || selectedShotChanged || previous?.range !== input.range ||
        previous?.seekRevision !== input.seekRevision || previous?.playing !== input.playing || snapshotOwnerChanged) {
      this.clearVoices();
    }
    if (projectChanged) this.clearRetainedBuffers();
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
    this.retryCapacityDeferredVoices();
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
    this.clearRetainedBuffers();
    for (const task of [...this.readQueue]) this.dropQueuedTask(task, new Error('Audio transport disposed.'));
    if (this.context) void this.context.close().catch(() => undefined);
    this.context = null;
  }

  getWorkingSetSnapshot(): ProductPreviewAudioWorkingSetSnapshot {
    const records = [...new Set(this.bufferRecords.values())];
    const activeRecords = records.filter((record) => record.voiceLeases.size > 0);
    const tasks = [...this.readTasks.values()];
    return {
      contextState: this.context?.state ?? 'unavailable',
      actualInFlightReadCount: tasks.filter((task) => task.status === 'reading').length,
      inFlightDecodeCount: tasks.filter((task) => task.status === 'decoding').length,
      inFlightCompressedBytes: this.inFlightCompressedBytes(),
      queuedTaskCount: this.readQueue.length,
      deferredFutureVoiceCount: [...this.voices.values()].filter((voice) => voice.capacityDeferred).length,
      decodeReservationBytes: this.decodeReservationsBytes(),
      retainedUniquePcmBytes: records.reduce((sum, record) => sum + record.bytes, 0),
      activeUniquePcmBytes: activeRecords.reduce((sum, record) => sum + record.bytes, 0),
      activeSourceCount: [...this.voices.values()].filter((voice) => Boolean(voice.source && voice.bufferRecord)).length,
      idleLruEntries: this.bufferCache.size,
      idleLruBytes: this.cacheBytes,
      recentOversizedEntries: this.recentOversized ? 1 : 0,
      recentOversizedPcmBytes: this.recentOversized?.bytes ?? 0,
      workingSetLimitBytes: PRODUCT_PREVIEW_AUDIO_WORKING_SET_BYTES,
      estimatedWorkingSetBytes: this.estimatedWorkingSetBytes(),
      peakEstimatedWorkingSetBytes: this.peakEstimatedWorkingSetBytes,
    };
  }

  private pump(): void {
    if (this.disposed || !this.latestInput?.playing) return;
    const waiting = [...this.voices.entries()]
      .filter(([, voice]) => voice.state === 'waiting' && !voice.capacityDeferred)
      .sort((left, right) => left[1].priority - right[1].priority ||
        left[1].clipStartMasterMs - right[1].clipStartMasterMs);
    for (const [key, voice] of waiting) {
      voice.state = 'loading';
      const input = this.latestInput;
      const assetKey = input ? this.decodedBufferKey(voice.selection, input) : null;
      const preparedRecord = assetKey ? this.getRetainedRecord(assetKey) : undefined;
      const taskKey = assetKey ? this.cacheEpoch + '\u0000' + assetKey : null;
      const sharedInFlightTask = taskKey ? this.readTasks.has(taskKey) : false;
      if (preparedRecord && this.context?.state === 'running') {
        // Prepared startup buffers must reach Web Audio in the same Overlay
        // commit as the master anchor, before React can defer its passive sync.
        this.startVoiceWithBuffer(key, voice, preparedRecord);
      } else if (voice.priority >= PREFETCH_PRIORITY && !sharedInFlightTask &&
          !this.canFitDecodedBuffer(this.estimatedDecodeBytes(voice.selection, this.context, undefined,
            this.latestInput ? this.waveProxyRange(voice.selection, this.latestInput) : null))) {
        voice.state = 'waiting';
        voice.capacityDeferred = true;
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
      const record = await this.requestBuffer(
        voice.selection,
        input,
        voice.consumerId,
        voice.priority,
      );
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
      this.startVoiceWithBuffer(key, voice, record, clockSample);
    } catch (error) {
      if (!this.isCurrentOwner(key, voice)) return;
      if (error instanceof AudioWorkingSetCapacityError && voice.priority >= PREFETCH_PRIORITY) {
        voice.state = 'waiting';
        voice.capacityDeferred = true;
        this.publishWarning();
        return;
      }
      voice.state = 'failed';
      this.publishWarning();
    } finally {
      this.detachConsumer(voice.consumerId);
    }
  }

  private startVoiceWithBuffer(
    key: string,
    voice: Voice,
    record: DecodedAudioBufferRecord,
    sampledClock?: ProductPreviewAudioClockSample,
  ): void {
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
      const sourceTimeMs = deltaMs > 0
        ? voice.selection.clip.offsetMs
        : productPreviewSourceTimeMs(shotLocalTime, voice.selection.clip, voice.selection.asset);
      const offsetMs = Math.max(0, sourceTimeMs - record.sourceStartMs);
      const activeFromMs = Math.max(shotLocalTime, voice.selection.clip.startMs);
      const durationMs = Math.min(
        voice.selection.clip.endMs - activeFromMs,
        record.buffer.duration * 1_000 - offsetMs,
      );
      if (durationMs <= 0) { voice.state = 'ended'; return; }

      const source = context.createBufferSource();
      voice.source = source;
      const gain = context.createGain();
      voice.gain = gain;
      record.voiceLeases.add(key);
      voice.bufferRecord = record;
      this.removeIdleRecord(record);
      source.buffer = record.buffer;
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
      this.releaseVoice(voice, false);
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
  ): Promise<DecodedAudioBufferRecord> {
    const assetKey = this.decodedBufferKey(selection, input);
    const waveProxyRange = this.waveProxyRange(selection, input);
    const retained = this.getRetainedRecord(assetKey);
    if (retained) {
      this.acquireConsumerLease(retained, consumerId);
      return Promise.resolve(retained);
    }
    const taskKey = this.cacheEpoch + '\u0000' + assetKey;
    let task = this.readTasks.get(taskKey);
    if (task) {
      task.consumers.add(consumerId);
      task.priority = Math.min(task.priority, priority);
      this.sortReadQueue();
      this.pumpReadQueue();
      return task.promise;
    }

    let resolve!: (record: DecodedAudioBufferRecord) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<DecodedAudioBufferRecord>((yes, no) => { resolve = yes; reject = no; });
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
      readByteLength: 0,
      additionalInFlightCompressedBytes: 0,
      decodeReservationBytes: 0,
      waveProxyRange,
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
      let context: ProductPreviewAudioContext;
      try {
        context = this.context ??= this.createContext();
      } catch (error) {
        this.dropQueuedTask(task, error instanceof Error ? error : new Error('Audio context unavailable.'));
        continue;
      }
      const reservation = this.estimatedDecodeBytes(task.selection, context, undefined, task.waveProxyRange);
      if (!this.reserveTaskBytes(task, reservation)) {
        if (task.priority < PREFETCH_PRIORITY) this.cancelPrewarmForCapacity(reservation);
        if (!this.reserveTaskBytes(task, reservation)) {
          this.dropQueuedTask(task, new AudioWorkingSetCapacityError());
          continue;
        }
      }
      task.status = 'reading';
      this.runReadTask(task, context);
    }
  }

  private runReadTask(task: AudioReadTask, context: ProductPreviewAudioContext): void {
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
      task.readByteLength = response.byteLength ?? response.bytes.byteLength;
      this.updatePeakWorkingSet();
      if (task.cancelBeforeDecode) throw new AudioWorkingSetCapacityError();
      if (task.consumers.size === 0) throw new Error('Obsolete queued audio decode.');
      const sourceBytes = response.bytes;
      const waveProxy = task.waveProxyRange
        ? this.createWavePreviewProxy(sourceBytes, task.waveProxyRange)
        : null;
      const decodeBytes = waveProxy?.bytes ?? sourceBytes;
      task.additionalInFlightCompressedBytes = waveProxy?.bytes.byteLength ?? 0;
      const decodeInput = decodeBytes.byteOffset === 0 &&
        decodeBytes.buffer instanceof ArrayBuffer &&
        decodeBytes.byteLength === decodeBytes.buffer.byteLength
        ? decodeBytes.buffer
        : Uint8Array.from(decodeBytes).buffer;
      if (decodeInput !== decodeBytes.buffer) {
        task.additionalInFlightCompressedBytes += decodeBytes.byteLength;
      }
      this.updatePeakWorkingSet();
      const mediaEstimate = this.estimatedDecodeBytes(task.selection, context, decodeBytes);
      if (!this.reserveTaskBytes(task, mediaEstimate)) {
        if (task.priority < PREFETCH_PRIORITY) this.cancelPrewarmForCapacity(mediaEstimate);
        if (!this.reserveTaskBytes(task, mediaEstimate)) throw new AudioWorkingSetCapacityError();
      }
      task.status = 'decoding';
      const buffer = await context.decodeAudioData(decodeInput);
      if (this.disposed || task.epoch !== this.cacheEpoch) throw new Error('Obsolete decode.');
      const bytes = this.bufferBytes(buffer);
      if (!this.reserveTaskBytes(task, bytes)) {
        task.decodeReservationBytes = bytes;
        this.updatePeakWorkingSet();
        throw new AudioWorkingSetCapacityError();
      }
      const record: DecodedAudioBufferRecord = {
        key: task.assetKey,
        buffer,
        bytes,
        sourceStartMs: waveProxy?.sourceStartMs ?? 0,
        epoch: task.epoch,
        voiceLeases: new Set(),
        consumerLeases: new Set(task.consumers),
        idleExpiresAtMs: null,
      };
      task.decodeReservationBytes = 0;
      this.bufferRecords.set(record.key, record);
      this.updatePeakWorkingSet();
      if (record.consumerLeases.size === 0) this.retainIdleRecord(record);
      return record;
    }).then((record) => {
      this.finishReadTask(task);
      task.resolve(record);
    }, (error: unknown) => {
      this.finishReadTask(task);
      task.reject(error);
    });
  }

  private finishReadTask(task: AudioReadTask): void {
    if (this.reads.get(task.key) === task.promise) this.reads.delete(task.key);
    if (this.readTasks.get(task.key) === task) this.readTasks.delete(task.key);
    task.decodeReservationBytes = 0;
    this.pumpReadQueue();
  }

  private discardObsoleteReadWork(): void {
    for (const task of [...this.readTasks.values()]) {
      if (task.epoch === this.cacheEpoch) continue;
      if (task.status === 'queued') {
        this.dropQueuedTask(task, new Error('Obsolete project audio read.'));
      } else if (task.status === 'reading') {
        task.cancelBeforeDecode = true;
        task.decodeReservationBytes = 0;
      }
    }
  }

  private reserveTaskBytes(task: AudioReadTask, targetBytes: number): boolean {
    const target = Math.max(0, Math.ceil(targetBytes));
    const delta = target - task.decodeReservationBytes;
    if (delta <= 0) {
      const previousReservation = task.decodeReservationBytes;
      task.decodeReservationBytes = target;
      if (this.estimatedWorkingSetBytes() > PRODUCT_PREVIEW_AUDIO_WORKING_SET_BYTES && !this.makeWorkingSetRoom(0)) {
        task.decodeReservationBytes = previousReservation;
        return false;
      }
      this.updatePeakWorkingSet();
      return true;
    }
    if (!this.makeWorkingSetRoom(delta)) return false;
    task.decodeReservationBytes = target;
    this.updatePeakWorkingSet();
    return true;
  }

  private makeWorkingSetRoom(additionalBytes: number): boolean {
    if (this.estimatedWorkingSetBytes() + additionalBytes <= PRODUCT_PREVIEW_AUDIO_WORKING_SET_BYTES) return true;
    while (this.estimatedWorkingSetBytes() + additionalBytes > PRODUCT_PREVIEW_AUDIO_WORKING_SET_BYTES) {
      if (!this.evictOldestIdleLruRecord() && !this.evictRecentOversizedRecord()) return false;
    }
    return true;
  }

  private cancelPrewarmForCapacity(additionalBytes: number): void {
    if (this.estimatedWorkingSetBytes() + additionalBytes <= PRODUCT_PREVIEW_AUDIO_WORKING_SET_BYTES) return;
    for (const candidate of [...this.readTasks.values()].sort((left, right) => right.sequence - left.sequence)) {
      if (candidate.priority < PREFETCH_PRIORITY) continue;
      if (candidate.status === 'queued') {
        this.dropQueuedTask(candidate, new AudioWorkingSetCapacityError());
      } else if (candidate.status === 'reading' && candidate.decodeReservationBytes > 0) {
        candidate.cancelBeforeDecode = true;
        candidate.decodeReservationBytes = 0;
      }
      if (this.estimatedWorkingSetBytes() + additionalBytes <= PRODUCT_PREVIEW_AUDIO_WORKING_SET_BYTES) return;
    }
  }

  private getRetainedRecord(key: string): DecodedAudioBufferRecord | undefined {
    const record = this.bufferRecords.get(key);
    if (!record) return undefined;
    if (record.epoch !== this.cacheEpoch ||
        (record === this.recentOversized && record.idleExpiresAtMs !== null && record.idleExpiresAtMs <= Date.now())) {
      this.removeRetainedRecord(record);
      return undefined;
    }
    return record;
  }

  private acquireConsumerLease(record: DecodedAudioBufferRecord, consumerId: string): void {
    this.removeIdleRecord(record);
    record.consumerLeases.add(consumerId);
  }

  private releaseConsumerLeases(consumerIds: readonly string[]): void {
    if (consumerIds.length === 0) return;
    const ids = new Set(consumerIds);
    for (const record of [...this.bufferRecords.values()]) {
      let changed = false;
      for (const id of ids) changed = record.consumerLeases.delete(id) || changed;
      if (changed) this.retainIdleRecord(record);
    }
  }

  private removeIdleRecord(record: DecodedAudioBufferRecord): void {
    if (this.bufferCache.has(record.key)) {
      this.bufferCache.delete(record.key);
      this.cacheBytes = Math.max(0, this.cacheBytes - record.bytes);
    }
    if (this.recentOversized === record) {
      this.recentOversized = null;
      if (this.recentOversizedTimer !== null) clearTimeout(this.recentOversizedTimer);
      this.recentOversizedTimer = null;
    }
    record.idleExpiresAtMs = null;
  }

  private retainIdleRecord(record: DecodedAudioBufferRecord): void {
    if (record.voiceLeases.size > 0 || record.consumerLeases.size > 0) return;
    if (this.disposed || record.epoch !== this.cacheEpoch || record.bytes > PRODUCT_PREVIEW_AUDIO_WORKING_SET_BYTES) {
      this.removeRetainedRecord(record);
      return;
    }
    this.removeIdleRecord(record);
    if (record.bytes <= PRODUCT_PREVIEW_AUDIO_CACHE_BYTES) {
      while (this.bufferCache.size >= PRODUCT_PREVIEW_AUDIO_CACHE_ENTRIES ||
          this.cacheBytes + record.bytes > PRODUCT_PREVIEW_AUDIO_CACHE_BYTES) {
        if (!this.evictOldestIdleLruRecord()) break;
      }
      if (this.cacheBytes + record.bytes <= PRODUCT_PREVIEW_AUDIO_CACHE_BYTES) {
        this.bufferCache.delete(record.key);
        this.bufferCache.set(record.key, record.buffer);
        this.cacheBytes += record.bytes;
        record.idleExpiresAtMs = null;
        this.updatePeakWorkingSet();
        return;
      }
      this.removeRetainedRecord(record);
      return;
    }
    this.setRecentOversizedRecord(record);
  }

  private setRecentOversizedRecord(record: DecodedAudioBufferRecord): void {
    if (record === this.recentOversized) {
      record.idleExpiresAtMs = Date.now() + PRODUCT_PREVIEW_AUDIO_RECENT_OVERSIZED_TTL_MS;
      this.scheduleRecentOversizedExpiry(record);
      return;
    }
    if (this.recentOversized) this.removeRetainedRecord(this.recentOversized);
    this.recentOversized = record;
    record.idleExpiresAtMs = Date.now() + PRODUCT_PREVIEW_AUDIO_RECENT_OVERSIZED_TTL_MS;
    this.scheduleRecentOversizedExpiry(record);
    this.updatePeakWorkingSet();
  }

  private scheduleRecentOversizedExpiry(record: DecodedAudioBufferRecord): void {
    if (this.recentOversizedTimer !== null) clearTimeout(this.recentOversizedTimer);
    this.recentOversizedTimer = setTimeout(() => {
      if (this.recentOversized === record) this.removeRetainedRecord(record);
    }, PRODUCT_PREVIEW_AUDIO_RECENT_OVERSIZED_TTL_MS);
    const unref = (this.recentOversizedTimer as unknown as { unref?: () => void }).unref;
    unref?.call(this.recentOversizedTimer);
  }

  private evictOldestIdleLruRecord(): boolean {
    const oldest = this.bufferCache.keys().next().value as string | undefined;
    if (oldest === undefined) return false;
    const record = this.bufferRecords.get(oldest);
    if (record) this.removeRetainedRecord(record);
    else {
      const buffer = this.bufferCache.get(oldest)!;
      this.bufferCache.delete(oldest);
      this.cacheBytes = Math.max(0, this.cacheBytes - this.bufferBytes(buffer));
    }
    return true;
  }

  private evictRecentOversizedRecord(): boolean {
    if (!this.recentOversized || this.recentOversized.voiceLeases.size > 0 ||
        this.recentOversized.consumerLeases.size > 0) return false;
    this.removeRetainedRecord(this.recentOversized);
    return true;
  }

  private removeRetainedRecord(record: DecodedAudioBufferRecord): void {
    this.removeIdleRecord(record);
    if (this.bufferRecords.get(record.key) === record) this.bufferRecords.delete(record.key);
  }

  private clearRetainedBuffers(): void {
    if (this.recentOversizedTimer !== null) clearTimeout(this.recentOversizedTimer);
    this.recentOversizedTimer = null;
    this.recentOversized = null;
    this.bufferCache.clear();
    this.bufferRecords.clear();
    this.cacheBytes = 0;
  }

  private estimatedDecodeBytes(
    selection: ProductPreviewAudioSelection,
    context: ProductPreviewAudioContext | null,
    sourceBytes?: Uint8Array,
    proxyRange: WaveProxyRange | null = null,
  ): number {
    const sampleRate = context?.sampleRate && Number.isFinite(context.sampleRate) && context.sampleRate > 0
      ? context.sampleRate
      : 48_000;
    const wave = sourceBytes ? this.readWaveMetadata(sourceBytes) : null;
    const channels = wave?.channels ?? 2;
    const durationSeconds = sourceBytes
      ? wave?.durationSeconds ?? Math.max(0, selection.asset.durationMs ?? 0) / 1_000
      : proxyRange ? proxyRange.durationMs / 1_000 : Math.max(0, selection.asset.durationMs ?? 0) / 1_000;
    const paddedFrames = Math.ceil((durationSeconds + 1) * sampleRate);
    return paddedFrames * channels * Float32Array.BYTES_PER_ELEMENT;
  }

  private readWaveMetadata(bytes: Uint8Array): WaveAudioMetadata | null {
    if (bytes.byteLength < 44 || String.fromCharCode(...bytes.subarray(0, 4)) !== 'RIFF' ||
        String.fromCharCode(...bytes.subarray(8, 12)) !== 'WAVE') return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let channels = 0;
    let sampleRate = 0;
    let blockAlign = 0;
    let formatCode = 0;
    let bitsPerSample = 0;
    let dataBytes = 0;
    let dataOffset: number | null = null;
    let formatChunkEnd: number | null = null;
    let dataChunkCount = 0;
    let chunkCount = 0;
    let firstChunkId = '';
    let secondChunkId = '';
    let dataChunkEnd: number | null = null;
    let completeChunks = true;
    for (let offset = 12; offset + 8 <= bytes.byteLength;) {
      const id = String.fromCharCode(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!);
      const chunkBytes = view.getUint32(offset + 4, true);
      const contentOffset = offset + 8;
      chunkCount += 1;
      if (chunkCount === 1) firstChunkId = id;
      else if (chunkCount === 2) secondChunkId = id;
      if (id === 'fmt ' && chunkBytes >= 16 && contentOffset + 16 <= bytes.byteLength) {
        formatCode = view.getUint16(contentOffset, true);
        channels = view.getUint16(contentOffset + 2, true);
        sampleRate = view.getUint32(contentOffset + 4, true);
        blockAlign = view.getUint16(contentOffset + 12, true);
        bitsPerSample = view.getUint16(contentOffset + 14, true);
      } else if (id === 'data') {
        dataChunkCount += 1;
        dataOffset ??= contentOffset;
        dataChunkEnd = contentOffset + chunkBytes + (chunkBytes % 2);
        dataBytes += Math.min(chunkBytes, Math.max(0, bytes.byteLength - contentOffset));
      }
      const next = contentOffset + chunkBytes + (chunkBytes % 2);
      if (next <= offset || next > bytes.byteLength) {
        completeChunks = false;
        break;
      }
      if (id === 'fmt ') formatChunkEnd = next;
      offset = next;
    }
    if (channels <= 0 || sampleRate <= 0 || blockAlign <= 0 || dataBytes <= 0) return null;
    const pcmWidthValid = bitsPerSample > 0 && bitsPerSample % 8 === 0 &&
      blockAlign === channels * (bitsPerSample / 8);
    const canonicalPcmChunks = completeChunks && chunkCount === 2 && firstChunkId === 'fmt ' &&
      secondChunkId === 'data' && dataChunkCount === 1 && dataOffset !== null && formatChunkEnd !== null &&
      dataChunkEnd === bytes.byteLength && view.getUint32(4, true) + 8 === bytes.byteLength &&
      (formatCode === 1 || formatCode === 3) && pcmWidthValid && dataBytes % blockAlign === 0;
    return { channels, sampleRate, blockAlign, durationSeconds: dataBytes / blockAlign / sampleRate,
      formatCode, bitsPerSample, dataBytes, dataOffset, formatChunkEnd, canonicalPcmChunks };
  }

  private waveProxyRange(
    selection: ProductPreviewAudioSelection,
    input: ProductPreviewAudioSyncInput,
  ): WaveProxyRange | null {
    const { asset, clip } = selection;
    const durationMs = clip.endMs - clip.startMs;
    const sourceStartMs = clip.offsetMs;
    if (clip.role !== 'bgm' || asset.mimeType !== 'audio/wav' ||
        (asset.durationMs ?? 0) < PRODUCT_PREVIEW_AUDIO_WAV_PROXY_MIN_SOURCE_MS ||
        durationMs <= 0 || durationMs > PRODUCT_PREVIEW_AUDIO_WAV_PROXY_MAX_CLIP_MS ||
        sourceStartMs < 0 || sourceStartMs + durationMs > (asset.durationMs ?? 0)) return null;

    let matchingUses = 0;
    for (const shot of input.project.shots) {
      for (const candidate of shot.audioClips) {
        if (candidate.assetId !== asset.id) continue;
        matchingUses += 1;
        if (candidate.offsetMs !== sourceStartMs || candidate.endMs - candidate.startMs !== durationMs) return null;
      }
    }
    return matchingUses > 0 ? { sourceStartMs, durationMs } : null;
  }

  private createWavePreviewProxy(bytes: Uint8Array, range: WaveProxyRange): WaveAudioPreviewProxy | null {
    const metadata = this.readWaveMetadata(bytes);
    if (!metadata?.canonicalPcmChunks || !metadata.dataOffset || !metadata.formatChunkEnd ||
        (metadata.formatCode !== 1 && metadata.formatCode !== 3)) return null;
    const totalFrames = metadata.dataBytes / metadata.blockAlign;
    const firstFrame = Math.min(totalFrames, Math.max(0, Math.round(range.sourceStartMs * metadata.sampleRate / 1_000)));
    const requestedEndMs = range.sourceStartMs + range.durationMs;
    const finalFrame = Math.min(totalFrames, Math.max(firstFrame,
      Math.round(requestedEndMs * metadata.sampleRate / 1_000)));
    if (finalFrame <= firstFrame) return null;

    const dataLength = (finalFrame - firstFrame) * metadata.blockAlign;
    const dataPadding = dataLength % 2;
    const dataHeaderOffset = metadata.formatChunkEnd;
    const proxy = new Uint8Array(dataHeaderOffset + 8 + dataLength + dataPadding);
    proxy.set(bytes.subarray(0, dataHeaderOffset));
    proxy.set([0x64, 0x61, 0x74, 0x61], dataHeaderOffset);
    const view = new DataView(proxy.buffer);
    view.setUint32(4, proxy.byteLength - 8, true);
    view.setUint32(dataHeaderOffset + 4, dataLength, true);
    const sourceDataStart = metadata.dataOffset + firstFrame * metadata.blockAlign;
    proxy.set(bytes.subarray(sourceDataStart, sourceDataStart + dataLength), dataHeaderOffset + 8);
    return { bytes: proxy, sourceStartMs: firstFrame * 1_000 / metadata.sampleRate };
  }

  private retainedPcmBytes(): number {
    return [...new Set(this.bufferRecords.values())].reduce((sum, record) => sum + record.bytes, 0);
  }

  private decodeReservationsBytes(): number {
    return [...this.readTasks.values()].reduce((sum, task) => sum + task.decodeReservationBytes, 0);
  }

  private estimatedWorkingSetBytes(): number {
    return this.retainedPcmBytes() + this.decodeReservationsBytes() + this.inFlightCompressedBytes();
  }

  private canFitDecodedBuffer(bytes: number): boolean {
    if (bytes > PRODUCT_PREVIEW_AUDIO_WORKING_SET_BYTES) return false;
    const reclaimable = [...this.bufferRecords.values()]
      .filter((record) => record.voiceLeases.size === 0 && record.consumerLeases.size === 0)
      .reduce((sum, record) => sum + record.bytes, 0);
    return this.estimatedWorkingSetBytes() - reclaimable + bytes <= PRODUCT_PREVIEW_AUDIO_WORKING_SET_BYTES;
  }

  private inFlightCompressedBytes(): number {
    return [...this.readTasks.values()].reduce((sum, task) =>
      sum + (task.status === 'reading' || task.status === 'decoding'
        ? task.readByteLength + task.additionalInFlightCompressedBytes
        : 0), 0);
  }

  private updatePeakWorkingSet(): void {
    this.peakEstimatedWorkingSetBytes = Math.max(this.peakEstimatedWorkingSetBytes, this.estimatedWorkingSetBytes());
  }

  private retryCapacityDeferredVoices(): void {
    const input = this.latestInput;
    for (const voice of this.voices.values()) {
      if (!voice.capacityDeferred) continue;
      const assetKey = input ? this.decodedBufferKey(voice.selection, input) : null;
      if ((assetKey && this.getRetainedRecord(assetKey)) ||
          this.canFitDecodedBuffer(this.estimatedDecodeBytes(voice.selection, this.context, undefined,
            input ? this.waveProxyRange(voice.selection, input) : null))) {
        voice.capacityDeferred = false;
      }
    }
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
    this.releaseConsumerLeases(consumerIds);
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
          clipEndMasterMs: clip.endMs, priority: clip.startMs <= position
            ? CURRENT_PLAYBACK_PRIORITY
            : PREFETCH_PRIORITY });
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
          priority: clipStartMasterMs <= position ? CURRENT_PLAYBACK_PRIORITY : PREFETCH_PRIORITY });
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

  private decodedBufferKey(selection: ProductPreviewAudioSelection, input: ProductPreviewAudioSyncInput): string {
    const assetKey = this.assetKey(selection, input);
    const range = this.waveProxyRange(selection, input);
    if (!range) return assetKey;
    return [assetKey, 'wav-pcm-preview-proxy-v1', selection.asset.mimeType,
      range.sourceStartMs, range.durationMs].join('\u0000');
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
    this.releaseVoiceBufferLease(voice);
  }

  private releaseVoiceBufferLease(voice: Voice): void {
    const record = voice.bufferRecord;
    if (!record) return;
    record.voiceLeases.delete(voice.key);
    voice.bufferRecord = undefined;
    this.retainIdleRecord(record);
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
    this.releaseConsumerLeases(consumerIds);
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
