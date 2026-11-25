/**
 * Pure rich easing curves for AN-PROD-C01 native keyframe baking.
 *
 * Mathematical formulas are adapted from d3-ease (BSD-3-Clause, Mike Bostock,
 * based on Robert Penner's easing equations) with standard defaults:
 * - Back overshoot: s = 1.70158
 * - Bounce piecewise quadratic coefficients: 121/16 = 7.5625 with breaks at 4/11, 8/11, 10/11
 *
 * Guarantees:
 * - Exact endpoints: E(0) === 0, E(1) === 1
 * - Finite output, normalizing -0 to 0
 * - Preserves true overshoot outside [0, 1] on `back` curves (no global clamp)
 */

export const RICH_EASING_FAMILIES = [
  'sin',
  'cubic',
  'circle',
  'quint',
  'back',
  'bounce',
] as const;

export type RichEasingFamily = (typeof RICH_EASING_FAMILIES)[number];

export const RICH_EASING_DIRECTIONS = ['in', 'out', 'in-out'] as const;

export type RichEasingDirection = (typeof RICH_EASING_DIRECTIONS)[number];

export type RichEasingPresetId = `${RichEasingFamily}-${RichEasingDirection}`;

export const RICH_EASING_BACK_OVERSHOOT = 1.70158 as const;

export interface RichEasingPresetMeta {
  readonly id: RichEasingPresetId;
  readonly family: RichEasingFamily;
  readonly direction: RichEasingDirection;
  /** True when the curve intentionally overshoots outside [0, 1] (back family). */
  readonly mayOvershoot: boolean;
  /** True when the curve is monotonically non-decreasing over [0, 1]. */
  readonly isMonotonic: boolean;
}

export const RICH_EASING_PRESETS: readonly RichEasingPresetMeta[] =
  RICH_EASING_FAMILIES.flatMap((family) =>
    RICH_EASING_DIRECTIONS.map((direction) => ({
      id: `${family}-${direction}` as RichEasingPresetId,
      family,
      direction,
      mayOvershoot: family === 'back',
      isMonotonic: family !== 'back' && family !== 'bounce',
    })),
  );

const PRESET_ID_SET = new Set<string>(RICH_EASING_PRESETS.map((preset) => preset.id));

const HALF_PI = Math.PI / 2;
const BACK_S = RICH_EASING_BACK_OVERSHOOT;

const BOUNCE_B1 = 4 / 11;
const BOUNCE_B2 = 6 / 11;
const BOUNCE_B3 = 8 / 11;
const BOUNCE_B4 = 3 / 4;
const BOUNCE_B5 = 9 / 11;
const BOUNCE_B6 = 10 / 11;
const BOUNCE_B7 = 15 / 16;
const BOUNCE_B8 = 21 / 22;
const BOUNCE_B9 = 63 / 64;
const BOUNCE_B0 = 1 / BOUNCE_B1 / BOUNCE_B1; // 121 / 16 = 7.5625

function normalizeZero(value: number): number {
  return value === 0 ? 0 : value;
}

function bounceOutRaw(t: number): number {
  if (t < BOUNCE_B1) return BOUNCE_B0 * t * t;
  if (t < BOUNCE_B3) {
    const u = t - BOUNCE_B2;
    return BOUNCE_B0 * u * u + BOUNCE_B4;
  }
  if (t < BOUNCE_B6) {
    const u = t - BOUNCE_B5;
    return BOUNCE_B0 * u * u + BOUNCE_B7;
  }
  const u = t - BOUNCE_B8;
  return BOUNCE_B0 * u * u + BOUNCE_B9;
}

function backInRaw(t: number): number {
  return t * t * ((BACK_S + 1) * t - BACK_S);
}

function backOutRaw(t: number): number {
  const u = t - 1;
  return u * u * ((BACK_S + 1) * u + BACK_S) + 1;
}

function evaluateRaw(
  family: RichEasingFamily,
  direction: RichEasingDirection,
  t: number,
): number {
  switch (family) {
    case 'sin':
      switch (direction) {
        case 'in':
          return 1 - Math.cos(t * HALF_PI);
        case 'out':
          return Math.sin(t * HALF_PI);
        case 'in-out':
          return (1 - Math.cos(Math.PI * t)) / 2;
      }
      break;
    case 'cubic':
      switch (direction) {
        case 'in':
          return t * t * t;
        case 'out': {
          const u = t - 1;
          return u * u * u + 1;
        }
        case 'in-out': {
          const doubled = t * 2;
          if (doubled <= 1) return (doubled * doubled * doubled) / 2;
          const shifted = doubled - 2;
          return (shifted * shifted * shifted + 2) / 2;
        }
      }
      break;
    case 'circle':
      switch (direction) {
        case 'in':
          return 1 - Math.sqrt(Math.max(0, 1 - t * t));
        case 'out': {
          const u = t - 1;
          return Math.sqrt(Math.max(0, 1 - u * u));
        }
        case 'in-out': {
          const doubled = t * 2;
          if (doubled <= 1) {
            return (1 - Math.sqrt(Math.max(0, 1 - doubled * doubled))) / 2;
          }
          const shifted = doubled - 2;
          return (Math.sqrt(Math.max(0, 1 - shifted * shifted)) + 1) / 2;
        }
      }
      break;
    case 'quint':
      switch (direction) {
        case 'in':
          return t ** 5;
        case 'out':
          return 1 - (1 - t) ** 5;
        case 'in-out': {
          const doubled = t * 2;
          if (doubled <= 1) return (doubled ** 5) / 2;
          return (2 - (2 - doubled) ** 5) / 2;
        }
      }
      break;
    case 'back':
      switch (direction) {
        case 'in':
          return backInRaw(t);
        case 'out':
          return backOutRaw(t);
        case 'in-out': {
          const doubled = t * 2;
          if (doubled < 1) return backInRaw(doubled) / 2;
          return (backOutRaw(doubled - 1) + 1) / 2;
        }
      }
      break;
    case 'bounce':
      switch (direction) {
        case 'in':
          return 1 - bounceOutRaw(1 - t);
        case 'out':
          return bounceOutRaw(t);
        case 'in-out': {
          const doubled = t * 2;
          if (doubled <= 1) return (1 - bounceOutRaw(1 - doubled)) / 2;
          return (bounceOutRaw(doubled - 1) + 1) / 2;
        }
      }
      break;
  }
}

export function isRichEasingPresetId(value: string): value is RichEasingPresetId {
  return PRESET_ID_SET.has(value);
}

export function richEasingPresetId(
  family: RichEasingFamily,
  direction: RichEasingDirection,
): RichEasingPresetId {
  return `${family}-${direction}`;
}

export function parseRichEasingPresetId(presetId: RichEasingPresetId): {
  readonly family: RichEasingFamily;
  readonly direction: RichEasingDirection;
} {
  const dash = presetId.indexOf('-');
  const family = presetId.slice(0, dash) as RichEasingFamily;
  const direction = presetId.slice(dash + 1) as RichEasingDirection;
  return { family, direction };
}

/**
 * Evaluate a rich easing preset at normalized progress `t`.
 * Endpoints are exact (`t <= 0 => 0`, `t >= 1 => 1`), `-0` is normalized to `0`,
 * and `back` overshoot is preserved without clamping to `[0, 1]`.
 */
export function evaluateRichEasing(
  presetId: RichEasingPresetId,
  progress: number,
): number {
  if (!isRichEasingPresetId(presetId)) {
    throw new RangeError(`Unknown rich easing preset: ${String(presetId)}`);
  }
  if (!Number.isFinite(progress)) {
    throw new RangeError('Rich easing progress must be a finite number.');
  }
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  const { family, direction } = parseRichEasingPresetId(presetId);
  const value = evaluateRaw(family, direction, progress);
  if (!Number.isFinite(value)) {
    throw new RangeError(`Rich easing ${presetId} produced a non-finite value.`);
  }
  return normalizeZero(value);
}
