import { describe, expect, it } from 'vitest';
import {
  DialogueService,
  ProjectSchema,
  ShotService,
  type Project,
} from '../../src/domain';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { LayerSelectionStore } from '../../src/renderer/stores/selectionStore';
import { ShotStore } from '../../src/renderer/stores/shotStore';
import { DialogueSelectionStore } from '../../src/renderer/stores/dialogueSelectionStore';
import { DialogueStore } from '../../src/renderer/stores/dialogueStore';
import { buildProject, IDS } from './domain/testProject';

function audioAssetId(index: number): string {
  return `71000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

function withTenAudioAssets(project: Project): Project {
  return ProjectSchema.parse({
    ...project,
    assets: [
      ...project.assets,
      ...Array.from({ length: 10 }, (_, index) => ({
        id: audioAssetId(index + 1),
        kind: 'audio' as const,
        name: `对白 ${index + 1}`,
        relativePath: `assets/dialogue-${index + 1}.wav`,
        mimeType: 'audio/wav',
        sha256: String(index + 1).padStart(64, '0'),
        durationMs: 400,
        metadata: { status: 'ready' as const, warnings: [] },
      })),
    ],
  });
}

function rows() {
  return Array.from({ length: 10 }, (_, index) => ({
    sourceLineNumber: index + 1,
    characterId: IDS.character,
    selectedCharacterId: IDS.character,
    text: `第 ${index + 1} 句`,
    audioAssetId: audioAssetId(index + 1),
    durationMs: 400,
  }));
}

function setup() {
  const editor = new EditorProjectStore();
  const shots = new ShotStore(editor, new ShotService());
  const layerSelection = new LayerSelectionStore(editor, shots);
  const dialogueSelection = new DialogueSelectionStore(
    editor,
    shots,
    layerSelection,
  );
  const timelineState = { currentTimeMs: 2_750 };
  const timeline = { getSnapshot: () => timelineState };
  const store = new DialogueStore(
    editor,
    shots,
    new DialogueService(),
    timeline,
    dialogueSelection,
  );
  const project = new ShotService().create(
    withTenAudioAssets(buildProject()),
    { name: '第二镜头', durationMs: 3_000 },
  );
  editor.open('D:\\auto-subtitle-store.pandastage', project);
  shots.select(IDS.shot);
  return { editor, shots, store, timelineState, dialogueSelection, project };
}

describe('DialogueStore auto-subtitle generation', () => {
  it('commits a ten-row batch as one revision and one Undo/Redo command', () => {
    const { editor, store, dialogueSelection, project } = setup();
    const original = editor.getSnapshot()!;
    expect(editor.history.getSnapshot().undoCount).toBe(0);

    const generated = store.generateAutoSubtitles({
      expectedProjectRoot: original.projectRoot,
      expectedProject: original.project,
      expectedProjectId: original.project.id,
      expectedRevision: original.revision,
      expectedStartMs: 2_750,
      shotId: IDS.shot,
      rows: rows(),
      extendShotToMs: 6_750,
    });

    const committed = editor.getSnapshot()!;
    const committedProject = committed.project;
    expect(committed.revision).toBe(original.revision + 1);
    expect(committed.dirty).toBe(true);
    expect(editor.history.getSnapshot()).toMatchObject({
      undoCount: 1,
      redoCount: 0,
      nextUndoLabel: 'Generate subtitles and audio',
    });
    expect(committedProject.shots[0]).toMatchObject({
      durationMs: 6_750,
      dialogues: expect.arrayContaining([
        expect.objectContaining({ text: '第 1 句' }),
        expect.objectContaining({ text: '第 10 句' }),
      ]),
    });
    expect(committedProject.shots[0]!.dialogues).toHaveLength(10);
    expect(committedProject.shots[0]!.audioClips).toHaveLength(10);
    expect(dialogueSelection.getSelectedDialogueId()).toBe(
      generated.dialogueIds[0],
    );

    expect(editor.undo()).toBe(true);
    expect(editor.getSnapshot()!.project).toEqual(project);
    expect(editor.history.getSnapshot()).toMatchObject({
      undoCount: 0,
      redoCount: 1,
    });

    expect(editor.redo()).toBe(true);
    expect(editor.getSnapshot()!.project).toEqual(committedProject);
    expect(editor.history.getSnapshot()).toMatchObject({
      undoCount: 1,
      redoCount: 0,
    });
  });

  it('rejects a project snapshot, revision, shot, or playhead that changed during asset verification', () => {
    const { editor, shots, store, timelineState } = setup();
    const original = editor.getSnapshot()!;
    const input = {
      expectedProjectRoot: original.projectRoot,
      expectedProject: original.project,
      expectedProjectId: original.project.id,
      expectedRevision: original.revision,
      expectedStartMs: 2_750,
      shotId: IDS.shot,
      rows: rows(),
      extendShotToMs: 6_750,
    };

    expect(() =>
      store.generateAutoSubtitles({ ...input, expectedRevision: 1 }),
    ).toThrow('工程、镜头或播放位置已变化');
    timelineState.currentTimeMs = 2_751;
    expect(() => store.generateAutoSubtitles(input)).toThrow(
      '工程、镜头或播放位置已变化',
    );
    timelineState.currentTimeMs = 2_750;
    shots.select(editor.getSnapshot()!.project.shots[1]!.id);
    expect(() => store.generateAutoSubtitles(input)).toThrow(
      '工程、镜头或播放位置已变化',
    );

    const reopened = ProjectSchema.parse(structuredClone(original.project));
    editor.open(original.projectRoot, reopened);
    shots.select(IDS.shot);
    expect(() => store.generateAutoSubtitles(input)).toThrow(
      '工程、镜头或播放位置已变化',
    );
    expect(editor.getSnapshot()!.project.shots[0]!.dialogues).toHaveLength(0);
    expect(editor.history.getSnapshot()).toMatchObject({
      undoCount: 0,
      redoCount: 0,
    });
  });
});
