import { describe, expect, it, vi } from 'vitest';
import { ProjectSchema, type AudioAsset, type Project } from '../../src/domain';
import type { AssetPreviewAudioReadRequest, AssetPreviewAudioReadResponse } from '../../src/shared/asset-preview-audio-api';
import {
  ProductPreviewAudioTransport,
  PRODUCT_PREVIEW_AUDIO_CACHE_BYTES,
  PRODUCT_PREVIEW_AUDIO_RECENT_OVERSIZED_TTL_MS,
  PRODUCT_PREVIEW_AUDIO_WORKING_SET_BYTES,
  type ProductPreviewAudioContext,
  type ProductPreviewAudioSyncInput,
} from '../../src/renderer/shell/productPreviewAudio';
import { buildProject } from './domain/testProject';

const LONG_AUDIO_ID = '10000000-0000-4000-8000-000000008860';
const FIRST_CLIP_ID = '70000000-0000-4000-8000-000000008860';
const SECOND_CLIP_ID = '70000000-0000-4000-8000-000000008861';
const PROJECT_ROOT = 'D:\\PandaStage-Acceptance\\issue886-au03\\fixture.pandastage';
const DURATION_SECONDS = 180;

function buildLongAudioProject(sampleRate: 48_000 | 44_100): Project {
  const project = buildProject();
  project.assets.push({
    id: LONG_AUDIO_ID,
    kind: 'audio',
    name: `Original ${sampleRate} Hz stereo fixture`,
    relativePath: `assets/au03-${sampleRate}.wav`,
    mimeType: 'audio/wav',
    sha256: '8'.repeat(64),
    durationMs: DURATION_SECONDS * 1_000,
  });
  const first = project.shots[0]!;
  first.durationMs = DURATION_SECONDS * 1_000;
  first.audioClips = [{
    id: FIRST_CLIP_ID,
    role: 'bgm',
    name: 'Same long BGM, first Shot',
    assetId: LONG_AUDIO_ID,
    startMs: 0,
    endMs: DURATION_SECONDS * 1_000,
    offsetMs: 0,
    volume: 0.4,
  }];
  const next = structuredClone(first);
  const layerIds = new Map(next.layers.map((layer, index) => [layer.id,
    `60000000-0000-4000-8000-${String(8_860 + index).padStart(12, '0')}`]));
  next.id = '50000000-0000-4000-8000-000000008861';
  next.name = 'Same long BGM, next Shot';
  next.layers = next.layers.map((layer) => ({ ...layer, id: layerIds.get(layer.id)! }));
  next.backgroundLayerId = next.backgroundLayerId ? layerIds.get(next.backgroundLayerId) ?? null : null;
  next.audioClips = [{ ...next.audioClips[0]!, id: SECOND_CLIP_ID, name: 'Same long BGM, next Shot' }];
  project.shots.push(next);
  return ProjectSchema.parse(project);
}

function inputAt(project: Project, projectTimeMs: number, playing: boolean, seekRevision = 0): ProductPreviewAudioSyncInput {
  let startMs = 0;
  let shot = project.shots[0]!;
  for (const candidate of project.shots) {
    if (projectTimeMs < startMs + candidate.durationMs || candidate === project.shots.at(-1)) {
      shot = candidate;
      break;
    }
    startMs += candidate.durationMs;
  }
  const shotLocalTimeMs = Math.max(0, projectTimeMs - startMs);
  return {
    projectRoot: PROJECT_ROOT,
    project,
    shot,
    range: 'project',
    playing,
    seekRevision,
    readMasterSnapshot: (sampledAtMs) => ({
      projectRoot: PROJECT_ROOT,
      projectId: project.id,
      range: 'project',
      shotId: shot.id,
      timeMs: shotLocalTimeMs,
      projectTimeMs,
      sampledAtMs,
      playing,
      clockGeneration: seekRevision,
    }),
  };
}

function decodedBuffer(sampleRate: number, durationSeconds = DURATION_SECONDS): AudioBuffer {
  const length = sampleRate * durationSeconds;
  return { duration: durationSeconds, length, numberOfChannels: 2, sampleRate } as AudioBuffer;
}

class WorkingSetContext {
  state: AudioContextState = 'running';
  currentTime = 10;
  destination = {} as AudioDestinationNode;
  decodedBuffers: AudioBuffer[] = [];
  sources: Array<{ buffer: AudioBuffer | null; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }> = [];
  durationForInput: ((input: ArrayBuffer) => number) | null = null;
  decodeAudioData = vi.fn(async (input?: ArrayBuffer) => {
    const durationSeconds = input && this.durationForInput ? this.durationForInput(input) : DURATION_SECONDS;
    const result = decodedBuffer(this.sampleRate, durationSeconds);
    this.decodedBuffers.push(result);
    return result;
  });
  resume = vi.fn(async () => { this.state = 'running'; });
  close = vi.fn(async () => { this.state = 'closed'; });
  constructor(readonly sampleRate: number) {}
  createBufferSource = () => {
    const source = { buffer: null as AudioBuffer | null, onended: null as (() => void) | null,
      connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn() };
    this.sources.push(source);
    return source as unknown as AudioBufferSourceNode;
  };
  createGain = () => ({ gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() }) as unknown as GainNode;
  api(): ProductPreviewAudioContext { return this as unknown as ProductPreviewAudioContext; }
}

function ready(request: AssetPreviewAudioReadRequest): AssetPreviewAudioReadResponse {
  return { ok: true, status: 'ready', assetId: request.assetId, mimeType: 'audio/wav',
    byteLength: 4, bytes: new Uint8Array([1, 2, 3, 4]) };
}

function pcmWave(sampleRate: number, channels: number, durationSeconds: number): Uint8Array<ArrayBuffer> {
  const bitsPerSample = 16;
  const blockAlign = channels * bitsPerSample / 8;
  const dataBytes = sampleRate * durationSeconds * blockAlign;
  const bytes = new Uint8Array(44 + dataBytes);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  bytes.set([0x57, 0x41, 0x56, 0x45], 8);
  bytes.set([0x66, 0x6d, 0x74, 0x20], 12);
  bytes.set([0x64, 0x61, 0x74, 0x61], 36);
  const view = new DataView(bytes.buffer);
  view.setUint32(4, bytes.byteLength - 8, true);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  view.setUint32(40, dataBytes, true);
  return bytes;
}

function readyWithBytes(request: AssetPreviewAudioReadRequest, bytes: Uint8Array<ArrayBuffer>): AssetPreviewAudioReadResponse {
  return { ok: true, status: 'ready', assetId: request.assetId, mimeType: 'audio/wav',
    byteLength: bytes.byteLength, bytes };
}

function waveDurationSeconds(input: ArrayBuffer): number {
  const view = new DataView(input);
  const sampleRate = view.getUint32(24, true);
  const blockAlign = view.getUint16(32, true);
  const dataBytes = view.getUint32(40, true);
  return dataBytes / blockAlign / sampleRate;
}

function measure(context: WorkingSetContext, transport: ProductPreviewAudioTransport,
  readAudio: ReturnType<typeof vi.fn>) {
  const state = transport.getWorkingSetSnapshot();
  const activeBuffers = new Set(context.sources
    .filter((source) => source.start.mock.calls.length > 0 && source.stop.mock.calls.length === 0 && source.buffer)
    .map((source) => source.buffer));
  return {
    reads: readAudio.mock.calls.length,
    decodes: context.decodedBuffers.length,
    uniqueDecodedPcmBytes: context.decodedBuffers.reduce((sum, value) =>
      sum + value.length * value.numberOfChannels * Float32Array.BYTES_PER_ELEMENT, 0),
    idleLruEntries: state.idleLruEntries,
    idleLruBytes: state.idleLruBytes,
    actualInFlightReads: state.actualInFlightReadCount + state.inFlightDecodeCount,
    activeSourceCount: activeBuffers.size,
    activeUniquePcmBytes: [...activeBuffers].reduce((sum, value) =>
      sum + value!.length * value!.numberOfChannels * Float32Array.BYTES_PER_ELEMENT, 0),
    retainedUniquePcmBytes: state.retainedUniquePcmBytes,
    recentOversizedEntries: state.recentOversizedEntries,
    recentOversizedPcmBytes: state.recentOversizedPcmBytes,
    estimatedWorkingSetBytes: state.estimatedWorkingSetBytes,
    peakEstimatedWorkingSetBytes: state.peakEstimatedWorkingSetBytes,
  };
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

describe('Issue #886 AU-03 bounded audio working set', () => {
  it.each([
    { sampleRate: 48_000 as const, expectedPcmBytes: 69_120_000, aboveIdleLimit: true },
    { sampleRate: 44_100 as const, expectedPcmBytes: 63_504_000, aboveIdleLimit: false },
  ])('$sampleRate Hz source reuses the prepared AudioBuffer across start and pause/resume', async ({
    sampleRate, expectedPcmBytes, aboveIdleLimit,
  }) => {
    expect(sampleRate * DURATION_SECONDS * 2 * Float32Array.BYTES_PER_ELEMENT).toBe(expectedPcmBytes);
    expect(expectedPcmBytes > PRODUCT_PREVIEW_AUDIO_CACHE_BYTES).toBe(aboveIdleLimit);

    const project = buildLongAudioProject(sampleRate);
    const context = new WorkingSetContext(sampleRate);
    const readAudio = vi.fn(async (request: AssetPreviewAudioReadRequest) => ready(request));
    const transport = new ProductPreviewAudioTransport({ createContext: () => context.api(), readAudio });
    try {
      await expect(transport.prepareForPlayback(inputAt(project, 0, false), 0))
        .resolves.toMatchObject({ ready: true, reason: 'ready' });
      expect(context.decodedBuffers).toHaveLength(1);

      transport.sync(inputAt(project, 0, true));
      await flush();
      const firstStartedSource = context.sources.find((source) => source.start.mock.calls.length > 0);
      const startMeasurement = {
        ...measure(context, transport, readAudio),
        sameBufferAsPreparation: firstStartedSource?.buffer === context.decodedBuffers[0],
      };

      transport.sync(inputAt(project, 500, false));
      const pausedMeasurement = transport.getWorkingSetSnapshot();
      expect(pausedMeasurement).toMatchObject({
        actualInFlightReadCount: 0,
        inFlightDecodeCount: 0,
        activeUniquePcmBytes: 0,
        activeSourceCount: 0,
        idleLruEntries: aboveIdleLimit ? 0 : 1,
        idleLruBytes: aboveIdleLimit ? 0 : expectedPcmBytes,
        recentOversizedEntries: aboveIdleLimit ? 1 : 0,
        recentOversizedPcmBytes: aboveIdleLimit ? expectedPcmBytes : 0,
        retainedUniquePcmBytes: expectedPcmBytes,
        estimatedWorkingSetBytes: expectedPcmBytes,
      });
      transport.sync(inputAt(project, 500, true));
      await flush();
      transport.sync(inputAt(project, 1_000, true, 1));
      await flush();
      transport.sync(inputAt(project, 0, true, 2));
      await flush();
      const resumedSource = [...context.sources].reverse().find((source) => source.start.mock.calls.length > 0);
      const resumeMeasurement = {
        ...measure(context, transport, readAudio),
        sameBufferAsPreparation: resumedSource?.buffer === context.decodedBuffers[0],
      };
      const expectedMeasurement = { reads: 1, decodes: 1, uniqueDecodedPcmBytes: expectedPcmBytes,
        idleLruEntries: 0, idleLruBytes: 0,
        actualInFlightReads: 0, activeSourceCount: 1, activeUniquePcmBytes: expectedPcmBytes,
        retainedUniquePcmBytes: expectedPcmBytes,
        recentOversizedEntries: 0, recentOversizedPcmBytes: 0,
        estimatedWorkingSetBytes: expectedPcmBytes,
        peakEstimatedWorkingSetBytes: expect.any(Number),
        sameBufferAsPreparation: true };
      expect({ pcmBytes: expectedPcmBytes, start: startMeasurement, pauseResume: resumeMeasurement })
        .toEqual({ pcmBytes: expectedPcmBytes, start: expectedMeasurement, pauseResume: expectedMeasurement });
      expect(startMeasurement.peakEstimatedWorkingSetBytes).toBeLessThanOrEqual(PRODUCT_PREVIEW_AUDIO_WORKING_SET_BYTES);
      expect(resumeMeasurement.peakEstimatedWorkingSetBytes).toBeLessThanOrEqual(PRODUCT_PREVIEW_AUDIO_WORKING_SET_BYTES);
    } finally {
      transport.dispose();
    }
  });

  it('decodes a sample-aligned, interval-bound WAV proxy for a short long-BGM clip and shares it across matching Shots', async () => {
    const project = buildLongAudioProject(48_000);
    const asset = project.assets.find((candidate): candidate is AudioAsset =>
      candidate.id === LONG_AUDIO_ID && candidate.kind === 'audio')!;
    asset.durationMs = 60_000;
    const sourceRangeStartMs = 1_250;
    const clipDurationMs = 8_000;
    for (const shot of project.shots.slice(0, 2)) {
      shot.durationMs = clipDurationMs;
      const clip = shot.audioClips.find((candidate) => candidate.assetId === LONG_AUDIO_ID)!;
      clip.startMs = 0;
      clip.endMs = clipDurationMs;
      clip.offsetMs = sourceRangeStartMs;
    }
    ProjectSchema.parse(project);

    const sourceBytes = pcmWave(8_000, 2, 60);
    const sourceView = new DataView(sourceBytes.buffer);
    const firstSourceFrame = sourceRangeStartMs * 8;
    const lastSourceFrame = firstSourceFrame + clipDurationMs * 8 - 1;
    sourceView.setInt16(44 + firstSourceFrame * 4, 1_234, true);
    sourceView.setInt16(44 + lastSourceFrame * 4, -2_345, true);

    const context = new WorkingSetContext(48_000);
    context.durationForInput = waveDurationSeconds;
    const readAudio = vi.fn(async (request: AssetPreviewAudioReadRequest) => readyWithBytes(request, sourceBytes));
    const transport = new ProductPreviewAudioTransport({ createContext: () => context.api(), readAudio });
    try {
      await expect(transport.prepareForPlayback(inputAt(project, 0, false), 0))
        .resolves.toMatchObject({ ready: true, reason: 'ready' });
      const decodeInput = context.decodeAudioData.mock.calls[0]?.[0];
      expect(decodeInput).toBeInstanceOf(ArrayBuffer);
      const proxyBytes = new Uint8Array(decodeInput!);
      const proxyView = new DataView(decodeInput!);
      const proxyFrames = clipDurationMs * 8;
      expect(proxyBytes.byteLength).toBe(44 + proxyFrames * 4);
      expect(proxyView.getUint32(4, true) + 8).toBe(proxyBytes.byteLength);
      expect(proxyView.getUint32(24, true)).toBe(8_000);
      expect(proxyView.getUint16(22, true)).toBe(2);
      expect(proxyView.getUint32(40, true)).toBe(proxyFrames * 4);
      expect(proxyView.getInt16(44, true)).toBe(1_234);
      expect(proxyView.getInt16(44 + (proxyFrames - 1) * 4, true)).toBe(-2_345);
      expect(context.decodedBuffers[0]?.duration).toBe(clipDurationMs / 1_000);

      transport.sync(inputAt(project, 0, true));
      const preparedProxyBuffer = context.decodedBuffers.find((buffer) => buffer.duration === clipDurationMs / 1_000);
      expect(context.sources.some((source) => source.buffer === preparedProxyBuffer &&
        source.start.mock.calls.length === 1)).toBe(true);
      await flush();
      transport.sync(inputAt(project, clipDurationMs - 200, true));
      await flush();
      const started = context.sources.filter((source) => source.start.mock.calls.length > 0 &&
        source.stop.mock.calls.length === 0 && source.buffer);
      expect(readAudio).toHaveBeenCalledTimes(1);
      expect(context.decodeAudioData).toHaveBeenCalledTimes(1);
      expect(started).toHaveLength(2);
      expect(new Set(started.map((source) => source.buffer)).size).toBe(1);
      expect(transport.getWorkingSetSnapshot()).toMatchObject({
        activeSourceCount: 2,
        activeUniquePcmBytes: 3_072_000,
        retainedUniquePcmBytes: 3_072_000,
        estimatedWorkingSetBytes: 3_072_000,
      });
    } finally {
      transport.dispose();
    }
  });

  it('counts both the original WAV and its bounded proxy while native decode is in flight', async () => {
    const project = buildLongAudioProject(48_000);
    const asset = project.assets.find((candidate): candidate is AudioAsset =>
      candidate.id === LONG_AUDIO_ID && candidate.kind === 'audio')!;
    asset.durationMs = 60_000;
    const sourceRangeStartMs = 1_250;
    const clipDurationMs = 8_000;
    for (const shot of project.shots.slice(0, 2)) {
      shot.durationMs = clipDurationMs;
      const clip = shot.audioClips.find((candidate) => candidate.assetId === LONG_AUDIO_ID)!;
      clip.startMs = 0;
      clip.endMs = clipDurationMs;
      clip.offsetMs = sourceRangeStartMs;
    }
    ProjectSchema.parse(project);

    const sourceBytes = pcmWave(8_000, 2, 60);
    const context = new WorkingSetContext(48_000);
    context.durationForInput = waveDurationSeconds;
    let finishDecode!: (buffer: AudioBuffer) => void;
    const pendingDecode = new Promise<AudioBuffer>((resolve) => { finishDecode = resolve; });
    context.decodeAudioData.mockReturnValue(pendingDecode);
    const readAudio = vi.fn(async (request: AssetPreviewAudioReadRequest) => readyWithBytes(request, sourceBytes));
    const transport = new ProductPreviewAudioTransport({ createContext: () => context.api(), readAudio });
    try {
      transport.sync(inputAt(project, 0, true));
      await flushMicrotasks();

      const proxyByteLength = 44 + clipDurationMs * 8 * 4;
      expect(context.decodeAudioData).toHaveBeenCalledTimes(1);
      expect(transport.getWorkingSetSnapshot()).toMatchObject({
        actualInFlightReadCount: 0,
        inFlightDecodeCount: 1,
        inFlightCompressedBytes: sourceBytes.byteLength + proxyByteLength,
      });
      expect(transport.getWorkingSetSnapshot().estimatedWorkingSetBytes).toBeLessThanOrEqual(
        PRODUCT_PREVIEW_AUDIO_WORKING_SET_BYTES);

      finishDecode(decodedBuffer(48_000, clipDurationMs / 1_000));
      await flush();
      expect(transport.getWorkingSetSnapshot()).toMatchObject({
        inFlightDecodeCount: 0,
        inFlightCompressedBytes: 0,
        activeUniquePcmBytes: 3_072_000,
      });
    } finally {
      if (finishDecode) finishDecode(decodedBuffer(48_000, clipDurationMs / 1_000));
      await flush();
      transport.dispose();
    }
  });

  it('coalesces two immediate next-Shot uses of the same large source into one decode and one shared data object', async () => {
    const project = buildLongAudioProject(48_000);
    const context = new WorkingSetContext(48_000);
    const readAudio = vi.fn(async (request: AssetPreviewAudioReadRequest) => ready(request));
    const transport = new ProductPreviewAudioTransport({ createContext: () => context.api(), readAudio });
    try {
      transport.sync(inputAt(project, 179_800, true));
      await flush();
      expect(readAudio).toHaveBeenCalledTimes(1);
      expect(context.decodedBuffers).toHaveLength(1);
      const started = context.sources.filter((source) => source.start.mock.calls.length > 0);
      expect(started).toHaveLength(2);
      expect(started[0]!.buffer).toBe(started[1]!.buffer);
      expect(transport.getWorkingSetSnapshot()).toMatchObject({
        activeSourceCount: 2,
        activeUniquePcmBytes: 69_120_000,
        retainedUniquePcmBytes: 69_120_000,
        estimatedWorkingSetBytes: 69_120_000,
      });
    } finally {
      transport.dispose();
    }
  });

  it('accounts for reserved PCM, compressed read bytes, and active decode work in flight', async () => {
    const project = buildLongAudioProject(48_000);
    const context = new WorkingSetContext(48_000);
    let resolveRead!: (response: AssetPreviewAudioReadResponse) => void;
    const pendingRead = new Promise<AssetPreviewAudioReadResponse>((resolve) => { resolveRead = resolve; });
    let resolveDecode!: (buffer: AudioBuffer) => void;
    const pendingDecode = new Promise<AudioBuffer>((resolve) => { resolveDecode = resolve; });
    context.decodeAudioData.mockReturnValue(pendingDecode);
    const readAudio = vi.fn(() => pendingRead);
    const transport = new ProductPreviewAudioTransport({ createContext: () => context.api(), readAudio });
    try {
      transport.sync(inputAt(project, 0, true));
      expect(transport.getWorkingSetSnapshot()).toMatchObject({
        actualInFlightReadCount: 1,
        inFlightDecodeCount: 0,
        inFlightCompressedBytes: 0,
        decodeReservationBytes: 69_504_000,
        retainedUniquePcmBytes: 0,
      });
      expect(transport.getWorkingSetSnapshot().estimatedWorkingSetBytes).toBeLessThanOrEqual(
        PRODUCT_PREVIEW_AUDIO_WORKING_SET_BYTES);

      resolveRead(ready({ projectRoot: PROJECT_ROOT, assetId: LONG_AUDIO_ID, sha256: '8'.repeat(64) }));
      await flushMicrotasks();
      expect(transport.getWorkingSetSnapshot()).toMatchObject({
        actualInFlightReadCount: 0,
        inFlightDecodeCount: 1,
        inFlightCompressedBytes: 4,
        decodeReservationBytes: 69_504_000,
        estimatedWorkingSetBytes: 69_504_004,
      });

      resolveDecode(decodedBuffer(48_000));
      await flush();
      expect(transport.getWorkingSetSnapshot()).toMatchObject({
        actualInFlightReadCount: 0,
        inFlightDecodeCount: 0,
        inFlightCompressedBytes: 0,
        decodeReservationBytes: 0,
        activeUniquePcmBytes: 69_120_000,
        retainedUniquePcmBytes: 69_120_000,
        estimatedWorkingSetBytes: 69_120_000,
      });
    } finally {
      transport.dispose();
    }
  });

  it('keeps current dialogue and SFX while deferring a second over-budget future BGM', async () => {
    const project = buildLongAudioProject(48_000);
    const first = project.shots[0]!;
    const longAsset = project.assets.find((asset) => asset.id === LONG_AUDIO_ID && asset.kind === 'audio') as AudioAsset;
    const secondLongId = '10000000-0000-4000-8000-000000008861';
    const dialogueId = '10000000-0000-4000-8000-000000008862';
    const sfxId = '10000000-0000-4000-8000-000000008863';
    project.assets.push(
      { ...longAsset, id: secondLongId, name: 'Future long BGM', relativePath: 'assets/future.wav', sha256: '9'.repeat(64) },
      { ...longAsset, id: dialogueId, name: 'Current dialogue', relativePath: 'assets/dialogue.wav',
        sha256: 'a'.repeat(64), durationMs: 1_000 },
      { ...longAsset, id: sfxId, name: 'Current SFX', relativePath: 'assets/sfx.wav',
        sha256: 'b'.repeat(64), durationMs: 1_000 },
    );
    const template = first.audioClips[0]!;
    first.audioClips.push(
      { ...template, id: '70000000-0000-4000-8000-000000008862', name: 'Future long BGM',
        assetId: secondLongId, startMs: 300 },
      { ...template, id: '70000000-0000-4000-8000-000000008863', role: 'dialogue',
        name: 'Current dialogue', assetId: dialogueId, endMs: 1_000, volume: 1 },
      { ...template, id: '70000000-0000-4000-8000-000000008864', role: 'sfx',
        name: 'Current SFX', assetId: sfxId, endMs: 1_000, volume: 1 },
    );
    ProjectSchema.parse(project);

    const markers = new Map([[LONG_AUDIO_ID, 1], [secondLongId, 2], [dialogueId, 3], [sfxId, 4]]);
    const context = new WorkingSetContext(48_000);
    context.durationForInput = (input) => {
      const marker = new Uint8Array(input)[0];
      return marker === 1 || marker === 2 ? DURATION_SECONDS : 1;
    };
    const readAudio = vi.fn(async (request: AssetPreviewAudioReadRequest) => ({
      ...ready(request),
      bytes: new Uint8Array([markers.get(request.assetId) ?? 0, 2, 3, 4]),
    }));
    const warnings: (string | null)[] = [];
    const transport = new ProductPreviewAudioTransport({ createContext: () => context.api(), readAudio,
      onWarning: (message) => warnings.push(message) });
    try {
      transport.sync(inputAt(project, 0, true));
      await flush();
      const state = transport.getWorkingSetSnapshot();
      expect(readAudio.mock.calls.map(([request]) => request.assetId)).toEqual([LONG_AUDIO_ID, dialogueId, sfxId]);
      expect(context.decodedBuffers.map((buffer) => buffer.duration)).toEqual([180, 1, 1]);
      expect(context.sources.filter((source) => source.start.mock.calls.length > 0)).toHaveLength(3);
      expect(state).toMatchObject({
        activeSourceCount: 3,
        activeUniquePcmBytes: 69_888_000,
        retainedUniquePcmBytes: 69_888_000,
        deferredFutureVoiceCount: 1,
        actualInFlightReadCount: 0,
        inFlightDecodeCount: 0,
        queuedTaskCount: 0,
      });
      expect(state.estimatedWorkingSetBytes).toBeLessThanOrEqual(PRODUCT_PREVIEW_AUDIO_WORKING_SET_BYTES);
      expect(warnings.filter(Boolean)).toEqual([]);
    } finally {
      transport.dispose();
    }
  });

  it('expires an idle oversized record after its bounded recent window', async () => {
    vi.useFakeTimers();
    const project = buildLongAudioProject(48_000);
    const context = new WorkingSetContext(48_000);
    const transport = new ProductPreviewAudioTransport({ createContext: () => context.api(),
      readAudio: async (request) => ready(request) });
    try {
      transport.sync(inputAt(project, 0, true));
      await flushMicrotasks();
      transport.sync(inputAt(project, 100, false));
      expect(transport.getWorkingSetSnapshot()).toMatchObject({
        recentOversizedEntries: 1,
        recentOversizedPcmBytes: 69_120_000,
      });
      await vi.advanceTimersByTimeAsync(PRODUCT_PREVIEW_AUDIO_RECENT_OVERSIZED_TTL_MS + 1);
      expect(transport.getWorkingSetSnapshot()).toMatchObject({
        recentOversizedEntries: 0,
        retainedUniquePcmBytes: 0,
        estimatedWorkingSetBytes: 0,
      });
    } finally {
      transport.dispose();
      vi.useRealTimers();
    }
  });

  it('releases each closed session working set across ten open/close cycles', async () => {
    const project = buildLongAudioProject(48_000);
    const readAudio = vi.fn(async (request: AssetPreviewAudioReadRequest) => ready(request));
    for (let cycle = 0; cycle < 10; cycle += 1) {
      const context = new WorkingSetContext(48_000);
      const transport = new ProductPreviewAudioTransport({ createContext: () => context.api(), readAudio });
      transport.sync(inputAt(project, 0, true));
      await flush();
      expect(transport.getWorkingSetSnapshot().activeUniquePcmBytes).toBe(69_120_000);
      transport.dispose();
      expect(context.close).toHaveBeenCalledTimes(1);
      expect(context.sources.every((source) => source.buffer === null)).toBe(true);
      expect(transport.getWorkingSetSnapshot()).toMatchObject({
        retainedUniquePcmBytes: 0,
        activeUniquePcmBytes: 0,
        activeSourceCount: 0,
        idleLruEntries: 0,
        recentOversizedEntries: 0,
        decodeReservationBytes: 0,
      });
    }
    expect(readAudio).toHaveBeenCalledTimes(10);
  });
});
