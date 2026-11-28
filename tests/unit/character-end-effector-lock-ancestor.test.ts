import { describe, expect, it } from 'vitest';
import {
  CHARACTER_END_EFFECTOR_LOCK_TOLERANCE,
  CharacterBoneService,
  CharacterEndEffectorLockService,
  LayerService,
  ProjectSchema,
  applyCharacterEndEffectorLocks,
  characterEndEffectorLayerStageMatrix,
  evaluateCharacterBonePoseFromValues,
  evaluateShotAtTime,
  type CharacterBone,
  type CharacterBonePoseValues,
  type CharacterEndEffectorLock,
  type Project,
} from '../../src/domain';
import { buildBoneFixture, withBones, withClip } from '../helpers/boneTreeFixtures';

/**
 * #1469 F3 (R8 follow-up): a deeper lock only owns the <=3 Bones it actively
 * solves. A later, shallower lock could still rotate a common ancestor above
 * that solved segment, silently moving the already-solved endpoint while the
 * earlier endpoint's residual stayed stale. The solver must freeze the full
 * ancestor path above the topmost solved Bone and report every active lock's
 * residual from the final FK pose in the final parent space.
 */

const ROOT = '00000000-0000-4000-8000-000000000801';
const A = '00000000-0000-4000-8000-000000000802';
const B = '00000000-0000-4000-8000-000000000803';
const C = '00000000-0000-4000-8000-000000000804';
const D = '00000000-0000-4000-8000-000000000805';
const E = '00000000-0000-4000-8000-000000000806';
const F = '00000000-0000-4000-8000-000000000807';
const G = '00000000-0000-4000-8000-000000000808';

const E_LOCK_ID = '00000000-0000-4000-8000-0000000008a1';
const G_LOCK_ID = '00000000-0000-4000-8000-0000000008b1';
const IDENTITY = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 } as const;

/** Root -> A -> B -> C -> D -> E plus the shallower branch A -> F -> G. */
function branchBones(): CharacterBone[] {
  return [
    { id: ROOT, parentBoneId: null, restLocal: { x: 500, y: 200, rotationDeg: 0 } },
    { id: A, parentBoneId: ROOT, restLocal: { x: 0, y: -40, rotationDeg: 0 } },
    { id: B, parentBoneId: A, restLocal: { x: 0, y: 40, rotationDeg: 0 } },
    { id: C, parentBoneId: B, restLocal: { x: 0, y: 40, rotationDeg: 0 } },
    { id: D, parentBoneId: C, restLocal: { x: 0, y: 40, rotationDeg: 0 } },
    { id: E, parentBoneId: D, restLocal: { x: 0, y: 40, rotationDeg: 0 } },
    { id: F, parentBoneId: A, restLocal: { x: 80, y: 0, rotationDeg: 0 } },
    { id: G, parentBoneId: F, restLocal: { x: 60, y: 0, rotationDeg: 0 } },
  ];
}

/** Root (500,200), A (500,160), B (500,200), C (500,240), D (500,280), E (500,320), F (580,160), G (640,160). */
function branchCharacter(): { bones: CharacterBone[] } {
  return { bones: branchBones() };
}

function lock(id: string, boneId: string, target: { x: number; y: number }): CharacterEndEffectorLock {
  return { id, boneId, space: 'character', target };
}

function solve(
  locks: readonly CharacterEndEffectorLock[],
  baseBoneValues: ReadonlyMap<string, CharacterBonePoseValues> = new Map(),
) {
  const character = branchCharacter();
  const result = applyCharacterEndEffectorLocks({
    character,
    baseBoneValues,
    locks,
    localToStage: IDENTITY,
    protectedPartIds: new Set(),
  });
  const poses = evaluateCharacterBonePoseFromValues(character, result.values);
  const pointOf = (boneId: string) => {
    const pose = poses.get(boneId);
    if (!pose) throw new Error(`Missing pose for ${boneId}`);
    return { x: pose.world.tx, y: pose.world.ty };
  };
  const measure = (lockId: string, boneId: string, target: { x: number; y: number }) => {
    const point = pointOf(boneId);
    const distance = Math.hypot(target.x - point.x, target.y - point.y);
    return {
      point,
      distance,
      residual: result.residuals.find(({ lockId: id }) => id === lockId),
    };
  };
  return { result, poses, pointOf, measure };
}

describe('lock ancestors are protected from later locks (#1469 F3)', () => {
  it('keeps a solved deep endpoint on target when a later shallow lock needs a frozen ancestor', () => {
    // E is solved first and occupies B/C/D; the ancestor above B is A.
    const eTarget = { x: 500, y: 290 };
    const gTarget = { x: 600, y: 200 };
    const { result, measure } = solve([lock(E_LOCK_ID, E, eTarget), lock(G_LOCK_ID, G, gTarget)]);

    const e = measure(E_LOCK_ID, E, eTarget);
    const g = measure(G_LOCK_ID, G, gTarget);

    // E must never be silently displaced: its real final end position is its target.
    expect(e.distance).toBeLessThanOrEqual(CHARACTER_END_EFFECTOR_LOCK_TOLERANCE);
    expect(e.residual).toBeUndefined();
    // G may not rotate A; it degrades along the existing priority with a truthful residual.
    expect(g.residual?.reason).toBe('shared-ancestor');
    expect(g.residual!.distance).toBeCloseTo(g.distance, 6);
    // The frozen ancestor was never solved; only the deeper segment was.
    expect(result.solvedBoneIds).toEqual([B, C, D]);
  });

  it('reports residuals of every active lock from the final pose, never a stale in-loop value', () => {
    // E is unreachable even before G; a later G must not change E's final error
    // without E's residual moving with it.
    const eTarget = { x: 500, y: 500 };
    const gTarget = { x: 600, y: 200 };
    const { result, measure } = solve([lock(E_LOCK_ID, E, eTarget), lock(G_LOCK_ID, G, gTarget)]);

    const e = measure(E_LOCK_ID, E, eTarget);
    const g = measure(G_LOCK_ID, G, gTarget);

    expect(e.distance).toBeGreaterThan(CHARACTER_END_EFFECTOR_LOCK_TOLERANCE);
    expect(e.residual?.reason).toBe('unreachable');
    expect(e.residual!.distance).toBeCloseTo(e.distance, 6);
    expect(g.residual?.reason).toBe('shared-ancestor');
    expect(g.residual!.distance).toBeCloseTo(g.distance, 6);
    for (const residual of result.residuals) {
      const expected = residual.boneId === E
        ? Math.hypot(eTarget.x - e.point.x, eTarget.y - e.point.y)
        : Math.hypot(gTarget.x - g.point.x, gTarget.y - g.point.y);
      expect(residual.distance, `residual for ${residual.boneId} must match final FK`)
        .toBeCloseTo(expected, 6);
    }
    expect(result.residuals.map(({ lockId }) => lockId).sort())
      .toEqual([E_LOCK_ID, G_LOCK_ID].sort());
  });

  it('still solves two independent leg locks simultaneously without locking the whole body', () => {
    const PELVIS = '00000000-0000-4000-8000-000000000601';
    const THIGH_L = '00000000-0000-4000-8000-000000000602';
    const SHIN_L = '00000000-0000-4000-8000-000000000603';
    const FOOT_L = '00000000-0000-4000-8000-000000000604';
    const THIGH_R = '00000000-0000-4000-8000-000000000605';
    const SHIN_R = '00000000-0000-4000-8000-000000000606';
    const FOOT_R = '00000000-0000-4000-8000-000000000607';
    const bones: CharacterBone[] = [
      { id: PELVIS, parentBoneId: null, restLocal: { x: 500, y: 200, rotationDeg: 0 } },
      { id: THIGH_L, parentBoneId: PELVIS, restLocal: { x: -60, y: 80, rotationDeg: 0 } },
      { id: SHIN_L, parentBoneId: THIGH_L, restLocal: { x: 0, y: 120, rotationDeg: 0 } },
      { id: FOOT_L, parentBoneId: SHIN_L, restLocal: { x: 0, y: 120, rotationDeg: 0 } },
      { id: THIGH_R, parentBoneId: PELVIS, restLocal: { x: 60, y: 80, rotationDeg: 0 } },
      { id: SHIN_R, parentBoneId: THIGH_R, restLocal: { x: 0, y: 120, rotationDeg: 0 } },
      { id: FOOT_R, parentBoneId: SHIN_R, restLocal: { x: 0, y: 120, rotationDeg: 0 } },
    ];
    // Left hip (440,280) and right hip (560,280); both feet start 240 px below.
    const leftTarget = { x: 435, y: 505 };
    const rightTarget = { x: 565, y: 505 };
    const character = { bones };
    const result = applyCharacterEndEffectorLocks({
      character,
      baseBoneValues: new Map(),
      locks: [
        lock('00000000-0000-4000-8000-0000000006a1', FOOT_L, leftTarget),
        lock('00000000-0000-4000-8000-0000000006b1', FOOT_R, rightTarget),
      ],
      localToStage: IDENTITY,
      protectedPartIds: new Set(),
    });
    const poses = evaluateCharacterBonePoseFromValues(character, result.values);
    const pointOf = (boneId: string) => {
      const pose = poses.get(boneId)!;
      return { x: pose.world.tx, y: pose.world.ty };
    };
    const left = pointOf(FOOT_L);
    const right = pointOf(FOOT_R);
    expect(Math.hypot(left.x - leftTarget.x, left.y - leftTarget.y))
      .toBeLessThanOrEqual(CHARACTER_END_EFFECTOR_LOCK_TOLERANCE);
    expect(Math.hypot(right.x - rightTarget.x, right.y - rightTarget.y))
      .toBeLessThanOrEqual(CHARACTER_END_EFFECTOR_LOCK_TOLERANCE);
    expect(result.residuals).toEqual([]);
    expect(result.solvedBoneIds).toEqual(expect.arrayContaining([THIGH_L, SHIN_L, THIGH_R, SHIN_R]));
    expect(result.solvedBoneIds).not.toContain(PELVIS);
  });
});

interface BranchFixture {
  readonly project: Project;
  readonly shotId: string;
  readonly layerId: string;
  readonly characterId: string;
}

/** Same branch tree persisted through the formal Project path, with E/G bound to Parts. */
function branchFixture(): BranchFixture {
  const base = buildBoneFixture(4);
  const bones = branchBones().map((bone) =>
    bone.id === E
      ? { ...bone, partId: base.partIds[0]!, length: 40 }
      : bone.id === G
        ? { ...bone, partId: base.partIds[1]!, length: 60 }
        : bone);
  const project = withClip(
    withBones(base.project, base.characterId, bones),
    base.shotId,
    base.layerId,
  );
  return { project, shotId: base.shotId, layerId: base.layerId, characterId: base.characterId };
}

function lockService(): CharacterEndEffectorLockService {
  let seed = 0;
  return new CharacterEndEffectorLockService({
    createId: () => `90000000-0000-4000-8000-${String(++seed).padStart(12, '0')}`,
  });
}

function characterPointAt(project: Project, fixture: BranchFixture, timeMs: number, boneId: string) {
  const shot = project.shots.find(({ id }) => id === fixture.shotId)!;
  const evaluated = evaluateShotAtTime(shot, timeMs, project)
    .layers.find(({ id }) => id === fixture.layerId)!;
  const pose = evaluated.characterBonePose?.find((entry) => entry.boneId === boneId);
  if (!pose) throw new Error(`Missing evaluated Bone pose ${boneId}`);
  return {
    evaluated,
    residuals: evaluated.endEffectorResiduals,
    character: { x: pose.world.tx, y: pose.world.ty },
  };
}

describe('evaluated final end position with frozen ancestors (#1469 F3)', () => {
  it('keeps the deep endpoint on target through the formal evaluator and reports the shallow residual', () => {
    const fixture = branchFixture();
    const eTarget = characterPointAt(fixture.project, fixture, 0, E).character;
    const gTarget = { x: 600, y: 160 };
    const lockSvc = lockService();
    let project = lockSvc.addLock(fixture.project, {
      shotId: fixture.shotId, layerId: fixture.layerId,
    }, { boneId: E, space: 'character', target: eTarget });
    project = lockSvc.addLock(project, {
      shotId: fixture.shotId, layerId: fixture.layerId,
    }, { boneId: G, space: 'character', target: gTarget });
    // Move the root down so the locks actually have to solve on this frame.
    const boneService = new CharacterBoneService();
    project = boneService.applyBonePose(project, {
      shotId: fixture.shotId, layerId: fixture.layerId, boneId: ROOT, timeMs: 0,
    }, { 'transform.offsetY': 0 });
    project = boneService.applyBonePose(project, {
      shotId: fixture.shotId, layerId: fixture.layerId, boneId: ROOT, timeMs: 1_000,
    }, { 'transform.offsetY': 30 });

    const e = characterPointAt(project, fixture, 1_000, E);
    const g = characterPointAt(project, fixture, 1_000, G);
    const eDistance = Math.hypot(e.character.x - eTarget.x, e.character.y - eTarget.y);
    const gDistance = Math.hypot(g.character.x - gTarget.x, g.character.y - gTarget.y);

    expect(eDistance).toBeLessThanOrEqual(CHARACTER_END_EFFECTOR_LOCK_TOLERANCE);
    expect((e.residuals ?? []).find(({ boneId }) => boneId === E)).toBeUndefined();
    const gResidual = (g.residuals ?? []).find(({ boneId }) => boneId === G);
    expect(gResidual?.reason).toBe('shared-ancestor');
    expect(gResidual!.distance).toBeCloseTo(gDistance, 6);
  });
});

/** The #1456 leg chain shared by the attachment-chain stale-residual case. */
const LEG_PELVIS = '00000000-0000-4000-8000-000000000601';
const LEG_THIGH = '00000000-0000-4000-8000-000000000602';
const LEG_SHIN = '00000000-0000-4000-8000-000000000603';
const LEG_FOOT = '00000000-0000-4000-8000-000000000604';

function legBones(footPartId: string): CharacterBone[] {
  return [
    { id: LEG_PELVIS, parentBoneId: null, restLocal: { x: 500, y: 200, rotationDeg: 0 } },
    { id: LEG_THIGH, parentBoneId: LEG_PELVIS, restLocal: { x: -60, y: 80, rotationDeg: 0 } },
    { id: LEG_SHIN, parentBoneId: LEG_THIGH, restLocal: { x: 0, y: 120, rotationDeg: 0 } },
    { id: LEG_FOOT, parentBoneId: LEG_SHIN, restLocal: { x: 0, y: 120, rotationDeg: 0 }, partId: footPartId, length: 60 },
  ];
}

function applyPoint(
  matrix: { a: number; b: number; c: number; d: number; tx: number; ty: number },
  point: { x: number; y: number },
) {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.tx,
    y: matrix.b * point.x + matrix.d * point.y + matrix.ty,
  };
}

function attachLayer(
  project: Project,
  shotId: string,
  childId: string,
  parentId: string,
  partId: string,
): Project {
  return ProjectSchema.parse({
    ...project,
    shots: project.shots.map((shot) => shot.id !== shotId ? shot : {
      ...shot,
      layers: shot.layers.map((layer) => layer.id !== childId ? layer : {
        ...layer,
        parentLayerId: parentId,
        parentAttachment: {
          target: { kind: 'character-part' as const, partId },
          ownerLocalFallback: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
        },
      }),
    }),
  });
}

/** Three chained character instances: L2 follows L1's foot Part, L3 follows L2's. */
function attachmentChainFixture() {
  const base = buildBoneFixture(4);
  const partId = base.partIds[3]!;
  let project = withClip(
    withBones(base.project, base.characterId, legBones(partId)),
    base.shotId,
    base.layerId,
  );
  const layerService = new LayerService();
  const second = layerService.createFromAdaptiveCharacter(
    project, base.shotId, base.characterId, { x: 900, y: 450 },
  );
  project = withClip(second.project, base.shotId, second.layer.id);
  const third = layerService.createFromAdaptiveCharacter(
    project, base.shotId, base.characterId, { x: 1_300, y: 450 },
  );
  project = withClip(third.project, base.shotId, third.layer.id);
  project = attachLayer(project, base.shotId, second.layer.id, base.layerId, partId);
  project = attachLayer(project, base.shotId, third.layer.id, second.layer.id, partId);
  return {
    project,
    shotId: base.shotId,
    layerIds: [base.layerId, second.layer.id, third.layer.id] as const,
  };
}

function clipCenterOf(project: Project, shotId: string, layerId: string) {
  const clip = project.shots.find(({ id }) => id === shotId)!
    .layers.find(({ id }) => id === layerId)!.animationClip;
  if (clip?.version !== 1) throw new Error('Expected Clip v1.');
  return clip.fixedCharacterCenter;
}

/** Final foot stage position measured from the formal evaluated Layer. */
function evaluatedFootStage(project: Project, shotId: string, layerId: string, timeMs: number) {
  const shot = project.shots.find(({ id }) => id === shotId)!;
  const evaluated = evaluateShotAtTime(shot, timeMs, project)
    .layers.find(({ id }) => id === layerId)!;
  const pose = evaluated.characterBonePose?.find(({ boneId }) => boneId === LEG_FOOT);
  if (!pose) throw new Error('Missing evaluated foot pose.');
  const localToStage = characterEndEffectorLayerStageMatrix(evaluated, clipCenterOf(project, shotId, layerId));
  return {
    stage: applyPoint(localToStage, { x: pose.world.tx, y: pose.world.ty }),
    residuals: evaluated.endEffectorResiduals,
  };
}

describe('evaluator parent-space post-pass residuals (#1469 F3)', () => {
  it('re-measures residuals after the last parent-space pass so no stale value can survive', () => {
    const fixture = attachmentChainFixture();
    const targets = new Map(fixture.layerIds.map((layerId) => {
      const basePoint = evaluatedFootStage(fixture.project, fixture.shotId, layerId, 0).stage;
      return [layerId, { x: basePoint.x, y: basePoint.y - 40 }] as const;
    }));
    const service = lockService();
    let project = fixture.project;
    for (const layerId of fixture.layerIds) {
      project = service.addLock(project, { shotId: fixture.shotId, layerId }, {
        boneId: LEG_FOOT,
        space: 'stage',
        target: targets.get(layerId)!,
      });
    }

    const samples = fixture.layerIds.map((layerId) => {
      const final = evaluatedFootStage(project, fixture.shotId, layerId, 0);
      const target = targets.get(layerId)!;
      const distance = Math.hypot(target.x - final.stage.x, target.y - final.stage.y);
      return {
        layerId,
        stage: final.stage,
        distance,
        residual: (final.residuals ?? []).find(({ boneId }) => boneId === LEG_FOOT),
      };
    });

    // The chain genuinely needs the second parent-space pass for the deepest
    // instance, i.e. its final world pose differs from the pose the in-loop
    // residual was measured against.
    const deepest = samples[2]!;
    expect(deepest.distance).toBeGreaterThan(CHARACTER_END_EFFECTOR_LOCK_TOLERANCE);
    // ... so the returned residual must describe that final position, never the
    // superseded in-loop one and never be missing.
    expect(deepest.residual?.reason).toBe('unreachable');
    expect(deepest.residual!.distance).toBeCloseTo(deepest.distance, 6);
    for (const sample of samples) {
      if (sample.distance <= CHARACTER_END_EFFECTOR_LOCK_TOLERANCE) {
        expect(sample.residual, `no residual for reached ${sample.layerId}`).toBeUndefined();
      } else {
        expect(sample.residual?.reason).toBe('unreachable');
        expect(sample.residual!.distance).toBeCloseTo(sample.distance, 6);
      }
    }
  });
});
