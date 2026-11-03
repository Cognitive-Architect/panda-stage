import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  ProjectSchema,
  buildExportAudioMixPlan,
  buildFormalExportAudioMixPlan,
  type Project,
} from '../../src/domain';
import type { AssetPreviewAudioReadRequest, AssetPreviewAudioReadResponse } from '../../src/shared/asset-preview-audio-api';
import {
  ProductPreviewAudioTransport, resolveProductPreviewAudio, resolveProductPreviewAudios,
  productPreviewSourceTimeMs, PRODUCT_PREVIEW_AUDIO_CACHE_BYTES,
  PRODUCT_PREVIEW_AUDIO_CACHE_ENTRIES, PRODUCT_PREVIEW_AUDIO_MAX_READS,
  type ProductPreviewAudioContext, type ProductPreviewAudioSyncInput,
} from '../../src/renderer/shell/productPreviewAudio';
import { buildProject, IDS } from './domain/testProject';
import { resolveProductPreviewClockTime } from '../../src/renderer/shell/productPreviewModel';

const AUDIO_ID = '10000000-0000-4000-8000-000000000401';
const AUDIO_B_ID = '10000000-0000-4000-8000-000000000402';
const CLIP_A_ID = '70000000-0000-4000-8000-000000000401';
const CLIP_B_ID = '70000000-0000-4000-8000-000000000402';
const BGM_ID = '70000000-0000-4000-8000-000000000403';
const SFX_A_ID = '70000000-0000-4000-8000-000000000404';
const SFX_B_ID = '70000000-0000-4000-8000-000000000405';
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
type TestSyncOverrides = Partial<Omit<ProductPreviewAudioSyncInput, 'readMasterSnapshot'>> & {
  timeMs?: number;
  readMasterSnapshot?: ProductPreviewAudioSyncInput['readMasterSnapshot'];
};
function syncInput(project: Project, overrides: TestSyncOverrides = {}): ProductPreviewAudioSyncInput {
  const timeMs = overrides.timeMs ?? 600;
  const input = {
    projectRoot: overrides.projectRoot ?? PROJECT_ROOT,
    project: overrides.project ?? project,
    shot: overrides.shot === undefined ? project.shots[0]! : overrides.shot,
    range: overrides.range ?? 'project',
    playing: overrides.playing ?? true,
    seekRevision: overrides.seekRevision ?? 0,
  };
  return {
    ...input,
    readMasterSnapshot: overrides.readMasterSnapshot ?? ((sampledAtMs) => ({
      projectRoot: input.projectRoot,
      projectId: input.project.id,
      range: input.range,
      shotId: input.shot?.id ?? null,
      timeMs,
      sampledAtMs,
      playing: input.playing,
      clockGeneration: input.seekRevision,
    })),
  };
}
function liveClockInput(project: Project, delayBaseMs: number, anchorTimeMs = 600) {
  const input = syncInput(project, { timeMs: anchorTimeMs });
  return Object.assign(input, {
    range: 'project' as const,
    readMasterSnapshot: (sampledAtMs: number) => ({
      projectRoot: input.projectRoot,
      projectId: input.project.id,
      range: 'project' as const,
      shotId: input.shot?.id ?? null,
      timeMs: anchorTimeMs + sampledAtMs - delayBaseMs,
      sampledAtMs,
      playing: input.playing,
      clockGeneration: input.seekRevision,
    }),
  });
}
function projectTimeInput(project: Project, projectTimeMs: number): ProductPreviewAudioSyncInput {
  let shotStartMs = 0;
  let shot = project.shots.at(-1) ?? null;
  let shotLocalTimeMs = shot?.durationMs ?? 0;
  for (const candidate of project.shots) {
    const shotEndMs = shotStartMs + candidate.durationMs;
    if (projectTimeMs < shotEndMs) {
      shot = candidate;
      shotLocalTimeMs = projectTimeMs - shotStartMs;
      break;
    }
    shotStartMs = shotEndMs;
  }
  const input = syncInput(project, { shot, range: 'project', timeMs: shotLocalTimeMs });
  return {
    ...input,
    readMasterSnapshot: ((sampledAtMs: number) => ({
      projectRoot: input.projectRoot,
      projectId: input.project.id,
      range: 'project',
      shotId: shot?.id ?? null,
      timeMs: shotLocalTimeMs,
      projectTimeMs,
      sampledAtMs,
      playing: input.playing,
      clockGeneration: input.seekRevision,
    })) as unknown as ProductPreviewAudioSyncInput['readMasterSnapshot'],
  };
}
function mixedProject(): Project {
  const project = buildAudioProject();
  const shot = project.shots[0]!;
  const template = shot.audioClips[0]!;
  shot.audioClips = [template,
    { ...template, id: BGM_ID, role: 'bgm', startMs: 0, endMs: 2500, offsetMs: 0, volume: 0.25 },
    { ...template, id: SFX_A_ID, role: 'sfx', startMs: 550, endMs: 850, offsetMs: 200, volume: 1.8 },
    { ...template, id: SFX_B_ID, role: 'sfx', startMs: 600, endMs: 900, offsetMs: 500, volume: 2 }];
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
function sourceWithWindow(context: FakeContext, offsetSeconds: number, durationSeconds: number) {
  return context.sources.find((source) => {
    const call = source.start.mock.calls[0];
    return call !== undefined && Math.abs(call[1] - offsetSeconds) < 1e-9 &&
      Math.abs(call[2] - durationSeconds) < 1e-9;
  });
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
      .toEqual([CLIP_A_ID, BGM_ID, SFX_A_ID, SFX_B_ID]);
    expect(resolveProductPreviewAudios(project, shot, 850).map(({ clip }) => clip.id))
      .toEqual([CLIP_A_ID, BGM_ID, SFX_B_ID]);
    expect(resolveProductPreviewAudios(project, shot, 1000).map(({ clip }) => clip.id)).toEqual([BGM_ID]);
    expect(resolveProductPreviewAudios(project, shot, 2500)).toEqual([]);
    expect(resolveProductPreviewAudios(project, shot, NaN)).toEqual([]);
    const selection = resolveProductPreviewAudio(project, shot, DIALOGUE_A_ID)!;
    expect(productPreviewSourceTimeMs(600, selection.clip, selection.asset)).toBe(200);
    expect(productPreviewSourceTimeMs(-100, selection.clip, selection.asset)).toBe(0);
    expect(productPreviewSourceTimeMs(99999, selection.clip, selection.asset)).toBe(3000);
    expect(resolveProductPreviewAudio(project, shot, null)).toBeNull();
  });

  it('keeps the formal mix plan aligned with Preview timing/gain and rejects clips outside the Shot', () => {
    const project = mixedProject();
    const shot = project.shots[0]!;
    const formalClipIds = new Map<string, string>(
      shot.audioClips.map((clip, index) => [
        clip.id,
        `70000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      ]),
    );
    const inputs = shot.audioClips.map((clip) => ({
      clipId: formalClipIds.get(clip.id)!,
      assetId: clip.assetId,
      role: clip.role,
      sourcePath: `C:\\frozen\\${clip.assetId}.wav`,
      startMs: clip.startMs,
      endMs: clip.endMs,
      offsetMs: clip.offsetMs,
      volume: clip.volume,
    }));
    const plan = buildFormalExportAudioMixPlan(shot.durationMs, inputs);

    expect(plan.preserveSilentTail).toBe(true);
    expect(plan.clips).toHaveLength(shot.audioClips.length);
    for (const clip of shot.audioClips) {
      const planned = plan.clips.find(
        (entry) => entry.clipId === formalClipIds.get(clip.id),
      )!;
      const preview = resolveProductPreviewAudios(project, shot, clip.startMs)
        .find((entry) => entry.clip.id === clip.id)!;
      expect(planned.startMs).toBe(clip.startMs);
      expect(planned.endMs).toBe(clip.endMs);
      expect(planned.volume).toBe(preview.clip.volume);
      expect(planned.sourceOffsetMs).toBe(
        productPreviewSourceTimeMs(clip.startMs, preview.clip, preview.asset),
      );
    }
    expect(() =>
      buildFormalExportAudioMixPlan(shot.durationMs, [
        ...inputs,
        {
          ...inputs[0]!,
          clipId: '70000000-0000-4000-8000-000000000499',
          startMs: shot.durationMs,
          endMs: shot.durationMs + 1,
        },
      ]),
    ).toThrow();
    expect(() =>
      buildFormalExportAudioMixPlan(shot.durationMs, [
        { ...inputs[0]!, endMs: inputs[0]!.startMs },
      ]),
    ).toThrow();
  });

  it('keeps Preview and Export active windows, source offsets, and linear gain in parity', () => {
    const project = mixedProject();
    const shot = project.shots[0]!;
    const plan = buildExportAudioMixPlan(
      2_500,
      shot.audioClips.map((clip) => ({
        clipId: clip.id,
        assetId: clip.assetId,
        role: clip.role,
        sourcePath: `C:\\export\\${clip.assetId}.wav`,
        startMs: clip.startMs,
        endMs: clip.endMs,
        offsetMs: clip.offsetMs,
        volume: clip.volume,
      })),
    );

    for (const timeMs of [0, 499, 500, 549, 550, 600, 849, 850, 999, 1_000, 1_600, 2_499, 2_500]) {
      const preview = resolveProductPreviewAudios(project, shot, timeMs);
      const exported = plan.clips.filter(
        (clip) => clip.startMs <= timeMs && timeMs < clip.endMs,
      );

      expect(exported.map((clip) => clip.clipId)).toEqual(
        preview.map(({ clip }) => clip.id),
      );
      for (const { clip, asset } of preview) {
        const exportClip = exported.find((candidate) => candidate.clipId === clip.id)!;
        expect(exportClip.sourceOffsetMs + timeMs - exportClip.startMs).toBe(
          productPreviewSourceTimeMs(timeMs, clip, asset),
        );
        expect(exportClip.volume).toBe(clip.volume);
      }
    }
  });

  it('mixes four sources with separate gains/offsets/durations, deduplicates read/decode, never edits Project', async () => {
    const { project, context, transport, readAudio } = setup();
    const before = structuredClone(project);
    transport.sync(syncInput(project)); await flush();
    expect(context.sources).toHaveLength(4);
    const scheduled = context.sources.map((source, index) => ({
      gain: context.gains[index]!.gain.value,
      args: source.start.mock.calls[0],
    }));
    expect(scheduled).toEqual(expect.arrayContaining([
      { gain: 0.75, args: [10, 0.2, 0.4] },
      { gain: 0.25, args: [10, 0.6, 1.9] },
      { gain: 1.8, args: [10, 0.25, 0.25] },
      { gain: 2, args: [10, 0.5, 0.3] },
    ]));
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
    expect(sourceWithWindow(context, 0.3, 0.3)?.start).toHaveBeenCalledWith(999, 0.3, 0.3);
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
    expect(sourceWithWindow(context, 0.24, 0.36)?.start).toHaveBeenCalledWith(context.currentTime, 0.24, 0.36);
    const source = readFileSync('src/renderer/shell/productPreviewAudio.ts', 'utf8');
    expect(source).not.toMatch(/requestAnimationFrame|setInterval|createObjectURL/u);
    transport.dispose();
  });

  it.each([[40, 50], [70, 15]] as const)(
    'ignores a React sample %i ms old but still corrects genuine drift',
    async (sampleAgeMs, genuineDriftMs) => {
      const project = buildAudioProject();
      const shot = project.shots[0]!;
      shot.audioClips = [{ ...shot.audioClips[0]!, id: CLIP_A_ID, startMs: 500, endMs: 1_000, offsetMs: 100 }];
      const context = new FakeContext();
      const clock = vi.spyOn(performance, 'now').mockReturnValue(1_000);
      const staleReactInput = liveClockInput(project, 1_000);
      const audioTransport = new ProductPreviewAudioTransport({
        createContext: () => context.api(),
        readAudio: async (request) => readyResponse(request),
      });

      try {
        audioTransport.sync(staleReactInput);
        await flush();

        clock.mockReturnValue(1_000 + sampleAgeMs);
        context.currentTime = 10 + (sampleAgeMs + genuineDriftMs) / 1_000;
        audioTransport.sync(staleReactInput);
        await flush();
        expect(context.sources).toHaveLength(1);
        expect(context.sources[0]!.stop).not.toHaveBeenCalled();

        context.currentTime += 0.1;
        audioTransport.sync(staleReactInput);
        await flush();
        const expectedMasterTimeMs = 600 + sampleAgeMs;
        expect(context.sources).toHaveLength(2);
        expect(context.sources[0]!.stop).toHaveBeenCalledTimes(1);
        expect(context.sources[1]!.start).toHaveBeenCalledWith(
          context.currentTime,
          (expectedMasterTimeMs - 500 + 100) / 1_000,
          (1_000 - expectedMasterTimeMs) / 1_000,
        );
      } finally {
        clock.mockRestore();
        audioTransport.dispose();
      }
    },
  );

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
    expect(internals(transport).bufferCache.size).toBe(0);
    expect(transport.getWorkingSetSnapshot()).toMatchObject({
      activeSourceCount: 4,
      retainedUniquePcmBytes: expect.any(Number),
    });
    transport.dispose();
  });

  it('hands off Shot A to Shot B and never revives old sources/ended callbacks', async () => {
    const { project, context, transport } = setup();
    const first = project.shots[0]!;
    const second = { ...first, id: 'shot-b', audioClips: [first.audioClips[1]!] };
    transport.sync(syncInput(project, { range: 'shot' })); await flush();
    const lateEnd = context.sources[0]!.onended!;
    transport.sync(syncInput(project, { shot: second, range: 'shot', timeMs: 100 })); await flush();
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
    expect(sourceWithWindow(context, 0.55, 0.05)?.start).toHaveBeenCalledWith(10, 0.55, 0.05);
    expect(sourceWithWindow(context, 0.95, 1.55)?.start).toHaveBeenCalledWith(10, 0.95, 1.55);
    transport.dispose();
  });

  it('uses the live master after a stalled read and skips clips outside their current window', async () => {
    const project = mixedProject();
    const shot = project.shots[0]!;
    shot.audioClips.push({
      ...shot.audioClips[0]!,
      id: CLIP_B_ID,
      startMs: 1_500,
      endMs: 2_000,
      offsetMs: 500,
      volume: 1,
    });
    const context = new FakeContext();
    const read = deferred<AssetPreviewAudioReadResponse>();
    const clock = vi.spyOn(performance, 'now').mockReturnValue(1_000);
    const transport = new ProductPreviewAudioTransport({
      createContext: () => context.api(),
      readAudio: () => read.promise,
    });

    try {
      transport.sync(liveClockInput(project, 1_000, 950));
      clock.mockReturnValue(1_550);
      read.resolve(readyResponse({
        projectRoot: PROJECT_ROOT,
        assetId: AUDIO_ID,
        sha256: 'c'.repeat(64),
      }));
      await flush();
      expect(context.sources.map((source) => source.start.mock.calls[0])).toEqual([
        [10, 1.5, 1],
      ]);

      context.currentTime = 10.05;
      transport.sync(syncInput(project, { timeMs: 1_550 }));
      await flush();
      expect(context.sources.map((source) => source.start.mock.calls[0])).toEqual([
        [10, 1.5, 1],
        [10.05, 0.55, 0.45],
      ]);
    } finally {
      clock.mockRestore();
      transport.dispose();
    }
  });

  it('does not relabel a stale master sample as fresh when its React sync arrives after a renderer stall', async () => {
    const project = mixedProject();
    const shot = project.shots[0]!;
    const template = shot.audioClips[0]!;
    shot.audioClips = [
      { ...template, id: CLIP_A_ID, startMs: 300, endMs: 1_200, offsetMs: 0 },
      { ...template, id: CLIP_B_ID, startMs: 1_300, endMs: 2_700, offsetMs: 0 },
    ];
    const context = new FakeContext();
    let nowMs = 1_500;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
    const transport = new ProductPreviewAudioTransport({
      createContext: () => context.api(),
      readAudio: async (request) => readyResponse(request),
    });

    try {
      transport.sync(syncInput(project, {
        timeMs: 1_341,
        readMasterSnapshot: () => ({
          projectRoot: PROJECT_ROOT,
          projectId: project.id,
          range: 'project',
          shotId: shot.id,
          timeMs: 1_341,
          sampledAtMs: 1_000,
          playing: true,
          clockGeneration: 0,
        }),
      }));
      await flush();
      expect(context.sources).toHaveLength(0);

      nowMs = 1_516;
      transport.sync(syncInput(project, { timeMs: 1_888 }));
      await flush();
      expect(context.sources.map((source) => source.start.mock.calls[0])).toEqual([
        [10, 0.588, 0.812],
      ]);
    } finally {
      clock.mockRestore();
      transport.dispose();
    }
  });

  it.each([
    ['decode', 40], ['decode', 70], ['decode', 100], ['decode', 200],
    ['resume', 40], ['resume', 70], ['resume', 100], ['resume', 200],
  ] as const)('%s completion starts from the live master time after %i ms', async (stage, delayMs) => {
    const project = buildAudioProject();
    const shot = project.shots[0]!;
    shot.audioClips = [{ ...shot.audioClips[0]!, id: CLIP_A_ID, startMs: 500, endMs: 1_000, offsetMs: 100 }];
    const context = new FakeContext();
    const decode = deferred<AudioBuffer>();
    const resume = deferred<void>();
    const clock = vi.spyOn(performance, 'now').mockReturnValue(1_000);
    if (stage === 'decode') context.decodeAudioData.mockImplementation(() => decode.promise);
    if (stage === 'resume') {
      context.state = 'suspended';
      context.resume.mockImplementation(() => resume.promise);
    }
    const transport = new ProductPreviewAudioTransport({
      createContext: () => context.api(),
      readAudio: async (request) => readyResponse(request),
    });

    try {
      transport.sync(liveClockInput(project, 1_000));
      await flush();
      clock.mockReturnValue(1_000 + delayMs);
      if (stage === 'decode') decode.resolve(buffer());
      else { context.state = 'running'; resume.resolve(); }
      await flush();

      const expectedTimeMs = 600 + delayMs;
      expect(context.sources).toHaveLength(1);
      expect(context.sources[0]!.start).toHaveBeenCalledWith(
        10,
        (expectedTimeMs - 500 + 100) / 1_000,
        (1_000 - expectedTimeMs) / 1_000,
      );
    } finally {
      clock.mockRestore();
      transport.dispose();
    }
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

  it.each(['dialogue', 'bgm', 'sfx'] as const)('does not replay expired %s after an absolute clock catch-up', async (role) => {
    const { project, context, transport, readAudio } = setup(buildAudioProject());
    project.shots[0]!.audioClips[0]!.role = role;
    if (role !== 'dialogue') project.shots[0]!.dialogues = [];
    transport.sync(syncInput(project)); await flush();
    const old = context.sources[0]!;
    const lateEnd = old.onended!;
    context.currentTime += 3; // Audio elapsed through clip end during a stalled RAF.
    lateEnd();
    expect(old.buffer).toBeNull();
    expect(old.disconnect).toHaveBeenCalledTimes(1);
    expect(context.gains[0]!.disconnect).toHaveBeenCalledTimes(1);
    expect(context.sources).toHaveLength(1); // Callback is cleanup only, not a second clock.
    const next = resolveProductPreviewClockTime(
      { startedAtMs: 10_000, startTimeMs: 600 },
      context.currentTime * 1_000,
      project.shots[0]!.durationMs,
    );
    expect(next.timeMs).toBe(3_000);
    expect(next.ended).toBe(true);
    transport.sync(syncInput(project, { timeMs: next.timeMs, playing: false })); await flush();
    expect(context.sources).toHaveLength(1);
    expect(internals(transport).voices.size).toBe(0);
    expect(context.sources.filter((source) => source.buffer !== null)).toHaveLength(0);
    expect(readAudio).toHaveBeenCalledTimes(1);
    expect(context.decodeAudioData).toHaveBeenCalledTimes(1);
    lateEnd(); // A stale callback cannot recreate audio after Preview has ended.
    transport.sync(syncInput(project, { timeMs: next.timeMs, playing: false })); await flush();
    expect(context.sources).toHaveLength(1);
    expect(internals(transport).voices.size).toBe(0);
    transport.dispose();
  });

  it('catches audio up to the current master time without replaying expired clips', async () => {
    const { project, context, transport } = setup(mixedProject());
    const template = project.shots[0]!.audioClips[0]!;
    project.shots[0]!.audioClips.push({
      ...template,
      id: CLIP_B_ID,
      role: 'dialogue',
      startMs: 1_500,
      endMs: 2_000,
      offsetMs: 500,
      volume: 1,
    });
    transport.sync(syncInput(project)); await flush();
    expect(context.sources).toHaveLength(4);

    context.currentTime += 1.2;
    sourceWithWindow(context, 0.2, 0.4)!.onended!(); // Dialogue A is over by 1800 ms.
    sourceWithWindow(context, 0.25, 0.25)!.onended!(); // Both SFX windows are over by 1800 ms.
    sourceWithWindow(context, 0.5, 0.3)!.onended!();
    const next = resolveProductPreviewClockTime(
      { startedAtMs: 10_000, startTimeMs: 600 },
      context.currentTime * 1_000,
      project.shots[0]!.durationMs,
    );
    expect(next.timeMs).toBe(1_800);

    transport.sync(syncInput(project, { timeMs: next.timeMs })); await flush();

    expect(context.sources).toHaveLength(5);
    expect(sourceWithWindow(context, 0.6, 1.9)!.stop).not.toHaveBeenCalled(); // BGM stayed aligned.
    expect(sourceWithWindow(context, 0.8, 0.2)!.start).toHaveBeenCalledWith(11.2, 0.8, 0.2);
    expect(sourceWithWindow(context, 0.2, 0.4)!.buffer).toBeNull();
    expect(sourceWithWindow(context, 0.25, 0.25)!.buffer).toBeNull();
    expect(sourceWithWindow(context, 0.5, 0.3)!.buffer).toBeNull();
    expect(internals(transport).voices.size).toBe(2);
    transport.dispose();
  });

  it('does not rebuild a naturally ended source when the next master tick is outside its window', async () => {
    const { project, context, transport, readAudio } = setup(buildAudioProject());
    transport.sync(syncInput(project)); await flush();
    context.sources[0]!.onended!();
    transport.sync(syncInput(project, { timeMs: 1000 })); await flush();
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0]!.buffer).toBeNull();
    expect(internals(transport).voices.size).toBe(0);
    expect(readAudio).toHaveBeenCalledTimes(1);
    transport.dispose();
  });

  it.each(['seek', 'shot'] as const)('ignores obsolete onended callbacks after %s without killing or restarting the new owner', async (action) => {
    const { project, context, transport } = setup(buildAudioProject());
    const range = action === 'shot' ? 'shot' : 'project';
    transport.sync(syncInput(project, { range })); await flush();
    const lateEnd = context.sources[0]!.onended!;
    const input = syncInput(project, { timeMs: 800, range,
      ...(action === 'seek' ? { seekRevision: 1 } : { shot: { ...project.shots[0]!, id: 'new-shot' } }),
    });
    transport.sync(input); await flush();
    lateEnd();
    transport.sync(input); await flush();
    expect(context.sources).toHaveLength(2);
    expect(context.sources[1]!.start).toHaveBeenCalledWith(10, 0.4, 0.2);
    expect(context.sources[1]!.stop).not.toHaveBeenCalled();
    expect(internals(transport).voices.size).toBe(1);
    transport.dispose();
  });

  it.each(['pause', 'stop', 'unmount'] as const)('does not restart naturally ended audio after %s or a stale ended callback', async (action) => {
    const { project, context, transport } = setup(buildAudioProject());
    transport.sync(syncInput(project)); await flush();
    const lateEnd = context.sources[0]!.onended!;
    lateEnd();
    if (action === 'unmount') transport.dispose();
    const paused = syncInput(project, { playing: false, timeMs: action === 'stop' ? 0 : 650,
      seekRevision: action === 'stop' ? 1 : 0 });
    transport.sync(paused);
    lateEnd();
    transport.sync(paused); await flush();
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0]!.buffer).toBeNull();
    expect(internals(transport).voices.size).toBe(0);
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
    expect([...internals(transport).bufferCache.keys()][0]).toContain('asset-3');
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
    await flush();
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
    expect([...internals(transport).bufferCache.keys()][0]).toContain(AUDIO_ID);
    transport.dispose();
  });

  it('does not drive Mouth/Auto Camera/subtitle or modify Preview layout/clock authority', () => {
    const overlay = readFileSync('src/renderer/shell/ProductPreviewOverlay.tsx', 'utf8');
    const reader = overlay.slice(overlay.indexOf('const readMasterSnapshot = useCallback('), overlay.indexOf('const audioInput = useMemo('));
    expect(reader).toContain('playbackClockAnchorRef.current');
    expect(reader).toContain('resolveProductPreviewClockTime(anchor, sampledAtMs, durationMs)');
    expect(reader).toContain('playbackClockGenerationRef.current');
    const audioInputStart = overlay.indexOf('const audioInput = useMemo(');
    const audioControllerStart = overlay.indexOf('const audioController = useProductPreviewAudio(audioInput);');
    const call = overlay.slice(audioInputStart, audioControllerStart);
    expect(call).not.toContain('activeDialogueId');
    expect(call).toContain('readMasterSnapshot');
    expect(call).not.toContain('timeMs: activeShotTimeMs');
    expect(call).not.toContain('masterTimeSampledAtMs');
    const audio = readFileSync('src/renderer/shell/productPreviewAudio.ts', 'utf8');
    expect(audio).not.toMatch(/setTimeMs|evaluateMouth|AutoCamera|updateProject|historyStore/u);
    expect(audio).not.toMatch(/requestAnimationFrame|setInterval/u);
    expect(audio.match(/setTimeout\(/gu)).toHaveLength(4);
    expect(audio).toContain('PRODUCT_PREVIEW_AUDIO_STARTUP_TIMEOUT_MS');
  });
});

describe('AU-02 bounded future audio preparation', () => {
  it('does not create an AudioContext or wait when playback starts with no audio', async () => {
    const project = buildAudioProject();
    project.shots[0]!.audioClips = [];
    const context = new FakeContext();
    const createContext = vi.fn(() => context.api());
    const transport = new ProductPreviewAudioTransport({ createContext });

    await expect(transport.prepareForPlayback(syncInput(project, { timeMs: 0, playing: false }), 0))
      .resolves.toMatchObject({ ready: true, reason: 'no-audio', waitedMs: 0 });
    expect(createContext).not.toHaveBeenCalled();
    expect(context.sources).toHaveLength(0);
    transport.dispose();
  });

  it('fails startup audio preparation promptly with the existing warning on read failure', async () => {
    const project = buildAudioProject();
    project.shots[0]!.audioClips = [{ ...project.shots[0]!.audioClips[0]!, startMs: 0, endMs: 800 }];
    const context = new FakeContext();
    const warnings: (string | null)[] = [];
    const transport = new ProductPreviewAudioTransport({
      createContext: () => context.api(),
      readAudio: async () => { throw new Error('Synthetic read failure.'); },
      onWarning: (warning) => warnings.push(warning),
    });

    await expect(transport.prepareForPlayback(syncInput(project, { timeMs: 0, playing: false }), 0))
      .resolves.toMatchObject({ ready: false, reason: 'failed' });
    expect(context.sources).toHaveLength(0);
    expect(warnings.at(-1)).toBeTruthy();
    transport.dispose();
  });

  it('clears the startup timeout warning once a delayed current voice is scheduled', async () => {
    const project = buildAudioProject();
    const shot = project.shots[0]!;
    const template = shot.audioClips[0]!;
    shot.audioClips = [{ ...template, id: CLIP_A_ID, startMs: 0, endMs: 800, offsetMs: 0 }];
    const context = new FakeContext();
    const read = deferred<AssetPreviewAudioReadResponse>();
    const warnings: (string | null)[] = [];
    const transport = new ProductPreviewAudioTransport({ createContext: () => context.api(),
      readAudio: () => read.promise, onWarning: (warning) => warnings.push(warning) });

    const preparation = await transport.prepareForPlayback(syncInput(project, { timeMs: 0, playing: false }), 0);
    expect(preparation).toMatchObject({ ready: false, reason: 'timeout' });
    expect(warnings.at(-1)).toBeTruthy();

    transport.sync(syncInput(project, { timeMs: 0, playing: true }));
    read.resolve(readyResponse({ projectRoot: PROJECT_ROOT, assetId: AUDIO_ID, sha256: 'c'.repeat(64) }));
    await flush();
    await flush();

    expect(context.sources).toHaveLength(1);
    expect(context.sources[0]!.start).toHaveBeenCalledTimes(1);
    expect(warnings.at(-1)).toBeNull();
    transport.dispose();
  }, 2_000);

  it('schedules 40–150ms effects across the 0→200ms render gap exactly once', async () => {
    const project = buildAudioProject();
    const shot = project.shots[0]!;
    const template = shot.audioClips[0]!;
    const dialogue = { ...template, id: CLIP_A_ID, role: 'dialogue' as const,
      startMs: 0, endMs: 3_000, offsetMs: 0 };
    const short = { ...template, id: SFX_A_ID, role: 'sfx' as const,
      startMs: 40, endMs: 80, offsetMs: 100 };
    const effect = { ...template, id: SFX_B_ID, role: 'sfx' as const,
      startMs: 100, endMs: 250, offsetMs: 300 };
    const overlap = { ...template, id: '70000000-0000-4000-8000-000000000406', role: 'sfx' as const,
      startMs: 120, endMs: 190, offsetMs: 500 };
    shot.audioClips = [dialogue, short, effect, overlap];
    const { context, transport } = setup(project);

    transport.sync(syncInput(project, { timeMs: 0 }));
    await flush();
    await flush();
    expect(context.sources).toHaveLength(4);
    expect(context.sources.map((source) => source.start.mock.calls[0])
      .sort((a, b) => Number(a?.[0]) - Number(b?.[0])))
      .toEqual([[10, 0, 3], [10.04, 0.1, 0.04], [10.1, 0.3, 0.15], [10.12, 0.5, 0.07]]);

    context.currentTime = 10.2;
    transport.sync(syncInput(project, { timeMs: 200 }));
    await flush();
    expect(context.sources).toHaveLength(4);
    expect(context.sources[0]!.stop).not.toHaveBeenCalled();
    expect(context.sources[2]!.start).toHaveBeenCalledTimes(1);
    expect(context.sources[2]!.stop).not.toHaveBeenCalled();
    transport.dispose();
  });

  it('prepares first-play audio before the Preview clock is allowed to start', async () => {
    const project = buildAudioProject();
    const shot = project.shots[0]!;
    shot.audioClips = [{ ...shot.audioClips[0]!, id: CLIP_A_ID,
      startMs: 0, endMs: 1_000, offsetMs: 0 }];
    const context = new FakeContext();
    const read = deferred<AssetPreviewAudioReadResponse>();
    const readAudio = vi.fn(() => read.promise);
    const transport = new ProductPreviewAudioTransport({ createContext: () => context.api(), readAudio });
    const preparation = transport.prepareForPlayback(syncInput(project, { timeMs: 0, playing: false }), 0);
    await flush();
    expect(readAudio).toHaveBeenCalledTimes(1);
    expect(context.sources).toHaveLength(0);
    context.currentTime = 10.16;
    read.resolve(readyResponse({ projectRoot: PROJECT_ROOT, assetId: AUDIO_ID, sha256: 'c'.repeat(64) }));
    await expect(preparation).resolves.toMatchObject({ ready: true });

    transport.sync(syncInput(project, { timeMs: 0, playing: true }));
    await flush();
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0]!.start).toHaveBeenCalledWith(10.16, 0, 1);
    transport.dispose();
  });

  it('preserves prepared opening SFX, dialogue and BGM across a delayed passive sync', async () => {
    const project = buildAudioProject();
    const shot = project.shots[0]!;
    const template = shot.audioClips[0]!;
    shot.audioClips = [
      { ...template, id: SFX_A_ID, role: 'sfx', startMs: 0, endMs: 50, offsetMs: 0 },
      { ...template, id: CLIP_A_ID, role: 'dialogue', startMs: 0, endMs: 1_000, offsetMs: 0 },
      { ...template, id: BGM_ID, role: 'bgm', startMs: 0, endMs: 1_500, offsetMs: 500 },
    ];
    const { context, transport, readAudio } = setup(project);
    const preparationInput = syncInput(project, { timeMs: 0, playing: false });

    await expect(transport.prepareForPlayback(preparationInput, 0))
      .resolves.toMatchObject({ ready: true });
    expect(readAudio).toHaveBeenCalledTimes(1);
    expect(context.sources).toHaveLength(0);

    // The Overlay synchronously syncs at the exact master anchor. Its later
    // passive effect may arrive after the short clip has ended without losing it.
    transport.sync(syncInput(project, { timeMs: 0, playing: true }));
    const openingEffect = sourceWithWindow(context, 0, 0.05);
    const openingDialogue = sourceWithWindow(context, 0, 1);
    const openingBgm = sourceWithWindow(context, 0.5, 1.5);
    expect(openingEffect).toBeDefined();
    expect(openingDialogue).toBeDefined();
    expect(openingBgm).toBeDefined();
    await flush();

    context.currentTime = 10.08;
    transport.sync(syncInput(project, { timeMs: 80, playing: true }));
    await flush();
    expect(openingEffect!.start).toHaveBeenCalledTimes(1);
    expect(openingEffect!.start).toHaveBeenCalledWith(10, 0, 0.05);
    expect(openingDialogue!.start).toHaveBeenCalledTimes(1);
    expect(openingDialogue!.start).toHaveBeenCalledWith(10, 0, 1);
    expect(openingBgm!.start).toHaveBeenCalledTimes(1);
    expect(openingBgm!.start).toHaveBeenCalledWith(10, 0.5, 1.5);
    transport.dispose();
  });

  it('cancels a future source before a delayed pause effect can reach its start time', async () => {
    const project = buildAudioProject();
    const shot = project.shots[0]!;
    shot.audioClips = [{ ...shot.audioClips[0]!, id: SFX_A_ID, role: 'sfx',
      startMs: 15, endMs: 45, offsetMs: 0 }];
    const { context, transport } = setup(project);

    transport.sync(syncInput(project, { timeMs: 0 }));
    await flush();
    const source = context.sources[0]!;
    expect(source.start).toHaveBeenCalledWith(10.015, 0, 0.03);

    // Pause/Stop/Seek call this synchronously before React's passive sync effect.
    transport.cancelPlaybackImmediately();
    expect(source.stop).toHaveBeenCalledTimes(1);

    // Let the old scheduled time pass, then deliver the delayed passive effect.
    context.currentTime = 10.1;
    expect(source.start.mock.calls[0]![0]).toBeLessThan(context.currentTime);

    transport.sync(syncInput(project, { timeMs: 0, playing: false }));
    expect(source.stop).toHaveBeenCalledTimes(1);
    transport.dispose();
  });

  it.each([1_500, 3_900])('interrupts old playback before Replay waits at %ims', async (startTimeMs) => {
    const project = buildAudioProject();
    const shot = project.shots[0]!;
    const template = shot.audioClips[0]!;
    const openingAssetId = '10000000-0000-4000-8000-0000000004ff';
    const audioAsset = project.assets.find((asset) => asset.id === AUDIO_ID)!;
    project.assets.push({ ...audioAsset, id: openingAssetId, name: 'Opening audio',
      relativePath: 'assets/opening.wav', sha256: 'd'.repeat(64) });
    shot.audioClips = [
      { ...template, id: SFX_A_ID, role: 'sfx', assetId: openingAssetId,
        startMs: 0, endMs: 500, offsetMs: 0 },
      { ...template, id: CLIP_A_ID, role: 'dialogue', assetId: AUDIO_ID,
        startMs: 1_000, endMs: 4_000, offsetMs: 0 },
    ];
    const openingRead = deferred<AssetPreviewAudioReadResponse>();
    const readAudio = vi.fn((request: AssetPreviewAudioReadRequest) =>
      request.assetId === openingAssetId ? openingRead.promise : Promise.resolve(readyResponse(request)));
    const context = new FakeContext();
    const transport = new ProductPreviewAudioTransport({ createContext: () => context.api(), readAudio });
    const input = liveClockInput(project, performance.now(), startTimeMs);

    transport.sync(input);
    await flush();
    const oldSource = context.sources[0]!;
    expect(oldSource).toBeDefined();
    context.currentTime = 10.02;

    // Overlay commits the paused/repositioned master state synchronously,
    // cancelling old voices before starting bounded Replay preparation.
    transport.cancelPlaybackImmediately();
    expect(oldSource.stop).toHaveBeenCalledTimes(1);
    const replayInput = syncInput(project, { timeMs: 0, playing: false });
    const replayPreparation = transport.prepareForPlayback(replayInput, 0);
    await flush();
    expect(readAudio).toHaveBeenCalledWith(expect.objectContaining({ assetId: openingAssetId }));
    await new Promise<void>((resolve) => setTimeout(resolve, 180));
    expect(replayInput.readMasterSnapshot(performance.now()).timeMs).toBe(0);
    expect(oldSource.stop).toHaveBeenCalledTimes(1);

    openingRead.resolve(readyResponse({ projectRoot: PROJECT_ROOT, assetId: openingAssetId,
      sha256: 'd'.repeat(64) }));
    await expect(replayPreparation).resolves.toMatchObject({ ready: true });
    transport.sync(syncInput(project, { timeMs: 0, playing: true, seekRevision: 1 }));
    await flush();
    expect(oldSource.stop).toHaveBeenCalledTimes(1);
    expect(sourceWithWindow(context, 0, 0.5)).toBeDefined();
    transport.dispose();
  });

  it('keeps old playback stopped when Replay preparation reaches the 500ms bound', async () => {
    const project = buildAudioProject();
    const shot = project.shots[0]!;
    const template = shot.audioClips[0]!;
    const openingAssetId = '10000000-0000-4000-8000-0000000004fe';
    const audioAsset = project.assets.find((asset) => asset.id === AUDIO_ID)!;
    project.assets.push({ ...audioAsset, id: openingAssetId, name: 'Slow opening audio',
      relativePath: 'assets/slow-opening.wav', sha256: 'e'.repeat(64) });
    shot.audioClips = [
      { ...template, id: SFX_A_ID, role: 'sfx', assetId: openingAssetId,
        startMs: 0, endMs: 500, offsetMs: 0 },
      { ...template, id: CLIP_A_ID, role: 'dialogue', assetId: AUDIO_ID,
        startMs: 1_000, endMs: 4_000, offsetMs: 0 },
    ];
    const openingRead = deferred<AssetPreviewAudioReadResponse>();
    const readAudio = vi.fn((request: AssetPreviewAudioReadRequest) =>
      request.assetId === openingAssetId ? openingRead.promise : Promise.resolve(readyResponse(request)));
    const context = new FakeContext();
    const warnings: (string | null)[] = [];
    const transport = new ProductPreviewAudioTransport({ createContext: () => context.api(), readAudio,
      onWarning: (warning) => warnings.push(warning) });
    const input = liveClockInput(project, performance.now(), 1_500);

    transport.sync(input);
    await flush();
    const oldSource = context.sources[0]!;
    expect(oldSource).toBeDefined();

    transport.cancelPlaybackImmediately();
    expect(oldSource.stop).toHaveBeenCalledTimes(1);
    const preparation = transport.prepareForPlayback(syncInput(project, { timeMs: 0, playing: false }), 0);
    await expect(preparation).resolves.toMatchObject({ ready: false, reason: 'timeout' });
    expect(warnings.at(-1)).toBeTruthy();
    expect(oldSource.stop).toHaveBeenCalledTimes(1);

    openingRead.resolve(readyResponse({ projectRoot: PROJECT_ROOT, assetId: openingAssetId,
      sha256: 'e'.repeat(64) }));
    await flush();
    expect(context.sources).toHaveLength(1);
    expect(oldSource.stop).toHaveBeenCalledTimes(1);
    transport.dispose();
  }, 2_000);

  it('reserves capacity for a newly current cue while obsolete future reads remain truly in flight', async () => {
    const project = buildAudioProject();
    const shot = project.shots[0]!;
    const template = shot.audioClips[0]!;
    const sourceAsset = project.assets.find((asset) => asset.id === AUDIO_ID)!;
    const pending = new Map<string, ReturnType<typeof deferred<AssetPreviewAudioReadResponse>>>();
    const reads = vi.fn((request: AssetPreviewAudioReadRequest) => {
      const result = deferred<AssetPreviewAudioReadResponse>();
      pending.set(request.assetId, result);
      return result.promise;
    });
    const futureClips = Array.from({ length: 4 }, (_, index) => {
      const assetId = `10000000-0000-4000-8000-00000000050${index + 1}`;
      project.assets.push({ ...sourceAsset, id: assetId, sha256: String(index + 1).repeat(64) });
      return { ...template,
        id: `70000000-0000-4000-8000-00000000050${index + 1}`,
        role: 'sfx' as const, assetId,
        startMs: 50 + index * 30, endMs: 100 + index * 30, offsetMs: 0 };
    });
    const targetAssetId = '10000000-0000-4000-8000-000000000505';
    project.assets.push({ ...sourceAsset, id: targetAssetId, sha256: '5'.repeat(64) });
    const targetClip = { ...template, id: '70000000-0000-4000-8000-000000000505',
      role: 'dialogue' as const, assetId: targetAssetId, startMs: 1_500, endMs: 1_900, offsetMs: 0 };
    shot.audioClips = [...futureClips, targetClip];
    const context = new FakeContext();
    const transport = new ProductPreviewAudioTransport({ createContext: () => context.api(), readAudio: reads });

    transport.sync(syncInput(project, { timeMs: 0 }));
    await flush();
    expect(reads).toHaveBeenCalledTimes(PRODUCT_PREVIEW_AUDIO_MAX_READS - 1);
    expect(internals(transport).reads.size).toBe(PRODUCT_PREVIEW_AUDIO_MAX_READS - 1);

    transport.sync(syncInput(project, { timeMs: 1_500, seekRevision: 1 }));
    await flush();
    expect(reads).toHaveBeenCalledTimes(PRODUCT_PREVIEW_AUDIO_MAX_READS);
    expect(internals(transport).reads.size).toBe(PRODUCT_PREVIEW_AUDIO_MAX_READS);
    expect(pending.has(targetAssetId)).toBe(true);
    for (const [assetId, result] of pending) {
      result.resolve(readyResponse({ projectRoot: PROJECT_ROOT, assetId, sha256: '1'.repeat(64) }));
    }
    await flush();
    transport.dispose();
  });

  it('cancels a scheduled future source immediately on pause and ignores its late end callback', async () => {
    const project = buildAudioProject();
    const shot = project.shots[0]!;
    shot.audioClips = [{ ...shot.audioClips[0]!, id: SFX_A_ID, role: 'sfx',
      startMs: 300, endMs: 400, offsetMs: 100 }];
    const { context, transport } = setup(project);

    transport.sync(syncInput(project, { timeMs: 0 }));
    await flush();
    const source = context.sources[0]!;
    const lateEnd = source.onended!;
    expect(source.start).toHaveBeenCalledWith(10.3, 0.1, 0.1);

    transport.sync(syncInput(project, { timeMs: 0, playing: false }));
    lateEnd();
    expect(source.stop).toHaveBeenCalledTimes(1);
    expect(source.buffer).toBeNull();
    expect(context.sources).toHaveLength(1);
    expect(internals(transport).voices.size).toBe(0);
    transport.dispose();
  });

  it('returns from startup preparation immediately when the user cancels it', async () => {
    const project = buildAudioProject();
    const context = new FakeContext();
    const read = deferred<AssetPreviewAudioReadResponse>();
    const transport = new ProductPreviewAudioTransport({
      createContext: () => context.api(),
      readAudio: () => read.promise,
    });
    project.shots[0]!.audioClips = [{ ...project.shots[0]!.audioClips[0]!, startMs: 0, endMs: 1_000 }];
    const preparation = transport.prepareForPlayback(syncInput(project, { timeMs: 0, playing: false }), 0);
    await flush();
    transport.cancelPendingStartPreparation();

    await expect(preparation).resolves.toMatchObject({ ready: false, reason: 'cancelled' });
    expect(context.sources).toHaveLength(0);
    expect(internals(transport).reads.size).toBe(1); // IPC remains genuine in-flight work.
    read.resolve(readyResponse({ projectRoot: PROJECT_ROOT, assetId: AUDIO_ID, sha256: 'c'.repeat(64) }));
    await flush();
    expect(context.sources).toHaveLength(0);
    transport.dispose();
  });

  it('schedules a legal next-Shot voice before its boundary and preserves it through handoff', async () => {
    const project = buildAudioProject();
    const first = project.shots[0]!;
    const template = first.audioClips[0]!;
    const second = structuredClone(first);
    const secondAssetId = AUDIO_B_ID;
    const firstAsset = project.assets.find((asset) => asset.id === AUDIO_ID)!;
    project.assets.push({ ...firstAsset, id: secondAssetId, sha256: 'd'.repeat(64), name: 'Next Shot audio' });
    first.durationMs = 1_000;
    first.audioClips = [{ ...template, id: CLIP_A_ID, role: 'bgm', startMs: 0, endMs: 1_000, offsetMs: 0 }];
    second.id = '50000000-0000-4000-8000-000000000402';
    second.name = 'Next Shot';
    second.durationMs = 1_000;
    second.audioClips = [{ ...template, id: '70000000-0000-4000-8000-000000000407',
      role: 'sfx', assetId: secondAssetId, startMs: 0, endMs: 500, offsetMs: 200 }];
    project.shots.push(second);
    const context = new FakeContext();
    const transport = new ProductPreviewAudioTransport({
      createContext: () => context.api(),
      readAudio: async (request) => readyResponse(request),
    });

    transport.sync(projectTimeInput(project, 900));
    await flush();
    const nextShotSource = context.sources.find((source) => source.start.mock.calls[0]?.[2] === 0.5);
    expect(nextShotSource).toBeDefined();
    expect(nextShotSource!.start).toHaveBeenCalledWith(10.1, 0.2, 0.5);

    context.currentTime = 10.1;
    transport.sync(projectTimeInput(project, 1_000));
    await flush();
    expect(nextShotSource!.start).toHaveBeenCalledTimes(1);
    expect(nextShotSource!.stop).not.toHaveBeenCalled();
    transport.dispose();
  });

  it('does not prewarm or play a different Shot while Preview is in Shot range', async () => {
    const project = buildAudioProject();
    const first = project.shots[0]!;
    const template = first.audioClips[0]!;
    const second = structuredClone(first);
    second.id = '50000000-0000-4000-8000-000000000499';
    second.audioClips = [{ ...template, id: '70000000-0000-4000-8000-000000000499', startMs: 0, endMs: 200 }];
    project.shots.push(second);
    first.audioClips = [];
    const { context, transport, readAudio } = setup(project);

    transport.sync(syncInput(project, { shot: first, range: 'shot', timeMs: 900 }));
    await flush();
    expect(readAudio).not.toHaveBeenCalled();
    expect(context.sources).toHaveLength(0);
    transport.dispose();
  });
});
