import { describe, expect, it } from 'vitest';
import {
  CharacterBoneService,
  CharacterEndEffectorLockService,
  ProjectSchema,
  buildCoverageMaskClips,
  buildEditorStageRenderModel,
  evaluateShotAtTime,
  isDrawableStageLayer,
  type CharacterBone,
  type Project,
} from '../../src/domain';
import { buildStageRenderModel } from '../../src/shared/stage/render-model';
import { IDS } from './domain/testProject';
import { buildBoneFixture, withBones, withClip } from '../helpers/boneTreeFixtures';

/**
 * #1454 x #1456: the end-effector lock post-pass re-parents the Shot and used
 * to feed the raw (pre-mask-projection) Layers back into `applyLayerParenting`,
 * so a successfully solved frame lost `coverageMask`. The mask projection must
 * be resolved once after the final bone/parent-space evaluation.
 */

const PELVIS = '00000000-0000-4000-8000-000000000601';
const THIGH = '00000000-0000-4000-8000-000000000602';
const SHIN = '00000000-0000-4000-8000-000000000603';
const FOOT = '00000000-0000-4000-8000-000000000604';
const MASK_LAYER_ID = '60000000-0000-4000-8000-000000000010';

function legBones(footPartId: string): CharacterBone[] {
  return [
    { id: PELVIS, parentBoneId: null, restLocal: { x: 500, y: 200, rotationDeg: 0 } },
    { id: THIGH, parentBoneId: PELVIS, restLocal: { x: -60, y: 80, rotationDeg: 0 } },
    { id: SHIN, parentBoneId: THIGH, restLocal: { x: 0, y: 120, rotationDeg: 0 } },
    {
      id: FOOT,
      parentBoneId: SHIN,
      restLocal: { x: 0, y: 120, rotationDeg: 0 },
      partId: footPartId,
      length: 60,
    },
  ];
}

function maskLayer(): Record<string, unknown> {
  return {
    id: MASK_LAYER_ID,
    name: '道具遮罩',
    source: { kind: 'asset', assetId: IDS.assetChar },
    anchor: 'center',
    x: 960,
    y: 540,
    scaleX: 1,
    scaleY: 1,
    rotationDeg: 0,
    opacity: 1,
    visible: true,
    zIndex: 5,
    locked: false,
    flipX: false,
    maskTargets: [IDS.layerAsset],
  };
}

interface Fixture {
  readonly project: Project;
  readonly shotId: string;
  readonly layerId: string;
}

/** Adaptive-parts character with a Bone tree, Clip v1 and one unrelated masked prop. */
function maskedCharacterFixture(): Fixture {
  const base = buildBoneFixture(4);
  const withLegs = withClip(
    withBones(base.project, base.characterId, legBones(base.partIds[3]!)),
    base.shotId,
    base.layerId,
  );
  const project = ProjectSchema.parse({
    ...withLegs,
    shots: withLegs.shots.map((shot) =>
      shot.id === base.shotId
        ? { ...shot, layers: [...shot.layers, maskLayer()] }
        : shot),
  });
  return { project, shotId: base.shotId, layerId: base.layerId };
}

const FULL_BONE_POSE = {
  'transform.offsetX': 1,
  'transform.offsetY': 1,
  'transform.rotationDeg': 1,
  'transform.scaleX': 1.1,
  'transform.scaleY': 1.1,
} as const;

/**
 * Pins the foot to its 0 ms stage pose, then moves the pelvis so the lock has
 * to solve on later frames (a no-op lock would not trigger the second pass).
 * The two movable Bones carry full pose tracks so the evaluated Layer stays
 * renderable after the solver rewrites their animation values.
 */
function lockedFixture(pelvisDeltaY: number): Fixture {
  const fixture = maskedCharacterFixture();
  const service = new CharacterBoneService();
  let project = fixture.project;
  for (const boneId of [THIGH, SHIN]) {
    for (const timeMs of [0, 1_000]) {
      project = service.applyBonePose(project, {
        shotId: fixture.shotId,
        layerId: fixture.layerId,
        boneId,
        timeMs,
      }, FULL_BONE_POSE);
    }
  }
  let seed = 0;
  const pinned = new CharacterEndEffectorLockService({
    createId: () => `90000000-0000-4000-8000-${String(++seed).padStart(12, '0')}`,
  }).pinFromCurrentPose(project, {
    shotId: fixture.shotId,
    layerId: fixture.layerId,
    timeMs: 0,
  }, { boneId: FOOT, space: 'stage' });
  project = pinned.project;
  if (pelvisDeltaY !== 0) {
    project = service.applyBonePose(project, {
      shotId: fixture.shotId,
      layerId: fixture.layerId,
      boneId: PELVIS,
      timeMs: 0,
    }, { 'transform.offsetY': 0 });
    project = service.applyBonePose(project, {
      shotId: fixture.shotId,
      layerId: fixture.layerId,
      boneId: PELVIS,
      timeMs: 1_000,
    }, { 'transform.offsetY': pelvisDeltaY });
  }
  return { project, shotId: fixture.shotId, layerId: fixture.layerId };
}

function evaluatedAt(fixture: Fixture, timeMs: number) {
  return evaluateShotAtTime(
    fixture.project.shots.find(({ id }) => id === fixture.shotId)!,
    timeMs,
    fixture.project,
  );
}

function clipEntriesOf(project: Project, evaluated: ReturnType<typeof evaluateShotAtTime>) {
  const shot = project.shots.find(({ id }) => id === evaluated.shotId)!;
  const editorModel = buildEditorStageRenderModel(project, shot, evaluated);
  const stageModel = buildStageRenderModel(
    project,
    evaluated,
    Object.fromEntries(project.assets.map((asset) => [asset.id, `file:///${asset.relativePath}`])),
  );
  const editorClips = buildCoverageMaskClips(editorModel, undefined);
  const stageClips = buildCoverageMaskClips(
    {
      width: stageModel.width,
      height: stageModel.height,
      layers: stageModel.layers.map((layer) => ({
        evaluated: layer,
        visual: layer.visual,
        render: layer.render,
      })),
    },
    undefined,
  );
  const entries = (clips: ReturnType<typeof buildCoverageMaskClips>) =>
    [...clips.clips.entries()].map(
      ([targetId, clip]) => [targetId, clip.maskLayerId, clip.paths.map((path) => path.d)],
    );
  return {
    editor: entries(editorClips),
    stage: entries(stageClips),
    editorUnresolved: [...editorClips.unresolvedMaskLayerIds],
    stageUnresolved: [...stageClips.unresolvedMaskLayerIds],
    editorClip: editorClips.clips.get(IDS.layerAsset),
  };
}

describe('coverage mask survives the end-effector lock re-evaluation (#1464 R1)', () => {
  it('keeps the mask projection when a lock solves a moved pelvis', () => {
    const fixture = lockedFixture(60);
    const evaluated = evaluatedAt(fixture, 1_000);
    const mask = evaluated.layers.find(({ id }) => id === MASK_LAYER_ID)!;
    const target = evaluated.layers.find(({ id }) => id === IDS.layerAsset)!;
    const character = evaluated.layers.find(({ id }) => id === fixture.layerId)!;

    // The lock post-pass really ran and solved the leg on this frame.
    expect(character.endEffectorResiduals ?? []).toEqual([]);
    expect(character.characterBonePose?.length).toBeGreaterThan(0);

    expect(mask.coverageMask).toEqual({
      role: 'mask-layer',
      targetLayerIds: [IDS.layerAsset],
    });
    expect(target.coverageMask).toEqual({
      role: 'masked-target',
      maskLayerId: MASK_LAYER_ID,
    });
  });

  it('clips the target with the shared mask geometry after the lock solve', () => {
    const fixture = lockedFixture(60);
    const evaluated = evaluatedAt(fixture, 1_000);
    const { editor, stage, editorUnresolved, stageUnresolved, editorClip } =
      clipEntriesOf(fixture.project, evaluated);
    expect(isDrawableStageLayer(evaluated.layers.find(({ id }) => id === MASK_LAYER_ID)!))
      .toBe(false);
    expect(editorClip?.maskLayerId).toBe(MASK_LAYER_ID);
    expect(editorClip?.paths.length).toBeGreaterThan(0);
    expect(editorUnresolved).toEqual([]);
    expect(stageUnresolved).toEqual([]);
    expect(editor).toEqual(stage);
    expect(editor).toEqual([[IDS.layerAsset, MASK_LAYER_ID, [
      'M 640 220 L 1280 220 L 1280 860 L 640 860 Z',
    ]]]);
  });

  it('keeps the lock-frame mask deterministic across random seeks', () => {
    const fixture = lockedFixture(60);
    for (const timeMs of [0, 137, 500, 833, 1_000]) {
      const first = clipEntriesOf(fixture.project, evaluatedAt(fixture, timeMs));
      const second = clipEntriesOf(fixture.project, evaluatedAt(fixture, timeMs));
      expect(second).toEqual(first);
      expect(first.editor).toEqual([[IDS.layerAsset, MASK_LAYER_ID, [
        'M 640 220 L 1280 220 L 1280 860 L 640 860 Z',
      ]]]);
    }
  });

  it('keeps the no-lock Shot evaluation mask projection unchanged', () => {
    const fixture = maskedCharacterFixture();
    const evaluated = evaluatedAt(fixture, 0);
    expect(evaluated.layers.find(({ id }) => id === MASK_LAYER_ID)?.coverageMask).toEqual({
      role: 'mask-layer',
      targetLayerIds: [IDS.layerAsset],
    });
    expect(evaluated.layers.find(({ id }) => id === IDS.layerAsset)?.coverageMask).toEqual({
      role: 'masked-target',
      maskLayerId: MASK_LAYER_ID,
    });
    // No lock pass happened: the evaluated mask Layer stays in its authored z slot.
    expect(evaluated.layers.map(({ id }) => id).at(-1)).toBe(MASK_LAYER_ID);
  });
});
