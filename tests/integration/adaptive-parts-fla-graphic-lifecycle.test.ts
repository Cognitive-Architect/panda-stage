import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CharacterService,
  LayerService,
  PROJECT_SCHEMA_VERSION,
  ProjectSchema,
  characterPartPlacementForReplacement,
  characterPartSourceBounds,
  characterPartTransformFromStaticAdjustment,
  evaluateShotAtTime,
  isFlaGraphicDefinition,
  listShotRuntimeImageAssets,
  resolveCharacterPartVisualSource,
  resolveLayerVisualParts,
  type FlaGraphicDefinition,
  type Project,
} from '../../src/domain';
import { collectExportPreparationMedia } from '../../src/domain/export-preparation';
import { FlaGraphicInstanceCommitService } from '../../src/main/services/FlaGraphicInstanceCommitService';
import type { FlaImportService } from '../../src/main/services/FlaImportService';
import { FlaPartPreviewService } from '../../src/main/services/FlaPartPreviewService';
import {
  preflightFlaBytes,
  readFlaSourceBytes,
} from '../../src/main/services/fla-import-preflight-service';
import {
  classifyForFlaRecovery,
  normalizeRecoveryCandidate,
} from '../../src/main/services/fla-recovery-classifier';
import type { FlaStaticSnapshotRasterizer } from '../../src/main/services/fla-static-snapshot-render-session';
import {
  prepareFlaStaticSnapshotDisplaySource,
  stableRenderTargetId,
} from '../../src/main/services/fla-static-snapshot-svg-builder';
import JSZip from 'jszip';
import { ProjectService } from '../../src/main/services/ProjectService';
import { visualAssetIds } from '../../src/renderer/features/canvas/temporalVisualContinuity';
import { shotThumbnailFingerprint } from '../../src/renderer/features/shots/shotThumbnail';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { CharacterAssemblySessionStore } from '../../src/renderer/stores/characterAssemblySessionStore';
import { CharacterStore } from '../../src/renderer/stores/characterStore';
import { FlaPartPreviewRequestSchema } from '../../src/shared/fla-part-preview-api';
import { buildStageRenderModel } from '../../src/shared/stage/render-model';
import {
  adaptivePartsFixture,
  adaptivePartsSourceRootTransform,
} from '../helpers/adaptivePartsFixtures';
import { buildProject, IDS } from '../unit/domain/testProject';

const REAL_FLA_PATH = 'F:\\素材\\原始人动作.fla';
const GRAPHIC_DEF_ID = '97000000-0000-4000-8000-000000000001';
const GRAPHIC_FRAME_ASSET_ID = '97100000-0000-4000-8000-000000000001';
const GRAPHIC_BITMAP_ASSET_ID = '97100000-0000-4000-8000-000000000002';
const GRAPHIC_OPAQUE_ASSET_ID = '97100000-0000-4000-8000-000000000003';
const SECOND_CHAR_ID = '97200000-0000-4000-8000-000000000001';
const SECOND_VOICE_ID = '97300000-0000-4000-8000-000000000001';
const OPEN_INSTANCE_ID = 101;

const temporaryParents: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryParents.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) {
    c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(typeName: string, data: Buffer): Buffer {
  const type = Buffer.from(typeName, 'ascii');
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  type.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([type, data])), 8 + data.length);
  return output;
}

function makeSolidPng(width: number, height: number, paint: number): Uint8Array {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    scanlines[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = row + 1 + x * 4;
      scanlines[offset] = paint % 256;
      scanlines[offset + 1] = (paint * 3) % 256;
      scanlines[offset + 2] = (paint * 7) % 256;
      scanlines[offset + 3] = 255;
    }
  }
  return new Uint8Array(Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(scanlines)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]));
}

function makeStructuredGraphicAssetSet(): {
  assets: Project['assets'];
  animation: FlaGraphicDefinition;
} {
  const frameDurationMs = 1_000 / 24;
  const sha = 'd'.repeat(64);
  const assets: Project['assets'] = [
    {
      id: GRAPHIC_FRAME_ASSET_ID,
      kind: 'image',
      name: 'Head Frame SVG',
      relativePath: `assets/${GRAPHIC_FRAME_ASSET_ID}.svg`,
      mimeType: 'image/svg+xml',
      sha256: sha,
      width: 160,
      height: 140,
      usage: 'character',
      keywords: [],
      flaGraphicFrame: { definitionId: GRAPHIC_DEF_ID, ordinal: 0 },
    },
    {
      id: GRAPHIC_BITMAP_ASSET_ID,
      kind: 'image',
      name: 'Ear Bitmap',
      relativePath: `assets/${GRAPHIC_BITMAP_ASSET_ID}.png`,
      mimeType: 'image/png',
      sha256: sha,
      width: 64,
      height: 48,
      usage: 'character',
      keywords: [],
    },
    {
      id: GRAPHIC_OPAQUE_ASSET_ID,
      kind: 'image',
      name: 'Face Vector',
      relativePath: `assets/${GRAPHIC_OPAQUE_ASSET_ID}.svg`,
      mimeType: 'image/svg+xml',
      sha256: sha,
      width: 80,
      height: 80,
      usage: 'character',
      keywords: [],
    },
  ];
  const animation: FlaGraphicDefinition = {
    kind: 'fla-graphic',
    id: GRAPHIC_DEF_ID,
    name: '头部-愣住-静',
    source: {
      basename: '原始人动作.fla',
      sha256: 'e'.repeat(64),
      renderTargetId: 'target-head-still',
      targetKind: 'graphic-symbol',
      targetName: 'LIBRARY/头部文件夹/头部-愣住-静.xml',
      startFrameIndex: 0,
      endFrameIndex: 0,
      sourceFps: 24,
      canvas: { width: 160, height: 140 },
      anchor: { x: 0, y: 0 },
      documentCanvas: { width: 1920, height: 1080 },
    },
    durationMs: frameDurationMs,
    frames: [
      {
        ordinal: 0,
        sourceFrameIndex: 0,
        assetId: GRAPHIC_FRAME_ASSET_ID,
        sha256: sha,
        sourceViewport: { x: 0, y: 0, width: 160, height: 140 },
        offset: { x: 0, y: 0 },
        startMs: 0,
        durationMs: frameDurationMs,
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
              name: 'Head',
              nodes: [
                {
                  id: 'bmp-ear',
                  type: 'bitmap',
                  drawOrder: 0,
                  bitmapRef: 'Ear Bitmap',
                  assetId: GRAPHIC_BITMAP_ASSET_ID,
                  localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 14, ty: 12 },
                },
                {
                  id: 'shape-face',
                  type: 'opaque',
                  drawOrder: 1,
                  opaqueKind: 'shape',
                  fallbackScope: 'subtree',
                  fallbackAssetId: GRAPHIC_OPAQUE_ASSET_ID,
                  fallbackViewBox: { x: 20, y: 18, width: 80, height: 80 },
                  localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 20, ty: 18 },
                  reason: 'shape',
                },
              ],
            },
          ],
        },
      ],
    },
  };
  return { assets, animation };
}

async function createSavedProjectWithStructuredGraphic(): Promise<{
  projectRoot: string;
  projectService: ProjectService;
  project: Project;
}> {
  const parent = await mkdtemp(
    path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-adaptive-fla-'),
  );
  temporaryParents.push(parent);
  const projectRoot = path.join(parent, 'Adaptive FLA Lifecycle.pandastage');
  const projectService = new ProjectService();
  const created = await projectService.create(projectRoot, {
    name: 'Adaptive FLA Lifecycle',
  });
  const base = buildProject();
  const { assets: graphicAssets, animation } = makeStructuredGraphicAssetSet();
  const project = ProjectSchema.parse({
    ...base,
    id: created.project.id,
    name: created.project.name,
    createdAt: created.project.createdAt,
    updatedAt: created.project.updatedAt,
    assets: [...base.assets, ...graphicAssets],
    animations: [animation],
  });
  await projectService.save(projectRoot, project, 1);
  return { projectRoot, projectService, project };
}

describe('Adaptive Parts with structured FLA Graphic lifecycle (Issue #1100)', () => {
  it('assembles PNG -> Graphic swap in workbench session, renders stage/export/thumbnail, saves, closes, and reopens cleanly', async () => {
    const { projectRoot, projectService, project } = await createSavedProjectWithStructuredGraphic();
    const editor = new EditorProjectStore();
    editor.open(projectRoot, project);
    const characters = new CharacterStore(editor, new CharacterService());
    const initialSnapshot = editor.getSnapshot()!;

    // 1. Create an Adaptive Parts character starting from PNG parts.
    characters.createAdaptiveParts(
      {
        name: 'Adaptive Hero',
        sourceRootTransform: adaptivePartsSourceRootTransform(),
        parts: adaptivePartsFixture(IDS.assetChar),
      },
      initialSnapshot,
    );
    const afterCreate = editor.getSnapshot()!;
    const createdChar = afterCreate.project.characters.find((c) => c.name === 'Adaptive Hero')!;
    if (createdChar.mode !== 'adaptive-parts') throw new Error('expected adaptive-parts');
    const headPart = createdChar.parts[5]!;

    // 2. Swap PNG head Part to structured FLA Graphic inside CharacterAssemblySessionStore, adjust transform, and commit.
    const sessionStore = new CharacterAssemblySessionStore({
      editorStore: editor,
      characterStore: characters,
    });
    const beginResult = sessionStore.beginAdaptiveParts(createdChar.id);
    expect(beginResult.ok).toBe(true);
    if (!beginResult.ok) throw new Error(beginResult.error.message);
    const sessionHandle = beginResult.session;
    const sessionSnap = beginResult.snapshot;
    expect(sessionSnap.kind).toBe('adaptive-parts');

    const oldBounds = characterPartSourceBounds(headPart, afterCreate.project.animations)!;
    const targetGraphic = afterCreate.project.animations.find(
      (a): a is FlaGraphicDefinition => a.id === GRAPHIC_DEF_ID && isFlaGraphicDefinition(a),
    )!;
    const replacementCandidate = {
      ...headPart,
      visualSource: { kind: 'fla-graphic' as const, animationId: GRAPHIC_DEF_ID },
      assetId: undefined,
      imageMapping: undefined,
    };
    const newBounds = characterPartSourceBounds(replacementCandidate, afterCreate.project.animations)!;
    const placement = characterPartPlacementForReplacement({
      sourceRootTransform: sessionSnap.draft.sourceRootTransform,
      oldRestTransform: headPart.restTransform,
      oldBounds,
      newBounds,
    });
    const adjustedRest = characterPartTransformFromStaticAdjustment(
      sessionSnap.draft.sourceRootTransform,
      placement.sourceRestTransform,
      newBounds,
      { offsetX: 16, offsetY: -8, scale: 1.25, rotationDeg: 10 },
    );

    const updatedParts = sessionSnap.draft.parts.map((part) =>
      part.partId === headPart.partId
        ? {
            ...part,
            visualSource: { kind: 'fla-graphic' as const, animationId: GRAPHIC_DEF_ID },
            assetId: undefined,
            imageMapping: undefined,
            restTransform: adjustedRest,
            sourceRestTransform: placement.sourceRestTransform,
            staticAdjustment: { offsetX: 16, offsetY: -8, scale: 1.25, rotationDeg: 10 },
          }
        : part,
    );
    const setResult = sessionHandle.setDraft({
      ...sessionSnap.draft,
      parts: updatedParts,
    });
    expect(setResult.ok).toBe(true);

    const applyResult = sessionHandle.commit();
    expect(applyResult.status).toBe('committed');
    sessionHandle.exit();

    // Undo / Redo works atomically on Graphic Part swap.
    editor.undo();
    const afterUndoChar = editor.getSnapshot()!.project.characters.find((c) => c.id === createdChar.id)!;
    if (afterUndoChar.mode !== 'adaptive-parts') throw new Error('expected adaptive-parts');
    expect(afterUndoChar.parts[5]?.assetId).toBe(IDS.assetChar);

    editor.redo();
    const afterRedoChar = editor.getSnapshot()!.project.characters.find((c) => c.id === createdChar.id)!;
    if (afterRedoChar.mode !== 'adaptive-parts') throw new Error('expected adaptive-parts');
    const swappedHead = afterRedoChar.parts[5]!;
    expect(swappedHead.assetId).toBeUndefined();
    expect(swappedHead.imageMapping).toBeUndefined();
    expect(swappedHead.source).toEqual(headPart.source);
    expect(resolveCharacterPartVisualSource(swappedHead)).toEqual({
      kind: 'fla-graphic',
      animationId: GRAPHIC_DEF_ID,
    });
    expect(swappedHead.staticAdjustment).toEqual({
      offsetX: 16,
      offsetY: -8,
      scale: 1.25,
      rotationDeg: 10,
    });

    // 3. Place assembled character in Shot, plus a second instance referencing same Graphic Definition cleanly.
    const withLayerResult = new LayerService().createFromAdaptiveCharacter(
      editor.getSnapshot()!.project,
      IDS.shot,
      createdChar.id,
      { x: 960, y: 540 },
    );
    const withSecondInstance = ProjectSchema.parse({
      ...withLayerResult.project,
      voiceProfiles: [
        ...withLayerResult.project.voiceProfiles,
        {
          id: SECOND_VOICE_ID,
          name: 'Second Voice',
          characterId: SECOND_CHAR_ID,
          locale: 'zh-CN',
          rate: 1,
          pitch: 0,
        },
      ],
      characters: [
        ...withLayerResult.project.characters,
        {
          ...afterRedoChar,
          id: SECOND_CHAR_ID,
          name: 'Second Isolated Instance',
          defaultVoiceProfileId: SECOND_VOICE_ID,
          parts: afterRedoChar.parts.map((part, index) => ({
            ...part,
            partId: `97400000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
            source: { kind: 'manual' as const, sourceId: `clone-part-${index}` },
            ...(part.partId === headPart.partId
              ? {
                  visualSource: {
                    kind: 'fla-graphic' as const,
                    animationId: GRAPHIC_DEF_ID,
                    instanceTransformOverrides: {
                      '0': {
                        [JSON.stringify(['bmp-ear'])]: { a: 1, b: 0, c: 0, d: 1, tx: 88, ty: -4 },
                      },
                    },
                  },
                }
              : {}),
          })),
        },
      ],
    });
    const withBothLayers = new LayerService().createFromAdaptiveCharacter(
      withSecondInstance,
      IDS.shot,
      SECOND_CHAR_ID,
      { x: 1_240, y: 540 },
    ).project;

    // 4. Save -> Close -> Reopen via ProjectService into a fresh EditorProjectStore.
    const saveResult = await projectService.save(projectRoot, withBothLayers, 2);
    expect(saveResult.project.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);

    const rawOnDisk = JSON.parse(await readFile(path.join(projectRoot, 'project.json'), 'utf8'));
    expect(rawOnDisk.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);

    const reopened = await projectService.open(projectRoot);
    const reopenedEditor = new EditorProjectStore();
    reopenedEditor.open(projectRoot, reopened.project);
    const reopenedProject = reopenedEditor.getSnapshot()!.project;

    const reopenedShot = reopenedProject.shots.find((s) => s.id === IDS.shot)!;
    const evaluated = evaluateShotAtTime(reopenedShot, 0, reopenedProject);
    const layer1Eval = evaluated.layers.find((layer) => {
      const src = reopenedShot.layers.find((c) => c.id === layer.id);
      return src?.source.kind === 'character' && src.source.characterId === createdChar.id;
    })!;
    const layer2Eval = evaluated.layers.find((layer) => {
      const src = reopenedShot.layers.find((c) => c.id === layer.id);
      return src?.source.kind === 'character' && src.source.characterId === SECOND_CHAR_ID;
    })!;

    const visual1 = resolveLayerVisualParts(reopenedProject, reopenedShot, layer1Eval);
    const visual2 = resolveLayerVisualParts(reopenedProject, reopenedShot, layer2Eval);

    expect(visual1.parts[5]?.source).toEqual({
      kind: 'adaptive-part-fla-graphic',
      characterPartId: headPart.partId,
      animationId: targetGraphic.id,
    });
    expect(visual1.parts[5]?.flaGraphic?.frameAssetId).toBe(targetGraphic.frames[0]?.assetId);
    expect(visual1.parts[5]?.flaGraphic?.layers?.[0]?.nodes[0]?.worldTransform.tx).toBe(14);
    expect(visual2.parts[5]?.flaGraphic?.layers?.[0]?.nodes[0]?.worldTransform.tx).toBe(88);

    // Export, Stage, Runtime assets, Continuity, and Thumbnail fingerprint all reflect Graphic resources.
    const exportMedia = new Set(collectExportPreparationMedia(reopenedProject).map((m) => m.asset.id));
    expect(exportMedia.has(IDS.assetChar)).toBe(true);
    expect(exportMedia.has(GRAPHIC_BITMAP_ASSET_ID)).toBe(true);
    expect(exportMedia.has(GRAPHIC_OPAQUE_ASSET_ID)).toBe(true);

    const runtimeIds = new Set(listShotRuntimeImageAssets(reopenedProject, reopenedShot).map((a) => a.id));
    expect(runtimeIds.has(GRAPHIC_BITMAP_ASSET_ID)).toBe(true);
    expect(runtimeIds.has(GRAPHIC_OPAQUE_ASSET_ID)).toBe(true);

    expect(visualAssetIds(visual1, layer1Eval)).toContain(GRAPHIC_BITMAP_ASSET_ID);
    expect(shotThumbnailFingerprint(reopenedProject, reopenedShot).length).toBeGreaterThan(0);

    const assetUrls = Object.fromEntries(
      reopenedProject.assets
        .filter((a) => a.kind === 'image')
        .map((a) => [a.id, `asset:///${a.id}`]),
    );
    const stageModel = buildStageRenderModel(reopenedProject, evaluated, assetUrls);
    const stageLayer1 = stageModel.layers.find((l) => l.id === layer1Eval.id)!;
    expect(stageLayer1.parts[5]?.flaGraphic).toBeDefined();
    expect(stageLayer1.resources?.map((r) => r.asset.id)).toEqual(
      expect.arrayContaining([GRAPHIC_BITMAP_ASSET_ID, GRAPHIC_OPAQUE_ASSET_ID]),
    );
  });

  it.skipIf(!existsSync(REAL_FLA_PATH))(
    'imports a real structured Graphic symbol from F:\\素材\\原始人动作.fla, binds it as an Adaptive CharacterPart, and survives save/reopen',
    async () => {
      // 1. Read & inspect the real local .fla source end-to-end.
      const sourceRead = await readFlaSourceBytes(REAL_FLA_PATH);
      let sourceBytes = sourceRead.bytes;
      const originalSha256 = sourceRead.sha256;
      try {
        preflightFlaBytes(sourceBytes, sourceRead.basename, sourceRead.sourcePath);
      } catch {
        const classification = classifyForFlaRecovery(sourceBytes);
        expect(classification.state).toBe('RECOVERY_CANDIDATE');
        const normalized = normalizeRecoveryCandidate(sourceBytes, classification);
        expect(normalized.applied).toBe(true);
        if (normalized.applied) {
          sourceBytes = normalized.bytes;
        }
      }
      const normalizedSha256 = createHash('sha256').update(sourceBytes).digest('hex');

      const prepared = await prepareFlaStaticSnapshotDisplaySource(sourceBytes, 'preview');
      expect(prepared.ok).toBe(true);
      if (!prepared.ok) throw new Error(prepared.message);

      const zip = await JSZip.loadAsync(sourceBytes);
      const domDocXml = await zip.file('DOMDocument.xml')?.async('string');
      const docWidthMatch = domDocXml?.match(/\bwidth="(\d+(?:\.\d+)?)"/u);
      const docHeightMatch = domDocXml?.match(/\bheight="(\d+(?:\.\d+)?)"/u);
      const docFpsMatch = domDocXml?.match(/\bframeRate="(\d+(?:\.\d+)?)"/u);
      const ir = {
        source: {
          basename: sourceRead.basename,
          sha256: normalizedSha256,
        },
        document: {
          width: docWidthMatch ? Number(docWidthMatch[1]) : prepared.source.stageWidth,
          height: docHeightMatch ? Number(docHeightMatch[1]) : prepared.source.stageHeight,
          frameRate: docFpsMatch ? Number(docFpsMatch[1]) : 24,
        },
        media: [],
      };

      const scene = prepared.source.sceneTimelines[0];
      expect(scene).toBeDefined();
      const targetId = stableRenderTargetId(sourceBytes, `scene\u0000timeline\u0000${scene!.index}`);

      const sessionId = randomUUID();
      const requestId = randomUUID();
      const flaImportService = {
        getSession: (id: string) =>
          id === sessionId
            ? {
                sessionId,
                ir,
                originalSourceSha256: originalSha256,
                sourceBytes,
              }
            : null,
      } as unknown as FlaImportService;
      const renderSession = {
        prepareDisplaySourceForPartPreview: async () => ({
          ok: true as const,
          source: prepared.source,
          xmlByteLength: prepared.xmlByteLength,
          cacheHit: false,
        }),
      };
      const rasterizer: FlaStaticSnapshotRasterizer = {
        async rasterize(input) {
          return {
            pngBytes: makeSolidPng(input.width, input.height, input.width),
            width: input.width,
            height: input.height,
            pixelCount: input.pixelCount,
          };
        },
        cancel: () => true,
        close: () => undefined,
      };

      const previewService = new FlaPartPreviewService({
        flaImportService,
        renderSession: renderSession as never,
        rasterizer,
        wallTimeMs: 30_000,
      });

      const previewRequest = FlaPartPreviewRequestSchema.parse({
        format: 'fla-part-preview',
        version: 1,
        requestId,
        sessionId,
        generation: 1,
        target: {
          renderTargetId: targetId,
          selectedFrameIndex: 0,
        },
      });
      const previewResponse = await previewService.preview(previewRequest);
      expect(previewResponse.ok).toBe(true);
      if (!previewResponse.ok || previewResponse.capability !== 'EDITABLE_PARTS_READY') {
        throw new Error(`Expected EDITABLE_PARTS_READY on real FLA, got: ${JSON.stringify(previewResponse)}`);
      }
      const plan = previewService.getPlan(previewResponse.planId, sessionId, 1)!;
      const graphicPartPreview = previewResponse.partPreviews.find(
        (part) => part.graphicInstanceImportable,
      );
      expect(graphicPartPreview).toBeDefined();
      const graphicUnit = plan.units.find(
        (unit) => unit.unitId === graphicPartPreview?.unitId,
      );
      expect(graphicUnit).toBeDefined();
      if (!graphicUnit) throw new Error('Expected at least one Graphic instance unit in 原始人动作.fla');

      // 2. Commit the real Graphic Symbol definition into a saved project via FlaGraphicInstanceCommitService.
      const parent = await mkdtemp(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-real-fla-'));
      temporaryParents.push(parent);
      const projectRoot = path.join(parent, 'Real FLA Graphic.pandastage');
      const projectService = new ProjectService();
      const created = await projectService.create(projectRoot, { name: 'Real FLA Graphic' });
      const base = buildProject();
      const seedProject = ProjectSchema.parse({
        ...base,
        id: created.project.id,
        name: created.project.name,
        createdAt: created.project.createdAt,
        updatedAt: created.project.updatedAt,
      });
      await projectService.save(projectRoot, seedProject, 1);

      const snapshotState = {
        project: seedProject,
        revision: 1,
        openInstanceId: OPEN_INSTANCE_ID,
      };
      const commitProjectService = new ProjectService({
        onProjectSaved: (root, savedProject, savedRevision) => {
          if (root === projectRoot && savedRevision !== undefined) {
            snapshotState.project = savedProject;
            snapshotState.revision = savedRevision;
          }
        },
      });

      const commitService = new FlaGraphicInstanceCommitService({
        projectService: commitProjectService,
        partPreviewService: previewService,
        getCurrentProjectSnapshot: (root) => (root === projectRoot ? snapshotState : null),
      });
      const commitResponse = await commitService.commit({
        format: 'fla-graphic-instance-commit',
        version: 1,
        requestId: randomUUID(),
        projectRoot,
        projectId: seedProject.id,
        openInstanceId: OPEN_INSTANCE_ID,
        baseRevision: 1,
        shotId: IDS.shot,
        startTimeMs: 0,
        plan: {
          planId: plan.planId,
          sessionId,
          generation: 1,
          poseIdentity: plan.poseIdentity,
          unitId: graphicUnit.unitId,
        },
      });
      if (!commitResponse.ok) {
        throw new Error(`${commitResponse.error.code}: ${commitResponse.error.message}`);
      }
      expect(commitResponse.ok).toBe(true);

      const committedGraphic = snapshotState.project.animations.find(
        (candidate): candidate is FlaGraphicDefinition =>
          candidate.id === commitResponse.animationId && isFlaGraphicDefinition(candidate),
      );
      expect(committedGraphic).toBeDefined();
      expect(committedGraphic?.structure?.frames.length).toBeGreaterThan(0);

      // 3. Bind that real structured FlaGraphicDefinition into an Adaptive Parts character alongside a PNG body part.
      const pngBodyPart = adaptivePartsFixture(IDS.assetChar)[0]!;
      const realHeadTemplate = adaptivePartsFixture(IDS.assetChar)[5]!;
      const withRealChar = new CharacterService().createAdaptiveParts(snapshotState.project, {
        name: '原始人混装角色',
        sourceRootTransform: adaptivePartsSourceRootTransform(),
        parts: [
          pngBodyPart,
          {
            partId: realHeadTemplate.partId,
            source: realHeadTemplate.source,
            visualSource: {
              kind: 'fla-graphic',
              animationId: committedGraphic!.id,
            },
            restTransform: realHeadTemplate.restTransform,
            sourceRestTransform: realHeadTemplate.restTransform,
            drawOrder: 1,
            visible: true,
            displayName: graphicUnit.sourceSymbolId ?? committedGraphic!.name,
          },
        ],
      });
      const realCharacter = withRealChar.characters.find((c) => c.name === '原始人混装角色')!;
      const withShotLayer = new LayerService().createFromAdaptiveCharacter(
        withRealChar,
        IDS.shot,
        realCharacter.id,
        { x: 960, y: 540 },
      ).project;

      // 4. Save, close, reopen, and verify complete real FLA visual resolution & export readiness.
      await projectService.save(projectRoot, withShotLayer, snapshotState.revision + 1);
      const reopened = await projectService.open(projectRoot);
      const reopenedShot = reopened.project.shots.find((s) => s.id === IDS.shot)!;
      const evaluated = evaluateShotAtTime(reopenedShot, 0, reopened.project);
      const charLayer = evaluated.layers.find((layer) => {
        const src = reopenedShot.layers.find((c) => c.id === layer.id);
        return src?.source.kind === 'character' && src.source.characterId === realCharacter.id;
      })!;

      const visual = resolveLayerVisualParts(reopened.project, reopenedShot, charLayer);
      expect(visual.parts).toHaveLength(2);
      expect(visual.parts[0]?.assetId).toBe(IDS.assetChar);
      expect(visual.parts[1]?.source).toEqual({
        kind: 'adaptive-part-fla-graphic',
        characterPartId: realHeadTemplate.partId,
        animationId: committedGraphic!.id,
      });
      expect(visual.parts[1]?.flaGraphic?.frameAssetId).toBe(committedGraphic!.frames[0]?.assetId);
      expect(visual.parts[1]?.flaGraphic?.layers?.length).toBeGreaterThan(0);

      const requiredIds = new Set(visual.resources.required.map((r) => r.assetId));
      expect(requiredIds.has(IDS.assetChar)).toBe(true);
      expect(requiredIds.size).toBeGreaterThanOrEqual(2);

      const exportIds = new Set(collectExportPreparationMedia(reopened.project).map((m) => m.asset.id));
      for (const reqId of requiredIds) {
        expect(exportIds.has(reqId)).toBe(true);
      }

      const assetUrls = Object.fromEntries(
        reopened.project.assets
          .filter((a) => a.kind === 'image')
          .map((a) => [a.id, `asset:///${a.id}`]),
      );
      const stageModel = buildStageRenderModel(reopened.project, evaluated, assetUrls);
      const stageLayer = stageModel.layers.find((l) => l.id === charLayer.id)!;
      expect(stageLayer.parts[1]?.flaGraphic).toBeDefined();
    },
    60_000,
  );
});
