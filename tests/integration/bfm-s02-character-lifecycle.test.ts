import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CharacterService,
  evaluateShotAtTime,
  LayerService,
  ProjectSchema,
  resolveLayerVisualParts,
  ShotService,
} from '../../src/domain';
import { ProjectService } from '../../src/main/services/ProjectService';
import { PROJECT_FILE_NAME } from '../../src/main/services/ProjectFileSystemService';
import { CharacterStore } from '../../src/renderer/stores/characterStore';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { LayerStore } from '../../src/renderer/stores/layerStore';
import { ShotStore } from '../../src/renderer/stores/shotStore';
import { buildProject, IDS } from '../unit/domain/testProject';

const temporaryParents: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryParents.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('BFM-S02 composite Character lifecycle', () => {
  it('saves/reopens one composite definition and preserves Shot-copy and appearance deletion ownership', async () => {
    const parent = await mkdtemp(
      path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-stage-bfm-s02-'),
    );
    temporaryParents.push(parent);
    const projectRoot = path.join(parent, 'composite-character.pandastage');
    const projectService = new ProjectService();
    const created = await projectService.create(projectRoot, {
      name: 'BFM S02 lifecycle',
    });

    const base = buildProject();
    const project = ProjectSchema.parse({
      ...base,
      id: created.project.id,
      name: created.project.name,
      createdAt: created.project.createdAt,
      updatedAt: created.project.updatedAt,
      shots: [base.shots[0]!],
      characters: [
        {
          ...base.characters[0]!,
          mode: 'composite',
          bodyAssetId: IDS.assetBg,
          facePlacement: { offsetX: 10, offsetY: -5, scale: 1 },
          head: {
            assetId: IDS.assetChar2,
            placement: { offsetX: 6, offsetY: -3, scale: 0.9 },
            pivot: { x: 320, y: 300 },
          },
        },
      ],
    });
    await projectService.save(projectRoot, project);

    const editor = new EditorProjectStore();
    editor.open(projectRoot, project);
    const characters = new CharacterStore(
      editor,
      new CharacterService({
        now: () => new Date('2026-08-02T00:00:00.000Z'),
      }),
    );
    characters.applyCompositeUpdate(IDS.character, {
      bodyAssetId: IDS.assetChar2,
      facePlacement: { offsetX: 32, offsetY: -14, scale: 1.2 },
      expressionAssets: [
        { expressionId: IDS.expressionNormal, assetId: IDS.assetChar2 },
        { expressionId: IDS.expressionAngry, assetId: IDS.assetChar },
      ],
      mouthOpenAssetId: IDS.assetChar,
      head: {
        assetId: IDS.assetChar,
        placement: { offsetX: 18, offsetY: 9, scale: 1.1 },
        pivot: { x: 280, y: 260 },
      },
    });
    const createdWithHead = characters.createComposite({
      name: 'Created Head character',
      bodyAssetId: IDS.assetBg,
      facePlacement: { offsetX: 3, offsetY: -2, scale: 0.95 },
      head: {
        assetId: IDS.assetChar2,
        placement: { offsetX: -7, offsetY: 12, scale: 1.05 },
        pivot: { x: 300, y: 270 },
      },
      expressions: [{ name: 'Normal', assetId: IDS.assetChar }],
    });
    await projectService.save(
      projectRoot,
      createdWithHead,
      editor.getSnapshot()!.revision,
    );

    const reopened = await projectService.open(projectRoot);
    expect(reopened.project.characters[0]).toMatchObject({
      id: IDS.character,
      mode: 'composite',
      bodyAssetId: IDS.assetChar2,
      facePlacement: { offsetX: 32, offsetY: -14, scale: 1.2 },
      mouthOpenAssetId: IDS.assetChar,
      head: {
        assetId: IDS.assetChar,
        placement: { offsetX: 18, offsetY: 9, scale: 1.1 },
        pivot: { x: 280, y: 260 },
      },
    });
    expect(reopened.project.characters[0]!.expressions).toEqual([
      {
        id: IDS.expressionNormal,
        name: base.characters[0]!.expressions[0]!.name,
        assetId: IDS.assetChar2,
      },
      {
        id: IDS.expressionAngry,
        name: base.characters[0]!.expressions[1]!.name,
        assetId: IDS.assetChar,
      },
    ]);
    const createdCharacterId = createdWithHead.characters.at(-1)!.id;
    expect(
      reopened.project.characters.find(
        (character) => character.id === createdCharacterId,
      ),
    ).toMatchObject({
      mode: 'composite',
      head: {
        assetId: IDS.assetChar2,
        placement: { offsetX: -7, offsetY: 12, scale: 1.05 },
        pivot: { x: 300, y: 270 },
      },
    });

    const shots = new ShotStore(editor, new ShotService());
    const copiedProject = shots.duplicate(IDS.shot);
    const copiedShot = copiedProject.shots.find(
      (shot) => shot.id !== IDS.shot,
    )!;
    const copiedCharacterLayer = copiedShot.layers.find(
      (layer) =>
        layer.source.kind === 'character' &&
        layer.source.characterId === IDS.character,
    )!;
    expect(copiedCharacterLayer.source).toEqual({
      kind: 'character',
      characterId: IDS.character,
      expressionId: IDS.expressionNormal,
    });
    expect(copiedCharacterLayer.id).not.toBe(IDS.layerChar);

    const copiedLayerStore = new LayerStore(
      editor,
      { getCurrentShotId: () => copiedShot.id },
      new LayerService(),
    );
    copiedLayerStore.deleteLayer(copiedCharacterLayer.id);
    const afterDelete = editor.getSnapshot()!.project;
    expect(afterDelete.characters[0]!.mode).toBe('composite');
    expect(
      afterDelete.shots[0]!.layers.some(
        (layer) => layer.id === IDS.layerChar,
      ),
    ).toBe(true);
    expect(
      afterDelete.shots[1]!.layers.some(
        (layer) => layer.id === copiedCharacterLayer.id,
      ),
    ).toBe(false);
    await projectService.save(
      projectRoot,
      afterDelete,
      editor.getSnapshot()!.revision,
    );
    const reopenedAfterLifecycle = await projectService.open(projectRoot);
    expect(reopenedAfterLifecycle.project.characters[0]!.mode).toBe(
      'composite',
    );
    expect(reopenedAfterLifecycle.project.shots).toHaveLength(2);
    expect(
      reopenedAfterLifecycle.project.shots[0]!.layers.some(
        (layer) => layer.id === IDS.layerChar,
      ),
    ).toBe(true);
    shots.dispose();
  });

  it('opens a persisted v8 composite as v9 without changing Body/Face visuals', async () => {
    const parent = await mkdtemp(
      path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-stage-v8-migration-'),
    );
    temporaryParents.push(parent);
    const projectRoot = path.join(parent, 'v8-composite.pandastage');
    const projectService = new ProjectService();
    const created = await projectService.create(projectRoot, {
      name: 'v8 migration acceptance',
    });
    const base = buildProject();
    const current = ProjectSchema.parse({
      ...base,
      id: created.project.id,
      name: created.project.name,
      createdAt: created.project.createdAt,
      updatedAt: created.project.updatedAt,
      characters: [
        {
          ...base.characters[0]!,
          mode: 'composite',
          bodyAssetId: IDS.assetBg,
          facePlacement: { offsetX: 21, offsetY: -13, scale: 0.85 },
        },
      ],
    });
    const v8 = { ...current, schemaVersion: 8 as const };
    const shot = current.shots[0]!;
    const evaluated = evaluateShotAtTime(shot, 0, current).layers.find(
      (layer) => layer.id === IDS.layerChar,
    );
    if (!evaluated) throw new Error('Expected a Character layer.');
    const expectedVisual = resolveLayerVisualParts(current, shot, evaluated);

    await writeFile(
      path.join(projectRoot, PROJECT_FILE_NAME),
      JSON.stringify(v8),
      'utf8',
    );
    const opened = await projectService.open(projectRoot);

    expect(opened).toMatchObject({ migrated: true, sourceVersion: 8 });
    expect(opened.project).toEqual(current);
    expect(opened.project.characters[0]).not.toHaveProperty('head');
    const migratedShot = opened.project.shots[0]!;
    const migratedEvaluated = evaluateShotAtTime(
      migratedShot,
      0,
      opened.project,
    ).layers.find((layer) => layer.id === IDS.layerChar);
    if (!migratedEvaluated) throw new Error('Expected a migrated Character layer.');
    expect(
      resolveLayerVisualParts(opened.project, migratedShot, migratedEvaluated),
    ).toEqual(expectedVisual);
  });
});
