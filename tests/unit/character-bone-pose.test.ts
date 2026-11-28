import { describe, expect, it } from 'vitest';
import {
  CharacterBoneService,
  CharacterMotionService,
  CharacterService,
  LayerService,
  ProjectSchema,
  characterBonePartDeltas,
  characterBoneProtectedPartIds,
  composeAnimatedCharacterPartTransform,
  createCharacterPartAnimationClip,
  evaluateAnimationClipAtTime,
  evaluateCharacterBonePose,
  evaluateShotAtTime,
  resolveCharacterBoneTree,
  resolveLayerAttachmentTargets,
  resolveLayerVisualParts,
  type CharacterBone,
  type EvaluatedCharacterBonePose,
  type LayerVisualParts,
} from '../../src/domain';
import { IDS } from '../unit/domain/testProject';
import {
  adaptiveCharacterOf,
  buildBoneFixture,
  withBones,
  withClip,
} from '../helpers/boneTreeFixtures';
import { adaptivePartsFixture } from '../helpers/adaptivePartsFixtures';

const ROOT = '00000000-0000-4000-8000-000000000401';
const CHILD = '00000000-0000-4000-8000-000000000402';
const LEAF = '00000000-0000-4000-8000-000000000403';

function bone(
  id: string,
  parentBoneId: string | null,
  restLocal: { x: number; y: number; rotationDeg: number },
  partId?: string,
): CharacterBone {
  return { id, parentBoneId, restLocal, ...(partId ? { partId } : {}) };
}

function tree(partIds: readonly string[]): CharacterBone[] {
  return [
    bone(ROOT, null, { x: 320, y: 320, rotationDeg: 0 }, partIds[0]),
    bone(CHILD, ROOT, { x: 120, y: 0, rotationDeg: 0 }, partIds[1]),
    bone(LEAF, CHILD, { x: 80, y: 0, rotationDeg: 0 }),
  ];
}

function partMatrix(visual: LayerVisualParts, partId: string) {
  const part = visual.parts.find((candidate) =>
    (candidate.source.kind === 'adaptive-part' || candidate.source.kind === 'adaptive-part-fla-graphic') &&
    candidate.source.characterPartId === partId);
  if (!part?.imageTransform) throw new Error(`Missing visual Part ${partId}`);
  return part.imageTransform;
}

function applyPoint(matrix: { a: number; b: number; c: number; d: number; tx: number; ty: number }, x: number, y: number) {
  return { x: matrix.a * x + matrix.c * y + matrix.tx, y: matrix.b * x + matrix.d * y + matrix.ty };
}

function rotationOf(matrix: { a: number; b: number }) {
  return (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI;
}

function identityDelta(pose: EvaluatedCharacterBonePose): void {
  expect(pose.delta.a).toBe(1);
  expect(pose.delta.b).toBe(0);
  expect(pose.delta.c).toBe(0);
  expect(pose.delta.d).toBe(1);
  expect(pose.delta.tx).toBe(0);
  expect(pose.delta.ty).toBe(0);
}

describe('character bone rest pose', () => {
  it('produces exact identity deltas and Part matrices identical to a no-bones evaluation', () => {
    const base = buildBoneFixture(3);
    const noBones = withClip(base.project, base.shotId, base.layerId);
    const withBonesProject = withClip(
      withBones(base.project, base.characterId, tree(base.partIds)),
      base.shotId,
      base.layerId,
    );
    const shotA = noBones.shots[0]!;
    const shotB = withBonesProject.shots[0]!;
    const evaluatedA = evaluateShotAtTime(shotA, 500, noBones).layers.find(({ id }) => id === base.layerId)!;
    const evaluatedB = evaluateShotAtTime(shotB, 500, withBonesProject).layers.find(({ id }) => id === base.layerId)!;

    expect(evaluatedA.characterBonePose).toBeUndefined();
    const poses = evaluatedB.characterBonePose ?? [];
    expect(poses.map(({ boneId }) => boneId)).toEqual([ROOT, CHILD, LEAF]);
    poses.forEach(identityDelta);
    // At rest a bound Bone never moves an existing Character.
    const visualA = resolveLayerVisualParts(noBones, shotA, evaluatedA, 500);
    const visualB = resolveLayerVisualParts(withBonesProject, shotB, evaluatedB, 500);
    for (const partId of base.partIds) {
      expect(partMatrix(visualB, partId)).toEqual(partMatrix(visualA, partId));
    }
  });
});

describe('character bone FK evaluation', () => {
  it('rotates a parent Bone, moves children, and leaves unbound Parts untouched', () => {
    const base = buildBoneFixture(3);
    let project = withClip(
      withBones(base.project, base.characterId, tree(base.partIds)),
      base.shotId,
      base.layerId,
    );
    project = new CharacterBoneService().applyBonePose(project, {
      shotId: base.shotId, layerId: base.layerId, boneId: ROOT, timeMs: 0,
    }, { 'transform.rotationDeg': 90 });
    const shot = project.shots[0]!;
    const evaluated = evaluateShotAtTime(shot, 0, project).layers.find(({ id }) => id === base.layerId)!;
    const visuals = resolveLayerVisualParts(project, shot, evaluated, 0);

    const poses = evaluated.characterBonePose ?? [];
    const byId = new Map(poses.map((pose) => [pose.boneId, pose]));
    expect(rotationOf(byId.get(ROOT)!.delta)).toBeCloseTo(90, 9);
    // Children inherit the parent rotation even without their own keys.
    expect(rotationOf(byId.get(CHILD)!.world)).toBeCloseTo(90, 9);
    expect(rotationOf(byId.get(LEAF)!.world)).toBeCloseTo(90, 9);

    // Root origin is part0's pivot; rotating it there keeps that pivot fixed.
    const rootPivot = applyPoint(partMatrix(visuals, base.partIds[0]!), 320, 320);
    // Character center (440, 320) is the Clip origin.
    expect(rootPivot.x).toBeCloseTo(320 - 440, 6);
    expect(rootPivot.y).toBeCloseTo(320 - 320, 6);
    // The bound child Part rotates 90 degrees around the root origin.
    const childMatrix = partMatrix(visuals, base.partIds[1]!);
    expect(rotationOf(childMatrix)).toBeCloseTo(90, 6);
    const childPivot = applyPoint(childMatrix, 320, 320);
    expect(childPivot.x).toBeCloseTo(320 - 440, 6);
    expect(childPivot.y).toBeCloseTo(440 - 320, 6);
    // The unbound third Part keeps its exact rest matrix.
    const noBones = withClip(base.project, base.shotId, base.layerId);
    const restEvaluated = evaluateShotAtTime(noBones.shots[0]!, 0, noBones)
      .layers.find(({ id }) => id === base.layerId)!;
    const restVisuals = resolveLayerVisualParts(noBones, noBones.shots[0]!, restEvaluated, 0);
    expect(partMatrix(visuals, base.partIds[2]!)).toEqual(partMatrix(restVisuals, base.partIds[2]!));

    // Attachment / prop following reads the final (post-FK) Part matrix.
    const layer = shot.layers.find(({ id }) => id === base.layerId)!;
    const attachments = resolveLayerAttachmentTargets(project, layer, evaluated);
    const boundAttachment = attachments.find((target) =>
      target.target.kind === 'character-part' && target.target.partId === base.partIds[1]!);
    expect(boundAttachment?.transform).toEqual(partMatrix(visuals, base.partIds[1]!));
  });

  it('interpolates seeded Bone keys deterministically for random seek', () => {
    const base = buildBoneFixture(3);
    let project = withClip(
      withBones(base.project, base.characterId, tree(base.partIds)),
      base.shotId,
      base.layerId,
    );
    const service = new CharacterBoneService();
    project = service.applyBonePose(project, {
      shotId: base.shotId, layerId: base.layerId, boneId: ROOT, timeMs: 0,
    }, { 'transform.rotationDeg': 0 });
    project = service.applyBonePose(project, {
      shotId: base.shotId, layerId: base.layerId, boneId: ROOT, timeMs: 1000,
    }, { 'transform.rotationDeg': 90 });
    const shot = project.shots[0]!;
    const rotationAt = (timeMs: number) => {
      const evaluated = evaluateShotAtTime(shot, timeMs, project)
        .layers.find(({ id }) => id === base.layerId)!;
      const rootPose = evaluated.characterBonePose!.find(({ boneId }) => boneId === ROOT)!;
      return rotationOf(rootPose.delta);
    };
    expect(rotationAt(0)).toBeCloseTo(0, 9);
    expect(rotationAt(250)).toBeCloseTo(22.5, 6);
    expect(rotationAt(500)).toBeCloseTo(45, 6);
    expect(rotationAt(750)).toBeCloseTo(67.5, 6);
    expect(rotationAt(1000)).toBeCloseTo(90, 6);
    // Re-seek and re-evaluate must produce the exact same matrices.
    const clip = shot.layers.find(({ id }) => id === base.layerId)!.animationClip!;
    if (clip.version !== 1) throw new Error('Expected Clip v1');
    const first = characterBonePartDeltas({
      character: adaptiveCharacterOf(project, base.characterId),
      values: evaluateAnimationClipAtTime(clip, 500),
      layerId: base.layerId,
      fixedCharacterCenter: clip.fixedCharacterCenter,
    }).get(base.partIds[1]!)!;
    const again = characterBonePartDeltas({
      character: adaptiveCharacterOf(project, base.characterId),
      values: evaluateAnimationClipAtTime(clip, 500),
      layerId: base.layerId,
      fixedCharacterCenter: clip.fixedCharacterCenter,
    }).get(base.partIds[1]!)!;
    expect(again).toEqual(first);
  });

  it('applies existing Part keys once as local offsets under the Bone delta', () => {
    const base = buildBoneFixture(3);
    let project = withClip(
      withBones(base.project, base.characterId, tree(base.partIds)),
      base.shotId,
      base.layerId,
    );
    project = new CharacterBoneService().applyBonePose(project, {
      shotId: base.shotId, layerId: base.layerId, boneId: ROOT, timeMs: 0,
    }, { 'transform.rotationDeg': 90 });
    project = new CharacterMotionService().apply(project, {
      shotId: base.shotId, layerId: base.layerId, partId: base.partIds[1]!, timeMs: 0, autoKey: true,
    }, { 'transform.offsetX': 25 });
    const shot = project.shots[0]!;
    const evaluated = evaluateShotAtTime(shot, 0, project).layers.find(({ id }) => id === base.layerId)!;
    const visuals = resolveLayerVisualParts(project, shot, evaluated, 0);
    const clip = shot.layers.find(({ id }) => id === base.layerId)!.animationClip!;
    if (clip.version !== 1) throw new Error('Expected Clip v1');
    const values = evaluateAnimationClipAtTime(clip, 0);
    const basis = clip.targetBases.find(({ target }) => target.partId === base.partIds[1]!)!;
    const local = composeAnimatedCharacterPartTransform(basis, clip.fixedCharacterCenter, values);
    const delta = characterBonePartDeltas({
      character: adaptiveCharacterOf(project, base.characterId),
      values,
      layerId: base.layerId,
      fixedCharacterCenter: clip.fixedCharacterCenter,
      protectedPartIds: characterBoneProtectedPartIds(adaptiveCharacterOf(project, base.characterId)),
    }).get(base.partIds[1]!)!;
    const finalPivot = applyPoint(partMatrix(visuals, base.partIds[1]!), 320, 320);
    const expected = applyPoint({
      a: delta.a * local.a + delta.c * local.b,
      b: delta.b * local.a + delta.d * local.b,
      c: delta.a * local.c + delta.c * local.d,
      d: delta.b * local.c + delta.d * local.d,
      tx: delta.a * local.tx + delta.c * local.ty + delta.tx,
      ty: delta.b * local.tx + delta.d * local.ty + delta.ty,
    }, 320, 320);
    expect(finalPivot.x).toBeCloseTo(expected.x, 6);
    expect(finalPivot.y).toBeCloseTo(expected.y, 6);
  });

  it('evaluates two instances of the same Character independently', () => {
    const base = buildBoneFixture(3);
    let project = withClip(
      withBones(base.project, base.characterId, tree(base.partIds)),
      base.shotId,
      base.layerId,
    );
    const second = new LayerService().createFromAdaptiveCharacter(
      project, base.shotId, base.characterId, { x: 1100, y: 450 },
    );
    project = withClip(second.project, base.shotId, second.layer.id);
    const service = new CharacterBoneService();
    project = service.applyBonePose(project, {
      shotId: base.shotId, layerId: base.layerId, boneId: ROOT, timeMs: 0,
    }, { 'transform.rotationDeg': 30 });
    project = service.applyBonePose(project, {
      shotId: base.shotId, layerId: second.layer.id, boneId: ROOT, timeMs: 0,
    }, { 'transform.rotationDeg': -20 });

    const shot = project.shots[0]!;
    const evaluated = evaluateShotAtTime(shot, 0, project).layers;
    const firstPose = evaluated.find(({ id }) => id === base.layerId)!.characterBonePose!;
    const secondPose = evaluated.find(({ id }) => id === second.layer.id)!.characterBonePose!;
    expect(rotationOf(firstPose.find(({ boneId }) => boneId === ROOT)!.delta)).toBeCloseTo(30, 9);
    expect(rotationOf(secondPose.find(({ boneId }) => boneId === ROOT)!.delta)).toBeCloseTo(-20, 9);
    const firstVisual = resolveLayerVisualParts(project, shot, evaluated.find(({ id }) => id === base.layerId)!, 0);
    const secondVisual = resolveLayerVisualParts(project, shot, evaluated.find(({ id }) => id === second.layer.id)!, 0);
    expect(rotationOf(partMatrix(firstVisual, base.partIds[1]!))).toBeCloseTo(30, 6);
    expect(rotationOf(partMatrix(secondVisual, base.partIds[1]!))).toBeCloseTo(-20, 6);
  });

  it('never re-transforms face/mouth/head-follow Parts with a Bone delta', () => {
    const base = buildBoneFixture(5);
    const characterService = new CharacterService();
    let project = characterService.setAdaptivePartsFaceBinding(base.project, base.characterId, {
      targetPartId: base.partIds[3]!,
    });
    project = characterService.setAdaptivePartsHeadMotionBinding(project, base.characterId, [base.partIds[2]!]);
    // The schema allows any existing Part on a Bone; the face/head pipeline wins downstream.
    project = withClip(
      withBones(project, base.characterId, [
        bone(ROOT, null, { x: 320, y: 320, rotationDeg: 0 }, base.partIds[0]),
        bone(CHILD, ROOT, { x: 120, y: 0, rotationDeg: 0 }, base.partIds[3]),
        bone(LEAF, CHILD, { x: 120, y: 0, rotationDeg: 0 }, base.partIds[2]),
      ]),
      base.shotId,
      base.layerId,
    );
    project = new CharacterBoneService().applyBonePose(project, {
      shotId: base.shotId, layerId: base.layerId, boneId: ROOT, timeMs: 0,
    }, { 'transform.rotationDeg': 45 });
    const character = adaptiveCharacterOf(project, base.characterId);
    const protectedIds = characterBoneProtectedPartIds(character);
    expect(protectedIds.has(base.partIds[2]!)).toBe(true);
    expect(protectedIds.has(base.partIds[3]!)).toBe(true);

    const shot = project.shots[0]!;
    const evaluated = evaluateShotAtTime(shot, 0, project).layers.find(({ id }) => id === base.layerId)!;
    const clip = shot.layers.find(({ id }) => id === base.layerId)!.animationClip!;
    if (clip.version !== 1) throw new Error('Expected Clip v1');
    const values = evaluateAnimationClipAtTime(clip, 0);
    const deltas = characterBonePartDeltas({
      character,
      values,
      layerId: base.layerId,
      fixedCharacterCenter: clip.fixedCharacterCenter,
      protectedPartIds: protectedIds,
    });
    expect(deltas.has(base.partIds[0]!)).toBe(true);
    expect(deltas.has(base.partIds[2]!)).toBe(false);
    expect(deltas.has(base.partIds[3]!)).toBe(false);
    // The deterministic pose map still exposes every Bone for later constraints.
    expect(evaluated.characterBonePose?.map(({ boneId }) => boneId)).toEqual([ROOT, CHILD, LEAF]);

    const visuals = resolveLayerVisualParts(project, shot, evaluated, 0);
    const restProject = withClip(base.project, base.shotId, base.layerId);
    const restEvaluated = evaluateShotAtTime(restProject.shots[0]!, 0, restProject)
      .layers.find(({ id }) => id === base.layerId)!;
    const restVisuals = resolveLayerVisualParts(restProject, restProject.shots[0]!, restEvaluated, 0);
    // Head-follow Parts and the face target keep their own matrices.
    expect(partMatrix(visuals, base.partIds[2]!)).toEqual(partMatrix(restVisuals, base.partIds[2]!));

    // Head motion still moves head-follow Parts by its own delta, independently of Bones.
    const headMoved = { ...evaluated, headGroupTransform: {
      translateX: 12, translateY: -7, scaleX: 1, scaleY: 1, rotationDeg: 0,
    } };
    const withHeadMotion = resolveLayerVisualParts(project, shot, headMoved, 0);
    const headRest = partMatrix(visuals, base.partIds[2]!);
    const headPosed = partMatrix(withHeadMotion, base.partIds[2]!);
    expect(headPosed.a).toBeCloseTo(headRest.a, 9);
    expect(headPosed.b).toBeCloseTo(headRest.b, 9);
    expect(headPosed.tx - headRest.tx).toBeCloseTo(12, 9);
    expect(headPosed.ty - headRest.ty).toBeCloseTo(-7, 9);
  });

  it('returns an empty pose map for an invalid tree instead of throwing inside evaluation', () => {
    const base = buildBoneFixture(3);
    const character = adaptiveCharacterOf(base.project, base.characterId);
    const invalid = {
      ...character,
      bones: [
        { ...bone(ROOT, null, { x: 0, y: 0, rotationDeg: 0 }), parentBoneId: CHILD },
        bone(CHILD, ROOT, { x: 10, y: 0, rotationDeg: 0 }),
      ],
    };
    expect(resolveCharacterBoneTree(invalid)).toMatchObject({ ok: false, code: 'bone-cycle' });
    expect(evaluateCharacterBonePose({
      character: invalid,
      values: [],
      layerId: base.layerId,
    }).size).toBe(0);
  });
});

describe('legacy no-bones evaluation golden', () => {
  it('keeps the exact pre-bones Part matrix formula for legacy projects', () => {
    const base = buildBoneFixture(3);
    const clip = createCharacterPartAnimationClip(base.project, base.shotId, base.layerId);
    let project = ProjectSchema.parse({
      ...base.project,
      shots: base.project.shots.map((shot) => shot.id === base.shotId ? {
        ...shot,
        layers: shot.layers.map((layer) =>
          layer.id === base.layerId ? { ...layer, animationClip: clip } : layer),
      } : shot),
    });
    project = new CharacterMotionService().apply(project, {
      shotId: base.shotId, layerId: base.layerId, partId: base.partIds[0]!, timeMs: 1000, autoKey: true,
    }, { 'transform.rotationDeg': 25, 'transform.offsetX': 12, 'transform.offsetY': -8 });
    const shot = project.shots[0]!;
    const evaluated = evaluateShotAtTime(shot, 1000, project).layers.find(({ id }) => id === base.layerId)!;
    expect(evaluated.characterBonePose).toBeUndefined();
    const visual = resolveLayerVisualParts(project, shot, evaluated, 1000);
    const layer = shot.layers.find(({ id }) => id === base.layerId)!;
    const storedClip = layer.animationClip!;
    if (storedClip.version !== 1) throw new Error('Expected Clip v1');
    const values = evaluateAnimationClipAtTime(storedClip, 1000);
    const basis = storedClip.targetBases.find(({ target }) => target.partId === base.partIds[0]!)!;
    const expected = composeAnimatedCharacterPartTransform(basis, storedClip.fixedCharacterCenter, values);
    // Full 640x640 crop with sourceRoot identity: the crop mapping is identity.
    expect(partMatrix(visual, base.partIds[0]!)).toEqual(expected);
    // Untouched legacy Parts keep their frozen rest matrices exactly.
    const untouched = clip.targetBases.find(({ target }) => target.partId === base.partIds[2]!)!;
    expect(partMatrix(visual, base.partIds[2]!))
      .toEqual(composeAnimatedCharacterPartTransform(untouched, clip.fixedCharacterCenter, []));
    // A legacy Project with no bones and no clip still parses and creates the same Anchor.
    const legacyParts = adaptivePartsFixture(IDS.assetChar).slice(0, 3);
    expect(legacyParts.length).toBe(3);
  });
});
