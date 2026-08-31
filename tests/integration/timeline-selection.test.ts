import { describe, expect, it } from 'vitest';
import { DialogueService } from '../../src/domain';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { DialogueSelectionStore } from '../../src/renderer/stores/dialogueSelectionStore';
import { LayerSelectionStore } from '../../src/renderer/stores/selectionStore';
import { ShotStore } from '../../src/renderer/stores/shotStore';
import { ShotService } from '../../src/domain';
import { buildProject, IDS } from '../unit/domain/testProject';

function setup(): {
  editor: EditorProjectStore;
  layerSelection: LayerSelectionStore;
  dialogueSelection: DialogueSelectionStore;
  firstDialogueId: string;
  secondDialogueId: string;
} {
  const editor = new EditorProjectStore();
  const shots = new ShotStore(editor, new ShotService());
  const layerSelection = new LayerSelectionStore(editor, shots);
  const dialogueSelection = new DialogueSelectionStore(
    editor,
    shots,
    layerSelection,
  );
  editor.open('D:\\timeline-selection.pandastage', buildProject());
  shots.select(IDS.shot);

  const service = new DialogueService();
  let project = service.create(editor.getSnapshot()!.project, {
    shotId: IDS.shot,
    characterId: IDS.character,
    text: '第一句',
    pointTimeMs: 100,
  });
  project = service.create(project, {
    shotId: IDS.shot,
    characterId: IDS.character,
    text: '第二句',
    pointTimeMs: 200,
  });
  editor.updateProject(project, 'Add Timeline dialogues');
  const dialogues = editor.getSnapshot()!.project.shots[0]!.dialogues;

  return {
    editor,
    layerSelection,
    dialogueSelection,
    firstDialogueId: dialogues[0]!.id,
    secondDialogueId: dialogues[1]!.id,
  };
}

describe('Issue #359 Timeline selection integration', () => {
  it('toggles the selected subtitle without breaking layer/dialogue exclusion', () => {
    const {
      editor,
      layerSelection,
      dialogueSelection,
      firstDialogueId,
      secondDialogueId,
    } = setup();
    layerSelection.select(IDS.layerChar);
    const revision = editor.getSnapshot()!.revision;

    dialogueSelection.toggle(firstDialogueId);
    expect(dialogueSelection.getSelectedDialogueId()).toBe(firstDialogueId);
    expect(layerSelection.getSelectedLayerId()).toBeNull();
    expect(editor.getSnapshot()!.revision).toBe(revision);

    dialogueSelection.toggle(firstDialogueId);
    expect(dialogueSelection.getSelectedDialogueId()).toBeNull();
    expect(editor.getSnapshot()!.revision).toBe(revision);

    dialogueSelection.toggle(secondDialogueId);
    expect(dialogueSelection.getSelectedDialogueId()).toBe(secondDialogueId);
    layerSelection.select(IDS.layerChar);
    expect(dialogueSelection.getSelectedDialogueId()).toBeNull();
  });
});
