import { z } from 'zod';
import {
  FlaEditableShapeRegionSchema,
  computeFlaShapeRegionBounds,
  type FlaEditableShapeRegion,
  type FlaVectorContour,
} from '../fla-shape-vector';
import {
  interpolateShapeMorphPair,
  prepareShapeMorphPair,
  type ShapeMorphFailureCode,
  type ShapeMorphPrepareResult,
} from '../geometry/shapeMorph';
import type { FlaGraphicStructure } from './flaGraphicStructure';

/**
 * Author-created native Shape Tween track (issue #1457 F02).
 *
 * Stored on the FLA Graphic Structure as an additive optional collection, so a
 * tween survives Project save/reopen, is shared by every instance of the
 * Graphic Definition, and never rewrites the source-baked FLA morph data.
 *
 * A track owns one stable editable Shape region across the internal Graphic
 * clock: two authored closed-contour poses plus start/end internal time and an
 * easing. Evaluation lerps prepared geometry; the source structure's stored
 * region geometry is never mutated.
 */

export const FLA_SHAPE_TWEEN_MAX_TRACKS = 512;
export const FLA_SHAPE_TWEEN_MAX_OWNER_PATH_DEPTH = 64;

export const FlaShapeTweenEasingSchema = z.enum(['linear', 'ease', 'hold']);
export type FlaShapeTweenEasing = z.infer<typeof FlaShapeTweenEasingSchema>;

const FlaShapeTweenOwnerPathSegmentSchema = z.string().trim().min(1).max(1_000);

/**
 * Stable target identity: the same internal-timeline node identity used by
 * transform tracks, plus the region identity inside that node's Shape override.
 * `sourceFrameOrdinal` / `sourceNodePath` are a resolution hint used to recover
 * the authored node override on source frames that do not carry one; the
 * stable identity remains authoritative.
 */
export const FlaShapeTweenTargetV1Schema = z
  .object({
    nodeTrackId: z.string().trim().min(1).max(1_024),
    ownerKind: z.enum(['frame', 'symbol']),
    ownerSymbolDefId: z.string().trim().min(1).max(1_000).optional(),
    regionRef: z.string().trim().min(1).max(128),
    sourceFrameOrdinal: z.number().int().nonnegative(),
    sourceNodePath: z
      .array(FlaShapeTweenOwnerPathSegmentSchema)
      .min(1)
      .max(FLA_SHAPE_TWEEN_MAX_OWNER_PATH_DEPTH),
  })
  .strict()
  .superRefine((target, context) => {
    if (target.ownerKind === 'symbol' && !target.ownerSymbolDefId) {
      context.addIssue({
        code: 'custom',
        path: ['ownerSymbolDefId'],
        message: 'Symbol-owned shape tweens require their symbol definition id.',
      });
    }
    if (target.ownerKind === 'frame' && target.ownerSymbolDefId) {
      context.addIssue({
        code: 'custom',
        path: ['ownerSymbolDefId'],
        message: 'Frame-owned shape tweens must not carry a symbol definition id.',
      });
    }
  });

export type FlaShapeTweenTarget = z.infer<typeof FlaShapeTweenTargetV1Schema>;

const FlaShapeTweenTrackV1Schema = z
  .object({
    tweenId: z.string().trim().min(1).max(1_024),
    target: FlaShapeTweenTargetV1Schema,
    /** Internal Graphic clock time where the authored `from` pose is exact. */
    startTimeMs: z.number().int().nonnegative(),
    /** Internal Graphic clock time where the authored `to` pose is exact. */
    endTimeMs: z.number().int().positive(),
    easing: FlaShapeTweenEasingSchema.default('linear'),
    from: FlaEditableShapeRegionSchema,
    to: FlaEditableShapeRegionSchema,
  })
  .strict()
  .superRefine((track, context) => {
    if (track.endTimeMs <= track.startTimeMs) {
      context.addIssue({
        code: 'custom',
        path: ['endTimeMs'],
        message: 'A shape tween must end after it starts.',
      });
    }
  });

export type FlaShapeTweenTrack = z.infer<typeof FlaShapeTweenTrackV1Schema>;

export const FlaShapeTweenTrackSchema = FlaShapeTweenTrackV1Schema;
export const FlaShapeTweenTargetSchema = FlaShapeTweenTargetV1Schema;

/** Stable uniqueness key for a tween target (one tween per region). */
export function flaShapeTweenTargetKey(target: FlaShapeTweenTarget): string {
  return JSON.stringify([
    target.ownerKind,
    target.ownerSymbolDefId ?? '',
    target.nodeTrackId,
    target.regionRef,
  ]);
}

export function findFlaShapeTweenTrackForTarget(
  tracks: readonly FlaShapeTweenTrack[] | undefined,
  target: FlaShapeTweenTarget,
): FlaShapeTweenTrack | null {
  if (!tracks) return null;
  const key = flaShapeTweenTargetKey(target);
  return tracks.find((track) => flaShapeTweenTargetKey(track.target) === key) ?? null;
}

export function findFlaShapeTweenTrackById(
  tracks: readonly FlaShapeTweenTrack[] | undefined,
  tweenId: string,
): FlaShapeTweenTrack | null {
  return tracks?.find((track) => track.tweenId === tweenId) ?? null;
}

/** Same authored fill and stroke style (style interpolation is out of scope). */
export function sameFlaShapeTweenStyle(
  left: FlaEditableShapeRegion,
  right: FlaEditableShapeRegion,
): boolean {
  if (JSON.stringify(left.fill) !== JSON.stringify(right.fill)) return false;
  if (left.strokes.length !== right.strokes.length) return false;
  return left.strokes.every((stroke, index) => {
    const other = right.strokes[index]!;
    return (
      stroke.color === other.color &&
      stroke.opacity === other.opacity &&
      stroke.lineWidth === other.lineWidth &&
      stroke.lineCap === other.lineCap &&
      stroke.lineJoin === other.lineJoin &&
      stroke.miterLimit === other.miterLimit &&
      stroke.closed === other.closed &&
      JSON.stringify(stroke.commands) === JSON.stringify(other.commands)
    );
  });
}

function easeShapeTweenProgress(
  rawProgress: number,
  easing: FlaShapeTweenEasing,
): number {
  if (easing === 'hold') return 0;
  if (easing === 'linear') return rawProgress;
  return rawProgress < 0.5
    ? 2 * rawProgress * rawProgress
    : 1 - Math.pow(-2 * rawProgress + 2, 2) / 2;
}

export type FlaShapeTweenPoseEdit = 'from' | 'to' | 'interpolated';

/**
 * Which authored pose a region edit at `internalTimeMs` belongs to. Direct
 * endpoint authoring is allowed exactly at / before the start (from pose) and
 * exactly at / after the end (to pose); edits inside the active range are
 * rejected by the caller so the tween cannot silently rewrite itself.
 */
export function resolveFlaShapeTweenPoseEdit(
  track: FlaShapeTweenTrack,
  internalTimeMs: number,
): FlaShapeTweenPoseEdit {
  if (!Number.isFinite(internalTimeMs)) return 'interpolated';
  if (internalTimeMs <= track.startTimeMs) return 'from';
  if (internalTimeMs >= track.endTimeMs) return 'to';
  return 'interpolated';
}

export interface FlaShapeTweenPreparedCacheEntry {
  readonly result: ShapeMorphPrepareResult;
}

const preparedPairCache = new WeakMap<object, FlaShapeTweenPreparedCacheEntry>();

/**
 * Cached normalization for one immutable track object. Project snapshots are
 * immutable, so the track instance is a stable cache key on every frame.
 */
export function prepareFlaShapeTweenTrack(
  track: FlaShapeTweenTrack,
): ShapeMorphPrepareResult {
  const cached = preparedPairCache.get(track);
  if (cached) return cached.result;
  const result = prepareShapeMorphPair(
    { contours: track.from.contours },
    { contours: track.to.contours },
  );
  preparedPairCache.set(track, { result });
  return result;
}

export type FlaShapeTweenEvaluation =
  | {
      readonly ok: true;
      readonly progress: number;
      readonly contours: readonly FlaVectorContour[];
    }
  | {
      readonly ok: false;
      readonly code: ShapeMorphFailureCode | 'invalid-time';
      readonly message: string;
    };

/**
 * Evaluates a tween track at an internal Graphic time. Endpoints return the
 * authored pose contours exactly; intermediate frames interpolate the cached
 * normalized pair. Incompatible geometry degrades with a typed failure so the
 * caller can keep the authored region instead of rendering garbage.
 */
export function evaluateFlaShapeTweenTrack(
  track: FlaShapeTweenTrack,
  internalTimeMs: number,
): FlaShapeTweenEvaluation {
  if (!Number.isFinite(internalTimeMs)) {
    return { ok: false, code: 'invalid-time', message: 'Internal time is not finite.' };
  }
  if (internalTimeMs <= track.startTimeMs) {
    return { ok: true, progress: 0, contours: track.from.contours };
  }
  if (internalTimeMs >= track.endTimeMs) {
    return { ok: true, progress: 1, contours: track.to.contours };
  }
  const prepared = prepareFlaShapeTweenTrack(track);
  if (!prepared.ok) return prepared;
  const span = track.endTimeMs - track.startTimeMs;
  const rawProgress = span > 0 ? (internalTimeMs - track.startTimeMs) / span : 1;
  const progress = easeShapeTweenProgress(rawProgress, track.easing);
  const interpolated = interpolateShapeMorphPair(prepared.pair, progress);
  if (!interpolated) {
    return { ok: false, code: 'non-finite', message: 'Shape tween interpolation failed.' };
  }
  return { ok: true, progress, contours: interpolated.contours };
}

/** Rebuilds a tween region's geometry while keeping the rendered style/bounds owned by the caller. */
export function withFlaShapeTweenContours(
  region: FlaEditableShapeRegion,
  contours: readonly FlaVectorContour[],
): FlaEditableShapeRegion {
  const nextContours = contours.map((contour) => ({
    closed: contour.closed,
    commands: contour.commands.map((command) => ({ ...command })),
  }));
  return {
    ...region,
    contours: nextContours,
    bounds: computeFlaShapeRegionBounds({ contours: nextContours, strokes: region.strokes }),
  };
}

/** Adds / replaces one tween track on a Structure (additive optional field). */
export function withFlaShapeTweenTrack(
  structure: FlaGraphicStructure,
  nextTrack: FlaShapeTweenTrack,
): FlaGraphicStructure {
  const existing = structure.shapeTweenTracks ?? [];
  const targetKey = flaShapeTweenTargetKey(nextTrack.target);
  const index = existing.findIndex(
    (track) =>
      track.tweenId === nextTrack.tweenId ||
      flaShapeTweenTargetKey(track.target) === targetKey,
  );
  const tracks = [...existing];
  if (index >= 0) tracks[index] = nextTrack;
  else tracks.push(nextTrack);
  return { ...structure, shapeTweenTracks: tracks };
}

/** Removes one tween track by id, dropping the optional field when empty. */
export function withoutFlaShapeTweenTrack(
  structure: FlaGraphicStructure,
  tweenId: string,
): FlaGraphicStructure {
  const existing = structure.shapeTweenTracks ?? [];
  const tracks = existing.filter((track) => track.tweenId !== tweenId);
  if (tracks.length === existing.length) return structure;
  if (tracks.length === 0) {
    const { shapeTweenTracks: _removed, ...rest } = structure;
    void _removed;
    return rest;
  }
  return { ...structure, shapeTweenTracks: tracks };
}
