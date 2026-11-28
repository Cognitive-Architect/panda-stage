import { invertAffineMatrix, multiplyAffineMatrices, type AffineMatrix2D } from '../shared/affine-matrix';
import {
  characterBoneTargetRef,
  characterBonePoseValuesFromAnimationValues,
  characterBoneWorldRestTransforms,
  evaluateCharacterBonePose,
  NEUTRAL_CHARACTER_BONE_POSE,
  resolveCharacterBoneTree,
  type CharacterBonePoseValues,
  type CharacterBoneTreeSource,
  type EvaluatedCharacterBonePose,
} from './character-bone-pose';
import { solveRigidArm, type ArmJointLimit, type ArmPoint } from './geometry/rigidArmIk';
import { composeAffineMatrix } from './models/flaGraphicTimeline';
import type { AnimationProperty } from './models/animationCore';
import type { CharacterEndEffectorLock } from './models/layer';
import type { EvaluatedAnimationValue } from './evaluate-animation-core';

/**
 * Author-selectable end-effector locks (#1456).
 *
 * Coordinate ownership:
 * - Bone `world` matrices (and `localToStage` here) live in Character space; the
 *   Clip fixed center is subtracted inside `localToStage`, so it maps a
 *   Character-space point directly to the Stage.
 * - A `stage` target is one fixed Stage position. Camera transforms are applied
 *   downstream of the Layer transform, so pan/zoom can never move it.
 * - A `character` target lives in Character-local space and therefore moves
 *   together with the Layer (mirror, rotation, parent attachment).
 *
 * The solver is a pure function of the Character definition, the already
 * evaluated base pose, the authored locks and the Layer transform. It never
 * reads pointer history, playback state or wall-clock time.
 */

/** The root Bone is never solved; v1 does not auto-move the whole body. */
export const CHARACTER_END_EFFECTOR_LOCK_MAX_SEGMENTS = 3;
export const CHARACTER_END_EFFECTOR_LOCK_MIN_SEGMENTS = 2;
/** Residuals smaller than this are treated as successfully reached. */
export const CHARACTER_END_EFFECTOR_LOCK_TOLERANCE = 0.75;
/** Derived bend seeds (degrees) keep a near-straight chain from flipping sides. */
const BEND_SEED_DEG = 15;
const SYNTHETIC_POSE_LAYER_ID = '00000000-0000-4000-8000-000000000145';

export type CharacterEndEffectorResidualReason =
  | 'unreachable'
  | 'shared-ancestor'
  | 'invalid-chain'
  | 'invalid-target';

export interface CharacterEndEffectorResidual {
  readonly lockId: string;
  readonly boneId: string;
  /** Remaining end-effector error, in the lock's own space units. */
  readonly distance: number;
  readonly reason: CharacterEndEffectorResidualReason;
}

export interface CharacterEndEffectorLockResult {
  readonly values: ReadonlyMap<string, CharacterBonePoseValues>;
  readonly residuals: readonly CharacterEndEffectorResidual[];
  /** Bones whose pose values the solver changed, in deterministic order. */
  readonly solvedBoneIds: readonly string[];
}

export interface ApplyCharacterEndEffectorLocksInput {
  readonly character: CharacterBoneTreeSource;
  /** Bone pose values already evaluated at this Shot time. */
  readonly baseBoneValues: ReadonlyMap<string, CharacterBonePoseValues>;
  readonly locks: readonly CharacterEndEffectorLock[];
  /** Character space -> Stage space, including the Clip fixed center offset. */
  readonly localToStage: AffineMatrix2D;
  /** Exact inverse of `localToStage`; derived when omitted or invalid. */
  readonly stageToLocal?: AffineMatrix2D | null;
  /** Face/mouth/head-follow Parts can never be a lock target. */
  readonly protectedPartIds?: ReadonlySet<string>;
  /** Shot time; when provided, `activeRange` is honored here as well. */
  readonly timeMs?: number;
  /** Optional explicit bend direction per lock id (+1 / -1). */
  readonly bendDirections?: ReadonlyMap<string, number>;
}

const BONE_POSE_PROPERTIES: readonly AnimationProperty[] = [
  'transform.offsetX',
  'transform.offsetY',
  'transform.rotationDeg',
  'transform.scaleX',
  'transform.scaleY',
];

const TO_RAD = Math.PI / 180;
const TO_DEG = 180 / Math.PI;

function transformPoint(matrix: AffineMatrix2D, point: ArmPoint): ArmPoint {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.tx,
    y: matrix.b * point.x + matrix.d * point.y + matrix.ty,
  };
}

function hasFinitePoint(point: { readonly x: number; readonly y: number }): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function normalizeDeg(value: number): number {
  return ((((value + 180) % 360) + 360) % 360) - 180;
}

function angleOfDirection(direction: ArmPoint): number {
  return Math.atan2(direction.y, direction.x) * TO_DEG;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Half-open `[startMs, endMs)`; a lock without a range is always active. */
export function characterEndEffectorLockActiveAt(
  lock: CharacterEndEffectorLock,
  timeMs: number,
): boolean {
  const range = lock.activeRange;
  if (!range) return true;
  return timeMs >= range.startMs && timeMs < range.endMs;
}

/** Character->Stage matrix for one evaluated Layer instance, including the Clip fixed center. */
export function characterEndEffectorLayerStageMatrix(
  layer: {
    readonly x: number;
    readonly y: number;
    readonly scaleX: number;
    readonly scaleY: number;
    readonly flipX: boolean;
    readonly rotationDeg: number;
    readonly parentSpace?: AffineMatrix2D;
  },
  fixedCharacterCenter: { readonly x: number; readonly y: number },
): AffineMatrix2D {
  const pose = composeAffineMatrix({
    tx: layer.x,
    ty: layer.y,
    rotationDeg: layer.rotationDeg % 360,
    scaleX: layer.flipX ? -layer.scaleX : layer.scaleX,
    scaleY: layer.scaleY,
  });
  const world = layer.parentSpace ? multiplyAffineMatrices(layer.parentSpace, pose) : pose;
  return multiplyAffineMatrices(world, {
    a: 1,
    b: 0,
    c: 0,
    d: 1,
    tx: -fixedCharacterCenter.x,
    ty: -fixedCharacterCenter.y,
  });
}

function poseValuesToAnimationValues(
  values: ReadonlyMap<string, CharacterBonePoseValues>,
): EvaluatedAnimationValue[] {
  const entries: EvaluatedAnimationValue[] = [];
  for (const [boneId, pose] of values) {
    const target = characterBoneTargetRef(SYNTHETIC_POSE_LAYER_ID, boneId);
    for (const property of BONE_POSE_PROPERTIES) {
      const value = property === 'transform.offsetX'
        ? pose.offsetX
        : property === 'transform.offsetY'
          ? pose.offsetY
          : property === 'transform.rotationDeg'
            ? pose.rotationDeg
            : property === 'transform.scaleX'
              ? pose.scaleX
              : pose.scaleY;
      entries.push({ target, property, value });
    }
  }
  return entries;
}

/** Deterministic FK from an explicit bone value map. */
export function evaluateCharacterBonePoseFromValues(
  character: CharacterBoneTreeSource,
  values: ReadonlyMap<string, CharacterBonePoseValues>,
): ReadonlyMap<string, EvaluatedCharacterBonePose> {
  return evaluateCharacterBonePose({
    character,
    values: poseValuesToAnimationValues(values),
  });
}

export interface CharacterEndEffectorLockChain {
  readonly leafId: string;
  /** Nearest ancestor Bones that may rotate, ordered root-most first. */
  readonly movableBoneIds: readonly string[];
}

export type CharacterEndEffectorLockChainResolution =
  | { readonly ok: true; readonly chain: CharacterEndEffectorLockChain }
  | {
      readonly ok: false;
      readonly reason: CharacterEndEffectorResidualReason;
      /** Chinese author-facing explanation. */
      readonly message: string;
    };

function chainFailure(
  reason: CharacterEndEffectorResidualReason,
  message: string,
): CharacterEndEffectorLockChainResolution {
  return { ok: false, reason, message };
}

/**
 * Resolves the solvable chain behind one lock. The end effector is the leaf
 * Bone's own pivot (the bound Part center), so the leaf itself only contributes
 * the optional foot-direction lock.
 */
export function resolveCharacterEndEffectorLockChain(
  character: CharacterBoneTreeSource,
  lock: Pick<CharacterEndEffectorLock, 'boneId'>,
): CharacterEndEffectorLockChainResolution {
  const tree = resolveCharacterBoneTree(character);
  if (!tree.ok) return chainFailure('invalid-chain', '骨骼树无效，无法解算末端锁定。');
  const leaf = tree.byId.get(lock.boneId);
  if (!leaf) return chainFailure('invalid-target', '未找到末端锁定使用的骨骼。');
  const hasChild = tree.bones.some((bone) => bone.parentBoneId === lock.boneId);
  if (hasChild) return chainFailure('invalid-target', '末端锁定只能固定在骨链末端（没有子骨骼）的骨骼上。');
  const nearestFirst: string[] = [];
  let cursor = leaf.parentBoneId;
  while (cursor !== null && nearestFirst.length < CHARACTER_END_EFFECTOR_LOCK_MAX_SEGMENTS) {
    const bone = tree.byId.get(cursor);
    if (!bone) break;
    // The root Bone is intentionally never solved in v1.
    if (bone.parentBoneId === null) break;
    nearestFirst.push(cursor);
    cursor = bone.parentBoneId;
  }
  if (nearestFirst.length < CHARACTER_END_EFFECTOR_LOCK_MIN_SEGMENTS) {
    return chainFailure('invalid-chain', '末端锁定需要至少两根可求解的父级骨骼。');
  }
  const chainBones = [leaf, ...nearestFirst.map((boneId) => tree.byId.get(boneId)!)];
  if (chainBones.some((bone) => bone.inheritRotation === false)) {
    return chainFailure('invalid-chain', '末端锁定链中的骨骼必须继承父骨骼旋转。');
  }
  return { ok: true, chain: { leafId: leaf.id, movableBoneIds: nearestFirst.reverse() } };
}

export interface CharacterEndEffectorLockValidationInput {
  readonly character: CharacterBoneTreeSource;
  readonly lock: CharacterEndEffectorLock;
  readonly durationMs?: number;
  readonly existingLocks?: readonly CharacterEndEffectorLock[];
  /** Lock being replaced/updated, excluded from the duplicate check. */
  readonly ignoreLockId?: string;
  readonly protectedPartIds?: ReadonlySet<string>;
}

/**
 * Authoring-time validation for one lock (used by the domain service so the
 * editor rejects invalid locks with a clear Chinese message before saving).
 * The evaluator degrades locally instead of throwing, so a project that became
 * invalid still evaluates.
 */
export function validateCharacterEndEffectorLock(
  input: CharacterEndEffectorLockValidationInput,
): string | null {
  const { lock } = input;
  if (!Number.isFinite(lock.weight ?? 1) || (lock.weight ?? 1) <= 0 || (lock.weight ?? 1) > 1) {
    return '末端锁定权重必须大于 0 且不超过 1。';
  }
  const duplicate = (input.existingLocks ?? []).find(
    (other) => other.boneId === lock.boneId && other.id !== lock.id && other.id !== input.ignoreLockId,
  );
  if (duplicate) return '同一骨骼只能有一个末端锁定。';
  const range = lock.activeRange;
  if (range) {
    if (range.startMs < 0 || range.endMs <= range.startMs) {
      return '末端锁定的开始时间必须小于结束时间。';
    }
    if (input.durationMs !== undefined && range.endMs > input.durationMs) {
      return '末端锁定的生效区间必须落在镜头时长内。';
    }
  }
  const resolved = resolveCharacterEndEffectorLockChain(input.character, lock);
  if (!resolved.ok) return resolved.message;
  const tree = resolveCharacterBoneTree(input.character);
  if (!tree.ok) return '骨骼树无效，无法保存末端锁定。';
  const leaf = tree.byId.get(lock.boneId);
  if (leaf?.partId !== undefined && input.protectedPartIds?.has(leaf.partId)) {
    return '脸部、口型与随头部件不能作为末端锁定目标。';
  }
  return null;
}

function currentEndEffectorDistance(input: {
  lock: CharacterEndEffectorLock;
  leafPose: EvaluatedCharacterBonePose;
  localToStage: AffineMatrix2D;
  stageToLocal: AffineMatrix2D;
}): number {
  const { lock, leafPose } = input;
  const leafCharacterPoint = { x: leafPose.world.tx, y: leafPose.world.ty };
  if (lock.space === 'character') {
    return Math.hypot(lock.target.x - leafCharacterPoint.x, lock.target.y - leafCharacterPoint.y);
  }
  const stagePoint = transformPoint(input.localToStage, leafCharacterPoint);
  return Math.hypot(lock.target.x - stagePoint.x, lock.target.y - stagePoint.y);
}

function characterDirectionAngleFromStage(
  stageToLocal: AffineMatrix2D,
  stageAngleDeg: number,
): number {
  const radians = stageAngleDeg * TO_RAD;
  const stageDirection = { x: Math.cos(radians), y: Math.sin(radians) };
  const localDirection = {
    x: stageToLocal.a * stageDirection.x + stageToLocal.c * stageDirection.y,
    y: stageToLocal.b * stageDirection.x + stageToLocal.d * stageDirection.y,
  };
  return angleOfDirection(localDirection);
}

function signedChainBend(points: readonly ArmPoint[]): number {
  if (points.length < 3) return 0;
  const first = points[0]!;
  const second = points[1]!;
  const third = points[2]!;
  return (second.x - first.x) * (third.y - second.y) - (second.y - first.y) * (third.x - second.x);
}

function resolveBendSign(input: {
  lockId: string;
  basePoints: readonly ArmPoint[];
  restPoints: readonly ArmPoint[] | null;
  bendDirections?: ReadonlyMap<string, number>;
}): number {
  const explicit = input.bendDirections?.get(input.lockId);
  if (explicit !== undefined && Number.isFinite(explicit) && explicit !== 0) return explicit > 0 ? 1 : -1;
  const baseBend = signedChainBend(input.basePoints);
  if (Math.abs(baseBend) > 1e-9) return baseBend > 0 ? 1 : -1;
  const restBend = input.restPoints ? signedChainBend(input.restPoints) : 0;
  if (Math.abs(restBend) > 1e-9) return restBend > 0 ? 1 : -1;
  return 1;
}

function boneDepth(tree: { readonly byId: ReadonlyMap<string, { readonly parentBoneId: string | null }> }, boneId: string): number {
  let depth = 0;
  let cursor = tree.byId.get(boneId)?.parentBoneId ?? null;
  const seen = new Set<string>();
  while (cursor !== null && !seen.has(cursor)) {
    seen.add(cursor);
    depth += 1;
    cursor = tree.byId.get(cursor)?.parentBoneId ?? null;
  }
  return depth;
}

/**
 * Applies every active lock to the base bone pose. Deterministic and side-effect
 * free. Multi-endpoint conflicts use one documented rule: deeper leaves are
 * solved first (then by lock id / bone id), and the first lock owns a shared
 * ancestor chain. A later lock whose nearest two ancestors are already claimed
 * degrades locally and reports a `shared-ancestor` residual instead of moving
 * the whole body.
 */
export function applyCharacterEndEffectorLocks(
  input: ApplyCharacterEndEffectorLocksInput,
): CharacterEndEffectorLockResult {
  const tree = resolveCharacterBoneTree(input.character);
  if (!tree.ok) {
    return { values: input.baseBoneValues, residuals: [], solvedBoneIds: [] };
  }
  const stageToLocal = input.stageToLocal ?? invertAffineMatrix(input.localToStage);
  const values = new Map(input.baseBoneValues);
  const residuals: CharacterEndEffectorResidual[] = [];
  const solvedBoneIds: string[] = [];
  const solvedSet = new Set<string>();
  const claimed = new Set<string>();
  const restWorlds = restWorldMap(input.character);

  const ordered = [...input.locks]
    .filter((lock) => input.timeMs === undefined || characterEndEffectorLockActiveAt(lock, input.timeMs))
    .map((lock) => ({ lock, depth: boneDepth(tree, lock.boneId) }))
    .sort((left, right) =>
      right.depth - left.depth ||
      left.lock.id.localeCompare(right.lock.id) ||
      left.lock.boneId.localeCompare(right.lock.boneId))
    .map(({ lock }) => lock);

  for (const lock of ordered) {
    if (!hasFinitePoint(lock.target)) {
      residuals.push({ lockId: lock.id, boneId: lock.boneId, distance: 0, reason: 'invalid-target' });
      continue;
    }
    const resolved = resolveCharacterEndEffectorLockChain(input.character, lock);
    if (!resolved.ok) {
      const poses = evaluateCharacterBonePoseFromValues(input.character, values);
      const leafPose = poses.get(lock.boneId);
      residuals.push({
        lockId: lock.id,
        boneId: lock.boneId,
        distance: leafPose && stageToLocal
          ? currentEndEffectorDistance({ lock, leafPose, localToStage: input.localToStage, stageToLocal })
          : 0,
        reason: resolved.reason,
      });
      continue;
    }
    const leaf = tree.byId.get(resolved.chain.leafId)!;
    if (leaf.partId !== undefined && input.protectedPartIds?.has(leaf.partId)) {
      residuals.push({ lockId: lock.id, boneId: lock.boneId, distance: 0, reason: 'invalid-target' });
      continue;
    }
    if (!stageToLocal) {
      residuals.push({ lockId: lock.id, boneId: lock.boneId, distance: 0, reason: 'invalid-target' });
      continue;
    }
    const basePoses = evaluateCharacterBonePoseFromValues(input.character, values);
    const leafPose = basePoses.get(resolved.chain.leafId);
    if (!leafPose) {
      residuals.push({ lockId: lock.id, boneId: lock.boneId, distance: 0, reason: 'invalid-chain' });
      continue;
    }
    // A shared ancestor that has already been solved by a higher-priority lock
    // is fixed: stop the chain there instead of moving another endpoint's owner.
    const movableNearestFirst: string[] = [];
    let blockedByClaim = false;
    let cursor = leaf.parentBoneId;
    while (cursor !== null && movableNearestFirst.length < CHARACTER_END_EFFECTOR_LOCK_MAX_SEGMENTS) {
      const bone = tree.byId.get(cursor);
      if (!bone || bone.parentBoneId === null) break;
      if (claimed.has(cursor)) {
        blockedByClaim = true;
        break;
      }
      movableNearestFirst.push(cursor);
      cursor = bone.parentBoneId;
    }
    if (movableNearestFirst.length < CHARACTER_END_EFFECTOR_LOCK_MIN_SEGMENTS) {
      residuals.push({
        lockId: lock.id,
        boneId: lock.boneId,
        distance: currentEndEffectorDistance({ lock, leafPose, localToStage: input.localToStage, stageToLocal }),
        reason: blockedByClaim ? 'shared-ancestor' : 'invalid-chain',
      });
      continue;
    }
    const movableBoneIds = [...movableNearestFirst].reverse();
    const basePoints: ArmPoint[] = movableBoneIds.map((boneId) => {
      const pose = basePoses.get(boneId)!;
      return { x: pose.world.tx, y: pose.world.ty };
    });
    basePoints.push({ x: leafPose.world.tx, y: leafPose.world.ty });
    const restPoints = restWorlds
      ? [...movableBoneIds, leaf.id].map((boneId) => {
          const rest = restWorlds.get(boneId);
          return rest ? { x: rest.tx, y: rest.ty } : { x: 0, y: 0 };
        })
      : null;
    const targetCharacterPoint = lock.space === 'stage'
      ? transformPoint(stageToLocal, lock.target)
      : { x: lock.target.x, y: lock.target.y };
    const weight = lock.weight ?? 1;
    const limits: ArmJointLimit[] = movableBoneIds.map((boneId) => {
      const bone = tree.byId.get(boneId)!;
      const base = values.get(boneId) ?? NEUTRAL_CHARACTER_BONE_POSE;
      const minDeg = (bone.minDeg ?? -180) - base.rotationDeg;
      const maxDeg = (bone.maxDeg ?? 180) - base.rotationDeg;
      return minDeg <= maxDeg ? { minDeg, maxDeg } : { minDeg: maxDeg, maxDeg: minDeg };
    });
    const bendSign = resolveBendSign({
      lockId: lock.id,
      basePoints,
      restPoints,
      bendDirections: input.bendDirections,
    });
    const seed = movableBoneIds.map((_, index) => (index === 0 ? 0 : bendSign * BEND_SEED_DEG));
    let appliedDeltas: number[];
    try {
      const solution = solveRigidArm(basePoints, targetCharacterPoint, limits, seed);
      appliedDeltas = solution.jointAnglesDeg.map((angle, index) =>
        clamp(angle * weight, limits[index]!.minDeg, limits[index]!.maxDeg),
      );
    } catch {
      residuals.push({
        lockId: lock.id,
        boneId: lock.boneId,
        distance: currentEndEffectorDistance({ lock, leafPose, localToStage: input.localToStage, stageToLocal }),
        reason: 'invalid-chain',
      });
      continue;
    }
    movableBoneIds.forEach((boneId, index) => {
      const base = values.get(boneId) ?? NEUTRAL_CHARACTER_BONE_POSE;
      values.set(boneId, { ...base, rotationDeg: base.rotationDeg + appliedDeltas[index]! });
      claimed.add(boneId);
      if (!solvedSet.has(boneId)) {
        solvedSet.add(boneId);
        solvedBoneIds.push(boneId);
      }
    });
    // The optional foot direction lock only turns the leaf; the end-effector
    // pivot is still owned by the solved ancestors above.
    if (lock.footRotationDeg !== undefined) {
      const desiredCharacterAngle = lock.space === 'stage'
        ? characterDirectionAngleFromStage(stageToLocal, lock.footRotationDeg)
        : lock.footRotationDeg;
      const baseLeafAngle = Math.atan2(leafPose.world.b, leafPose.world.a) * TO_DEG;
      const ancestorRotation = appliedDeltas.reduce((sum, value) => sum + value, 0);
      const rawDelta = normalizeDeg(desiredCharacterAngle - baseLeafAngle) - ancestorRotation;
      const base = values.get(leaf.id) ?? NEUTRAL_CHARACTER_BONE_POSE;
      const minDeg = (leaf.minDeg ?? -180) - base.rotationDeg;
      const maxDeg = (leaf.maxDeg ?? 180) - base.rotationDeg;
      const leafDelta = clamp(rawDelta * weight, Math.min(minDeg, maxDeg), Math.max(minDeg, maxDeg));
      values.set(leaf.id, { ...base, rotationDeg: base.rotationDeg + leafDelta });
      if (!solvedSet.has(leaf.id)) {
        solvedSet.add(leaf.id);
        solvedBoneIds.push(leaf.id);
      }
    }
    // Achieved pivot after weight/clamp: forward-rotate the base segments.
    const achieved = { ...basePoints[0]! };
    let cumulative = 0;
    for (let index = 0; index < movableBoneIds.length; index += 1) {
      const from = basePoints[index]!;
      const to = basePoints[index + 1]!;
      cumulative += appliedDeltas[index]!;
      const radians = cumulative * TO_RAD;
      const segment = { x: to.x - from.x, y: to.y - from.y };
      achieved.x += segment.x * Math.cos(radians) - segment.y * Math.sin(radians);
      achieved.y += segment.x * Math.sin(radians) + segment.y * Math.cos(radians);
    }
    const achievedStage = transformPoint(input.localToStage, achieved);
    const distance = lock.space === 'stage'
      ? Math.hypot(lock.target.x - achievedStage.x, lock.target.y - achievedStage.y)
      : Math.hypot(lock.target.x - achieved.x, lock.target.y - achieved.y);
    if (distance > CHARACTER_END_EFFECTOR_LOCK_TOLERANCE) {
      residuals.push({ lockId: lock.id, boneId: lock.boneId, distance, reason: 'unreachable' });
    }
  }
  return { values, residuals, solvedBoneIds };
}

function restWorldMap(
  character: CharacterBoneTreeSource,
): ReadonlyMap<string, AffineMatrix2D> | null {
  // Reuse the #1455 rest-pose FK instead of duplicating rest math.
  return characterBoneWorldRestTransforms(character);
}

export interface ApplyCharacterEndEffectorLocksToValuesInput {
  readonly character: CharacterBoneTreeSource;
  /** Evaluated Animation Core values at the same Shot time. */
  readonly values: readonly EvaluatedAnimationValue[];
  readonly layerId: string;
  readonly locks: readonly CharacterEndEffectorLock[];
  /** Character space -> Stage space, including the Clip fixed center offset. */
  readonly localToStage: AffineMatrix2D;
  readonly stageToLocal?: AffineMatrix2D | null;
  readonly protectedPartIds?: ReadonlySet<string>;
  readonly timeMs?: number;
  readonly bendDirections?: ReadonlyMap<string, number>;
}

export interface AppliedCharacterEndEffectorLocksToValues {
  /** Original value array when nothing was solved (byte-stable no-lock path). */
  readonly values: EvaluatedAnimationValue[];
  readonly residuals: readonly CharacterEndEffectorResidual[];
  readonly solvedBoneIds: readonly string[];
  readonly poseValues: ReadonlyMap<string, CharacterBonePoseValues>;
}

/**
 * Evaluation bridge: solves locks on the already evaluated base pose and
 * returns a merged value array so every downstream consumer that re-evaluates
 * FK from values (hit testing, attachment targets, services) agrees with the
 * patched `EvaluatedLayer.characterBonePose`.
 */
export function applyCharacterEndEffectorLocksToValues(
  input: ApplyCharacterEndEffectorLocksToValuesInput,
): AppliedCharacterEndEffectorLocksToValues {
  const baseBoneValues = characterBonePoseValuesFromAnimationValues(input.values, input.layerId);
  const result = applyCharacterEndEffectorLocks({
    character: input.character,
    baseBoneValues,
    locks: input.locks,
    localToStage: input.localToStage,
    stageToLocal: input.stageToLocal,
    protectedPartIds: input.protectedPartIds,
    timeMs: input.timeMs,
    bendDirections: input.bendDirections,
  });
  if (result.solvedBoneIds.length === 0) {
    return {
      values: input.values as EvaluatedAnimationValue[],
      residuals: result.residuals,
      solvedBoneIds: [],
      poseValues: baseBoneValues,
    };
  }
  const solvedSet = new Set(result.solvedBoneIds);
  const nextValues = input.values.filter((entry) =>
    !(entry.target.kind === 'character-bone' &&
      entry.target.layerId === input.layerId &&
      solvedSet.has(entry.target.boneId)));
  for (const boneId of result.solvedBoneIds) {
    const pose = result.values.get(boneId);
    if (!pose) continue;
    const target = characterBoneTargetRef(input.layerId, boneId);
    for (const property of BONE_POSE_PROPERTIES) {
      nextValues.push({
        target,
        property,
        value: property === 'transform.offsetX'
          ? pose.offsetX
          : property === 'transform.offsetY'
            ? pose.offsetY
            : property === 'transform.rotationDeg'
              ? pose.rotationDeg
              : property === 'transform.scaleX'
                ? pose.scaleX
                : pose.scaleY,
      });
    }
  }
  return {
    values: nextValues,
    residuals: result.residuals,
    solvedBoneIds: result.solvedBoneIds,
    poseValues: result.values,
  };
}
