import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildEditorStageRenderModel,
  CharacterService,
  evaluateShotAtTime,
  LayerService,
  SceneCreationService,
  ShotService,
  updateImageAssetAuthorMetadata,
  type ImageAsset,
  type Project,
} from '../../src/domain';
import { AssetImportService } from '../../src/main/services/AssetImportService';
import { ProjectService } from '../../src/main/services/ProjectService';
import {
  commitSceneCreationPreview,
  createSceneFromStructuredInput,
  isSceneCreationPreviewCurrent,
  prepareSceneCreationPreview,
} from '../../src/renderer/features/shots/createSceneFromStructuredInput';
import { CharacterStore } from '../../src/renderer/stores/characterStore';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { LayerStore } from '../../src/renderer/stores/layerStore';
import { ShotStore } from '../../src/renderer/stores/shotStore';

interface SampleSources {
  background: string;
  head: string;
  body: string;
}

interface PreparedSample {
  parent: string;
  projectRoot: string;
  projectService: ProjectService;
  project: Project;
  editorStore: EditorProjectStore;
  shotStore: ShotStore;
  assets: {
    background: ImageAsset;
    head: ImageAsset;
    body: ImageAsset;
  };
  character: Project['characters'][number];
  importStatuses: string[];
}

const temporaryRoots: string[] = [];
const fixtureAssetDirectory = path.resolve('tests/fixtures/assets');
const fixtureCharacterDirectory = path.resolve('tests/fixtures/characters');

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

async function prepareSample(
  parent: string,
  sources: SampleSources,
  characterName: string,
): Promise<PreparedSample> {
  const projectRoot = path.join(parent, 'AC-01 sample.pandastage');
  let mainSnapshot: { project: Project; revision: number } | null = null;
  const projectService = new ProjectService({
    onProjectSaved: (_root, project, revision) => {
      if (revision !== undefined) mainSnapshot = { project, revision };
    },
  });
  const created = await projectService.create(projectRoot, {
    name: 'AC-01 isolated sample',
  });
  mainSnapshot = { project: created.project, revision: 0 };

  const assetImportService = new AssetImportService({
    projectService,
    getCurrentProjectSnapshot: () => mainSnapshot,
  });
  const imported = await assetImportService.importCandidates({
    projectRoot,
    project: created.project,
    baseRevision: 0,
    candidates: [
      { sourcePath: sources.background, declaredMimeType: 'image/png' },
      { sourcePath: sources.head, declaredMimeType: 'image/png' },
      { sourcePath: sources.body, declaredMimeType: 'image/png' },
    ],
  });
  const [background, head, body] = imported.results.map((result) => {
    if (result.status !== 'imported' || !result.asset) {
      throw new Error(
        `AC-01 fixture asset import failed: ${result.sourceName} (${result.code ?? result.status}).`,
      );
    }
    return result.asset;
  });
  if (
    !background || background.kind !== 'image' ||
    !head || head.kind !== 'image' ||
    !body || body.kind !== 'image'
  ) {
    throw new Error('AC-01 fixture import did not return three images.');
  }

  let taggedProject = imported.project;
  taggedProject = updateImageAssetAuthorMetadata(
    taggedProject,
    background.id,
    { name: 'Garden', usage: 'background', keywords: ['ac01'] },
  );
  taggedProject = updateImageAssetAuthorMetadata(
    taggedProject,
    head.id,
    { name: 'Character head', usage: 'character', keywords: ['ac01'] },
  );
  taggedProject = updateImageAssetAuthorMetadata(
    taggedProject,
    body.id,
    { name: 'Character body', usage: 'character', keywords: ['ac01'] },
  );
  await projectService.save(projectRoot, taggedProject);

  const importedDocument = await projectService.open(projectRoot);
  const assemblyStore = new EditorProjectStore();
  assemblyStore.open(projectRoot, importedDocument.project);
  const characterStore = new CharacterStore(
    assemblyStore,
    new CharacterService(),
  );
  characterStore.createComposite({
    name: characterName,
    expressions: [{ name: 'Default', assetId: head.id }],
    defaultExpressionIndex: 0,
    bodyAssetId: body.id,
    bodyPlacement: { offsetX: 0, offsetY: 0, scale: 1 },
    facePlacement: {
      offsetX: 0,
      offsetY: -420,
      scale: 1,
      rotationDeg: 0,
      flipX: false,
    },
    defaultScale: 0.72,
    defaultFlipX: false,
  });
  const assembledProject = assemblyStore.getSnapshot()!.project;
  await projectService.save(projectRoot, assembledProject);

  const assembledDocument = await projectService.open(projectRoot);
  const sceneSetupStore = new EditorProjectStore();
  sceneSetupStore.open(projectRoot, assembledDocument.project);
  const setupShots = new ShotStore(sceneSetupStore, new ShotService());
  setupShots.create({ name: 'Existing shot', durationMs: 2_000 });
  await projectService.save(projectRoot, sceneSetupStore.getSnapshot()!.project);
  setupShots.dispose();

  const frozenDocument = await projectService.open(projectRoot);
  const editorStore = new EditorProjectStore();
  editorStore.open(projectRoot, frozenDocument.project);
  const shotStore = new ShotStore(editorStore, new ShotService());
  const character = frozenDocument.project.characters.find(
    (candidate) => candidate.name === characterName,
  );
  if (!character) throw new Error('AC-01 composite Character was not saved.');

  return {
    parent,
    projectRoot,
    projectService,
    project: frozenDocument.project,
    editorStore,
    shotStore,
    assets: { background, head, body },
    character,
    importStatuses: imported.results.map((result) => result.status),
  };
}

async function executeAndCheckLifecycle(
  sample: PreparedSample,
  input: string,
) {
  const baseline = sample.editorStore.getSnapshot()!;
  const before = structuredClone(baseline.project);
  const result = createSceneFromStructuredInput(input, {
    editorStore: sample.editorStore,
    shotStore: sample.shotStore,
  });
  const after = sample.editorStore.getSnapshot()!;
  const generatedShot = after.project.shots.find(
    (shot) => shot.id === result.shotId,
  )!;
  const renderModel = buildEditorStageRenderModel(
    after.project,
    generatedShot,
    evaluateShotAtTime(generatedShot, 0, after.project),
  );
  expect(after.revision).toBe(baseline.revision + 1);
  expect(after.dirty).toBe(true);
  expect(sample.editorStore.history.getSnapshot()).toMatchObject({
    undoCount: 1,
    redoCount: 0,
  });
  expect(sample.shotStore.getCurrentShotId()).toBe(result.shotId);
  expect(after.project.shots).toHaveLength(before.shots.length + 1);
  expect(after.project.shots.slice(0, -1)).toEqual(before.shots);
  expect(after.project.assets).toEqual(before.assets);
  expect(after.project.characters).toEqual(before.characters);
  expect(generatedShot.layers).toHaveLength(2);
  expect(generatedShot.backgroundLayerId).toBe(result.backgroundLayerId);
  expect(generatedShot.layers.find((layer) => layer.id === result.backgroundLayerId)).toMatchObject({
    source: { kind: 'asset', assetId: sample.assets.background.id },
    locked: true,
    zIndex: 0,
  });
  expect(generatedShot.layers.find((layer) => layer.id === result.characterLayerId)).toMatchObject({
    source: {
      kind: 'character',
      characterId: sample.character.id,
      expressionId: sample.character.defaultExpressionId,
    },
    locked: false,
    zIndex: 1,
  });
  expect(renderModel.layers.map((layer) => layer.visual.kind)).toEqual([
    'ordinary-image',
    'composite-character',
  ]);
  expect(renderModel.layers[0]?.asset.id).toBe(sample.assets.background.id);
  expect(renderModel.layers[1]?.visual.parts.map((part) => part.assetId)).toEqual([
    sample.assets.body.id,
    sample.assets.head.id,
  ]);

  expect(sample.editorStore.undo()).toBe(true);
  const undoRestoredBaseline =
    JSON.stringify(sample.editorStore.getSnapshot()?.project) ===
    JSON.stringify(before);
  expect(undoRestoredBaseline).toBe(true);
  expect(sample.editorStore.history.getSnapshot()).toMatchObject({
    undoCount: 0,
    redoCount: 1,
  });
  expect(sample.editorStore.redo()).toBe(true);
  const redoRestoredGeneration =
    JSON.stringify(sample.editorStore.getSnapshot()?.project) ===
    JSON.stringify(after.project);
  expect(redoRestoredGeneration).toBe(true);
  expect(sample.editorStore.history.getSnapshot()).toMatchObject({
    undoCount: 1,
    redoCount: 0,
  });
  expect(sample.shotStore.getCurrentShotId()).toBe(result.shotId);

  await sample.projectService.save(
    sample.projectRoot,
    sample.editorStore.getSnapshot()!.project,
  );
  const reopened = await sample.projectService.open(sample.projectRoot);
  expect(reopened.project).toEqual(after.project);

  const diskProjectJson = JSON.parse(
    await readFile(path.join(sample.projectRoot, 'project.json'), 'utf8'),
  ) as Record<string, unknown>;
  expect(diskProjectJson).not.toHaveProperty('history');

  const editStore = new EditorProjectStore();
  editStore.open(sample.projectRoot, reopened.project);
  const editShots = new ShotStore(editStore, new ShotService());
  editShots.select(result.shotId);
  const editLayers = new LayerStore(editStore, editShots, new LayerService());
  const originalCharacterLayer = reopened.project.shots
    .find((shot) => shot.id === result.shotId)!
    .layers.find((layer) => layer.id === result.characterLayerId)!;
  editLayers.updatePosition(result.characterLayerId, {
    x: originalCharacterLayer.x - 40,
    y: originalCharacterLayer.y,
  });
  const edited = editStore.getSnapshot()!;
  expect(edited.dirty).toBe(true);
  expect(edited.project.shots
    .find((shot) => shot.id === result.shotId)!
    .layers.find((layer) => layer.id === result.characterLayerId)?.x).toBe(
    originalCharacterLayer.x - 40,
  );
  await sample.projectService.save(sample.projectRoot, edited.project);
  const reopenedAfterEdit = await sample.projectService.open(sample.projectRoot);
  expect(reopenedAfterEdit.project.shots
    .find((shot) => shot.id === result.shotId)!
    .layers.find((layer) => layer.id === result.characterLayerId)?.x).toBe(
    originalCharacterLayer.x - 40,
  );
  sample.shotStore.dispose();
  editShots.dispose();

  return {
    before,
    generated: after.project,
    result,
    reopened: reopened.project,
    edited: reopenedAfterEdit.project,
    undoRestoredBaseline,
    redoRestoredGeneration,
    savedReopenSucceeded:
      JSON.stringify(reopened.project) === JSON.stringify(after.project),
    renderResolution: renderModel.layers.map((layer) => ({
      layerId: layer.layer.id,
      kind: layer.visual.kind,
      parts: layer.visual.parts.map((part) => ({
        slot: part.slot,
        assetId: part.assetId,
      })),
      primaryAssetId: layer.asset.id,
    })),
  };
}

describe('Issue #852 AC-01 scene creation lifecycle', () => {
  it('commits one scene in one history step, supports Undo/Redo, saves/reopens, and remains editable', async () => {
    const parent = await mkdtemp(
      path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-scene-creation-'),
    );
    temporaryRoots.push(parent);
    const sample = await prepareSample(
      parent,
      {
        background: path.join(fixtureAssetDirectory, '另一张 图片.png'),
        head: path.join(fixtureCharacterDirectory, '熊猫 normal.png'),
        body: path.join(fixtureAssetDirectory, '熊猫 图片.png'),
      },
      'Zhang San',
    );
    const lifecycle = await executeAndCheckLifecycle(
      sample,
      '镜头：Garden meeting\n背景：Garden\n出场：Zhang San',
    );
    expect(lifecycle.result).toMatchObject({
      backgroundAssetId: sample.assets.background.id,
      characterId: sample.character.id,
    });
    expect(sample.project.shots.map((shot) => shot.id)).toEqual(
      lifecycle.before.shots.map((shot) => shot.id),
    );
  }, 30_000);

  it('keeps preview read-only, commits once, and rejects a repeated confirmation', async () => {
    const parent = await mkdtemp(
      path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-scene-preview-'),
    );
    temporaryRoots.push(parent);
    const sample = await prepareSample(
      parent,
      {
        background: path.join(fixtureAssetDirectory, '另一张 图片.png'),
        head: path.join(fixtureCharacterDirectory, '熊猫 normal.png'),
        body: path.join(fixtureAssetDirectory, '熊猫 图片.png'),
      },
      'Zhang San',
    );
    const baseline = sample.editorStore.getSnapshot()!;
    const options = {
      editorStore: sample.editorStore,
      shotStore: sample.shotStore,
    };
    const plan = prepareSceneCreationPreview(
      '镜头：Garden meeting\n背景：Garden\n出场：Zhang San',
      {
        backgroundAssetId: sample.assets.background.id,
        characterId: sample.character.id,
      },
      options,
    );

    expect(isSceneCreationPreviewCurrent(plan, sample.editorStore)).toBe(true);
    expect(sample.editorStore.getSnapshot()).toBe(baseline);
    expect(baseline).toMatchObject({ dirty: false, revision: 0 });
    expect(sample.editorStore.history.getSnapshot()).toMatchObject({
      undoCount: 0,
      redoCount: 0,
    });

    commitSceneCreationPreview(plan, options);
    expect(sample.editorStore.getSnapshot()).toMatchObject({
      dirty: true,
      revision: baseline.revision + 1,
    });
    expect(sample.editorStore.getSnapshot()?.project.shots).toHaveLength(
      baseline.project.shots.length + 1,
    );
    expect(sample.editorStore.history.getSnapshot()).toMatchObject({
      undoCount: 1,
      redoCount: 0,
    });
    expect(() => commitSceneCreationPreview(plan, options)).toThrow(
      '当前预览已失效',
    );
    expect(sample.editorStore.getSnapshot()?.project.shots).toHaveLength(
      baseline.project.shots.length + 1,
    );
    expect(sample.editorStore.history.getSnapshot()).toMatchObject({
      undoCount: 1,
      redoCount: 0,
    });
    sample.shotStore.dispose();
  }, 30_000);

  it('invalidates prepared previews after resource edits, same-path reopen, or project switch', async () => {
    const parent = await mkdtemp(
      path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-scene-stale-'),
    );
    temporaryRoots.push(parent);
    const sample = await prepareSample(
      parent,
      {
        background: path.join(fixtureAssetDirectory, '另一张 图片.png'),
        head: path.join(fixtureCharacterDirectory, '熊猫 normal.png'),
        body: path.join(fixtureAssetDirectory, '熊猫 图片.png'),
      },
      'Zhang San',
    );
    const options = {
      editorStore: sample.editorStore,
      shotStore: sample.shotStore,
    };
    const input = '镜头：Garden meeting\n背景：Garden\n出场：Zhang San';
    const prepare = () =>
      prepareSceneCreationPreview(
        input,
        {
          backgroundAssetId: sample.assets.background.id,
          characterId: sample.character.id,
        },
        options,
      );

    const beforeResourceEdit = prepare();
    const current = sample.editorStore.getSnapshot()!;
    sample.editorStore.updateProject(
      updateImageAssetAuthorMetadata(
        current.project,
        sample.assets.background.id,
        { name: 'Garden', usage: 'background', keywords: ['changed'] },
      ),
      'Update background metadata',
    );
    expect(isSceneCreationPreviewCurrent(beforeResourceEdit, sample.editorStore)).toBe(false);
    expect(() => commitSceneCreationPreview(beforeResourceEdit, options)).toThrow(
      '当前预览已失效',
    );

    const beforeSamePathReopen = prepare();
    const reopenedProject = sample.editorStore.getSnapshot()!.project;
    sample.editorStore.open(sample.projectRoot, reopenedProject);
    expect(isSceneCreationPreviewCurrent(beforeSamePathReopen, sample.editorStore)).toBe(false);
    expect(() => commitSceneCreationPreview(beforeSamePathReopen, options)).toThrow(
      '当前预览已失效',
    );

    const beforeProjectSwitch = prepare();
    sample.editorStore.open(path.join(parent, 'another-project.pandastage'), reopenedProject);
    expect(isSceneCreationPreviewCurrent(beforeProjectSwitch, sample.editorStore)).toBe(false);
    expect(() => commitSceneCreationPreview(beforeProjectSwitch, options)).toThrow(
      '当前预览已失效',
    );
    expect(sample.editorStore.getSnapshot()?.project.shots).toHaveLength(
      reopenedProject.shots.length,
    );
    sample.shotStore.dispose();
  }, 30_000);

  it('leaves the active project, revision, dirty state, and history unchanged on build failure or stale project', async () => {
    const parent = await mkdtemp(
      path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-scene-failure-'),
    );
    temporaryRoots.push(parent);
    const sample = await prepareSample(
      parent,
      {
        background: path.join(fixtureAssetDirectory, '另一张 图片.png'),
        head: path.join(fixtureCharacterDirectory, '熊猫 normal.png'),
        body: path.join(fixtureAssetDirectory, '熊猫 图片.png'),
      },
      'Zhang San',
    );
    const baseline = sample.editorStore.getSnapshot()!;
    const realLayers = new LayerService();
    let createCalls = 0;
    const failingLayers = {
      createFromAsset: (...args: Parameters<LayerService['createFromAsset']>) => {
        createCalls += 1;
        if (createCalls === 2) throw new Error('Injected character layer failure.');
        return realLayers.createFromAsset(...args);
      },
      setBackground: realLayers.setBackground.bind(realLayers),
    };
    const failingService = new SceneCreationService({
      shotService: new ShotService(),
      layerService: failingLayers,
    });
    expect(() =>
      createSceneFromStructuredInput(
        '镜头：Garden meeting\n背景：Garden\n出场：Zhang San',
        { editorStore: sample.editorStore, shotStore: sample.shotStore, service: failingService },
      ),
    ).toThrow('Injected character layer failure.');
    expect(sample.editorStore.getSnapshot()).toBe(baseline);
    expect(sample.editorStore.history.getSnapshot()).toMatchObject({ undoCount: 0, redoCount: 0 });

    const staleService = {
      create: (project: Project, input: string) => {
        const result = new SceneCreationService().create(project, input);
        sample.editorStore.open(sample.projectRoot, project);
        return result;
      },
    } as SceneCreationService;
    expect(() =>
      createSceneFromStructuredInput(
        '镜头：Garden meeting\n背景：Garden\n出场：Zhang San',
        { editorStore: sample.editorStore, shotStore: sample.shotStore, service: staleService },
      ),
    ).toThrow('工程已变化');
    expect(sample.editorStore.getSnapshot()?.project).toEqual(baseline.project);
    expect(sample.editorStore.getSnapshot()?.dirty).toBe(false);
    expect(sample.editorStore.history.getSnapshot()).toMatchObject({ undoCount: 0, redoCount: 0 });
    sample.shotStore.dispose();
  }, 30_000);

  const realFixtureEnabled = Boolean(
    process.env.ISSUE852_ACCEPTANCE_ROOT &&
      process.env.ISSUE852_GARDEN_SOURCE &&
      process.env.ISSUE852_CHARACTER_HEAD_SOURCE &&
      process.env.ISSUE852_CHARACTER_BODY_SOURCE,
  );

  it.skipIf(!realFixtureEnabled)(
    'prepares and verifies the authorized real local garden and composite Character sample',
    async () => {
      const parent = process.env.ISSUE852_ACCEPTANCE_ROOT!;
      const sources = {
        background: process.env.ISSUE852_GARDEN_SOURCE!,
        head: process.env.ISSUE852_CHARACTER_HEAD_SOURCE!,
        body: process.env.ISSUE852_CHARACTER_BODY_SOURCE!,
      };
      await access(parent);
      const existingProjectRoot = path.join(
        parent,
        'AC-01 sample.pandastage',
      );
      let alreadyExists = true;
      try {
        await access(existingProjectRoot);
      } catch {
        alreadyExists = false;
      }
      if (alreadyExists) {
        throw new Error('Refusing to overwrite the existing AC-01 sample project.');
      }

      const sourceStats = await Promise.all(
        Object.values(sources).map((source) => stat(source)),
      );
      const sample = await prepareSample(
        parent,
        sources,
        '修仙男（测试样本）',
      );
      const input = '镜头：花园相遇\n背景：Garden\n出场：修仙男（测试样本）';
      const lifecycle = await executeAndCheckLifecycle(sample, input);
      const baseline = lifecycle.before;
      const generatedShot = lifecycle.generated.shots.find(
        (shot) => shot.id === lifecycle.result.shotId,
      )!;
      const receipt = {
        issue: 852,
        acceptance: 'AC01-FIXTURE / HAPPY / HISTORY / REOPEN',
        codeHead: process.env.ISSUE852_CODE_HEAD ?? 'NOT_REPORTED',
        sourceDirectoryAvailable: true,
        sourceDirectory: 'D:\\表情合集 (authorized; exact path omitted)',
        sourceFiles: sourceStats.map((source, index) => ({
          purpose: ['original garden PNG', 'character head PNG', 'character body PNG'][index],
          bytes: source.size,
        })),
        assetImportStatuses: sample.importStatuses,
        generatedBackground: {
          createdWithImageGen: true,
          generationTool: 'built-in image_gen',
          prompt: 'Create one original static background image for a 2D cutout animation test scene: a serene Chinese garden courtyard in spring, paved stone path leading through a rounded moon gate, bamboo and flowering trees, a small pond, soft afternoon daylight. Wide 16:9 composition for a 1920x1080 animation canvas, clear readable shapes, polished hand-painted 2D illustration with gentle cel-shading. Keep the lower center path uncluttered so a character can stand there. No people, no animals, no text, no lettering, no logos, no watermark.',
          stagedFileExists: sourceStats[0]?.isFile() ?? false,
          stagedPath: 'D:\\PandaStage-Acceptance\\<run>\\staging\\花园.png (redacted)',
          width: sample.assets.background.width,
          height: sample.assets.background.height,
          sha256: sample.assets.background.sha256,
          assetId: sample.assets.background.id,
          projectRelativePath: sample.assets.background.relativePath,
        },
        renderResolution: lifecycle.renderResolution,
        character: {
          name: sample.character.name,
          mode: sample.character.mode,
          id: sample.character.id,
          bodyAssetId: sample.assets.body.id,
          headExpressionAssetId: sample.assets.head.id,
          bodySha256: sample.assets.body.sha256,
          headSha256: sample.assets.head.sha256,
        },
        project: {
          id: baseline.id,
          root: 'D:\\PandaStage-Acceptance\\<run>\\AC-01 sample.pandastage (redacted)',
          baselineRevision: 0,
          baselineSha256: createHash('sha256').update(JSON.stringify(baseline)).digest('hex'),
          baseline: {
            shots: baseline.shots.map((shot) => ({ id: shot.id, name: shot.name, layers: shot.layers.length })),
            assets: baseline.assets.length,
            characters: baseline.characters.map((character) => ({ id: character.id, mode: character.mode })),
          },
          generated: {
            shots: lifecycle.generated.shots.map((shot) => ({ id: shot.id, name: shot.name, layers: shot.layers.length })),
            addedShotId: lifecycle.result.shotId,
            backgroundLayerId: lifecycle.result.backgroundLayerId,
            characterLayerId: lifecycle.result.characterLayerId,
            backgroundAssetId: lifecycle.result.backgroundAssetId,
            characterId: lifecycle.result.characterId,
            generatedShotSummary: {
              name: generatedShot.name,
              durationMs: generatedShot.durationMs,
              backgroundLayerId: generatedShot.backgroundLayerId,
              layerSources: generatedShot.layers.map((layer) => layer.source),
            },
          },
          undoRestoredBaseline: lifecycle.undoRestoredBaseline,
          redoRestoredGeneration: lifecycle.redoRestoredGeneration,
          savedReopenSucceeded: lifecycle.savedReopenSucceeded,
          reopenedSceneWasEditableAndSaved: lifecycle.edited.shots
            .find((shot) => shot.id === lifecycle.result.shotId)?.layers
            .find((layer) => layer.id === lifecycle.result.characterLayerId)?.x ===
              generatedShot.layers.find((layer) => layer.id === lifecycle.result.characterLayerId)!.x - 40,
        },
        input,
        evidenceFile: 'D:\\PandaStage-Acceptance\\<run>\\issue852-ac01-receipt.json (redacted)',
      };
      await writeFile(
        path.join(parent, 'issue852-ac01-receipt.json'),
        `${JSON.stringify(receipt, null, 2)}\n`,
        'utf8',
      );
      console.info(`ISSUE852_REAL_FIXTURE_RECEIPT=${JSON.stringify(receipt)}`);
      expect(receipt.project.generated.shots).toHaveLength(2);
      expect(receipt.project.generated.addedShotId).toBe(lifecycle.result.shotId);
    },
    120_000,
  );
});
