import { describe, expect, it } from 'vitest';
import {
  MultiSceneDialogueService,
  parseMultiSceneInput,
  type Project,
} from '../../src/domain';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { ShotService } from '../../src/domain/services';
import { ShotStore } from '../../src/renderer/stores/shotStore';
import {
  MULTI_SCENE_DIALOGUE_HISTORY_LABEL,
  commitMultiSceneDialoguePreview,
  prepareMultiSceneDialoguePreview,
} from '../../src/renderer/features/shots/multiSceneDialoguePlan';
import { MultiSceneActionError } from '../../src/renderer/features/shots/multiScenePlan';
import {
  AUDIO_IDS,
  THREE_BLOCKS,
  TWO_BLOCKS,
  buildDialogueProject,
  defaultAudioAssets,
} from '../helpers/multiSceneDialogueFixture';

function harness(project: Project = buildDialogueProject()) {
  const editorStore = new EditorProjectStore();
  const shotStore = new ShotStore(editorStore, new ShotService());
  editorStore.open('D:\\auto05.pandastage', project);
  return { editorStore, shotStore, project };
}

function prepare(
  raw: string,
  harnessValue: ReturnType<typeof harness>,
  service = new MultiSceneDialogueService(),
) {
  return prepareMultiSceneDialoguePreview(parseMultiSceneInput(raw), [], {
    editorStore: harnessValue.editorStore,
    shotStore: harnessValue.shotStore,
    service,
  });
}

describe('AUTO-05 atomic batch commit', () => {
  it('writes Shots + Dialogue + AudioClips as one revision and one History', () => {
    const h = harness();
    const prepared = prepare(THREE_BLOCKS, h);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    // Preparing is runtime-only.
    expect(h.editorStore.getSnapshot()).toMatchObject({
      revision: 0,
      dirty: false,
    });
    expect(h.editorStore.history.getSnapshot().undoCount).toBe(0);

    const committed = commitMultiSceneDialoguePreview(prepared.preview, {
      editorStore: h.editorStore,
      shotStore: h.shotStore,
      service: new MultiSceneDialogueService(),
    });

    expect(h.editorStore.getSnapshot()).toMatchObject({
      revision: 1,
      dirty: true,
    });
    expect(h.editorStore.history.getSnapshot()).toMatchObject({
      undoCount: 1,
      nextUndoLabel: MULTI_SCENE_DIALOGUE_HISTORY_LABEL,
    });
    const next = h.editorStore.getSnapshot()!.project;
    expect(next.shots).toHaveLength(h.project.shots.length + 3);
    expect(committed.dialogue.rows).toHaveLength(6);
    for (const shotId of committed.createdShotIds) {
      const shot = next.shots.find((candidate) => candidate.id === shotId)!;
      expect(shot.dialogues.length).toBeGreaterThan(0);
      expect(shot.audioClips.length).toBe(shot.dialogues.length);
    }
  });

  it('removes the whole batch on one Undo and restores it on one Redo', () => {
    const h = harness();
    const prepared = prepare(THREE_BLOCKS, h);
    if (!prepared.ok) throw new Error('expected a plan');
    const committed = commitMultiSceneDialoguePreview(prepared.preview, {
      editorStore: h.editorStore,
      shotStore: h.shotStore,
      service: new MultiSceneDialogueService(),
    });

    h.editorStore.undo();
    const undone = h.editorStore.getSnapshot()!.project;
    expect(undone.shots).toHaveLength(h.project.shots.length);
    expect(committed.createdShotIds.every((id) => !undone.shots.some((s) => s.id === id))).toBe(true);

    h.editorStore.redo();
    const redone = h.editorStore.getSnapshot()!.project;
    expect(redone.shots).toHaveLength(h.project.shots.length + 3);
    for (const shotId of committed.createdShotIds) {
      const shot = redone.shots.find((candidate) => candidate.id === shotId)!;
      expect(shot.dialogues).toHaveLength(2);
      expect(shot.audioClips).toHaveLength(2);
    }
    expect(h.editorStore.history.getSnapshot().undoCount).toBe(1);
  });

  it('writes nothing when the third Shot has no matching audio', () => {
    const audio = defaultAudioAssets().filter(
      (asset) => asset.id !== AUDIO_IDS[5],
    );
    const h = harness(buildDialogueProject(audio));
    const prepared = prepare(THREE_BLOCKS, h);
    expect(prepared.ok).toBe(false);
    expect(h.editorStore.getSnapshot()).toMatchObject({
      revision: 0,
      dirty: false,
    });
    expect(h.editorStore.history.getSnapshot().undoCount).toBe(0);
    expect(h.editorStore.getSnapshot()!.project.shots).toHaveLength(
      h.project.shots.length,
    );
  });

  it('refuses a stale plan after the Project changed', () => {
    const h = harness();
    const prepared = prepare(TWO_BLOCKS, h);
    if (!prepared.ok) throw new Error('expected a plan');
    h.editorStore.updateProject({ ...h.project, name: 'Edited meanwhile' });

    expect(() =>
      commitMultiSceneDialoguePreview(prepared.preview, {
        editorStore: h.editorStore,
        shotStore: h.shotStore,
        service: new MultiSceneDialogueService(),
      }),
    ).toThrow(MultiSceneActionError);
    expect(h.editorStore.getSnapshot()!.project.shots).toHaveLength(
      h.project.shots.length,
    );
  });

  it('refuses a stale plan after an audio duration changed', () => {
    const h = harness();
    const prepared = prepare(TWO_BLOCKS, h);
    if (!prepared.ok) throw new Error('expected a plan');
    h.editorStore.updateProject({
      ...h.project,
      assets: h.project.assets.map((asset) =>
        asset.id === AUDIO_IDS[0] && asset.kind === 'audio'
          ? { ...asset, durationMs: 9999 }
          : asset,
      ),
    } as Project);

    expect(() =>
      commitMultiSceneDialoguePreview(prepared.preview, {
        editorStore: h.editorStore,
        shotStore: h.shotStore,
        service: new MultiSceneDialogueService(),
      }),
    ).toThrow(MultiSceneActionError);
    expect(h.editorStore.getSnapshot()!.project.shots).toHaveLength(
      h.project.shots.length,
    );
  });

  it('refuses a stale plan after Undo/Redo', () => {
    const h = harness();
    const prepared = prepare(TWO_BLOCKS, h);
    if (!prepared.ok) throw new Error('expected a plan');
    h.editorStore.updateProject({ ...h.project, name: 'First edit' });
    h.editorStore.undo();
    h.editorStore.redo();
    expect(() =>
      commitMultiSceneDialoguePreview(prepared.preview, {
        editorStore: h.editorStore,
        shotStore: h.shotStore,
        service: new MultiSceneDialogueService(),
      }),
    ).toThrow(MultiSceneActionError);
  });

  it('cannot generate a second batch from the same confirmation', () => {
    const h = harness();
    const prepared = prepare(TWO_BLOCKS, h);
    if (!prepared.ok) throw new Error('expected a plan');
    const options = {
      editorStore: h.editorStore,
      shotStore: h.shotStore,
      service: new MultiSceneDialogueService(),
    };
    commitMultiSceneDialoguePreview(prepared.preview, options);
    expect(() =>
      commitMultiSceneDialoguePreview(prepared.preview, options),
    ).toThrow(MultiSceneActionError);
    expect(h.editorStore.getSnapshot()!.project.shots).toHaveLength(
      h.project.shots.length + 2,
    );
    expect(h.editorStore.history.getSnapshot().undoCount).toBe(1);
  });
});
