import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  LayerService,
  PositionProjectService,
  ProjectSchema,
  ShotService,
  recognizePositionChain,
} from '../../src/domain';
import { ProjectService } from '../../src/main/services/ProjectService';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { LayerStore } from '../../src/renderer/stores/layerStore';
import { PositionStore } from '../../src/renderer/stores/positionStore';
import { buildProject, IDS } from '../unit/domain/testProject';

const BASE = { x: 500, y: 600 };
const B = { x: 700, y: 800 };
const C = { x: 900, y: 1_000 };
const D = { x: 1_100, y: 300 };
const E = { x: 1_300, y: 350 };
const MOVE_A = '71000000-0000-4000-8000-000000000001';
const MOVE_B = '71000000-0000-4000-8000-000000000002';
const SHAKE = '71000000-0000-4000-8000-000000000003';
const AUDIO_ASSET = '71000000-0000-4000-8000-000000000004';
const AUDIO_CLIP = '71000000-0000-4000-8000-000000000005';
const DIALOGUE = '71000000-0000-4000-8000-000000000006';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

function move(
  id: string,
  startMs: number,
  endMs: number,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  return {
    id,
    type: 'move' as const,
    layerId: IDS.layerAsset,
    startMs,
    endMs,
    from,
    to,
    easing: 'linear' as const,
  };
}

function lifecycleProject() {
  const project = buildProject();
  const shot = project.shots[0]!;
  return ProjectSchema.parse({
    ...project,
    assets: [
      ...project.assets,
      {
        id: AUDIO_ASSET,
        kind: 'audio' as const,
        name: 'Dialogue audio',
        relativePath: 'audio/dialogue.wav',
        mimeType: 'audio/wav',
        durationMs: 3_000,
      },
    ],
    shots: [
      {
        ...shot,
        audioClips: [
          {
            id: AUDIO_CLIP,
            name: 'Dialogue clip',
            assetId: AUDIO_ASSET,
            startMs: 0,
            endMs: 800,
            offsetMs: 0,
            volume: 1,
          },
        ],
        dialogues: [
          {
            id: DIALOGUE,
            characterId: IDS.character,
            voiceProfileId: IDS.voiceProfile,
            audioClipId: AUDIO_CLIP,
            subtitleStyleId: IDS.subtitle,
            startMs: 0,
            endMs: 800,
            text: 'Keep this dialogue.',
          },
        ],
        timelineEvents: [
          move(MOVE_A, 0, 1_000, BASE, B),
          move(MOVE_B, 1_000, 2_000, B, C),
          {
            id: SHAKE,
            type: 'shake' as const,
            layerId: IDS.layerAsset,
            startMs: 250,
            endMs: 750,
            amplitudeX: 10,
            amplitudeY: 4,
            frequencyHz: 2,
          },
        ],
      },
    ],
  });
}

function eventsFor(project: ReturnType<typeof lifecycleProject>, layerId = IDS.layerAsset) {
  return project.shots[0]!.timelineEvents.filter(
    (event) => event.type === 'move' && event.layerId === layerId,
  );
}

describe('PK-03 Project/History/persistence lifecycle', () => {
  it('saves and reopens the command result through the real Project service', async () => {
    const parent = await mkdtemp(
      path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-stage-pk03-'),
    );
    temporaryRoots.push(parent);
    const projectRoot = path.join(parent, 'position.pandastage');
    await mkdir(projectRoot, { recursive: true });
    const projectFile = path.join(projectRoot, 'project.json');
    const initial = lifecycleProject();
    await writeFile(projectFile, `${JSON.stringify(initial, null, 2)}\n`, 'utf8');

    const projectService = new ProjectService();
    const opened = await projectService.open(projectRoot);
    const editor = new EditorProjectStore();
    editor.open(projectRoot, opened.project);
    const shotId = opened.project.shots[0]!.id;
    const layerId = IDS.layerAsset;
    const layerStore = new LayerStore(
      editor,
      { getCurrentShotId: () => shotId },
      new LayerService({
        now: () => new Date('2026-09-21T00:00:00.000Z'),
      }),
    );
    const positionStore = new PositionStore(
      editor,
      new PositionProjectService({
        now: () => new Date('2026-09-21T00:00:00.000Z'),
      }),
    );

    layerStore.updatePosition(layerId, D);
    positionStore.updateKey(shotId, layerId, {
      timeMs: 1_000,
      position: E,
    });
    const current = editor.getSnapshot()!;
    expect(current.revision).toBe(2);
    expect(editor.history.getSnapshot().undoCount).toBe(2);

    await projectService.save(projectRoot, current.project, current.revision);
    const reopened = await projectService.open(projectRoot);
    const reopenedShot = reopened.project.shots[0]!;
    const reopenedLayer = reopenedShot.layers.find(
      (layer) => layer.id === layerId,
    )!;
    const recognition = recognizePositionChain({
      shot: reopenedShot,
      layer: reopenedLayer,
    });

    expect(reopened.project.schemaVersion).toBe(initial.schemaVersion);
    expect(reopened.migrated).toBe(false);
    expect(recognition.status).toBe('editable');
    if (recognition.status === 'editable') {
      expect(recognition.chain.points).toEqual([
        { timeMs: 0, position: D, kind: 'base' },
        { timeMs: 1_000, position: E, kind: 'key' },
        { timeMs: 2_000, position: C, kind: 'key' },
      ]);
    }
    expect(reopenedShot.dialogues).toEqual(initial.shots[0]!.dialogues);
    expect(reopenedShot.audioClips).toEqual(initial.shots[0]!.audioClips);
    expect(reopenedShot.timelineEvents.find((event) => event.id === SHAKE)).toEqual(
      initial.shots[0]!.timelineEvents.find((event) => event.id === SHAKE),
    );

    const serialized = JSON.parse(await readFile(projectFile, 'utf8')) as Record<
      string,
      unknown
    >;
    expect(serialized).not.toHaveProperty('history');
    expect(serialized).not.toHaveProperty('undoStack');
    expect(serialized).not.toHaveProperty('selectedLayerId');
    expect(JSON.stringify(serialized)).not.toContain('KeyframeTrack');

    const reopenedEditor = new EditorProjectStore();
    reopenedEditor.open(projectRoot, reopened.project);
    expect(reopenedEditor.history.getSnapshot()).toMatchObject({
      undoCount: 0,
      redoCount: 0,
    });
  });

  it('duplicates a managed Position chain without cross-Shot layer or event references', () => {
    const initial = lifecycleProject();
    const source = initial.shots[0]!;
    let idIndex = 0;
    const shotService = new ShotService({
      now: () => new Date('2026-09-21T00:00:00.000Z'),
      createId: () =>
        `72000000-0000-4000-8000-${String(++idIndex).padStart(12, '0')}`,
    });

    const duplicated = shotService.duplicate(initial, source.id);
    const copy = duplicated.shots[1]!;
    const originalLayerIds = new Set(source.layers.map((layer) => layer.id));
    const copyLayerIds = new Set(copy.layers.map((layer) => layer.id));

    expect(copy.timelineEvents).toHaveLength(source.timelineEvents.length);
    expect(copy.timelineEvents.every((event) => copyLayerIds.has(event.layerId))).toBe(
      true,
    );
    expect(
      copy.timelineEvents.some((event) => originalLayerIds.has(event.layerId)),
    ).toBe(false);
    const copiedTarget = copy.layers.find(
      (layer) => layer.id !== copy.backgroundLayerId,
    )!;
    const recognition = recognizePositionChain({
      shot: copy,
      layer: copiedTarget,
    });
    expect(recognition.status).toBe('editable');
    if (recognition.status === 'editable') {
      expect(recognition.chain.points).toEqual([
        { timeMs: 0, position: BASE, kind: 'base' },
        { timeMs: 1_000, position: B, kind: 'key' },
        { timeMs: 2_000, position: C, kind: 'key' },
      ]);
    }
  });

  it('keeps Layer deletion, duration bounds, and existing History lifecycle intact', () => {
    const initial = lifecycleProject();
    const shot = initial.shots[0]!;
    const layerStoreService = new LayerService({
      now: () => new Date('2026-09-21T00:00:00.000Z'),
    });
    const editor = new EditorProjectStore();
    editor.open('D:\\pk-03-delete.pandastage', initial);
    const layerStore = new LayerStore(
      editor,
      { getCurrentShotId: () => shot.id },
      layerStoreService,
    );

    layerStore.deleteLayer(IDS.layerAsset);
    const deleted = editor.getSnapshot()!.project.shots[0]!;
    expect(deleted.layers.some((layer) => layer.id === IDS.layerAsset)).toBe(false);
    expect(deleted.timelineEvents.some((event) => event.layerId === IDS.layerAsset)).toBe(
      false,
    );
    expect(deleted.timelineEvents.some((event) => event.id === SHAKE)).toBe(false);
    expect(editor.history.getSnapshot().undoCount).toBe(1);
    expect(editor.undo()).toBe(true);
    expect(editor.getSnapshot()!.project.shots[0]!.layers).toHaveLength(
      shot.layers.length,
    );
    expect(editor.redo()).toBe(true);
    expect(editor.getSnapshot()!.project.shots[0]!.layers).toHaveLength(
      shot.layers.length - 1,
    );

    const shotService = new ShotService({
      now: () => new Date('2026-09-21T00:00:00.000Z'),
    });
    expect(() => shotService.setDuration(initial, shot.id, 1_500)).toThrow(
      expect.objectContaining({ code: 'SHOT_CONTENT_OUT_OF_RANGE' }),
    );
    const longer = shotService.setDuration(initial, shot.id, 2_000);
    expect(eventsFor(longer).map((event) => event.endMs)).toEqual([1_000, 2_000]);
  });
});
