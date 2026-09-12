import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DialogueService, ShotService } from '../../src/domain';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { DialogueSelectionStore } from '../../src/renderer/stores/dialogueSelectionStore';
import { DialogueStore } from '../../src/renderer/stores/dialogueStore';
import { LayerSelectionStore } from '../../src/renderer/stores/selectionStore';
import { ShotStore } from '../../src/renderer/stores/shotStore';
import { buildProject, IDS } from './domain/testProject';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

describe('Issue #496 New Dialogue polish and pending recovery', () => {
  const sheet = source(
    'src/renderer/features/dialogue/DialogueSheet.tsx',
  );
  const identity = source(
    'src/renderer/features/characters/CharacterIdentity.tsx',
  );
  const styles = source('src/renderer/styles.css');
  const issue496Styles = styles.slice(styles.lastIndexOf('/* Issue #496:'));

  it('shows delete only in the selected pending card action strip', () => {
    expect(sheet).toContain(
      "const showInlineActions = timelineState === 'timeline-untimed-selected';",
    );
    expect(sheet).toContain('{selected && showInlineActions ? (');
    expect(sheet).toContain('data-testid="dialogue-untimed-action-strip"');
    expect(sheet).toContain('data-testid="dialogue-untimed-delete"');
    expect(sheet).toContain(
      'onClick={() => handleDeletePending(dialogue)}',
    );
    expect(sheet).toContain('dialogueStore.remove(dialogue.id);');
    expect(sheet).toContain('dialogueSelectionStore.clear();');
    expect(sheet).toContain('data-testid="dialogue-untimed-arrange"');
    expect(sheet).toContain('onPointerDown={handlePendingTrayPointerDown}');
    expect(sheet).toContain('onPointerUp={handlePendingTrayPointerUp}');
  });

  it('keeps the existing domain/history path and clears pending selection', () => {
    const editor = new EditorProjectStore();
    const shots = new ShotStore(editor, new ShotService());
    const layerSelection = new LayerSelectionStore(editor, shots);
    const dialogueSelection = new DialogueSelectionStore(
      editor,
      shots,
      layerSelection,
    );
    const timeline = { currentTimeMs: 120 };
    const store = new DialogueStore(
      editor,
      shots,
      new DialogueService(),
      { getSnapshot: () => timeline },
      dialogueSelection,
    );

    editor.open('D:\\issue-496-recovery.pandastage', buildProject());
    shots.select(IDS.shot);
    const dialogueId = store.create(IDS.character, '待删除字幕');

    expect(dialogueSelection.getSelectedDialogueId()).toBe(dialogueId);
    store.remove(dialogueId);

    expect(
      editor.getSnapshot()!.project.shots[0]!.dialogues,
    ).toHaveLength(0);
    expect(dialogueSelection.getSelectedDialogueId()).toBeNull();
    expect(editor.history.getSnapshot()).toMatchObject({
      nextUndoLabel: 'Delete dialogue',
      undoCount: 2,
    });
  });

  it('keeps the selected Character summary compact without changing identity ownership', () => {
    expect(identity).toContain('character-identity-selected-check');
    expect(identity).toContain('selectedLabel');
    expect(issue496Styles).toContain(
      'grid-template-columns: minmax(0, 1fr) 18px;',
    );
    expect(issue496Styles).toContain(
      '.character-identity-picker-summary .character-identity-selected',
    );
    expect(issue496Styles).toContain('display: inline-flex;');
    expect(issue496Styles).toContain('min-height: 56px;');
  });

  it('keeps authoring hierarchy local and preserves keyboard/validation owners', () => {
    expect(issue496Styles).toContain(
      '.dialogue-sheet-right-workspace .dialogue-authoring-copy-field > label',
    );
    expect(issue496Styles).toContain(
      '.dialogue-sheet-right-workspace .dialogue-authoring-scroll-body',
    );
    expect(issue496Styles).toContain(
      '.dialogue-sheet-right-workspace .dialogue-authoring-submit:not(:disabled)',
    );
    expect(sheet).toContain('event.ctrlKey || event.metaKey');
    expect(sheet).toContain('validateSingleDialogueDraft(');
    expect(sheet).toContain("handleOpenAuthoring('single')");
    expect(sheet).toContain("handleOpenAuthoring('batch')");
  });

  it('styles delete as secondary while keeping auto-arrange primary', () => {
    expect(issue496Styles).toContain(
      '.dialogue-untimed-action-buttons .dialogue-untimed-delete',
    );
    expect(issue496Styles).toContain(
      '.dialogue-untimed-action-buttons .dialogue-untimed-arrange',
    );
    expect(issue496Styles).toContain('background: var(--ui-color-action-primary');
    expect(issue496Styles).toContain('color: var(--ui-color-danger');
  });
});
