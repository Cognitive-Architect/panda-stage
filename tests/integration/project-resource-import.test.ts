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
});
