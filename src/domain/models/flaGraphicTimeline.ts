import { z } from 'zod';
import type { AffineMatrix2D } from '../../shared/affine-matrix';
import {
  FLA_GRAPHIC_IDENTITY_ALIAS_ID_PATTERN,
  FLA_GRAPHIC_STRUCTURE_MAX_DEPTH,
  isFlaGraphicNodeTransformable,
  type FlaGraphicStructure,
  type FlaGraphicStructureNode,
} from './flaGraphicStructure';

const FiniteNumberSchema = z.number().finite();

const FlaGraphicTransformEasingV1Schema = z.enum([
  'linear',
  'ease',
  'hold',
]);

export type FlaGraphicTransformEasing = z.infer<
  typeof FlaGraphicTransformEasingSchema
>;

const FlaGraphicDecomposedTransformV1Schema = z
  .object({
    tx: FiniteNumberSchema,
    ty: FiniteNumberSchema,
    rotationDeg: FiniteNumberSchema,
    scaleX: FiniteNumberSchema,
    scaleY: FiniteNumberSchema,
    /**
     * Additive E6 field: exact X-axis shear, in degrees. Absent means 0, which
     * keeps every pre-existing TRS key serialized byte-identically.
     *
     * Convention (see `composeAffineMatrix`):
     *   M = R(rotationDeg) * K(skewXDeg) * S(scaleX, scaleY)
     *   K = [[1, tan(skewXDeg)], [0, 1]]
     * so the off-diagonal shear entry of K * S is
     * `scaleY * tan(skewXDeg)`. `scaleY` carries the mirror sign and
     * `skewXDeg` is always in (-90, 90).
     */
    skewXDeg: FiniteNumberSchema.optional(),
  })
  .strict();

export type FlaGraphicDecomposedTransform = z.infer<
  typeof FlaGraphicDecomposedTransformSchema
>;

const FlaGraphicTransformKeyframeV1Schema = z
  .object({
    timeMs: z.number().int().nonnegative(),
    transform: FlaGraphicDecomposedTransformV1Schema,
    easing: FlaGraphicTransformEasingV1Schema.default('linear'),
  })
  .strict();

export type FlaGraphicTransformKeyframe = z.infer<
  typeof FlaGraphicTransformKeyframeSchema
>;

const FlaGraphicTransformTrackV1Schema = z
  .object({
    trackId: z.string().trim().min(1).max(1_024),
    keyframes: z.array(FlaGraphicTransformKeyframeV1Schema).min(1).max(2_000),
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

export const FlaGraphicInternalTimelineV1Schema = z
  .object({
    tracks: z.array(FlaGraphicTransformTrackV1Schema).max(1_000),
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

export const FlaGraphicTransformEasingSchema = FlaGraphicTransformEasingV1Schema;
export const FlaGraphicDecomposedTransformSchema = FlaGraphicDecomposedTransformV1Schema;
export const FlaGraphicTransformKeyframeSchema = FlaGraphicTransformKeyframeV1Schema;
export const FlaGraphicTransformTrackSchema = FlaGraphicTransformTrackV1Schema;
export const FlaGraphicInternalTimelineSchema = FlaGraphicInternalTimelineV1Schema;

/** Default absolute/relative tolerance used to decide "TRS-safe". */
export const AFFINE_TRS_SAFE_EPSILON = 1e-4;
/**
 * Tight round-trip tolerance the exact affine decomposition must reach before
 * it is allowed to attach an optional `skewXDeg`.
 */
export const AFFINE_DECOMPOSE_ROUND_TRIP_EPSILON = 1e-9;
/**
 * Relative singularity guard: `|det(M)| > epsilon * norm(M)^2` with
 * `norm(M) = max(|a|, |b|, |c|, |d|)`.
 */
export const AFFINE_NEAR_SINGULAR_EPSILON = 1e-4;

function isFiniteAffineMatrix(matrix: AffineMatrix2D): boolean {
  return (
    Number.isFinite(matrix.a) &&
    Number.isFinite(matrix.b) &&
    Number.isFinite(matrix.c) &&
    Number.isFinite(matrix.d) &&
    Number.isFinite(matrix.tx) &&
    Number.isFinite(matrix.ty)
  );
}

function affineMatricesWithin(
  actual: AffineMatrix2D,
  expected: AffineMatrix2D,
  epsilon: number,
): boolean {
  const within = (value: number, target: number): boolean =>
    Math.abs(value - target) <= Math.max(epsilon, Math.abs(target) * epsilon);
  return (
    within(actual.a, expected.a) &&
    within(actual.b, expected.b) &&
    within(actual.c, expected.c) &&
    within(actual.d, expected.d) &&
    within(actual.tx, expected.tx) &&
    within(actual.ty, expected.ty)
  );
}

/**
 * Decomposes the rotation/translation/scale half of `M` only. This is the
 * historical E6 V1 decomposition and it never adds `skewXDeg`; `skewXDeg` is
 * layered on by `decomposeAffineMatrix` so existing persisted values and
 * evaluations stay byte-identical.
 */
function decomposeAffineMatrixTrsBase(
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

/**
 * Exact 2D affine decomposition. Returns the historical TRS fields, and adds
 * an optional `skewXDeg` only when the matrix is not TRS-safe but round-trips
 * through `composeAffineMatrix` within
 * `AFFINE_DECOMPOSE_ROUND_TRIP_EPSILON`.
 *
 * Convention (mirrored by `composeAffineMatrix`):
 *   M = R(rotationDeg) * K(skewXDeg) * S(scaleX, scaleY)
 * where `scaleX >= 0`, `scaleY` carries the mirror sign,
 * `rotationDeg = atan2(b, a)`, `K = [[1, tan(skewXDeg)], [0, 1]]`, and
 * `skewXDeg = atan((a*c + b*d) / det)` is always in (-90, 90).
 *
 * `composeAffineMatrix(decomposeAffineMatrix(M))` reproduces every
 * non-singular finite `M` up to floating-point noise; singular or otherwise
 * non-representable matrices degrade to the TRS-only historical result instead
 * of throwing.
 */
export function decomposeAffineMatrix(
  matrix: AffineMatrix2D,
): FlaGraphicDecomposedTransform {
  const base = decomposeAffineMatrixTrsBase(matrix);
  if (!isFiniteAffineMatrix(matrix) || isAffineMatrixTrsSafe(matrix)) {
    return base;
  }
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  if (!Number.isFinite(determinant) || determinant === 0) return base;
  const shearNumerator = matrix.a * matrix.c + matrix.b * matrix.d;
  const tanSkew = shearNumerator / determinant;
  if (!Number.isFinite(tanSkew)) return base;
  const skewXDeg = (Math.atan(tanSkew) * 180) / Math.PI;
  if (!Number.isFinite(skewXDeg)) return base;
  const candidate: FlaGraphicDecomposedTransform = { ...base, skewXDeg };
  return affineMatricesWithin(
    composeAffineMatrix(candidate),
    matrix,
    AFFINE_DECOMPOSE_ROUND_TRIP_EPSILON,
  )
    ? candidate
    : base;
}

/**
 * Composes the decomposed representation back into an affine matrix.
 *
 * When `skewXDeg` is absent (or 0) this is arithmetically identical to the
 * historical E6 V1 composition, so existing TRS keys evaluate byte-identically.
 * When present it applies `R * K * S` with `K = [[1, tan(skewXDeg)], [0, 1]]`.
 */
export function composeAffineMatrix(
  transform: FlaGraphicDecomposedTransform,
): AffineMatrix2D {
  const rad = (transform.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const skewXDeg = transform.skewXDeg;
  if (!skewXDeg) {
    return {
      a: transform.scaleX * cos,
      b: transform.scaleX * sin,
      c: -transform.scaleY * sin,
      d: transform.scaleY * cos,
      tx: transform.tx,
      ty: transform.ty,
    };
  }
  const tanSkew = Math.tan((skewXDeg * Math.PI) / 180);
  return {
    a: transform.scaleX * cos,
    b: transform.scaleX * sin,
    c: transform.scaleY * (cos * tanSkew - sin),
    d: transform.scaleY * (sin * tanSkew + cos),
    tx: transform.tx,
    ty: transform.ty,
  };
}

/**
 * Checks whether an authored affine matrix can be losslessly represented by
 * E6 V1 decomposed TRS (`tx`, `ty`, `rotationDeg`, `scaleX`, `scaleY`).
 * Matrices with shear / skew fail round-trip recomposition; they may still be
 * representable through the additive `skewXDeg` field
 * (`isAffineMatrixDecomposable`). This predicate keeps its exact historical
 * meaning so pre-existing TRS behavior is unchanged.
 */
export function isAffineMatrixTrsSafe(
  matrix: AffineMatrix2D,
  epsilon = AFFINE_TRS_SAFE_EPSILON,
): boolean {
  if (!isFiniteAffineMatrix(matrix)) return false;
  const recomposed = composeAffineMatrix(decomposeAffineMatrixTrsBase(matrix));
  const within = (actual: number, expected: number): boolean =>
    Math.abs(actual - expected) <= Math.max(epsilon, Math.abs(expected) * 1e-6);
  return (
    within(recomposed.a, matrix.a) &&
    within(recomposed.b, matrix.b) &&
    within(recomposed.c, matrix.c) &&
    within(recomposed.d, matrix.d) &&
    within(recomposed.tx, matrix.tx) &&
    within(recomposed.ty, matrix.ty)
  );
}

/**
 * Checks whether `matrix` is losslessly representable by the extended affine
 * key representation (`TRS` plus optional `skewXDeg`).
 *
 * Unsafe cases stay locally read-only:
 * - non-finite values;
 * - near-singular matrices (`|det| <= AFFINE_NEAR_SINGULAR_EPSILON * norm^2`),
 *   which cannot be interpolated without passing through an almost degenerate
 *   matrix;
 * - matrices whose exact decomposition does not round-trip within
 *   `AFFINE_DECOMPOSE_ROUND_TRIP_EPSILON`.
 *
 * Mirrored matrices (negative `scaleY`) are exact and therefore decomposable.
 */
export function isAffineMatrixDecomposable(
  matrix: AffineMatrix2D,
  epsilon = AFFINE_DECOMPOSE_ROUND_TRIP_EPSILON,
): boolean {
  if (!isFiniteAffineMatrix(matrix)) return false;
  const norm = Math.max(
    Math.abs(matrix.a),
    Math.abs(matrix.b),
    Math.abs(matrix.c),
    Math.abs(matrix.d),
  );
  if (!(norm > 0)) return false;
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  if (
    !Number.isFinite(determinant) ||
    Math.abs(determinant) <= AFFINE_NEAR_SINGULAR_EPSILON * norm * norm
  ) {
    return false;
  }
  return affineMatricesWithin(
    composeAffineMatrix(decomposeAffineMatrix(matrix)),
    matrix,
    epsilon,
  );
}

/**
 * A matrix may be keyed on an internal transform track when it is either
 * losslessly TRS-safe (historical behavior, including singular-but-TRS
 * matrices such as a zero Y scale) or exactly decomposable with skew.
 */
export function isAffineMatrixTimelineRepresentable(
  matrix: AffineMatrix2D,
): boolean {
  return isAffineMatrixTrsSafe(matrix) || isAffineMatrixDecomposable(matrix);
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

/**
 * Interpolates two decomposed keys. Rotation keeps the historical
 * shortest-angle behavior: a full 360° authored difference is NOT expanded into
 * a guessed turn (its shortest delta is 0°). Endpoints are returned exactly
 * (`rawProgress <= 0` returns `from`, `>= 1` returns `to`), never reinterpreted.
 *
 * `skewXDeg` is interpolated linearly on the (absent = 0) value and is only
 * emitted when at least one endpoint carries skew, so pure TRS results keep
 * their historical shape.
 *
 * Sign-flip note: if the determinant signs differ, the linear `scaleY` path
 * crosses 0 and passes through an almost degenerate matrix. New authoring of
 * such pairs is refused upstream (`isFlaGraphicTransformTrackInterpolationSafe`);
 * a persisted legacy pair keeps this established interpolation so existing
 * projects evaluate byte-identically.
 */
export function interpolateDecomposedTransform(
  from: FlaGraphicDecomposedTransform,
  to: FlaGraphicDecomposedTransform,
  rawProgress: number,
  easing: FlaGraphicTransformEasing,
): FlaGraphicDecomposedTransform {
  if (rawProgress <= 0 || easing === 'hold') return from;
  if (rawProgress >= 1) return to;
  const t = easeProgress(rawProgress, easing);
  const fromSkew = from.skewXDeg ?? 0;
  const toSkew = to.skewXDeg ?? 0;
  const interpolated: FlaGraphicDecomposedTransform = {
    tx: from.tx + (to.tx - from.tx) * t,
    ty: from.ty + (to.ty - from.ty) * t,
    rotationDeg:
      from.rotationDeg +
      shortestAngleDeltaDeg(from.rotationDeg, to.rotationDeg) * t,
    scaleX: from.scaleX + (to.scaleX - from.scaleX) * t,
    scaleY: from.scaleY + (to.scaleY - from.scaleY) * t,
  };
  if (from.skewXDeg !== undefined || to.skewXDeg !== undefined) {
    interpolated.skewXDeg = fromSkew + (toSkew - fromSkew) * t;
  }
  return interpolated;
}

/**
 * Detects a determinant-sign flip between two keys. Because `scaleX` is
 * normalized to `>= 0` and `det = scaleX * scaleY` (for the composed matrix),
 * the determinant sign is the sign of `scaleY`. Strictly opposite non-zero
 * signs mean the linear `scaleY` interpolation must cross 0, i.e. an almost
 * degenerate (and visually flipping) mid-frame. Such pairs are unsafe to
 * author; a keyframe with a collapsed axis (`scaleY = 0`) is not a sign flip.
 */
export function isDecomposedTransformPairInterpolationSafe(
  from: FlaGraphicDecomposedTransform,
  to: FlaGraphicDecomposedTransform,
): boolean {
  const values = [
    from.tx,
    from.ty,
    from.rotationDeg,
    from.scaleX,
    from.scaleY,
    from.skewXDeg ?? 0,
    to.tx,
    to.ty,
    to.rotationDeg,
    to.scaleX,
    to.scaleY,
    to.skewXDeg ?? 0,
  ];
  if (!values.every(Number.isFinite)) return false;
  const fromSign = Math.sign(from.scaleY);
  const toSign = Math.sign(to.scaleY);
  if (fromSign === 0 || toSign === 0) return true;
  return fromSign === toSign;
}

/**
 * Returns whether every consecutive key pair on `track` can be interpolated
 * without a determinant sign flip. Used to keep genuinely unsafe tracks
 * locally read-only instead of authoring a flipping mid-frame.
 */
export function isFlaGraphicTransformTrackInterpolationSafe(
  track: FlaGraphicTransformTrack,
): boolean {
  for (let index = 0; index < track.keyframes.length - 1; index += 1) {
    if (
      !isDecomposedTransformPairInterpolationSafe(
        track.keyframes[index]!.transform,
        track.keyframes[index + 1]!.transform,
      )
    ) {
      return false;
    }
  }
  return track.keyframes.every((keyframe) =>
    isDecomposedTransformPairInterpolationSafe(
      keyframe.transform,
      keyframe.transform,
    ),
  );
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
  structure?: FlaGraphicStructure,
): number {
  let maxTimeMs = 0;
  const scan = (candidate?: FlaGraphicInternalTimeline | null): void => {
    if (!candidate) return;
    for (const track of candidate.tracks) {
      const last = track.keyframes[track.keyframes.length - 1];
      if (last && last.timeMs > maxTimeMs) maxTimeMs = last.timeMs;
    }
  };
  scan(timeline);
  for (const track of structure?.shapeTweenTracks ?? []) {
    if (track.endTimeMs > maxTimeMs) maxTimeMs = track.endTimeMs;
  }
  if (structure?.symbolDefinitions) {
    for (const def of Object.values(structure.symbolDefinitions)) {
      scan(def.timeline);
    }
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
    Math.abs(left.scaleY - right.scaleY) <= 1e-6 &&
    Math.abs((left.skewXDeg ?? 0) - (right.skewXDeg ?? 0)) <= 1e-6
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

export type FlaGraphicTimelineAuthoringCapability =
  | 'editable'
  | 'readonly-opaque'
  | 'readonly-identity'
  | 'readonly-trs-unsafe'
  | 'readonly-affine-unsafe';

export interface FlaGraphicTimelineTargetInfo {
  readonly ownerKind: 'frame' | 'symbol';
  readonly ownerSymbolDefId: string | null;
  readonly trackId: string | null;
  readonly targetNode: FlaGraphicStructureNode;
  readonly timeline: FlaGraphicInternalTimeline | undefined;
  /** Historical meaning: the base matrix round-trips through TRS-only composition. */
  readonly trsSafe: boolean;
  /** The base matrix round-trips through the extended (TRS + skew) decomposition. */
  readonly affineDecomposable: boolean;
  /** Whether the target's existing track can be interpolated without a sign flip. */
  readonly interpolationSafe: boolean;
  readonly authoringCapability: FlaGraphicTimelineAuthoringCapability;
  /** Whether `trackId` came from the source (`addr:`/`sym:`/`node:`), an author alias, or is absent. */
  readonly identitySource: 'addr' | 'sym' | 'node' | 'alias' | null;
  /** Author alias id backing an `alias:` identity; null for proven identities. */
  readonly identityAliasId: string | null;
  /** Persisted alias scope this node's identity belongs to. */
  readonly identityContainerKey: string;
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
 * Stable key of the timeline container an alias belongs to. A frame container
 * is scoped by its ordinal so aliases can be joined across source frames
 * without ever merging two nodes that live in the same frame; a normalized
 * Symbol definition is a distinct shared scope.
 */
export function flaGraphicIdentityContainerKey(
  ownerKind: 'frame' | 'symbol',
  ownerSymbolDefId: string | null,
  frameOrdinal?: number,
): string | null {
  if (ownerKind === 'symbol') {
    return ownerSymbolDefId ? `sym:${ownerSymbolDefId}` : null;
  }
  if (
    frameOrdinal === undefined ||
    !Number.isSafeInteger(frameOrdinal) ||
    frameOrdinal < 0
  ) {
    return null;
  }
  return `frame:${frameOrdinal}`;
}

function resolveFlaGraphicNodeIdentityAliasId(
  structure: FlaGraphicStructure,
  ownerKind: 'frame' | 'symbol',
  ownerSymbolDefId: string | null,
  frameOrdinal: number | undefined,
  nodeId: string,
): string | null {
  const aliases = structure.nodeIdentityAliases;
  if (!aliases) return null;
  const containerKey = flaGraphicIdentityContainerKey(
    ownerKind,
    ownerSymbolDefId,
    frameOrdinal,
  );
  if (!containerKey) return null;
  return aliases[containerKey]?.[nodeId] ?? null;
}

function identitySourceOfProvenId(
  provenId: string,
): 'addr' | 'sym' | 'node' {
  if (provenId.startsWith('addr:')) return 'addr';
  if (provenId.startsWith('sym:')) return 'sym';
  return 'node';
}

/**
 * Resolves only the source-proven cross-frame identity for a node. This never
 * consults author aliases, so callers can distinguish a real source-proven
 * identity from an author association.
 */
export function resolveFlaGraphicProvenNodeIdentity(
  node: FlaGraphicStructureNode,
  structure: FlaGraphicStructure,
  ownerKind: 'frame' | 'symbol',
  ownerSymbolDefId: string | null,
  containerRootNodes: readonly FlaGraphicStructureNode[],
): string | null {
  if (!isFlaGraphicNodeTransformable(node)) return null;
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
 * Resolves the stable cross-frame/cross-time track identity for a node at
 * `nodePath`. Returns `trackId: null` when the node is `opaque` or its
 * cross-frame identity cannot be proven without guessing.
 *
 * Source-proven rules (`addr:` / `sym:` / `node:`) always win. An author
 * association (`alias:<id>`) is consulted only afterwards, so an alias can
 * never replace a different proven identity; it only makes an otherwise
 * ambiguous node author-stable. `frameOrdinal` scopes frame-container aliases.
 */
export function resolveFlaGraphicStableNodeIdentity(
  node: FlaGraphicStructureNode,
  structure: FlaGraphicStructure,
  ownerKind: 'frame' | 'symbol',
  ownerSymbolDefId: string | null,
  containerRootNodes: readonly FlaGraphicStructureNode[],
  frameOrdinal?: number,
): string | null {
  const proven = resolveFlaGraphicProvenNodeIdentity(
    node,
    structure,
    ownerKind,
    ownerSymbolDefId,
    containerRootNodes,
  );
  if (proven) return proven;
  const aliasId = resolveFlaGraphicNodeIdentityAliasId(
    structure,
    ownerKind,
    ownerSymbolDefId,
    frameOrdinal,
    node.id,
  );
  return aliasId ? `alias:${aliasId}` : null;
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
  const provenIdentity = resolveFlaGraphicProvenNodeIdentity(
    targetNode,
    structure,
    ownerKind,
    ownerSymbolDefId,
    containerRootNodes,
  );
  const aliasId = provenIdentity
    ? null
    : resolveFlaGraphicNodeIdentityAliasId(
        structure,
        ownerKind,
        ownerSymbolDefId,
        frameOrdinal,
        targetNode.id,
      );
  const trackId =
    provenIdentity ?? (aliasId ? `alias:${aliasId}` : null);
  const identitySource: FlaGraphicTimelineTargetInfo['identitySource'] =
    provenIdentity
      ? identitySourceOfProvenId(provenIdentity)
      : aliasId
        ? 'alias'
        : null;
  const identityContainerKey =
    flaGraphicIdentityContainerKey(ownerKind, ownerSymbolDefId, frameOrdinal) ??
    `frame:${frameOrdinal}`;
  const timeline =
    ownerKind === 'symbol' && ownerSymbolDefId
      ? structure.symbolDefinitions?.[ownerSymbolDefId]?.timeline
      : structure.timeline;
  const trsSafe = isAffineMatrixTrsSafe(targetNode.localTransform);
  const affineDecomposable = isAffineMatrixDecomposable(targetNode.localTransform);
  const track =
    trackId && timeline
      ? timeline.tracks.find((candidate) => candidate.trackId === trackId)
      : undefined;
  // A track with a determinant sign flip between keys cannot be interpolated
  // without passing through an almost degenerate (visually flipping) matrix.
  const interpolationSafe =
    !track || isFlaGraphicTransformTrackInterpolationSafe(track);
  const authoringCapability: FlaGraphicTimelineAuthoringCapability =
    !isFlaGraphicNodeTransformable(targetNode)
      ? 'readonly-opaque'
      : !trackId
        ? 'readonly-identity'
        : !trsSafe && !affineDecomposable
          ? 'readonly-trs-unsafe'
          : !interpolationSafe
            ? 'readonly-affine-unsafe'
            : 'editable';
  return {
    ownerKind,
    ownerSymbolDefId,
    trackId,
    targetNode,
    timeline,
    trsSafe,
    affineDecomposable,
    interpolationSafe,
    authoringCapability,
    identitySource,
    identityAliasId: aliasId,
    identityContainerKey,
  };
}

export interface FlaGraphicIdentityAmbiguity {
  readonly nodePath: readonly string[];
  readonly nodeId: string;
  readonly sourceAddress: string | null;
  readonly trsSafe: boolean;
}

export interface FlaGraphicIdentityAliasAssignment {
  readonly containerKey: string;
  readonly nodeId: string;
  readonly aliasId: string;
}

export interface FlaGraphicIdentityAliasGroup {
  readonly aliasId: string;
  readonly assignments: readonly FlaGraphicIdentityAliasAssignment[];
}

/** Flattens the persisted author identity mapping in a deterministic order. */
export function listFlaGraphicIdentityAliasAssignments(
  structure: FlaGraphicStructure,
): FlaGraphicIdentityAliasAssignment[] {
  const assignments: FlaGraphicIdentityAliasAssignment[] = [];
  for (const [containerKey, nodes] of Object.entries(
    structure.nodeIdentityAliases ?? {},
  )) {
    for (const [nodeId, aliasId] of Object.entries(nodes)) {
      assignments.push({ containerKey, nodeId, aliasId });
    }
  }
  return assignments;
}

/** Groups persisted aliases by author identity so the UI can offer association. */
export function listFlaGraphicIdentityAliasGroups(
  structure: FlaGraphicStructure,
): FlaGraphicIdentityAliasGroup[] {
  const groups = new Map<string, FlaGraphicIdentityAliasAssignment[]>();
  for (const assignment of listFlaGraphicIdentityAliasAssignments(structure)) {
    const bucket = groups.get(assignment.aliasId);
    if (bucket) bucket.push(assignment);
    else groups.set(assignment.aliasId, [assignment]);
  }
  return [...groups].map(([aliasId, assignments]) => ({
    aliasId,
    assignments,
  }));
}

function findFrameContainerRootNodes(
  structure: FlaGraphicStructure,
  frameOrdinal: number,
): readonly FlaGraphicStructureNode[] | null {
  const frame = structure.frames.find(
    (candidate) => candidate.ordinal === frameOrdinal,
  );
  return frame ? frame.layers.flatMap((layer) => layer.nodes) : null;
}

/**
 * Lists the nodes at `frameOrdinal` whose cross-frame identity cannot be
 * proven and that have no author alias yet. These are the only nodes for which
 * the UI may offer explicit manual association.
 */
export function listFlaGraphicIdentityAmbiguities(
  structure: FlaGraphicStructure,
  frameOrdinal: number,
): FlaGraphicIdentityAmbiguity[] {
  if (!Number.isSafeInteger(frameOrdinal) || frameOrdinal < 0) return [];
  const containerRootNodes = findFrameContainerRootNodes(structure, frameOrdinal);
  if (!containerRootNodes) return [];
  const frame = structure.frames.find(
    (candidate) => candidate.ordinal === frameOrdinal,
  )!;
  const result: FlaGraphicIdentityAmbiguity[] = [];
  const visit = (
    nodes: readonly FlaGraphicStructureNode[],
    parentPath: readonly string[],
    depth: number,
  ): void => {
    if (depth > FLA_GRAPHIC_STRUCTURE_MAX_DEPTH) return;
    for (const node of nodes) {
      const nodePath = [...parentPath, node.id];
      if (
        isFlaGraphicNodeTransformable(node) &&
        resolveFlaGraphicStableNodeIdentity(
          node,
          structure,
          'frame',
          null,
          containerRootNodes,
          frameOrdinal,
        ) === null
      ) {
        result.push({
          nodePath,
          nodeId: node.id,
          sourceAddress: node.sourceAddress?.trim() || null,
          trsSafe: isAffineMatrixTrsSafe(node.localTransform),
        });
      }
      if (node.type === 'group') {
        visit(node.children, nodePath, depth + 1);
      } else if (node.type === 'symbol' && !node.nestedDefinitionId) {
        visit(node.children ?? [], nodePath, depth + 1);
      }
    }
  };
  for (const layer of frame.layers) visit(layer.nodes, [], 1);
  return result;
}

/**
 * Adds or replaces one author identity alias for a node. Never mutates its
 * argument and never overrides a source-proven identity: a node with a proven
 * `addr:`/`sym:`/`node:` identity is left untouched. Throws instead of merging
 * when the alias is already assigned to a different node in the same container.
 */
export function setFlaGraphicNodeIdentityAlias(
  structure: FlaGraphicStructure,
  frameOrdinal: number,
  nodePath: readonly string[],
  aliasId: string,
): FlaGraphicStructure {
  if (!FLA_GRAPHIC_IDENTITY_ALIAS_ID_PATTERN.test(aliasId)) {
    throw new Error('Graphic node identity alias ids must be bounded identifiers.');
  }
  const target = resolveFlaGraphicTimelineTarget(
    structure,
    frameOrdinal,
    nodePath,
  );
  if (!target || !isFlaGraphicNodeTransformable(target.targetNode)) {
    return structure;
  }
  if (target.identitySource !== null && target.identitySource !== 'alias') {
    // A proven source identity is authoritative; author aliases cannot replace it.
    return structure;
  }
  const containerKey = target.identityContainerKey;
  const nodeId = target.targetNode.id;
  const aliases = structure.nodeIdentityAliases ?? {};
  const container = aliases[containerKey] ?? {};
  if (container[nodeId] === aliasId) return structure;
  for (const [otherNodeId, otherAliasId] of Object.entries(container)) {
    if (otherNodeId !== nodeId && otherAliasId === aliasId) {
      throw new Error(
        'Graphic identity aliases must not merge two distinct nodes in one container.',
      );
    }
  }
  return {
    ...structure,
    nodeIdentityAliases: {
      ...aliases,
      [containerKey]: { ...container, [nodeId]: aliasId },
    },
  };
}

/**
 * Removes one author identity alias. Does not touch any other node's alias and
 * drops the whole mapping field once it becomes empty.
 */
export function clearFlaGraphicNodeIdentityAlias(
  structure: FlaGraphicStructure,
  frameOrdinal: number,
  nodePath: readonly string[],
): FlaGraphicStructure {
  const target = resolveFlaGraphicTimelineTarget(
    structure,
    frameOrdinal,
    nodePath,
  );
  if (!target || !structure.nodeIdentityAliases) return structure;
  const containerKey = target.identityContainerKey;
  const container = structure.nodeIdentityAliases[containerKey];
  const nodeId = target.targetNode.id;
  if (!container || container[nodeId] === undefined) return structure;
  const nextContainer = { ...container };
  delete nextContainer[nodeId];
  const nextAliases = { ...structure.nodeIdentityAliases };
  if (Object.keys(nextContainer).length === 0) delete nextAliases[containerKey];
  else nextAliases[containerKey] = nextContainer;
  const nextStructure = { ...structure };
  if (Object.keys(nextAliases).length === 0) delete nextStructure.nodeIdentityAliases;
  else nextStructure.nodeIdentityAliases = nextAliases;
  return nextStructure;
}

export interface FlaGraphicInternalAuthoringState {
  readonly mode: 'base' | 'timeline';
  readonly target: FlaGraphicTimelineTargetInfo | null;
  readonly authoringCapability: FlaGraphicTimelineAuthoringCapability | 'none';
  readonly trsSafe: boolean;
  readonly hasTrack: boolean;
  readonly hasKeyframeAtTime: boolean;
  readonly canEditTransform: boolean;
  readonly canAddKeyframe: boolean;
  readonly reason:
    | 'ok'
    | 'no-selection'
    | 'no-key-readonly'
    | 'trs-unsafe-readonly'
    | 'affine-unsafe-readonly'
    | 'opaque-readonly'
    | 'identity-readonly';
}

/**
 * Derives whether a selected child node is transformable and/or keyframeable
 * under the active Shared Definition Edit mode (`base` E5 vs `timeline` E6).
 */
export function resolveFlaGraphicInternalAuthoringState(input: {
  readonly structure: FlaGraphicStructure | undefined;
  readonly frameOrdinal: number;
  readonly nodePath: readonly string[] | null;
  readonly internalTimeMs?: number;
  readonly timelineAuthoringActive: boolean;
}): FlaGraphicInternalAuthoringState {
  const {
    structure,
    frameOrdinal,
    nodePath,
    internalTimeMs = 0,
    timelineAuthoringActive,
  } = input;
  if (!structure || !nodePath || nodePath.length === 0) {
    return {
      mode: timelineAuthoringActive ? 'timeline' : 'base',
      target: null,
      authoringCapability: 'none',
      trsSafe: false,
      hasTrack: false,
      hasKeyframeAtTime: false,
      canEditTransform: false,
      canAddKeyframe: false,
      reason: 'no-selection',
    };
  }
  const target = resolveFlaGraphicTimelineTarget(structure, frameOrdinal, nodePath);
  if (!target) {
    return {
      mode: timelineAuthoringActive ? 'timeline' : 'base',
      target: null,
      authoringCapability: 'none',
      trsSafe: false,
      hasTrack: false,
      hasKeyframeAtTime: false,
      canEditTransform: false,
      canAddKeyframe: false,
      reason: 'no-selection',
    };
  }
  if (!timelineAuthoringActive) {
    const isOpaque = !isFlaGraphicNodeTransformable(target.targetNode);
    return {
      mode: 'base',
      target,
      authoringCapability: target.authoringCapability,
      trsSafe: target.trsSafe,
      hasTrack: false,
      hasKeyframeAtTime: false,
      canEditTransform: !isOpaque,
      canAddKeyframe: target.authoringCapability === 'editable',
      reason: isOpaque ? 'opaque-readonly' : 'ok',
    };
  }

  const track =
    target.trackId && target.timeline
      ? target.timeline.tracks.find((candidate) => candidate.trackId === target.trackId)
      : undefined;
  const hasTrack = Boolean(track);
  const hasKeyframeAtTime = Boolean(
    track?.keyframes.some((kf) => kf.timeMs === internalTimeMs),
  );
  if (target.authoringCapability === 'readonly-opaque') {
    return {
      mode: 'timeline',
      target,
      authoringCapability: target.authoringCapability,
      trsSafe: target.trsSafe,
      hasTrack,
      hasKeyframeAtTime,
      canEditTransform: false,
      canAddKeyframe: false,
      reason: 'opaque-readonly',
    };
  }
  if (target.authoringCapability === 'readonly-identity') {
    return {
      mode: 'timeline',
      target,
      authoringCapability: target.authoringCapability,
      trsSafe: target.trsSafe,
      hasTrack,
      hasKeyframeAtTime,
      canEditTransform: false,
      canAddKeyframe: false,
      reason: 'identity-readonly',
    };
  }
  if (target.authoringCapability === 'readonly-trs-unsafe') {
    return {
      mode: 'timeline',
      target,
      authoringCapability: target.authoringCapability,
      trsSafe: false,
      hasTrack,
      hasKeyframeAtTime,
      canEditTransform: false,
      canAddKeyframe: false,
      reason: 'trs-unsafe-readonly',
    };
  }
  if (target.authoringCapability === 'readonly-affine-unsafe') {
    return {
      mode: 'timeline',
      target,
      authoringCapability: target.authoringCapability,
      trsSafe: target.trsSafe,
      hasTrack,
      hasKeyframeAtTime,
      canEditTransform: false,
      canAddKeyframe: false,
      reason: 'affine-unsafe-readonly',
    };
  }
  return {
    mode: 'timeline',
    target,
    authoringCapability: 'editable',
    trsSafe: target.trsSafe,
    hasTrack,
    hasKeyframeAtTime,
    canEditTransform: hasKeyframeAtTime,
    canAddKeyframe: !hasKeyframeAtTime,
    reason: hasKeyframeAtTime ? 'ok' : 'no-key-readonly',
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
