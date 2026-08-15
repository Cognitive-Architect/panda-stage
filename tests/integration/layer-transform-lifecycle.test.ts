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
import exampleProject from '../../demo-project/project-v1.example.json';
import {
  LayerService,
  ProjectSchema,
} from '../../src/domain';
import { ProjectService } from '../../src/main/services/ProjectService';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { LayerStore } from '../../src/renderer/stores/layerStore';
import { LayerSelectionStore } from '../../src/renderer/stores/selectionStore';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

describe('Day 23 layer transform lifecycle', () => {
  it('transforms, flips, orders, locks, saves, reopens, then deletes and clears selection', async () => {
    const parent = await mkdtemp(
      path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-stage-day23-'),
    );
    temporaryRoots.push(parent);
    const projectRoot = path.join(parent, 'transform.pandastage');
    const projectFile = path.join(projectRoot, 'project.json');
    const initial = ProjectSchema.parse(exampleProject);
    const shot = initial.shots[0]!;
    const target = shot.layers[1]!;
    const extraId = 'd2300000-0000-4000-8000-000000000010';
    const withExtra = ProjectSchema.parse({
      ...initial,
      shots: [
        {
          ...shot,
          layers: [
            ...shot.layers,
            {
              ...target,
              id: extraId,
              name: 'Extra content',
              zIndex: 2,
            },
          ],
        },
      ],
    });
    const layerService = new LayerService({
      now: () => new Date('2026-07-26T05:00:00.000Z'),
    });
    const transformed = layerService.updateTransform(
      withExtra,
      shot.id,
      target.id,
      {
        x: 812.5,
        y: 431.25,
        scale: 1.375,
        rotationDeg: 450,
        opacity: 0.65,
        flipX: true,
      },
    );
    const ordered = layerService.reorder(
      transformed,
      shot.id,
      target.id,
      'front',
    );
    const locked = layerService.setLocked(
      ordered,
      shot.id,
      target.id,
      true,
    );
    const projectService = new ProjectService();

    await mkdir(projectRoot, { recursive: true });
    await writeFile(
      projectFile,
      `${JSON.stringify(withExtra, null, 2)}\n`,
      'utf8',
    );
    await projectService.save(projectRoot, locked, 3);
    const reopened = await projectService.open(projectRoot);
    const reopenedShot = reopened.project.shots[0]!;
    const reopenedLayer = reopenedShot.layers.find(
      (layer) => layer.id === target.id,
    );

    expect(reopened).toMatchObject({
      migrated: false,
      sourceVersion: 6,
      project: { schemaVersion: 6 },
    });
    expect(reopenedLayer).toMatchObject({
      anchor: 'center',
      x: 812.5,
      y: 431.25,
      scaleX: 1.375,
      scaleY: 1.375,
      rotationDeg: 90,
      opacity: 0.65,
      flipX: true,
      locked: true,
      zIndex: 2,
    });
    expect(reopenedShot.layers.map((layer) => layer.id)).toEqual([
      shot.backgroundLayerId,
      extraId,
      target.id,
    ]);
    expect(reopenedShot.layers.map((layer) => layer.zIndex)).toEqual([
      0, 1, 2,
    ]);

    const editor = new EditorProjectStore();
    editor.open(projectRoot, reopened.project);
    const currentShot = {
      getCurrentShotId: () => shot.id,
      subscribe: () => () => undefined,
    };
    const layerStore = new LayerStore(
      editor,
      currentShot,
      layerService,
    );
    const selection = new LayerSelectionStore(editor, currentShot);
    selection.select(target.id);
    layerStore.setLocked(target.id, false);
    layerStore.deleteLayer(target.id);

    expect(selection.getSelectedLayerId()).toBeNull();
    expect(editor.getSnapshot()).toMatchObject({
      dirty: true,
      revision: 2,
    });
    const deletion = editor.getSnapshot()!;
    await projectService.save(
      projectRoot,
      deletion.project,
      deletion.revision,
    );
    const deletedReopen = await projectService.open(projectRoot);
    expect(
      deletedReopen.project.shots[0]!.layers.some(
        (layer) => layer.id === target.id,
      ),
    ).toBe(false);
    expect(
      deletedReopen.project.shots[0]!.timelineEvents.some(
        (event) => event.layerId === target.id,
      ),
    ).toBe(false);
    const serialized = JSON.parse(await readFile(projectFile, 'utf8'));
    expect(serialized).not.toHaveProperty('selectedLayerId');
    expect(JSON.stringify(serialized)).not.toContain('selectedLayerId');
    selection.dispose();
  });
});
