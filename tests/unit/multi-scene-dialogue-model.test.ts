import { describe, expect, it } from 'vitest';
import type { MultiSceneDialoguePreview } from '../../src/renderer/features/shots/multiSceneDialoguePlan';
import {
  audioPicked,
  backgroundPicked,
  batchUpdated,
  checkApplied,
  initialPanelState,
  inputChanged,
  speakerPicked,
  submissionBatch,
  type MultiSceneDialogueBatch,
} from '../../src/renderer/features/shots/multiSceneDialoguePanelModel';

const PREVIEW = { identity: {}, plan: {} } as unknown as MultiSceneDialoguePreview;

function checkedBatch(
  overrides: Partial<MultiSceneDialogueBatch> = {},
): MultiSceneDialogueBatch {
  return {
    blocks: [],
    selections: [{}, {}],
    speakerBindings: { 张三: 'char-1' },
    audioSelections: { 1: 'audio-1' },
    rows: [],
    unresolvedSpeakers: [],
    backgroundMessages: {},
    preview: PREVIEW,
    status: '',
    ...overrides,
  };
}

function checkedState(text = '镜头：A') {
  return checkApplied(text, checkedBatch());
}

describe('AUTO-05 panel state: input stale gate', () => {
  it('starts with no checked text and no submittable batch', () => {
    const state = initialPanelState();
    expect(state.checkedInput).toBeNull();
    expect(submissionBatch(state)).toBeNull();
  });

  it('only submits the batch built from the exact checked text', () => {
    const state = checkedState();
    expect(submissionBatch(state)).not.toBeNull();
    expect(submissionBatch(inputChanged('镜头：B'))).toBeNull();
  });

  it('drops bindings, audio selections and preview on any script edit', () => {
    const state = inputChanged('changed');
    expect(state.checkedInput).toBeNull();
    expect(state.batch.preview).toBeNull();
    expect(state.batch.speakerBindings).toEqual({});
    expect(state.batch.audioSelections).toEqual({});
    expect(state.batch.blocks).toEqual([]);
  });

  it('requires a prepared preview, not just a successful check', () => {
    const state = checkApplied('text', checkedBatch({ preview: null }));
    expect(submissionBatch(state)).toBeNull();
  });

  it('keeps checked text but invalidates the preview on a speaker pick', () => {
    const state = speakerPicked(checkedState(), '李四', 'char-2');
    expect(state.checkedInput).toBe('镜头：A');
    expect(state.batch.preview).toBeNull();
    expect(state.batch.speakerBindings).toEqual({
      张三: 'char-1',
      李四: 'char-2',
    });
    expect(submissionBatch(state)).toBeNull();
  });

  it('replaces one label binding instead of accumulating two', () => {
    const state = speakerPicked(checkedState(), '张三', 'char-9');
    expect(state.batch.speakerBindings).toEqual({ 张三: 'char-9' });
  });

  it('invalidates the preview on an audio or background pick', () => {
    const audio = audioPicked(checkedState(), 2, 'audio-2');
    expect(audio.batch.audioSelections).toEqual({
      1: 'audio-1',
      2: 'audio-2',
    });
    expect(audio.batch.preview).toBeNull();

    const background = backgroundPicked(checkedState(), 1, 'bg-2');
    expect(background.batch.selections[1]).toMatchObject({
      backgroundAssetId: 'bg-2',
    });
    expect(background.batch.preview).toBeNull();
  });

  it('recomputing after a pick restores a submittable checked batch', () => {
    const picked = speakerPicked(checkedState(), '李四', 'char-2');
    const recomputed = batchUpdated(picked, checkedBatch({
      speakerBindings: picked.batch.speakerBindings,
    }));
    expect(submissionBatch(recomputed)).not.toBeNull();
  });
});
