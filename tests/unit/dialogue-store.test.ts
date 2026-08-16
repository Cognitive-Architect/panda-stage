import { describe, expect, it } from 'vitest';
import {
  CharacterService,
  DialogueService,
  ShotService,
  type Project,
} from '../../src/domain';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { LayerSelectionStore } from '../../src/renderer/stores/selectionStore';
import { ShotStore } from '../../src/renderer/stores/shotStore';
import { DialogueSelectionStore } from '../../src/renderer/stores/dialogueSelectionStore';
import { DialogueStore } from '../../src/renderer/stores/dialogueStore';
import { buildProject, IDS } from './domain/testProject';

interface Fixture {
  editor: EditorProjectStore;
  store: DialogueStore;
  dialogueSelection: DialogueSelectionStore;
  timelineState: { currentTimeMs: number };
}

function setup(pointTimeMs = 500): Fixture {
  const editor = new EditorProjectStore();
  const shots = new ShotStore(editor, new ShotService());
  const layerSelection = new LayerSelectionStore(editor, shots);
  const dialogueSelection = new DialogueSelectionStore(
    editor,
    shots,
    layerSelection,
  );
  const timelineState = { currentTimeMs: pointTimeMs };
  const timelineUi = { getSnapshot: () => timelineState };
  const store = new DialogueStore(
    editor,
    shots,
    new DialogueService(),
    timelineUi,
    dialogueSelection,
  );
  editor.open('D:\\dialogue-store.pandastage', buildProject());
  shots.select(IDS.shot);
  return { editor, store, dialogueSelection, timelineState };
}

describe('DialogueStore', () => {
  it('creates a dialogue at the captured playhead time and selects it', () => {
    const { editor, store, dialogueSelection } = setup(800);
    const id = store.create(IDS.character, '你好，世界');
    const shot = editor.getSnapshot()!.project.shots[0]!;
    expect(shot.dialogues).toHaveLength(1);
    const dialogue = shot.dialogues[0]!;
    expect(dialogue.startMs).toBe(800);
    expect(dialogue.endMs).toBe(800);
    expect(dialogue.text).toBe('你好，世界');
    expect(dialogue.audioClipId).toBeUndefined();
    expect(dialogueSelection.getSelectedDialogueId()).toBe(id);
    expect(editor.getSnapshot()!.dirty).toBe(true);
  });

  it('clamps an out-of-range playhead into the shot window', () => {
    const { editor, store } = setup(99_999);
    store.create(IDS.character, '越过终点');
    expect(
      editor.getSnapshot()!.project.shots[0]!.dialogues[0]!.startMs,
    ).toBe(3000);
  });

  it('commits a batch as a single History command undoable at once', () => {
    const { editor, store } = setup(0);
    store.createMany(
      Array.from({ length: 8 }, (_, index) => ({
        characterId: IDS.character,
        text: `第 ${index + 1} 句`,
      })),
    );
    const shot = editor.getSnapshot()!.project.shots[0]!;
    expect(shot.dialogues).toHaveLength(8);
    expect(
      shot.dialogues.map((dialogue) => [
        dialogue.startMs,
        dialogue.endMs,
      ]),
    ).toEqual(Array.from({ length: 8 }, () => [0, 0]));
    expect(editor.history.getSnapshot().undoCount).toBe(1);

    editor.undo();
    expect(editor.getSnapshot()!.project.shots[0]!.dialogues).toHaveLength(0);
    expect(editor.history.getSnapshot().redoCount).toBe(1);

    editor.redo();
    expect(editor.getSnapshot()!.project.shots[0]!.dialogues).toHaveLength(8);
  });

  it('updates text and switches the voice profile when the speaker changes', () => {
    const { editor, store } = setup(100);
    const id = store.create(IDS.character, '原始文本');
    const charSvc = new CharacterService();
    let project: Project = editor.getSnapshot()!.project;
    project = charSvc.create(project, {
      name: '老虎',
      expressions: [{ name: '正常', assetId: IDS.assetChar2 }],
    });
    editor.updateProject(project, 'Add character');
    const tiger = editor.getSnapshot()!.project.characters[1]!;

    store.update(id, { text: '改过的文本', characterId: tiger.id });
    const dialogue = editor.getSnapshot()!.project.shots[0]!.dialogues[0]!;
    expect(dialogue.text).toBe('改过的文本');
    expect(dialogue.characterId).toBe(tiger.id);
    expect(dialogue.voiceProfileId).toBe(tiger.defaultVoiceProfileId);
  });

  it('arranges Untimed Dialogue as one atomic History command', () => {
    const { editor, store } = setup(1200);
    const id = store.create(IDS.character, '安排一帧');
    const before = editor.getSnapshot()!;
    expect(before.project.shots[0]!.dialogues[0]).toMatchObject({
      startMs: 1200,
      endMs: 1200,
    });
    expect(before.revision).toBe(1);
    expect(editor.history.getSnapshot().undoCount).toBe(1);

    store.arrange(id, 42);
    expect(editor.getSnapshot()!.project.shots[0]!.dialogues[0]).toMatchObject({
      startMs: 1200,
      endMs: 1242,
    });
    expect(editor.getSnapshot()!.revision).toBe(2);
    expect(editor.history.getSnapshot().undoCount).toBe(2);

    editor.undo();
    expect(editor.getSnapshot()!.project.shots[0]!.dialogues[0]).toMatchObject({
      startMs: 1200,
      endMs: 1200,
    });
  });

  it('commits one successful move once without seeking the playhead', () => {
    const { editor, store, timelineState } = setup(1000);
    const id = store.create(IDS.character, 'move once');
    store.arrange(id, 42);
    const before = editor.getSnapshot()!;
    const beforeUndo = editor.history.getSnapshot().undoCount;

    store.move(id, 42);

    expect(editor.getSnapshot()!.project.shots[0]!.dialogues[0]).toMatchObject({
      startMs: 1042,
      endMs: 1084,
    });
    expect(editor.getSnapshot()!.revision).toBe(before.revision + 1);
    expect(editor.history.getSnapshot().undoCount).toBe(beforeUndo + 1);
    expect(timelineState.currentTimeMs).toBe(1000);
  });

  it('selection and inspection of saved Untimed Dialogue stay read-only', () => {
    const editor = new EditorProjectStore();
    const shots = new ShotStore(editor, new ShotService());
    const layerSelection = new LayerSelectionStore(editor, shots);
    const dialogueSelection = new DialogueSelectionStore(
      editor,
      shots,
      layerSelection,
    );
    const service = new DialogueService();
    const savedProject = service.create(buildProject(), {
      shotId: IDS.shot,
      characterId: IDS.character,
      text: 'saved untimed',
      pointTimeMs: 700,
    });
    editor.open('D:\\saved-untimed.pandastage', savedProject);
    shots.select(IDS.shot);
    const id = editor.getSnapshot()!.project.shots[0]!.dialogues[0]!.id;

    dialogueSelection.select(id);

    expect(dialogueSelection.getSelectedDialogueId()).toBe(id);
    expect(editor.getSnapshot()).toMatchObject({
      dirty: false,
      revision: 0,
    });
    expect(editor.history.getSnapshot().undoCount).toBe(0);
    expect(editor.getSnapshot()!.project.shots[0]!.dialogues[0]).toMatchObject({
      startMs: 700,
      endMs: 700,
    });
  });

  it('removes a dialogue and records one History command', () => {
    const { editor, store } = setup(100);
    const id = store.create(IDS.character, '待删除');
    store.remove(id);
    expect(editor.getSnapshot()!.project.shots[0]!.dialogues).toHaveLength(0);
    expect(editor.history.getSnapshot().undoCount).toBe(2);
  });
});
