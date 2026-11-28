import { describe, expect, it } from 'vitest';
import {
  CHARACTER_END_EFFECTOR_LOCK_TOLERANCE,
  applyCharacterEndEffectorLocks,
  evaluateCharacterBonePoseFromValues,
  type CharacterBone,
  type CharacterBonePoseValues,
} from '../../src/domain';
import type { AffineMatrix2D } from '../../src/shared/affine-matrix';
import { adaptiveCharacterOf, buildBoneFixture, withBones } from '../helpers/boneTreeFixtures';

const PELVIS = '00000000-0000-4000-8000-000000000601';
const THIGH = '00000000-0000-4000-8000-000000000602';
const SHIN = '00000000-0000-4000-8000-000000000603';
const FOOT = '00000000-0000-4000-8000-000000000604';
const IDENTITY: AffineMatrix2D = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
const LOCK_ID = '00000000-0000-4000-8000-0000000009a1';

/** Same leg chain as the #1456 end-effector suite: pelvis (500,200) -> hip -> knee -> ankle. */
function legBones(footPartId: string): CharacterBone[] {
  return [
    { id: PELVIS, parentBoneId: null, restLocal: { x: 500, y: 200, rotationDeg: 0 } },
    { id: THIGH, parentBoneId: PELVIS, restLocal: { x: -60, y: 80, rotationDeg: 0 } },
    { id: SHIN, parentBoneId: THIGH, restLocal: { x: 0, y: 120, rotationDeg: 0 } },
    { id: FOOT, parentBoneId: SHIN, restLocal: { x: 0, y: 120, rotationDeg: 0 }, partId: footPartId, length: 60 },
  ];
}

function legCharacter() {
  const base = buildBoneFixture(4);
  const project = withBones(base.project, base.characterId, legBones(base.partIds[3]!));
  return adaptiveCharacterOf(project, base.characterId);
}

/**
 * A non-uniform parent Bone scale: the real FK end position is not the rigid
 * rotation prediction the solver uses for its internal maths (#1455 x #1456).
 */
function nonUniformBaseValues(): Map<string, CharacterBonePoseValues> {
  return new Map([[PELVIS, { offsetX: 0, offsetY: 0, rotationDeg: 0, scaleX: 1.5, scaleY: 0.5 }]]);
}

function leafPoint(
  character: ReturnType<typeof legCharacter>,
  values: ReadonlyMap<string, CharacterBonePoseValues>,
): { x: number; y: number } {
  const pose = evaluateCharacterBonePoseFromValues(character, values).get(FOOT)!;
  return { x: pose.world.tx, y: pose.world.ty };
}

function transformPoint(matrix: AffineMatrix2D, point: { x: number; y: number }) {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.tx,
    y: matrix.b * point.x + matrix.d * point.y + matrix.ty,
  };
}

type LockSpace = 'character' | 'stage';

function solve(input: {
  character: ReturnType<typeof legCharacter>;
  baseValues: ReadonlyMap<string, CharacterBonePoseValues>;
  target: { x: number; y: number };
  space: LockSpace;
  localToStage: AffineMatrix2D;
}) {
  const result = applyCharacterEndEffectorLocks({
    character: input.character,
    baseBoneValues: input.baseValues,
    locks: [{
      id: LOCK_ID,
      boneId: FOOT,
      space: input.space,
      target: input.target,
    }],
    localToStage: input.localToStage,
    protectedPartIds: new Set(),
  });
  const actualCharacter = leafPoint(input.character, result.values);
  const actualPoint = input.space === 'stage'
    ? transformPoint(input.localToStage, actualCharacter)
    : actualCharacter;
  return {
    result,
    actualCharacter,
    actualDistance: Math.hypot(input.target.x - actualPoint.x, input.target.y - actualPoint.y),
    residual: result.residuals.find(({ lockId }) => lockId === LOCK_ID),
  };
}

describe('end-effector lock residual under non-uniform parent scale (#1455 x #1456)', () => {
  it('reports the residual from the actual final FK end position, not the rigid prediction', () => {
    const character = legCharacter();
    const baseValues = nonUniformBaseValues();
    const baseLeaf = leafPoint(character, baseValues);
    // The rigid solver reaches this target exactly, so the old code reported no
    // residual while the real FK foot is far away.
    const solved = solve({
      character,
      baseValues,
      target: { x: baseLeaf.x - 100, y: baseLeaf.y - 110 },
      space: 'character',
      localToStage: IDENTITY,
    });
    expect(solved.actualDistance).toBeGreaterThan(CHARACTER_END_EFFECTOR_LOCK_TOLERANCE);
    expect(solved.residual).toBeDefined();
    expect(solved.residual!.reason).toBe('unreachable');
    expect(solved.residual!.distance).toBeCloseTo(solved.actualDistance, 6);
  });

  it('keeps a truthful unreachable distance when both predictions are unreachable', () => {
    const character = legCharacter();
    const baseValues = nonUniformBaseValues();
    const baseLeaf = leafPoint(character, baseValues);
    const solved = solve({
      character,
      baseValues,
      target: { x: baseLeaf.x + 30, y: baseLeaf.y + 60 },
      space: 'character',
      localToStage: IDENTITY,
    });
    expect(solved.actualDistance).toBeGreaterThan(CHARACTER_END_EFFECTOR_LOCK_TOLERANCE);
    expect(solved.residual).toBeDefined();
    expect(solved.residual!.distance).toBeCloseTo(solved.actualDistance, 6);
    // The reported number is a real distance, not the shorter rigid-rotation one.
    expect(solved.residual!.distance).toBeGreaterThan(65);
  });

  it('measures a stage target in the same space as the actual FK end position', () => {
    const character = legCharacter();
    const baseValues = nonUniformBaseValues();
    const baseLeaf = leafPoint(character, baseValues);
    // A rotated + translated Character -> Stage mapping keeps distances but
    // changes coordinates, so space handling must stay consistent.
    const localToStage: AffineMatrix2D = { a: 0, b: 1, c: -1, d: 0, tx: 320, ty: 180 };
    const targetCharacter = { x: baseLeaf.x - 100, y: baseLeaf.y - 110 };
    const target = transformPoint(localToStage, targetCharacter);
    const solved = solve({ character, baseValues, target, space: 'stage', localToStage });
    expect(solved.actualDistance).toBeGreaterThan(CHARACTER_END_EFFECTOR_LOCK_TOLERANCE);
    expect(solved.residual).toBeDefined();
    expect(solved.residual!.distance).toBeCloseTo(solved.actualDistance, 6);
  });

  it('still reports no residual for a reachable end position under non-uniform scale', () => {
    const character = legCharacter();
    const baseValues = nonUniformBaseValues();
    const baseLeaf = leafPoint(character, baseValues);
    const solved = solve({
      character,
      baseValues,
      target: { x: baseLeaf.x, y: baseLeaf.y - 60 },
      space: 'character',
      localToStage: IDENTITY,
    });
    expect(solved.actualDistance).toBeLessThanOrEqual(CHARACTER_END_EFFECTOR_LOCK_TOLERANCE);
    expect(solved.residual).toBeUndefined();
  });
});
