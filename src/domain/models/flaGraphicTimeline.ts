import { z } from 'zod';
import type { AffineMatrix2D } from '../../shared/affine-matrix';
import type {
  FlaGraphicStructure,
  FlaGraphicStructureNode,
} from './flaGraphicStructure';

const FiniteNumberSchema = z.number().finite();

export const FlaGraphicTransformEasingSchema = z.enum([
  'linear',
  'ease',
  'hold',
]);

export type FlaGraphicTransformEasing = z.infer<
  typeof FlaGraphicTransformEasingSchema
>;

export const FlaGraphicDecomposedTransformSchema = z
  .object({
    tx: FiniteNumberSchema,
    ty: FiniteNumberSchema,
    rotationDeg: FiniteNumberSchema,
    scaleX: FiniteNumberSchema,
    scaleY: FiniteNumberSchema,
  })
  .strict();

export type FlaGraphicDecomposedTransform = z.infer<
  typeof FlaGraphicDecomposedTransformSchema
>;

export const FlaGraphicTransformKeyframeSchema = z
  .object({
    timeMs: z.number().int().nonnegative(),
    transform: FlaGraphicDecomposedTransformSchema,
    easing: FlaGraphicTransformEasingSchema.default('linear'),
  })
  .strict();

export type FlaGraphicTransformKeyframe = z.infer<
  typeof FlaGraphicTransformKeyframeSchema
>;

export const FlaGraphicTransformTrackSchema = z
  .object({
    trackId: z.string().trim().min(1).max(1_024),
    keyframes: z.array(FlaGraphicTransformKeyframeSchema).min(1).max(2_000),
  })
  .strict()
  .superRefine((track, context) => {
    for (let index = 1; index < track.keyframes.length; index += 1) {
      const prev = track.keyframes[index - 1]!;
      const curr = track.keyframes[index]!;
      if (curr.timeMs <= prev.timeMs) {
        context.addIssue({
          code: 'custom',
          path: ['keyframes', index, 'timeMs'],
          message:
            curr.timeMs === prev.timeMs
              ? 'Keyframe times on a track must be unique.'
              : 'Keyframes on a track must be strictly sorted by timeMs.',
        });
      }
    }
  });

export type FlaGraphicTransformTrack = z.infer<
  typeof FlaGraphicTransformTrackSchema
>;

export const FlaGraphicInternalTimelineSchema = z
  .object({
    tracks: z.array(FlaGraphicTransformTrackSchema).max(1_000),
  })
  .strict()
  .superRefine((timeline, context) => {
    const seen = new Set<string>();
    timeline.tracks.forEach((track, index) => {
      if (seen.has(track.trackId)) {
        context.addIssue({
          code: 'custom',
          path: ['tracks', index, 'trackId'],
          message: 'Timeline trackIds must be unique.',
        });
      }
      seen.add(track.trackId);
    });
  });

export type FlaGraphicInternalTimeline = z.infer<
  typeof FlaGraphicInternalTimelineSchema
>;

export function decomposeAffineMatrix(
  matrix: AffineMatrix2D,
): FlaGraphicDecomposedTransform {
  const scaleX = Math.hypot(matrix.a, matrix.b);
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  const scaleY =
    scaleX > 1e-12 ? determinant / scaleX : Math.hypot(matrix.c, matrix.d);
  const rotationDeg = (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI;
  return {
    tx: matrix.tx,
    ty: matrix.ty,
    rotationDeg: Number.isFinite(rotationDeg) ? rotationDeg : 0,
    scaleX: Number.isFinite(scaleX) ? scaleX : 1,
    scaleY: Number.isFinite(scaleY) ? scaleY : 1,
  };
}

export function composeAffineMatrix(
  transform: FlaGraphicDecomposedTransform,
): AffineMatrix2D {
  const rad = (transform.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    a: transform.scaleX * cos,
    b: transform.scaleX * sin,
    c: -transform.scaleY * sin,
    d: transform.scaleY * cos,
    tx: transform.tx,
    ty: transform.ty,
  };
}

function easeProgress(
  rawProgress: number,
  easing: FlaGraphicTransformEasing,
): number {
  if (easing === 'hold') return 0;
  if (easing === 'linear') return rawProgress;
  return rawProgress < 0.5
    ? 2 * rawProgress * rawProgress
    : 1 - Math.pow(-2 * rawProgress + 2, 2) / 2;
}

function shortestAngleDeltaDeg(fromDeg: number, toDeg: number): number {
  return ((((toDeg - fromDeg) % 360) + 540) % 360) - 180;
}

export function interpolateDecomposedTransform(
  from: FlaGraphicDecomposedTransform,
  to: FlaGraphicDecomposedTransform,
  rawProgress: number,
  easing: FlaGraphicTransformEasing,
): FlaGraphicDecomposedTransform {
  if (rawProgress <= 0 || easing === 'hold') return from;
  if (rawProgress >= 1) return to;
  const t = easeProgress(rawProgress, easing);
  return {
    tx: from.tx + (to.tx - from.tx) * t,
    ty: from.ty + (to.ty - from.ty) * t,
    rotationDeg:
      from.rotationDeg +
      shortestAngleDeltaDeg(from.rotationDeg, to.rotationDeg) * t,
    scaleX: from.scaleX + (to.scaleX - from.scaleX) * t,
    scaleY: from.scaleY + (to.scaleY - from.scaleY) * t,
  };
}

export function evaluateFlaGraphicTrackAtTime(
  track: FlaGraphicTransformTrack,
  internalTimeMs: number,
): AffineMatrix2D | null {
  const { keyframes } = track;
  if (keyframes.length === 0) return null;
  const time = Number.isFinite(internalTimeMs) ? Math.max(0, internalTimeMs) : 0;
  const first = keyframes[0]!;
  if (time <= first.timeMs) return composeAffineMatrix(first.transform);
  const last = keyframes[keyframes.length - 1]!;
  if (time >= last.timeMs) return composeAffineMatrix(last.transform);

  for (let index = 0; index < keyframes.length - 1; index += 1) {
    const start = keyframes[index]!;
    const end = keyframes[index + 1]!;
    if (time === start.timeMs) return composeAffineMatrix(start.transform);
    if (time < end.timeMs) {
      const span = end.timeMs - start.timeMs;
      const rawProgress = span > 0 ? (time - start.timeMs) / span : 1;
      return composeAffineMatrix(
        interpolateDecomposedTransform(
          start.transform,
          end.transform,
          rawProgress,
          start.easing,
        ),
      );
    }
  }
  return composeAffineMatrix(last.transform);
}

export function collectFlaGraphicTimelineDurationMs(
  timeline?: FlaGraphicInternalTimeline | null,
): number {
  if (!timeline) return 0;
  let maxTimeMs = 0;
  for (const track of timeline.tracks) {
    const last = track.keyframes[track.keyframes.length - 1];
    if (last && last.timeMs > maxTimeMs) maxTimeMs = last.timeMs;
  }
  return maxTimeMs;
}

function decomposedEqual(
  left: FlaGraphicDecomposedTransform,
  right: FlaGraphicDecomposedTransform,
): boolean {
  return (
    Math.abs(left.tx - right.tx) <= 1e-6 &&
    Math.abs(left.ty - right.ty) <= 1e-6 &&
    Math.abs(shortestAngleDeltaDeg(left.rotationDeg, right.rotationDeg)) <= 1e-6 &&
    Math.abs(left.scaleX - right.scaleX) <= 1e-6 &&
    Math.abs(left.scaleY - right.scaleY) <= 1e-6
  );
}

function sanitizeTimeMs(timeMs: number): number {
  if (!Number.isFinite(timeMs) || timeMs < 0 || !Number.isSafeInteger(timeMs)) {
    throw new Error('Keyframe timeMs must be a non-negative integer.');
  }
  return timeMs;
}

function withReplacedTrack(
  timeline: FlaGraphicInternalTimeline | undefined,
  trackId: string,
  nextTrack: FlaGraphicTransformTrack | null,
): FlaGraphicInternalTimeline | undefined {
  const existingTracks = timeline?.tracks ?? [];
  const index = existingTracks.findIndex((t) => t.trackId === trackId);
  if (nextTrack === null) {
    if (index < 0) return timeline;
    const nextTracks = existingTracks.filter((_, i) => i !== index);
    return nextTracks.length > 0 ? { tracks: nextTracks } : undefined;
  }
  const nextTracks = [...existingTracks];
  if (index >= 0) nextTracks[index] = nextTrack;
  else nextTracks.push(nextTrack);
  return { tracks: nextTracks };
}

export function addFlaGraphicTimelineKeyframe(
  timeline: FlaGraphicInternalTimeline | undefined,
  trackId: string,
  timeMs: number,
  matrix: AffineMatrix2D,
  easing: FlaGraphicTransformEasing = 'linear',
): FlaGraphicInternalTimeline {
  const validTime = sanitizeTimeMs(timeMs);
  const existingTrack = timeline?.tracks.find((t) => t.trackId === trackId);
  if (existingTrack?.keyframes.some((kf) => kf.timeMs === validTime)) {
    throw new Error(`A keyframe already exists at ${validTime}ms on this track.`);
  }
  const nextKeyframe: FlaGraphicTransformKeyframe = {
    timeMs: validTime,
    transform: decomposeAffineMatrix(matrix),
    easing,
  };
  const nextKeyframes = [...(existingTrack?.keyframes ?? []), nextKeyframe].sort(
    (left, right) => left.timeMs - right.timeMs,
  );
  return withReplacedTrack(timeline, trackId, {
    trackId,
    keyframes: nextKeyframes,
  })!;
}

export function updateFlaGraphicTimelineKeyframeTransform(
  timeline: FlaGraphicInternalTimeline | undefined,
  trackId: string,
  timeMs: number,
  matrix: AffineMatrix2D,
): FlaGraphicInternalTimeline | undefined {
  const validTime = sanitizeTimeMs(timeMs);
  const existingTrack = timeline?.tracks.find((t) => t.trackId === trackId);
  if (!existingTrack) return timeline;
  const kfIndex = existingTrack.keyframes.findIndex((kf) => kf.timeMs === validTime);
  if (kfIndex < 0) return timeline;
  const existingKf = existingTrack.keyframes[kfIndex]!;
  const nextTransform = decomposeAffineMatrix(matrix);
  if (decomposedEqual(existingKf.transform, nextTransform)) return timeline;
  const nextKeyframes = [...existingTrack.keyframes];
  nextKeyframes[kfIndex] = { ...existingKf, transform: nextTransform };
  return withReplacedTrack(timeline, trackId, {
    trackId,
    keyframes: nextKeyframes,
  });
}

export function deleteFlaGraphicTimelineKeyframe(
  timeline: FlaGraphicInternalTimeline | undefined,
  trackId: string,
  timeMs: number,
): FlaGraphicInternalTimeline | undefined {
  const validTime = sanitizeTimeMs(timeMs);
  const existingTrack = timeline?.tracks.find((t) => t.trackId === trackId);
  if (!existingTrack) return timeline;
  const nextKeyframes = existingTrack.keyframes.filter((kf) => kf.timeMs !== validTime);
  if (nextKeyframes.length === existingTrack.keyframes.length) return timeline;
  return withReplacedTrack(
    timeline,
    trackId,
    nextKeyframes.length > 0 ? { trackId, keyframes: nextKeyframes } : null,
  );
}

export function moveFlaGraphicTimelineKeyframe(
  timeline: FlaGraphicInternalTimeline | undefined,
  trackId: string,
  fromTimeMs: number,
  toTimeMs: number,
): FlaGraphicInternalTimeline | undefined {
  const validFrom = sanitizeTimeMs(fromTimeMs);
  const validTo = sanitizeTimeMs(toTimeMs);
  if (validFrom === validTo) return timeline;
  const existingTrack = timeline?.tracks.find((t) => t.trackId === trackId);
  if (!existingTrack) return timeline;
  const sourceKf = existingTrack.keyframes.find((kf) => kf.timeMs === validFrom);
  if (!sourceKf) return timeline;
  if (existingTrack.keyframes.some((kf) => kf.timeMs === validTo)) {
    throw new Error(`Cannot move keyframe onto existing keyframe at ${validTo}ms.`);
  }
  const nextKeyframes = existingTrack.keyframes
    .map((kf) => (kf.timeMs === validFrom ? { ...kf, timeMs: validTo } : kf))
    .sort((left, right) => left.timeMs - right.timeMs);
  return withReplacedTrack(timeline, trackId, {
    trackId,
    keyframes: nextKeyframes,
  });
}

export function duplicateFlaGraphicTimelineKeyframe(
  timeline: FlaGraphicInternalTimeline | undefined,
  trackId: string,
  fromTimeMs: number,
  toTimeMs: number,
): FlaGraphicInternalTimeline | undefined {
  const validFrom = sanitizeTimeMs(fromTimeMs);
  const validTo = sanitizeTimeMs(toTimeMs);
  const existingTrack = timeline?.tracks.find((t) => t.trackId === trackId);
  if (!existingTrack) return timeline;
  const sourceKf = existingTrack.keyframes.find((kf) => kf.timeMs === validFrom);
  if (!sourceKf) return timeline;
  if (existingTrack.keyframes.some((kf) => kf.timeMs === validTo)) {
    throw new Error(`Cannot duplicate keyframe onto existing keyframe at ${validTo}ms.`);
  }
  const nextKeyframes = [
    ...existingTrack.keyframes,
    {
      ...sourceKf,
      timeMs: validTo,
      transform: { ...sourceKf.transform },
    },
  ].sort((left, right) => left.timeMs - right.timeMs);
  return withReplacedTrack(timeline, trackId, {
    trackId,
    keyframes: nextKeyframes,
  });
}

export function setFlaGraphicTimelineKeyframeEasing(
  timeline: FlaGraphicInternalTimeline | undefined,
  trackId: string,
  timeMs: number,
  easing: FlaGraphicTransformEasing,
): FlaGraphicInternalTimeline | undefined {
  const validTime = sanitizeTimeMs(timeMs);
  const existingTrack = timeline?.tracks.find((t) => t.trackId === trackId);
  if (!existingTrack) return timeline;
  const kfIndex = existingTrack.keyframes.findIndex((kf) => kf.timeMs === validTime);
  if (kfIndex < 0) return timeline;
  const existingKf = existingTrack.keyframes[kfIndex]!;
  if (existingKf.easing === easing) return timeline;
  const nextKeyframes = [...existingTrack.keyframes];
  nextKeyframes[kfIndex] = { ...existingKf, easing };
  return withReplacedTrack(timeline, trackId, {
    trackId,
    keyframes: nextKeyframes,
  });
}

export interface FlaGraphicTimelineTargetInfo {
  readonly ownerKind: 'frame' | 'symbol';
  readonly ownerSymbolDefId: string | null;
  readonly trackId: string | null;
  readonly targetNode: FlaGraphicStructureNode;
  readonly timeline: FlaGraphicInternalTimeline | undefined;
}

function countSourceAddressInNodes(
  nodes: readonly FlaGraphicStructureNode[],
  sourceAddress: string,
): number {
  let count = 0;
  for (const node of nodes) {
    if (node.sourceAddress === sourceAddress) count += 1;
    if (node.type === 'group') {
      count += countSourceAddressInNodes(node.children, sourceAddress);
    } else if (node.type === 'symbol' && !node.nestedDefinitionId && node.children) {
      count += countSourceAddressInNodes(node.children, sourceAddress);
    }
  }
  return count;
}

/**
 * Resolves the stable cross-frame/cross-time track identity for a node at
 * `nodePath`. Returns `trackId: null` when the node is `opaque` or its
 * cross-frame identity cannot be proven without guessing.
 */
export function resolveFlaGraphicStableNodeIdentity(
  node: FlaGraphicStructureNode,
  structure: FlaGraphicStructure,
  ownerKind: 'frame' | 'symbol',
  ownerSymbolDefId: string | null,
  containerRootNodes: readonly FlaGraphicStructureNode[],
): string | null {
  if (node.type === 'opaque') return null;
  const trimmedAddr = node.sourceAddress?.trim();
  if (trimmedAddr) {
    const occurrences = countSourceAddressInNodes(containerRootNodes, trimmedAddr);
    return occurrences === 1 ? `addr:${trimmedAddr}` : null;
  }
  if (ownerKind === 'symbol' && ownerSymbolDefId) {
    return `sym:${ownerSymbolDefId}:${node.id}`;
  }
  if (structure.frames.length === 1) {
    return `node:${node.id}`;
  }
  return null;
}

/**
 * Resolves the owning timeline container and stable track identity for
 * `nodePath` in `structure` at `frameOrdinal`.
 */
export function resolveFlaGraphicTimelineTarget(
  structure: FlaGraphicStructure,
  frameOrdinal: number,
  nodePath: readonly string[],
): FlaGraphicTimelineTargetInfo | null {
  if (!Number.isSafeInteger(frameOrdinal) || frameOrdinal < 0 || nodePath.length === 0) {
    return null;
  }
  const frame = structure.frames.find((candidate) => candidate.ordinal === frameOrdinal);
  if (!frame) return null;

  let ownerKind: 'frame' | 'symbol' = 'frame';
  let ownerSymbolDefId: string | null = null;
  let containerRootNodes: readonly FlaGraphicStructureNode[] = frame.layers.flatMap(
    (layer) => layer.nodes,
  );
  let searchNodes = containerRootNodes;
  let targetNode: FlaGraphicStructureNode | undefined;

  for (let i = 0; i < nodePath.length; i += 1) {
    const nodeId = nodePath[i]!;
    targetNode = searchNodes.find((node) => node.id === nodeId);
    if (!targetNode) return null;
    if (i < nodePath.length - 1) {
      if (targetNode.type === 'group') {
        searchNodes = targetNode.children;
      } else if (targetNode.type === 'symbol') {
        if (targetNode.nestedDefinitionId) {
          const def = structure.symbolDefinitions?.[targetNode.nestedDefinitionId];
          if (!def) return null;
          ownerKind = 'symbol';
          ownerSymbolDefId = targetNode.nestedDefinitionId;
          containerRootNodes = def.children;
          searchNodes = def.children;
        } else {
          searchNodes = targetNode.children ?? [];
        }
      } else {
        return null;
      }
    }
  }

  if (!targetNode) return null;
  const trackId = resolveFlaGraphicStableNodeIdentity(
    targetNode,
    structure,
    ownerKind,
    ownerSymbolDefId,
    containerRootNodes,
  );
  const timeline =
    ownerKind === 'symbol' && ownerSymbolDefId
      ? structure.symbolDefinitions?.[ownerSymbolDefId]?.timeline
      : structure.timeline;
  return {
    ownerKind,
    ownerSymbolDefId,
    trackId,
    targetNode,
    timeline,
  };
}

export function withFlaGraphicContainerTimeline(
  structure: FlaGraphicStructure,
  target: Pick<FlaGraphicTimelineTargetInfo, 'ownerKind' | 'ownerSymbolDefId' | 'timeline'>,
  nextTimeline: FlaGraphicInternalTimeline | undefined,
): FlaGraphicStructure {
  if (nextTimeline === target.timeline) return structure;
  if (target.ownerKind === 'symbol' && target.ownerSymbolDefId) {
    const def = structure.symbolDefinitions?.[target.ownerSymbolDefId];
    if (!def) return structure;
    const nextDef = { ...def };
    delete nextDef.timeline;
    if (nextTimeline) nextDef.timeline = nextTimeline;
    return {
      ...structure,
      symbolDefinitions: {
        ...structure.symbolDefinitions,
        [target.ownerSymbolDefId]: nextDef,
      },
    };
  }
  const nextStructure = { ...structure };
  delete nextStructure.timeline;
  if (nextTimeline) nextStructure.timeline = nextTimeline;
  return nextStructure;
}
