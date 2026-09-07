import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  DialogueService,
  ProjectSchema,
  ShotService,
  type Project,
} from '../../src/domain';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { DialogueSelectionStore } from '../../src/renderer/stores/dialogueSelectionStore';
import { DialogueStore } from '../../src/renderer/stores/dialogueStore';
import { LayerSelectionStore } from '../../src/renderer/stores/selectionStore';
import { ShotStore } from '../../src/renderer/stores/shotStore';
import {
  commitAudioTrimGesture,
  getAudioTrimPreviewEnd,
} from '../../src/renderer/features/timeline/audioTrimGesture';
import { buildProject, IDS } from './domain/testProject';

const AUDIO_ID = '10000000-0000-4000-8000-000000000601';

function service(): DialogueService {
  let counter = 0;
  return new DialogueService({
    createId: () =>
      `d2960000-0000-4000-8000-${String(++counter).padStart(12, '0')}`,
    now: () => new Date('2026-09-07T03:00:00.000Z'),
  });
}

function boundProject(): {
  project: Project;
  dialogueId: string;
  mutationService: DialogueService;
} {
  const mutationService = service();
  let project = ProjectSchema.parse({
    ...buildProject(),
    shots: buildProject().shots.map((shot) => ({ ...shot, durationMs: 4_000 })),
    assets: [
      ...buildProject().assets,
      {
        id: AUDIO_ID,
        kind: 'audio',
        name: '可裁剪配音',
        relativePath: 'assets/trim.wav',
        mimeType: 'audio/wav',
        sha256: 'e'.repeat(64),
        durationMs: 2_000,
      },
    ],
  });
  project = mutationService.create(project, {
    shotId: IDS.shot,
    characterId: IDS.character,
    text: '长字幕短配音',
    pointTimeMs: 500,
  });
  const dialogueId = project.shots[0]!.dialogues[0]!.id;
  project = mutationService.setTiming(project, {
    shotId: IDS.shot,
    dialogueId,
    startMs: 500,
    endMs: 2_000,
  });
  project = mutationService.bindAudio(project, {
    shotId: IDS.shot,
    dialogueId,
    assetId: AUDIO_ID,
  });
  return { project, dialogueId, mutationService };
}

describe('Dialogue bound AudioClip right-edge trim', () => {
  it('shortens and restores only the right edge within source/dialogue/shot bounds', () => {
    const seed = boundProject();
    const clip = seed.project.shots[0]!.audioClips[0]!;
    const shortened = seed.mutationService.resizeBoundAudioEnd(seed.project, {
      shotId: IDS.shot,
      dialogueId: seed.dialogueId,
      endMs: 900,
    });
    expect(shortened.shots[0]!.audioClips[0]).toMatchObject({
      id: clip.id,
      startMs: 500,
      endMs: 900,
      offsetMs: 0,
    });

    const restored = seed.mutationService.resizeBoundAudioEnd(shortened, {
      shotId: IDS.shot,
      dialogueId: seed.dialogueId,
      endMs: 9_999,
    });
    expect(restored.shots[0]!.audioClips[0]!.endMs).toBe(2_000);
    expect(restored.shots[0]!.dialogues[0]!.endMs).toBe(2_000);

    const positive = seed.mutationService.resizeBoundAudioEnd(restored, {
      shotId: IDS.shot,
      dialogueId: seed.dialogueId,
      endMs: -1,
    });
    expect(positive.shots[0]!.audioClips[0]).toMatchObject({
      startMs: 500,
      endMs: 501,
    });
    expect(ProjectSchema.parse(JSON.parse(JSON.stringify(positive)))).toEqual(
      positive,
    );
  });

  it('uses source duration as the legal tail bound', () => {
    const seed = boundProject();
    const offsetProject = ProjectSchema.parse({
      ...seed.project,
      shots: seed.project.shots.map((shot) => ({
        ...shot,
        audioClips: shot.audioClips.map((clip) => ({
          ...clip,
          offsetMs: 1_200,
          endMs: 1_300,
        })),
      })),
    });
    const extended = seed.mutationService.resizeBoundAudioEnd(offsetProject, {
      shotId: IDS.shot,
      dialogueId: seed.dialogueId,
      endMs: 2_000,
    });
    expect(extended.shots[0]!.audioClips[0]!.endMs).toBe(1_300);
  });

  it('copy-on-writes a shared legacy clip and keeps the other Dialogue unchanged', () => {
    const seed = boundProject();
    const firstDialogue = seed.project.shots[0]!.dialogues[0]!;
    const secondDialogue = {
      ...firstDialogue,
      id: 'd2960000-0000-4000-8000-000000000099',
      text: '共享配音',
    };
    const shared = ProjectSchema.parse({
      ...seed.project,
      shots: seed.project.shots.map((shot) => ({
        ...shot,
        dialogues: [...shot.dialogues, secondDialogue],
      })),
    });
    const trimmed = seed.mutationService.resizeBoundAudioEnd(shared, {
      shotId: IDS.shot,
      dialogueId: seed.dialogueId,
      endMs: 900,
    });

    expect(trimmed.shots[0]!.audioClips).toHaveLength(2);
    expect(trimmed.shots[0]!.dialogues[0]!.audioClipId).not.toBe(
      firstDialogue.audioClipId,
    );
    expect(trimmed.shots[0]!.dialogues[1]!.audioClipId).toBe(
      firstDialogue.audioClipId,
    );
    expect(
      trimmed.shots[0]!.audioClips.find(
        ({ id }) => id === firstDialogue.audioClipId,
      )!.endMs,
    ).toBe(2_000);
  });

  it('moves a trimmed bound clip with its Dialogue and does not extend it on subtitle resize', () => {
    const seed = boundProject();
    let project = seed.mutationService.resizeBoundAudioEnd(seed.project, {
      shotId: IDS.shot,
      dialogueId: seed.dialogueId,
      endMs: 900,
    });
    project = seed.mutationService.move(project, {
      shotId: IDS.shot,
      dialogueId: seed.dialogueId,
      deltaMs: 200,
    });
    expect(project.shots[0]!.audioClips[0]).toMatchObject({
      startMs: 700,
      endMs: 1_100,
    });
    project = seed.mutationService.resize(project, {
      shotId: IDS.shot,
      dialogueId: seed.dialogueId,
      edge: 'end',
      timeMs: 2_500,
    });
    expect(project.shots[0]!.audioClips[0]).toMatchObject({
      startMs: 700,
      endMs: 1_100,
    });
  });

  it('commits one completed Store trim as one Undo/Redo History command', () => {
    const seed = boundProject();
    const editor = new EditorProjectStore();
    const shots = new ShotStore(editor, new ShotService());
    const layers = new LayerSelectionStore(editor, shots);
    const selection = new DialogueSelectionStore(editor, shots, layers);
    const store = new DialogueStore(
      editor,
      shots,
      seed.mutationService,
      { getSnapshot: () => ({ currentTimeMs: 0 }) },
      selection,
    );
    editor.open('D:\\dialogue-audio-trim.pandastage', seed.project);
    shots.select(IDS.shot);

    store.resizeBoundAudioEnd(seed.dialogueId, 900);
    expect(editor.getSnapshot()!.project.shots[0]!.audioClips[0]!.endMs).toBe(900);
    expect(editor.history.getSnapshot()).toMatchObject({
      undoCount: 1,
      nextUndoLabel: 'Trim dialogue audio',
    });
    expect(editor.undo()).toBe(true);
    expect(editor.getSnapshot()!.project.shots[0]!.audioClips[0]!.endMs).toBe(2_000);
    expect(editor.redo()).toBe(true);
    expect(editor.getSnapshot()!.project.shots[0]!.audioClips[0]!.endMs).toBe(900);
  });
});

describe('Timeline AudioClip trim interaction', () => {
  it('keeps pointer previews local and commits only one valid pointer release', () => {
    const commit = vi.fn();
    expect(getAudioTrimPreviewEnd(2_000, -600, 1, 501, 2_000)).toBe(1_400);
    expect(getAudioTrimPreviewEnd(2_000, -9_999, 1, 501, 2_000)).toBe(501);
    expect(getAudioTrimPreviewEnd(900, 9_999, 1, 501, 2_000)).toBe(2_000);
    expect(commit).not.toHaveBeenCalled();

    const identity = {
      projectRoot: 'D:\\trim.pandastage',
      shotId: IDS.shot,
      dialogueId: 'd2960000-0000-4000-8000-000000000001',
      clipId: 'd2960000-0000-4000-8000-000000000002',
    };
    const context = {
      projectRoot: identity.projectRoot,
      shotId: identity.shotId,
      selectedDialogueId: identity.dialogueId,
      dialogueAudioClipId: identity.clipId,
    };
    expect(commitAudioTrimGesture(identity, context, 'pointercancel', commit)).toBe(false);
    expect(commitAudioTrimGesture(identity, context, 'pointerup', commit)).toBe(true);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('exposes a selected right-edge handle without left-edge or clip-body movement', () => {
    const audioClip = readFileSync(
      'src/renderer/features/timeline/AudioClip.tsx',
      'utf8',
    );
    expect(audioClip).toContain('timeline-audio-trim-handle');
    expect(audioClip).toContain('dialogueStore.resizeBoundAudioEnd');
    expect(audioClip).toContain('setPreviewEndMs(drag.draftEndMs)');
    expect(audioClip).not.toContain('handle-start');
    expect(audioClip).not.toContain('dialogueStore.move');
  });
});
