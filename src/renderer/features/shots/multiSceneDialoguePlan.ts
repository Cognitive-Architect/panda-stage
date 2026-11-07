import type {
  MultiSceneBlock,
  MultiSceneDialoguePlan,
  MultiSceneDialogueService,
  MultiScenePlanFailureCode,
  MultiSceneSelections,
} from '../../../domain';
import {
  commitMultiScenePreview,
  prepareMultiScenePreview,
  type MultiSceneIdentity,
  type MultiScenePlanOptions,
} from './multiScenePlan';

/** One History label for one whole batch of Shots + Dialogue + AudioClips. */
export const MULTI_SCENE_DIALOGUE_HISTORY_LABEL =
  'Create scenes with dialogue from storyboard';

export interface MultiSceneDialoguePreview {
  readonly identity: MultiSceneIdentity;
  readonly plan: MultiSceneDialoguePlan;
}

export type PrepareMultiSceneDialogueOutcome =
  | { readonly ok: true; readonly preview: MultiSceneDialoguePreview }
  | {
      readonly ok: false;
      readonly code: MultiScenePlanFailureCode;
      readonly message: string;
      readonly blockIndex?: number;
    };

export interface MultiSceneDialoguePlanOptions extends MultiScenePlanOptions {
  /** Carries the confirmed speaker bindings and audio selections. */
  readonly service: MultiSceneDialogueService;
}

/**
 * AUTO-05 deliberately reuses the AUTO-04 prepare/commit owner: the Project
 * identity/fingerprint stale gate and the single Project write live in one
 * place. Only the injected planner differs.
 */
export function prepareMultiSceneDialoguePreview(
  blocks: readonly MultiSceneBlock[],
  selections: MultiSceneSelections,
  options: MultiSceneDialoguePlanOptions,
): PrepareMultiSceneDialogueOutcome {
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
      // The injected dialogue planner always returns the richer plan shape.
      plan: outcome.preview.plan as MultiSceneDialoguePlan,
    },
  };
}

export function commitMultiSceneDialoguePreview(
  preview: MultiSceneDialoguePreview,
  options: MultiSceneDialoguePlanOptions,
): MultiSceneDialoguePlan {
  return commitMultiScenePreview(
    preview,
    options,
    MULTI_SCENE_DIALOGUE_HISTORY_LABEL,
  ) as MultiSceneDialoguePlan;
}
