import { describe, expect, it } from 'vitest';
import {
  ProjectSchema,
  type Project,
} from '../../src/domain';
import {
  type AssetPreviewAudioReadRequest,
  type AssetPreviewAudioReadResponse,
} from '../../src/shared/asset-preview-audio-api';
import {
  ProductPreviewAudioTransport,
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
        name: '预览对白',
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
          endMs: 1_000,
          text: '第一句',
        },
        {
          id: DIALOGUE_B_ID,
          characterId: IDS.character,
          voiceProfileId: IDS.voiceProfile,
          subtitleStyleId: IDS.subtitle,
          audioClipId: CLIP_B_ID,
          startMs: 1_500,
          endMs: 2_000,
          text: '第二句',
        },
      ],
      audioClips: [
        {
          id: CLIP_A_ID,
          name: '第一句音频',
          assetId: AUDIO_ID,
          startMs: 500,
          endMs: 1_000,
          offsetMs: 100,
          volume: 0.75,
        },
        {
          id: CLIP_B_ID,
          name: '第二句音频',
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

  pause(): void {
    this.paused = true;
    this.pauseCount += 1;
  }

  async play(): Promise<void> {
    this.paused = false;
    this.playCount += 1;
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

describe('Product Preview audio transport', () => {
  it('resolves only a valid active audio binding and maps master time to source time', () => {
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
  });

  it('plays one element, does not re-seek on ordinary master ticks, and pauses/resumes from master time', async () => {
    const project = buildAudioProject();
    const audio = new FakeAudio();
    let reads = 0;
    let createdUrls = 0;
    const transport = new ProductPreviewAudioTransport({
      createAudio: () => audio,
      readAudio: async (request) => {
        reads += 1;
        return readyResponse(request);
      },
      createObjectUrl: () => `blob:${++createdUrls}`,
      revokeObjectUrl: () => undefined,
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
    transport.sync(syncInput(project, { timeMs: 700 }));
    await flush();
    expect(audio.currentTime).toBe(0.3);
    expect(audio.playCount).toBe(2);
    expect(reads).toBe(1);
    expect(createdUrls).toBe(1);
    transport.dispose();
  });

  it('repositions on explicit seek, stops old dialogue before transition, and resets on stop', async () => {
    const project = buildAudioProject();
    const audio = new FakeAudio();
    const transport = new ProductPreviewAudioTransport({
      createAudio: () => audio,
      readAudio: async (request) => readyResponse(request),
      createObjectUrl: (() => {
        let count = 0;
        return () => `blob:${++count}`;
      })(),
      revokeObjectUrl: () => undefined,
    });

    transport.sync(syncInput(project));
    await flush();
    const pausesBeforeSeek = audio.pauseCount;
    transport.sync(syncInput(project, { timeMs: 900, seekRevision: 1 }));
    await flush();
    expect(audio.pauseCount).toBeGreaterThan(pausesBeforeSeek);
    expect(audio.currentTime).toBe(0.5);
    expect(audio.playCount).toBe(2);

    transport.sync(
      syncInput(project, {
        activeDialogueId: DIALOGUE_B_ID,
        timeMs: 1_600,
        seekRevision: 1,
      }),
    );
    await flush();
    expect(audio.src).toBe('blob:1');
    expect(audio.currentTime).toBe(0.6);
    expect(audio.playCount).toBe(3);

    transport.sync(syncInput(project, { timeMs: 0, playing: false, seekRevision: 2 }));
    expect(audio.paused).toBe(true);
    expect(audio.currentTime).toBe(0);
    transport.dispose();
  });

  it('replays repeatedly from cached bytes without creating more than one URL', async () => {
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
    for (let count = 0; count < 5; count += 1) {
      transport.sync(syncInput(project, { timeMs: 600, seekRevision: count }));
      await flush();
      transport.sync(
        syncInput(project, {
          timeMs: 0,
          playing: false,
          seekRevision: count + 10,
        }),
      );
    }
    expect(reads).toBe(1);
    expect(urls).toBe(1);
    transport.dispose();
    expect(revoked).toEqual(['blob:1']);
  });

  it('does not start after a stale read and reports corrupt audio without mutating Project', async () => {
    const project = buildAudioProject();
    const before = JSON.parse(JSON.stringify(project));
    const audio = new FakeAudio();
    let resolveRead!: (response: AssetPreviewAudioReadResponse) => void;
    const warnings: (string | null)[] = [];
    const transport = new ProductPreviewAudioTransport({
      createAudio: () => audio,
      readAudio: () =>
        new Promise((resolve) => {
          resolveRead = resolve;
        }),
      onWarning: (message) => warnings.push(message),
    });
    transport.sync(syncInput(project));
    transport.sync(syncInput(project, { playing: false }));
    resolveRead(readyResponse({
      projectRoot: PROJECT_ROOT,
      assetId: AUDIO_ID,
      sha256: 'c'.repeat(64),
    }));
    await flush();
    expect(audio.playCount).toBe(0);
    expect(project).toEqual(before);
    transport.dispose();

    const corruptWarnings: (string | null)[] = [];
    const corrupt = new ProductPreviewAudioTransport({
      createAudio: () => new FakeAudio(),
      readAudio: async (request) => ({
        ok: false,
        error: {
          code: 'ASSET_PREVIEW_AUDIO_READ_FAILED',
          message: 'safe failure',
          assetId: request.assetId,
        },
      }),
      onWarning: (message) => corruptWarnings.push(message),
    });
    corrupt.sync(syncInput(project));
    await flush();
    expect(corruptWarnings.join('|')).toContain('无法读取');
    corrupt.dispose();
  });
});
