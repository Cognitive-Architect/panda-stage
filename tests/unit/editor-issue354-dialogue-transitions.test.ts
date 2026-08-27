import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  getDialogueSheetState,
  transitionDialogueUiState,
  type DialogueUiState,
} from '../../src/renderer/features/dialogue/DialogueSheet';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

const STATE_A: DialogueUiState = {
  authoringMode: 'none',
  selectedDialogueState: 'none',
};

function visibleState(state: DialogueUiState): string {
  return getDialogueSheetState(state);
}

describe('Issue #354 subtitle state transitions', () => {
  it('covers A -> B, A -> C, B -> A and C -> A', () => {
    const stateB = transitionDialogueUiState(STATE_A, {
      type: 'select',
      dialogueState: 'untimed',
    });
    const stateC = transitionDialogueUiState(STATE_A, {
      type: 'select',
      dialogueState: 'timed',
    });

    expect(visibleState(stateB)).toBe('timeline-untimed-selected');
    expect(visibleState(stateC)).toBe('timeline-timed-selected');
    expect(
      transitionDialogueUiState(stateB, { type: 'clear-selection' }),
    ).toEqual(STATE_A);
    expect(
      transitionDialogueUiState(stateC, { type: 'clear-selection' }),
    ).toEqual(STATE_A);
  });

  it.each(['untimed', 'timed'] as const)(
    'covers selected %s -> single -> A and lets selection interrupt single',
    (dialogueState) => {
      const selected = transitionDialogueUiState(STATE_A, {
        type: 'select',
        dialogueState,
      });
      const single = transitionDialogueUiState(selected, {
        type: 'open-authoring',
        mode: 'single',
      });

      expect(single).toEqual({
        authoringMode: 'single',
        selectedDialogueState: 'none',
      });
      expect(visibleState(single)).toBe('timeline-single-add-open');
      expect(
        transitionDialogueUiState(single, { type: 'close-authoring' }),
      ).toEqual(STATE_A);
      expect(
        visibleState(
          transitionDialogueUiState(single, {
            type: 'select',
            dialogueState,
          }),
        ),
      ).toBe(
        dialogueState === 'timed'
          ? 'timeline-timed-selected'
          : 'timeline-untimed-selected',
      );
    },
  );

  it.each(['untimed', 'timed'] as const)(
    'covers selected %s -> batch -> A and lets selection interrupt batch',
    (dialogueState) => {
      const selected = transitionDialogueUiState(STATE_A, {
        type: 'select',
        dialogueState,
      });
      const batch = transitionDialogueUiState(selected, {
        type: 'open-authoring',
        mode: 'batch',
      });

      expect(batch).toEqual({
        authoringMode: 'batch',
        selectedDialogueState: 'none',
      });
      expect(visibleState(batch)).toBe('timeline-bulk-paste-open');
      expect(
        transitionDialogueUiState(batch, { type: 'close-authoring' }),
      ).toEqual(STATE_A);
      expect(
        visibleState(
          transitionDialogueUiState(batch, {
            type: 'select',
            dialogueState,
          }),
        ),
      ).toBe(
        dialogueState === 'timed'
          ? 'timeline-timed-selected'
          : 'timeline-untimed-selected',
      );
    },
  );

  it('switches single <-> batch as one mutually-exclusive mode', () => {
    const single = transitionDialogueUiState(STATE_A, {
      type: 'open-authoring',
      mode: 'single',
    });
    const batch = transitionDialogueUiState(single, {
      type: 'open-authoring',
      mode: 'batch',
    });
    const singleAgain = transitionDialogueUiState(batch, {
      type: 'open-authoring',
      mode: 'single',
    });

    expect(single).toEqual({
      authoringMode: 'single',
      selectedDialogueState: 'none',
    });
    expect(batch).toEqual({
      authoringMode: 'batch',
      selectedDialogueState: 'none',
    });
    expect(singleAgain).toEqual(single);
  });

  it('wires the reducer invariants to visible UI exits and selection owners', () => {
    const sheet = source('src/renderer/features/dialogue/DialogueSheet.tsx');
    const draft = source(
      'src/renderer/features/dialogue/dialogueAuthoringDraft.ts',
    );

    expect(sheet).toContain("useState<DialogueAuthoringMode>('none')");
    expect(sheet).toContain('data-testid="dialogue-timed-back"');
    expect(sheet).toContain('返回待安排字幕');
    expect(sheet).toContain('onClick={() => dialogueSelectionStore.clear()}');
    expect(sheet).toContain("handleOpenAuthoring('single')");
    expect(sheet).toContain("handleOpenAuthoring('batch')");
    expect(sheet).toContain('data-testid="dialogue-authoring-shell"');
    expect(sheet).toContain('data-testid="dialogue-authoring-tab-batch"');
    expect(sheet).toContain('if (selectedDialogueId === null) return;');
    expect(sheet).toContain('dialogueSelectionStore.clear();');
    expect(sheet).toContain('dialogueSelectionStore.select(dialogueId);');
    expect(draft).not.toContain('batchOpen');
  });
});
