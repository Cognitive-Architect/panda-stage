import { describe, expect, it } from 'vitest';
import {
  DialogueService,
  DialogueServiceError,
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

const AUDIO_A = '10000000-0000-4000-8000-000000000101';
const AUDIO_B = '10000000-0000-4000-8000-000000000102';
const AUDIO_SHORT = '10000000-0000-4000-8000-000000000103';

function audioAsset(
  id: string,
  name: string,
  durationMs = 3_000,
): Project['assets'][number] {
  return {
    id,
    kind: 'audio',
    name,
    relativePath: `assets/${name}.wav`,
    mimeType: 'audio/wav',
    sha256: 'a'.repeat(64),
    durationMs,
  };
}

function withAudio(
  project = buildProject(),
  assets: readonly Project['assets'][number][] = [
    audioAsset(AUDIO_A, '对白 A'),
    audioAsset(AUDIO_B, '对白 B'),
    audioAsset(AUDIO_SHORT, '对白短音', 500),
  ],
): Project {
  return ProjectSchema.parse({
    ...project,
    assets: [...project.assets, ...assets],
  });
}

function service(): DialogueService {
  let counter = 0;
  return new DialogueService({
    createId: () =>
      `d2900000-0000-4000-8000-${String(++counter).padStart(12, '0')}`,
    now: () => new Date('2026-08-17T12:00:00.000Z'),
  });
}

function timedProject(
  dialogueStartMs = 500,
  dialogueEndMs = 1_500,
): { project: Project; dialogueId: string; service: DialogueService } {
  const mutationService = service();
  let project = withAudio();
  project = mutationService.create(project, {
    shotId: IDS.shot,
    characterId: IDS.character,
    text: '对白',
    pointTimeMs: dialogueStartMs,
  });
  const dialogueId = project.shots[0]!.dialogues[0]!.id;
  project = mutationService.setTiming(project, {
    shotId: IDS.shot,
    dialogueId,
    startMs: dialogueStartMs,
    endMs: dialogueEndMs,
  });
  return { project, dialogueId, service: mutationService };
}

function expectDialogueError(
  action: () => unknown,
  code: DialogueServiceError['code'],
): void {
  expect(action).toThrowError(
    expect.objectContaining({ name: 'DialogueServiceError', code }),
  );
}

describe('Dialogue audio binding', () => {
  it('binds only timed Dialogues and creates one v6 clip with explicit defaults', () => {
    const mutationService = service();
    const untimed = mutationService.create(withAudio(), {
      shotId: IDS.shot,
      characterId: IDS.character,
      text: '未定时',
      pointTimeMs: 500,
    });
    const untimedId = untimed.shots[0]!.dialogues[0]!.id;
    expectDialogueError(
      () =>
        mutationService.bindAudio(untimed, {
          shotId: IDS.shot,
          dialogueId: untimedId,
          assetId: AUDIO_A,
        }),
      'INVALID_DIALOGUE_DURATION',
    );

    const { project, dialogueId } = timedProject();
    const bound = service().bindAudio(project, {
      shotId: IDS.shot,
      dialogueId,
      assetId: AUDIO_A,
    });
    const dialogue = bound.shots[0]!.dialogues[0]!;
    const clip = bound.shots[0]!.audioClips[0]!;
    expect(dialogue.audioClipId).toBe(clip.id);
    expect(clip).toMatchObject({
      name: '对白 A',
      assetId: AUDIO_A,
      startMs: 500,
      endMs: 1_500,
      offsetMs: 0,
      volume: 1,
    });
    expect(bound.schemaVersion).toBe(6);
    expect(ProjectSchema.parse(JSON.parse(JSON.stringify(bound)))).toEqual(
      bound,
    );
  });

  it('rejects missing, non-audio, unanalysed, and too-short sources atomically', () => {
    const { project, dialogueId } = timedProject();
    const mutationService = service();
    const before = project;
    expectDialogueError(
      () =>
        mutationService.bindAudio(project, {
          shotId: IDS.shot,
          dialogueId,
          assetId: '10000000-0000-4000-8000-000000000199',
        }),
      'AUDIO_ASSET_NOT_FOUND',
    );
    expect(project).toBe(before);
    const imageProject = ProjectSchema.parse({
      ...project,
      assets: project.assets.filter((asset) => asset.id !== AUDIO_B),
    });
    expectDialogueError(
      () =>
        mutationService.bindAudio(imageProject, {
          shotId: IDS.shot,
          dialogueId,
          assetId: IDS.assetBg,
        }),
      'AUDIO_ASSET_NOT_AUDIO',
    );
    const pendingProject = ProjectSchema.parse({
      ...project,
      assets: project.assets.map((asset) =>
        asset.id === AUDIO_A ? { ...asset, durationMs: undefined } : asset,
      ),
    });
    expectDialogueError(
      () =>
        mutationService.bindAudio(pendingProject, {
          shotId: IDS.shot,
          dialogueId,
          assetId: AUDIO_A,
        }),
      'AUDIO_ASSET_DURATION_UNAVAILABLE',
    );
    expectDialogueError(
      () =>
        mutationService.bindAudio(project, {
          shotId: IDS.shot,
          dialogueId,
          assetId: AUDIO_SHORT,
        }),
      'AUDIO_CLIP_TOO_SHORT',
    );
    expect(project).toBe(before);
  });

  it('reuses a unique clip and keeps repeated same binding a true no-op', () => {
    const { project, dialogueId } = timedProject();
    const mutationService = service();
    const first = mutationService.bindAudio(project, {
      shotId: IDS.shot,
      dialogueId,
      assetId: AUDIO_A,
    });
    const firstClip = first.shots[0]!.audioClips[0]!;
    const repeated = mutationService.bindAudio(first, {
      shotId: IDS.shot,
      dialogueId,
      assetId: AUDIO_A,
    });
    expect(repeated).toBe(first);

    const rebound = mutationService.bindAudio(first, {
      shotId: IDS.shot,
      dialogueId,
      assetId: AUDIO_B,
    });
    expect(rebound.shots[0]!.audioClips).toHaveLength(1);
    expect(rebound.shots[0]!.audioClips[0]).toMatchObject({
      id: firstClip.id,
      assetId: AUDIO_B,
      offsetMs: 0,
      volume: 1,
    });
  });

  it('uses copy-on-write for a shared legacy clip without growing on a no-op', () => {
    const { project, dialogueId, service: mutationService } = timedProject();
    const first = mutationService.bindAudio(project, {
      shotId: IDS.shot,
      dialogueId,
      assetId: AUDIO_A,
    });
    const originalDialogue = first.shots[0]!.dialogues[0]!;
    const secondDialogue = {
      ...originalDialogue,
      id: 'd2900000-0000-4000-8000-000000000099',
      text: '共享旧对白',
    };
    const shared = ProjectSchema.parse({
      ...first,
      shots: first.shots.map((shot) => ({
        ...shot,
        dialogues: [...shot.dialogues, secondDialogue],
      })),
    });
    const noOp = mutationService.bindAudio(shared, {
      shotId: IDS.shot,
      dialogueId,
      assetId: AUDIO_A,
    });
    expect(noOp).toBe(shared);

    const copied = mutationService.bindAudio(shared, {
      shotId: IDS.shot,
      dialogueId,
      assetId: AUDIO_B,
    });
    expect(copied.shots[0]!.audioClips).toHaveLength(2);
    expect(copied.shots[0]!.dialogues).toMatchObject([
      { id: dialogueId, audioClipId: expect.not.stringMatching(originalDialogue.audioClipId!) },
      { id: secondDialogue.id, audioClipId: originalDialogue.audioClipId },
    ]);
  });

  it('keeps bound clip timing synchronized, preserves metadata, and rejects a short resize atomically', () => {
    const seed = timedProject();
    const project = ProjectSchema.parse({
      ...seed.project,
      assets: seed.project.assets.map((asset) =>
        asset.id === AUDIO_A ? { ...asset, durationMs: 2_000 } : asset,
      ),
    });
    const { dialogueId, service: mutationService } = seed;
    let bound = mutationService.bindAudio(project, {
      shotId: IDS.shot,
      dialogueId,
      assetId: AUDIO_A,
    });
    const clipBefore = bound.shots[0]!.audioClips[0]!;
    bound = mutationService.move(bound, {
      shotId: IDS.shot,
      dialogueId,
      deltaMs: 100,
    });
    expect(bound.shots[0]!.dialogues[0]).toMatchObject({
      startMs: 600,
      endMs: 1_600,
    });
    expect(bound.shots[0]!.audioClips[0]).toMatchObject({
      id: clipBefore.id,
      startMs: 600,
      endMs: 1_600,
      assetId: AUDIO_A,
      offsetMs: 0,
      volume: 1,
      name: '对白 A',
    });
    const beforeNoOp = bound;
    expect(
      mutationService.setTiming(bound, {
        shotId: IDS.shot,
        dialogueId,
        startMs: 600,
        endMs: 1_600,
      }),
    ).toBe(beforeNoOp);

    const beforeFailure = bound;
    expectDialogueError(
      () =>
        mutationService.resize(bound, {
          shotId: IDS.shot,
          dialogueId,
          edge: 'end',
          timeMs: 3_000,
        }),
      'AUDIO_CLIP_TOO_SHORT',
    );
    expect(bound).toBe(beforeFailure);
  });

  it('commits a successful Store bind as one undoable History command', () => {
    const { project, dialogueId } = timedProject();
    const editor = new EditorProjectStore();
    const shots = new ShotStore(editor, new ShotService());
    const layers = new LayerSelectionStore(editor, shots);
    const dialogueSelection = new DialogueSelectionStore(
      editor,
      shots,
      layers,
    );
    const store = new DialogueStore(
      editor,
      shots,
      service(),
      { getSnapshot: () => ({ currentTimeMs: 0 }) },
      dialogueSelection,
    );
    editor.open('D:\\dialogue-audio.pandastage', project);
    shots.select(IDS.shot);
    const before = editor.getSnapshot()!;
    store.bindAudio(dialogueId, AUDIO_A);
    const after = editor.getSnapshot()!;
    expect(after.revision).toBe(before.revision + 1);
    expect(after.dirty).toBe(true);
    expect(editor.history.getSnapshot()).toMatchObject({
      undoCount: 1,
      nextUndoLabel: 'Bind dialogue audio',
    });
    expect(after.project.shots[0]!.audioClips).toHaveLength(1);
    expect(editor.undo()).toBe(true);
    expect(editor.getSnapshot()!.project.shots[0]!.audioClips).toHaveLength(0);
  });
});
