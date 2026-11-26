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
  type AnimationClip,
  type LayerAnimationClip,
  type LayerTargetBasis,
  type LayerTargetRef,
  type TargetLocalPivot,
} from './models/animationCore';
import type { Project } from './models/project';
import type { Layer } from './models/layer';

export interface LayerBasePose {
  readonly x: number;
  readonly y: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly rotationDeg: number;
}

export function canAuthorLayerRootMotion(layer: Layer): boolean {
  return Boolean(
    layer.source.kind === 'control' ||
    layer.parentLayerId ||
    layer.parentSpaceOffset ||
    layer.parentKeys?.length ||
    layer.layerMotionTracks?.length ||
    layer.depth !== undefined ||
    layer.depthKeys?.length ||
    layer.cameraSpace === 'screen',
  );
}

export function findLayerMotionGraphic(project: Project, layer: Layer) {
  const source = layer.source;
  if (source.kind !== 'animation') return undefined;
  const definition = project.animations.find(({ id }) => id === source.animationId);
  return definition && isFlaGraphicDefinition(definition) ? definition : undefined;
}

/** A centered working basis lets ordinary Layer roots reuse the existing track operations. */
function centeredLayerMotionClip(layer: Layer): LayerAnimationClip {
  const { id, x, y, scaleX, scaleY, rotationDeg } = layer;
  return {
    version: 2,
    targetBases: [{
      target: { kind: 'layer', layerId: id },
      animationId: id,
      baseTransform: { x, y, scaleX, scaleY, rotationDeg },
      sourceCanvas: { width: 2, height: 2 },
      pivot: { space: 'target-local', x: 1, y: 1 },
    }],
    tracks: [...(layer.layerMotionTracks ?? [])],
  };
}

export function layerRootMotionClip(layer: Layer): LayerAnimationClip | undefined {
  if (layer.animationClip?.version === 2) return layer.animationClip;
  return layer.layerMotionTracks?.length ? centeredLayerMotionClip(layer) : undefined;
}

export function remapLayerMotionOwner(layer: Layer, layerId: string): Pick<Layer, 'animationClip' | 'layerMotionTracks'> {
  const remap = <T extends { target: { layerId: string } }>(entry: T): T => ({
    ...entry, target: { ...entry.target, layerId },
  });
  const remapClip = (clip: AnimationClip): AnimationClip => {
    switch (clip.version) {
      case 1: return { ...clip, targetBases: clip.targetBases.map(remap), tracks: clip.tracks.map(remap) };
      case 2: return { ...clip, targetBases: clip.targetBases.map(remap), tracks: clip.tracks.map(remap) };
      case 3: return { ...clip, targetBases: clip.targetBases.map(remap), tracks: clip.tracks.map(remap) };
    }
  };
  return {
    ...(layer.animationClip ? { animationClip: remapClip(layer.animationClip) } : {}),
    ...(layer.layerMotionTracks ? { layerMotionTracks: layer.layerMotionTracks.map(remap) } : {}),
  };
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
  const definition = layer && findLayerMotionGraphic(project, layer);
  if (layer && !definition && canAuthorLayerRootMotion(layer)) return centeredLayerMotionClip(layer);
  if (!layer || layer.source.kind !== 'animation') {
    throw new Error('对象动作关键帧需要普通动画图层。');
  }
  if (!definition) {
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
export function recalibrateLayerAnimationPivot(
  clip: LayerAnimationClip,
  target: LayerTargetRef,
  pivot: TargetLocalPivot,
): LayerAnimationClip {
  resolveLayerAnimationBasis(clip, target);
  const authored = clip.tracks.some(
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
  if (authored) {
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
