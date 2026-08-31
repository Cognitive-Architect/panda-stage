import { describe, expect, it } from 'vitest';
import {
  DialogueService,
  ShotService,
  type Project,
} from '../../src/domain';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { LayerSelectionStore } from '../../src/renderer/stores/selectionStore';
import { ShotStore } from '../../src/renderer/stores/shotStore';
import { DialogueSelectionStore } from '../../src/renderer/stores/dialogueSelectionStore';
import { buildProject, IDS } from './domain/testProject';

interface Fixture {
  editor: EditorProjectStore;
  shots: ShotStore;
  layerSelection: LayerSelectionStore;
  dialogueSelection: DialogueSelectionStore;
  dialogueId: string;
  svc: DialogueService;
}

function setup(): Fixture {
  const editor = new EditorProjectStore();
  const shots = new ShotStore(editor, new ShotService());
  const layerSelection = new LayerSelectionStore(editor, shots);
  const dialogueSelection = new DialogueSelectionStore(
    editor,
    shots,
    layerSelection,
  );
  editor.open('D:\\dialogue-selection.pandastage', buildProject());
  shots.select(IDS.shot);
  const svc = new DialogueService();
  let project: Project = editor.getSnapshot()!.project;
  project = svc.create(project, {
    shotId: IDS.shot,
    characterId: IDS.character,
    text: '你好',
    pointTimeMs: 100,
  });
  editor.updateProject(project, 'Add dialogue');
  const dialogueId =
    editor.getSnapshot()!.project.shots[0]!.dialogues[0]!.id;
  return { editor, shots, layerSelection, dialogueSelection, dialogueId, svc };
}

describe('DialogueSelectionStore', () => {
  it('is mutually exclusive with the layer selection in both directions', () => {
    const { layerSelection, dialogueSelection, dialogueId } = setup();

    layerSelection.select(IDS.layerChar);
    expect(layerSelection.getSelectedLayerId()).toBe(IDS.layerChar);

    dialogueSelection.select(dialogueId);
    expect(dialogueSelection.getSelectedDialogueId()).toBe(dialogueId);
    expect(layerSelection.getSelectedLayerId()).toBeNull();

    layerSelection.select(IDS.layerChar);
    expect(layerSelection.getSelectedLayerId()).toBe(IDS.layerChar);
    expect(dialogueSelection.getSelectedDialogueId()).toBeNull();
  });

  it('rejects selecting an unknown dialogue', () => {
    const { dialogueSelection } = setup();
    expect(() => dialogueSelection.select('missing-dialogue')).toThrow();
  });

  it('toggles the same dialogue off while selecting a different one', () => {
    const { dialogueSelection, dialogueId, editor, svc } = setup();

    dialogueSelection.toggle(dialogueId);
    expect(dialogueSelection.getSelectedDialogueId()).toBe(dialogueId);

    dialogueSelection.toggle(dialogueId);
    expect(dialogueSelection.getSelectedDialogueId()).toBeNull();

    const project = svc.create(editor.getSnapshot()!.project, {
      shotId: IDS.shot,
      characterId: IDS.character,
      text: '第二句',
      pointTimeMs: 200,
    });
    editor.updateProject(project, 'Add second dialogue');
    const secondDialogueId =
      editor.getSnapshot()!.project.shots[0]!.dialogues[1]!.id;

    dialogueSelection.toggle(secondDialogueId);
    expect(dialogueSelection.getSelectedDialogueId()).toBe(secondDialogueId);
    dialogueSelection.toggle(dialogueId);
    expect(dialogueSelection.getSelectedDialogueId()).toBe(dialogueId);
  });

  it('clears the selection when the dialogue is removed', () => {
    const { editor, svc, dialogueSelection, dialogueId } = setup();
    dialogueSelection.select(dialogueId);
    let project: Project = editor.getSnapshot()!.project;
    project = svc.remove(project, IDS.shot, dialogueId);
    editor.updateProject(project, 'Delete dialogue');
    expect(dialogueSelection.getSelectedDialogueId()).toBeNull();
  });

  it('invalidates the selection on shot switch', () => {
    const { editor, shots, dialogueSelection, dialogueId } = setup();
    dialogueSelection.select(dialogueId);
    let project: Project = editor.getSnapshot()!.project;
    project = new ShotService().create(project, {
      name: '第二个镜头',
      durationMs: 1000,
    });
    editor.updateProject(project, 'Add shot');
    shots.select(editor.getSnapshot()!.project.shots[1]!.id);
    expect(dialogueSelection.getSelectedDialogueId()).toBeNull();
  });

  it('invalidates the selection on project switch', () => {
    const { editor, dialogueSelection, dialogueId } = setup();
    dialogueSelection.select(dialogueId);
    // Character presence differs per project; reuse the same fixture shape.
    editor.open('D:\\other.pandastage', buildProject());
    expect(dialogueSelection.getSelectedDialogueId()).toBeNull();
  });
});
