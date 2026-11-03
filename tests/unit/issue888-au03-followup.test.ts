import { ProjectSchema, type AudioAsset, type Project } from '../../src/domain';
import type { AssetPreviewAudioReadRequest, AssetPreviewAudioReadResponse } from '../../src/shared/asset-preview-audio-api';
import {
  ProductPreviewAudioTransport,
  PRODUCT_PREVIEW_AUDIO_WORKING_SET_BYTES,
  type ProductPreviewAudioContext,
  type ProductPreviewAudioSyncInput,
} from '../../src/renderer/shell/productPreviewAudio';
import { buildProject } from './domain/testProject';
import { describe, expect, it, vi } from 'vitest';

const PROJECT_ROOT = 'D:\\PandaStage-Acceptance\\issue888-au03\\followup.pandastage';
const FIRST_WAV_ID = '10000000-0000-4000-8000-000000008881';
const SECOND_WAV_ID = '10000000-0000-4000-8000-000000008882';
const F01_CLIP_A_ID = '70000000-0000-4000-8000-000000008881';
const F01_CLIP_B_ID = '70000000-0000-4000-8000-000000008882';
const F02_CLIP_ID = '70000000-0000-4000-8000-000000008883';

function makeWav(durationSeconds: number): Uint8Array<ArrayBuffer> {
  const sampleRate = 48_000;
  const channels = 2;
  const blockAlign = channels * 2;
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
  return view.getUint32(40, true) / view.getUint16(32, true) / view.getUint32(24, true);
}

function cloneShot(source: Project['shots'][number], id: string, name: string): Project['shots'][number] {
  const shot = structuredClone(source);
  const layerIds = new Map(shot.layers.map((layer, index) => [layer.id,
    `60000000-0000-4000-8000-${String(8_880 + index).padStart(12, '0')}`]));
  shot.id = id;
  shot.name = name;
  shot.layers = shot.layers.map((layer) => ({ ...layer, id: layerIds.get(layer.id)! }));
  shot.backgroundLayerId = shot.backgroundLayerId ? layerIds.get(shot.backgroundLayerId) ?? null : null;
  shot.dialogues = [];
  shot.timelineEvents = [];
  shot.audioClips = [];
  return shot;
}

function makeAsset(id: string, name: string, durationMs: number): AudioAsset {
  return { id, kind: 'audio', name, relativePath: `assets/${id}.wav`, durationMs,
    sha256: id.replaceAll('-', '').padEnd(64, 'a'), mimeType: 'audio/wav' };
}

function makeProject(name: string, durationsMs: number[], assets: AudioAsset[], clipLists: Array<Array<{
  id: string; assetId: string; startMs: number; endMs: number; volume: number;
}>>): Project {
  const project = buildProject();
  const originalShot = project.shots[0]!;
  project.name = name;
  project.assets = [...project.assets.filter((asset) => asset.kind === 'image'), ...assets];
  project.shots = durationsMs.map((durationMs, index) => {
    const shot = index === 0 ? originalShot : cloneShot(originalShot,
      `50000000-0000-4000-8000-${String(8_880 + index).padStart(12, '0')}`, `${name} Shot ${index + 1}`);
    shot.name = `${name} Shot ${index + 1}`;
    shot.durationMs = durationMs;
    shot.audioClips = (clipLists[index] ?? []).map((clip) => ({ ...clip, role: 'bgm' as const,
      name: `${name} BGM`, offsetMs: 0 }));
    shot.dialogues = [];
    shot.timelineEvents = [];
    return shot;
  });
  return ProjectSchema.parse(project);
}

function inputAt(project: Project, projectTimeMs: number): ProductPreviewAudioSyncInput {
  let position = projectTimeMs;
  let shot = project.shots[project.shots.length - 1]!;
  let shotLocalTimeMs = shot.durationMs;
  for (const candidate of project.shots) {
    if (position < candidate.durationMs) {
      shot = candidate;
      shotLocalTimeMs = position;
      break;
    }
    position -= candidate.durationMs;
  }
  return {
    projectRoot: PROJECT_ROOT,
    project,
    shot,
    range: 'project',
    playing: true,
    seekRevision: 0,
    readMasterSnapshot: (sampledAtMs) => ({ projectRoot: PROJECT_ROOT, projectId: project.id,
      range: 'project', shotId: shot.id, timeMs: shotLocalTimeMs, projectTimeMs, sampledAtMs,
      playing: true, clockGeneration: 0 }),
  };
}

function ready(request: AssetPreviewAudioReadRequest, bytes: Uint8Array<ArrayBuffer>): AssetPreviewAudioReadResponse {
  return { ok: true, status: 'ready', assetId: request.assetId, mimeType: 'audio/wav',
    byteLength: bytes.byteLength, bytes };
}

function readyInfo(request: AssetPreviewAudioReadRequest, bytes: Uint8Array<ArrayBuffer>) {
  return { ok: true as const, status: 'ready' as const, assetId: request.assetId,
    mimeType: 'audio/wav' as const, byteLength: bytes.byteLength };
}

function decodedBuffer(durationSeconds: number): AudioBuffer {
  const length = Math.round(48_000 * durationSeconds);
  return { duration: durationSeconds, length, numberOfChannels: 2, sampleRate: 48_000 } as AudioBuffer;
}

class NativeAudioShapeContext {
  state: AudioContextState = 'running';
  currentTime = 10;
  sampleRate = 48_000;
  destination = {} as AudioDestinationNode;
  sources: Array<{ buffer: AudioBuffer | null; gain: number | null; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }> = [];
  decodeAudioData = vi.fn(async (input?: ArrayBuffer) => decodedBuffer(input ? waveDurationSeconds(input) : 1));
  resume = vi.fn(async () => { this.state = 'running'; });
  close = vi.fn(async () => { this.state = 'closed'; });
  createBufferSource = () => {
    const source = { buffer: null as AudioBuffer | null, gain: null as number | null, onended: null as (() => void) | null,
      connect: vi.fn((destination: AudioNode) => { source.gain = (destination as GainNode).gain?.value ?? null; }),
      disconnect: vi.fn(), start: vi.fn(), stop: vi.fn() };
    this.sources.push(source);
    return source as unknown as AudioBufferSourceNode;
  };
  createGain = () => ({ gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() }) as unknown as GainNode;
  api(): ProductPreviewAudioContext { return this as unknown as ProductPreviewAudioContext; }
}

async function flush(): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

describe('Issue #888 AU-03 follow-up', () => {
  it('includes exact source-file preflight bytes when admitting two concurrent 150-second WAVs', async () => {
    const firstBytes = makeWav(150);
    const secondBytes = makeWav(150);
    const firstAsset = makeAsset(FIRST_WAV_ID, 'F01 150-second WAV A', 150_000);
    const secondAsset = makeAsset(SECOND_WAV_ID, 'F01 150-second WAV B', 150_000);
    const project = makeProject('Issue 888 F01 two 150-second WAVs', [150_000], [firstAsset, secondAsset], [[
      { id: F01_CLIP_A_ID, assetId: firstAsset.id, startMs: 0, endMs: 150_000, volume: 0.35 },
      { id: F01_CLIP_B_ID, assetId: secondAsset.id, startMs: 0, endMs: 150_000, volume: 0.8 },
    ]]);
    const bytesById = new Map([[firstAsset.id, firstBytes], [secondAsset.id, secondBytes]]);
    const context = new NativeAudioShapeContext();
    const readAudio = vi.fn(async (request: AssetPreviewAudioReadRequest) => ready(request, bytesById.get(request.assetId)!));
    const getAudioInfo = vi.fn(async (request: AssetPreviewAudioReadRequest) => readyInfo(request, bytesById.get(request.assetId)!));
    const warnings: Array<string | null> = [];
    const transport = new ProductPreviewAudioTransport({ createContext: () => context.api(), readAudio, getAudioInfo,
      onWarning: (warning) => warnings.push(warning) });
    const input = inputAt(project, 0);
    try {
      const preparation = await transport.prepareForPlayback(input, 0);
      expect(preparation.ready).toBe(true);
      transport.sync(input);
      await flush();

      const started = context.sources.filter((source) => source.start.mock.calls.length > 0);
      expect(started).toHaveLength(2);
      expect(readAudio).toHaveBeenCalledTimes(2);
      expect(getAudioInfo).toHaveBeenCalledTimes(2);
      expect(context.decodeAudioData).toHaveBeenCalledTimes(2);
      expect(started.map((source) => source.start.mock.calls[0]?.[1])).toEqual([0, 0]);
      expect(started.map((source) => source.gain).sort((left, right) => (left ?? 0) - (right ?? 0)))
        .toEqual([0.35, 0.8]);
      expect(transport.getWorkingSetSnapshot().activeSourceCount).toBe(2);
      expect(transport.getWorkingSetSnapshot().peakEstimatedWorkingSetBytes).toBeLessThanOrEqual(
        PRODUCT_PREVIEW_AUDIO_WORKING_SET_BYTES);
      expect(warnings).toEqual([]);
    } finally {
      transport.dispose();
    }
  });

  it('prewarms one bounded F02 chunk at master +300ms and keeps the same read/decode through clip start', async () => {
    const bytes = makeWav(240);
    const asset = makeAsset('10000000-0000-4000-8000-000000008883', 'F02 future 240-second WAV', 240_000);
    const project = makeProject('Issue 888 F02 future WAV', [500, 240_000], [asset], [[], [
      { id: F02_CLIP_ID, assetId: asset.id, startMs: 0, endMs: 240_000, volume: 0.7 },
    ]]);
    const context = new NativeAudioShapeContext();
    const readAudio = vi.fn(async (request: AssetPreviewAudioReadRequest) => ready(request, bytes));
    const getAudioInfo = vi.fn(async (request: AssetPreviewAudioReadRequest) => readyInfo(request, bytes));
    const transport = new ProductPreviewAudioTransport({ createContext: () => context.api(), readAudio, getAudioInfo });
    try {
      transport.sync(inputAt(project, 200));
      await flush();
      expect(readAudio).toHaveBeenCalledTimes(1);
      expect(getAudioInfo).toHaveBeenCalledTimes(1);
      expect(context.decodeAudioData).toHaveBeenCalledTimes(1);
      const decodedInput = context.decodeAudioData.mock.calls[0]?.[0];
      expect(decodedInput).toBeDefined();
      if (!decodedInput) throw new Error('F02 decode input was not captured.');
      expect(waveDurationSeconds(decodedInput)).toBe(10);
      expect(context.sources.filter((source) => source.start.mock.calls.length > 0)).toHaveLength(1);
      const firstStartArgs = context.sources[0]!.start.mock.calls[0]!;
      expect(firstStartArgs[0]).toBeCloseTo(10.3, 6);
      expect(firstStartArgs[1]).toBe(0);

      context.currentTime = 10.3;
      transport.sync(inputAt(project, 500));
      await flush();
      expect(readAudio).toHaveBeenCalledTimes(1);
      expect(context.decodeAudioData).toHaveBeenCalledTimes(1);
      expect(context.sources.filter((source) => source.start.mock.calls.length > 0)).toHaveLength(1);
      expect(transport.getWorkingSetSnapshot().peakEstimatedWorkingSetBytes).toBeLessThanOrEqual(
        PRODUCT_PREVIEW_AUDIO_WORKING_SET_BYTES);
    } finally {
      transport.dispose();
    }
  });

  it('starts an over-window F02 read at the current source offset without replaying stale samples', async () => {
    const bytes = makeWav(240);
    const asset = makeAsset('10000000-0000-4000-8000-000000008884', 'F02 delayed 240-second WAV', 240_000);
    const project = makeProject('Issue 888 F02 delayed future WAV', [500, 240_000], [asset], [[], [
      { id: '70000000-0000-4000-8000-000000008884', assetId: asset.id,
        startMs: 0, endMs: 240_000, volume: 0.7 },
    ]]);
    const context = new NativeAudioShapeContext();
    const read = deferred<AssetPreviewAudioReadResponse>();
    const readAudio = vi.fn((request: AssetPreviewAudioReadRequest) => {
      expect(request.assetId).toBe(asset.id);
      return read.promise;
    });
    const getAudioInfo = vi.fn(async (request: AssetPreviewAudioReadRequest) => readyInfo(request, bytes));
    const transport = new ProductPreviewAudioTransport({ createContext: () => context.api(), readAudio, getAudioInfo });
    try {
      transport.sync(inputAt(project, 200));
      await flush();
      expect(readAudio).toHaveBeenCalledTimes(1);
      expect(context.sources.filter((source) => source.start.mock.calls.length > 0)).toHaveLength(0);

      context.currentTime = 10.72;
      transport.sync(inputAt(project, 720));
      read.resolve(ready(readAudio.mock.calls[0]![0], bytes));
      await flush();

      const started = context.sources.filter((source) => source.start.mock.calls.length > 0);
      expect(started).toHaveLength(1);
      expect(started[0]!.start.mock.calls[0]?.[0]).toBeCloseTo(10.72, 6);
      expect(started[0]!.start.mock.calls[0]?.[1]).toBeCloseTo(0.22, 3);
      expect(context.decodeAudioData).toHaveBeenCalledTimes(1);
      expect(readAudio).toHaveBeenCalledTimes(1);
    } finally {
      transport.dispose();
    }
  });
});
