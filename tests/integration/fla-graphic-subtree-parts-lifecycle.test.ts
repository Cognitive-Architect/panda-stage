import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import JSZip from 'jszip';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CharacterService,
  FlaGraphicDefinitionSchema,
  LayerService,
  PROJECT_SCHEMA_VERSION,
  ProjectSchema,
  assessFlaGraphicSubtreeCandidate,
  buildAdaptivePartsFromFlaGraphicSubtrees,
  characterPartSourceBounds,
  collectFlaGraphicSubtreeSelections,
  evaluateFlaGraphicVisual,
  evaluateShotAtTime,
  isFlaGraphicDefinition,
  listShotRuntimeImageAssets,
  resolveCharacterPartVisualSource,
  resolveLayerVisualParts,
  selectFlaGraphicSubtreeVisual,
  type AdaptivePartsCharacter,
  type FlaGraphicDefinition,
  type Project,
} from '../../src/domain';
import { collectExportPreparationMedia } from '../../src/domain/export-preparation';
import { FlaGraphicInstanceCommitService } from '../../src/main/services/FlaGraphicInstanceCommitService';
import type { FlaImportService } from '../../src/main/services/FlaImportService';
import { FlaPartPreviewService } from '../../src/main/services/FlaPartPreviewService';
import { ProjectService } from '../../src/main/services/ProjectService';
import {
  preflightFlaBytes,
  readFlaSourceBytes,
} from '../../src/main/services/fla-import-preflight-service';
import {
  classifyForFlaRecovery,
  normalizeRecoveryCandidate,
} from '../../src/main/services/fla-recovery-classifier.js';
import type { FlaStaticSnapshotRasterizer } from '../../src/main/services/fla-static-snapshot-render-session';
import {
  prepareFlaStaticSnapshotDisplaySource,
  stableRenderTargetId,
} from '../../src/main/services/fla-static-snapshot-svg-builder';
import { FlaPartPreviewRequestSchema } from '../../src/shared/fla-part-preview-api';
import { buildStageRenderModel } from '../../src/shared/stage/render-model';
import { createAdaptiveCharacterFromFlaGraphic } from '../../src/renderer/features/fla-import/createAdaptiveCharacterFromGraphic';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { CharacterStore } from '../../src/renderer/stores/characterStore';
import { buildProject, IDS } from '../unit/domain/testProject';

const REAL_XIAOSHIMEI_FLA_PATH = 'F:\\素材\\唉小师妹唉.fla';
const OPEN_INSTANCE_ID = 1;

const GRAPHIC_ID = 'b3000000-0000-4000-8000-000000000001';
const FRAME0_ASSET_ID = 'b5000000-0000-4000-8000-000000000001';
const FRAME1_ASSET_ID = 'b5000000-0000-4000-8000-000000000002';
const HAIR_ASSET_ID = 'b5000000-0000-4000-8000-000000000003';
const SLEEVE_ASSET_ID = 'b5000000-0000-4000-8000-000000000004';
const SIBLING_ASSET_ID = 'b5000000-0000-4000-8000-000000000005';

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) !== 0 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makePngChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

function makeSolidPng(width: number, height: number, seed: number): Buffer {
  const safeW = Math.max(1, Math.round(width));
  const safeH = Math.max(1, Math.round(height));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(safeW, 0);
  ihdr.writeUInt32BE(safeH, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const row = Buffer.alloc(1 + safeW * 4, Math.max(1, (seed * 31) & 0xff));
  row[0] = 0;
  const raw = Buffer.concat(Array.from({ length: safeH }, () => row));
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', deflateSync(raw)),
    makePngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function matrix(tx = 0, ty = 0, scale = 1) {
  return { a: scale, b: 0, c: 0, d: scale, tx, ty };
}

function svgBytes(fill: string, width: number, height: number): Buffer {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="${fill}"/></svg>`,
    'utf8',
  );
}

describe('FLA Graphic Subtree Adaptive Parts lifecycle persistence (#1192 V2-C)', () => {
  const temporaryParents: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryParents.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it('persists subtree nodePath, poseFrameOrdinal, and cloned instance overrides across save, close, and reopen with Stage/Export parity', async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'panda-v2c-sync-'));
    temporaryParents.push(parent);
    const projectRoot = path.join(parent, 'SubtreeParts.pandastage');
    const projectService = new ProjectService();
    const created = await projectService.create(projectRoot, { name: 'Subtree Persistence' });

    const assetsDir = path.join(projectRoot, 'assets');
    await mkdir(assetsDir, { recursive: true });
    const hairSvg = svgBytes('#6E5146', 120, 140);
    const sleeveSvg = svgBytes('#F0BFBF', 70, 130);
    const siblingSvg = svgBytes('#112233', 90, 90);
    const frame0Svg = svgBytes('#444444', 320, 320);
    const frame1Svg = svgBytes('#555555', 320, 320);

    const diskAssets = [
      { id: FRAME0_ASSET_ID, file: 'f0.svg', mime: 'image/svg+xml', bytes: frame0Svg, w: 320, h: 320, frameOrdinal: 0 },
      { id: FRAME1_ASSET_ID, file: 'f1.svg', mime: 'image/svg+xml', bytes: frame1Svg, w: 320, h: 320, frameOrdinal: 1 },
      { id: HAIR_ASSET_ID, file: 'hair.svg', mime: 'image/svg+xml', bytes: hairSvg, w: 120, h: 140 },
      { id: SLEEVE_ASSET_ID, file: 'sleeve.svg', mime: 'image/svg+xml', bytes: sleeveSvg, w: 70, h: 130 },
      { id: SIBLING_ASSET_ID, file: 'sibling.svg', mime: 'image/svg+xml', bytes: siblingSvg, w: 90, h: 90 },
    ] as const;

    for (const item of diskAssets) {
      await writeFile(path.join(assetsDir, item.file), item.bytes);
    }

    const base = buildProject();
    const definition = FlaGraphicDefinitionSchema.parse({
      id: GRAPHIC_ID,
      kind: 'fla-graphic',
      name: '小师妹合成测试',
      source: {
        basename: 'synthetic.fla',
        sha256: 'a'.repeat(64),
        renderTargetId: 'synthetic-target',
        targetKind: 'graphic-symbol',
        targetName: '小师妹合成测试',
        startFrameIndex: 0,
        endFrameIndex: 1,
        sourceFps: 24,
        canvas: { width: 320, height: 320 },
        anchor: { x: 0, y: 0 },
        documentCanvas: { width: 320, height: 320 },
      },
      durationMs: (2 * 1_000) / 24,
      frames: [
        {
          ordinal: 0,
          sourceFrameIndex: 0,
          assetId: FRAME0_ASSET_ID,
          sha256: createHash('sha256').update(frame0Svg).digest('hex'),
          sourceViewport: { x: 0, y: 0, width: 320, height: 320 },
          offset: { x: 0, y: 0 },
          startMs: 0,
          durationMs: 1_000 / 24,
          createdBySequenceImport: false,
        },
        {
          ordinal: 1,
          sourceFrameIndex: 1,
          assetId: FRAME1_ASSET_ID,
          sha256: createHash('sha256').update(frame1Svg).digest('hex'),
          sourceViewport: { x: 0, y: 0, width: 320, height: 320 },
          offset: { x: 0, y: 0 },
          startMs: 1_000 / 24,
          durationMs: 1_000 / 24,
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
                name: '图层_8',
                nodes: [
                  {
                    type: 'group',
                    id: 'hair-group',
                    groupId: '后发',
                    drawOrder: 0,
                    localTransform: matrix(60, 40),
                    children: [
                      {
                        type: 'opaque',
                        id: 'hair-leaf',
                        drawOrder: 0,
                        localTransform: matrix(),
                        opaqueKind: 'shape',
                        fallbackAssetId: HAIR_ASSET_ID,
                        fallbackScope: 'subtree',
                        fallbackViewBox: { x: 0, y: 0, width: 120, height: 140 },
                      },
                    ],
                  },
                ],
              },
              {
                name: '图层_2',
                nodes: [
                  {
                    type: 'group',
                    id: 'sleeve-group',
                    groupId: '左袖',
                    drawOrder: 0,
                    localTransform: matrix(10, 150),
                    children: [
                      {
                        type: 'opaque',
                        id: 'sleeve-leaf',
                        drawOrder: 0,
                        localTransform: matrix(),
                        opaqueKind: 'shape',
                        fallbackAssetId: SLEEVE_ASSET_ID,
                        fallbackScope: 'subtree',
                        fallbackViewBox: { x: 0, y: 0, width: 70, height: 130 },
                      },
                    ],
                  },
                  {
                    type: 'group',
                    id: 'unused-sibling-group',
                    groupId: '裙摆',
                    drawOrder: 1,
                    localTransform: matrix(90, 200),
                    children: [
                      {
                        type: 'opaque',
                        id: 'sibling-leaf',
                        drawOrder: 0,
                        localTransform: matrix(),
                        opaqueKind: 'shape',
                        fallbackAssetId: SIBLING_ASSET_ID,
                        fallbackScope: 'subtree',
                        fallbackViewBox: { x: 0, y: 0, width: 90, height: 90 },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    const initialProject = ProjectSchema.parse({
      ...base,
      id: created.project.id,
      name: created.project.name,
      createdAt: created.project.createdAt,
      updatedAt: created.project.updatedAt,
      assets: [
        ...base.assets,
        ...diskAssets.map((item) => ({
          id: item.id,
          kind: 'image' as const,
          name: item.file,
          relativePath: `assets/${item.file}`,
          mimeType: item.mime,
          sha256: createHash('sha256').update(item.bytes).digest('hex'),
          width: item.w,
          height: item.h,
          usage: 'uncategorized' as const,
          keywords: [],
          ...('frameOrdinal' in item
            ? { flaGraphicFrame: { definitionId: GRAPHIC_ID, ordinal: item.frameOrdinal } }
            : {}),
        })),
      ],
      animations: [definition],
    });

    const createInput = buildAdaptivePartsFromFlaGraphicSubtrees({
      project: initialProject,
      definition,
      frameOrdinal: 0,
      selections: [
        { nodePath: ['sleeve-group'], label: '左袖' },
        { nodePath: ['hair-group'], label: '后发' },
      ],
      instanceTransformOverrides: {
        '0': {
          [JSON.stringify(['hair-group'])]: matrix(72, 48),
          [JSON.stringify(['unused-sibling-group'])]: matrix(180, 220),
        },
      },
    });

    const charService = new CharacterService();
    const withChar = charService.createAdaptiveParts(initialProject, createInput);
    const adaptiveChar = withChar.characters.at(-1) as AdaptivePartsCharacter;
    const hairPartId = adaptiveChar.parts[0]!.partId;
    const sleevePartId = adaptiveChar.parts[1]!.partId;

    // Independently move Hair Part without touching Sleeve Part or shared Definition.
    const movedChar = charService.updateAdaptivePart(withChar, adaptiveChar.id, hairPartId, {
      restTransform: matrix(25, -12),
    });
    const withShot = new LayerService().createFromAdaptiveCharacter(
      movedChar,
      IDS.shot,
      adaptiveChar.id,
      { x: 960, y: 540 },
    ).project;

    await projectService.save(projectRoot, withShot, 2);
    const reopened = await projectService.open(projectRoot);
    expect(reopened.project.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);

    const reopenedChar = reopened.project.characters.find(
      (c) => c.id === adaptiveChar.id,
    ) as AdaptivePartsCharacter;
    expect(reopenedChar.parts).toHaveLength(2);
    expect(resolveCharacterPartVisualSource(reopenedChar.parts[0]!)).toMatchObject({
      kind: 'fla-graphic',
      animationId: GRAPHIC_ID,
      nodePath: ['hair-group'],
      poseFrameOrdinal: 0,
      instanceTransformOverrides: {
        '0': {
          [JSON.stringify(['hair-group'])]: matrix(72, 48),
        },
      },
    });
    expect(resolveCharacterPartVisualSource(reopenedChar.parts[1]!)).toMatchObject({
      kind: 'fla-graphic',
      animationId: GRAPHIC_ID,
      nodePath: ['sleeve-group'],
      poseFrameOrdinal: 0,
    });
    expect(reopenedChar.parts[0]!.partId).toBe(hairPartId);
    expect(reopenedChar.parts[1]!.partId).toBe(sleevePartId);
    expect(reopenedChar.parts[0]!.restTransform).toEqual(matrix(25, -12));
    expect(reopenedChar.parts[1]!.restTransform).toEqual(matrix(0, 0));

    // Shared Graphic Definition remains completely unpolluted by cloned Part override or Hair transform.
    const reopenedDef = reopened.project.animations.find(
      (a): a is FlaGraphicDefinition => a.id === GRAPHIC_ID && isFlaGraphicDefinition(a),
    )!;
    expect(reopenedDef.structure?.frames[0]?.layers[0]?.nodes[0]?.localTransform).toEqual(matrix(60, 40));

    // Evaluate Shot well into Frame 1 (120ms): pinned to frame 0, only Hair + Sleeve SVGs referenced.
    const reopenedShot = reopened.project.shots.find((s) => s.id === IDS.shot)!;
    const evaluated = evaluateShotAtTime(reopenedShot, 120, reopened.project);
    const charEvalLayer = evaluated.layers.at(-1)!;
    const visual = resolveLayerVisualParts(reopened.project, reopenedShot, charEvalLayer);
    expect(visual.parts[0]?.flaGraphic?.layers?.[0]?.nodes[0]?.worldTransform.tx).toBe(72);
    expect(visual.parts[0]?.flaGraphic?.resourceAssetIds).toEqual([HAIR_ASSET_ID]);
    expect(visual.parts[1]?.flaGraphic?.resourceAssetIds).toEqual([SLEEVE_ASSET_ID]);

    const exportMedia = new Set(collectExportPreparationMedia(reopened.project).map((m) => m.asset.id));
    expect(exportMedia.has(HAIR_ASSET_ID)).toBe(true);
    expect(exportMedia.has(SLEEVE_ASSET_ID)).toBe(true);
    expect(exportMedia.has(SIBLING_ASSET_ID)).toBe(false);
    expect(exportMedia.has(FRAME0_ASSET_ID)).toBe(false);
    expect(exportMedia.has(FRAME1_ASSET_ID)).toBe(false);

    const runtimeIds = new Set(listShotRuntimeImageAssets(reopened.project, reopenedShot).map((a) => a.id));
    expect(runtimeIds.has(HAIR_ASSET_ID)).toBe(true);
    expect(runtimeIds.has(SLEEVE_ASSET_ID)).toBe(true);
    expect(runtimeIds.has(SIBLING_ASSET_ID)).toBe(false);

    const stageModel = buildStageRenderModel(
      reopened.project,
      evaluated,
      Object.fromEntries(reopened.project.assets.filter((a) => a.kind === 'image').map((a) => [a.id, `asset:///${a.id}`])),
    );
    const stageCharLayer = stageModel.layers.find((l) => l.id === charEvalLayer.id)!;
    expect(stageCharLayer.resources?.map((r) => r.asset.id).sort()).toEqual(
      [HAIR_ASSET_ID, SLEEVE_ASSET_ID].sort(),
    );
  });

  it.skipIf(!existsSync(REAL_XIAOSHIMEI_FLA_PATH))(
    'extracts independent Hair and Sleeve subtree CharacterParts from F:\\素材\\唉小师妹唉.fla (朱孝天女儿) without whole-person fallback',
    async () => {
      const sourceRead = await readFlaSourceBytes(REAL_XIAOSHIMEI_FLA_PATH);
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
        source: { basename: sourceRead.basename, sha256: normalizedSha256 },
        document: {
          width: docWidthMatch ? Number(docWidthMatch[1]) : prepared.source.stageWidth,
          height: docHeightMatch ? Number(docHeightMatch[1]) : prepared.source.stageHeight,
          frameRate: docFpsMatch ? Number(docFpsMatch[1]) : 24,
        },
        media: [],
      };

      const scene = prepared.source.sceneTimelines[0]!;
      const targetId = stableRenderTargetId(sourceBytes, `scene\u0000timeline\u0000${scene.index}`);
      const sessionId = randomUUID();
      const requestId = randomUUID();
      const flaImportService = {
        getSession: (id: string) =>
          id === sessionId
            ? { sessionId, ir, originalSourceSha256: originalSha256, sourceBytes }
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

      const previewResponse = await previewService.preview(
        FlaPartPreviewRequestSchema.parse({
          format: 'fla-part-preview',
          version: 1,
          requestId,
          sessionId,
          generation: 1,
          purpose: 'graphic-instance',
          target: { renderTargetId: targetId, selectedFrameIndex: 0 },
        }),
      );
      if (!previewResponse.ok || previewResponse.capability !== 'GRAPHIC_INSTANCES_READY') {
        throw new Error(`Expected GRAPHIC_INSTANCES_READY on 唉小师妹唉.fla, got ${JSON.stringify(previewResponse)}`);
      }
      const plan = previewService.getPlan(previewResponse.planId, sessionId, 1)!;
      const zhuUnit = plan.units.find(
        (unit) => unit.sourceSymbolId === '朱孝天女儿' || unit.sourceAddress?.includes('朱孝天女儿'),
      ) ?? plan.units[0]!;
      expect(zhuUnit).toBeDefined();

      const parent = await mkdtemp(path.join(os.tmpdir(), 'panda-xiaoshimei-v2c-'));
      temporaryParents.push(parent);
      const projectRoot = path.join(parent, 'Xiaoshimei.pandastage');
      const projectService = new ProjectService();
      const created = await projectService.create(projectRoot, { name: '小师妹真实验证' });
      const base = buildProject();
      const seedProject = ProjectSchema.parse({
        ...base,
        id: created.project.id,
        name: created.project.name,
        createdAt: created.project.createdAt,
        updatedAt: created.project.updatedAt,
      });
      await projectService.save(projectRoot, seedProject, 1);

      const snapshotState = { project: seedProject, revision: 1, openInstanceId: OPEN_INSTANCE_ID };
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
          unitId: zhuUnit.unitId,
        },
      });
      if (!commitResponse.ok) {
        throw new Error(`${commitResponse.error.code}: ${commitResponse.error.message}`);
      }
      expect(commitResponse.ok).toBe(true);

      const committedGraphic = snapshotState.project.animations.find(
        (candidate): candidate is FlaGraphicDefinition =>
          candidate.id === commitResponse.animationId && isFlaGraphicDefinition(candidate),
      )!;
      expect(committedGraphic).toBeDefined();
      const fullVisual = evaluateFlaGraphicVisual({
        definition: committedGraphic,
        frameOrdinal: 0,
        mode: 'instance',
      })!;
      expect(fullVisual.resourceAssetIds.length).toBeGreaterThanOrEqual(50);

      // Select verified back-hair Group (图层_8 -> node[0]) & sleeve Group (图层_2 -> node[3]).
      const hairNode = fullVisual.layers![0]!.nodes[0]!;
      const sleeveNode = fullVisual.layers![1]!.nodes[3]!;
      expect(hairNode.path).toEqual(['graphic:朱孝天女儿/layer-2-frame-0/0']);
      expect(sleeveNode.path).toEqual(['graphic:朱孝天女儿/layer-1-frame-0/3']);

      const hairAssessment = assessFlaGraphicSubtreeCandidate({
        definition: committedGraphic,
        frameOrdinal: 0,
        nodePath: hairNode.path,
        assets: snapshotState.project.assets,
      });
      const sleeveAssessment = assessFlaGraphicSubtreeCandidate({
        definition: committedGraphic,
        frameOrdinal: 0,
        nodePath: sleeveNode.path,
        assets: snapshotState.project.assets,
      });
      expect(hairAssessment.extractable).toBe(true);
      expect(sleeveAssessment.extractable).toBe(true);

      const createInput = buildAdaptivePartsFromFlaGraphicSubtrees({
        project: snapshotState.project,
        definition: committedGraphic,
        frameOrdinal: 0,
        selections: [
          { nodePath: sleeveNode.path, label: '小师妹左袖' },
          { nodePath: hairNode.path, label: '小师妹后发' },
        ],
        characterName: '小师妹分件角色',
      });
      // Back-to-front drawOrder: 图层_8 hair -> drawOrder 0; 图层_2 sleeve -> drawOrder 1.
      expect(createInput.parts.map((part) => part.displayName)).toEqual(['小师妹后发', '小师妹左袖']);
      expect(createInput.parts[0]!.partId).not.toBe(createInput.parts[1]!.partId);
      expect(createInput.parts[0]!.source.sourceId).not.toBe(createInput.parts[1]!.source.sourceId);

      const hairSubtree = selectFlaGraphicSubtreeVisual(fullVisual, hairNode.path);
      const sleeveSubtree = selectFlaGraphicSubtreeVisual(fullVisual, sleeveNode.path);
      expect(hairSubtree.resourceAssetIds.length).toBeGreaterThan(0);
      expect(sleeveSubtree.resourceAssetIds.length).toBeGreaterThan(0);
      const overlap = hairSubtree.resourceAssetIds.filter((id) =>
        sleeveSubtree.resourceAssetIds.includes(id),
      );
      expect(overlap).toEqual([]);
      expect(hairSubtree.resourceAssetIds.length + sleeveSubtree.resourceAssetIds.length).toBeLessThan(
        fullVisual.resourceAssetIds.length,
      );

      const charService = new CharacterService();
      const withChar = charService.createAdaptiveParts(snapshotState.project, createInput);
      const createdChar = withChar.characters.find((c) => c.name === '小师妹分件角色') as AdaptivePartsCharacter;
      // Verify tight bounds on real subtrees are much smaller than full character canvas (329x334).
      const hairBounds = characterPartSourceBounds(
        createdChar.parts[0]!,
        withChar.animations,
        withChar.assets,
      )!;
      const sleeveBounds = characterPartSourceBounds(
        createdChar.parts[1]!,
        withChar.animations,
        withChar.assets,
      )!;
      expect(hairBounds.width).toBeLessThan(200);
      expect(sleeveBounds.width).toBeLessThan(120);

      // Transform hair Part independently & place in clean Shot without the full Graphic Layer.
      const movedHair = charService.updateAdaptivePart(
        withChar,
        createdChar.id,
        createdChar.parts[0]!.partId,
        { restTransform: matrix(32, -16) },
      );
      const placed = new LayerService().createFromAdaptiveCharacter(
        movedHair,
        IDS.shot,
        createdChar.id,
        { x: 960, y: 540 },
      ).project;
      const subtreeShotOnly: Project = ProjectSchema.parse({
        ...placed,
        shots: [
          {
            ...placed.shots[0]!,
            layers: placed.shots[0]!.layers.filter(
              (layer) =>
                layer.source.kind !== 'animation' ||
                layer.source.animationId !== committedGraphic.id,
            ),
          },
        ],
      });

      await projectService.save(projectRoot, subtreeShotOnly, snapshotState.revision + 1);
      const reopened = await projectService.open(projectRoot);
      const reopenedShot = reopened.project.shots[0]!;
      const evaluated = evaluateShotAtTime(reopenedShot, 0, reopened.project);
      const charShotLayer = reopenedShot.layers.find(
        (layer) =>
          layer.source.kind === 'character' &&
          layer.source.characterId === createdChar.id,
      )!;
      const charEvalLayer = evaluated.layers.find(
        (layer) => layer.id === charShotLayer.id,
      )!;
      const visual = resolveLayerVisualParts(reopened.project, reopenedShot, charEvalLayer);

      expect(visual.parts).toHaveLength(2);
      expect(visual.parts[0]?.flaGraphic?.resourceAssetIds).toEqual(hairSubtree.resourceAssetIds);
      expect(visual.parts[1]?.flaGraphic?.resourceAssetIds).toEqual(sleeveSubtree.resourceAssetIds);
      expect(visual.parts[0]?.localRect).toEqual(hairBounds);
      expect(visual.parts[1]?.localRect).toEqual(sleeveBounds);

      const exportMedia = new Set(collectExportPreparationMedia(reopened.project).map((m) => m.asset.id));
      const expectedSubtreeAssets = new Set([
        ...hairSubtree.resourceAssetIds,
        ...sleeveSubtree.resourceAssetIds,
      ]);
      for (const expectedId of expectedSubtreeAssets) {
        expect(exportMedia.has(expectedId)).toBe(true);
      }
      // Unused SVGs from the other 50+ nodes of 朱孝天女儿 must NOT be pulled into export!
      const leakedExtra = fullVisual.resourceAssetIds.filter(
        (id) => !expectedSubtreeAssets.has(id) && exportMedia.has(id),
      );
      expect(leakedExtra).toEqual([]);
      expect(exportMedia.has(committedGraphic.frames[0]!.assetId)).toBe(false);

      const stageModel = buildStageRenderModel(
        reopened.project,
        evaluated,
        Object.fromEntries(reopened.project.assets.filter((a) => a.kind === 'image').map((a) => [a.id, `asset:///${a.id}`])),
      );
      const stageCharLayer = stageModel.layers.find(
        (layer) => layer.id === charShotLayer.id,
      )!;
      expect(stageCharLayer.parts[0]?.flaGraphic?.resourceAssetIds).toEqual(
        hairSubtree.resourceAssetIds,
      );
      expect(stageCharLayer.parts[1]?.flaGraphic?.resourceAssetIds).toEqual(
        sleeveSubtree.resourceAssetIds,
      );

      // Also verify #1203 automatic candidate collection on real 朱孝天女儿 extracts >= 10 parts cleanly.
      const autoCollected = collectFlaGraphicSubtreeSelections({
        definition: committedGraphic,
        frameOrdinal: 0,
        assets: snapshotState.project.assets,
      });
      expect(autoCollected.selections.length).toBeGreaterThanOrEqual(10);
      const autoInput = buildAdaptivePartsFromFlaGraphicSubtrees({
        project: snapshotState.project,
        definition: committedGraphic,
        frameOrdinal: 0,
        selections: autoCollected.selections,
      });
      expect(autoInput.parts.length).toBe(autoCollected.selections.length);
      expect(autoInput.parts.every((part) => part.visualSource?.kind === 'fla-graphic')).toBe(true);
    },
    60_000,
  );

  it('runs shared V1-A/B Graphic->AdaptiveParts flow on a 28-part synthetic FLA with Definition reuse and save/reopen parity (#1203)', async () => {
    const zip = new JSZip();
    zip.file(
      'DOMDocument.xml',
      `<?xml version="1.0" encoding="UTF-8"?>
<DOMDocument width="320" height="240" xmlns="http://ns.adobe.com/xfl/2008/">
  <timelines><DOMTimeline name="Scene"><layers><DOMLayer name="Main"><frames>
    <DOMFrame index="0" duration="1"><elements>
      <DOMSymbolInstance libraryItemName="HeroRig" symbolType="graphic" loop="loop" firstFrame="0">
        <matrix><Matrix a="1" d="1" tx="40" ty="20"/></matrix>
      </DOMSymbolInstance>
    </elements></DOMFrame>
  </frames></DOMLayer></layers></DOMTimeline></timelines>
</DOMDocument>`,
    );
    const groupParts = Array.from({ length: 24 }, (_, idx) => {
      const x = (idx % 6) * 28;
      const y = Math.floor(idx / 6) * 28;
      return `<DOMGroup name="PartGroup${idx + 1}"><members><DOMShape>
        <fills><FillStyle index="1"><SolidColor color="#${String(10 + idx).padStart(2, '0')}55aa" alpha="1"/></FillStyle></fills>
        <edges><Edge fillStyle1="1" cubics="!${x} ${y}|${x + 16} ${y}|${x + 16} ${y + 16}|${x} ${y + 16}|${x} ${y}"/></edges>
      </DOMShape></members></DOMGroup>`;
    }).join('\n');
    const directShapes = Array.from({ length: 3 }, (_, idx) => {
      const x = 180 + idx * 24;
      return `<DOMShape>
        <fills><FillStyle index="1"><SolidColor color="#cc${String(20 + idx * 10)}44" alpha="1"/></FillStyle></fills>
        <edges><Edge fillStyle1="1" cubics="!${x} 140|${x + 18} 140|${x + 18} 160|${x} 160|${x} 140"/></edges>
      </DOMShape>`;
    }).join('\n');
    zip.file(
      'LIBRARY/HeroRig.xml',
      `<?xml version="1.0" encoding="UTF-8"?>
<DOMSymbolItem name="HeroRig" symbolType="graphic" xmlns="http://ns.adobe.com/xfl/2008/">
  <timelines><DOMTimeline name="HeroRig"><layers><DOMLayer name="Parts"><frames>
    <DOMFrame index="0" duration="1"><elements>
      <DOMSymbolInstance libraryItemName="HeadPart" symbolType="graphic" loop="loop" firstFrame="0">
        <matrix><Matrix a="1" d="1" tx="12" ty="8"/></matrix>
      </DOMSymbolInstance>
      ${groupParts}
      ${directShapes}
    </elements></DOMFrame>
  </frames></DOMLayer></layers></DOMTimeline></timelines>
</DOMSymbolItem>`,
    );
    zip.file(
      'LIBRARY/HeadPart.xml',
      `<?xml version="1.0" encoding="UTF-8"?>
<DOMSymbolItem name="HeadPart" symbolType="graphic" xmlns="http://ns.adobe.com/xfl/2008/">
  <timelines><DOMTimeline name="HeadPart"><layers><DOMLayer name="Head"><frames>
    <DOMFrame index="0" duration="1"><elements><DOMShape>
      <fills><FillStyle index="1"><SolidColor color="#f0a060" alpha="1"/></FillStyle></fills>
      <edges><Edge fillStyle1="1" cubics="!0 0|24 0|24 24|0 24|0 0"/></edges>
    </DOMShape></elements></DOMFrame>
  </frames></DOMLayer></layers></DOMTimeline></timelines>
</DOMSymbolItem>`,
    );

    const sourceBytes = await zip.generateAsync({ type: 'uint8array' });
    const sha256 = createHash('sha256').update(sourceBytes).digest('hex');
    const prepared = await prepareFlaStaticSnapshotDisplaySource(sourceBytes, 'preview');
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) throw new Error(prepared.message);

    const sessionId = randomUUID();
    const requestId = randomUUID();
    const scene = prepared.source.sceneTimelines[0]!;
    const targetId = stableRenderTargetId(sourceBytes, `scene\u0000timeline\u0000${scene.index}`);
    const flaImportService = {
      getSession: (id: string) =>
        id === sessionId
          ? {
              sessionId,
              ir: {
                source: { basename: 'hero-28.fla', sha256 },
                document: { width: 320, height: 240, frameRate: 24 },
                media: [],
              },
              originalSourceSha256: sha256,
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

    const previewResponse = await previewService.preview(
      FlaPartPreviewRequestSchema.parse({
        format: 'fla-part-preview',
        version: 1,
        requestId,
        sessionId,
        generation: 1,
        purpose: 'graphic-instance',
        target: { renderTargetId: targetId, selectedFrameIndex: 0 },
      }),
    );
    if (!previewResponse.ok || previewResponse.capability !== 'GRAPHIC_INSTANCES_READY') {
      throw new Error(`Expected GRAPHIC_INSTANCES_READY, got ${JSON.stringify(previewResponse)}`);
    }
    const heroPreview = { ...previewResponse, sessionId, generation: 1 };
    const heroUnit = heroPreview.partPreviews[0]!;

    const parent = await mkdtemp(path.join(os.tmpdir(), 'panda-v1ab-parity-'));
    temporaryParents.push(parent);
    const projectRoot = path.join(parent, 'DualEntry.pandastage');
    const projectService = new ProjectService();
    const created = await projectService.create(projectRoot, { name: 'Dual Entry Parity' });
    const base = buildProject();
    const seedProject = ProjectSchema.parse({
      ...base,
      id: created.project.id,
      name: created.project.name,
      createdAt: created.project.createdAt,
      updatedAt: created.project.updatedAt,
    });
    await projectService.save(projectRoot, seedProject, 1);

    const store = new EditorProjectStore();
    store.open(projectRoot, seedProject);
    // Sync store revision to 1 so commit service matches disk revision 1.
    store.markSaved(seedProject, 0);
    // Re-open with revision 1 via ProjectService-aligned state:
    const snapshotState = {
      project: seedProject,
      revision: store.getSnapshot()!.revision,
      openInstanceId: store.getProjectInstanceId()!,
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
    const characters = new CharacterStore(store, new CharacterService());
    const ensureMainSnapshot = async (snap: { project: Project; revision: number }) => {
      snapshotState.project = snap.project;
      snapshotState.revision = snap.revision;
      snapshotState.openInstanceId = store.getProjectInstanceId()!;
    };

    // Entry 1 (导入角色): creates AdaptiveParts character without shotId, bypassing 24 PNG limit.
    const entry1 = await createAdaptiveCharacterFromFlaGraphic({
      preview: heroPreview,
      unitId: heroUnit.unitId,
      characterName: 'HeroRig',
      poseFrameOrdinal: 0,
      api: { commitGraphicInstance: (req) => commitService.commit(req) },
      store,
      characters,
      ensureMainSnapshot,
    });
    expect(entry1.ok).toBe(true);
    if (!entry1.ok) throw new Error(entry1.message);
    expect(entry1.partCount).toBe(28);
    const afterEntry1 = store.getSnapshot()!.project;
    expect(afterEntry1.animations).toHaveLength(1);
    expect(afterEntry1.shots[0]!.layers).toHaveLength(base.shots[0]!.layers.length);
    const assetsAfterEntry1 = afterEntry1.assets.length;

    // Entry 2 (导入 FLA -> 创建为角色): reuses existing Definition, produces identical part semantics.
    const entry2 = await createAdaptiveCharacterFromFlaGraphic({
      preview: heroPreview,
      unitId: heroUnit.unitId,
      characterName: 'HeroRig',
      poseFrameOrdinal: 0,
      api: { commitGraphicInstance: (req) => commitService.commit(req) },
      store,
      characters,
      ensureMainSnapshot,
    });
    expect(entry2.ok).toBe(true);
    if (!entry2.ok) throw new Error(entry2.message);
    expect(entry2.animationId).toBe(entry1.animationId);
    expect(entry2.characterId).not.toBe(entry1.characterId);
    expect(entry2.partCount).toBe(28);

    const afterEntry2 = store.getSnapshot()!.project;
    expect(afterEntry2.animations).toHaveLength(1);
    expect(afterEntry2.assets).toHaveLength(assetsAfterEntry1);
    expect(afterEntry2.shots[0]!.layers).toHaveLength(base.shots[0]!.layers.length);

    const char1 = afterEntry2.characters.find((c) => c.id === entry1.characterId) as AdaptivePartsCharacter;
    const char2 = afterEntry2.characters.find((c) => c.id === entry2.characterId) as AdaptivePartsCharacter;
    const normalizeParts = (c: AdaptivePartsCharacter) =>
      c.parts.map((p) => ({
        drawOrder: p.drawOrder,
        displayName: p.displayName,
        sourcePoseFrame: p.source.kind === 'source-instance' ? p.source.sourcePoseFrame : null,
        sourceRestTransform: p.sourceRestTransform,
        restTransform: p.restTransform,
        visualSource: p.visualSource,
      }));
    expect(normalizeParts(char2)).toEqual(normalizeParts(char1));
    expect(char1.parts.map((p) => p.partId)).not.toEqual(char2.parts.map((p) => p.partId));

    // Persist to disk, close, reopen, and verify all 28 parts survive intact.
    const withCharShot = new LayerService().createFromAdaptiveCharacter(
      afterEntry2,
      IDS.shot,
      char1.id,
      { x: 960, y: 540 },
    ).project;
    await projectService.save(projectRoot, withCharShot, store.getSnapshot()!.revision);
    const reopened = await projectService.open(projectRoot);
    const reopenedChar1 = reopened.project.characters.find((c) => c.id === char1.id) as AdaptivePartsCharacter;
    expect(reopenedChar1.parts).toHaveLength(28);
    const reopenedShot = reopened.project.shots.find((s) => s.id === IDS.shot)!;
    const evaluated = evaluateShotAtTime(reopenedShot, 0, reopened.project);
    const visual = resolveLayerVisualParts(reopened.project, reopenedShot, evaluated.layers.at(-1)!);
    expect(visual.parts).toHaveLength(28);
  }, 60_000);
});
