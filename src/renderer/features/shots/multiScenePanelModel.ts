import type {
  MultiSceneBlock,
  MultiSceneReport,
  MultiSceneSelections,
  SceneSlotChoice,
} from '../../../domain';
import type { MultiScenePreview } from './multiScenePlan';

/**
 * AUTO-04-FIX-01 keeps the panel's truth down to two things: the storyboard text
 * the author has typed, and the batch that exact text produced.
 *
 * The Project identity gate in `multiScenePlan` cannot catch an edited
 * storyboard, because the Project itself never changed. So the invalidation has
 * to live here, next to the text.
 */
export interface MultiSceneBatch {
  readonly blocks: readonly MultiSceneBlock[];
  readonly selections: MultiSceneSelections;
  readonly report: MultiSceneReport | null;
  readonly preview: MultiScenePreview | null;
  readonly status: string;
}

export interface MultiScenePanelState {
  readonly rawInput: string;
  /**
   * The exact text the current batch was computed from. `null` means nothing has
   * been checked, so nothing may be generated.
   */
  readonly checkedInput: string | null;
  readonly batch: MultiSceneBatch;
}

export const EMPTY_MULTI_SCENE_BATCH: MultiSceneBatch = {
  blocks: [],
  selections: [],
  report: null,
  preview: null,
  status: '',
};

export function initialPanelState(): MultiScenePanelState {
  return { rawInput: '', checkedInput: null, batch: EMPTY_MULTI_SCENE_BATCH };
}

/**
 * FIX-A: any storyboard edit drops the previous batch — blocks, selections,
 * report, preview and status. The author has to 检查素材 again before anything
 * can be generated, and no Project state is touched.
 */
export function inputChanged(rawInput: string): MultiScenePanelState {
  return { rawInput, checkedInput: null, batch: EMPTY_MULTI_SCENE_BATCH };
}

/** A finished 检查素材 — ready or refused — becomes the current batch. */
export function checkApplied(
  rawInput: string,
  batch: MultiSceneBatch,
): MultiScenePanelState {
  return { rawInput, checkedInput: rawInput, batch };
}

/** Same checked text, new batch: a candidate pick, or a commit result. */
export function batchUpdated(
  state: MultiScenePanelState,
  batch: MultiSceneBatch,
): MultiScenePanelState {
  return { ...state, batch };
}

/**
 * The only batch that may be committed. The `checkedInput` comparison is the
 * fence: even if a stale preview survived somewhere, text that was never checked
 * yields nothing to submit.
 */
export function submissionBatch(
  state: MultiScenePanelState,
): MultiSceneBatch | null {
  const current =
    state.checkedInput !== null &&
    state.checkedInput === state.rawInput &&
    state.batch.preview !== null;
  return current ? state.batch : null;
}

/**
 * FIX-B: a picker only appears when several candidates share the requested name,
 * so each option has to say which one it is. Order is the Project's own candidate
 * order, and the ID never reaches the author.
 */
export function choiceLabel(
  choice: SceneSlotChoice,
  index: number,
  total: number,
): string {
  return total > 1 ? `${choice.name}（候选 ${index + 1}）` : choice.name;
}
