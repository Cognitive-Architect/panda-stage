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

const PROJECT_ROOT = 'D:\\PandaStage-Acceptance\\issue889-au03\\transition.pandastage';
const A_ID = '10000000-0000-4000-8000-000000008891';
const B_ID = '10000000-0000-4000-8000-000000008892';
const A_CLIP_ID = '70000000-0000-4000-8000-000000008891';
const B_CLIP_ID = '70000000-0000-4000-8000-000000008892';
const A_MIX_CLIP_ID = '70000001-0000-4000-8000-000000008891';
const B_MIX_CLIP_ID = '70000001-0000-4000-8000-000000008892';

function makeWav(durationSeconds: number, sampleMark: number): Uint8Array<ArrayBuffer> {
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
  bytes.fill(sampleMark, 44);
  return bytes;
}

function makeAsset(id: string, name: string): AudioAsset {
  return { id, kind: 'audio', name, relativePath: `assets/${id}.wav`, durationMs: 150_000,
    sha256: id.replaceAll('-', '').padEnd(64, 'a'), mimeType: 'audio/wav' };
}

function cloneShot(source: Project['shots'][number], id: string, name: string): Project['shots'][number] {
  const shot = structuredClone(source);
  const layerIds = new Map(shot.layers.map((layer, index) => [layer.id,
    `60000000-0000-4000-8000-${String(8_890 + index).padStart(12, '0')}`]));
  shot.id = id;
  shot.name = name;
  shot.layers = shot.layers.map((layer) => ({ ...layer, id: layerIds.get(layer.id)! }));
  shot.backgroundLayerId = shot.backgroundLayerId ? layerIds.get(shot.backgroundLayerId) ?? null : null;
  shot.audioClips = [];
  shot.dialogues = [];
  shot.timelineEvents = [];
  return shot;
}

function makeProject(a: AudioAsset, b: AudioAsset): Project {
  const project = buildProject();
  const template = project.shots[0]!;
  const shotA = template;
  const shotB = cloneShot(template, '50000000-0000-4000-8000-000000008891', 'B only');
  const shotAB = cloneShot(template, '50000000-0000-4000-8000-000000008892', 'A + B');
  const clip = (id: string, asset: AudioAsset, volume: number) => ({ id, role: 'bgm' as const,
    name: asset.name, assetId: asset.id, startMs: 0, endMs: 150_000, offsetMs: 0, volume });
  project.name = 'Issue 889 A → B → A+B transition';
  project.assets = [...project.assets.filter((asset) => asset.kind === 'image'), a, b];
  project.shots = [
    { ...shotA, name: 'A only', durationMs: 150_000, audioClips: [clip(A_CLIP_ID, a, 0.35)] },
    { ...shotB, durationMs: 150_000, audioClips: [clip(B_CLIP_ID, b, 0.8)] },
    { ...shotAB, durationMs: 150_000, audioClips: [clip(A_MIX_CLIP_ID, a, 0.35),
      clip(B_MIX_CLIP_ID, b, 0.8)] },
  ];
  return ProjectSchema.parse(project);
}

function inputAt(project: Project, projectTimeMs: number, seekRevision: number, playing: boolean): ProductPreviewAudioSyncInput {
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
    playing,
    seekRevision,
    readMasterSnapshot: (sampledAtMs) => ({ projectRoot: PROJECT_ROOT, projectId: project.id,
      range: 'project', shotId: shot.id, timeMs: shotLocalTimeMs, projectTimeMs, sampledAtMs,
      playing, clockGeneration: seekRevision }),
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

function decodedBuffer(input: ArrayBuffer | Uint8Array<ArrayBuffer>): AudioBuffer & { sampleMark: number } {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const duration = view.getUint32(40, true) / view.getUint16(32, true) / view.getUint32(24, true);
  return { duration, length: Math.round(48_000 * duration), numberOfChannels: 2, sampleRate: 48_000,
    sampleMark: view.getUint8(44) } as unknown as AudioBuffer & { sampleMark: number };
}

class NativeAudioShapeContext {
  state: AudioContextState = 'running';
  currentTime = 10;
  sampleRate = 48_000;
  destination = {} as AudioDestinationNode;
  sources: Array<{ buffer: AudioBuffer | null; gain: number | null; start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn> }> = [];
  decodeAudioData = vi.fn(async (input?: ArrayBuffer | Uint8Array<ArrayBuffer>) => decodedBuffer(input ?? makeWav(1, 0)));
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
  for (let index = 0; index < 30; index += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();
  }
}

describe('Issue #889 AU-03 route invalidation after legal PCM eviction', () => {
  it('re-evaluates evicted full-decode A for Shot 3 while preserving active B and both gains', async () => {
    const bytesA = makeWav(150, 17);
    const bytesB = makeWav(150, 93);
    const assetA = makeAsset(A_ID, 'Issue 889 A 150-second WAV');
    const assetB = makeAsset(B_ID, 'Issue 889 B 150-second WAV');
    const project = makeProject(assetA, assetB);
    const bytesById = new Map([[assetA.id, bytesA], [assetB.id, bytesB]]);
    const context = new NativeAudioShapeContext();
    const readAudio = vi.fn(async (request: AssetPreviewAudioReadRequest) => ready(request, bytesById.get(request.assetId)!));
    const getAudioInfo = vi.fn(async (request: AssetPreviewAudioReadRequest) => readyInfo(request, bytesById.get(request.assetId)!));
    const warnings: Array<string | null> = [];
    const transport = new ProductPreviewAudioTransport({ createContext: () => context.api(), readAudio, getAudioInfo,
      onWarning: (warning) => warnings.push(warning) });
    const privateState = transport as unknown as {
      waveStreamDecisions: Map<string, boolean>;
      bufferRecords: Map<string, { bytes: number; voiceLeases: Set<string>; consumerLeases: Set<string> }>;
    };
    const decisionKey = (asset: AudioAsset) => [PROJECT_ROOT, project.id, asset.id, asset.sha256].join('\u0000');
    try {
      transport.sync(inputAt(project, 0, 0, true));
      await flush();
      const shot1Source = context.sources.find((source) => source.start.mock.calls.length > 0);
      expect(shot1Source?.buffer && (shot1Source.buffer as AudioBuffer & { sampleMark: number }).sampleMark).toBe(17);
      expect(privateState.waveStreamDecisions.get(decisionKey(assetA))).toBe(false);
      expect(privateState.bufferRecords.has(decisionKey(assetA))).toBe(true);
      expect(privateState.bufferRecords.get(decisionKey(assetA))?.voiceLeases.size).toBeGreaterThan(0);

      transport.sync(inputAt(project, 0, 1, false));
      await flush();
      expect(privateState.waveStreamDecisions.get(decisionKey(assetA))).toBe(false);
      expect(privateState.bufferRecords.get(decisionKey(assetA))?.voiceLeases.size).toBe(0);

      transport.sync(inputAt(project, 150_000, 2, true));
      await flush();
      expect(privateState.waveStreamDecisions.get(decisionKey(assetB))).toBe(false);
      expect(privateState.bufferRecords.has(decisionKey(assetA))).toBe(false);
      expect(privateState.waveStreamDecisions.has(decisionKey(assetA))).toBe(false);
      const shot2Source = context.sources.filter((source) => source.start.mock.calls.length > 0).at(-1);
      expect(shot2Source?.buffer && (shot2Source.buffer as AudioBuffer & { sampleMark: number }).sampleMark).toBe(93);

      const startCountBeforeOverlap = context.sources.length;
      transport.sync(inputAt(project, 300_000, 3, true));
      await flush();
      const shot3Sources = context.sources.slice(startCountBeforeOverlap)
        .filter((source) => source.start.mock.calls.length > 0);
      expect(shot3Sources).toHaveLength(2);
      expect(shot3Sources.map((source) => (source.buffer as AudioBuffer & { sampleMark: number }).sampleMark)
        .sort((left, right) => left - right)).toEqual([17, 93]);
      expect(shot3Sources.map((source) => source.gain).sort((left, right) => (left ?? 0) - (right ?? 0)))
        .toEqual([0.35, 0.8]);
      expect(privateState.waveStreamDecisions.get(decisionKey(assetA))).toBe(true);
      expect(transport.getWorkingSetSnapshot().peakEstimatedWorkingSetBytes)
        .toBeLessThanOrEqual(PRODUCT_PREVIEW_AUDIO_WORKING_SET_BYTES);
      expect(warnings.filter(Boolean)).toEqual([]);
    } finally {
      transport.dispose();
    }
  });
});
