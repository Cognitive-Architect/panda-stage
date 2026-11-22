// @vitest-environment happy-dom
import { act, createElement, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CharacterMotionService,
  CharacterService,
  LayerService,
  PROJECT_SCHEMA_VERSION,
  ProjectSchema,
  evaluateShotAtTime,
  projectShotDialogueVisual,
  resolveLayerVisualParts,
  resolveTalkingHeadMotionTransform,
  upsertExpressionEventAtTime,
  upsertMouthCueEventAtTime,
  type AdaptivePartsCharacter,
  type ImageAsset,
  type Project,
} from '../../src/domain';
import { evaluateExportShotAtTime } from '../../src/export-renderer/evaluateExportShotAtTime';
import { CharacterAssemblyWorkbench } from '../../src/renderer/features/characters/CharacterAssemblyWorkbench';
import { isAdaptivePartsAssemblySnapshot } from '../../src/renderer/features/characters/characterAssemblyPreview';
import { characterAssemblySessionStore } from '../../src/renderer/stores/characterAssemblySessionStore';
import { editorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { buildStageRenderModel } from '../../src/shared/stage/render-model';
import { faceSource, graphicFaceProject } from '../helpers/graphicFaceProject';
import { IDS } from './domain/testProject';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const ASSET_BACK_HAIR = 'd1000000-0000-4000-8000-000000000001';
const ASSET_BODY = 'd1000000-0000-4000-8000-000000000002';
const ASSET_HEAD = 'd1000000-0000-4000-8000-000000000003';
const ASSET_FACE = 'd1000000-0000-4000-8000-000000000004';
const ASSET_FRONT_HAIR = 'd1000000-0000-4000-8000-000000000005';
const ASSET_SMILE = 'd1000000-0000-4000-8000-000000000006';
const ASSET_MOUTH = 'd1000000-0000-4000-8000-000000000007';
const ASSET_AUDIO = 'd1000000-0000-4000-8000-000000000008';

const PART_BACK_HAIR = 'd2000000-0000-4000-8000-000000000001';
const PART_BODY = 'd2000000-0000-4000-8000-000000000002';
const PART_HEAD = 'd2000000-0000-4000-8000-000000000003';
const PART_FACE = 'd2000000-0000-4000-8000-000000000004';
const PART_FRONT_HAIR = 'd2000000-0000-4000-8000-000000000005';
const AUDIO_CLIP_ID = 'd3000000-0000-4000-8000-000000000001';
const DIALOGUE_ID = 'd3000000-0000-4000-8000-000000000002';
const VOICE_ID = 'd3000000-0000-4000-8000-000000000003';

function imageAsset(id: string, name: string, width = 120, height = 100): ImageAsset {
  return {
    id,
    kind: 'image',
    name,
    relativePath: `assets/${name}.png`,
    mimeType: 'image/png',
    width,
    height,
    usage: 'character',
    keywords: [],
  };
}

function makePart(
  partId: string,
  displayName: string,
  assetId: string,
  width: number,
  height: number,
  drawOrder: number,
  tx: number,
  ty: number,
) {
  return {
    partId,
    displayName,
    source: { kind: 'manual' as const, sourceId: assetId },
    assetId,
    imageMapping: {
      sourceWidth: width,
      sourceHeight: height,
      crop: { x: 0, y: 0, width, height },
      exportScale: 1,
    },
    drawOrder,
    restTransform: { a: 1, b: 0, c: 0, d: 1, tx, ty },
    sourceRestTransform: { a: 1, b: 0, c: 0, d: 1, tx, ty },
    visible: true,
  };
}

function buildPhaseCProject(options?: { withDialogue?: boolean; withClipV1?: boolean }): {
  project: Project;
  characterId: string;
  layerId: string;
  smileExprId: string;
  graphicExprId: string;
} {
  const base = graphicFaceProject(true);
  const charSvc = new CharacterService();
  let project = ProjectSchema.parse({
    ...base,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    assets: [
      ...base.assets,
      imageAsset(ASSET_BACK_HAIR, '后发', 180, 260),
      imageAsset(ASSET_BODY, '衣服身体', 220, 320),
      imageAsset(ASSET_HEAD, '头', 150, 150),
      imageAsset(ASSET_FACE, '原脸', 90, 60),
      imageAsset(ASSET_FRONT_HAIR, '前发', 160, 140),
      imageAsset(ASSET_SMILE, '笑脸PNG', 120, 90),
      imageAsset(ASSET_MOUTH, '张嘴PNG', 120, 90),
      {
        id: ASSET_AUDIO,
        kind: 'audio',
        name: '对白',
        relativePath: 'assets/talk.wav',
        mimeType: 'audio/wav',
        durationMs: 1200,
      },
    ],
  });

  project = charSvc.createAdaptiveParts(project, {
    name: '小师妹完整版',
    parts: [
      makePart(PART_BACK_HAIR, '后发', ASSET_BACK_HAIR, 180, 260, 0, -90, -200),
      makePart(PART_BODY, '衣服', ASSET_BODY, 220, 320, 1, -110, -40),
      makePart(PART_HEAD, '头', ASSET_HEAD, 150, 150, 2, -75, -180),
      makePart(PART_FACE, '原脸', ASSET_FACE, 90, 60, 3, -45, -120),
      makePart(PART_FRONT_HAIR, '前发', ASSET_FRONT_HAIR, 160, 140, 4, -80, -190),
    ],
  });
  const charId = project.characters.at(-1)!.id;
  project = charSvc.setAdaptivePartsFaceBinding(project, charId, { targetPartId: PART_FACE });
  project = charSvc.addExpression(project, charId, { name: '笑脸PNG', assetId: ASSET_SMILE });
  project = charSvc.addExpression(project, charId, { name: '生气元件', visualSource: faceSource(1) });
  const boundChar = project.characters.find((c) => c.id === charId) as AdaptivePartsCharacter;
  const smileExprId = boundChar.expressions![0]!.id;
  const graphicExprId = boundChar.expressions![1]!.id;
  project = charSvc.setDefaultExpression(project, charId, smileExprId);
  project = charSvc.setMouthOpenAsset(project, charId, ASSET_MOUTH);
  project = charSvc.setAdaptivePartsHeadMotionBinding(project, charId, [
    PART_BACK_HAIR,
    PART_HEAD,
    PART_FACE,
    PART_FRONT_HAIR,
  ]);

  const layerRes = new LayerService().createFromAdaptiveCharacter(project, IDS.shot, charId, { x: 960, y: 540 });
  project = layerRes.project;

  const baseVoice = project.voiceProfiles[0]!;
  if (options?.withDialogue !== false) {
    project = ProjectSchema.parse({
      ...project,
      voiceProfiles: [
        ...project.voiceProfiles,
        { ...baseVoice, id: VOICE_ID, characterId: charId, name: '小师妹音色' },
      ],
      shots: project.shots.map((shot) => ({
        ...shot,
        durationMs: 2400,
        audioClips: [
          {
            id: AUDIO_CLIP_ID,
            name: '对白',
            assetId: ASSET_AUDIO,
            role: 'dialogue' as const,
            startMs: 100,
            endMs: 1300,
            offsetMs: 0,
            volume: 1,
          },
        ],
        dialogues: [
          {
            id: DIALOGUE_ID,
            characterId: charId,
            voiceProfileId: VOICE_ID,
            subtitleStyleId: IDS.subtitle,
            audioClipId: AUDIO_CLIP_ID,
            text: '小师妹来了',
            startMs: 100,
            endMs: 1300,
          },
        ],
      })),
    });
  }

  if (options?.withClipV1) {
    const motionSvc = new CharacterMotionService();
    project = motionSvc.apply(
      project,
      {
        shotId: IDS.shot,
        layerId: layerRes.layer.id,
        partId: PART_FACE,
        timeMs: 0,
        autoKey: true,
      },
      {
        'transform.offsetX': 12,
        'transform.offsetY': -6,
      },
    );
  }

  return { project, characterId: charId, layerId: layerRes.layer.id, smileExprId, graphicExprId };
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  if (root) {
    act(() => root!.unmount());
    root = null;
  }
  container?.remove();
  container = null;
  characterAssemblySessionStore.getActiveAdaptivePartsAssemblySessionHandle()?.cancel();
  editorProjectStore.clear();
  vi.restoreAllMocks();
});

describe('Phase C: AdaptiveParts Talking Head Motion + Combined A/B/C Parity (#1211)', () => {
  it('moves only head-bound parts (including replaced face expressions/mouth) while preserving drawOrder (backHair behind body), neutral outside dialogue, and Stage/Export parity', () => {
    const setup = buildPhaseCProject({ withDialogue: true });
    let project = setup.project;
    project = upsertExpressionEventAtTime(project, IDS.shot, setup.layerId, setup.graphicExprId, 200);
    project = upsertMouthCueEventAtTime(project, IDS.shot, setup.layerId, 'rest', 200);

    const assetUrls = Object.fromEntries(
      project.assets.filter((a) => a.kind === 'image').map((a) => [a.id, `file:///assets/${a.id}.png`]),
    );
    const partMatrixMap = (evaluatedTimeMs: number, proj = project) => {
      const s = proj.shots[0]!;
      const evalShot = projectShotDialogueVisual(proj, s, evaluateShotAtTime(s, evaluatedTimeMs, proj));
      const exportEvalShot = evaluateExportShotAtTime(proj, s, evaluatedTimeMs);
      const layer = evalShot.layers.find((l) => l.id === setup.layerId)!;
      const visual = resolveLayerVisualParts(proj, s, layer, evaluatedTimeMs);
      expect(visual.headGroup).toBeNull();
      const stageModel = buildStageRenderModel(proj, evalShot, assetUrls);
      const exportStageModel = buildStageRenderModel(proj, exportEvalShot, assetUrls);
      const stageParts = stageModel.layers.find((l) => l.id === setup.layerId)!.parts;
      const exportParts = exportStageModel.layers.find((l) => l.id === setup.layerId)!.parts;
      expect(stageParts).toEqual(exportParts);
      return { visual, stageParts };
    };

    // Baseline before dialogue (t = 50ms) -> zero head motion
    const neutral = partMatrixMap(50);
    // Mid-dialogue non-zero phase (t = 225ms, elapsed = 125ms) -> expected negative bob
    const talking = partMatrixMap(225);
    const expectedBob = resolveTalkingHeadMotionTransform(125, 1200, 100);
    expect(expectedBob.translateX).not.toBe(0);

    const partById = (parts: typeof neutral.visual.parts, pid: string) =>
      parts.find((p) => p.partId === `${setup.layerId}:${pid}`)!;

    const project0 = new CharacterService().setTalkingHeadMotionIntensityPercent(project, setup.characterId, 0);
    const talking0 = partMatrixMap(225, project0);

    // Unbound body MUST remain stationary; backHair/head/replaced-face/frontHair move by expectedBob!
    expect(partById(talking.visual.parts, PART_BODY).imageTransform).toEqual(
      partById(neutral.visual.parts, PART_BODY).imageTransform,
    );
    for (const boundId of [PART_BACK_HAIR, PART_HEAD, PART_FACE, PART_FRONT_HAIR]) {
      const nTx = partById(talking0.visual.parts, boundId).imageTransform!.tx;
      const tTx = partById(talking.visual.parts, boundId).imageTransform!.tx;
      const nTy = partById(talking0.visual.parts, boundId).imageTransform!.ty;
      const tTy = partById(talking.visual.parts, boundId).imageTransform!.ty;
      expect(tTx - nTx).toBeCloseTo(expectedBob.translateX, 6);
      expect(tTy - nTy).toBeCloseTo(expectedBob.translateY, 6);
    }

    // Painter drawOrder invariant: backHair (0) stays behind body (1) which stays behind head (2) & face (3) & frontHair (4)
    expect(talking.stageParts.map((p) => p.id)).toEqual([
      `${setup.layerId}:${PART_BACK_HAIR}`,
      `${setup.layerId}:${PART_BODY}`,
      `${setup.layerId}:${PART_HEAD}`,
      `${setup.layerId}:${PART_FACE}`,
      `${setup.layerId}:${PART_FRONT_HAIR}`,
    ]);
    // At 225ms, replaced face renders Graphic expression frameOrdinal 1 AND translates with the head!
    expect(partById(talking.visual.parts, PART_FACE).flaGraphic?.frameOrdinal).toBe(1);

    // Intensity 200% doubles bob delta; intensity 0% matches stationary neutral pose
    const charSvc = new CharacterService();
    const project200 = charSvc.setTalkingHeadMotionIntensityPercent(project, setup.characterId, 200);
    const talking200 = partMatrixMap(225, project200);
    expect(
      partById(talking200.visual.parts, PART_HEAD).imageTransform!.tx -
        partById(neutral.visual.parts, PART_HEAD).imageTransform!.tx,
    ).toBeCloseTo(expectedBob.translateX * 2, 6);

    expect(partById(talking0.visual.parts, PART_HEAD).imageTransform).toEqual(
      partById(neutral.visual.parts, PART_HEAD).imageTransform,
    );

    // After dialogue ends (t = 1350ms), parts return cleanly to neutral
    const afterDialogue = partMatrixMap(1350);
    expect(partById(afterDialogue.visual.parts, PART_HEAD).imageTransform).toEqual(
      partById(neutral.visual.parts, PART_HEAD).imageTransform,
    );
    expect(partById(afterDialogue.visual.parts, PART_FACE).flaGraphic?.frameOrdinal).toBe(1);
  });

  it('preserves Clip v1 part animation keyframes while overlaying head motion delta cleanly, and keeps duplicate occurrences neutral', () => {
    const setup = buildPhaseCProject({ withDialogue: true, withClipV1: true });
    const shot = setup.project.shots[0]!;
    const evalNeutral = projectShotDialogueVisual(
      setup.project,
      shot,
      evaluateShotAtTime(shot, 50, setup.project),
    );
    const evalTalk = projectShotDialogueVisual(
      setup.project,
      shot,
      evaluateShotAtTime(shot, 225, setup.project),
    );
    const visNeutral = resolveLayerVisualParts(
      setup.project,
      shot,
      evalNeutral.layers.find((l) => l.id === setup.layerId)!,
      50,
    );
    const visTalk = resolveLayerVisualParts(
      setup.project,
      shot,
      evalTalk.layers.find((l) => l.id === setup.layerId)!,
      225,
    );
    const faceNeutral = visNeutral.parts.find((p) => p.partId === `${setup.layerId}:${PART_FACE}`)!;
    const faceTalk = visTalk.parts.find((p) => p.partId === `${setup.layerId}:${PART_FACE}`)!;
    const expectedBob = resolveTalkingHeadMotionTransform(125, 1200, 100);
    expect(faceTalk.imageTransform!.tx - faceNeutral.imageTransform!.tx).toBeCloseTo(expectedBob.translateX, 6);
    expect(faceTalk.imageTransform!.ty - faceNeutral.imageTransform!.ty).toBeCloseTo(expectedBob.translateY, 6);

    // Duplicate visible occurrences of same speaker character -> stays neutral
    const dup = new LayerService().createFromAdaptiveCharacter(
      setup.project,
      IDS.shot,
      setup.characterId,
      { x: 400, y: 540 },
    ).project;
    const dupShot = dup.shots[0]!;
    const dupEval = projectShotDialogueVisual(dup, dupShot, evaluateShotAtTime(dupShot, 225, dup));
    expect(dupEval.layers.every((l) => l.headGroupTransform === undefined)).toBe(true);
  });

  it('supports UI head part binding (设为头部/移出头部 + 头 tag), intensity slider (0-200%), preview button without dirtying, and Undo/Redo', () => {
    const setup = buildPhaseCProject({ withDialogue: false });
    // Clear existing head binding to test binding cleanly through UI
    const charSvc = new CharacterService();
    const unboundProject = charSvc.setAdaptivePartsHeadMotionBinding(setup.project, setup.characterId, null);
    if (typeof globalThis.IntersectionObserver !== 'function') {
      globalThis.IntersectionObserver = class {
        observe() {}
        disconnect() {}
        unobserve() {}
      } as unknown as typeof IntersectionObserver;
    }
    if (typeof globalThis.ResizeObserver !== 'function') {
      globalThis.ResizeObserver = class {
        observe() {}
        disconnect() {}
        unobserve() {}
      } as unknown as typeof ResizeObserver;
    }
    const stubDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    Object.assign(window, {
      pandaStage: {
        assets: {
          readThumbnail: async () => ({ ok: true, value: { kind: 'thumbnail', status: 'ready', dataUrl: stubDataUrl } }),
          readAssetUrl: async () => ({ ok: true, value: stubDataUrl }),
        },
      },
    });
    editorProjectStore.open('C:/temp/phase-c.pandastage', unboundProject);
    const began = characterAssemblySessionStore.beginAdaptiveParts(setup.characterId);
    expect(began.ok).toBe(true);
    characterAssemblySessionStore.setAssemblyContinuityOwner(setup.characterId);

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    function Harness() {
      const snap = useSyncExternalStore(
        editorProjectStore.subscribe,
        editorProjectStore.getSnapshot,
        editorProjectStore.getSnapshot,
      );
      const raw = useSyncExternalStore(
        characterAssemblySessionStore.subscribe,
        characterAssemblySessionStore.getSnapshot,
        characterAssemblySessionStore.getSnapshot,
      );
      if (!snap || !raw || !isAdaptivePartsAssemblySnapshot(raw)) return null;
      return createElement(CharacterAssemblyWorkbench, {
        projectSnapshot: snap,
        session: raw,
      });
    }

    act(() => root!.render(createElement(Harness)));

    // Bind PART_BACK_HAIR and PART_FACE via Parts overflow menu -> check role tags ("头" and "表情 · 头")
    const selectRowAndToggleHead = (partId: string) => {
      const selectBtn = container!.querySelector(
        `[data-part-id="${partId}"] [data-testid="adaptive-parts-assembly-row-select"]`,
      ) as HTMLButtonElement;
      act(() => selectBtn.click());
      const toggleBtn = container!.querySelector(
        '[data-testid="adaptive-parts-toggle-head-button"]',
      ) as HTMLButtonElement;
      act(() => toggleBtn.click());
    };
    selectRowAndToggleHead(PART_BACK_HAIR);
    selectRowAndToggleHead(PART_FACE);

    const liveChar = editorProjectStore.getSnapshot()!.project.characters.find(
      (c) => c.id === setup.characterId,
    ) as AdaptivePartsCharacter;
    expect(liveChar.headMotionBinding?.partIds).toEqual([PART_BACK_HAIR, PART_FACE]);
    expect(
      container.querySelector(`[data-part-id="${PART_FACE}"] .adaptive-parts-role-tag`)?.textContent,
    ).toBe('表情 · 头');

    // Open Character properties inspector -> adjust intensity to 160% -> click live preview without modifying project revision
    const charManageBtn = container.querySelector('[data-testid="adaptive-character-management"]') as HTMLButtonElement;
    act(() => charManageBtn.click());
    const slider = container.querySelector('[data-testid="adaptive-talking-head-intensity"]') as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(slider, '160');
      slider.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(
      (
        editorProjectStore.getSnapshot()!.project.characters.find(
          (c) => c.id === setup.characterId,
        ) as AdaptivePartsCharacter
      ).talkingHeadMotionIntensityPercent,
    ).toBe(160);

    const revBeforePreview = editorProjectStore.getSnapshot()!.revision;
    const previewBtn = container.querySelector('[data-testid="adaptive-talking-head-preview-button"]') as HTMLButtonElement;
    act(() => previewBtn.click());
    expect(previewBtn.getAttribute('aria-pressed')).toBe('true');
    expect(editorProjectStore.getSnapshot()!.revision).toBe(revBeforePreview);
    act(() => previewBtn.click());

    // Undo restores intensity to undefined / default
    act(() => editorProjectStore.undo());
    expect(
      (
        editorProjectStore.getSnapshot()!.project.characters.find(
          (c) => c.id === setup.characterId,
        ) as AdaptivePartsCharacter
      ).talkingHeadMotionIntensityPercent,
    ).toBeUndefined();
  });
});
