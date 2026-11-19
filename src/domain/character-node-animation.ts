import {
  evaluateTargetMotionValues,
  NEUTRAL_ANIMATION_MOTION,
  type AnimationMotionValues,
} from './animation-track-ops';
import type { EvaluatedAnimationValue } from './evaluate-animation-core';
import { layerPivotStageVector } from './layer-animation';
import {
  CharacterNodeAnimationClipSchema,
  sameAnimationTarget,
  type CharacterNodeAnimationClip,
  type CharacterNodeId,
  type CharacterNodeTargetBasis,
  type CharacterNodeTargetRef,
} from './models/animationCore';
import type { Character } from './models/character';
import type { Layer } from './models/layer';
import type { Project } from './models/project';

export interface CharacterNodeTransformCapabilities {
  readonly position: boolean;
  readonly rotation: boolean;
  readonly uniformScale: boolean;
}

export const NO_CHARACTER_NODE_TRANSFORM_CAPABILITIES: Readonly<CharacterNodeTransformCapabilities> =
  Object.freeze({
    position: false,
    rotation: false,
    uniformScale: false,
  });

export const CHARACTER_NODE_MOTION_CAPABILITIES: Readonly<CharacterNodeTransformCapabilities> =
  Object.freeze({
    position: true,
    rotation: true,
    uniformScale: true,
  });

export interface EvaluatedCharacterNodePose {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly rotationDeg: number;
  readonly flipX: boolean;
}

/**
 * Minimal structure-derived transform capability lookup for V1-B.
 * Only Composite `face` (Clip v3) and Adaptive `part:*` (Clip v1) expose
 * node-level position, rotation, and uniform scale.
 */
export function characterNodeTransformCapabilities(
  character: Pick<Character, 'mode'> | undefined,
  nodeId: CharacterNodeId | string | null | undefined,
): CharacterNodeTransformCapabilities {
  if (!character || !nodeId) {
    return NO_CHARACTER_NODE_TRANSFORM_CAPABILITIES;
  }
  if (character.mode === 'composite' && nodeId === 'face') {
    return CHARACTER_NODE_MOTION_CAPABILITIES;
  }
  if (character.mode === 'adaptive-parts' && nodeId.startsWith('part:')) {
    return CHARACTER_NODE_MOTION_CAPABILITIES;
  }
  return NO_CHARACTER_NODE_TRANSFORM_CAPABILITIES;
}

export function characterNodeTargetRef(
  layerId: string,
  nodeId: CharacterNodeId,
): CharacterNodeTargetRef {
  return { kind: 'character-node', layerId, nodeId };
}

export function createCharacterNodeBasisForFace(
  character: Extract<Character, { mode: 'composite' }>,
  layerId: string,
): CharacterNodeTargetBasis {
  return {
    target: characterNodeTargetRef(layerId, 'face'),
    baseTransform: {
      x: character.facePlacement.offsetX,
      y: character.facePlacement.offsetY,
      scaleX: character.facePlacement.scale,
      scaleY: character.facePlacement.scale,
      rotationDeg: character.facePlacement.rotationDeg,
    },
    pivot: {
      space: 'target-local',
      x: 0,
      y: 0,
    },
  };
}

/** Create or clone a Clip v3 on a composite Character Layer, ensuring the `face` basis exists. */
export function createCharacterNodeFaceAnimationClip(
  project: Project,
  shotId: string,
  layerId: string,
): CharacterNodeAnimationClip {
  const layer = project.shots
    .find((shot) => shot.id === shotId)
    ?.layers.find((entry) => entry.id === layerId);
  if (!layer || layer.source.kind !== 'character') {
    throw new Error('角色节点动作需要角色图层。');
  }
  const characterId = layer.source.characterId;
  const character = project.characters.find((entry) => entry.id === characterId);
  if (!character || character.mode !== 'composite') {
    throw new Error('脸部节点动作仅支持组合角色。');
  }
  const target = characterNodeTargetRef(layerId, 'face');
  if (layer.animationClip) {
    if (layer.animationClip.version !== 3) {
      throw new Error('角色节点动作需要 Character Node Clip v3。');
    }
    const cloned = structuredClone(layer.animationClip);
    if (resolveCharacterNodeBasis(cloned, target)) {
      return cloned;
    }
    return CharacterNodeAnimationClipSchema.parse({
      ...cloned,
      targetBases: [
        ...cloned.targetBases,
        createCharacterNodeBasisForFace(character, layerId),
      ],
    });
  }
  return CharacterNodeAnimationClipSchema.parse({
    version: 3,
    targetBases: [createCharacterNodeBasisForFace(character, layerId)],
    tracks: [],
  });
}

export function resolveCharacterNodeBasis(
  clip: CharacterNodeAnimationClip,
  target: CharacterNodeTargetRef,
): CharacterNodeTargetBasis | undefined {
  return clip.targetBases.find((entry) =>
    sameAnimationTarget(entry.target, target),
  );
}

function motionValuesFromEvaluated(
  target: CharacterNodeTargetRef,
  values: readonly EvaluatedAnimationValue[],
): AnimationMotionValues {
  const result: AnimationMotionValues = { ...NEUTRAL_ANIMATION_MOTION };
  for (const entry of values) {
    if (!sameAnimationTarget(entry.target, target)) continue;
    result[entry.property] = entry.value;
  }
  return result;
}

/** Compose a Character Node target basis with its relative Property Track motion. */
export function composeCharacterNodeTransform(
  basis: CharacterNodeTargetBasis,
  motion: AnimationMotionValues,
  flipX = false,
): EvaluatedCharacterNodePose {
  const rotationDeg =
    basis.baseTransform.rotationDeg + motion['transform.rotationDeg'];
  const scaleX = basis.baseTransform.scaleX * motion['transform.scaleX'];
  const scaleY = basis.baseTransform.scaleY * motion['transform.scaleY'];
  const samePivotOrientation =
    rotationDeg === basis.baseTransform.rotationDeg &&
    scaleX === basis.baseTransform.scaleX &&
    scaleY === basis.baseTransform.scaleY;
  const localPivot = { x: basis.pivot.x, y: basis.pivot.y };
  const vDelta = samePivotOrientation
    ? { x: 0, y: 0 }
    : (() => {
        const vBase = layerPivotStageVector(
          localPivot,
          basis.baseTransform.rotationDeg,
          basis.baseTransform.scaleX,
          basis.baseTransform.scaleY,
          flipX,
        );
        const vFinal = layerPivotStageVector(
          localPivot,
          rotationDeg,
          scaleX,
          scaleY,
          flipX,
        );
        return { x: vBase.x - vFinal.x, y: vBase.y - vFinal.y };
      })();
  const offsetX =
    basis.baseTransform.x + motion['transform.offsetX'] + vDelta.x;
  const offsetY =
    basis.baseTransform.y + motion['transform.offsetY'] + vDelta.y;
  if (
    !Number.isFinite(offsetX) ||
    !Number.isFinite(offsetY) ||
    !Number.isFinite(rotationDeg) ||
    !Number.isFinite(scaleX) ||
    !Number.isFinite(scaleY) ||
    scaleX <= 0 ||
    scaleY <= 0
  ) {
    throw new Error('角色节点动作产生了非法的变换结果。');
  }
  return {
    offsetX,
    offsetY,
    scaleX,
    scaleY,
    rotationDeg,
    flipX,
  };
}

/** Back-solve sparse relative Property Track deltas from a target evaluated node pose. */
export function backSolveCharacterNodeRelativeMotion(
  basis: CharacterNodeTargetBasis,
  flipX: boolean,
  currentRel: AnimationMotionValues,
  currentPose: EvaluatedCharacterNodePose,
  targetPose: Partial<Omit<EvaluatedCharacterNodePose, 'flipX'>>,
): Partial<AnimationMotionValues> {
  const nextRotationDeg =
    targetPose.rotationDeg ?? currentPose.rotationDeg;
  const nextScaleX = targetPose.scaleX ?? currentPose.scaleX;
  const nextScaleY = targetPose.scaleY ?? currentPose.scaleY;
  const nextOffsetX = targetPose.offsetX ?? currentPose.offsetX;
  const nextOffsetY = targetPose.offsetY ?? currentPose.offsetY;

  const localPivot = { x: basis.pivot.x, y: basis.pivot.y };
  const vCurrent = layerPivotStageVector(
    localPivot,
    currentPose.rotationDeg,
    currentPose.scaleX,
    currentPose.scaleY,
    flipX,
  );
  const vFinal = layerPivotStageVector(
    localPivot,
    nextRotationDeg,
    nextScaleX,
    nextScaleY,
    flipX,
  );

  const nextRelOffsetX =
    currentRel['transform.offsetX'] +
    (nextOffsetX - currentPose.offsetX) +
    (vFinal.x - vCurrent.x);
  const nextRelOffsetY =
    currentRel['transform.offsetY'] +
    (nextOffsetY - currentPose.offsetY) +
    (vFinal.y - vCurrent.y);
  const nextRelRotationDeg =
    nextRotationDeg === currentPose.rotationDeg
      ? currentRel['transform.rotationDeg']
      : nextRotationDeg - basis.baseTransform.rotationDeg;
  const nextRelScaleX =
    nextScaleX === currentPose.scaleX
      ? currentRel['transform.scaleX']
      : nextScaleX / basis.baseTransform.scaleX;
  const nextRelScaleY =
    nextScaleY === currentPose.scaleY
      ? currentRel['transform.scaleY']
      : nextScaleY / basis.baseTransform.scaleY;

  const changes: Partial<AnimationMotionValues> = {};
  if (nextRelOffsetX !== currentRel['transform.offsetX']) {
    changes['transform.offsetX'] = nextRelOffsetX;
  }
  if (nextRelOffsetY !== currentRel['transform.offsetY']) {
    changes['transform.offsetY'] = nextRelOffsetY;
  }
  if (targetPose.rotationDeg !== undefined && nextRotationDeg !== currentPose.rotationDeg) {
    changes['transform.rotationDeg'] = nextRelRotationDeg;
  }
  if (targetPose.scaleX !== undefined && nextScaleX !== currentPose.scaleX) {
    changes['transform.scaleX'] = nextRelScaleX;
  }
  if (targetPose.scaleY !== undefined && nextScaleY !== currentPose.scaleY) {
    changes['transform.scaleY'] = nextRelScaleY;
  }
  return changes;
}

/**
 * Evaluate the transient Composite Face pose at `timeMs` following the single order:
 * `Static FacePlacement / persisted Basis -> Character Node v3 motion`.
 */
export function evaluateCompositeFacePoseAtTime(
  project: Project,
  layer: Layer,
  timeMs: number,
  evaluatedValues?: readonly EvaluatedAnimationValue[],
): EvaluatedCharacterNodePose | null {
  if (layer.source.kind !== 'character') return null;
  const characterId = layer.source.characterId;
  const character = project.characters.find(
    (candidate) => candidate.id === characterId,
  );
  if (!character || character.mode !== 'composite') return null;

  const clip = layer.animationClip?.version === 3 ? layer.animationClip : undefined;
  const target = characterNodeTargetRef(layer.id, 'face');
  const basis = clip ? resolveCharacterNodeBasis(clip, target) : undefined;
  if (clip && basis) {
    const motion = evaluatedValues
      ? motionValuesFromEvaluated(target, evaluatedValues)
      : evaluateTargetMotionValues(clip.tracks, target, timeMs);
    return composeCharacterNodeTransform(
      basis,
      motion,
      character.facePlacement.flipX,
    );
  }

  return {
    offsetX: character.facePlacement.offsetX,
    offsetY: character.facePlacement.offsetY,
    scaleX: character.facePlacement.scale,
    scaleY: character.facePlacement.scale,
    rotationDeg: character.facePlacement.rotationDeg,
    flipX: character.facePlacement.flipX,
  };
}
