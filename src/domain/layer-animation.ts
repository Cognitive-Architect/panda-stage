import type { EvaluatedAnimationValue } from './evaluate-animation-core';
import {
  evaluateTargetMotionValues,
  type AnimationMotionValues,
} from './animation-track-ops';
import { isFlaGraphicDefinition } from './models/animation';
import {
  LayerAnimationClipSchema,
  TargetLocalPivotSchema,
  sameAnimationTarget,
  type LayerAnimationClip,
  type LayerTargetBasis,
  type LayerTargetRef,
  type TargetLocalPivot,
} from './models/animationCore';
import type { Project } from './models/project';

export interface LayerBasePose {
  readonly x: number;
  readonly y: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly rotationDeg: number;
}

/** Freeze a Layer Instance's static transform and source-canvas center pivot into Clip v2. */
export function createLayerAnimationClip(
  project: Project,
  shotId: string,
  layerId: string,
): LayerAnimationClip {
  const layer = project.shots
    .find((shot) => shot.id === shotId)
    ?.layers.find((entry) => entry.id === layerId);
  if (!layer || layer.source.kind !== 'animation') {
    throw new Error('对象动作关键帧需要普通动画图层。');
  }
  const animationId = layer.source.animationId;
  const definition = project.animations.find(
    (entry) => entry.id === animationId,
  );
  if (!definition || !isFlaGraphicDefinition(definition)) {
    throw new Error('对象动作关键帧仅支持 FLA 图形（Graphic）图层。');
  }
  if (layer.animationClip) {
    if (layer.animationClip.version !== 2) {
      throw new Error('当前图层动画容器不是 Layer Clip v2。');
    }
    return structuredClone(layer.animationClip);
  }
  return LayerAnimationClipSchema.parse({
    version: 2,
    targetBases: [
      {
        target: { kind: 'layer', layerId },
        animationId: definition.id,
        baseTransform: {
          x: layer.x,
          y: layer.y,
          scaleX: layer.scaleX,
          scaleY: layer.scaleY,
          rotationDeg: layer.rotationDeg,
        },
        sourceCanvas: {
          width: definition.source.canvas.width,
          height: definition.source.canvas.height,
        },
        pivot: {
          space: 'target-local',
          x: definition.source.canvas.width / 2,
          y: definition.source.canvas.height / 2,
        },
      },
    ],
    tracks: [],
  });
}

export function resolveLayerAnimationBasis(
  clip: LayerAnimationClip,
  target: LayerTargetRef,
): LayerTargetBasis {
  const basis = clip.targetBases.find((entry) =>
    sameAnimationTarget(entry.target, target),
  );
  if (!basis) {
    throw new Error(`Unknown Layer animation target ${target.layerId}.`);
  }
  return basis;
}

/** Recalibrating the frozen pivot is allowed only before non-neutral keys are authored. */
export function layerHasNonNeutralMotion(clip: LayerAnimationClip, target: LayerTargetRef): boolean {
  return clip.tracks.some(
    (track) =>
      sameAnimationTarget(track.target, target) &&
      track.keys.some(
        (key) =>
          key.value !==
          (track.property === 'transform.scaleX' ||
          track.property === 'transform.scaleY'
            ? 1
            : 0),
      ),
  );
}

export function recalibrateLayerAnimationPivot(
  clip: LayerAnimationClip,
  target: LayerTargetRef,
  pivot: TargetLocalPivot,
): LayerAnimationClip {
  resolveLayerAnimationBasis(clip, target);
  if (layerHasNonNeutralMotion(clip, target)) {
    throw new Error(
      'Animation pivot is fixed after non-neutral animation is authored; clear the target animation before recalibrating.',
    );
  }
  const safePivot = TargetLocalPivotSchema.parse(pivot);
  return {
    ...clip,
    targetBases: clip.targetBases.map((basis) =>
      sameAnimationTarget(basis.target, target)
        ? { ...basis, pivot: safePivot }
        : basis,
    ),
  };
}

export function syncLayerAnimationClipBasis(
  clip: LayerAnimationClip,
  layerId: string,
  baseTransform: LayerBasePose,
): LayerAnimationClip {
  return LayerAnimationClipSchema.parse({
    ...clip,
    targetBases: clip.targetBases.map((basis) =>
      basis.target.layerId === layerId
        ? {
            ...basis,
            baseTransform: {
              x: baseTransform.x,
              y: baseTransform.y,
              scaleX: baseTransform.scaleX,
              scaleY: baseTransform.scaleY,
              rotationDeg: baseTransform.rotationDeg,
            },
          }
        : basis,
    ),
  });
}

/** Deep-clone a Layer Clip v2 for a duplicated Layer, remapping target ownership and syncing its baseTransform. */
export function duplicateLayerAnimationClip(
  clip: LayerAnimationClip,
  targetLayerId: string,
  baseTransform: LayerBasePose,
): LayerAnimationClip {
  const cloned = structuredClone(clip);
  const remapped: LayerAnimationClip = {
    ...cloned,
    targetBases: cloned.targetBases.map((basis) => ({
      ...basis,
      target: { ...basis.target, layerId: targetLayerId },
    })),
    tracks: cloned.tracks.map((track) => ({
      ...track,
      target: { ...track.target, layerId: targetLayerId },
    })),
  };
  return syncLayerAnimationClipBasis(remapped, targetLayerId, baseTransform);
}

/** Center-anchor mapping from target-local source-canvas coordinates to Layer-local space. */
export function layerPivotLocalOffset(
  pivot: TargetLocalPivot,
  sourceCanvas: { readonly width: number; readonly height: number },
): { readonly x: number; readonly y: number } {
  return {
    x: pivot.x - sourceCanvas.width / 2,
    y: pivot.y - sourceCanvas.height / 2,
  };
}

/** Stage offset from the Layer anchor to `localPivot` under `(rotationDeg, scaleX, scaleY, flipX)`. */
export function layerPivotStageVector(
  localPivot: { readonly x: number; readonly y: number },
  rotationDeg: number,
  scaleX: number,
  scaleY: number,
  flipX: boolean,
): { readonly x: number; readonly y: number } {
  if (localPivot.x === 0 && localPivot.y === 0) {
    return { x: 0, y: 0 };
  }
  const signedScaleX = flipX ? -scaleX : scaleX;
  const radians = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const px = signedScaleX * localPivot.x;
  const py = scaleY * localPivot.y;
  return {
    x: px * cos - py * sin,
    y: px * sin + py * cos,
  };
}

function motionValuesFromEvaluated(
  target: LayerTargetRef,
  values: readonly EvaluatedAnimationValue[],
): AnimationMotionValues {
  let offsetX = 0;
  let offsetY = 0;
  let rotationDeg = 0;
  let scaleX = 1;
  let scaleY = 1;
  for (const entry of values) {
    if (!sameAnimationTarget(entry.target, target)) continue;
    switch (entry.property) {
      case 'transform.offsetX':
        offsetX = entry.value;
        break;
      case 'transform.offsetY':
        offsetY = entry.value;
        break;
      case 'transform.rotationDeg':
        rotationDeg = entry.value;
        break;
      case 'transform.scaleX':
        scaleX = entry.value;
        break;
      case 'transform.scaleY':
        scaleY = entry.value;
        break;
    }
  }
  return {
    'transform.offsetX': offsetX,
    'transform.offsetY': offsetY,
    'transform.rotationDeg': rotationDeg,
    'transform.scaleX': scaleX,
    'transform.scaleY': scaleY,
  };
}

/**
 * Compose relative Layer Track values onto a pre-track Layer pose
 * (`Static/Basis -> legacy Move/Scale -> legacy Shake`) around the frozen pivot.
 */
export function composeAnimatedLayerTransform(
  basis: LayerTargetBasis,
  preTrackPose: LayerBasePose,
  flipX: boolean,
  values: readonly EvaluatedAnimationValue[],
): LayerBasePose {
  const motion = motionValuesFromEvaluated(basis.target, values);
  const rotationDeg =
    preTrackPose.rotationDeg + motion['transform.rotationDeg'];
  const scaleX = preTrackPose.scaleX * motion['transform.scaleX'];
  const scaleY = preTrackPose.scaleY * motion['transform.scaleY'];
  const localPivot = layerPivotLocalOffset(basis.pivot, basis.sourceCanvas);
  const vBase = layerPivotStageVector(
    localPivot,
    preTrackPose.rotationDeg,
    preTrackPose.scaleX,
    preTrackPose.scaleY,
    flipX,
  );
  const vFinal = layerPivotStageVector(
    localPivot,
    rotationDeg,
    scaleX,
    scaleY,
    flipX,
  );
  const x = preTrackPose.x + vBase.x + motion['transform.offsetX'] - vFinal.x;
  const y = preTrackPose.y + vBase.y + motion['transform.offsetY'] - vFinal.y;
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(rotationDeg) ||
    !Number.isFinite(scaleX) ||
    !Number.isFinite(scaleY) ||
    scaleX <= 0 ||
    scaleY <= 0
  ) {
    throw new Error('Animation produced a non-finite or degenerate Layer transform.');
  }
  return { x, y, scaleX, scaleY, rotationDeg };
}

/** Back-solve relative Layer Track offsetX/Y for a desired stage anchor point under pivot/rotation/scale/flipX. */
export function solveLayerRelativeOffsetForStagePoint(
  localPivot: { readonly x: number; readonly y: number },
  prePose: LayerBasePose,
  flipX: boolean,
  relRotationDeg: number,
  relScaleX: number,
  relScaleY: number,
  stagePoint: { readonly x?: number; readonly y?: number },
): { readonly offsetX?: number; readonly offsetY?: number } {
  const vBase = layerPivotStageVector(
    localPivot,
    prePose.rotationDeg,
    prePose.scaleX,
    prePose.scaleY,
    flipX,
  );
  const vFinal = layerPivotStageVector(
    localPivot,
    prePose.rotationDeg + relRotationDeg,
    prePose.scaleX * relScaleX,
    prePose.scaleY * relScaleY,
    flipX,
  );
  return {
    ...(stagePoint.x !== undefined
      ? { offsetX: stagePoint.x - prePose.x + vFinal.x - vBase.x }
      : {}),
    ...(stagePoint.y !== undefined
      ? { offsetY: stagePoint.y - prePose.y + vFinal.y - vBase.y }
      : {}),
  };
}

/** Read current relative Layer motion values at `timeMs` without allocating a Clip. */
export function evaluateLayerRelativeMotionValues(
  clip: LayerAnimationClip | undefined,
  layerId: string,
  timeMs: number,
): AnimationMotionValues {
  return evaluateTargetMotionValues(
    clip?.tracks ?? [],
    { kind: 'layer', layerId },
    timeMs,
  );
}
