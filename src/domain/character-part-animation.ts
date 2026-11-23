import { invertAffineMatrix, multiplyAffineMatrices } from '../shared/affine-matrix';
import { characterPartSourceBounds } from './geometry/characterPartLayout';
import {
  AnimationClipV0Schema, TargetLocalPivotSchema, sameAnimationTarget,
  type AnimationClipV0, type CharacterPartTargetBasis, type CharacterPartTargetRef,
  type TargetLocalPivot,
} from './models/animationCore';
import {
  resolveCharacterPartVisualSource, type AdaptivePartsCharacter, type CharacterPartTransform, type LayeredCharacterAction,
} from './models/character';
import type { Project } from './models/project';
import { evaluateAnimationTrackAtTime, type EvaluatedAnimationValue } from './evaluate-animation-core';

const IDENTITY: CharacterPartTransform = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

function point(matrix: CharacterPartTransform, x: number, y: number) {
  return { x: matrix.a * x + matrix.c * y + matrix.tx, y: matrix.b * x + matrix.d * y + matrix.ty };
}

function sameTarget(left: CharacterPartTargetRef, right: { kind: string; layerId: string; partId?: string }): boolean {
  return right.kind === 'character-part' && sameAnimationTarget(left, right as CharacterPartTargetRef);
}

/** Capture source geometry once, never a rendered frame's bounds or bitmap. */
export function createCharacterPartAnimationClip(project: Project, shotId: string, layerId: string): AnimationClipV0 {
  const layer = project.shots.find(shot => shot.id === shotId)?.layers.find(entry => entry.id === layerId);
  if (!layer || layer.source.kind !== 'character') throw new Error('Animation requires a Character Layer.');
  const characterId = layer.source.characterId;
  const character = project.characters.find(entry => entry.id === characterId);
  if (!character || character.mode !== 'adaptive-parts') throw new Error('Animation requires an Adaptive Parts Character.');
  // Re-entering animation must not silently recapture Library changes.
  if (layer.animationClip) {
    if (layer.animationClip.version !== 1) throw new Error('Character Layer requires a Character Animation Clip v1.');
    return structuredClone(layer.animationClip);
  }
  return captureCharacterPartAnimationBasis(project, character, layerId);
}

export function captureCharacterPartAnimationBasis(project: Project, character: AdaptivePartsCharacter, layerId: string): AnimationClipV0 {
  const sourcePosePoints: { x: number; y: number }[] = [];
  const targetBases = character.parts.map((part): CharacterPartTargetBasis => {
    const bounds = characterPartSourceBounds(part, project.animations, project.assets);
    if (!bounds) throw new Error(`Cannot resolve source bounds for Part ${part.partId}.`);
    const sourcePose = multiplyAffineMatrices(character.sourceRootTransform, part.sourceRestTransform ?? part.restTransform);
    for (const x of [bounds.x, bounds.x + bounds.width]) {
      for (const y of [bounds.y, bounds.y + bounds.height]) sourcePosePoints.push(point(sourcePose, x, y));
    }
    return {
      target: { kind: 'character-part', layerId, partId: part.partId },
      visualSource: structuredClone(resolveCharacterPartVisualSource(part)),
      baseTransform: multiplyAffineMatrices(character.sourceRootTransform, part.restTransform),
      pivot: { space: 'target-local', x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
      drawOrder: part.drawOrder, visible: part.visible,
      ...(part.displayName === undefined ? {} : { displayName: part.displayName }),
    };
  });
  const xs = sourcePosePoints.map(p => p.x), ys = sourcePosePoints.map(p => p.y);
  return AnimationClipV0Schema.parse({
    version: 1,
    fixedCharacterCenter: { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 },
    targetBases, tracks: [],
  });
}

export function characterFaceAndMouthPartIds(character: AdaptivePartsCharacter): Set<string> {
  const binding = character.faceBinding;
  return new Set([
    ...(binding ? [binding.targetPartId, ...binding.replacePartIds] : []),
    ...(character.mouthPoseSet?.poses.flatMap(({ target }) => target.kind === 'mouth' ? [target.partId] : []) ?? []),
  ]);
}

/** Overlay owned properties on the instance pose, then carry the head with the authored anchor. */
export function resolveLayeredCharacterPartTransforms(
  clip: AnimationClipV0,
  character: AdaptivePartsCharacter,
  baseValues: readonly EvaluatedAnimationValue[],
  layered: { action: LayeredCharacterAction; localTimeMs: number },
): ReadonlyMap<string, CharacterPartTransform> {
  const layerId = clip.targetBases[0]?.target.layerId;
  if (!layerId) return new Map();
  const protectedParts = characterFaceAndMouthPartIds(character);
  const actionValues: EvaluatedAnimationValue[] = layered.action.tracks
    .filter(({ partId }) => !protectedParts.has(partId))
    .map((track) => ({ target: { kind: 'character-part', layerId, partId: track.partId },
      property: track.property, value: evaluateAnimationTrackAtTime(track, layered.localTimeMs) }));
  const values = [...baseValues, ...actionValues];
  const offsets = new Map(layered.action.partPivotOffsets?.map(({ partId, offset }) => [partId, offset]));
  function calibratedBasis(basis: CharacterPartTargetBasis): CharacterPartTargetBasis {
    const partId = basis.target.partId;
    const offset = offsets.get(partId);
    return offset && !protectedParts.has(partId) ? { ...basis,
      pivot: { ...basis.pivot, x: basis.pivot.x + offset.x, y: basis.pivot.y + offset.y } } : basis;
  }
  const anchor = clip.targetBases.find(({ target }) => target.partId === layered.action.headAnchorPartId);
  let headDelta: CharacterPartTransform | undefined;
  if (anchor && !protectedParts.has(anchor.target.partId)) {
    const before = composeAnimatedCharacterPartTransform(anchor, clip.fixedCharacterCenter, baseValues);
    const inverse = invertAffineMatrix(before);
    if (inverse) {
      const after = composeAnimatedCharacterPartTransform(calibratedBasis(anchor), clip.fixedCharacterCenter, values);
      headDelta = multiplyAffineMatrices(after, inverse);
    }
  }
  const followers = new Set([...protectedParts, ...(character.headMotionBinding?.partIds ?? [])]);
  return new Map(clip.targetBases.map((basis) => {
    const id = basis.target.partId;
    const transform = composeAnimatedCharacterPartTransform(calibratedBasis(basis), clip.fixedCharacterCenter, values);
    return [id, headDelta && id !== anchor?.target.partId && followers.has(id)
      ? multiplyAffineMatrices(headDelta, transform) : transform];
  }));
}

/** Resolve only the frozen instance identity, never current Library Part membership. */
export function resolveCharacterPartAnimationBasis(clip: AnimationClipV0, target: CharacterPartTargetRef): CharacterPartTargetBasis {
  const basis = clip.targetBases.find(entry => sameTarget(entry.target, target));
  if (!basis) throw new Error(`Unknown animation target ${target.layerId}/${target.partId}.`);
  return basis;
}

/** Explicit calibration is permitted only while this target has no non-neutral keys. */
export function recalibrateCharacterPartAnimationPivot(
  clip: AnimationClipV0, target: CharacterPartTargetRef, pivot: TargetLocalPivot,
): AnimationClipV0 {
  resolveCharacterPartAnimationBasis(clip, target);
  const authored = clip.tracks.some(track => sameTarget(track.target, target) && track.keys.some(key =>
    key.value !== (track.property === 'transform.scaleX' || track.property === 'transform.scaleY' ? 1 : 0),
  ));
  if (authored) throw new Error('Animation pivot is fixed after non-neutral animation is authored; clear the target animation before recalibrating.');
  const safePivot = TargetLocalPivotSchema.parse(pivot);
  return { ...clip, targetBases: clip.targetBases.map(basis => sameTarget(basis.target, target) ? { ...basis, pivot: safePivot } : basis) };
}

/**
 * D(pivot in center-local space) * translate(-fixedCenter) * baseTransform.
 * Source-specific crop/frame mapping stays downstream of this common affine.
 * Matrix direction and outgoing absolute-time values follow #979, now with two scales.
 */
export function composeAnimatedCharacterPartTransform(
  basis: CharacterPartTargetBasis,
  fixedCenter: AnimationClipV0['fixedCharacterCenter'],
  values: readonly EvaluatedAnimationValue[],
): CharacterPartTransform {
  let offsetX = 0, offsetY = 0, rotationDeg = 0, scaleX = 1, scaleY = 1;
  for (const entry of values) {
    if (!sameAnimationTarget(entry.target, basis.target)) continue;
    switch (entry.property) {
      case 'transform.offsetX': offsetX = entry.value; break;
      case 'transform.offsetY': offsetY = entry.value; break;
      case 'transform.rotationDeg': rotationDeg = entry.value; break;
      case 'transform.scaleX': scaleX = entry.value; break;
      case 'transform.scaleY': scaleY = entry.value; break;
    }
  }
  const base = { ...basis.baseTransform, tx: basis.baseTransform.tx - fixedCenter.x, ty: basis.baseTransform.ty - fixedCenter.y };
  const pivot = point(base, basis.pivot.x, basis.pivot.y);
  const radians = rotationDeg * Math.PI / 180;
  const a = Math.cos(radians) * scaleX, b = Math.sin(radians) * scaleX;
  const c = -Math.sin(radians) * scaleY, d = Math.cos(radians) * scaleY;
  const result = multiplyAffineMatrices({
    ...IDENTITY, a, b, c, d,
    tx: pivot.x + offsetX - a * pivot.x - c * pivot.y,
    ty: pivot.y + offsetY - b * pivot.x - d * pivot.y,
  }, base);
  const determinant = result.a * result.d - result.b * result.c;
  if (!Object.values(result).every(Number.isFinite) || !Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) {
    throw new Error('Animation produced a non-finite or degenerate Part transform.');
  }
  return result;
}
