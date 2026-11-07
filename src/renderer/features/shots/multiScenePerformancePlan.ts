import type {
  MultiSceneBlock,
  MultiScenePerformancePlan,
  MultiScenePerformanceService,
  MultiScenePlanFailureCode,
  MultiSceneSelections,
} from '../../../domain';
import {
  commitMultiScenePreview,
  prepareMultiScenePreview,
  type MultiSceneIdentity,
  type MultiScenePlanOptions,
} from './multiScenePlan';

/** One History label for Shots + Dialogue + AudioClips + TimelineEvents. */
export const MULTI_SCENE_PERFORMANCE_HISTORY_LABEL =
  'Create scenes with performance from storyboard';

export interface MultiScenePerformancePreview {
  readonly identity: MultiSceneIdentity;
  readonly plan: MultiScenePerformancePlan;
}

export type PrepareMultiScenePerformanceOutcome =
  | { readonly ok: true; readonly preview: MultiScenePerformancePreview }
  | {
      readonly ok: false;
      readonly code: MultiScenePlanFailureCode;
      readonly message: string;
      readonly blockIndex?: number;
    };

export interface MultiScenePerformancePlanOptions
  extends MultiScenePlanOptions {
  /** Carries the confirmed bindings / audio picks plus the directives. */
  readonly service: MultiScenePerformanceService;
}

/**
 * AUTO-06 keeps the exact same identity/fingerprint gate and the same single
 * Project write as AUTO-05. Only the injected in-memory planner differs, so
 * there is no second stale system and no second Store write.
 */
export function prepareMultiScenePerformancePreview(
  blocks: readonly MultiSceneBlock[],
  selections: MultiSceneSelections,
  options: MultiScenePerformancePlanOptions,
): PrepareMultiScenePerformanceOutcome {
  const outcome = prepareMultiScenePreview(blocks, selections, {
    editorStore: options.editorStore,
    shotStore: options.shotStore,
    service: options.service,
  });
  if (!outcome.ok) return outcome;
  return {
    ok: true,
    preview: {
      identity: outcome.preview.identity,
      plan: outcome.preview.plan as MultiScenePerformancePlan,
    },
  };
}

export function commitMultiScenePerformancePreview(
  preview: MultiScenePerformancePreview,
  options: MultiScenePerformancePlanOptions,
): MultiScenePerformancePlan {
  return commitMultiScenePreview(
    preview,
    options,
    MULTI_SCENE_PERFORMANCE_HISTORY_LABEL,
  ) as MultiScenePerformancePlan;
}
