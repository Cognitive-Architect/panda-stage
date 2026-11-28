import {
  invertAffineMatrix,
  multiplyAffineMatrices,
  type AffineMatrix2D,
} from '../shared/affine-matrix';
import { characterFaceAndMouthPartIds } from './character-part-animation';
import type { EvaluatedAnimationValue } from './evaluate-animation-core';
import {
  CHARACTER_BONE_MAX_COUNT,
  type AdaptivePartsCharacter,
  type CharacterBone,
  type CharacterBoneRestLocal,
} from './models/character';
import type { CharacterBoneTargetRef, CharacterPartTargetRef } from './models/animationCore';

/**
 * Minimal generic FK Bone Tree for Adaptive Parts Characters (#1455).
 *
 * Coordinate ownership:
 * - `restLocal` lives in the parent Bone's space, in Character-local coordinates
 *   (the same space as `sourceRootTransform * part.restTransform`).
 * - `world` / `restWorld` / `delta` are Character-space matrices.
 * - The shared render model converts `delta` into a Character Clip's
 *   center-local space (`T(-center) * delta * T(center)`) before composing it
 *   once on top of the existing Part pose.
 *
 * The evaluated pose never depends on playback state: it is a pure function of
 * the Character definition and the evaluated Animation Core values.
 */

export const IDENTITY_CHARACTER_BONE_MATRIX: AffineMatrix2D = Object.freeze({
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  tx: 0,
  ty: 0,
});

/** Face, mouth and head-follow Parts keep their existing ownership and never take a Bone delta. */
export function characterBoneProtectedPartIds(
  character: AdaptivePartsCharacter,
): ReadonlySet<string> {
  return new Set([
    ...characterFaceAndMouthPartIds(character),
    ...(character.headMotionBinding?.partIds ?? []),
  ]);
}

export type CharacterBoneTreeErrorCode =
  | 'too-many-bones'
  | 'duplicate-bone-id'
  | 'missing-parent'
  | 'bone-cycle'
  | 'multiple-roots'
  | 'duplicate-part-binding'
  | 'unknown-part';

export interface CharacterBoneTreeSource {
  readonly mode?: string;
  readonly parts?: readonly { readonly partId: string; readonly visible?: boolean }[];
  readonly bones?: readonly CharacterBone[];
}

export interface ResolvedCharacterBoneTree {
  readonly ok: true;
  /** Stable parent-first evaluation order. Siblings keep their authored order. */
  readonly order: readonly string[];
  readonly bones: readonly CharacterBone[];
  readonly byId: ReadonlyMap<string, CharacterBone>;
  /** partId -> owning Bone id. */
  readonly boneByPart: ReadonlyMap<string, string>;
  readonly rootIds: readonly string[];
}

export type CharacterBoneTreeResolution =
  | ResolvedCharacterBoneTree
  | {
      readonly ok: false;
      readonly code: CharacterBoneTreeErrorCode;
      readonly message: string;
      readonly boneId?: string;
    };

function boneFailure(
  code: CharacterBoneTreeErrorCode,
  message: string,
  boneId?: string,
): CharacterBoneTreeResolution {
  return boneId === undefined ? { ok: false, code, message } : { ok: false, code, message, boneId };
}

/**
 * Validates the persisted Bone tree and returns it in parent-first order.
 * Never throws: invalid data yields a typed failure so evaluation can degrade
 * locally without failing the whole Shot.
 */
export function resolveCharacterBoneTree(
  character: CharacterBoneTreeSource,
): CharacterBoneTreeResolution {
  const bones = character.bones ?? [];
  if (bones.length === 0) {
    return { ok: true, order: [], bones: [], byId: new Map(), boneByPart: new Map(), rootIds: [] };
  }
  if (bones.length > CHARACTER_BONE_MAX_COUNT) {
    return boneFailure('too-many-bones', `Bone tree exceeds ${CHARACTER_BONE_MAX_COUNT} Bones.`);
  }
  const byId = new Map<string, CharacterBone>();
  for (const bone of bones) {
    if (byId.has(bone.id)) {
      return boneFailure('duplicate-bone-id', `Duplicate Bone identity: ${bone.id}`, bone.id);
    }
    byId.set(bone.id, bone);
  }
  const boneByPart = new Map<string, string>();
  for (const bone of bones) {
    if (bone.parentBoneId !== null && !byId.has(bone.parentBoneId)) {
      return boneFailure(
        'missing-parent',
        `Bone ${bone.id} references unknown parent Bone: ${bone.parentBoneId}`,
        bone.id,
      );
    }
    if (bone.partId !== undefined) {
      const partExists = character.parts === undefined ||
        character.parts.some((part) => part.partId === bone.partId);
      if (!partExists) {
        return boneFailure('unknown-part', `Bone ${bone.id} references unknown Part: ${bone.partId}`, bone.id);
      }
      const owner = boneByPart.get(bone.partId);
      if (owner !== undefined) {
        return boneFailure(
          'duplicate-part-binding',
          `Part ${bone.partId} is already bound to Bone ${owner}.`,
          bone.id,
        );
      }
      boneByPart.set(bone.partId, bone.id);
    }
  }
  // Cycle check runs over the authored parent chain, independent of ordering.
  for (const bone of bones) {
    const visited = new Set<string>([bone.id]);
    let cursor = bone.parentBoneId;
    while (cursor !== null) {
      if (visited.has(cursor)) {
        return boneFailure('bone-cycle', `Bone tree contains a cycle at Bone: ${bone.id}`, bone.id);
      }
      visited.add(cursor);
      cursor = byId.get(cursor)?.parentBoneId ?? null;
    }
  }
  const rootIds = bones.filter((bone) => bone.parentBoneId === null).map((bone) => bone.id);
  if (rootIds.length > 1) {
    return boneFailure('multiple-roots', 'A Bone tree requires at most one root Bone.');
  }
  if (rootIds.length === 0) {
    return boneFailure('bone-cycle', 'A Bone tree requires one root Bone.');
  }
  const children = new Map<string, string[]>();
  for (const bone of bones) {
    if (bone.parentBoneId === null) continue;
    const list = children.get(bone.parentBoneId) ?? [];
    list.push(bone.id);
    children.set(bone.parentBoneId, list);
  }
  const order: string[] = [];
  const stack = [...rootIds].reverse();
  while (stack.length > 0) {
    const boneId = stack.pop()!;
    order.push(boneId);
    for (const childId of [...(children.get(boneId) ?? [])].reverse()) stack.push(childId);
  }
  return { ok: true, order, bones, byId, boneByPart, rootIds };
}

/** Pure rest-local matrix: translate * rotate. No rest scale is persisted. */
export function characterBoneRestLocalMatrix(
  restLocal: CharacterBoneRestLocal,
): AffineMatrix2D {
  const radians = restLocal.rotationDeg * Math.PI / 180;
  return {
    a: Math.cos(radians),
    b: Math.sin(radians),
    c: -Math.sin(radians),
    d: Math.cos(radians),
    tx: restLocal.x,
    ty: restLocal.y,
  };
}

function translationOnly(matrix: AffineMatrix2D): AffineMatrix2D {
  return { a: 1, b: 0, c: 0, d: 1, tx: matrix.tx, ty: matrix.ty };
}

/** Character-space rest world matrix of every Bone, or `null` for an invalid tree. */
export function characterBoneWorldRestTransforms(
  character: CharacterBoneTreeSource,
): ReadonlyMap<string, AffineMatrix2D> | null {
  const tree = resolveCharacterBoneTree(character);
  if (!tree.ok) return null;
  const restWorlds = new Map<string, AffineMatrix2D>();
  for (const boneId of tree.order) {
    const bone = tree.byId.get(boneId)!;
    const parentRestWorld = bone.parentBoneId === null
      ? undefined
      : restWorlds.get(bone.parentBoneId);
    const inherited = parentRestWorld ?? IDENTITY_CHARACTER_BONE_MATRIX;
    const parent = bone.inheritRotation === false ? translationOnly(inherited) : inherited;
    restWorlds.set(boneId, multiplyAffineMatrices(parent, characterBoneRestLocalMatrix(bone.restLocal)));
  }
  return restWorlds;
}

/** Per-Bone authored pose values read from one Layer instance's Clip values. */
export interface CharacterBonePoseValues {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly rotationDeg: number;
  readonly scaleX: number;
  readonly scaleY: number;
}

export const NEUTRAL_CHARACTER_BONE_POSE: Readonly<CharacterBonePoseValues> = Object.freeze({
  offsetX: 0,
  offsetY: 0,
  rotationDeg: 0,
  scaleX: 1,
  scaleY: 1,
});

function isNeutralBonePose(values: CharacterBonePoseValues): boolean {
  return values.offsetX === 0 && values.offsetY === 0 && values.rotationDeg === 0 &&
    values.scaleX === 1 && values.scaleY === 1;
}

export interface EvaluatedCharacterBonePose {
  readonly boneId: string;
  readonly parentBoneId: string | null;
  /** Authored pose values applied for this evaluation (parent-space offset/scale). */
  readonly values: CharacterBonePoseValues;
  /** Local transform including `restLocal`; always in the parent Bone's space. */
  readonly local: AffineMatrix2D;
  /** Character-space pose world matrix. */
  readonly world: AffineMatrix2D;
  /** Character-space rest world matrix. */
  readonly restWorld: AffineMatrix2D;
  /** `world * inverse(restWorld)`; exactly identity at rest. */
  readonly delta: AffineMatrix2D;
}

function bonePoseLocalMatrix(
  bone: CharacterBone,
  values: CharacterBonePoseValues,
): AffineMatrix2D {
  const radians = (bone.restLocal.rotationDeg + values.rotationDeg) * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    a: cos * values.scaleX,
    b: sin * values.scaleX,
    c: -sin * values.scaleY,
    d: cos * values.scaleY,
    tx: bone.restLocal.x + values.offsetX,
    ty: bone.restLocal.y + values.offsetY,
  };
}

/** Reads Bone pose values out of evaluated Clip values. Filtered by `layerId` when provided. */
export function characterBonePoseValuesFromAnimationValues(
  values: readonly EvaluatedAnimationValue[],
  layerId?: string,
): ReadonlyMap<string, CharacterBonePoseValues> {
  const result = new Map<string, CharacterBonePoseValues>();
  const mutable = new Map<string, {
    offsetX: number;
    offsetY: number;
    rotationDeg: number;
    scaleX: number;
    scaleY: number;
  }>();
  for (const entry of values) {
    if (entry.target.kind !== 'character-bone') continue;
    if (layerId !== undefined && entry.target.layerId !== layerId) continue;
    const current = mutable.get(entry.target.boneId) ?? { ...NEUTRAL_CHARACTER_BONE_POSE };
    switch (entry.property) {
      case 'transform.offsetX': current.offsetX = entry.value; break;
      case 'transform.offsetY': current.offsetY = entry.value; break;
      case 'transform.rotationDeg': current.rotationDeg = entry.value; break;
      case 'transform.scaleX': current.scaleX = entry.value; break;
      case 'transform.scaleY': current.scaleY = entry.value; break;
    }
    mutable.set(entry.target.boneId, current);
  }
  for (const [boneId, pose] of mutable) result.set(boneId, pose);
  return result;
}

function isIdentityMatrix(matrix: AffineMatrix2D): boolean {
  return matrix.a === 1 && matrix.b === 0 && matrix.c === 0 && matrix.d === 1 &&
    matrix.tx === 0 && matrix.ty === 0;
}

/**
 * Deterministic parent-first FK evaluation. Returns an empty map for an invalid
 * tree or a Character without Bones, so callers never throw inside evaluation.
 * At full rest (no keys / neutral values) every `delta` is exactly identity.
 */
export function evaluateCharacterBonePose(input: {
  readonly character: CharacterBoneTreeSource;
  readonly values: readonly EvaluatedAnimationValue[];
  /** Optional Layer instance filter for multi-instance Shot evaluation. */
  readonly layerId?: string;
}): ReadonlyMap<string, EvaluatedCharacterBonePose> {
  const tree = resolveCharacterBoneTree(input.character);
  if (!tree.ok || tree.order.length === 0) return new Map();
  const poseValues = characterBonePoseValuesFromAnimationValues(input.values, input.layerId);
  const poses = new Map<string, EvaluatedCharacterBonePose>();
  for (const boneId of tree.order) {
    const bone = tree.byId.get(boneId)!;
    const values = poseValues.get(boneId) ?? NEUTRAL_CHARACTER_BONE_POSE;
    const parentPose = bone.parentBoneId === null ? undefined : poses.get(bone.parentBoneId);
    const parentWorld = parentPose?.world ?? IDENTITY_CHARACTER_BONE_MATRIX;
    const parentRestWorld = parentPose?.restWorld ?? IDENTITY_CHARACTER_BONE_MATRIX;
    const inheritsRotation = bone.inheritRotation !== false;
    const poseParent = inheritsRotation ? parentWorld : translationOnly(parentWorld);
    const restParent = inheritsRotation ? parentRestWorld : translationOnly(parentRestWorld);
    const local = bonePoseLocalMatrix(bone, values);
    const restLocal = characterBoneRestLocalMatrix(bone.restLocal);
    const world = multiplyAffineMatrices(poseParent, local);
    const restWorld = multiplyAffineMatrices(restParent, restLocal);
    // Exact identity keeps legacy evaluation byte-stable when a Bone chain has
    // no authored pose at all. A neutral child under an animated parent still
    // follows the parent, so its delta is derived like any other pose.
    const parentAtRest = !parentPose || isIdentityMatrix(parentPose.delta);
    if (isNeutralBonePose(values) && parentAtRest) {
      poses.set(boneId, {
        boneId,
        parentBoneId: bone.parentBoneId,
        values,
        local,
        world,
        restWorld,
        delta: IDENTITY_CHARACTER_BONE_MATRIX,
      });
      continue;
    }
    const inverseRest = invertAffineMatrix(restWorld);
    poses.set(boneId, {
      boneId,
      parentBoneId: bone.parentBoneId,
      values,
      local,
      world,
      restWorld,
      delta: inverseRest ? multiplyAffineMatrices(world, inverseRest) : IDENTITY_CHARACTER_BONE_MATRIX,
    });
  }
  return poses;
}

/**
 * Converts Character-space Bone deltas into one Character Clip's center-local
 * space: `T(-center) * delta * T(center)`.
 */
export function characterBonePoseClipDeltas(
  poses: ReadonlyMap<string, EvaluatedCharacterBonePose>,
  fixedCharacterCenter: { readonly x: number; readonly y: number },
): ReadonlyMap<string, AffineMatrix2D> {
  const deltas = new Map<string, AffineMatrix2D>();
  const toCenter: AffineMatrix2D = {
    ...IDENTITY_CHARACTER_BONE_MATRIX,
    tx: fixedCharacterCenter.x,
    ty: fixedCharacterCenter.y,
  };
  const fromCenter: AffineMatrix2D = {
    ...IDENTITY_CHARACTER_BONE_MATRIX,
    tx: -fixedCharacterCenter.x,
    ty: -fixedCharacterCenter.y,
  };
  for (const [boneId, pose] of poses) {
    deltas.set(boneId, multiplyAffineMatrices(fromCenter, multiplyAffineMatrices(pose.delta, toCenter)));
  }
  return deltas;
}

/**
 * Final Clip-space delta per bone-bound Part. Protected Parts (face / mouth /
 * head-follow) are never re-transformed by a Bone delta. Returns an empty map
 * when the tree is invalid, empty, or entirely at rest.
 *
 * Pass `poses` to reuse the deterministic pose map already attached to the
 * evaluated Layer instead of evaluating FK a second time.
 */
export function characterBonePartDeltas(input: {
  readonly character: CharacterBoneTreeSource;
  readonly values: readonly EvaluatedAnimationValue[];
  readonly layerId?: string;
  readonly fixedCharacterCenter: { readonly x: number; readonly y: number };
  readonly protectedPartIds?: ReadonlySet<string>;
  readonly poses?: ReadonlyMap<string, EvaluatedCharacterBonePose>;
}): ReadonlyMap<string, AffineMatrix2D> {
  const tree = resolveCharacterBoneTree(input.character);
  if (!tree.ok || tree.boneByPart.size === 0) return new Map();
  const poses = input.poses ?? evaluateCharacterBonePose(input);
  if (poses.size === 0) return new Map();
  const animated = [...poses.values()].some((pose) =>
    pose.delta.a !== 1 || pose.delta.b !== 0 || pose.delta.c !== 0 ||
    pose.delta.d !== 1 || pose.delta.tx !== 0 || pose.delta.ty !== 0);
  if (!animated) return new Map();
  const clipDeltas = characterBonePoseClipDeltas(poses, input.fixedCharacterCenter);
  const partDeltas = new Map<string, AffineMatrix2D>();
  for (const [partId, boneId] of tree.boneByPart) {
    if (input.protectedPartIds?.has(partId)) continue;
    const delta = clipDeltas.get(boneId);
    if (delta) partDeltas.set(partId, delta);
  }
  return partDeltas;
}

/** Serializes the evaluated pose map into a plain, JSON-friendly EvaluatedLayer field. */
export function evaluatedCharacterBonePoseList(
  poses: ReadonlyMap<string, EvaluatedCharacterBonePose>,
): EvaluatedCharacterBonePose[] {
  return [...poses.values()];
}

/** Re-indexes a serialized EvaluatedLayer pose list for shared downstream use. */
export function characterBonePoseMap(
  poses: readonly EvaluatedCharacterBonePose[],
): ReadonlyMap<string, EvaluatedCharacterBonePose> {
  return new Map(poses.map((pose) => [pose.boneId, pose]));
}

export function characterBoneTargetRef(
  layerId: string,
  boneId: string,
): CharacterBoneTargetRef {
  return { kind: 'character-bone', layerId, boneId };
}

export function characterPartTargetRef(
  layerId: string,
  partId: string,
): CharacterPartTargetRef {
  return { kind: 'character-part', layerId, partId };
}

/** True when a bone-bound Part still owns local Part keys (applied once under the bone delta). */
export function partHasAuthoredLocalPose(
  values: readonly EvaluatedAnimationValue[],
  layerId: string,
  partId: string,
): boolean {
  return values.some((entry) =>
    entry.target.kind === 'character-part' &&
    entry.target.layerId === layerId &&
    entry.target.partId === partId &&
    entry.value !== (entry.property === 'transform.scaleX' || entry.property === 'transform.scaleY' ? 1 : 0));
}
