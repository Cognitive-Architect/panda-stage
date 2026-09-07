import { describe, expect, it } from 'vitest';
import { ProjectSchema, type Project } from '../../src/domain';
import type {
  AssetPreviewAudioReadRequest,
  AssetPreviewAudioReadResponse,
} from '../../src/shared/asset-preview-audio-api';
import {
  ProductPreviewAudioTransport,
  isProductPreviewAudioActiveAtTime,
  productPreviewSourceTimeMs,
  resolveProductPreviewAudio,
  type ProductPreviewAudioElement,
} from '../../src/renderer/shell/productPreviewAudio';
import { buildProject, IDS } from './domain/testProject';

const AUDIO_ID = '10000000-0000-4000-8000-000000000401';
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
          name: '第一句配音',
          assetId: AUDIO_ID,
          startMs: 500,
          endMs: 1_000,
          offsetMs: 100,
          volume: 0.75,
        },
        {
          id: CLIP_B_ID,
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

class FakeAudio implements ProductPreviewAudioElement {
  src = '';
  currentTime = 0;
  volume = 1;
  paused = true;
  playCount = 0;
  pauseCount = 0;
  loadCount = 0;

  pause(): void {
    this.paused = true;
    this.pauseCount += 1;
  }

  async play(): Promise<void> {
    this.paused = false;
    this.playCount += 1;
  }

  load(): void {
    this.loadCount += 1;
  }
}

function readyResponse(
  request: AssetPreviewAudioReadRequest,
): AssetPreviewAudioReadResponse {
  return {
    ok: true,
    status: 'ready',
    assetId: request.assetId,
    mimeType: 'audio/wav',
    byteLength: 4,
    bytes: new Uint8Array([1, 2, 3, 4]),
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function syncInput(
  project: Project,
  overrides: Partial<Parameters<ProductPreviewAudioTransport['sync']>[0]> = {},
): Parameters<ProductPreviewAudioTransport['sync']>[0] {
  return {
    projectRoot: PROJECT_ROOT,
    project,
    shot: project.shots[0]!,
    activeDialogueId: DIALOGUE_A_ID,
    timeMs: 600,
    playing: true,
    seekRevision: 0,
    ...overrides,
  };
}

describe('Product Preview audio transport — Phase 2 gate A', () => {
  it('resolves only the active Dialogue binding and maps bounded source time', () => {
    const project = buildAudioProject();
    const shot = project.shots[0]!;
    const selection = resolveProductPreviewAudio(
      project,
      shot,
      DIALOGUE_A_ID,
    )!;

    expect(selection.clip.id).toBe(CLIP_A_ID);
    expect(productPreviewSourceTimeMs(600, selection.clip, selection.asset)).toBe(
      200,
    );
    expect(productPreviewSourceTimeMs(100, selection.clip, selection.asset)).toBe(
      0,
    );
    expect(
      productPreviewSourceTimeMs(99_999, selection.clip, selection.asset),
    ).toBe(3_000);
    expect(resolveProductPreviewAudio(project, shot, null)).toBeNull();
    expect(isProductPreviewAudioActiveAtTime(999, selection)).toBe(true);
    expect(isProductPreviewAudioActiveAtTime(1_000, selection)).toBe(false);
  });

  it('uses one element, avoids tick reseeks, and resumes from latest master time', async () => {
    const project = buildAudioProject();
    const audio = new FakeAudio();
    let reads = 0;
    let urls = 0;
    const revoked: string[] = [];
    const transport = new ProductPreviewAudioTransport({
      createAudio: () => audio,
      readAudio: async (request) => {
        reads += 1;
        return readyResponse(request);
      },
      createObjectUrl: () => `blob:${++urls}`,
      revokeObjectUrl: (url) => revoked.push(url),
    });

    transport.sync(syncInput(project));
    await flush();
    expect(audio).toMatchObject({
      src: 'blob:1',
      currentTime: 0.2,
      volume: 0.75,
      playCount: 1,
      paused: false,
    });

    transport.sync(syncInput(project, { timeMs: 700 }));
    expect(audio.currentTime).toBe(0.2);
    expect(audio.playCount).toBe(1);

    transport.sync(syncInput(project, { timeMs: 700, playing: false }));
    expect(audio.paused).toBe(true);
    transport.sync(syncInput(project, { timeMs: 800 }));
    await flush();
    expect(audio.currentTime).toBe(0.4);
    expect(audio.playCount).toBe(2);
    expect(reads).toBe(1);
    expect(urls).toBe(1);
    transport.dispose();
    expect(revoked).toEqual(['blob:1']);
  });

  it('starts a delayed read from the latest Preview master time', async () => {
    const project = buildAudioProject();
    const audio = new FakeAudio();
    const read = deferred<AssetPreviewAudioReadResponse>();
    const transport = new ProductPreviewAudioTransport({
      createAudio: () => audio,
      readAudio: () => read.promise,
      createObjectUrl: () => 'blob:delayed',
    });

    transport.sync(syncInput(project, { timeMs: 600 }));
    transport.sync(syncInput(project, { timeMs: 800 }));
    read.resolve(
      readyResponse({
        projectRoot: PROJECT_ROOT,
        assetId: AUDIO_ID,
        sha256: 'c'.repeat(64),
      }),
    );
    await flush();

    expect(audio.playCount).toBe(1);
    expect(audio.currentTime).toBe(0.4);
    transport.dispose();
  });

  it('repositions on seek and replaces the prior Dialogue without ghost audio', async () => {
    const project = buildAudioProject();
    const audio = new FakeAudio();
    const transport = new ProductPreviewAudioTransport({
      createAudio: () => audio,
      readAudio: async (request) => readyResponse(request),
      createObjectUrl: () => 'blob:shared-asset',
    });

    transport.sync(syncInput(project));
    await flush();
    const pausesBeforeSeek = audio.pauseCount;
    transport.sync(syncInput(project, { timeMs: 900, seekRevision: 1 }));
    await flush();
    expect(audio.pauseCount).toBeGreaterThan(pausesBeforeSeek);
    expect(audio.currentTime).toBe(0.5);
    expect(audio.playCount).toBe(2);

    const pausesBeforeTransition = audio.pauseCount;
    transport.sync(
      syncInput(project, {
        activeDialogueId: DIALOGUE_B_ID,
        timeMs: 1_600,
        seekRevision: 1,
      }),
    );
    await flush();
    expect(audio.pauseCount).toBeGreaterThan(pausesBeforeTransition);
    expect(audio.currentTime).toBe(0.6);
    expect(audio.playCount).toBe(3);
    transport.dispose();
  });

  it('keeps Stop stopped when a pending read completes and suppresses stale warning', async () => {
    const project = buildAudioProject();
    const audio = new FakeAudio();
    const read = deferred<AssetPreviewAudioReadResponse>();
    const warnings: (string | null)[] = [];
    const transport = new ProductPreviewAudioTransport({
      createAudio: () => audio,
      readAudio: () => read.promise,
      createObjectUrl: () => 'blob:stopped-read',
      onWarning: (warning) => warnings.push(warning),
    });

    transport.sync(syncInput(project));
    transport.sync(
      syncInput(project, { timeMs: 0, playing: false, seekRevision: 1 }),
    );
    warnings.length = 0;
    read.resolve(
      readyResponse({
        projectRoot: PROJECT_ROOT,
        assetId: AUDIO_ID,
        sha256: 'c'.repeat(64),
      }),
    );
    await flush();

    expect(audio).toMatchObject({
      playCount: 0,
      paused: true,
      currentTime: 0,
      src: '',
    });
    expect(warnings).toEqual([]);
    transport.dispose();
  });

  it('replays five times on one element and one cached URL without stacking', async () => {
    const project = buildAudioProject();
    const audio = new FakeAudio();
    let reads = 0;
    let urls = 0;
    const revoked: string[] = [];
    const transport = new ProductPreviewAudioTransport({
      createAudio: () => audio,
      readAudio: async (request) => {
        reads += 1;
        return readyResponse(request);
      },
      createObjectUrl: () => `blob:replay-${++urls}`,
      revokeObjectUrl: (url) => revoked.push(url),
    });

    for (let count = 0; count < 5; count += 1) {
      transport.sync(
        syncInput(project, { timeMs: 600, seekRevision: count + 1 }),
      );
      await flush();
      expect(audio.currentTime).toBe(0.2);
      transport.sync(
        syncInput(project, {
          timeMs: 0,
          playing: false,
          seekRevision: count + 101,
        }),
      );
      expect(audio.paused).toBe(true);
    }

    expect(audio.playCount).toBe(5);
    expect(reads).toBe(1);
    expect(urls).toBe(1);
    transport.dispose();
    expect(revoked).toEqual(['blob:replay-1']);
  });

  it('stops at AudioClip end while the longer subtitle remains active', async () => {
    const project = buildAudioProject();
    const audio = new FakeAudio();
    const transport = new ProductPreviewAudioTransport({
      createAudio: () => audio,
      readAudio: async (request) => readyResponse(request),
      createObjectUrl: () => 'blob:independent',
    });

    transport.sync(syncInput(project, { timeMs: 900 }));
    await flush();
    expect(audio.playCount).toBe(1);
    transport.sync(syncInput(project, { timeMs: 1_000 }));
    expect(audio.paused).toBe(true);
    expect(audio.playCount).toBe(1);
    expect(project.shots[0]!.dialogues[0]!.endMs).toBe(1_200);
    transport.dispose();
  });

  it('drops a delayed ready read after dispose without URL, playback, warning, or cache', async () => {
    const project = buildAudioProject();
    const audio = new FakeAudio();
    const read = deferred<AssetPreviewAudioReadResponse>();
    const warnings: (string | null)[] = [];
    const created: string[] = [];
    const revoked: string[] = [];
    const transport = new ProductPreviewAudioTransport({
      createAudio: () => audio,
      readAudio: () => read.promise,
      createObjectUrl: () => {
        created.push('blob:late');
        return 'blob:late';
      },
      revokeObjectUrl: (url) => revoked.push(url),
      onWarning: (warning) => warnings.push(warning),
    });

    transport.sync(syncInput(project));
    warnings.length = 0;
    transport.dispose();
    read.resolve(
      readyResponse({
        projectRoot: PROJECT_ROOT,
        assetId: AUDIO_ID,
        sha256: 'c'.repeat(64),
      }),
    );
    await flush();

    expect(audio.playCount).toBe(0);
    expect(warnings).toEqual([]);
    expect(created).toEqual([]);
    expect(revoked).toEqual([]);
    const internals = transport as unknown as {
      urlCache: Map<string, string>;
      urlReads: Map<string, Promise<string>>;
    };
    expect(internals.urlCache.size).toBe(0);
    expect(internals.urlReads.size).toBe(0);
  });

  it('immediately revokes a URL if disposal happens during URL creation', async () => {
    const project = buildAudioProject();
    const audio = new FakeAudio();
    const revoked: string[] = [];
    const holder: { transport?: ProductPreviewAudioTransport } = {};
    const transport = new ProductPreviewAudioTransport({
      createAudio: () => audio,
      readAudio: async (request) => readyResponse(request),
      createObjectUrl: () => {
        holder.transport?.dispose();
        return 'blob:disposed-during-create';
      },
      revokeObjectUrl: (url) => revoked.push(url),
    });
    holder.transport = transport;

    transport.sync(syncInput(project));
    await flush();

    expect(audio.playCount).toBe(0);
    expect(revoked).toEqual(['blob:disposed-during-create']);
  });

  it('suppresses delayed errors after dispose and reports active failures truthfully', async () => {
    const project = buildAudioProject();
    const before = JSON.parse(JSON.stringify(project));
    const lateRead = deferred<AssetPreviewAudioReadResponse>();
    const lateWarnings: (string | null)[] = [];
    const lateTransport = new ProductPreviewAudioTransport({
      createAudio: () => new FakeAudio(),
      readAudio: () => lateRead.promise,
      onWarning: (warning) => lateWarnings.push(warning),
    });
    lateTransport.sync(syncInput(project));
    lateWarnings.length = 0;
    lateTransport.dispose();
    lateRead.reject(new Error('late read failed'));
    await flush();
    expect(lateWarnings).toEqual([]);

    const warnings: (string | null)[] = [];
    const audio = new FakeAudio();
    const failedTransport = new ProductPreviewAudioTransport({
      createAudio: () => audio,
      readAudio: async (request) => ({
        ok: false,
        error: {
          code: 'ASSET_PREVIEW_AUDIO_READ_FAILED',
          message: 'safe failure',
          assetId: request.assetId,
        },
      }),
      onWarning: (warning) => warnings.push(warning),
    });
    failedTransport.sync(syncInput(project));
    await flush();

    expect(audio.playCount).toBe(0);
    expect(warnings.at(-1)).toBe('配音无法预览，画面和字幕将继续播放。');
    expect(warnings.join('|')).not.toContain('口型');
    expect(project).toEqual(before);
    failedTransport.dispose();

    const playWarnings: (string | null)[] = [];
    const playFailure = new FakeAudio();
    playFailure.play = async () => {
      playFailure.playCount += 1;
      throw new Error('decoder rejected playback');
    };
    const playFailureTransport = new ProductPreviewAudioTransport({
      createAudio: () => playFailure,
      readAudio: async (request) => readyResponse(request),
      createObjectUrl: () => 'blob:play-failure',
      onWarning: (warning) => playWarnings.push(warning),
    });
    playFailureTransport.sync(syncInput(project));
    await flush();
    expect(playWarnings.at(-1)).toBe(
      '配音无法预览，画面和字幕将继续播放。',
    );
    expect(project).toEqual(before);
    playFailureTransport.dispose();
  });
});
