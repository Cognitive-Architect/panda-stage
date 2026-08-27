import { describe, expect, it } from 'vitest';
import {
  DIALOGUE_AUTHORING_TEXT_MAX_LENGTH,
  DialogueAuthoringDraft,
  validateSingleDialogueDraft,
} from '../../src/renderer/features/dialogue/dialogueAuthoringDraft';

const SHOT_A = { projectRoot: '/p/a.pandastage', shotId: 'shot-a' };
const SHOT_B = { projectRoot: '/p/a.pandastage', shotId: 'shot-b' };
const PROJECT_B = { projectRoot: '/p/b.pandastage', shotId: 'shot-a' };

describe('DialogueAuthoringDraft identity isolation', () => {
  it('starts empty and does not reset when the identity is unchanged', () => {
    const draft = new DialogueAuthoringDraft();
    expect(draft.getSnapshot()).toEqual({
      singleCharacterId: '',
      singleText: '',
      batchRaw: '',
      batchMapping: {},
    });
    // The initial bind (null -> identity) is a real change and resets the
    // (already empty) draft; a second bind with the same identity is not.
    expect(draft.bindIdentity(SHOT_A)).toBe(true);
    expect(draft.bindIdentity(SHOT_A)).toBe(false);
  });

  it('destroys every uncommitted field when the shot changes', () => {
    const draft = new DialogueAuthoringDraft();
    draft.bindIdentity(SHOT_A);
    draft.setSingleCharacterId('char-1');
    draft.setSingleText('第一句');
    draft.setBatchRaw('角色：台词\n未知：别的');
    draft.setBatchMapping(2, 'char-1');

    expect(draft.bindIdentity(SHOT_B)).toBe(true);
    expect(draft.getSnapshot()).toEqual({
      singleCharacterId: '',
      singleText: '',
      batchRaw: '',
      batchMapping: {},
    });
  });

  it('destroys the draft when the project changes', () => {
    const draft = new DialogueAuthoringDraft();
    draft.bindIdentity(SHOT_A);
    draft.setBatchRaw('角色：台词');
    draft.setSingleCharacterId('char-1');

    expect(draft.bindIdentity(PROJECT_B)).toBe(true);
    const state = draft.getSnapshot();
    expect(state.batchRaw).toBe('');
    expect(state.singleCharacterId).toBe('');
  });

  it('does not resurrect a Shot A draft after A -> B -> A', () => {
    const draft = new DialogueAuthoringDraft();
    draft.bindIdentity(SHOT_A);
    draft.setBatchRaw('熊猫：你好');
    draft.setSingleText('单行');

    // Switch away: clears.
    expect(draft.bindIdentity(SHOT_B)).toBe(true);
    expect(draft.getSnapshot().batchRaw).toBe('');

    // Switch back to the original shot: the old draft must stay gone.
    expect(draft.bindIdentity(SHOT_A)).toBe(true);
    expect(draft.getSnapshot()).toEqual({
      singleCharacterId: '',
      singleText: '',
      batchRaw: '',
      batchMapping: {},
    });
  });

  it('keeps the draft while the identity is stable', () => {
    const draft = new DialogueAuthoringDraft();
    draft.bindIdentity(SHOT_A);
    draft.setSingleText('稳定');
    draft.setBatchRaw('熊猫：台词');

    expect(draft.bindIdentity(SHOT_A)).toBe(false);
    const state = draft.getSnapshot();
    expect(state.singleText).toBe('稳定');
    expect(state.batchRaw).toBe('熊猫：台词');
  });

  it('preserves both mode drafts until the whole authoring shell closes', () => {
    const draft = new DialogueAuthoringDraft();
    draft.bindIdentity(SHOT_A);
    draft.setSingleCharacterId('char-1');
    draft.setSingleText('保留单条草稿');
    draft.setBatchRaw('熊猫：批量台词');
    draft.setBatchMapping(1, 'char-1');

    expect(draft.getSnapshot()).toEqual({
      singleCharacterId: 'char-1',
      singleText: '保留单条草稿',
      batchRaw: '熊猫：批量台词',
      batchMapping: { 1: 'char-1' },
    });

    draft.clear();

    expect(draft.getSnapshot()).toEqual({
      singleCharacterId: '',
      singleText: '',
      batchRaw: '',
      batchMapping: {},
    });
  });

  it('validates blank, stale-speaker and authoritative text-length drafts', () => {
    expect(
      validateSingleDialogueDraft(
        { singleCharacterId: '', singleText: '   ' },
        ['char-1'],
      ),
    ).toEqual({ speaker: '请选择角色。', text: '请输入台词内容。' });
    expect(
      validateSingleDialogueDraft(
        { singleCharacterId: 'deleted', singleText: '有效台词' },
        ['char-1'],
      ).speaker,
    ).toContain('已不存在');
    expect(
      validateSingleDialogueDraft(
        {
          singleCharacterId: 'char-1',
          singleText: 'a'.repeat(DIALOGUE_AUTHORING_TEXT_MAX_LENGTH + 1),
        },
        ['char-1'],
      ).text,
    ).toContain(String(DIALOGUE_AUTHORING_TEXT_MAX_LENGTH));
  });
});
