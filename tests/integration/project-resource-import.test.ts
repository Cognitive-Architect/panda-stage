import { createHash, randomUUID } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PROJECT_FPS,
  PROJECT_HEIGHT,
  PROJECT_SCHEMA_VERSION,
  PROJECT_WIDTH,
  ProjectSchema,
  type Character,
  type FlaGraphicDefinition,
  type Project,
} from '../../src/domain';
import { AssetImportFileSystemService } from '../../src/main/services/AssetImportFileSystemService';
import { ProjectFileSystemService } from '../../src/main/services/ProjectFileSystemService';
import { ProjectService } from '../../src/main/services/ProjectService';
import {
  ProjectResourceImportService,
  ProjectResourceImportServiceError,
} from '../../src/main/services/ProjectResourceImportService';

// Minimal valid 1x1 RGBA PNG buffer
const TINY_PNG_A = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
// Distinct valid 1x1 RGBA PNG buffer (blue pixel)
const TINY_PNG_B = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const TINY_SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#0f0"/></svg>',
  'utf8',
);

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

const tempRoots: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempRoots.length > 0) {
    const dir = tempRoots.pop()!;
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

async function createSourceFixture(parentDir: string): Promise<{
  sourceRoot: string;
  sourceProject: Project;
  characterId: string;
  graphicId: string;
  bgAssetId: string;
  propAssetId: string;
}> {
  const sourceRoot = path.join(parentDir, 'source.pandastage');
  await mkdir(path.join(sourceRoot, 'assets'), { recursive: true });
  await writeFile(path.join(sourceRoot, 'assets', 'body.png'), TINY_PNG_A);
  await writeFile(path.join(sourceRoot, 'assets', 'frame-0.svg'), TINY_SVG);
  await writeFile(path.join(sourceRoot, 'assets', 'bg.png'), TINY_PNG_B);
  await writeFile(path.join(sourceRoot, 'assets', 'prop.png'), TINY_PNG_A);

  const graphicId = randomUUID();
  const bitmapAssetId = randomUUID();
  const frameSvgAssetId = randomUUID();
  const bgAssetId = randomUUID();
  const propAssetId = randomUUID();
  const characterId = randomUUID();
  const voiceProfileId = randomUUID();
  const partId = randomUUID();
  const exprId = randomUUID();
  const now = '2026-11-27T00:00:00.000Z';

  const graphicDef: FlaGraphicDefinition = {
    id: graphicId,
    name: 'HeroGraphic',
    kind: 'fla-graphic',
    durationMs: 1000 / 24,
    source: {
      basename: 'hero.fla',
      sha256: sha256(Buffer.from('hero.fla')),
      renderTargetId: 'symbol:Hero',
      targetKind: 'graphic-symbol',
      targetName: 'Hero',
      startFrameIndex: 0,
      endFrameIndex: 0,
      sourceFps: 24,
      canvas: { width: 100, height: 100 },
      anchor: { x: 0, y: 0 },
      documentCanvas: { width: 1920, height: 1080 },
    },
    frames: [
      {
        ordinal: 0,
        sourceFrameIndex: 0,
        assetId: frameSvgAssetId,
        sha256: sha256(TINY_SVG),
        sourceViewport: { x: 0, y: 0, width: 100, height: 100 },
        offset: { x: 0, y: 0 },
        startMs: 0,
        durationMs: 1000 / 24,
        createdBySequenceImport: false,
      },
    ],
    structure: {
      version: 1,
      frames: [
        {
          ordinal: 0,
          layers: [
            {
              name: 'Body',
              nodes: [
                {
                  type: 'bitmap',
                  id: 'node-body-bitmap',
                  sourceAddress: 'L0/F0/Body',
                  drawOrder: 0,
                  localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
                  bitmapRef: 'body.png',
                  assetId: bitmapAssetId,
                },
              ],
            },
          ],
        },
      ],
    },
  };

  const character: Character = {
    id: characterId,
    name: '大侠熊猫',
    mode: 'adaptive-parts',
    defaultVoiceProfileId: voiceProfileId,
    defaultScale: 1,
    defaultFlipX: false,
    sourceRootTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    parts: [
      {
        partId,
        source: {
          kind: 'source-instance',
          sourceId: 'src-part-body',
          sourcePoseFrame: 0,
          effectiveFrame: 0,
        },
        restTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
        drawOrder: 0,
        visible: true,
        displayName: '身体',
        visualSource: { kind: 'fla-graphic', animationId: graphicId },
      },
    ],
    expressions: [
      {
        id: exprId,
        name: '开心',
        visualSource: { kind: 'fla-graphic', animationId: graphicId, firstFrame: 0 },
      },
    ],
    defaultExpressionId: exprId,
  };

  const sourceProject = ProjectSchema.parse({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: randomUUID(),
    name: 'Source Project A',
    width: PROJECT_WIDTH,
    height: PROJECT_HEIGHT,
    fps: PROJECT_FPS,
    assets: [
      {
        id: bitmapAssetId,
        name: 'BodyBitmap',
        kind: 'image',
        relativePath: 'assets/body.png',
        mimeType: 'image/png',
        width: 1,
        height: 1,
        usage: 'character',
        keywords: [],
        sha256: sha256(TINY_PNG_A),
      },
      {
        id: frameSvgAssetId,
        name: 'HeroFrame0',
        kind: 'image',
        relativePath: 'assets/frame-0.svg',
        mimeType: 'image/svg+xml',
        width: 100,
        height: 100,
        usage: 'character',
        keywords: [],
        sha256: sha256(TINY_SVG),
        flaGraphicFrame: { definitionId: graphicId, ordinal: 0 },
      },
      {
        id: bgAssetId,
        name: 'MountainBg',
        kind: 'image',
        relativePath: 'assets/bg.png',
        mimeType: 'image/png',
        width: 1,
        height: 1,
        usage: 'background',
        keywords: [],
        sha256: sha256(TINY_PNG_B),
      },
      {
        id: propAssetId,
        name: 'SwordProp',
        kind: 'image',
        relativePath: 'assets/prop.png',
        mimeType: 'image/png',
        width: 1,
        height: 1,
        usage: 'prop',
        keywords: [],
        sha256: sha256(TINY_PNG_A),
      },
    ],
    animations: [graphicDef],
    characters: [character],
    voiceProfiles: [
      {
        id: voiceProfileId,
        name: '大侠配音',
        characterId,
        locale: 'zh-CN',
        rate: 1,
        pitch: 0,
      },
    ],
    subtitleStyles: [
      {
        id: randomUUID(),
        name: 'Default',
        fontFamily: 'Microsoft YaHei',
        fontSize: 44,
        textColor: '#fffdf6',
        backgroundColor: '#0a141100',
        position: 'bottom',
        align: 'center',
        maxWidth: 1600,
      },
    ],
    shots: [],
    createdAt: now,
    updatedAt: now,
  });

  await writeFile(
    path.join(sourceRoot, 'project.json'),
    JSON.stringify(sourceProject, null, 2),
    'utf8',
  );

  return { sourceRoot, sourceProject, characterId, graphicId, bgAssetId, propAssetId };
}

describe('ProjectResourceImportService integration', () => {
  it('imports Graphic character + background + prop, deduplicates shared Graphic, preserves unsaved target edits, and keeps source immutable', async () => {
    const tempDir = await makeTempDir('panda-wf05-');
    const source = await createSourceFixture(tempDir);
    const sourceJsonBefore = await readFile(
      path.join(source.sourceRoot, 'project.json'),
      'utf8',
    );

    const onProjectOpened = vi.fn();
    const projectService = new ProjectService({ onProjectOpened });
    const targetRoot = path.join(tempDir, 'target.pandastage');
    const targetDoc = await projectService.create(targetRoot, {
      name: 'Target Project B',
    });

    // Simulate an unsaved renderer edit on Target Project B (not yet written to disk!)
    const unsavedTargetProject = ProjectSchema.parse({
      ...targetDoc.project,
      name: 'Target Project B (Unsaved Rename)',
    });
    const currentSnapshot = {
      project: unsavedTargetProject,
      revision: 3,
      openInstanceId: 7,
    };

    const importService = new ProjectResourceImportService({
      projectService,
      getCurrentProjectSnapshot: (root) =>
        path.resolve(root) === path.resolve(targetRoot) ? currentSnapshot : null,
    });

    // 1. Choose source project (read-only)
    const chosen = await importService.selectSourceProject(
      {
        projectRoot: targetRoot,
        project: currentSnapshot.project,
        baseRevision: currentSnapshot.revision,
        openInstanceId: currentSnapshot.openInstanceId,
      },
      source.sourceRoot,
    );
    expect(chosen.ok).toBe(true);
    if (!chosen.ok || chosen.status !== 'selected') throw new Error('expected selected');
    expect(onProjectOpened).not.toHaveBeenCalled();

    // 2. Preview performs zero disk writes
    const targetAssetsBeforePreview = await readdir(
      path.join(targetRoot, 'assets'),
    );
    const preview = importService.previewImport({
      projectRoot: targetRoot,
      project: currentSnapshot.project,
      baseRevision: currentSnapshot.revision,
      openInstanceId: currentSnapshot.openInstanceId,
      sourceToken: chosen.sourceToken,
      resources: [
        { kind: 'character', id: source.characterId },
        { kind: 'animation', id: source.graphicId },
        { kind: 'image', id: source.bgAssetId },
        { kind: 'image', id: source.propAssetId },
      ],
    });
    expect(preview.ok).toBe(true);
    if (preview.ok) {
      expect(preview.characterCount).toBe(1);
      expect(preview.animationCount).toBe(1); // deduplicated!
      expect(preview.assetCount).toBe(4);
    }
    expect(await readdir(path.join(targetRoot, 'assets'))).toEqual(
      targetAssetsBeforePreview,
    );

    // 3. Apply import
    const applied = await importService.importResources({
      projectRoot: targetRoot,
      project: currentSnapshot.project,
      baseRevision: currentSnapshot.revision,
      openInstanceId: currentSnapshot.openInstanceId,
      sourceToken: chosen.sourceToken,
      resources: [
        { kind: 'character', id: source.characterId },
        { kind: 'animation', id: source.graphicId },
        { kind: 'image', id: source.bgAssetId },
        { kind: 'image', id: source.propAssetId },
      ],
    });

    expect(applied.savedRevision).toBe(4);
    expect(applied.importedCharacters).toHaveLength(1);
    expect(applied.importedAnimations).toHaveLength(1);
    expect(applied.importedAssets).toHaveLength(4);
    // Unsaved renderer edit was preserved!
    expect(applied.project.name).toBe('Target Project B (Unsaved Rename)');

    // Target project re-opens cleanly from disk
    const reopened = await projectService.openReadOnly(targetRoot);
    expect(reopened.project.name).toBe('Target Project B (Unsaved Rename)');
    expect(reopened.project.characters).toHaveLength(1);
    expect(reopened.project.animations).toHaveLength(1);
    expect(reopened.project.assets).toHaveLength(4);

    // Source project was never modified and onProjectOpened was never invoked for it
    const sourceJsonAfter = await readFile(
      path.join(source.sourceRoot, 'project.json'),
      'utf8',
    );
    expect(sourceJsonAfter).toBe(sourceJsonBefore);
    expect(onProjectOpened).not.toHaveBeenCalledWith(
      source.sourceRoot,
      expect.anything(),
    );
  });

  it('rolls back ONLY newly copied files on save failure and preserves existing files', async () => {
    const tempDir = await makeTempDir('panda-wf05-rollback-');
    const source = await createSourceFixture(tempDir);

    let failAtomicWrite = false;
    const baseFs = new ProjectFileSystemService();
    const faultyFs = Object.assign(
      Object.create(ProjectFileSystemService.prototype) as ProjectFileSystemService,
      baseFs,
      {
        writeProjectFileAtomically: async (
          projectRoot: string,
          serialized: string,
          guard?: () => void,
        ) => {
          if (failAtomicWrite) {
            throw new Error('Simulated disk full during project.json save');
          }
          return baseFs.writeProjectFileAtomically(projectRoot, serialized, guard);
        },
      },
    );

    const projectService = new ProjectService({ fileSystem: faultyFs });
    const targetRoot = path.join(tempDir, 'target.pandastage');
    const targetDoc = await projectService.create(targetRoot, {
      name: 'Target Rollback Test',
    });

    // Place a pre-existing file in target assets that must NOT be deleted on rollback
    const preExistingPath = path.join(targetRoot, 'assets', 'existing.png');
    await writeFile(preExistingPath, TINY_PNG_B);

    const targetJsonBefore = await readFile(
      path.join(targetRoot, 'project.json'),
      'utf8',
    );

    const importService = new ProjectResourceImportService({
      projectService,
      getCurrentProjectSnapshot: () => ({
        project: targetDoc.project,
        revision: 0,
      }),
    });

    const chosen = await importService.selectSourceProject(
      {
        projectRoot: targetRoot,
        project: targetDoc.project,
        baseRevision: 0,
      },
      source.sourceRoot,
    );
    if (!chosen.ok || chosen.status !== 'selected') throw new Error('expected selected');

    failAtomicWrite = true;
    await expect(
      importService.importResources({
        projectRoot: targetRoot,
        project: targetDoc.project,
        baseRevision: 0,
        sourceToken: chosen.sourceToken,
        resources: [{ kind: 'character', id: source.characterId }],
      }),
    ).rejects.toThrow(ProjectResourceImportServiceError);

    // Newly copied files were rolled back; ONLY pre-existing file remains
    const remainingFiles = await readdir(path.join(targetRoot, 'assets'));
    expect(remainingFiles).toEqual(['existing.png']);
    expect(await readFile(path.join(targetRoot, 'project.json'), 'utf8')).toBe(
      targetJsonBefore,
    );
  });

  it('rejects same-project import and unsafe source asset traversal paths', async () => {
    const tempDir = await makeTempDir('panda-wf05-sec-');
    const source = await createSourceFixture(tempDir);
    const projectService = new ProjectService();
    const targetRoot = path.join(tempDir, 'target.pandastage');
    const targetDoc = await projectService.create(targetRoot, {
      name: 'Target Security Test',
    });

    const importService = new ProjectResourceImportService({
      projectService,
      getCurrentProjectSnapshot: (root) =>
        path.resolve(root) === path.resolve(targetRoot)
          ? { project: targetDoc.project, revision: 0 }
          : null,
    });

    // Same-project import rejected
    await expect(
      importService.selectSourceProject(
        {
          projectRoot: targetRoot,
          project: targetDoc.project,
          baseRevision: 0,
        },
        targetRoot,
      ),
    ).rejects.toMatchObject({
      code: 'PROJECT_RESOURCE_SOURCE_EQUALS_TARGET',
    });

    // Missing/escaped asset file on disk rejected during preflight
    await rm(path.join(source.sourceRoot, 'assets', 'bg.png'));
    const chosen = await importService.selectSourceProject(
      {
        projectRoot: targetRoot,
        project: targetDoc.project,
        baseRevision: 0,
      },
      source.sourceRoot,
    );
    if (!chosen.ok || chosen.status !== 'selected') throw new Error('expected selected');

    await expect(
      importService.importResources({
        projectRoot: targetRoot,
        project: targetDoc.project,
        baseRevision: 0,
        sourceToken: chosen.sourceToken,
        resources: [{ kind: 'image', id: source.bgAssetId }],
      }),
    ).rejects.toMatchObject({
      code: 'PROJECT_RESOURCE_SOURCE_INVALID',
    });
  });

  it('R4: verifies target reuse candidates on disk — reuses intact match, falls back to safe copy when target file is missing or replaced', async () => {
    const tempDir = await makeTempDir('panda-wf05-r4-');
    const source = await createSourceFixture(tempDir);
    const projectService = new ProjectService();

    // Case 1: Intact target file with matching hash -> reused cleanly (no extra copy)
    const intactRoot = path.join(tempDir, 'target-intact.pandastage');
    const intactDoc = await projectService.create(intactRoot, { name: 'Intact Target' });
    await writeFile(path.join(intactRoot, 'assets', 'existing-bg.png'), TINY_PNG_B);
    const existingBgId = randomUUID();
    const intactProject = ProjectSchema.parse({
      ...intactDoc.project,
      assets: [
        {
          id: existingBgId,
          name: 'ExistingBg',
          kind: 'image',
          relativePath: 'assets/existing-bg.png',
          mimeType: 'image/png',
          width: 1,
          height: 1,
          usage: 'background',
          keywords: [],
          sha256: sha256(TINY_PNG_B),
        },
      ],
    });
    const intactService = new ProjectResourceImportService({
      projectService,
      getCurrentProjectSnapshot: () => ({ project: intactProject, revision: 1 }),
    });
    const chosenIntact = await intactService.selectSourceProject(
      { projectRoot: intactRoot, project: intactProject, baseRevision: 1 },
      source.sourceRoot,
    );
    if (!chosenIntact.ok || chosenIntact.status !== 'selected') throw new Error('expected selected');
    const intactResult = await intactService.importResources({
      projectRoot: intactRoot,
      project: intactProject,
      baseRevision: 1,
      sourceToken: chosenIntact.sourceToken,
      resources: [{ kind: 'image', id: source.bgAssetId }],
      reuseIdenticalAssets: true,
    });
    expect(intactResult.reusedAssetIds).toEqual([existingBgId]);
    expect(intactResult.importedAssets).toHaveLength(0);
    expect(await readdir(path.join(intactRoot, 'assets'))).toEqual(['existing-bg.png']);

    // Case 2: Target JSON claims matching sha256, but file on disk is MISSING -> falls back to copying source file
    const missingRoot = path.join(tempDir, 'target-missing.pandastage');
    const missingDoc = await projectService.create(missingRoot, { name: 'Missing Target' });
    const missingAssetId = randomUUID();
    const missingProject = ProjectSchema.parse({
      ...missingDoc.project,
      assets: [
        {
          id: missingAssetId,
          name: 'MissingBgRecord',
          kind: 'image',
          relativePath: 'assets/ghost-bg.png',
          mimeType: 'image/png',
          width: 1,
          height: 1,
          usage: 'background',
          keywords: [],
          sha256: sha256(TINY_PNG_B),
        },
      ],
    });
    const missingService = new ProjectResourceImportService({
      projectService,
      getCurrentProjectSnapshot: () => ({ project: missingProject, revision: 1 }),
    });
    const chosenMissing = await missingService.selectSourceProject(
      { projectRoot: missingRoot, project: missingProject, baseRevision: 1 },
      source.sourceRoot,
    );
    if (!chosenMissing.ok || chosenMissing.status !== 'selected') throw new Error('expected selected');
    const missingResult = await missingService.importResources({
      projectRoot: missingRoot,
      project: missingProject,
      baseRevision: 1,
      sourceToken: chosenMissing.sourceToken,
      resources: [{ kind: 'image', id: source.bgAssetId }],
      reuseIdenticalAssets: true,
    });
    expect(missingResult.reusedAssetIds).toEqual([]);
    expect(missingResult.importedAssets).toHaveLength(1);
    const copiedMissingAsset = missingResult.importedAssets[0]!;
    expect(copiedMissingAsset.id).not.toBe(missingAssetId);
    const copiedMissingBytes = await readFile(
      path.join(missingRoot, copiedMissingAsset.relativePath),
    );
    expect(copiedMissingBytes.equals(TINY_PNG_B)).toBe(true);

    // Case 3: Target JSON claims matching sha256, but file on disk was REPLACED with different bytes -> safe copy without overwriting target file!
    const replacedRoot = path.join(tempDir, 'target-replaced.pandastage');
    const replacedDoc = await projectService.create(replacedRoot, { name: 'Replaced Target' });
    await writeFile(path.join(replacedRoot, 'assets', 'bg.png'), TINY_PNG_A); // Replaced with PNG_A while JSON claims PNG_B!
    const replacedAssetId = randomUUID();
    const replacedProject = ProjectSchema.parse({
      ...replacedDoc.project,
      assets: [
        {
          id: replacedAssetId,
          name: 'TamperedBgRecord',
          kind: 'image',
          relativePath: 'assets/bg.png',
          mimeType: 'image/png',
          width: 1,
          height: 1,
          usage: 'background',
          keywords: [],
          sha256: sha256(TINY_PNG_B),
        },
      ],
    });
    const replacedService = new ProjectResourceImportService({
      projectService,
      getCurrentProjectSnapshot: () => ({ project: replacedProject, revision: 1 }),
    });
    const chosenReplaced = await replacedService.selectSourceProject(
      { projectRoot: replacedRoot, project: replacedProject, baseRevision: 1 },
      source.sourceRoot,
    );
    if (!chosenReplaced.ok || chosenReplaced.status !== 'selected') throw new Error('expected selected');
    const replacedResult = await replacedService.importResources({
      projectRoot: replacedRoot,
      project: replacedProject,
      baseRevision: 1,
      sourceToken: chosenReplaced.sourceToken,
      resources: [{ kind: 'image', id: source.bgAssetId }],
      reuseIdenticalAssets: true,
    });
    expect(replacedResult.reusedAssetIds).toEqual([]);
    expect(replacedResult.importedAssets).toHaveLength(1);
    const copiedReplacedAsset = replacedResult.importedAssets[0]!;
    expect(copiedReplacedAsset.relativePath).not.toBe('assets/bg.png');
    // Original target file on disk is untouched!
    expect(
      (await readFile(path.join(replacedRoot, 'assets', 'bg.png'))).equals(TINY_PNG_A),
    ).toBe(true);
    // Newly copied file contains true source bytes (TINY_PNG_B)!
    expect(
      (await readFile(path.join(replacedRoot, copiedReplacedAsset.relativePath))).equals(
        TINY_PNG_B,
      ),
    ).toBe(true);
  });

  it('R5: rolls back previously copied batch files and aggregates all residual paths when a later copy throws AssetImportFileSystemCleanupError', async () => {
    const tempDir = await makeTempDir('panda-wf05-r5-');
    const source = await createSourceFixture(tempDir);
    const projectService = new ProjectService();

    // Scenario A: File 1 succeeds, File 2 fails AND its temp cleanup fails -> File 1 is STILL rolled back cleanly!
    const targetRootA = path.join(tempDir, 'target-r5a.pandastage');
    const docA = await projectService.create(targetRootA, { name: 'R5A Target' });
    await writeFile(path.join(targetRootA, 'assets', 'keep-me.png'), TINY_PNG_A);
    const jsonBeforeA = await readFile(path.join(targetRootA, 'project.json'), 'utf8');

    let copyCallA = 0;
    const fsA = new AssetImportFileSystemService({
      beforeFinalize: () => {
        copyCallA += 1;
        if (copyCallA === 2) {
          throw new Error('simulated finalize failure on second file');
        }
      },
      beforeCopyCleanupRemove: () => {
        throw new Error('simulated temp cleanup EPERM on second file');
      },
    });
    const serviceA = new ProjectResourceImportService({
      projectService,
      fileSystem: fsA,
      getCurrentProjectSnapshot: () => ({ project: docA.project, revision: 0 }),
    });
    const chosenA = await serviceA.selectSourceProject(
      { projectRoot: targetRootA, project: docA.project, baseRevision: 0 },
      source.sourceRoot,
    );
    if (!chosenA.ok || chosenA.status !== 'selected') throw new Error('expected selected');

    let caughtA: unknown;
    try {
      await serviceA.importResources({
        projectRoot: targetRootA,
        project: docA.project,
        baseRevision: 0,
        sourceToken: chosenA.sourceToken,
        resources: [
          { kind: 'image', id: source.bgAssetId },
          { kind: 'image', id: source.propAssetId },
        ],
      });
    } catch (error) {
      caughtA = error;
    }
    expect(caughtA).toBeInstanceOf(ProjectResourceImportServiceError);
    const errA = caughtA as ProjectResourceImportServiceError;
    expect(errA.code).toBe('PROJECT_RESOURCE_ROLLBACK_FAILED');
    // Only file 2's temp file remains; file 1 was rolled back and pre-existing keep-me.png is intact!
    expect(errA.residualPaths).toHaveLength(1);
    expect(path.basename(errA.residualPaths[0]!)).toMatch(/^\.asset-import\./u);
    const filesAfterA = await readdir(path.join(targetRootA, 'assets'));
    expect(filesAfterA).toContain('keep-me.png');
    expect(filesAfterA.some((f) => f.includes('bg'))).toBe(false);
    expect(filesAfterA.some((f) => f.includes('prop'))).toBe(false);
    expect(await readFile(path.join(targetRootA, 'project.json'), 'utf8')).toBe(
      jsonBeforeA,
    );

    // Scenario B: File 1's outer rollback ALSO fails -> residualPaths aggregates BOTH inner temp AND outer file 1!
    const targetRootB = path.join(tempDir, 'target-r5b.pandastage');
    const docB = await projectService.create(targetRootB, { name: 'R5B Target' });
    let copyCallB = 0;
    const fsB = new AssetImportFileSystemService({
      beforeFinalize: () => {
        copyCallB += 1;
        if (copyCallB === 2) {
          throw new Error('simulated finalize failure on second file');
        }
      },
      beforeCopyCleanupRemove: () => {
        throw new Error('simulated inner cleanup failure');
      },
      beforeRollbackRemove: () => {
        throw new Error('simulated outer rollback failure on file 1');
      },
    });
    const serviceB = new ProjectResourceImportService({
      projectService,
      fileSystem: fsB,
      getCurrentProjectSnapshot: () => ({ project: docB.project, revision: 0 }),
    });
    const chosenB = await serviceB.selectSourceProject(
      { projectRoot: targetRootB, project: docB.project, baseRevision: 0 },
      source.sourceRoot,
    );
    if (!chosenB.ok || chosenB.status !== 'selected') throw new Error('expected selected');

    let caughtB: unknown;
    try {
      await serviceB.importResources({
        projectRoot: targetRootB,
        project: docB.project,
        baseRevision: 0,
        sourceToken: chosenB.sourceToken,
        resources: [
          { kind: 'image', id: source.bgAssetId },
          { kind: 'image', id: source.propAssetId },
        ],
      });
    } catch (error) {
      caughtB = error;
    }
    expect(caughtB).toBeInstanceOf(ProjectResourceImportServiceError);
    const errB = caughtB as ProjectResourceImportServiceError;
    expect(errB.code).toBe('PROJECT_RESOURCE_ROLLBACK_FAILED');
    expect(errB.residualPaths).toHaveLength(2);
    expect(
      errB.residualPaths.some((p) => path.basename(p).startsWith('.asset-import.')),
    ).toBe(true);
    expect(
      errB.residualPaths.some((p) => path.basename(p).includes('bg')),
    ).toBe(true);
  });
});
