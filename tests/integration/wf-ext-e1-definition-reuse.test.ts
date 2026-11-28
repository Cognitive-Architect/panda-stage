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

const TINY_PNG_A = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
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

async function createSourceProjectOnDisk(parentDir: string): Promise<{
  sourceRoot: string;
  sourceProject: Project;
  graphicId: string;
  charAId: string;
  charBId: string;
}> {
  const sourceRoot = path.join(parentDir, 'source-e1.pandastage');
  await mkdir(path.join(sourceRoot, 'assets'), { recursive: true });
  await writeFile(path.join(sourceRoot, 'assets', 'body.png'), TINY_PNG_A);
  await writeFile(path.join(sourceRoot, 'assets', 'frame-0.svg'), TINY_SVG);
  await writeFile(path.join(sourceRoot, 'assets', 'char-b.png'), TINY_PNG_B);

  const graphicId = randomUUID();
  const bitmapAssetId = randomUUID();
  const frameSvgAssetId = randomUUID();
  const charBAssetId = randomUUID();
  const charAId = randomUUID();
  const charBId = randomUUID();
  const voiceAId = randomUUID();
  const voiceBId = randomUUID();
  const partAId = randomUUID();
  const partBId = randomUUID();
  const exprAId = randomUUID();
  const exprBId = randomUUID();
  const now = '2026-11-28T00:00:00.000Z';

  const graphic: FlaGraphicDefinition = {
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

  const charA: Character = {
    id: charAId,
    name: '大侠熊猫',
    mode: 'adaptive-parts',
    defaultVoiceProfileId: voiceAId,
    defaultScale: 1,
    defaultFlipX: false,
    sourceRootTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    parts: [
      {
        partId: partAId,
        source: {
          kind: 'source-instance',
          sourceId: 'src-part-a',
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
        id: exprAId,
        name: '默认',
        visualSource: { kind: 'fla-graphic', animationId: graphicId, firstFrame: 0 },
      },
    ],
    defaultExpressionId: exprAId,
  };

  const charB: Character = {
    id: charBId,
    name: '徒弟熊猫',
    mode: 'adaptive-parts',
    defaultVoiceProfileId: voiceBId,
    defaultScale: 1,
    defaultFlipX: false,
    sourceRootTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    parts: [
      {
        partId: partBId,
        source: {
          kind: 'source-instance',
          sourceId: 'src-part-b',
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
        id: exprBId,
        name: '默认',
        assetId: charBAssetId,
      },
    ],
    defaultExpressionId: exprBId,
  };

  const sourceProject = ProjectSchema.parse({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: randomUUID(),
    name: 'Source E1',
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
        id: charBAssetId,
        name: 'CharBExpr',
        kind: 'image',
        relativePath: 'assets/char-b.png',
        mimeType: 'image/png',
        width: 1,
        height: 1,
        usage: 'character',
        keywords: [],
        sha256: sha256(TINY_PNG_B),
      },
    ],
    animations: [graphic],
    characters: [charA, charB],
    voiceProfiles: [
      {
        id: voiceAId,
        name: '大侠配音',
        characterId: charAId,
        locale: 'zh-CN',
        rate: 1,
        pitch: 0,
      },
      {
        id: voiceBId,
        name: '徒弟配音',
        characterId: charBId,
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

  return { sourceRoot, sourceProject, graphicId, charAId, charBId };
}

describe('WF-EXT-E1 ProjectResourceImportService disk & transaction integration (#1441)', () => {
  it('persists provenance across save/reopen, reuses verified definitions on disk without extra files, and rejects reuse when target disk file is corrupted', async () => {
    const tempDir = await makeTempDir('panda-e1-reuse-');
    const source = await createSourceProjectOnDisk(tempDir);
    const projectService = new ProjectService({
      fileSystem: new ProjectFileSystemService(),
    });
    const targetCreated = await projectService.create(
      path.join(tempDir, 'target-e1.pandastage'),
      { name: 'Target E1' },
    );

    let liveProject = targetCreated.project;
    let liveRevision = 0;
    const service = new ProjectResourceImportService({
      projectService,
      getCurrentProjectSnapshot: () => ({
        project: liveProject,
        revision: liveRevision,
      }),
    });

    // 1. First import: Character A + HeroGraphic.
    const choose1 = await service.selectSourceProject(
      {
        projectRoot: targetCreated.projectRoot,
        project: liveProject,
        baseRevision: liveRevision,
      },
      source.sourceRoot,
    );
    expect(choose1.ok && choose1.status === 'selected').toBe(true);
    if (!choose1.ok || choose1.status !== 'selected') throw new Error('expected selected');

    const op1 = await service.importResources({
      projectRoot: targetCreated.projectRoot,
      project: liveProject,
      baseRevision: liveRevision,
      sourceToken: choose1.sourceToken,
      resources: [{ kind: 'character', id: source.charAId }],
    });
    liveProject = op1.project;
    liveRevision = op1.savedRevision;

    // 2. Save & reopen from disk to verify provenance persists cleanly.
    const reopened = await projectService.open(targetCreated.projectRoot);
    liveProject = reopened.project;
    expect(liveProject.characters).toHaveLength(1);
    expect(liveProject.animations).toHaveLength(1);
    const targetCharAId = liveProject.characters[0]!.id;
    const targetGraphicId = liveProject.animations[0]!.id;
    const filesAfterFirst = (
      await readdir(path.join(targetCreated.projectRoot, 'assets'))
    ).sort();

    // 3. Repeat import of Character A + Character B with reuse of Character A & HeroGraphic:
    const choose2 = await service.selectSourceProject(
      {
        projectRoot: targetCreated.projectRoot,
        project: liveProject,
        baseRevision: liveRevision,
      },
      source.sourceRoot,
    );
    if (!choose2.ok || choose2.status !== 'selected') throw new Error('expected selected');

    const preview2 = service.previewImport({
      projectRoot: targetCreated.projectRoot,
      project: liveProject,
      baseRevision: liveRevision,
      sourceToken: choose2.sourceToken,
      resources: [
        { kind: 'character', id: source.charAId },
        { kind: 'character', id: source.charBId },
      ],
      reuseDefinitions: [
        { kind: 'character', sourceId: source.charAId, targetId: targetCharAId },
        { kind: 'animation', sourceId: source.graphicId, targetId: targetGraphicId },
      ],
    });
    expect(preview2.ok).toBe(true);
    if (!preview2.ok) throw new Error('expected preview ok');
    expect(preview2.reusedCharacterCount).toBe(1);
    expect(preview2.reusedAnimationCount).toBe(1);
    expect(preview2.characterCount).toBe(1);
    expect(preview2.animationCount).toBe(0);
    expect(preview2.newFileCount).toBe(1);

    const op2 = await service.importResources({
      projectRoot: targetCreated.projectRoot,
      project: liveProject,
      baseRevision: liveRevision,
      sourceToken: choose2.sourceToken,
      resources: [
        { kind: 'character', id: source.charAId },
        { kind: 'character', id: source.charBId },
      ],
      reuseDefinitions: [
        { kind: 'character', sourceId: source.charAId, targetId: targetCharAId },
        { kind: 'animation', sourceId: source.graphicId, targetId: targetGraphicId },
      ],
    });
    liveProject = op2.project;
    liveRevision = op2.savedRevision;
    expect(op2.reusedCharacterIds).toEqual([targetCharAId]);
    expect(op2.reusedAnimationIds).toEqual([targetGraphicId]);
    expect(op2.importedCharacters).toHaveLength(1);
    expect(op2.importedAnimations).toHaveLength(0);
    expect(op2.importedAssets).toHaveLength(1);
    // Only 1 new file was copied into assets/ (CharB's expression image).
    const filesAfterSecond = (
      await readdir(path.join(targetCreated.projectRoot, 'assets'))
    ).sort();
    expect(filesAfterSecond.length).toBe(filesAfterFirst.length + 1);

    // 4. Corrupt the reused Graphic's bitmap file on disk -> Main refuses reuse
    //    and safely falls back to copying a fresh independent definition!
    const targetBitmapAsset = liveProject.assets.find(
      (a) => a.name === 'BodyBitmap',
    )!;
    await writeFile(
      path.join(targetCreated.projectRoot, targetBitmapAsset.relativePath),
      TINY_PNG_B,
    );

    const choose3 = await service.selectSourceProject(
      {
        projectRoot: targetCreated.projectRoot,
        project: liveProject,
        baseRevision: liveRevision,
      },
      source.sourceRoot,
    );
    if (!choose3.ok || choose3.status !== 'selected') throw new Error('expected selected');

    const op3 = await service.importResources({
      projectRoot: targetCreated.projectRoot,
      project: liveProject,
      baseRevision: liveRevision,
      sourceToken: choose3.sourceToken,
      resources: [{ kind: 'animation', id: source.graphicId }],
      reuseDefinitions: [
        { kind: 'animation', sourceId: source.graphicId, targetId: targetGraphicId },
      ],
    });
    expect(op3.reusedAnimationIds).toEqual([]);
    expect(op3.importedAnimations).toHaveLength(1);
    expect(op3.importedAnimations[0]!.id).not.toBe(targetGraphicId);

    // Source project.json on disk remained completely untouched.
    const sourceDiskJson = await readFile(
      path.join(source.sourceRoot, 'project.json'),
      'utf8',
    );
    expect(JSON.parse(sourceDiskJson)).toEqual(source.sourceProject);
  });

  it('rolls back copied files and leaves existing target definitions untouched when transaction save fails during mixed reuse + new import', async () => {
    const tempDir = await makeTempDir('panda-e1-rollback-');
    const source = await createSourceProjectOnDisk(tempDir);
    const baseFs = new ProjectFileSystemService();
    const projectService = new ProjectService({ fileSystem: baseFs });
    const targetCreated = await projectService.create(
      path.join(tempDir, 'target-rollback.pandastage'),
      { name: 'Target Rollback' },
    );

    let liveProject = targetCreated.project;
    let liveRevision = 0;
    const assetFs = new AssetImportFileSystemService();
    const service = new ProjectResourceImportService({
      projectService,
      fileSystem: assetFs,
      getCurrentProjectSnapshot: () => ({
        project: liveProject,
        revision: liveRevision,
      }),
    });

    // Import Character A first.
    const choose1 = await service.selectSourceProject(
      {
        projectRoot: targetCreated.projectRoot,
        project: liveProject,
        baseRevision: liveRevision,
      },
      source.sourceRoot,
    );
    if (!choose1.ok || choose1.status !== 'selected') throw new Error('expected selected');
    const op1 = await service.importResources({
      projectRoot: targetCreated.projectRoot,
      project: liveProject,
      baseRevision: liveRevision,
      sourceToken: choose1.sourceToken,
      resources: [{ kind: 'character', id: source.charAId }],
    });
    liveProject = op1.project;
    liveRevision = op1.savedRevision;

    const filesBeforeFail = (
      await readdir(path.join(targetCreated.projectRoot, 'assets'))
    ).sort();
    const jsonBeforeFail = await readFile(
      path.join(targetCreated.projectRoot, 'project.json'),
      'utf8',
    );

    // Inject a save failure during mixed reuse (A/Graphic reused, B new).
    const choose2 = await service.selectSourceProject(
      {
        projectRoot: targetCreated.projectRoot,
        project: liveProject,
        baseRevision: liveRevision,
      },
      source.sourceRoot,
    );
    if (!choose2.ok || choose2.status !== 'selected') throw new Error('expected selected');

    const failSpy = vi
      .spyOn(baseFs, 'writeProjectFileAtomically')
      .mockRejectedValueOnce(new Error('Simulated disk full'));
    try {
      await expect(
        service.importResources({
          projectRoot: targetCreated.projectRoot,
          project: liveProject,
          baseRevision: liveRevision,
          sourceToken: choose2.sourceToken,
          resources: [
            { kind: 'character', id: source.charAId },
            { kind: 'character', id: source.charBId },
          ],
          reuseDefinitions: [
            {
              kind: 'character',
              sourceId: source.charAId,
              targetId: liveProject.characters[0]!.id,
            },
            {
              kind: 'animation',
              sourceId: source.graphicId,
              targetId: liveProject.animations[0]!.id,
            },
          ],
        }),
      ).rejects.toBeInstanceOf(ProjectResourceImportServiceError);
    } finally {
      failSpy.mockRestore();
    }

    // Zero orphan files left on disk, and target project.json is byte-identical!
    const filesAfterFail = (
      await readdir(path.join(targetCreated.projectRoot, 'assets'))
    ).sort();
    expect(filesAfterFail).toEqual(filesBeforeFail);
    const jsonAfterFail = await readFile(
      path.join(targetCreated.projectRoot, 'project.json'),
      'utf8',
    );
    expect(jsonAfterFail).toBe(jsonBeforeFail);
  });
});
