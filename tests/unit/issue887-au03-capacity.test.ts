import { ProjectSchema, type AudioAsset, type Project } from '../../src/domain';
import { describe, expect, it, vi } from 'vitest';
import type { AssetPreviewAudioReadRequest, AssetPreviewAudioReadResponse } from '../../src/shared/asset-preview-audio-api';
import {
  ProductPreviewAudioTransport,
  PRODUCT_PREVIEW_AUDIO_WORKING_SET_BYTES,
  type ProductPreviewAudioContext,
  type ProductPreviewAudioSyncInput,
} from '../../src/renderer/shell/productPreviewAudio';
import { buildProject } from './domain/testProject';

const PROJECT_ROOT = 'D:\\PandaStage-Acceptance\\issue887-au03\\capacity.pandastage';
const FOUR_MINUTE_ID = '10000000-0000-4000-8000-000000008870';
const FIRST_BGM_ID = '10000000-0000-4000-8000-000000008871';
const SECOND_BGM_ID = '10000000-0000-4000-8000-000000008872';

interface AudioSpec {
  id: string;
  name: string;
  relativePath: string;
  durationMs: number;
  sha256: string;
  mimeType?: string;
}

interface ClipSpec {
  assetId: string;
  startMs: number;
  endMs: number;
  offsetMs?: number;
}

function cloneShot(source: Project['shots'][number], id: string, name: string): Project['shots'][number] {
  const shot = structuredClone(source);
  const layerIds = new Map(shot.layers.map((layer, index) => [layer.id,
    `60000000-0000-4000-8000-${String(8_870 + index).padStart(12, '0')}`]));
  shot.id = id;
  shot.name = name;
  shot.layers = shot.layers.map((layer) => ({ ...layer, id: layerIds.get(layer.id)! }));
  shot.backgroundLayerId = shot.backgroundLayerId ? layerIds.get(shot.backgroundLayerId) ?? null : null;
  shot.dialogues = [];
  shot.timelineEvents = [];
  shot.audioClips = [];
  return shot;
}

function makeProject(name: string, durationsMs: number[], assets: AudioSpec[], clipLists: ClipSpec[][]): Project {
  const project = buildProject();
  const first = project.shots[0]!;
  project.assets = project.assets.filter((asset) => asset.kind === 'image');
  project.assets.push(...assets.map((spec) => ({
    id: spec.id,
    kind: 'audio' as const,
    name: spec.name,
    relativePath: spec.relativePath,
    durationMs: spec.durationMs,
    sha256: spec.sha256,
    mimeType: spec.mimeType ?? 'audio/wav',
  } satisfies AudioAsset)));

  const shots = durationsMs.map((durationMs, index) => {
    const shot = index === 0 ? first : cloneShot(first, `50000000-0000-4000-8000-${String(8_870 + index).padStart(12, '0')}`,
      `${name} Shot ${index + 1}`);
    shot.durationMs = durationMs;
    shot.name = `${name} Shot ${index + 1}`;
    shot.audioClips = (clipLists[index] ?? []).map((clip, clipIndex) => ({
      id: `70000000-0000-4000-8000-${String(8_870 + index * 10 + clipIndex).padStart(12, '0')}`,
      role: 'bgm' as const,
      name: `${name} clip ${clipIndex + 1}`,
      assetId: clip.assetId,
      startMs: clip.startMs,
      endMs: clip.endMs,
      offsetMs: clip.offsetMs ?? 0,
      volume: 0.5,
    }));
    shot.dialogues = [];
    shot.timelineEvents = [];
    return shot;
  });
  project.name = name;
  project.shots = shots;
  return ProjectSchema.parse(project);
}

function pcmWave(sampleRate: number, channels: number, durationSeconds: number): Uint8Array<ArrayBuffer> {
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
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
  view.setUint16(34, 16, true);
  view.setUint32(40, dataBytes, true);
  return bytes;
}

function waveDurationSeconds(input: ArrayBuffer): number {
  const view = new DataView(input);
  const sampleRate = view.getUint32(24, true);
  const blockAlign = view.getUint16(32, true);
  const dataBytes = view.getUint32(40, true);
  return dataBytes / blockAlign / sampleRate;
}

function ready(request: AssetPreviewAudioReadRequest, bytes: Uint8Array<ArrayBuffer>,
  mimeType: 'audio/mpeg' | 'audio/wav' = 'audio/wav'):
AssetPreviewAudioReadResponse {
  return { ok: true, status: 'ready', assetId: request.assetId, mimeType, byteLength: bytes.byteLength, bytes };
}

function readyInfo(request: AssetPreviewAudioReadRequest, bytes: Uint8Array,
  mimeType: 'audio/mpeg' | 'audio/wav' = 'audio/wav') {
  return { ok: true as const, status: 'ready' as const, assetId: request.assetId,
    mimeType, byteLength: bytes.byteLength };
}

function decodedBuffer(sampleRate: number, durationSeconds: number, channels = 2): AudioBuffer {
  return { duration: durationSeconds, length: sampleRate * durationSeconds, numberOfChannels: channels, sampleRate } as AudioBuffer;
}

class CapacityContext {
  state: AudioContextState = 'running';
  currentTime = 10;
  sampleRate = 48_000;
  destination = {} as AudioDestinationNode;
  sources: Array<{ buffer: AudioBuffer | null; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }> = [];
  decodeAudioData = vi.fn(async (input?: ArrayBuffer) => decodedBuffer(48_000, input ? waveDurationSeconds(input) : 1));
  resume = vi.fn(async () => { this.state = 'running'; });
  close = vi.fn(async () => { this.state = 'closed'; });
  createBufferSource = () => {
    const source = { buffer: null as AudioBuffer | null, onended: null as (() => void) | null,
      connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn() };
    this.sources.push(source);
    return source as unknown as AudioBufferSourceNode;
  };
  createGain = () => ({ gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() }) as unknown as GainNode;
  api(): ProductPreviewAudioContext { return this as unknown as ProductPreviewAudioContext; }
}

function inputAt(project: Project, projectTimeMs = 0): ProductPreviewAudioSyncInput {
  const shot = project.shots[0]!;
  return {
    projectRoot: PROJECT_ROOT,
    project,
    shot,
    range: 'project',
    playing: true,
    seekRevision: 0,
    readMasterSnapshot: (sampledAtMs) => ({
      projectRoot: PROJECT_ROOT,
      projectId: project.id,
      range: 'project',
      shotId: shot.id,
      timeMs: projectTimeMs,
      projectTimeMs,
      sampledAtMs,
      playing: true,
      clockGeneration: 0,
    }),
  };
}

async function flush(): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();
  }
}

describe('Issue #887 AU-03 legal long-audio capacity admission', () => {
  it('plays a legal 240-second PCM WAV when raw bytes plus decode reservation exceed 128 MiB', async () => {
    const durationSeconds = 240;
    const bytes = pcmWave(48_000, 2, durationSeconds);
    const asset: AudioSpec = { id: FOUR_MINUTE_ID, name: 'Original 4 minute 48 kHz stereo PCM WAV',
      relativePath: 'assets/issue887-four-minute.wav', durationMs: durationSeconds * 1_000,
      sha256: '1'.repeat(64) };
    const project = makeProject('Issue 887 A full 4 minute WAV', [durationSeconds * 1_000], [asset], [[{
      assetId: asset.id, startMs: 0, endMs: durationSeconds * 1_000,
    }]]);
    const context = new CapacityContext();
    const readAudio = vi.fn(async (request: AssetPreviewAudioReadRequest) => ready(request, bytes));
    const warnings: (string | null)[] = [];
    const transport = new ProductPreviewAudioTransport({ createContext: () => context.api(), readAudio,
      getAudioInfo: async (request) => readyInfo(request, bytes),
      onWarning: (warning) => warnings.push(warning) });
    try {
      transport.sync(inputAt(project));
      await flush();
      const expectedDecodeReservationBytes = (durationSeconds + 1) * 48_000 * 2 * Float32Array.BYTES_PER_ELEMENT;
      expect(bytes.byteLength + expectedDecodeReservationBytes).toBeGreaterThan(PRODUCT_PREVIEW_AUDIO_WORKING_SET_BYTES);
      expect(readAudio).toHaveBeenCalledTimes(1);
      expect(context.decodeAudioData).toHaveBeenCalledTimes(1);
      expect(context.sources.filter((source) => source.start.mock.calls.length > 0)).toHaveLength(1);
      let snapshot = transport.getWorkingSetSnapshot();
      expect(snapshot.retainedWaveSourceBytes).toBe(bytes.byteLength);
      expect(snapshot.sourceReadReservationBytes).toBe(0);
      expect(snapshot.inFlightSourceReadBytes).toBe(0);
      expect(snapshot.decodeInputCopyBytes).toBe(0);
      expect(snapshot.estimatedWorkingSetBytes).toBeLessThanOrEqual(PRODUCT_PREVIEW_AUDIO_WORKING_SET_BYTES);

      context.currentTime = 19.7;
      transport.sync(inputAt(project, 9_700));
      await flush();
      expect(readAudio).toHaveBeenCalledTimes(1);
      expect(context.decodeAudioData).toHaveBeenCalledTimes(2);
      const secondChunkStart = context.sources[1]!.start.mock.calls[0]!;
      expect(secondChunkStart[0]).toBeCloseTo(20, 6);
      expect(secondChunkStart[2]).toBe(10);
      snapshot = transport.getWorkingSetSnapshot();
      expect(snapshot.activeSourceCount).toBe(2);
      expect(snapshot.retainedWaveSourceBytes).toBe(bytes.byteLength);
      expect(snapshot.sourceReadReservationBytes).toBe(0);
      expect(snapshot.inFlightSourceReadBytes).toBe(0);
      expect(snapshot.decodeInputCopyBytes).toBe(0);
      expect(snapshot.estimatedWorkingSetBytes).toBeLessThanOrEqual(PRODUCT_PREVIEW_AUDIO_WORKING_SET_BYTES);
      expect(warnings).toEqual([]);
    } finally {
      transport.dispose();
    }
  });

  it('keeps both current 180-second WAV BGMs when their simultaneous decoded PCM exceeds 128 MiB', async () => {
    const firstBytes = pcmWave(48_000, 2, 180);
    const secondBytes = pcmWave(44_100, 2, 180);
    const first: AudioSpec = { id: FIRST_BGM_ID, name: 'First current 180s BGM 48 kHz stereo',
      relativePath: 'assets/issue887-first.wav', durationMs: 180_000, sha256: '2'.repeat(64) };
    const second: AudioSpec = { id: SECOND_BGM_ID, name: 'Second current 180s BGM 44.1 kHz stereo',
      relativePath: 'assets/issue887-second.wav', durationMs: 180_000, sha256: '3'.repeat(64) };
    const project = makeProject('Issue 887 B overlapping long BGMs', [180_000], [first, second], [[
      { assetId: first.id, startMs: 0, endMs: 180_000 },
      { assetId: second.id, startMs: 0, endMs: 180_000 },
    ]]);
    const context = new CapacityContext();
    const sources = new Map([[first.id, firstBytes], [second.id, secondBytes]]);
    const readAudio = vi.fn(async (request: AssetPreviewAudioReadRequest) =>
      ready(request, sources.get(request.assetId) ?? new Uint8Array(0)));
    const getAudioInfo = vi.fn(async (request: AssetPreviewAudioReadRequest) => {
      const bytes = sources.get(request.assetId) ?? new Uint8Array(0);
      return readyInfo(request, bytes);
    });
    const warnings: (string | null)[] = [];
    const transport = new ProductPreviewAudioTransport({ createContext: () => context.api(), readAudio, getAudioInfo,
      onWarning: (warning) => warnings.push(warning) });
    try {
      transport.sync(inputAt(project));
      await flush();
      const simultaneousPcmBytes = 2 * 180_000 * 48 * 2 * Float32Array.BYTES_PER_ELEMENT;
      expect(simultaneousPcmBytes).toBeGreaterThan(PRODUCT_PREVIEW_AUDIO_WORKING_SET_BYTES);
      expect(readAudio).toHaveBeenCalledTimes(2);
      expect(context.decodeAudioData).toHaveBeenCalledTimes(2);
      expect(context.sources.filter((source) => source.start.mock.calls.length > 0)).toHaveLength(2);
      const snapshot = transport.getWorkingSetSnapshot();
      expect(snapshot.retainedWaveSourceBytes).toBe(firstBytes.byteLength + secondBytes.byteLength);
      expect(snapshot.activeSourceCount).toBe(2);
      expect(snapshot.sourceReadReservationBytes).toBe(0);
      expect(snapshot.inFlightSourceReadBytes).toBe(0);
      expect(snapshot.decodeInputCopyBytes).toBe(0);
      expect(snapshot.estimatedWorkingSetBytes).toBeLessThanOrEqual(PRODUCT_PREVIEW_AUDIO_WORKING_SET_BYTES);
      expect(warnings).toEqual([]);
    } finally {
      transport.dispose();
    }
  });

  it('uses distinct sample-aligned WAV ranges for legal nonzero offsets across Shots with one source read', async () => {
    const bytes = pcmWave(48_000, 2, 240);
    const sourceSamples = new DataView(bytes.buffer);
    sourceSamples.setInt16(44, 101, true);
    sourceSamples.setInt16(44 + 60 * 48_000 * 4, 202, true);
    const asset: AudioSpec = { id: FOUR_MINUTE_ID, name: 'Offset fixture source',
      relativePath: 'assets/issue887-four-minute.wav', durationMs: 240_000, sha256: '4'.repeat(64) };
    const project = makeProject('Issue 887 A different offsets', [10_000, 10_000], [asset], [
      [{ assetId: asset.id, startMs: 0, endMs: 10_000, offsetMs: 0 }],
      [{ assetId: asset.id, startMs: 0, endMs: 10_000, offsetMs: 60_000 }],
    ]);
    const context = new CapacityContext();
    const readAudio = vi.fn(async (request: AssetPreviewAudioReadRequest) => ready(request, bytes));
    const transport = new ProductPreviewAudioTransport({ createContext: () => context.api(), readAudio,
      getAudioInfo: async (request) => readyInfo(request, bytes) });
    try {
      transport.sync(inputAt(project, 0));
      await flush();
      transport.sync(inputAt(project, 10_000));
      await flush();
      expect(readAudio).toHaveBeenCalledTimes(1);
      expect(context.decodeAudioData).toHaveBeenCalledTimes(2);
      const decodedFirstSamples = context.decodeAudioData.mock.calls.map(([input]) => {
        const view = new DataView(input!);
        return view.getInt16(44, true);
      });
      expect(decodedFirstSamples).toEqual([101, 202]);
      expect(context.sources.filter((source) => source.start.mock.calls.length > 0)).toHaveLength(2);
    } finally {
      transport.dispose();
    }
  });

  it('keeps one 180-second WAV on the existing full-buffer reuse path', async () => {
    const bytes = pcmWave(48_000, 2, 180);
    const asset: AudioSpec = { id: FIRST_BGM_ID, name: 'Single 180s BGM control',
      relativePath: 'assets/issue887-single-180.wav', durationMs: 180_000, sha256: '5'.repeat(64) };
    const project = makeProject('Issue 887 D single 180 seconds', [90_000, 90_000], [asset], [
      [{ assetId: asset.id, startMs: 0, endMs: 90_000 }],
      [{ assetId: asset.id, startMs: 0, endMs: 90_000 }],
    ]);
    const context = new CapacityContext();
    const readAudio = vi.fn(async (request: AssetPreviewAudioReadRequest) => ready(request, bytes));
    const transport = new ProductPreviewAudioTransport({ createContext: () => context.api(), readAudio,
      getAudioInfo: async (request) => readyInfo(request, bytes) });
    try {
      transport.sync(inputAt(project, 0));
      await flush();
      transport.sync(inputAt(project, 90_000));
      await flush();
      expect(readAudio).toHaveBeenCalledTimes(1);
      expect(context.decodeAudioData).toHaveBeenCalledTimes(1);
      expect(context.sources.filter((source) => source.start.mock.calls.length > 0)).toHaveLength(2);
    } finally {
      transport.dispose();
    }
  });

  it('records an oversized long MP3 as an explicit bounded-capacity case without reading or starting a source', async () => {
    const bytes = new Uint8Array(5_760_429);
    const durationMs = 360_000;
    const asset: AudioSpec = { id: SECOND_BGM_ID, name: 'Six minute MP3 capacity control',
      relativePath: 'assets/issue887-six-minute.mp3', durationMs, sha256: '6'.repeat(64), mimeType: 'audio/mpeg' };
    const project = makeProject('Issue 887 C MP3 capacity boundary', [durationMs], [asset], [[{
      assetId: asset.id, startMs: 0, endMs: durationMs,
    }]]);
    const context = new CapacityContext();
    const readAudio = vi.fn(async (request: AssetPreviewAudioReadRequest) => ready(request, bytes, 'audio/mpeg'));
    const getAudioInfo = vi.fn(async (request: AssetPreviewAudioReadRequest) => readyInfo(request, bytes, 'audio/mpeg'));
    const warnings: (string | null)[] = [];
    const transport = new ProductPreviewAudioTransport({ createContext: () => context.api(), readAudio, getAudioInfo,
      onWarning: (warning) => warnings.push(warning) });
    try {
      transport.sync(inputAt(project));
      await flush();
      const expectedPcmBytes = Math.ceil((durationMs / 1_000 + 1) * 48_000) * 2 * Float32Array.BYTES_PER_ELEMENT;
      expect(bytes.byteLength).toBeLessThan(PRODUCT_PREVIEW_AUDIO_WORKING_SET_BYTES);
      expect(expectedPcmBytes).toBeGreaterThan(PRODUCT_PREVIEW_AUDIO_WORKING_SET_BYTES);
      expect(getAudioInfo).not.toHaveBeenCalled();
      expect(readAudio).not.toHaveBeenCalled();
      expect(context.decodeAudioData).not.toHaveBeenCalled();
      expect(context.sources.filter((source) => source.start.mock.calls.length > 0)).toHaveLength(0);
      expect(warnings).toContain('预览容量不足，部分音轨未播放；请缩短或拆分音频后重试。');
    } finally {
      transport.dispose();
    }
  });

  it('does not read an asset when its only startup consumer cancels during size preflight', async () => {
    const bytes = pcmWave(48_000, 2, 3);
    const asset: AudioSpec = { id: FIRST_BGM_ID, name: 'Cancelled startup preflight control',
      relativePath: 'assets/issue887-cancelled-start.wav', durationMs: 3_000, sha256: '7'.repeat(64) };
    const project = makeProject('Issue 887 cancelled preflight control', [3_000], [asset], [[{
      assetId: asset.id, startMs: 0, endMs: 3_000,
    }]]);
    const context = new CapacityContext();
    const readAudio = vi.fn(async (request: AssetPreviewAudioReadRequest) => ready(request, bytes));
    let resolveInfo!: (response: ReturnType<typeof readyInfo>) => void;
    let preflightRequest: AssetPreviewAudioReadRequest | null = null;
    const pendingInfo = new Promise<ReturnType<typeof readyInfo>>((resolve) => { resolveInfo = resolve; });
    const getAudioInfo = vi.fn((request: AssetPreviewAudioReadRequest) => {
      preflightRequest = request;
      return pendingInfo;
    });
    const transport = new ProductPreviewAudioTransport({ createContext: () => context.api(), readAudio, getAudioInfo });
    try {
      const preparation = transport.prepareForPlayback(inputAt(project), 0);
      await flush();
      expect(getAudioInfo).toHaveBeenCalledTimes(1);
      transport.cancelPendingStartPreparation();
      resolveInfo(readyInfo(preflightRequest!, bytes));
      await expect(preparation).resolves.toMatchObject({ ready: false, reason: 'cancelled' });
      await flush();
      expect(readAudio).not.toHaveBeenCalled();
      expect(context.decodeAudioData).not.toHaveBeenCalled();
    } finally {
      transport.dispose();
    }
  });

  it('retains a bounded current decode when its last consumer cancels after read so Replay reuses it', async () => {
    const bytes = pcmWave(48_000, 2, 3);
    const asset: AudioSpec = { id: FIRST_BGM_ID, name: 'Cancelled current read reuse control',
      relativePath: 'assets/issue887-cancelled-read.wav', durationMs: 3_000, sha256: '8'.repeat(64) };
    const project = makeProject('Issue 887 cancelled read reuse control', [3_000], [asset], [[{
      assetId: asset.id, startMs: 0, endMs: 3_000,
    }]]);
    const context = new CapacityContext();
    let resolveRead!: (response: AssetPreviewAudioReadResponse) => void;
    const readRequests: AssetPreviewAudioReadRequest[] = [];
    const pendingRead = new Promise<AssetPreviewAudioReadResponse>((resolve) => { resolveRead = resolve; });
    const readAudio = vi.fn((request: AssetPreviewAudioReadRequest) => {
      readRequests.push(request);
      return pendingRead;
    });
    const getAudioInfo = vi.fn(async (request: AssetPreviewAudioReadRequest) => readyInfo(request, bytes));
    const transport = new ProductPreviewAudioTransport({ createContext: () => context.api(), readAudio, getAudioInfo });
    try {
      const firstPreparation = transport.prepareForPlayback(inputAt(project), 0);
      await flush();
      expect(readAudio).toHaveBeenCalledTimes(1);
      transport.cancelPendingStartPreparation();
      await expect(firstPreparation).resolves.toMatchObject({ ready: false, reason: 'cancelled' });

      resolveRead(ready(readRequests[0]!, bytes));
      await flush();
      expect(context.decodeAudioData).toHaveBeenCalledTimes(1);
      expect(transport.getWorkingSetSnapshot().idleLruEntries).toBe(1);

      await expect(transport.prepareForPlayback(inputAt(project), 0)).resolves.toMatchObject({ ready: true });
      expect(readAudio).toHaveBeenCalledTimes(1);
      expect(context.decodeAudioData).toHaveBeenCalledTimes(1);
      transport.sync(inputAt(project));
      await flush();
      expect(context.sources.filter((source) => source.start.mock.calls.length > 0)).toHaveLength(1);
    } finally {
      transport.dispose();
    }
  });
});
