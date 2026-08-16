/**
 * Stage 1B — product preview overlay contract.
 *
 * Two layers of assertions:
 *   1. Behavioural unit tests over the pure preview model (no React, no DOM,
 *      matching the repository's `node` vitest environment).
 *   2. Source-level contract locks proving the overlay reuses the FORMAL
 *      evaluator/renderer and stays strictly read-only — it must never touch
 *      the project, revision, dirty flag, selection or history stores.
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  evaluateShotAtTime,
  type Project,
  type Shot,
} from '../../src/domain';
import { evaluateSubtitleAtTime } from '../../src/shared/preview/subtitle-engine';
import {
  PRODUCT_PREVIEW_MAX_STEP_MS,
  advanceProductPreviewTime,
  buildProductPreviewCues,
  clampProductPreviewTime,
  formatProductPreviewTimecode,
  listProductPreviewAssetIds,
  resolveProductPreviewShot,
} from '../../src/renderer/shell/productPreviewModel';

const OVERLAY_PATH = 'src/renderer/shell/ProductPreviewOverlay.tsx';
const MODEL_PATH = 'src/renderer/shell/productPreviewModel.ts';
const SHELL_PATH = 'src/renderer/shell/EditorShell.tsx';
const TOP_BAR_PATH = 'src/renderer/shell/CompactProjectBar.tsx';

function readSource(path: string): string {
  return readFileSync(path, 'utf8');
}

const BACKGROUND_ASSET_ID = randomUUID();
const HAPPY_ASSET_ID = randomUUID();
const SAD_ASSET_ID = randomUUID();
const UNUSED_ASSET_ID = randomUUID();
const CHARACTER_ID = randomUUID();
const HAPPY_EXPRESSION_ID = randomUUID();
const SAD_EXPRESSION_ID = randomUUID();
const BACKGROUND_LAYER_ID = randomUUID();
const CHARACTER_LAYER_ID = randomUUID();
const SHOT_ID = randomUUID();
const SUBTITLE_STYLE_ID = randomUUID();
const DIALOGUE_ID = randomUUID();
const SECOND_DIALOGUE_ID = randomUUID();

function imageAsset(id: string, name: string): Project['assets'][number] {
  return {
    id,
    kind: 'image',
    name,
    relativePath: `assets/${name}.png`,
    mimeType: 'image/png',
    sha256: 'a'.repeat(64),
    byteSize: 2_048,
    width: 1_920,
    height: 1_080,
  } as Project['assets'][number];
}

function buildShot(overrides: Partial<Shot> = {}): Shot {
  return {
    id: SHOT_ID,
    name: '开场镜头',
    durationMs: 4_000,
    defaultSubtitleStyleId: SUBTITLE_STYLE_ID,
    dialogues: [],
    audioClips: [],
    timelineEvents: [],
    backgroundLayerId: BACKGROUND_LAYER_ID,
    layers: [
      {
        id: BACKGROUND_LAYER_ID,
        name: '背景',
        source: { kind: 'asset', assetId: BACKGROUND_ASSET_ID },
        anchor: 'center',
        x: 960,
        y: 540,
        scaleX: 1,
        scaleY: 1,
        flipX: false,
        rotationDeg: 0,
        opacity: 1,
        visible: true,
        locked: false,
        zIndex: 0,
      },
      {
        id: CHARACTER_LAYER_ID,
        name: '角色',
        source: {
          kind: 'character',
          characterId: CHARACTER_ID,
          expressionId: HAPPY_EXPRESSION_ID,
        },
        anchor: 'center',
        x: 700,
        y: 620,
        scaleX: 1,
        scaleY: 1,
        flipX: false,
        rotationDeg: 0,
        opacity: 1,
        visible: true,
        locked: false,
        zIndex: 1,
      },
    ],
    ...overrides,
  } as Shot;
}

function buildProject(shot: Shot = buildShot()): Project {
  return {
    schemaVersion: 6,
    id: randomUUID(),
    name: '熊猫剧场',
    width: 1_920,
    height: 1_080,
    fps: 30,
    assets: [
      imageAsset(BACKGROUND_ASSET_ID, 'background'),
      imageAsset(HAPPY_ASSET_ID, 'happy'),
      imageAsset(SAD_ASSET_ID, 'sad'),
      imageAsset(UNUSED_ASSET_ID, 'unused'),
    ],
    characters: [
      {
        id: CHARACTER_ID,
        name: '小熊猫',
        expressions: [
          {
            id: HAPPY_EXPRESSION_ID,
            name: '开心',
            assetId: HAPPY_ASSET_ID,
          },
          {
            id: SAD_EXPRESSION_ID,
            name: '难过',
            assetId: SAD_ASSET_ID,
          },
        ],
      },
    ],
    voiceProfiles: [],
    subtitleStyles: [
      {
        id: SUBTITLE_STYLE_ID,
        name: '默认字幕',
        fontFamily: 'Microsoft YaHei',
        fontSizePx: 44,
        color: '#ffffff',
        strokeColor: '#000000',
        strokeWidthPx: 2,
      },
    ],
    shots: [shot],
  } as unknown as Project;
}

describe('product preview model', () => {
  it('falls back to the first shot and reports an empty project honestly', () => {
    const shot = buildShot();
    const project = buildProject(shot);

    expect(resolveProductPreviewShot(project, shot.id)?.id).toBe(shot.id);
    expect(resolveProductPreviewShot(project, null)?.id).toBe(shot.id);
    expect(resolveProductPreviewShot(project, randomUUID())?.id).toBe(shot.id);
    expect(
      resolveProductPreviewShot({ ...project, shots: [] }, null),
    ).toBeNull();
  });

  it('preloads every expression a character layer can switch to mid-shot', () => {
    const project = buildProject();
    const shot = project.shots[0];
    if (!shot) throw new Error('fixture shot missing');

    const assetIds = listProductPreviewAssetIds(project, shot);

    // Base assets plus the *other* expression reachable via an expression event.
    expect(new Set(assetIds)).toEqual(
      new Set([BACKGROUND_ASSET_ID, HAPPY_ASSET_ID, SAD_ASSET_ID]),
    );
    expect(assetIds).not.toContain(UNUSED_ASSET_ID);
    expect(new Set(assetIds).size).toBe(assetIds.length);
  });

  it('projects dialogues onto the shared subtitle cue contract', () => {
    const shot = buildShot({
      dialogues: [
        {
          id: SECOND_DIALOGUE_ID,
          characterId: CHARACTER_ID,
          voiceProfileId: randomUUID(),
          audioClipId: randomUUID(),
          subtitleStyleId: SUBTITLE_STYLE_ID,
          startMs: 2_000,
          endMs: 3_000,
          text: '  第二句台词  ',
        },
        {
          id: DIALOGUE_ID,
          characterId: CHARACTER_ID,
          voiceProfileId: randomUUID(),
          audioClipId: randomUUID(),
          subtitleStyleId: SUBTITLE_STYLE_ID,
          startMs: 0,
          endMs: 1_000,
          text: '第一句台词',
        },
        {
          id: randomUUID(),
          characterId: CHARACTER_ID,
          voiceProfileId: randomUUID(),
          audioClipId: randomUUID(),
          subtitleStyleId: SUBTITLE_STYLE_ID,
          startMs: 3_500,
          endMs: 3_500,
          text: '零长度不显示',
        },
      ],
    } as Partial<Shot>);

    const cues = buildProductPreviewCues(shot);

    expect(cues.map((cue) => cue.text)).toEqual([
      '第一句台词',
      '第二句台词',
    ]);
    // Reuses the shared subtitle engine rather than a preview-only matcher.
    expect(evaluateSubtitleAtTime(cues, 500)?.text).toBe('第一句台词');
    expect(evaluateSubtitleAtTime(cues, 2_500)?.text).toBe('第二句台词');
    expect(evaluateSubtitleAtTime(cues, 1_500)).toBeNull();
  });

  it('advances a clamped local clock and stops exactly at the shot end', () => {
    expect(advanceProductPreviewTime(0, 16, 4_000)).toEqual({
      timeMs: 16,
      ended: false,
    });
    // A suspended tab must not fast-forward the whole shot in one frame.
    expect(advanceProductPreviewTime(0, 10_000, 4_000)).toEqual({
      timeMs: PRODUCT_PREVIEW_MAX_STEP_MS,
      ended: false,
    });
    expect(advanceProductPreviewTime(3_900, 200, 4_000)).toEqual({
      timeMs: 4_000,
      ended: true,
    });
    expect(advanceProductPreviewTime(0, Number.NaN, 4_000).timeMs).toBe(0);
    expect(advanceProductPreviewTime(0, -50, 4_000).timeMs).toBe(0);
  });

  it('clamps and formats scrub positions without leaking fractions', () => {
    expect(clampProductPreviewTime(-10, 4_000)).toBe(0);
    expect(clampProductPreviewTime(9_999, 4_000)).toBe(4_000);
    expect(clampProductPreviewTime(1_234.7, 4_000)).toBe(1_235);
    expect(clampProductPreviewTime(Number.NaN, 4_000)).toBe(0);
    expect(formatProductPreviewTimecode(0)).toBe('0:00.00');
    expect(formatProductPreviewTimecode(3_200)).toBe('0:03.20');
    expect(formatProductPreviewTimecode(65_430)).toBe('1:05.43');
  });

  it('keeps the clamped time consumable by the formal evaluator', () => {
    const project = buildProject();
    const shot = project.shots[0];
    if (!shot) throw new Error('fixture shot missing');

    const evaluated = evaluateShotAtTime(
      shot,
      clampProductPreviewTime(9_999, shot.durationMs),
      project,
    );

    expect(evaluated.timeMs).toBe(shot.durationMs);
    expect(evaluated.layers).toHaveLength(2);
  });
});

describe('product preview overlay contract', () => {
  it('reuses the formal evaluator and renderer instead of a preview copy', () => {
    const overlay = readSource(OVERLAY_PATH);

    expect(overlay).toContain('evaluateShotAtTime');
    expect(overlay).toContain('evaluateSubtitleAtTime');
    expect(overlay).toContain("from '../stage/CanvasStage'");
    expect(overlay).toContain('<CanvasStage');
    // No preview-only evaluation/drawing implementation.
    expect(overlay).not.toContain('react-konva');
    expect(overlay).not.toContain('buildStageRenderModel(');
    expect(overlay).not.toContain('PROBE_PROJECT');
    expect(overlay).not.toContain('PROBE_SHOT');
    expect(overlay).not.toContain('StagePreview');
  });

  it('never writes the project, revision, dirty flag, selection or history', () => {
    const overlay = readSource(OVERLAY_PATH);
    const model = readSource(MODEL_PATH);
    const sources = `${overlay}\n${model}`;

    for (const forbidden of [
      'editorProjectStore',
      'selectionStore',
      'layerStore',
      'shotStore',
      'historyStore',
      'canvasViewportStore',
      'updateProject(',
      'restore(',
      '.select(',
      'window.pandaStage.project',
      'window.pandaStage.autosave',
      'window.pandaStage.recovery',
    ]) {
      expect(sources).not.toContain(forbidden);
    }
    // The only IPC it may use is read-only image/audio source access.
    expect(overlay).toContain('window.pandaStage.assets.readThumbnail');
    expect(
      overlay.match(/window\.pandaStage\.[a-zA-Z.]+/gu),
    ).toEqual([
      'window.pandaStage.assets.readThumbnail',
      'window.pandaStage.assets.readAudio',
    ]);
  });

  it('owns only its local playback state and no second project tree', () => {
    const overlay = readSource(OVERLAY_PATH);

    expect(overlay).toContain('const [timeMs, setTimeMs] = useState(0)');
    expect(overlay).toContain(
      'const [playing, setPlaying] = useState(false)',
    );
    // Project data arrives as a read-only prop; the overlay does not subscribe.
    expect(overlay).not.toContain('useSyncExternalStore');
    expect(overlay).toContain('project: Project;');
    expect(overlay).toContain('shotId: string | null;');
  });

  it('shows a Chinese empty state when the project has no shot', () => {
    const overlay = readSource(OVERLAY_PATH);

    expect(overlay).toContain('data-testid="product-preview-empty"');
    expect(overlay).toContain('当前项目还没有可预览的镜头');
    expect(overlay).toContain(
      '请先在镜头管理中创建一个镜头，然后再打开产品预览。',
    );
    expect(overlay).toMatch(
      /shot === null \?[\s\S]*?product-preview-empty/u,
    );
  });

  it('exposes a read-only transport and states the no-dirty guarantee', () => {
    const overlay = readSource(OVERLAY_PATH);

    for (const selector of [
      'data-testid="product-preview-overlay"',
      'data-testid="product-preview-play"',
      'data-testid="product-preview-pause"',
      'data-testid="product-preview-stop"',
      'data-testid="product-preview-scrubber"',
      'data-testid="product-preview-timecode"',
      'data-testid="product-preview-close"',
    ]) {
      expect(overlay).toContain(selector);
    }
    expect(overlay).toContain(
      '预览只读：播放进度不会修改项目内容，也不会产生未保存更改。',
    );
    expect(overlay).toContain('role="dialog"');
    expect(overlay).toContain('aria-modal="true"');
  });

  it('is mounted only while open so no hidden DOM survives closing', () => {
    const shell = readSource(SHELL_PATH);

    expect(shell.match(/<ProductPreviewOverlay/gu)).toHaveLength(1);
    expect(shell).toMatch(
      /productPreviewOpen \? \(\s*<ProductPreviewOverlay/u,
    );
    expect(shell).toContain(
      'const [productPreviewOpen, setProductPreviewOpen] = useState(false)',
    );
    expect(shell).not.toContain('hidden={!productPreviewOpen}');
    expect(shell).not.toContain("display: 'none'");
  });

  it('keeps a real preview entry in the compact project menu', () => {
    const topBar = readSource(TOP_BAR_PATH);

    expect(topBar).not.toContain('product-preview-placeholder');
    expect(topBar).not.toContain('产品预览（后续阶段启用）');
    expect(topBar).toContain('data-testid="menu-open-product-preview"');
    expect(topBar).toContain('disabled={productPreviewOpen}');
    expect(topBar).toContain('onOpenProductPreview');
  });
});
