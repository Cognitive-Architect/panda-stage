import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  getDialogueSheetState,
  transitionDialogueUiState,
  type DialogueUiState,
} from '../../src/renderer/features/dialogue/DialogueSheet';
import {
  DialogueAuthoringDraft,
  validateSingleDialogueDraft,
} from '../../src/renderer/features/dialogue/dialogueAuthoringDraft';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

const STATE_A: DialogueUiState = {
  authoringMode: 'none',
  selectedDialogueState: 'none',
};

describe('Issue #357 State D/E unified subtitle authoring shell', () => {
  it('covers A/B/C -> D/E -> A and mutually-exclusive D <-> E transitions', () => {
    const stateB = transitionDialogueUiState(STATE_A, {
      type: 'select',
      dialogueState: 'untimed',
    });
    const stateC = transitionDialogueUiState(STATE_A, {
      type: 'select',
      dialogueState: 'timed',
    });

    for (const selected of [STATE_A, stateB, stateC]) {
      const stateD = transitionDialogueUiState(selected, {
        type: 'open-authoring',
        mode: 'single',
      });
      const stateE = transitionDialogueUiState(selected, {
        type: 'open-authoring',
        mode: 'batch',
      });
      expect(getDialogueSheetState(stateD)).toBe('timeline-single-add-open');
      expect(getDialogueSheetState(stateE)).toBe('timeline-bulk-paste-open');
      expect(stateD.selectedDialogueState).toBe('none');
      expect(stateE.selectedDialogueState).toBe('none');
      expect(
        transitionDialogueUiState(stateD, { type: 'close-authoring' }),
      ).toEqual(STATE_A);
      expect(
        transitionDialogueUiState(stateE, { type: 'close-authoring' }),
      ).toEqual(STATE_A);
    }

    const stateD = transitionDialogueUiState(STATE_A, {
      type: 'open-authoring',
      mode: 'single',
    });
    const stateE = transitionDialogueUiState(stateD, {
      type: 'open-authoring',
      mode: 'batch',
    });
    expect(
      transitionDialogueUiState(stateE, {
        type: 'open-authoring',
        mode: 'single',
      }),
    ).toEqual(stateD);
  });

  it('preserves both mode drafts while switching and clears them on shell close', () => {
    const draft = new DialogueAuthoringDraft();
    draft.bindIdentity({ projectRoot: '/project', shotId: 'shot' });
    draft.setSingleCharacterId('character');
    draft.setSingleText('单条草稿');
    draft.setBatchRaw('Panda：批量草稿');
    draft.setBatchMapping(1, 'character');

    expect(draft.getSnapshot()).toMatchObject({
      singleText: '单条草稿',
      batchRaw: 'Panda：批量草稿',
      batchMapping: { 1: 'character' },
    });

    draft.clear();
    expect(draft.getSnapshot()).toEqual({
      singleCharacterId: '',
      singleText: '',
      batchRaw: '',
      batchMapping: {},
    });
  });

  it('validates State D locally without touching Project or History', () => {
    expect(
      validateSingleDialogueDraft(
        { singleCharacterId: '', singleText: '' },
        ['character'],
      ),
    ).toEqual({ speaker: '请选择角色。', text: '请输入台词内容。' });
    expect(
      validateSingleDialogueDraft(
        { singleCharacterId: 'character', singleText: '真实字幕' },
        ['character'],
      ),
    ).toEqual({ speaker: null, text: null });

    const draftSource = source(
      'src/renderer/features/dialogue/dialogueAuthoringDraft.ts',
    );
    expect(draftSource).not.toContain('updateProject');
    expect(draftSource).not.toContain('HistoryStore');
  });

  it('renders one in-flow shell with accessible tabs, exits and State D content', () => {
    const sheet = source('src/renderer/features/dialogue/DialogueSheet.tsx');

    expect(sheet).toContain('data-testid="dialogue-authoring-open"');
    expect(sheet).toContain('data-testid="dialogue-authoring-shell"');
    expect(sheet).toContain('新建字幕');
    expect(sheet).toContain('role="tablist"');
    expect(sheet).toContain('role="tab"');
    expect(sheet).toContain('aria-selected={authoringMode');
    expect(sheet).toContain('data-testid="dialogue-authoring-tab-single"');
    expect(sheet).toContain('data-testid="dialogue-authoring-tab-batch"');
    expect(sheet).toContain('aria-label="关闭新建字幕"');
    expect(sheet).toContain("event.key !== 'Escape'");
    expect(sheet).toContain('data-testid="dialogue-authoring-cancel"');
    expect(sheet).toContain('data-testid="dialogue-add-speaker"');
    expect(sheet).toContain('data-testid="dialogue-add-text"');
    expect(sheet).toContain('<textarea');
    expect(sheet).toContain('event.ctrlKey || event.metaKey');
    expect(sheet).toContain('data-testid="dialogue-authoring-playhead"');
    expect(sheet).toContain('dialogueStore.create(');
    expect(sheet).toContain('dialogueSelectionStore.clear();');
    expect(sheet).not.toContain('<dialog');
  });

  it('keeps State E on the existing parser, mapping and atomic createMany owners', () => {
    const batch = source(
      'src/renderer/features/dialogue/DialogueBatchPaste.tsx',
    );

    expect(batch).toContain('parseDialoguePaste(');
    expect(batch).toContain('resolveDialoguePaste(');
    expect(batch.match(/dialogueStore\.createMany\(/gu)).toHaveLength(1);
    expect(batch).toContain('data-testid="dialogue-batch-preview"');
    expect(batch).toContain('data-testid="dialogue-batch-mapping"');
    expect(batch).toContain('data-testid="dialogue-batch-stats"');
    expect(batch).toContain('解析失败');
    expect(batch).toContain('未知角色');
    expect(batch).toContain('disabled={!resolution.allResolved}');
    expect(batch).toContain('onSuccess();');
    expect(batch).not.toContain('CharacterStore');
    expect(batch).not.toContain('updateProject');
  });

  it('preserves #354 selection interruption paths while the queue stays reachable', () => {
    const sheet = source('src/renderer/features/dialogue/DialogueSheet.tsx');

    expect(sheet).toContain('if (selectedDialogueId === null) return;');
    expect(sheet).toContain("if (authoringMode !== 'none') draft.clear();");
    expect(sheet).toContain('handleSelectDialogue(dialogue.id)');
    expect(sheet).toContain('dialogueSelectionStore.toggle(dialogueId);');
    expect(sheet).toContain('dialogue-authoring-queue-heading');
    expect(sheet).toContain('data-testid="dialogue-timed-back"');
  });

  it('uses the portrait Timeline flow without a nested vertical scroll owner', () => {
    const styles = source('src/renderer/styles.css');
    const start = styles.indexOf('/* Issue #357:');
    const end = styles.indexOf('/* Issue #352:', start);
    const issue357 = styles.slice(start, end);

    expect(issue357).toContain(
      ".editor-shell[data-editor-device-mode='cloud-touch'][data-editor-shell-layout='portrait']",
    );
    expect(issue357).toContain("data-active-workspace='timeline'");
    expect(issue357).toContain('.dialogue-authoring-shell');
    expect(issue357).toContain("[aria-selected='true']::before");
    expect(issue357).toContain('min-height: 48px;');
    expect(issue357).toContain('.dialogue-batch-table');
    expect(issue357).not.toContain('overflow-y');
    expect(issue357).not.toContain('position: fixed');
  });
});
