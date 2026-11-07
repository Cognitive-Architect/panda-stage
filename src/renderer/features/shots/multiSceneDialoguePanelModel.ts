import type {
  AudioMatchRow,
  MultiSceneBlock,
  MultiSceneSelections,
  SceneSlotChoice,
  SpeakerBindings,
} from '../../../domain';
import type { MultiSceneDialoguePreview } from './multiSceneDialoguePlan';

/**
 * AUTO-05 keeps one truth: the pasted script, and the batch that exact text
 * produced. The AUTO-04 Project identity gate cannot see a text edit, a new
 * speaker binding or a new audio pick, so all three live here next to the text.
 */
export interface MultiSceneDialogueBatch {
  readonly blocks: readonly MultiSceneBlock[];
  readonly selections: MultiSceneSelections;
  readonly speakerBindings: SpeakerBindings;
  readonly audioSelections: Readonly<Record<number, string>>;
  readonly rows: readonly AudioMatchRow[];
  readonly unresolvedSpeakers: readonly string[];
  readonly backgroundMessages: Readonly<Record<number, string>>;
  readonly preview: MultiSceneDialoguePreview | null;
  readonly status: string;
}

export interface MultiSceneDialoguePanelState {
  readonly rawInput: string;
  /** Exact text the current batch was computed from; null = never checked. */
  readonly checkedInput: string | null;
  readonly batch: MultiSceneDialogueBatch;
}

export const EMPTY_MULTI_SCENE_DIALOGUE_BATCH: MultiSceneDialogueBatch = {
  blocks: [],
  selections: [],
  speakerBindings: {},
  audioSelections: {},
  rows: [],
  unresolvedSpeakers: [],
  backgroundMessages: {},
  preview: null,
  status: '',
};

/**
 * From AUTO-04 FIX-B: a picker only appears when several candidates share the
 * requested name, so each option has to say which one it is. The id never
 * reaches the author.
 */
export function choiceLabel(
  choice: SceneSlotChoice,
  index: number,
  total: number,
): string {
  return total > 1 ? `${choice.name}（候选 ${index + 1}）` : choice.name;
}

export function initialPanelState(): MultiSceneDialoguePanelState {
  return {
    rawInput: '',
    checkedInput: null,
    batch: EMPTY_MULTI_SCENE_DIALOGUE_BATCH,
  };
}

/** Any script edit invalidates parse, bindings, audio picks and preview. */
export function inputChanged(rawInput: string): MultiSceneDialoguePanelState {
  return {
    rawInput,
    checkedInput: null,
    batch: EMPTY_MULTI_SCENE_DIALOGUE_BATCH,
  };
}

export function checkApplied(
  rawInput: string,
  batch: MultiSceneDialogueBatch,
): MultiSceneDialoguePanelState {
  return { rawInput, checkedInput: rawInput, batch };
}

export function batchUpdated(
  state: MultiSceneDialoguePanelState,
  batch: MultiSceneDialogueBatch,
): MultiSceneDialoguePanelState {
  return { ...state, batch };
}

/** The only batch that may be committed. */
export function submissionBatch(
  state: MultiSceneDialoguePanelState,
): MultiSceneDialogueBatch | null {
  return state.checkedInput !== null &&
    state.checkedInput === state.rawInput &&
    state.batch.preview !== null
    ? state.batch
    : null;
}

/**
 * A pick changes the batch but not the text. The old preview is dropped so a
 * stale plan can never be submitted; the caller immediately recomputes it.
 */
export function speakerPicked(
  state: MultiSceneDialoguePanelState,
  label: string,
  characterId: string,
): MultiSceneDialoguePanelState {
  return batchUpdated(state, {
    ...state.batch,
    speakerBindings: { ...state.batch.speakerBindings, [label]: characterId },
    preview: null,
    status: '',
  });
}

export function audioPicked(
  state: MultiSceneDialoguePanelState,
  ordinal: number,
  assetId: string,
): MultiSceneDialoguePanelState {
  return batchUpdated(state, {
    ...state.batch,
    audioSelections: { ...state.batch.audioSelections, [ordinal]: assetId },
    preview: null,
    status: '',
  });
}

export function backgroundPicked(
  state: MultiSceneDialoguePanelState,
  blockOffset: number,
  assetId: string,
): MultiSceneDialoguePanelState {
  const selections = Array.from(
    { length: state.batch.blocks.length },
    (_, index) => ({ ...state.batch.selections[index] }),
  );
  selections[blockOffset] = {
    ...selections[blockOffset],
    backgroundAssetId: assetId || null,
  };
  return batchUpdated(state, {
    ...state.batch,
    selections,
    preview: null,
    status: '',
  });
}
