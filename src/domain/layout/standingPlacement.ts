import { PROJECT_HEIGHT, PROJECT_WIDTH } from '../constants';
import type { Project } from '../models';
import {
  planLayerLayout,
  type LayerLayoutPlanResult,
} from './layerAlignDistribute';

/**
 * Reusable grounded standing placement subset (shared by WF-02 and WF-03).
 *
 * Defaults follow the WF-02/WF-03 roadmap specification:
 * - Two-character horizontal anchors: 34% / 66% of canvas width.
 * - Ground line (visible bottom Y): 92% of canvas height.
 * - Generalizes cleanly to 1 object (centered at 50%) and 3+ objects (evenly
 *   interpolated between `leftXRatio` and `rightXRatio`, or explicit `xRatios`).
 */
export const DEFAULT_STANDING_LEFT_X_RATIO = 0.34 as const;
export const DEFAULT_STANDING_RIGHT_X_RATIO = 0.66 as const;
export const DEFAULT_STANDING_GROUND_Y_RATIO = 0.92 as const;

export interface StandingPlacementOptions {
  /** Ground line as a ratio of canvas height (0..1). Defaults to 0.92. */
  readonly groundYRatio?: number;
  /** Leftmost anchor X as a ratio of canvas width (0..1). Defaults to 0.34. */
  readonly leftXRatio?: number;
  /** Rightmost anchor X as a ratio of canvas width (0..1). Defaults to 0.66. */
  readonly rightXRatio?: number;
  /**
   * Optional explicit per-slot X ratios (0..1). When provided with at least as
   * many entries as slots, each slot uses its corresponding ratio.
   */
  readonly xRatios?: readonly number[];
  /** Canvas width in stage pixels. Defaults to `PROJECT_WIDTH` (1920). */
  readonly canvasWidth?: number;
  /** Canvas height in stage pixels. Defaults to `PROJECT_HEIGHT` (1080). */
  readonly canvasHeight?: number;
  /**
   * Optional: match visible heights of all placed objects to the first object's
   * visible height (or `targetHeightRatio` if specified), preserving each
   * object's non-uniform scale ratio.
   */
  readonly matchHeight?: boolean;
  /**
   * Optional target visible height as a fraction of canvas height (e.g. 0.65).
   * When set, scales each placed object proportionally to this height while
   * anchoring its visible bottom to the ground line.
   */
  readonly targetHeightRatio?: number;
}

export interface StandingSlotTarget {
  readonly index: number;
  readonly xRatio: number;
  readonly groundYRatio: number;
  readonly centerX: number;
  readonly groundY: number;
}

export interface StandingPlacementPlanInput extends StandingPlacementOptions {
  readonly shotId: string;
  readonly layerIds: readonly string[];
  readonly timeMs?: number;
  readonly autoKey?: boolean;
  readonly referenceLayerId?: string | null;
}

function clampRatio(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(0.05, Math.min(0.95, value));
}

/**
 * Compute horizontal X ratios (0..1) for `count` standing cast/object slots.
 */
export function computeStandingTargetXRatios(
  count: number,
  options: StandingPlacementOptions = {},
): readonly number[] {
  if (count <= 0) return [];
  if (options.xRatios && options.xRatios.length >= count) {
    return options.xRatios
      .slice(0, count)
      .map((ratio) => clampRatio(ratio, 0.5));
  }
  const left = clampRatio(options.leftXRatio, DEFAULT_STANDING_LEFT_X_RATIO);
  const right = clampRatio(options.rightXRatio, DEFAULT_STANDING_RIGHT_X_RATIO);
  if (count === 1) {
    return [(left + right) / 2];
  }
  const step = (right - left) / (count - 1);
  return Array.from({ length: count }, (_, index) => left + step * index);
}

/**
 * Compute stage-pixel standing slot targets (visible horizontal center X and
 * visible bottom ground Y) for `count` objects.
 */
export function computeStandingSlotTargets(
  count: number,
  options: StandingPlacementOptions = {},
): readonly StandingSlotTarget[] {
  const width =
    options.canvasWidth !== undefined && Number.isFinite(options.canvasWidth) && options.canvasWidth > 0
      ? options.canvasWidth
      : PROJECT_WIDTH;
  const height =
    options.canvasHeight !== undefined && Number.isFinite(options.canvasHeight) && options.canvasHeight > 0
      ? options.canvasHeight
      : PROJECT_HEIGHT;
  const groundYRatio = clampRatio(
    options.groundYRatio,
    DEFAULT_STANDING_GROUND_Y_RATIO,
  );
  const groundY = height * groundYRatio;
  const xRatios = computeStandingTargetXRatios(count, options);

  return xRatios.map((xRatio, index) => ({
    index,
    xRatio,
    groundYRatio,
    centerX: width * xRatio,
    groundY,
  }));
}

/**
 * Plan grounded standing placement for one or more layers in `shotId`.
 * Exported as the primary WF-03 reusable layout seam.
 */
export function planStandingPlacement(
  project: Project,
  input: StandingPlacementPlanInput,
): LayerLayoutPlanResult {
  const {
    shotId,
    layerIds,
    timeMs = 0,
    autoKey = false,
    referenceLayerId = null,
    ...standingOptions
  } = input;

  return planLayerLayout(project, {
    shotId,
    layerIds,
    action: 'standing-layout',
    timeMs,
    autoKey,
    referenceLayerId,
    standingOptions,
  });
}

/**
 * Plan and apply grounded standing placement to a candidate `Project` in one
 * step. Returns the original `project` unchanged if planning fails.
 */
export function applyStandingPlacement(
  project: Project,
  input: StandingPlacementPlanInput,
): {
  readonly project: Project;
  readonly plan: LayerLayoutPlanResult;
} {
  const plan = planStandingPlacement(project, input);
  return {
    project: plan.ok && plan.candidateProject ? plan.candidateProject : project,
    plan,
  };
}
