import type { Point } from './viewportTransform';

export const RADIAL_BURST_MIN_COUNT = 1;
export const RADIAL_BURST_MAX_COUNT = 32;
export const RADIAL_BURST_DEFAULT_COUNT = 12;
export const RADIAL_BURST_DEFAULT_RADIUS = 240;
export const RADIAL_BURST_DEFAULT_START_ANGLE_DEG = 0;
export const RADIAL_BURST_DEFAULT_MAX_ROTATION_DEG = 180;
export const RADIAL_BURST_DEFAULT_DURATION_FRAMES = 12;
export const RADIAL_BURST_DEFAULT_STAGGER_FRAMES = 1;
export const RADIAL_BURST_DEFAULT_SEED = 42;
export const RADIAL_BURST_MAX_SEED = 0xffff_ffff;

export interface RadialBurstSampleParams {
  readonly count: number;
  readonly center: Point;
  readonly radius: number;
  readonly startAngleDeg: number;
  readonly maxRotationDeg: number;
  readonly seed: number;
}

export interface RadialBurstInstanceSample {
  readonly index: number;
  readonly u: number;
  readonly v: number;
  readonly w: number;
  readonly angleDeg: number;
  readonly distance: number;
  readonly rotationDeltaDeg: number;
  readonly endPoint: Point;
}

/** Normalize any finite angle in degrees into [0, 360) without overflowing extreme magnitudes (e.g. 1e308). */
export function normalizeAngleDeg360(deg: number): number {
  if (!Number.isFinite(deg)) return Number.NaN;
  const mod = ((deg % 360) + 360) % 360;
  return Object.is(mod, -0) || mod === 360 ? 0 : mod;
}

/** Normalize IEEE-754 -0 to +0 while preserving NaN and all other numbers unchanged. */
export function normalizeNegativeZero(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

/** Deterministic uint32 PRNG (Mulberry32) producing uniform floats in [0, 1). */
export function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * Sample N radial burst trajectories deterministically from `seed`.
 * Each index i consumes exactly three samples (u, v, w) in fixed order, so
 * common indices keep identical raw random draws when N changes and are
 * independent of center, radius, angle, rotation, duration, or stagger.
 */
export function sampleRadialBurstInstances(
  params: RadialBurstSampleParams,
): RadialBurstInstanceSample[] {
  const rng = createSeededRng(params.seed);
  const baseStartAngleDeg = normalizeAngleDeg360(params.startAngleDeg);
  const samples: RadialBurstInstanceSample[] = [];
  for (let index = 0; index < params.count; index += 1) {
    const u = rng();
    const v = rng();
    const w = rng();
    const angleDeg = normalizeNegativeZero(
      baseStartAngleDeg + (360 * (index + u)) / params.count,
    );
    const angleRad = (angleDeg * Math.PI) / 180;
    const distance = params.radius * (0.75 + 0.25 * v);
    const rotationDeltaDeg =
      params.maxRotationDeg === 0
        ? 0
        : normalizeNegativeZero(params.maxRotationDeg * (2 * w - 1));
    const endPoint: Point = {
      x: normalizeNegativeZero(params.center.x + Math.cos(angleRad) * distance),
      y: normalizeNegativeZero(params.center.y + Math.sin(angleRad) * distance),
    };
    samples.push({
      index,
      u,
      v,
      w,
      angleDeg,
      distance,
      rotationDeltaDeg,
      endPoint,
    });
  }
  return samples;
}
