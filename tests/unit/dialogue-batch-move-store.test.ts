import { describe, expect, it } from 'vitest';
import {
  DialogueService,
  PROJECT_SCHEMA_VERSION,
  ProjectSchema,
  ShotService,
  type Dialogue,
  type Project,
} from '../../src/domain';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { LayerSelectionStore } from '../../src/renderer/stores/selectionStore';
import { ShotStore } from '../../src/renderer/stores/shotStore';
import { DialogueSelectionStore } from '../../src/renderer/stores/dialogueSelectionStore';
import { DialogueStore } from '../../src/renderer/stores/dialogueStore';
import { buildProject, IDS } from './domain/testProject';

const AUDIO = '10000000-0000-4000-8000-000000000301';
const CLIP = '90000000-0000-4000-8000-000000000011';
const BGM_CLIP = '90000000-0000-4000-8000-000000000012';
const D1 = '70000000-0000-4000-8000-000000000011';
const D2 = '70000000-0000-4000-8000-000000000012';
const D3 = '70000000-0000-4000-8000-000000000013';
const D_KEEP = '70000000-0000-4000-8000-000000000014';

function fixture(): Project {
  const base = buildProject();
  const shot = base.shots[0]!;
  const dialogues: Dialogue[] = [
    {
      id: D1,
      characterId: IDS.character,
      voiceProfileId: IDS.voiceProfile,
      subtitleStyleId: IDS.subtitle,
      audioClipId: CLIP,
      startMs: 1_000,
      endMs: 2_000,
      text: '一',
    },
    {
      id: D2,
      characterId: IDS.character,
      voiceProfileId: IDS.voiceProfile,
      subtitleStyleId: IDS.subtitle,
      startMs: 2_500,
      endMs: 3_200,
      text: '二',
    },
    {
      id: D3,
      characterId: IDS.character,
      voiceProfileId: IDS.voiceProfile,
      subtitleStyleId: IDS.subtitle,
      startMs: 4_000,
      endMs: 5_000,
      text: '三',
    },
    {
      id: D_KEEP,
      characterId: IDS.character,
      voiceProfileId: IDS.voiceProfile,
      subtitleStyleId: IDS.subtitle,
      startMs: 6_000,
      endMs: 7_000,
      text: '不动',
    },
  ];
  return ProjectSchema.parse({
    ...base,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    assets: [
      ...base.assets,
      {
        id: AUDIO,
        kind: 'audio',
        name: '配音',
        relativePath: 'assets/voice.wav',
        mimeType: 'audio/wav',
        sha256: 'c'.repeat(64),
        durationMs: 5_000,
      },
    ],
    shots: [
      {
        ...shot,
        durationMs: 10_000,
        dialogues,
        audioClips: [
          {
            id: CLIP,
            role: 'dialogue',
            name: '一配音',
            assetId: AUDIO,
            startMs: 1_000,
            endMs: 1_800,
            offsetMs: 0,
            volume: 1,
          },
          {
            id: BGM_CLIP,
            role: 'bgm',
            name: '背景音乐',
            assetId: AUDIO,
            startMs: 0,
            endMs: 3_000,
            offsetMs: 0,
            volume: 0.5,
          },
        ],
      },
    ],
  });
}

function harness() {
  const editor = new EditorProjectStore();
  const shots = new ShotStore(editor, new ShotService());
  const layers = new LayerSelectionStore(editor, shots);
  const dialogueSelection = new DialogueSelectionStore(editor, shots, layers);
  const store = new DialogueStore(
    editor,
    shots,
    new DialogueService(),
    { getSnapshot: () => ({ currentTimeMs: 0 }) },
    dialogueSelection,
  );
  editor.open('D:\\batch-adjust.pandastage', fixture());
  shots.select(IDS.shot);
  return { editor, store };
}

const SELECTED = [D1, D2, D3];

describe('AUTO-02 V0 batch dialogue move store', () => {
  it('commits one Project update and one History command for the whole group', () => {
    const { editor, store } = harness();
    const before = editor.getSnapshot()!;

    store.moveMany(SELECTED, 500);

    const after = editor.getSnapshot()!;
    expect(after.revision).toBe(before.revision + 1);
    expect(after.dirty).toBe(true);
    expect(editor.history.getSnapshot()).toMatchObject({
      undoCount: 1,
      nextUndoLabel: 'Move dialogues together',
    });
    const shot = after.project.shots[0]!;
    const byId = new Map(shot.dialogues.map((dialogue) => [dialogue.id, dialogue]));
    expect(byId.get(D1)).toMatchObject({ startMs: 1_500, endMs: 2_500 });
    expect(byId.get(D2)).toMatchObject({ startMs: 3_000, endMs: 3_700 });
    expect(byId.get(D3)).toMatchObject({ startMs: 4_500, endMs: 5_500 });
    expect(byId.get(D_KEEP)).toMatchObject({ startMs: 6_000, endMs: 7_000 });
    expect(shot.audioClips.find((clip) => clip.id === CLIP)).toMatchObject({
      startMs: 1_500,
      endMs: 2_300,
    });
    expect(
      shot.audioClips.find((clip) => clip.id === BGM_CLIP),
    ).toMatchObject({ startMs: 0, endMs: 3_000, volume: 0.5 });
  });

  it('restores the whole group with one Undo and brings it back with one Redo', () => {
    const { editor, store } = harness();
    store.moveMany(SELECTED, 500);
    const moved = editor.getSnapshot()!.project;

    expect(editor.undo()).toBe(true);
    const undone = editor.getSnapshot()!.project.shots[0]!;
    expect(
      undone.dialogues.find((dialogue) => dialogue.id === D1),
    ).toMatchObject({ startMs: 1_000, endMs: 2_000 });
    expect(
      undone.dialogues.find((dialogue) => dialogue.id === D2),
    ).toMatchObject({ startMs: 2_500, endMs: 3_200 });

    expect(editor.redo()).toBe(true);
    expect(editor.getSnapshot()!.project.shots[0]!.dialogues).toEqual(
      moved.shots[0]!.dialogues,
    );
  });

  it('rejects an illegal batch without a revision or a History entry', () => {
    const { editor, store } = harness();
    const before = editor.getSnapshot()!;

    expect(() => store.moveMany(SELECTED, -1_500)).toThrowError(
      /会超出镜头开头/u,
    );

    const after = editor.getSnapshot()!;
    expect(after.revision).toBe(before.revision);
    expect(after.project).toBe(before.project);
    expect(editor.history.getSnapshot()).toMatchObject({ undoCount: 0 });
  });

  it('previews the candidate plan through the same domain owner', () => {
    const { editor, store } = harness();
    const before = editor.getSnapshot()!;

    const plan = store.planMoveMany(SELECTED, -500);

    expect(plan.earliestStartMs).toBe(500);
    expect(plan.latestEndMs).toBe(4_500);
    expect(editor.getSnapshot()).toBe(before);
  });
});
