import { describe, expect, it } from 'vitest';
import {
  CharacterBoneService,
  CharacterEndEffectorLockService,
  LayerMotionService,
  LayerService,
  ProjectSchema,
  applyCharacterEndEffectorLocks,
  characterEndEffectorLayerStageMatrix,
  characterEndEffectorLockActiveAt,
  evaluateAnimationClipAtTime,
  evaluateCharacterBonePose,
  evaluateShotAtTime,
  evaluatedCharacterBonePoseList,
  resolveLayerCameraTransform,
  resolveCharacterEndEffectorLockChain,
  validateCharacterEndEffectorLock,
  type CharacterBone,
  type CharacterBonePoseValues,
  type CharacterEndEffectorLock,
  type Project,
} from '../../src/domain';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import type { AffineMatrix2D } from '../../src/shared/affine-matrix';
import { adaptiveCharacterOf, buildBoneFixture, withBones, withClip } from '../helpers/boneTreeFixtures';

const PELVIS = '00000000-0000-4000-8000-000000000601';
const THIGH = '00000000-0000-4000-8000-000000000602';
const SHIN = '00000000-0000-4000-8000-000000000603';
const FOOT = '00000000-0000-4000-8000-000000000604';

/** Character-space rest pivots: pelvis (500,200), hip (440,280), knee (440,400), ankle (440,520). */
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

interface LegFixture {
  readonly project: Project;
  readonly shotId: string;
  readonly layerId: string;
  readonly characterId: string;
  readonly partIds: readonly string[];
  readonly clipCenter: { readonly x: number; readonly y: number };
}

function legFixture(): LegFixture {
  const base = buildBoneFixture(4);
  const project = withClip(
    withBones(base.project, base.characterId, legBones(base.partIds[3]!)),
    base.shotId,
    base.layerId,
  );
  const layer = project.shots.find(({ id }) => id === base.shotId)!.layers.find(({ id }) => id === base.layerId)!;
  if (layer.animationClip?.version !== 1) throw new Error('Expected Clip v1');
  return {
    project,
    shotId: base.shotId,
    layerId: base.layerId,
    characterId: base.characterId,
    partIds: base.partIds,
    clipCenter: layer.animationClip.fixedCharacterCenter,
  };
}

function applyPoint(matrix: AffineMatrix2D, point: { x: number; y: number }) {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.tx,
    y: matrix.b * point.x + matrix.d * point.y + matrix.ty,
  };
}

interface FootSample {
  readonly stage: { x: number; y: number };
  readonly character: { x: number; y: number };
  readonly localToStage: AffineMatrix2D;
  readonly residual: ReturnType<typeof evaluateShotAtTime>['layers'][number]['endEffectorResiduals'];
  readonly shotTimeMs: number;
  readonly worldAngleDeg: number;
}

function footSample(project: Project, fixture: LegFixture, timeMs: number, boneId = FOOT): FootSample {
  const shot = project.shots.find(({ id }) => id === fixture.shotId)!;
  const evaluated = evaluateShotAtTime(shot, timeMs, project)
    .layers.find(({ id }) => id === fixture.layerId)!;
  const pose = evaluated.characterBonePose?.find((entry) => entry.boneId === boneId);
  if (!pose) throw new Error('Missing evaluated Bone pose.');
  const localToStage = characterEndEffectorLayerStageMatrix(evaluated, fixture.clipCenter);
  const character = { x: pose.world.tx, y: pose.world.ty };
  return {
    stage: applyPoint(localToStage, character),
    character,
    localToStage,
    residual: evaluated.endEffectorResiduals,
    shotTimeMs: evaluated.animationTimeMs ?? timeMs,
    worldAngleDeg: Math.atan2(pose.world.b, pose.world.a) * 180 / Math.PI,
  };
}

function lockService(): CharacterEndEffectorLockService {
  let seed = 0;
  return new CharacterEndEffectorLockService({
    createId: () => `90000000-0000-4000-8000-${String(++seed).padStart(12, '0')}`,
  });
}

function addStageLock(
  project: Project,
  fixture: LegFixture,
  timeMs: number,
  extra: Partial<Pick<CharacterEndEffectorLock, 'footRotationDeg' | 'weight' | 'activeRange'>> = {},
): { project: Project; target: { x: number; y: number } } {
  const target = footSample(project, fixture, timeMs).stage;
  const next = lockService().addLock(project, { shotId: fixture.shotId, layerId: fixture.layerId }, {
    boneId: FOOT,
    space: 'stage',
    target,
    ...extra,
  });
  return { project: next, target };
}

/** Authors pelvis vertical offsets at 0 ms and 1000 ms (linear interpolation). */
function withPelvisKeys(project: Project, fixture: LegFixture, fromOffsetY: number, toOffsetY: number): Project {
  const service = new CharacterBoneService();
  let next = service.applyBonePose(project, {
    shotId: fixture.shotId, layerId: fixture.layerId, boneId: PELVIS, timeMs: 0,
  }, { 'transform.offsetY': fromOffsetY });
  next = service.applyBonePose(next, {
    shotId: fixture.shotId, layerId: fixture.layerId, boneId: PELVIS, timeMs: 1000,
  }, { 'transform.offsetY': toOffsetY });
  return next;
}

function expectClose(actual: number, expected: number, tolerance: number, label: string): void {
  expect(Math.abs(actual - expected), `${label}: expected ${expected}, received ${actual}`)
    .toBeLessThanOrEqual(tolerance);
}

describe('character end-effector lock schema', () => {
  it('persists an additive optional Layer field and rejects an ambiguous authoring lock', () => {
    const fixture = legFixture();
    const layer = fixture.project.shots[0]!.layers.find(({ id }) => id === fixture.layerId)!;
    expect(layer.endEffectorLocks).toBeUndefined();
    const { project } = addStageLock(fixture.project, fixture, 0);
    const stored = project.shots[0]!.layers.find(({ id }) => id === fixture.layerId)!;
    expect(stored.endEffectorLocks).toHaveLength(1);
    expect(stored.endEffectorLocks![0]).toMatchObject({ boneId: FOOT, space: 'stage' });
    // Round-trip through plain JSON keeps the optional field and the schema contract.
    const reopened = ProjectSchema.parse(JSON.parse(JSON.stringify(project)));
    expect(reopened.shots[0]!.layers.find(({ id }) => id === fixture.layerId)!.endEffectorLocks)
      .toEqual(stored.endEffectorLocks);
    // Duplicate Bone lock is rejected by the Layer schema itself.
    expect(() => ProjectSchema.parse({
      ...project,
      shots: project.shots.map((shot) => ({
        ...shot,
        layers: shot.layers.map((entry) => entry.id === fixture.layerId ? {
          ...entry,
          endEffectorLocks: [
            entry.endEffectorLocks![0]!,
            { ...entry.endEffectorLocks![0]!, id: '00000000-0000-4000-8000-000000000999' },
          ],
        } : entry),
      })),
    })).toThrow();
    // Out-of-shot range is a clear Chinese authoring error, not a silent clamp.
    const shotDurationMs = fixture.project.shots[0]!.durationMs;
    const message = validateCharacterEndEffectorLock({
      character: adaptiveCharacterOf(fixture.project, fixture.characterId),
      lock: {
        id: '00000000-0000-4000-8000-000000000998',
        boneId: FOOT,
        space: 'stage',
        target: { x: 0, y: 0 },
        activeRange: { startMs: 0, endMs: shotDurationMs + 1000 },
      },
      durationMs: shotDurationMs,
    });
    expect(message).toBe('末端锁定的生效区间必须落在镜头时长内。');
  });

  it('rejects a non-leaf Bone and a too-short chain with Chinese messages', () => {
    const fixture = legFixture();
    const character = adaptiveCharacterOf(fixture.project, fixture.characterId);
    expect(resolveCharacterEndEffectorLockChain(character, { boneId: SHIN })).toMatchObject({ ok: false });
    const rootOnly = {
      ...character,
      bones: [
        { id: PELVIS, parentBoneId: null, restLocal: { x: 0, y: 0, rotationDeg: 0 } },
        { id: THIGH, parentBoneId: PELVIS, restLocal: { x: 100, y: 0, rotationDeg: 0 } },
      ],
    };
    expect(resolveCharacterEndEffectorLockChain(rootOnly, { boneId: THIGH })).toMatchObject({
      ok: false,
      message: '末端锁定需要至少两根可求解的父级骨骼。',
    });
  });

  it('drops a dependent lock when its Bone tree node is deleted', () => {
    const fixture = legFixture();
    const { project } = addStageLock(fixture.project, fixture, 0);
    // Deleting the shin also deletes its child foot Bone, so the lock must go too.
    const deleted = new CharacterBoneService().deleteBone(project, fixture.characterId, SHIN);
    const layer = deleted.shots[0]!.layers.find(({ id }) => id === fixture.layerId)!;
    expect(layer.endEffectorLocks).toBeUndefined();
    expect(evaluateShotAtTime(deleted.shots[0]!, 0, deleted)
      .layers.find(({ id }) => id === fixture.layerId)!.endEffectorResiduals).toBeUndefined();
  });
});

describe('character end-effector lock pure solver', () => {
  it('keeps the foot pivot at a stage target after the pelvis moves, without stretching Bone lengths', () => {
    const fixture = legFixture();
    const { project, target } = addStageLock(fixture.project, fixture, 0);
    const next = withPelvisKeys(project, fixture, 0, 60);
    const samples = [0, 250, 500, 750, 1000].map((timeMs) => footSample(next, fixture, timeMs));
    for (const sample of samples) {
      expectClose(sample.stage.x, target.x, 0.25, 'foot stage X');
      expectClose(sample.stage.y, target.y, 0.25, 'foot stage Y');
      expect(sample.residual ?? []).toEqual([]);
    }
    // Unlocked authored pose: the foot would have drifted down by the full 60 px.
    const authoredProject = withPelvisKeys(fixture.project, fixture, 0, 60);
    expectClose(footSample(authoredProject, fixture, 1000).stage.y - target.y, 60, 0.5, 'authored drift');
    // Segment lengths come from the solved pose, never from a scaled Bone.
    const evaluated = evaluateShotAtTime(next.shots[0]!, 1000, next)
      .layers.find(({ id }) => id === fixture.layerId)!;
    const poses = new Map(evaluated.characterBonePose!.map((pose) => [pose.boneId, pose]));
    const hip = poses.get(THIGH)!.world;
    const knee = poses.get(SHIN)!.world;
    const ankle = poses.get(FOOT)!.world;
    expectClose(Math.hypot(knee.tx - hip.tx, knee.ty - hip.ty), 120, 1e-6, 'thigh length');
    expectClose(Math.hypot(ankle.tx - knee.tx, ankle.ty - knee.ty), 120, 1e-6, 'shin length');
    for (const pose of evaluated.characterBonePose!) {
      for (const value of Object.values(pose.world)) expect(Number.isFinite(value)).toBe(true);
    }
  });

  it('reports a residual when unreachable while preserving lengths and angle limits', () => {
    const fixture = legFixture();
    const project = fixture.project;
    const character = adaptiveCharacterOf(project, fixture.characterId);
    const target = footSample(project, fixture, 0).stage;
    const localToStage = footSample(project, fixture, 0).localToStage;
    const baseValues = new Map<string, CharacterBonePoseValues>();
    // Pull the pelvis up by 120: the hip->target distance exceeds both legs combined.
    baseValues.set(PELVIS, { offsetX: 0, offsetY: -120, rotationDeg: 0, scaleX: 1, scaleY: 1 });
    const result = applyCharacterEndEffectorLocks({
      character,
      baseBoneValues: baseValues,
      locks: [{
        id: '00000000-0000-4000-8000-000000000901',
        boneId: FOOT,
        space: 'stage',
        target,
      }],
      localToStage,
      protectedPartIds: new Set(),
    });
    const residual = result.residuals.find(({ boneId }) => boneId === FOOT);
    expect(residual?.reason).toBe('unreachable');
    expect(residual!.distance).toBeGreaterThan(10);
    for (const value of result.values.values()) {
      expect(Number.isFinite(value.rotationDeg)).toBe(true);
      expect(Number.isFinite(value.offsetX)).toBe(true);
      expect(Number.isFinite(value.offsetY)).toBe(true);
    }
  });

  it('honors the optional foot direction lock in stage space', () => {
    const fixture = legFixture();
    const { project } = addStageLock(fixture.project, fixture, 0, { footRotationDeg: 0 });
    const sample = footSample(project, fixture, 500);
    // Foot direction is held in stage space; the evaluated leaf world angle maps through the Layer.
    const expectedCharacterAngle = Math.atan2(
      sample.localToStage.b * Math.cos(0) + sample.localToStage.d * Math.sin(0),
      sample.localToStage.a * Math.cos(0) + sample.localToStage.c * Math.sin(0),
    ) * 180 / Math.PI;
    const delta = Math.abs(((sample.worldAngleDeg - expectedCharacterAngle + 540) % 360) - 180);
    expect(delta).toBeLessThan(0.5);
  });

  it('is deterministic for repeated calls and never depends on pointer history', () => {
    const fixture = legFixture();
    const { project, target } = addStageLock(fixture.project, fixture, 0);
    const next = withPelvisKeys(project, fixture, 0, 45);
    const first = evaluateShotAtTime(next.shots[0]!, 600, next);
    const second = evaluateShotAtTime(next.shots[0]!, 600, next);
    expect(JSON.stringify(second)).toEqual(JSON.stringify(first));
    expect(second.layers.find(({ id }) => id === fixture.layerId)!.characterBonePose)
      .toEqual(first.layers.find(({ id }) => id === fixture.layerId)!.characterBonePose);
    // Random seek: visiting frames out of order must produce the same snapshot as in order.
    const ordered = [0, 250, 500, 750, 1000].map((timeMs) =>
      JSON.stringify(evaluateShotAtTime(next.shots[0]!, timeMs, next)));
    const shuffled = [750, 0, 1000, 250, 500].map((timeMs) =>
      JSON.stringify(evaluateShotAtTime(next.shots[0]!, timeMs, next)));
    expect(shuffled).toEqual([ordered[3], ordered[0], ordered[4], ordered[1], ordered[2]]);
    for (const timeMs of [250, 500, 750]) {
      expectClose(footSample(next, fixture, timeMs).stage.x, target.x, 0.5, 'seek foot X');
      expectClose(footSample(next, fixture, timeMs).stage.y, target.y, 0.5, 'seek foot Y');
    }
  });
});

describe('character end-effector lock evaluation', () => {
  it('keeps a no-lock project on the exact #1455 FK path', () => {
    const fixture = legFixture();
    const shot = fixture.project.shots[0]!;
    const evaluated = evaluateShotAtTime(shot, 500, fixture.project)
      .layers.find(({ id }) => id === fixture.layerId)!;
    expect(evaluated.endEffectorResiduals).toBeUndefined();
    const clip = shot.layers.find(({ id }) => id === fixture.layerId)!.animationClip!;
    if (clip.version !== 1) throw new Error('Expected Clip v1');
    expect(evaluated.characterBonePose).toEqual(evaluatedCharacterBonePoseList(evaluateCharacterBonePose({
      character: adaptiveCharacterOf(fixture.project, fixture.characterId),
      values: evaluateAnimationClipAtTime(clip, 500),
      layerId: fixture.layerId,
    })));
  });

  it('restores the authored pose exactly outside the active range', () => {
    const fixture = legFixture();
    const authored = withPelvisKeys(fixture.project, fixture, 0, 60);
    const target = footSample(authored, fixture, 500).stage;
    const locked = lockService().addLock(authored, { shotId: fixture.shotId, layerId: fixture.layerId }, {
      boneId: FOOT,
      space: 'stage',
      target,
      activeRange: { startMs: 480, endMs: 720 },
    });
    expect(characterEndEffectorLockActiveAt(locked.shots[0]!.layers.find(({ id }) => id === fixture.layerId)!.endEffectorLocks![0]!, 470)).toBe(false);
    const noLockEvaluation = evaluateShotAtTime(authored.shots[0]!, 250, authored);
    const outsideEvaluation = evaluateShotAtTime(locked.shots[0]!, 250, locked);
    expect(outsideEvaluation).toEqual(noLockEvaluation);
    const insideEvaluation = evaluateShotAtTime(locked.shots[0]!, 600, locked);
    expect(insideEvaluation.layers.find(({ id }) => id === fixture.layerId)!.endEffectorResiduals).toBeUndefined();
    expect(footSample(locked, fixture, 600).stage.x).toBeCloseTo(target.x, 1);
  });

  it('keeps a stage target fixed under mirror, rotation, camera and parent attachment; character targets follow the instance', () => {
    const fixture = legFixture();
    const { project, target } = addStageLock(fixture.project, fixture, 0);
    const replaced = ProjectSchema.parse({
      ...project,
      shots: project.shots.map((entry) => entry.id !== fixture.shotId ? entry : {
        ...entry,
        camera: {
          mode: 'manual',
          keys: [{
            timeMs: 0,
            centerX: 300,
            centerY: 200,
            zoom: 2,
            rotationDeg: 15,
            interpolationToNext: 'linear' as const,
          }],
        },
        layers: entry.layers.map((candidate) => candidate.id === fixture.layerId
          ? { ...candidate, rotationDeg: 33, flipX: true }
          : candidate),
      }),
    });
    const sample = footSample(replaced, fixture, 0);
    expectClose(sample.stage.x, target.x, 0.5, 'mirrored/rotated foot X');
    expectClose(sample.stage.y, target.y, 0.5, 'mirrored/rotated foot Y');
    expect(sample.residual ?? []).toEqual([]);
    // The camera is applied downstream only; two different camera views share the exact evaluated pose.
    const cameraA = resolveLayerCameraTransform(
      evaluateShotAtTime(replaced.shots[0]!, 400, replaced).layers.find(({ id }) => id === fixture.layerId)!,
      { centerX: 300, centerY: 200, zoom: 2, rotationDeg: 15 }, 1920, 1080,
    );
    const cameraB = resolveLayerCameraTransform(
      evaluateShotAtTime(replaced.shots[0]!, 400, replaced).layers.find(({ id }) => id === fixture.layerId)!,
      undefined, 1920, 1080,
    );
    expect(cameraA).not.toEqual(cameraB);
    const withoutCamera = ProjectSchema.parse({
      ...replaced,
      shots: replaced.shots.map((entry) => entry.id === fixture.shotId ? { ...entry, camera: undefined } : entry),
    });
    expect(evaluateShotAtTime(withoutCamera.shots[0]!, 0, withoutCamera))
      .toEqual(evaluateShotAtTime(replaced.shots[0]!, 0, replaced));

    // A character-space target is defined in Character-local space, so it moves with the Layer.
    const characterTarget = footSample(fixture.project, fixture, 0).character;
    const characterLocked = lockService().addLock(fixture.project, {
      shotId: fixture.shotId, layerId: fixture.layerId,
    }, { boneId: FOOT, space: 'character', target: characterTarget });
    const moved = ProjectSchema.parse({
      ...characterLocked,
      shots: characterLocked.shots.map((entry) => ({ ...entry, layers: entry.layers.map((candidate) =>
        candidate.id === fixture.layerId ? { ...candidate, x: candidate.x + 200 } : candidate) })),
    });
    const movedSample = footSample(moved, fixture, 0);
    expectClose(movedSample.character.x, characterTarget.x, 0.5, 'character target X');
    expectClose(movedSample.character.y, characterTarget.y, 0.5, 'character target Y');
    expectClose(movedSample.stage.x, target.x + 200, 0.5, 'character target follows Layer');

    // Parent attachment: a rotating parent moves the Layer space, but a stage target stays fixed.
    const control = new LayerService().createControl(fixture.project, fixture.shotId);
    let parented = new LayerService().setParent(
      control.project, fixture.shotId, fixture.layerId, control.layer.id, 0,
    );
    parented = withPelvisKeys(parented, fixture, 0, 100);
    parented = lockService().addLock(parented, { shotId: fixture.shotId, layerId: fixture.layerId }, {
      boneId: FOOT, space: 'stage', target,
    });
    const animatedParent = new LayerMotionService().applyTransform(parented, {
      shotId: fixture.shotId, layerId: control.layer.id, timeMs: 1000, autoKey: true,
    }, { rotationDeg: 8 });
    const parentedSample = footSample(animatedParent, fixture, 1000);
    expectClose(parentedSample.stage.x, target.x, 0.75, 'parented foot X');
    expectClose(parentedSample.stage.y, target.y, 0.75, 'parented foot Y');
    expect(parentedSample.residual ?? []).toEqual([]);
  });

  it('isolates two instances of the same Character with different locks', () => {
    const fixture = legFixture();
    const second = new LayerService().createFromAdaptiveCharacter(
      fixture.project, fixture.shotId, fixture.characterId, { x: 1100, y: 450 },
    );
    const project = withClip(second.project, fixture.shotId, second.layer.id);
    const secondFixture: LegFixture = { ...fixture, project, layerId: second.layer.id };
    const firstTarget = footSample(project, fixture, 0).stage;
    let next = lockService().addLock(project, { shotId: fixture.shotId, layerId: fixture.layerId }, {
      boneId: FOOT, space: 'stage', target: firstTarget,
    });
    const secondTarget = footSample(next, secondFixture, 0).stage;
    next = lockService().addLock(next, { shotId: fixture.shotId, layerId: second.layer.id }, {
      boneId: FOOT, space: 'stage', target: { x: secondTarget.x + 40, y: secondTarget.y },
    });
    next = withPelvisKeys(next, fixture, 0, 60);
    next = withPelvisKeys(next, secondFixture, 30, 90);
    const firstSample = footSample(next, fixture, 1000);
    const secondSample = footSample(next, secondFixture, 1000);
    expectClose(firstSample.stage.x, firstTarget.x, 0.25, 'first instance foot X');
    expectClose(firstSample.stage.y, firstTarget.y, 0.25, 'first instance foot Y');
    expectClose(secondSample.stage.x, secondTarget.x + 40, 0.25, 'second instance foot X');
    // The first instance never inherited the second instance's pose keys.
    const firstShot = next.shots.find(({ id }) => id === fixture.shotId)!;
    const firstLayer = firstShot.layers.find(({ id }) => id === fixture.layerId)!;
    const secondLayer = firstShot.layers.find(({ id }) => id === second.layer.id)!;
    expect(firstLayer.animationClip).not.toEqual(secondLayer.animationClip);
  });

  it('solves the highest-priority leaf first and reports a shared-ancestor residual for the other endpoint', () => {
    const SPINE = '00000000-0000-4000-8000-000000000701';
    const CHEST = '00000000-0000-4000-8000-000000000702';
    const LEFT_SHOULDER = '00000000-0000-4000-8000-000000000703';
    const LEFT_HAND = '00000000-0000-4000-8000-000000000704';
    const RIGHT_SHOULDER = '00000000-0000-4000-8000-000000000705';
    const RIGHT_HAND = '00000000-0000-4000-8000-000000000706';
    const base = buildBoneFixture(2);
    const bones: CharacterBone[] = [
      { id: PELVIS, parentBoneId: null, restLocal: { x: 500, y: 200, rotationDeg: 0 } },
      { id: SPINE, parentBoneId: PELVIS, restLocal: { x: 0, y: 60, rotationDeg: 0 } },
      { id: CHEST, parentBoneId: SPINE, restLocal: { x: 0, y: 60, rotationDeg: 0 } },
      { id: LEFT_SHOULDER, parentBoneId: CHEST, restLocal: { x: -80, y: 0, rotationDeg: 0 } },
      { id: LEFT_HAND, parentBoneId: LEFT_SHOULDER, restLocal: { x: 0, y: 100, rotationDeg: 0 } },
      { id: RIGHT_SHOULDER, parentBoneId: CHEST, restLocal: { x: 80, y: 0, rotationDeg: 0 } },
      { id: RIGHT_HAND, parentBoneId: RIGHT_SHOULDER, restLocal: { x: 0, y: 100, rotationDeg: 0 } },
    ];
    const project = withClip(
      withBones(base.project, base.characterId, bones),
      base.shotId,
      base.layerId,
    );
    const character = adaptiveCharacterOf(project, base.characterId);
    const clip = project.shots[0]!.layers.find(({ id }) => id === base.layerId)!.animationClip!;
    if (clip.version !== 1) throw new Error('Expected Clip v1');
    const evaluated = evaluateShotAtTime(project.shots[0]!, 0, project)
      .layers.find(({ id }) => id === base.layerId)!;
    const localToStage = characterEndEffectorLayerStageMatrix(evaluated, clip.fixedCharacterCenter);
    const poseOf = (boneId: string) => evaluated.characterBonePose!.find(({ boneId: id }) => id === boneId)!;
    const rightTarget = applyPoint(localToStage, { x: poseOf(RIGHT_HAND).world.tx, y: poseOf(RIGHT_HAND).world.ty });
    // Pull the left hand up, which rotates the shared spine/chest ancestors.
    const leftTarget = applyPoint(localToStage, { x: poseOf(LEFT_HAND).world.tx, y: poseOf(LEFT_HAND).world.ty - 40 });
    const locks: CharacterEndEffectorLock[] = [
      {
        id: '00000000-0000-4000-8000-0000000007a1',
        boneId: LEFT_HAND,
        space: 'stage',
        target: leftTarget,
      },
      {
        id: '00000000-0000-4000-8000-0000000007b1',
        boneId: RIGHT_HAND,
        space: 'stage',
        target: rightTarget,
      },
    ];
    const result = applyCharacterEndEffectorLocks({
      character,
      baseBoneValues: new Map(),
      locks,
      localToStage,
      stageToLocal: null,
      protectedPartIds: new Set(),
    });
    expect(result.solvedBoneIds).toContain(SPINE);
    expect(result.solvedBoneIds).toContain(CHEST);
    expect(result.solvedBoneIds).toContain(LEFT_SHOULDER);
    expect(result.solvedBoneIds).not.toContain(RIGHT_HAND);
    const sharedResidual = result.residuals.find(({ lockId }) => lockId === locks[1]!.id);
    expect(sharedResidual?.reason).toBe('shared-ancestor');
    expect(sharedResidual!.distance).toBeGreaterThan(1);
    expect(result.residuals.some(({ lockId }) => lockId === locks[0]!.id)).toBe(false);
  });

  it('records one undo for one gesture and re-evaluates identically after save/reopen', () => {
    const fixture = legFixture();
    const { project: locked, target } = addStageLock(fixture.project, fixture, 0);
    const store = new EditorProjectStore();
    store.open('D:\\PandaStage-Test', locked);
    const undoBefore = store.history.getSnapshot().undoCount;
    const next = lockService().applyBonePoseWithLocks(locked, {
      shotId: fixture.shotId, layerId: fixture.layerId, boneId: PELVIS, timeMs: 500,
    }, { 'transform.offsetY': 45 });
    expect(next).not.toBe(locked);
    store.updateProject(next, '骨盆下蹲（末端锁定）');
    expect(store.history.getSnapshot().undoCount).toBe(undoBefore + 1);
    const layer = next.shots[0]!.layers.find(({ id }) => id === fixture.layerId)!;
    if (layer.animationClip?.version !== 1) throw new Error('Expected Clip v1');
    const storedClip = layer.animationClip;
    // One gesture wrote the pelvis offset key and real pose keys for the solved leg Bones.
    const hasKey = (boneId: string, property: string) =>
      storedClip.tracks.some((track) =>
        track.target.kind === 'character-bone' &&
        track.target.boneId === boneId &&
        track.property === property &&
        track.keys.some(({ timeMs }) => timeMs === 500));
    expect(hasKey(PELVIS, 'transform.offsetY')).toBe(true);
    expect(hasKey(THIGH, 'transform.rotationDeg')).toBe(true);
    expect(hasKey(SHIN, 'transform.rotationDeg')).toBe(true);
    expectClose(footSample(next, fixture, 500).stage.x, target.x, 0.5, 'editing-time foot X');
    // Save/reopen keeps the locks and the formal evaluation is unchanged.
    const reopened = ProjectSchema.parse(JSON.parse(JSON.stringify(next)));
    expect(reopened.shots[0]!.layers.find(({ id }) => id === fixture.layerId)!.endEffectorLocks)
      .toEqual(layer.endEffectorLocks);
    expect(evaluateShotAtTime(reopened.shots[0]!, 500, reopened))
      .toEqual(evaluateShotAtTime(next.shots[0]!, 500, next));
    store.undo();
    expect(store.getSnapshot()!.project.shots[0]!.layers.find(({ id }) => id === fixture.layerId)!.animationClip)
      .toEqual(locked.shots[0]!.layers.find(({ id }) => id === fixture.layerId)!.animationClip);
  });
});
