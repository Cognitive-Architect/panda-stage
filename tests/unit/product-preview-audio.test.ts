import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { ProjectSchema, type Project } from '../../src/domain';
import type { AssetPreviewAudioReadRequest, AssetPreviewAudioReadResponse } from '../../src/shared/asset-preview-audio-api';
import {
  ProductPreviewAudioTransport, resolveProductPreviewAudio, resolveProductPreviewAudios,
  productPreviewSourceTimeMs, PRODUCT_PREVIEW_AUDIO_CACHE_BYTES,
  PRODUCT_PREVIEW_AUDIO_CACHE_ENTRIES, PRODUCT_PREVIEW_AUDIO_MAX_READS,
  type ProductPreviewAudioContext, type ProductPreviewAudioSyncInput,
} from '../../src/renderer/shell/productPreviewAudio';
import { buildProject, IDS } from './domain/testProject';

const AUDIO_ID = '10000000-0000-4000-8000-000000000401';
const AUDIO_B_ID = '10000000-0000-4000-8000-000000000402';
const CLIP_A_ID = '70000000-0000-4000-8000-000000000401';
const CLIP_B_ID = '70000000-0000-4000-8000-000000000402';
const DIALOGUE_A_ID = '80000000-0000-4000-8000-000000000401';
const DIALOGUE_B_ID = '80000000-0000-4000-8000-000000000402';
const PROJECT_ROOT = 'D:\\preview-audio.pandastage';

function buildAudioProject(): Project {
  const base = buildProject();
  return ProjectSchema.parse({
    ...base,
    assets: [
      ...base.assets,
      {
        id: AUDIO_ID,
        kind: 'audio',
        name: '预览配音',
        relativePath: 'assets/preview.wav',
        mimeType: 'audio/wav',
        sha256: 'c'.repeat(64),
        durationMs: 3_000,
      },
    ],
    shots: base.shots.map((shot) => ({
      ...shot,
      dialogues: [
        {
          id: DIALOGUE_A_ID,
          characterId: IDS.character,
          voiceProfileId: IDS.voiceProfile,
          subtitleStyleId: IDS.subtitle,
          audioClipId: CLIP_A_ID,
          startMs: 500,
          endMs: 1_200,
          text: '第一句',
        },
        {
          id: DIALOGUE_B_ID,
          characterId: IDS.character,
          voiceProfileId: IDS.voiceProfile,
          subtitleStyleId: IDS.subtitle,
          audioClipId: CLIP_B_ID,
          startMs: 1_500,
          endMs: 2_100,
          text: '第二句',
        },
      ],
      audioClips: [
        {
          id: CLIP_A_ID,
          role: 'dialogue',
          name: '第一句配音',
          assetId: AUDIO_ID,
          startMs: 500,
          endMs: 1_000,
          offsetMs: 100,
          volume: 0.75,
        },
        {
          id: CLIP_B_ID,
          role: 'dialogue',
          name: '第二句配音',
          assetId: AUDIO_ID,
          startMs: 1_500,
          endMs: 2_000,
          offsetMs: 500,
          volume: 1,
        },
      ],
    })),
  });
}


function buffer(length = 3000, channels = 1): AudioBuffer {
  return { duration: 3, length, numberOfChannels: channels } as AudioBuffer;
}
class FakeContext {
  state: AudioContextState = 'running';
  currentTime = 10;
  destination = {} as AudioDestinationNode;
  sources: ReturnType<FakeContext['source']>[] = [];
  gains: ReturnType<FakeContext['gain']>[] = [];
  decodeAudioData = vi.fn(async (bytes: ArrayBuffer) => { expect(bytes.byteLength).toBe(4); return buffer(); });
  resume = vi.fn(async () => { this.state = 'running'; });
  close = vi.fn(async () => { this.state = 'closed'; });
  private source() {
    return { buffer: null as AudioBuffer | null, onended: null as (() => void) | null,
      connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn() };
  }
  private gain() {
    return { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
  }
  createBufferSource = () => {
    const source = this.source(); this.sources.push(source);
    return source as unknown as AudioBufferSourceNode;
  };
  createGain = () => {
    const gain = this.gain(); this.gains.push(gain);
    return gain as unknown as GainNode;
  };
  api(): ProductPreviewAudioContext { return this as unknown as ProductPreviewAudioContext; }
}
function readyResponse(request: AssetPreviewAudioReadRequest): AssetPreviewAudioReadResponse {
  return { ok: true, status: 'ready', assetId: request.assetId, mimeType: 'audio/wav',
    byteLength: 4, bytes: new Uint8Array([1, 2, 3, 4]) };
}
async function flush(): Promise<void> { await new Promise<void>((resolve) => setTimeout(resolve, 0)); }
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function syncInput(project: Project, overrides: Partial<ProductPreviewAudioSyncInput> = {}): ProductPreviewAudioSyncInput {
  return { projectRoot: PROJECT_ROOT, project, shot: project.shots[0]!, timeMs: 600,
    playing: true, seekRevision: 0, ...overrides };
}
function mixedProject(): Project {
  const project = buildAudioProject();
  const shot = project.shots[0]!;
  const template = shot.audioClips[0]!;
  shot.audioClips = [template,
    { ...template, id: 'bgm', role: 'bgm', startMs: 0, endMs: 2500, offsetMs: 0, volume: 0.25 },
    { ...template, id: 'sfx-a', role: 'sfx', startMs: 550, endMs: 850, offsetMs: 200, volume: 1.8 },
    { ...template, id: 'sfx-b', role: 'sfx', startMs: 600, endMs: 900, offsetMs: 500, volume: 2 }];
  return project;
}
function setup(project = mixedProject()) {
  const context = new FakeContext();
  const readAudio = vi.fn(async (request: AssetPreviewAudioReadRequest) => readyResponse(request));
  const warnings: (string | null)[] = [];
  const transport = new ProductPreviewAudioTransport({ createContext: () => context.api(), readAudio,
    onWarning: (warning) => warnings.push(warning) });
  return { project, context, readAudio, transport, warnings };
}
function internals(transport: ProductPreviewAudioTransport) {
  return transport as unknown as { bufferCache: Map<string, AudioBuffer>; cacheBytes: number;
    reads: Map<string, Promise<AudioBuffer>>; voices: Map<string, unknown> };
}

describe('Product Preview Shot-local multi-clip mixer — #659', () => {
  it('creates only one default native context, resumes it and supports gain 0..2', async () => {
    const context = new FakeContext();
    context.state = 'suspended';
    const construct = vi.fn();
    vi.stubGlobal('AudioContext', class {
      constructor() { construct(); return context.api(); }
    });
    const project = mixedProject();
    const transport = new ProductPreviewAudioTransport({ readAudio: async (request) => readyResponse(request) });
    try {
      transport.sync(syncInput(project)); await flush();
      expect(construct).toHaveBeenCalledTimes(1);
      expect(context.resume).toHaveBeenCalled();
      expect(context.sources).toHaveLength(4);
      expect(context.gains.map((gain) => gain.gain.value).sort((a, b) => a - b)).toEqual([0.25, 0.75, 1.8, 2]);
    } finally { transport.dispose(); vi.unstubAllGlobals(); }
  });
  it('resolves 1 Dialogue + BGM + two overlapping SFX in half-open windows without speaker gating', () => {
    const project = mixedProject();
    const shot = project.shots[0]!;
    expect(resolveProductPreviewAudios(project, shot, 600).map(({ clip }) => clip.id))
      .toEqual([CLIP_A_ID, 'bgm', 'sfx-a', 'sfx-b']);
    expect(resolveProductPreviewAudios(project, shot, 850).map(({ clip }) => clip.id))
      .toEqual([CLIP_A_ID, 'bgm', 'sfx-b']);
    expect(resolveProductPreviewAudios(project, shot, 1000).map(({ clip }) => clip.id)).toEqual(['bgm']);
    expect(resolveProductPreviewAudios(project, shot, 2500)).toEqual([]);
    expect(resolveProductPreviewAudios(project, shot, NaN)).toEqual([]);
    const selection = resolveProductPreviewAudio(project, shot, DIALOGUE_A_ID)!;
    expect(productPreviewSourceTimeMs(600, selection.clip, selection.asset)).toBe(200);
    expect(productPreviewSourceTimeMs(-100, selection.clip, selection.asset)).toBe(0);
    expect(productPreviewSourceTimeMs(99999, selection.clip, selection.asset)).toBe(3000);
    expect(resolveProductPreviewAudio(project, shot, null)).toBeNull();
  });

  it('mixes four sources with separate gains/offsets/durations, deduplicates read/decode, never edits Project', async () => {
    const { project, context, transport, readAudio } = setup();
    const before = structuredClone(project);
    transport.sync(syncInput(project)); await flush();
    expect(context.sources).toHaveLength(4);
    expect(context.gains.map((gain) => gain.gain.value)).toEqual([0.75, 0.25, 1.8, 2]);
    expect(context.sources.map((source) => source.start.mock.calls[0])).toEqual([
      [10, 0.2, 0.4], [10, 0.6, 1.9], [10, 0.25, 0.25], [10, 0.5, 0.3]]);
    expect(readAudio).toHaveBeenCalledTimes(1);
    expect(context.decodeAudioData).toHaveBeenCalledTimes(1);
    context.currentTime = 10.05;
    transport.sync(syncInput(project, { timeMs: 650 }));
    expect(context.sources).toHaveLength(4);
    expect(project).toEqual(before);
    transport.dispose();
    expect(context.sources.every((source) => source.stop.mock.calls.length === 1 && source.disconnect.mock.calls.length === 1 && source.buffer === null)).toBe(true);
    expect(context.gains.every((gain) => gain.disconnect.mock.calls.length === 1)).toBe(true);
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it('plays standalone audio even with no Dialogues and supports silence at gain zero', async () => {
    const { project, context, transport } = setup();
    project.shots[0]!.dialogues = [];
    project.shots[0]!.audioClips = project.shots[0]!.audioClips.filter((clip) => clip.role !== 'dialogue');
    project.shots[0]!.audioClips[0]!.volume = 0;
    transport.sync(syncInput(project)); await flush();
    expect(context.sources).toHaveLength(3);
    expect(context.gains.map((gain) => gain.gain.value)).toEqual([0, 1.8, 2]);
    transport.dispose();
  });

  it('seek-in / seek-out rebuild only the destination set and stop every obsolete source', async () => {
    const { project, context, transport } = setup();
    transport.sync(syncInput(project)); await flush();
    const old = [...context.sources];
    transport.sync(syncInput(project, { timeMs: 100, seekRevision: 1 })); await flush();
    expect(old.every((source) => source.stop.mock.calls.length === 1)).toBe(true);
    expect(context.sources).toHaveLength(5);
    expect(context.sources[4]!.start).toHaveBeenCalledWith(10, 0.1, 2.4);
    transport.sync(syncInput(project, { timeMs: 2800, seekRevision: 2 })); await flush();
    expect(context.sources[4]!.stop).toHaveBeenCalledTimes(1);
    expect(internals(transport).voices.size).toBe(0);
    transport.dispose();
  });

  it('pause/paused seek stay silent; resume reanchors every source to latest master, not old audio time', async () => {
    const { project, context, transport, readAudio } = setup();
    transport.sync(syncInput(project)); await flush();
    transport.sync(syncInput(project, { playing: false, timeMs: 650 }));
    context.currentTime = 999;
    transport.sync(syncInput(project, { playing: false, timeMs: 700, seekRevision: 1 })); await flush();
    expect(context.sources).toHaveLength(4);
    transport.sync(syncInput(project, { timeMs: 700, seekRevision: 1 })); await flush();
    expect(context.sources).toHaveLength(8);
    expect(context.sources[4]!.start).toHaveBeenCalledWith(999, 0.3, 0.3);
    expect(readAudio).toHaveBeenCalledTimes(1);
    context.currentTime = 999.01;
    transport.sync(syncInput(project, { timeMs: 710, seekRevision: 1 }));
    expect(context.sources).toHaveLength(8);
    transport.dispose();
  });

  it('corrects sustained audio drift against the master without introducing a tick/clock owner', async () => {
    const { project, context, transport } = setup();
    transport.sync(syncInput(project)); await flush();
    context.currentTime += 0.02;
    transport.sync(syncInput(project, { timeMs: 620 })); await flush();
    expect(context.sources).toHaveLength(4);
    context.currentTime += 0.5;
    transport.sync(syncInput(project, { timeMs: 640 })); await flush();
    expect(context.sources).toHaveLength(8);
    expect(context.sources[4]!.start).toHaveBeenCalledWith(context.currentTime, 0.24, 0.36);
    const source = readFileSync('src/renderer/shell/productPreviewAudio.ts', 'utf8');
    expect(source).not.toMatch(/requestAnimationFrame|setInterval|setTimeout|createObjectURL/u);
    transport.dispose();
  });

  it('stops and replays repeatedly without stacking sources or accumulating cache', async () => {
    const { project, context, transport, readAudio } = setup();
    for (let index = 0; index < 5; index++) {
      transport.sync(syncInput(project, { timeMs: 0, playing: false, seekRevision: index * 2 }));
      transport.sync(syncInput(project, { timeMs: 600, seekRevision: index * 2 + 1 }));
      await flush();
      expect(context.sources).toHaveLength((index + 1) * 4);
    }
    expect(context.sources.slice(0, -4).every((source) => source.stop.mock.calls.length === 1)).toBe(true);
    expect(readAudio).toHaveBeenCalledTimes(1);
    expect(internals(transport).bufferCache.size).toBe(1);
    transport.dispose();
  });

  it('hands off Shot A to Shot B and never revives old sources/ended callbacks', async () => {
    const { project, context, transport } = setup();
    const first = project.shots[0]!;
    const second = { ...first, id: 'shot-b', audioClips: [first.audioClips[1]!] };
    transport.sync(syncInput(project)); await flush();
    const lateEnd = context.sources[0]!.onended!;
    transport.sync(syncInput(project, { shot: second, timeMs: 100 })); await flush();
    expect(context.sources).toHaveLength(5);
    lateEnd();
    expect(context.sources[4]!.stop).not.toHaveBeenCalled();
    expect(context.sources[4]!.start).toHaveBeenCalledWith(10, 0.1, 2.4);
    transport.dispose();
  });

  it.each(['read', 'decode', 'resume'] as const)('rejects stale %s completion after seek/Stop and starts only the new ownership', async (stage) => {
    const project = mixedProject();
    const context = new FakeContext();
    const read = deferred<AssetPreviewAudioReadResponse>();
    const decode = deferred<AudioBuffer>();
    const resume = deferred<void>();
    if (stage === 'decode') context.decodeAudioData.mockImplementation(() => decode.promise);
    if (stage === 'resume') {
      context.state = 'suspended';
      context.resume.mockImplementation(() => resume.promise);
    }
    const transport = new ProductPreviewAudioTransport({ createContext: () => context.api(),
      readAudio: (request) => stage === 'read' ? read.promise : Promise.resolve(readyResponse(request)) });
    transport.sync(syncInput(project)); await flush();
    transport.sync(syncInput(project, { timeMs: 100, seekRevision: 1 }));
    if (stage === 'read') read.resolve(readyResponse({ projectRoot: PROJECT_ROOT, assetId: AUDIO_ID, sha256: 'c'.repeat(64) }));
    if (stage === 'decode') decode.resolve(buffer());
    if (stage === 'resume') { context.state = 'running'; resume.resolve(); }
    await flush();
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0]!.start).toHaveBeenCalledWith(10, 0.1, 2.4);
    transport.sync(syncInput(project, { timeMs: 0, playing: false, seekRevision: 2 }));
    expect(context.sources[0]!.stop).toHaveBeenCalledTimes(1);
    transport.dispose();
  });

  it.each(['read', 'decode'] as const)('dispose during %s drops late result, cache and warnings', async (stage) => {
    const project = mixedProject();
    const context = new FakeContext();
    const read = deferred<AssetPreviewAudioReadResponse>();
    const decode = deferred<AudioBuffer>();
    const warnings = vi.fn();
    if (stage === 'decode') context.decodeAudioData.mockImplementation(() => decode.promise);
    const transport = new ProductPreviewAudioTransport({ createContext: () => context.api(), onWarning: warnings,
      readAudio: (request) => stage === 'read' ? read.promise : Promise.resolve(readyResponse(request)) });
    transport.sync(syncInput(project)); await flush();
    transport.dispose();
    if (stage === 'read') read.resolve(readyResponse({ projectRoot: PROJECT_ROOT, assetId: AUDIO_ID, sha256: 'c'.repeat(64) }));
    else decode.resolve(buffer());
    await flush();
    expect(context.sources).toHaveLength(0);
    expect(internals(transport).bufferCache.size).toBe(0);
    expect(internals(transport).reads.size).toBe(0);
    expect(warnings).not.toHaveBeenCalled();
    transport.dispose();
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it('uses latest master time after a delayed read, and silence when the window already ended', async () => {
    const project = mixedProject();
    const context = new FakeContext();
    const read = deferred<AssetPreviewAudioReadResponse>();
    const transport = new ProductPreviewAudioTransport({ createContext: () => context.api(), readAudio: () => read.promise });
    transport.sync(syncInput(project));
    transport.sync(syncInput(project, { timeMs: 950 }));
    read.resolve(readyResponse({ projectRoot: PROJECT_ROOT, assetId: AUDIO_ID, sha256: 'c'.repeat(64) }));
    await flush();
    expect(context.sources).toHaveLength(2);
    expect(context.sources[0]!.start).toHaveBeenCalledWith(10, 0.55, 0.05);
    expect(context.sources[1]!.start).toHaveBeenCalledWith(10, 0.95, 1.55);
    transport.dispose();
  });

  it('invalidates pending Project A decode when opening Project B, with no stale cache or ownership', async () => {
    const project = mixedProject();
    const other = { ...project, id: 'project-b' };
    const context = new FakeContext();
    const late = deferred<AudioBuffer>();
    context.decodeAudioData.mockImplementationOnce(() => late.promise);
    const warnings = vi.fn();
    const transport = new ProductPreviewAudioTransport({ createContext: () => context.api(), onWarning: warnings,
      readAudio: async (request) => readyResponse(request) });
    transport.sync(syncInput(project)); await flush();
    transport.sync(syncInput(other, { timeMs: 100 })); await flush();
    expect(context.sources).toHaveLength(1);
    late.resolve(buffer()); await flush();
    expect(context.sources).toHaveLength(1);
    expect([...internals(transport).bufferCache.keys()].every((key) => key.includes('project-b'))).toBe(true);
    expect(warnings).not.toHaveBeenCalled();
    transport.dispose();
  });

  it('releases naturally ended nodes without restarting them on an ordinary tick', async () => {
    const { project, context, transport } = setup();
    transport.sync(syncInput(project)); await flush();
    context.sources[2]!.onended!();
    expect(context.sources[2]!.buffer).toBeNull();
    context.currentTime += 0.01;
    transport.sync(syncInput(project, { timeMs: 610 })); await flush();
    expect(context.sources).toHaveLength(4);
    transport.dispose();
  });

  it('reports a resume failure without starting sources; a later explicit seek can retry', async () => {
    const { project, context, transport, warnings } = setup();
    context.state = 'suspended';
    context.resume.mockRejectedValue(new Error('device unavailable'));
    transport.sync(syncInput(project)); await flush();
    expect(context.sources).toHaveLength(0);
    expect(warnings).toEqual(['部分音频无法预览，画面和字幕将继续播放。']);
    context.state = 'running';
    transport.sync(syncInput(project, { seekRevision: 1 })); await flush();
    expect(context.sources).toHaveLength(4);
    expect(warnings.at(-1)).toBeNull();
    transport.dispose();
  });

  it('keeps successful voices playing when another asset fails and suppresses stale failure warnings', async () => {
    const project = mixedProject();
    const asset = project.assets.find((asset) => asset.id === AUDIO_ID)!;
    project.assets.push({ ...asset, id: AUDIO_B_ID, sha256: 'd'.repeat(64) });
    project.shots[0]!.audioClips[3]!.assetId = AUDIO_B_ID;
    const context = new FakeContext();
    const failure = deferred<AssetPreviewAudioReadResponse>();
    const warnings: (string | null)[] = [];
    const transport = new ProductPreviewAudioTransport({ createContext: () => context.api(),
      onWarning: (warning) => warnings.push(warning),
      readAudio: (request) => request.assetId === AUDIO_B_ID ? failure.promise : Promise.resolve(readyResponse(request)) });
    transport.sync(syncInput(project)); await flush();
    failure.reject(new Error('read failed')); await flush();
    expect(context.sources).toHaveLength(3);
    expect(warnings).toEqual(['部分音频无法预览，画面和字幕将继续播放。']);
    transport.sync(syncInput(project, { timeMs: 100, seekRevision: 1 })); await flush();
    expect(warnings.at(-1)).toBeNull();
    transport.dispose();
  });

  it('bounds cache count/bytes, evicts LRU and limits concurrent reads', async () => {
    const { project, context, transport } = setup();
    const asset = project.assets.find((asset) => asset.id === AUDIO_ID)!;
    const template = project.shots[0]!.audioClips[0]!;
    project.shots[0]!.audioClips = [];
    for (let index = 0; index < 12; index++) {
      const id = 'asset-' + index;
      project.assets.push({ ...asset, id });
      project.shots[0]!.audioClips = [{ ...template, id: 'clip-' + index, assetId: id }];
      transport.sync(syncInput(project, { seekRevision: index })); await flush();
      expect(internals(transport).bufferCache.size).toBeLessThanOrEqual(PRODUCT_PREVIEW_AUDIO_CACHE_ENTRIES);
      expect(internals(transport).cacheBytes).toBeLessThanOrEqual(PRODUCT_PREVIEW_AUDIO_CACHE_BYTES);
    }
    expect([...internals(transport).bufferCache.keys()][0]).toContain('asset-4');
    context.decodeAudioData.mockResolvedValue(buffer(PRODUCT_PREVIEW_AUDIO_CACHE_BYTES / 4 + 1));
    project.shots[0]!.audioClips = [{ ...template, assetId: AUDIO_ID }];
    transport.sync(syncInput(project, { seekRevision: 20 })); await flush();
    expect(internals(transport).bufferCache.size).toBe(8);
    expect([...internals(transport).bufferCache.keys()].some((key) => key.includes(AUDIO_ID))).toBe(false);
    transport.dispose();

    const reads: ReturnType<typeof deferred<AssetPreviewAudioReadResponse>>[] = [];
    const contextB = new FakeContext();
    const bounded = new ProductPreviewAudioTransport({ createContext: () => contextB.api(), readAudio: () => {
      const pending = deferred<AssetPreviewAudioReadResponse>(); reads.push(pending); return pending.promise;
    } });
    project.shots[0]!.audioClips = project.assets.filter((asset) => asset.kind === 'audio')
      .map((asset) => ({ ...template, id: asset.id, assetId: asset.id }));
    bounded.sync(syncInput(project));
    expect(reads).toHaveLength(PRODUCT_PREVIEW_AUDIO_MAX_READS);
    expect(internals(bounded).reads.size).toBe(PRODUCT_PREVIEW_AUDIO_MAX_READS);
    reads[0]!.resolve(readyResponse({ projectRoot: PROJECT_ROOT, assetId: AUDIO_ID, sha256: 'c'.repeat(64) }));
    await flush();
    expect(reads).toHaveLength(PRODUCT_PREVIEW_AUDIO_MAX_READS + 1);
    bounded.dispose();
  });

  it('evicts by decoded byte budget even when cache entry count is below the limit', async () => {
    const { project, context, transport } = setup();
    const asset = project.assets.find((asset) => asset.id === AUDIO_ID)!;
    project.assets.push({ ...asset, id: AUDIO_B_ID });
    const template = project.shots[0]!.audioClips[0]!;
    context.decodeAudioData.mockResolvedValue(buffer(10 * 1024 * 1024)); // 40 MiB decoded PCM.
    project.shots[0]!.audioClips = [template];
    transport.sync(syncInput(project)); await flush();
    project.shots[0]!.audioClips = [{ ...template, assetId: AUDIO_B_ID }];
    transport.sync(syncInput(project, { seekRevision: 1 })); await flush();
    expect(internals(transport).bufferCache.size).toBe(1);
    expect(internals(transport).cacheBytes).toBe(40 * 1024 * 1024);
    expect([...internals(transport).bufferCache.keys()][0]).toContain(AUDIO_B_ID);
    transport.dispose();
  });

  it('does not drive Mouth/Auto Camera/subtitle or modify Preview layout/clock authority', () => {
    const overlay = readFileSync('src/renderer/shell/ProductPreviewOverlay.tsx', 'utf8');
    const call = overlay.slice(overlay.indexOf('const audioWarning = useProductPreviewAudio({'), overlay.indexOf('useLayoutEffect(() => {', overlay.indexOf('const audioWarning =')));
    expect(call).not.toContain('activeDialogueId');
    expect(call).toContain('timeMs: activeShotTimeMs');
    const audio = readFileSync('src/renderer/shell/productPreviewAudio.ts', 'utf8');
    expect(audio).not.toMatch(/setTimeMs|evaluateMouth|AutoCamera|updateProject|historyStore/u);
  });
});
