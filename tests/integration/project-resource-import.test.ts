import { createHash } from 'node:crypto';
import {
  lstat,
  mkdtemp,
  rename,
  readFile,
  readdir,
  rm,
  symlink,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CharacterService,
  ProjectSchema,
  ShotService,
  type Project,
} from '../../src/domain';
import {
  AssetImportFileSystemService,
} from '../../src/main/services/AssetImportFileSystemService';
import { AssetImportService } from '../../src/main/services/AssetImportService';
import {
  ProjectResourceImportService,
  ProjectResourceImportServiceError,
} from '../../src/main/services/ProjectResourceImportService';
import { ProjectService } from '../../src/main/services/ProjectService';
import {
  adaptivePartsFixture,
  adaptivePartsSourceRootTransform,
} from '../helpers/adaptivePartsFixtures';

const fixtureDirectory = path.resolve('tests/fixtures/assets');
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

interface Harness {
  parent: string;
  sourceRoot: string;
  targetRoot: string;
  projectService: ProjectService;
  snapshots: Map<string, { project: Project; revision: number }>;
  sourceOpened: () => number;
  importImages: (
    projectRoot: string,
    project: Project,
    baseRevision: number,
    names: readonly string[],
  ) => Promise<Awaited<ReturnType<AssetImportService['importCandidates']>>>;
}

async function harness(): Promise<Harness> {
  const parent = await mkdtemp(
    path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-resource-import-'),
  );
  temporaryDirectories.push(parent);
  const sourceRoot = path.join(parent, 'source.pandastage');
  const targetRoot = path.join(parent, 'target.pandastage');
  const snapshots = new Map<string, { project: Project; revision: number }>();
  const openedRoots: string[] = [];
  const projectService = new ProjectService({
    onProjectOpened: (root) => {
      openedRoots.push(root);
    },
    onProjectSaved: (root, project, revision) => {
      if (revision !== undefined) snapshots.set(root, { project, revision });
    },
  });
  const source = await projectService.create(sourceRoot, { name: 'Source A' });
  const target = await projectService.create(targetRoot, { name: 'Target B' });
  snapshots.set(sourceRoot, { project: source.project, revision: 0 });
  snapshots.set(targetRoot, { project: target.project, revision: 0 });
  const importImages = async (
    projectRoot: string,
    project: Project,
    baseRevision: number,
    names: readonly string[],
  ) => {
    const importer = new AssetImportService({
      projectService,
      getCurrentProjectSnapshot: (root) => snapshots.get(root) ?? null,
    });
    return importer.importCandidates({
      projectRoot,
      project,
      baseRevision,
      candidates: names.map((name) => ({
        sourcePath: path.join(fixtureDirectory, name),
        declaredMimeType: path.extname(name).toLowerCase() === '.jpg'
          ? 'image/jpeg'
          : 'image/png',
      })),
    });
  };
  return {
    parent,
    sourceRoot,
    targetRoot,
    projectService,
    snapshots,
    sourceOpened: () => openedRoots.filter((root) => root === sourceRoot).length,
    importImages,
  };
}

async function fileHash(filePath: string): Promise<string> {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

function resourceService(
  h: Harness,
  fileSystem?: AssetImportFileSystemService,
): ProjectResourceImportService {
  return new ProjectResourceImportService({
    projectService: h.projectService,
    getCurrentProjectSnapshot: (root) => h.snapshots.get(root) ?? null,
    ...(fileSystem ? { fileSystem } : {}),
  });
}

describe('cross-project resource import', () => {
  it('copies character dependency closures and ordinary images with remapped identities', async () => {
    const h = await harness();
    const sourceBase = h.snapshots.get(h.sourceRoot)!.project;
    const sourceAssets = await h.importImages(
      h.sourceRoot,
      sourceBase,
      0,
      ['熊猫 图片.png', '另一张 图片.png', '伪装 图片.png', '熊猫 照片.jpg'],
    );
    expect(sourceAssets.projectChanged).toBe(true);
    const imageAssets = sourceAssets.project.assets.map((asset) => {
      if (asset.kind !== 'image') throw new Error('Expected image fixture.');
      return {
        ...asset,
        usage: asset.relativePath.endsWith('熊猫 照片.jpg')
          ? 'background' as const
          : asset.relativePath.endsWith('另一张 图片.png')
            ? 'prop' as const
            : 'character' as const,
      };
    });
    const assetFor = (fileName: string) =>
      imageAssets.find((asset) => asset.relativePath.endsWith(fileName));
    const baseAsset = assetFor('熊猫 图片.png');
    const expressionAsset = assetFor('另一张 图片.png');
    const mouthAsset = assetFor('熊猫 照片.jpg');
    if (!baseAsset || !expressionAsset || !mouthAsset) {
      throw new Error('Expected the valid PNG and JPG source fixtures.');
    }
    let sourceProject = ProjectSchema.parse({
      ...sourceAssets.project,
      assets: imageAssets,
    });
    const characterService = new CharacterService();
    sourceProject = characterService.create(sourceProject, {
      name: 'Panda',
      expressions: [
        { name: 'normal', assetId: baseAsset.id },
        { name: 'happy', assetId: expressionAsset.id },
      ],
      mouthOpenAssetId: mouthAsset.id,
    });
    sourceProject = characterService.createComposite(sourceProject, {
      name: 'Composite Panda',
      expressions: [{ name: 'rest', assetId: baseAsset.id }],
      bodyAssetId: expressionAsset.id,
      facePlacement: {
        offsetX: 4,
        offsetY: -2,
        scale: 0.9,
        rotationDeg: 0,
        flipX: false,
      },
      head: {
        assetId: mouthAsset.id,
        placement: {
          offsetX: 2,
          offsetY: 3,
          scale: 1.1,
          rotationDeg: 5,
          flipX: true,
        },
        pivot: { x: 320, y: 260 },
      },
    });
    const adaptiveParts = adaptivePartsFixture(baseAsset.id).map((part) => ({
      ...part,
      imageMapping: {
        ...part.imageMapping,
        sourceWidth: baseAsset.width,
        sourceHeight: baseAsset.height,
        crop: {
          x: 0,
          y: 0,
          width: baseAsset.width,
          height: baseAsset.height,
        },
      },
    }));
    sourceProject = characterService.createAdaptiveParts(sourceProject, {
      name: 'Adaptive Panda',
      sourceRootTransform: adaptivePartsSourceRootTransform(),
      parts: adaptiveParts,
    });
    await h.projectService.save(h.sourceRoot, sourceProject, 2);
    h.snapshots.set(h.sourceRoot, { project: sourceProject, revision: 2 });

    const targetBase = h.snapshots.get(h.targetRoot)!.project;
    const targetAssetImport = await h.importImages(
      h.targetRoot,
      targetBase,
      0,
      ['熊猫 图片.png'],
    );
    const sourcePandaAsset = baseAsset;
    const conflictingTargetAsset = targetAssetImport.project.assets[0]!;
    const targetWithSameId = ProjectSchema.parse({
      ...targetAssetImport.project,
      assets: targetAssetImport.project.assets.map((asset) =>
        asset.id === conflictingTargetAsset.id
          ? { ...asset, id: sourcePandaAsset.id }
          : asset,
      ),
    });
    const targetProject = new CharacterService().create(targetWithSameId, {
      name: 'Panda',
      expressions: [{ name: 'normal', assetId: sourcePandaAsset.id }],
    });
    await h.projectService.save(h.targetRoot, targetProject, 2);
    h.snapshots.set(h.targetRoot, { project: targetProject, revision: 2 });

    const sourceProjectFile = path.join(h.sourceRoot, 'project.json');
    const beforeSourceProjectHash = await fileHash(sourceProjectFile);
    const beforeSourceAssetHashes = new Map(
      await Promise.all(
        sourceProject.assets.map(async (asset) => [
          asset.id,
          await fileHash(path.join(h.sourceRoot, asset.relativePath)),
        ] as const),
      ),
    );
    const sourceOpenCount = h.sourceOpened();
    const targetSnapshot = h.snapshots.get(h.targetRoot)!;
    const service = resourceService(h);
    const selection = await service.selectSourceProject(
      {
        projectRoot: h.targetRoot,
        project: targetSnapshot.project,
        baseRevision: targetSnapshot.revision,
      },
      h.sourceRoot,
    );
    expect(selection.status).toBe('selected');
    if (selection.status !== 'selected') throw new Error('Expected source items.');
    expect(selection.items.filter((item) => item.kind === 'character')).toHaveLength(3);
    expect(selection.items.filter((item) => item.kind === 'image')).toMatchObject([
      { usage: 'prop', supported: true },
      { usage: 'background', supported: true },
    ]);
    expect(h.sourceOpened()).toBe(sourceOpenCount);

    const sourceCharacters = sourceProject.characters;
    const resources = [
      ...sourceCharacters.map((character) => ({ kind: 'character' as const, id: character.id })),
      { kind: 'image' as const, id: expressionAsset.id },
      { kind: 'image' as const, id: mouthAsset.id },
    ];
    const operation = await service.importResources({
      projectRoot: h.targetRoot,
      project: targetSnapshot.project,
      baseRevision: targetSnapshot.revision,
      sourceToken: selection.sourceToken,
      resources,
    });

    expect(operation.importedAssets).toHaveLength(3);
    expect(operation.importedCharacters.map((character) => character.mode).sort()).toEqual([
      'adaptive-parts',
      'composite',
      'single-image',
    ]);
    expect(operation.importedVoiceProfiles).toHaveLength(3);
    expect(operation.importedCharacters.find((character) => character.name === 'Panda (2)')?.name).toBe('Panda (2)');
    expect(operation.importedAssets.find((asset) => asset.id === sourcePandaAsset.id)).toBeUndefined();
    expect(operation.importedAssets.find((asset) => asset.name === sourcePandaAsset.name)?.relativePath)
      .not.toBe(conflictingTargetAsset.relativePath);
    expect(operation.project.assets).toHaveLength(targetProject.assets.length + 3);
    expect(operation.project.characters).toHaveLength(targetProject.characters.length + 3);
    expect(operation.project.voiceProfiles).toHaveLength(targetProject.voiceProfiles.length + 3);
    expect(JSON.stringify(operation.project)).not.toContain(h.sourceRoot);

    const sourceCharacterByName = new Map(
      sourceCharacters.map((character) => [character.name, character]),
    );
    const importedSingle = operation.importedCharacters.find(
      (character) => character.mode === 'single-image',
    );
    const sourceSingle = sourceCharacterByName.get('Panda');
    if (!importedSingle || !sourceSingle || sourceSingle.mode === 'adaptive-parts') {
      throw new Error('Expected the single-image Character closure.');
    }
    expect(importedSingle.id).not.toBe(sourceSingle.id);
    expect(importedSingle.baseAssetId).not.toBe(sourceSingle.baseAssetId);
    expect(importedSingle.defaultExpressionId).toBe(
      importedSingle.expressions.find((expression) => expression.name === 'normal')?.id,
    );
    expect(importedSingle.defaultExpressionId).not.toBe(sourceSingle.defaultExpressionId);
    expect(importedSingle.mouthOpenAssetId).not.toBe(sourceSingle.mouthOpenAssetId);

    const importedComposite = operation.importedCharacters.find(
      (character) => character.mode === 'composite',
    );
    const sourceComposite = sourceCharacterByName.get('Composite Panda');
    if (!importedComposite || importedComposite.mode !== 'composite' || !sourceComposite || sourceComposite.mode !== 'composite') {
      throw new Error('Expected the composite Character closure.');
    }
    expect(importedComposite.bodyAssetId).not.toBe(sourceComposite.bodyAssetId);
    expect(importedComposite.head?.assetId).not.toBe(sourceComposite.head?.assetId);
    expect(importedComposite.facePlacement).toEqual(sourceComposite.facePlacement);
    expect(importedComposite.head?.placement).toEqual(sourceComposite.head?.placement);

    const importedAdaptive = operation.importedCharacters.find(
      (character) => character.mode === 'adaptive-parts',
    );
    const sourceAdaptive = sourceCharacterByName.get('Adaptive Panda');
    if (!importedAdaptive || importedAdaptive.mode !== 'adaptive-parts' || !sourceAdaptive || sourceAdaptive.mode !== 'adaptive-parts') {
      throw new Error('Expected the Adaptive Parts Character closure.');
    }
    expect(importedAdaptive.parts).toHaveLength(sourceAdaptive.parts.length);
    expect(importedAdaptive.parts.map((part) => part.restTransform)).toEqual(
      sourceAdaptive.parts.map((part) => part.restTransform),
    );
    expect(importedAdaptive.parts.map((part) => part.partId)).not.toEqual(
      sourceAdaptive.parts.map((part) => part.partId),
    );
    expect(importedAdaptive.parts.every((part) =>
      operation.importedAssets.some((asset) => asset.id === part.assetId),
    )).toBe(true);
    expect(operation.importedVoiceProfiles.every((profile) =>
      operation.importedCharacters.some((character) =>
        character.id === profile.characterId &&
        character.defaultVoiceProfileId === profile.id,
      ),
    )).toBe(true);

    const reopenedTarget = await h.projectService.open(h.targetRoot);
    expect(reopenedTarget.project).toEqual(operation.project);
    expect(h.sourceOpened()).toBe(sourceOpenCount);
    expect(await fileHash(sourceProjectFile)).toBe(beforeSourceProjectHash);
    for (const asset of sourceProject.assets) {
      expect(await fileHash(path.join(h.sourceRoot, asset.relativePath))).toBe(
        beforeSourceAssetHashes.get(asset.id),
      );
    }
  });

  it('rejects a target revision that changed after source selection without copying files', async () => {
    const h = await harness();
    const imported = await h.importImages(
      h.sourceRoot,
      h.snapshots.get(h.sourceRoot)!.project,
      0,
      ['熊猫 照片.jpg'],
    );
    const sourceAsset = imported.project.assets[0]!;
    const sourceProject = ProjectSchema.parse({
      ...imported.project,
      assets: imported.project.assets.map((asset) =>
        asset.id === sourceAsset.id ? { ...asset, usage: 'background' as const } : asset,
      ),
    });
    await h.projectService.save(h.sourceRoot, sourceProject, 1);
    const target = h.snapshots.get(h.targetRoot)!;
    const service = resourceService(h);
    const selected = await service.selectSourceProject(
      { projectRoot: h.targetRoot, project: target.project, baseRevision: target.revision },
      h.sourceRoot,
    );
    if (selected.status !== 'selected') throw new Error('Expected source selection.');
    const changedTarget = ProjectSchema.parse({ ...target.project, name: 'Target B changed' });
    h.snapshots.set(h.targetRoot, { project: changedTarget, revision: target.revision + 1 });
    const projectFile = path.join(h.targetRoot, 'project.json');
    const beforeHash = await fileHash(projectFile);

    await expect(service.importResources({
      projectRoot: h.targetRoot,
      project: target.project,
      baseRevision: target.revision,
      sourceToken: selected.sourceToken,
      resources: [{ kind: 'image', id: sourceAsset.id }],
    })).rejects.toMatchObject({
      code: 'PROJECT_RESOURCE_TARGET_STALE',
    } satisfies Partial<ProjectResourceImportServiceError>);

    expect(await fileHash(projectFile)).toBe(beforeHash);
    expect(await readdir(path.join(h.targetRoot, 'assets')).catch(() => [])).toEqual([]);
  });

  it('rejects a missing selected source file before creating target files', async () => {
    const h = await harness();
    const imported = await h.importImages(
      h.sourceRoot,
      h.snapshots.get(h.sourceRoot)!.project,
      0,
      ['熊猫 图片.png'],
    );
    const sourceAsset = imported.project.assets[0]!;
    const sourceProject = ProjectSchema.parse({
      ...imported.project,
      assets: imported.project.assets.map((asset) =>
        asset.id === sourceAsset.id
          ? { ...asset, usage: 'background' as const }
          : asset,
      ),
    });
    await h.projectService.save(h.sourceRoot, sourceProject, 1);
    const target = h.snapshots.get(h.targetRoot)!;
    const service = resourceService(h);
    const selected = await service.selectSourceProject(
      { projectRoot: h.targetRoot, project: target.project, baseRevision: target.revision },
      h.sourceRoot,
    );
    if (selected.status !== 'selected') throw new Error('Expected source selection.');
    const sourceFile = path.join(h.sourceRoot, sourceAsset.relativePath);
    await rm(sourceFile);
    const targetProjectFile = path.join(h.targetRoot, 'project.json');
    const beforeTargetHash = await fileHash(targetProjectFile);

    await expect(service.importResources({
      projectRoot: h.targetRoot,
      project: target.project,
      baseRevision: target.revision,
      sourceToken: selected.sourceToken,
      resources: [{ kind: 'image', id: sourceAsset.id }],
    })).rejects.toMatchObject({
      code: 'PROJECT_RESOURCE_SOURCE_INVALID',
    });

    expect(await fileHash(targetProjectFile)).toBe(beforeTargetHash);
    expect(await readdir(path.join(h.targetRoot, 'assets')).catch(() => [])).toEqual([]);
  });

  it('rejects a selected source file symlink that leaves the source assets directory', async (context) => {
    const h = await harness();
    const imported = await h.importImages(
      h.sourceRoot,
      h.snapshots.get(h.sourceRoot)!.project,
      0,
      ['熊猫 图片.png'],
    );
    const sourceAsset = imported.project.assets[0]!;
    const sourceProject = ProjectSchema.parse({
      ...imported.project,
      assets: imported.project.assets.map((asset) =>
        asset.id === sourceAsset.id
          ? { ...asset, usage: 'background' as const }
          : asset,
      ),
    });
    await h.projectService.save(h.sourceRoot, sourceProject, 2);
    const sourceFile = path.join(h.sourceRoot, sourceAsset.relativePath);
    const externalFile = path.join(h.parent, 'external-source.png');
    await rename(sourceFile, externalFile);
    try {
      await symlink(externalFile, sourceFile, 'file');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'EACCES' || code === 'ENOSYS' || code === 'ENOTSUP') {
        context.skip('This Windows host does not allow creating file symlinks.');
        return;
      }
      throw error;
    }

    const target = h.snapshots.get(h.targetRoot)!;
    const service = resourceService(h);
    const selected = await service.selectSourceProject(
      { projectRoot: h.targetRoot, project: target.project, baseRevision: target.revision },
      h.sourceRoot,
    );
    if (selected.status !== 'selected') throw new Error('Expected source selection.');
    const targetProjectFile = path.join(h.targetRoot, 'project.json');
    const beforeTargetHash = await fileHash(targetProjectFile);
    const beforeExternalHash = await fileHash(externalFile);
    const beforeSourceProjectHash = await fileHash(path.join(h.sourceRoot, 'project.json'));

    await expect(service.importResources({
      projectRoot: h.targetRoot,
      project: target.project,
      baseRevision: target.revision,
      sourceToken: selected.sourceToken,
      resources: [{ kind: 'image', id: sourceAsset.id }],
    })).rejects.toMatchObject({
      code: 'PROJECT_RESOURCE_SOURCE_INVALID',
    } satisfies Partial<ProjectResourceImportServiceError>);

    expect(await fileHash(targetProjectFile)).toBe(beforeTargetHash);
    expect(await readdir(path.join(h.targetRoot, 'assets')).catch(() => [])).toEqual([]);
    expect((await lstat(sourceFile)).isSymbolicLink()).toBe(true);
    expect(await fileHash(externalFile)).toBe(beforeExternalHash);
    expect(await fileHash(path.join(h.sourceRoot, 'project.json'))).toBe(beforeSourceProjectHash);
  });

  it('rolls back earlier copied files when a later file copy fails', async () => {
    const h = await harness();
    const imported = await h.importImages(
      h.sourceRoot,
      h.snapshots.get(h.sourceRoot)!.project,
      0,
      ['熊猫 图片.png', '熊猫 照片.jpg'],
    );
    const sourceProject = ProjectSchema.parse({
      ...imported.project,
      assets: imported.project.assets.map((asset, index) =>
        asset.kind === 'image'
          ? { ...asset, usage: index === 0 ? 'prop' as const : 'background' as const }
          : asset,
      ),
    });
    await h.projectService.save(h.sourceRoot, sourceProject, 1);
    const target = h.snapshots.get(h.targetRoot)!;
    let copyCount = 0;
    const fileSystem = new AssetImportFileSystemService({
      beforeFinalize: () => {
        copyCount += 1;
        if (copyCount === 2) throw new Error('Injected second-file failure.');
      },
    });
    const service = resourceService(h, fileSystem);
    const selected = await service.selectSourceProject(
      { projectRoot: h.targetRoot, project: target.project, baseRevision: target.revision },
      h.sourceRoot,
    );
    if (selected.status !== 'selected') throw new Error('Expected source selection.');
    const targetProjectFile = path.join(h.targetRoot, 'project.json');
    const beforeTargetHash = await fileHash(targetProjectFile);
    const sourceProjectFile = path.join(h.sourceRoot, 'project.json');
    const beforeSourceHash = await fileHash(sourceProjectFile);

    let failure: unknown;
    try {
      await service.importResources({
        projectRoot: h.targetRoot,
        project: target.project,
        baseRevision: target.revision,
        sourceToken: selected.sourceToken,
        resources: selected.items.map(({ kind, id }) => ({ kind, id })),
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(ProjectResourceImportServiceError);
    expect(failure).toMatchObject({ code: 'PROJECT_RESOURCE_OPERATION_FAILED' });
    expect(await fileHash(targetProjectFile)).toBe(beforeTargetHash);
    expect(await readdir(path.join(h.targetRoot, 'assets'))).toEqual([]);
    expect(h.snapshots.get(h.targetRoot)).toEqual(target);
    expect(await fileHash(sourceProjectFile)).toBe(beforeSourceHash);
  });

  /**
   * Issue #1041: EF-04 was authored against Schema v16. On the integrated
   * branch the target Project is v18, so the import must leave the v18-only
   * fields alone — the project-local Shot template list, the persisted
   * per-Shot camera track and the user Part pose presets — and keep every
   * reference they hold resolvable.
   */
  it('keeps the v18-only target fields and their references intact', async () => {
    const h = await harness();

    // Source A: one single-image Character, exactly the shape v16 could hold.
    const sourceBase = h.snapshots.get(h.sourceRoot)!.project;
    const sourceAssets = await h.importImages(
      h.sourceRoot,
      sourceBase,
      0,
      ['熊猫 图片.png'],
    );
    const sourceImage = sourceAssets.project.assets[0]!;
    const sourceProject = new CharacterService().create(
      ProjectSchema.parse({
        ...sourceAssets.project,
        assets: [{ ...sourceImage, usage: 'character' as const }],
      }),
      {
        name: 'Source Panda',
        expressions: [{ name: 'normal', assetId: sourceImage.id }],
      },
    );
    await h.projectService.save(h.sourceRoot, sourceProject, 2);
    h.snapshots.set(h.sourceRoot, { project: sourceProject, revision: 2 });

    // Target B: a v18 Project carrying all three post-v16 fields.
    const targetBase = h.snapshots.get(h.targetRoot)!.project;
    const targetAssets = await h.importImages(
      h.targetRoot,
      targetBase,
      0,
      ['熊猫 图片.png'],
    );
    const targetImage = targetAssets.project.assets[0]!;
    const withTargetImage = ProjectSchema.parse({
      ...targetAssets.project,
      assets: [{ ...targetImage, usage: 'character' as const }],
    });
    const targetParts = adaptivePartsFixture(targetImage.id).map((part) => ({
      ...part,
      imageMapping: {
        ...part.imageMapping,
        sourceWidth: targetImage.width,
        sourceHeight: targetImage.height,
        crop: {
          x: 0,
          y: 0,
          width: targetImage.width,
          height: targetImage.height,
        },
      },
    }));
    const targetAdaptive = new CharacterService().createAdaptiveParts(
      withTargetImage,
      {
        name: 'Target Adaptive',
        sourceRootTransform: adaptivePartsSourceRootTransform(),
        parts: targetParts,
      },
    );
    const targetAdaptiveCharacter = targetAdaptive.characters.at(-1)!;
    if (targetAdaptiveCharacter.mode !== 'adaptive-parts') {
      throw new Error('Expected an Adaptive Parts Character.');
    }
    const posePartId = targetAdaptiveCharacter.parts[0]!.partId;
    // A freshly created project has no Shot yet; the template needs one.
    const withShot = new ShotService().create(targetAdaptive, {
      name: '镜头一',
      durationMs: 3_000,
    });
    const firstShot = withShot.shots[0]!;
    const presetId = 'c1000000-0000-4000-8000-000000000001';
    const templateId = 'c2000000-0000-4000-8000-000000000001';

    const targetProject = ProjectSchema.parse({
      ...withShot,
      shots: withShot.shots.map((shot, index) =>
        index === 0
          ? { ...shot, camera: { mode: 'speaker-focus', keyframes: [] } }
          : shot,
      ),
      shotTemplates: [
        {
          id: templateId,
          name: '双人对话模板',
          createdAt: '2026-01-02T00:00:00.000Z',
          durationMs: firstShot.durationMs,
          defaultSubtitleStyleId: withShot.subtitleStyles[0]!.id,
          layers: firstShot.layers,
          backgroundLayerId: firstShot.backgroundLayerId,
          timelineEvents: [],
        },
      ],
      partPosePresets: [
        {
          id: presetId,
          name: '挥手',
          characterId: targetAdaptiveCharacter.id,
          durationMs: 1_000,
          sourceRootTransform: adaptivePartsSourceRootTransform(),
          fixedCharacterCenter: { x: 320, y: 320 },
          tracks: [
            {
              partId: posePartId,
              keys: [
                {
                  timeMs: 0,
                  offsetX: 0,
                  offsetY: 0,
                  rotationDeg: 0,
                  scale: 1,
                  easingToNext: 'linear',
                },
                {
                  timeMs: 1_000,
                  offsetX: 0,
                  offsetY: 0,
                  rotationDeg: 30,
                  scale: 1,
                  easingToNext: 'linear',
                },
              ],
              pivotSource: { x: 320, y: 320 },
              sourceRestTransform: {
                a: 1,
                b: 0,
                c: 0,
                d: 1,
                tx: 0,
                ty: 0,
              },
            },
          ],
          createdAt: '2026-01-02T00:00:00.000Z',
        },
      ],
    });
    expect(targetProject.schemaVersion).toBe(18);
    await h.projectService.save(h.targetRoot, targetProject, 2);
    h.snapshots.set(h.targetRoot, { project: targetProject, revision: 2 });

    const service = resourceService(h);
    const selection = await service.selectSourceProject(
      {
        projectRoot: h.targetRoot,
        project: targetProject,
        baseRevision: 2,
      },
      h.sourceRoot,
    );
    expect(selection.status).toBe('selected');
    if (selection.status !== 'selected') return;
    const sourceCharacter = sourceProject.characters.find(
      (character) => character.name === 'Source Panda',
    )!;

    const operation = await service.importResources({
      projectRoot: h.targetRoot,
      project: targetProject,
      baseRevision: 2,
      sourceToken: selection.sourceToken,
      resources: [{ kind: 'character', id: sourceCharacter.id }],
    });

    // The v18 envelope is preserved, not downgraded to the v16 the source
    // feature was written against.
    expect(operation.project.schemaVersion).toBe(18);
    expect(operation.project.shotTemplates).toHaveLength(1);
    expect(operation.project.shotTemplates[0]).toMatchObject({
      id: templateId,
      name: '双人对话模板',
    });
    expect(operation.project.shots[0]!.camera.mode).toBe('speaker-focus');
    expect(operation.project.partPosePresets).toHaveLength(1);
    expect(operation.project.partPosePresets![0]).toMatchObject({
      id: presetId,
      characterId: targetAdaptiveCharacter.id,
    });

    // References still resolve: ProjectSchema runs validateProjectReferences.
    expect(() => ProjectSchema.parse(operation.project)).not.toThrow();

    // And the import really did add the source Character.
    expect(
      operation.project.characters.some(
        (character) => character.name === 'Source Panda',
      ),
    ).toBe(true);
  });
});
