import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import JSZip from 'jszip';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CharacterService,
  FlaGraphicDefinitionSchema,
  LayerService,
  ProjectSchema,
  assessFlaGraphicSubtreeCandidate,
  buildAdaptivePartsFromFlaGraphicSubtrees,
  buildSvgFromFlaEditableShapeRegions,
  characterPartSourceBounds,
  composeAffineMatrix,
  decomposeSvgToEditableShapeRegions,
  evaluateFlaGraphicVisual,
  evaluateShotAtTime,
  isFlaGraphicDefinition,
  isFlaGraphicEditableSubtreeShapeNode,
  migrateProject,
  resolveLayerVisualParts,
  unapplyFlaGraphicSubtreeViewBox,
  type FlaGraphicDefinition,
  type FlaGraphicStructure,
  type Layer,
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
import { multiplyAffineMatrices, type AffineMatrix2D } from '../../src/shared/affine-matrix';
import { buildStageRenderModel } from '../../src/shared/stage/render-model';
import { parseFlaSvgShapeHitGeometry } from '../../src/renderer/features/canvas/flaSvgShapeHit';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import exampleProject from '../../demo-project/project-v1.example.json';
import { buildProject, IDS } from '../unit/domain/testProject';

const REAL_XIAOSHIMEI_FLA_PATH = 'F:\\素材\\唉小师妹唉.fla';
const OPEN_INSTANCE_ID = 1;
const IDENTITY: AffineMatrix2D = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

const FRAME_ASSET_ID = 'f1000000-0000-4000-8000-000000000001';
const RING_SHAPE_ASSET_ID = 'f1000000-0000-4000-8000-000000000002';
const GRAPHIC_ID = 'f2000000-0000-4000-8000-000000000001';
const LAYER_A_ID = 'f3000000-0000-4000-8000-000000000001';
const LAYER_B_ID = 'f3000000-0000-4000-8000-000000000002';

const RING_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="40 30 220 180" width="220" height="180"><path d="M 60 50 L 140 50 L 140 130 L 60 130 Z M 85 75 L 85 105 L 115 105 L 115 75 Z M 200 160 L 240 160 L 240 200 L 200 200 Z" transform="matrix(1 0 0 1 0 0)" fill="#ff5533" fill-opacity="1" stroke="none" fill-rule="nonzero"/><path d="M 155 60 L 195 60" transform="matrix(1 0 0 1 0 0)" fill="none" stroke="#112233" stroke-opacity="1" stroke-width="8" stroke-linecap="butt" stroke-linejoin="miter" stroke-miterlimit="3"/></svg>`;

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function makeSolidPng(width: number, height: number): Buffer {
  const safeW = Math.max(1, Math.round(width));
  const safeH = Math.max(1, Math.round(height));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(safeW, 0);
  ihdr.writeUInt32BE(safeH, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const row = Buffer.alloc(1 + safeW * 4, 42);
  row[0] = 0;
  const raw = Buffer.concat(Array.from({ length: safeH }, () => row));
  const crc32 = (buffer: Buffer) => {
    let crc = 0xffffffff;
    for (const byte of buffer) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) {
        crc = (crc & 1) !== 0 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const tb = Buffer.from(type, 'ascii');
    const lb = Buffer.alloc(4);
    lb.writeUInt32BE(data.length, 0);
    const cb = Buffer.alloc(4);
    cb.writeUInt32BE(crc32(Buffer.concat([tb, data])), 0);
    return Buffer.concat([lb, tb, data, cb]);
  };
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

describe('FLA Shape S1/S2 persistence, Stage/Export parity, and real FLA lifecycle', () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    while (tempRoots.length > 0) {
      await rm(tempRoots.pop()!, { recursive: true, force: true });
    }
  });

  it('persists subtree Shape instance transform across Save/Close/Reopen, keeps sibling isolated, and matches Stage/Export evaluation', async () => {
    const parentTemp = await mkdtemp(path.join(os.tmpdir(), 'panda-shape-s2-lifecycle-'));
    tempRoots.push(parentTemp);
    const projectRoot = path.join(parentTemp, 'ShapeLifecycle.pandastage');
    const projectService = new ProjectService();
    const created = await projectService.create(projectRoot, { name: 'Shape S2 Lifecycle' });

    await mkdir(path.join(projectRoot, 'assets'), { recursive: true });
    await writeFile(path.join(projectRoot, 'assets', 'frame-0.svg'), RING_SVG, 'utf8');
    await writeFile(path.join(projectRoot, 'assets', 'ring-shape.svg'), RING_SVG, 'utf8');

    const groupMatrix = composeAffineMatrix({ tx: 30, ty: 20, rotationDeg: 25, scaleX: 0.5, scaleY: 0.5 });
    const structure: FlaGraphicStructure = {
      version: 1,
      frames: [
        {
          ordinal: 0,
          layers: [
            {
              name: '图层_2',
              nodes: [
                {
                  type: 'group',
                  id: 'group-outfit',
                  sourceAddress: 'graphic:Shape/layer-0-frame-0/0',
                  drawOrder: 0,
                  localTransform: groupMatrix,
                  groupId: 'outfit',
                  children: [
                    {
                      type: 'opaque',
                      id: 'shape-ring',
                      sourceAddress: 'graphic:Shape/layer-0-frame-0/0/0',
                      drawOrder: 0,
                      localTransform: IDENTITY,
                      opaqueKind: 'shape',
                      sourceRef: 'fla-shape-ring',
                      fallbackScope: 'subtree',
                      fallbackAssetId: RING_SHAPE_ASSET_ID,
                      fallbackViewBox: { x: 40, y: 30, width: 220, height: 180 },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const definition = FlaGraphicDefinitionSchema.parse({
      id: GRAPHIC_ID,
      kind: 'fla-graphic',
      name: 'Shape Graphic',
      source: {
        basename: 'shape.fla',
        sha256: 'a'.repeat(64),
        renderTargetId: 'shape-target',
        targetKind: 'graphic-symbol',
        targetName: 'ShapeTarget',
        startFrameIndex: 0,
        endFrameIndex: 0,
        sourceFps: 24,
        canvas: { width: 320, height: 260 },
        anchor: { x: 0, y: 0 },
        documentCanvas: { width: 1920, height: 1080 },
      },
      durationMs: 1_000 / 24,
      frames: [
        {
          ordinal: 0,
          sourceFrameIndex: 0,
          assetId: FRAME_ASSET_ID,
          sha256: sha256Hex(RING_SVG),
          sourceViewport: { x: 0, y: 0, width: 320, height: 260 },
          offset: { x: 0, y: 0 },
          startMs: 0,
          durationMs: 1_000 / 24,
          createdBySequenceImport: false,
        },
      ],
      structure,
    });

    const baseProject = migrateProject(exampleProject);
    baseProject.assets.push(
      {
        id: FRAME_ASSET_ID,
        kind: 'image',
        name: 'frame-0.svg',
        relativePath: 'assets/frame-0.svg',
        mimeType: 'image/svg+xml',
        width: 320,
        height: 260,
        sha256: sha256Hex(RING_SVG),
        usage: 'prop',
        keywords: [],
      },
      {
        id: RING_SHAPE_ASSET_ID,
        kind: 'image',
        name: 'ring-shape.svg',
        relativePath: 'assets/ring-shape.svg',
        mimeType: 'image/svg+xml',
        width: 220,
        height: 180,
        sha256: sha256Hex(RING_SVG),
        usage: 'prop',
        keywords: [],
      },
    );
    baseProject.animations.push(definition);
    const shot = baseProject.shots[0]!;
    const templateLayer = shot.layers[0]!;
    shot.layers.push(
      {
        ...templateLayer,
        id: LAYER_A_ID,
        name: '实例A',
        source: { kind: 'animation', animationId: definition.id },
        startTimeMs: 0,
        animationPlayback: { mode: 'loop', endBehavior: 'hold' },
        zIndex: shot.layers.length,
      },
      {
        ...templateLayer,
        id: LAYER_B_ID,
        name: '实例B',
        source: { kind: 'animation', animationId: definition.id },
        startTimeMs: 0,
        animationPlayback: { mode: 'loop', endBehavior: 'hold' },
        zIndex: shot.layers.length + 1,
      },
    );

    const seedProject: Project = ProjectSchema.parse({
      ...baseProject,
      id: created.project.id,
      name: created.project.name,
      createdAt: created.project.createdAt,
      updatedAt: created.project.updatedAt,
    });
    await projectService.save(projectRoot, seedProject, 1);

    const store = new EditorProjectStore();
    store.open(projectRoot, seedProject);
    const layerService = new LayerService();
    const shapePath = ['group-outfit', 'shape-ring'];
    const movedMatrix = composeAffineMatrix({ tx: 22, ty: -14, rotationDeg: 15, scaleX: 1.25, scaleY: 0.9 });

    store.updateProject(
      layerService.updateFlaGraphicInstanceTransform(
        store.getSnapshot()!.project,
        shot.id,
        LAYER_A_ID,
        0,
        shapePath,
        movedMatrix,
      ),
      'Transform FLA Shape',
    );
    expect(store.history.getSnapshot().undoCount).toBe(1);
    store.undo();
    expect(
      store.getSnapshot()!.project.shots[0]!.layers.find((l) => l.id === LAYER_A_ID)!
        .flaGraphicInstanceTransformOverrides,
    ).toBeUndefined();
    store.redo();

    await projectService.save(projectRoot, store.getSnapshot()!.project, 2);

    // Close & Reopen from disk in a clean store instance:
    const reopened = await projectService.open(projectRoot);
    const reopenedShot = reopened.project.shots[0]!;
    const reopenedLayerA = reopenedShot.layers.find((l) => l.id === LAYER_A_ID)!;
    const reopenedLayerB = reopenedShot.layers.find((l) => l.id === LAYER_B_ID)!;
    const reopenedDef = reopened.project.animations.find(
      (a): a is FlaGraphicDefinition => a.id === GRAPHIC_ID && isFlaGraphicDefinition(a),
    )!;

    // SVG file persists on disk and reconstructs exact hit geometry after reopen.
    const reopenedSvg = await readFile(path.join(projectRoot, 'assets', 'ring-shape.svg'), 'utf8');
    expect(parseFlaSvgShapeHitGeometry(reopenedSvg).primitives).toHaveLength(2);
    expect(reopenedDef.structure!.frames[0]!.layers[0]!.nodes[0]!.localTransform).toEqual(groupMatrix);
    expect(reopenedLayerA.flaGraphicInstanceTransformOverrides).toBeDefined();
    expect(reopenedLayerB.flaGraphicInstanceTransformOverrides).toBeUndefined();

    // Stage evaluation, Layer visual parts, StageRenderModel, and ExportPreparationMedia share the same evaluated output:
    const evalShot = evaluateShotAtTime(reopenedShot, 0, reopened.project);
    const evalLayerA = evalShot.layers.find((l) => l.id === LAYER_A_ID)!;
    const evalLayerB = evalShot.layers.find((l) => l.id === LAYER_B_ID)!;
    const partsA = resolveLayerVisualParts(reopened.project, reopenedShot, evalLayerA);
    const partsB = resolveLayerVisualParts(reopened.project, reopenedShot, evalLayerB);
    const stageModel = buildStageRenderModel(
      reopened.project,
      evalShot,
      Object.fromEntries(reopened.project.assets.filter((a) => a.kind === 'image').map((a) => [a.id, `asset:///${a.id}`])),
    );
    const stageLayerA = stageModel.layers.find((l) => l.id === LAYER_A_ID)!;
    const stageLayerB = stageModel.layers.find((l) => l.id === LAYER_B_ID)!;

    const evaluatedShapeA = partsA.flaGraphic!.layers![0]!.nodes[0]!.children[0]!;
    const evaluatedShapeB = partsB.flaGraphic!.layers![0]!.nodes[0]!.children[0]!;
    const expectedWorldA = multiplyAffineMatrices(
      multiplyAffineMatrices(groupMatrix, movedMatrix),
      { a: 1, b: 0, c: 0, d: 1, tx: 40, ty: 30 },
    );
    for (const k of ['a', 'b', 'c', 'd', 'tx', 'ty'] as const) {
      expect(evaluatedShapeA.worldTransform[k]).toBeCloseTo(expectedWorldA[k], 8);
      expect(evaluatedShapeB.worldTransform[k]).toBeCloseTo(
        multiplyAffineMatrices(groupMatrix, { a: 1, b: 0, c: 0, d: 1, tx: 40, ty: 30 })[k],
        8,
      );
    }
    expect(
      stageLayerA.visual?.flaGraphic?.layers?.[0]?.nodes?.[0]?.children?.[0]?.worldTransform,
    ).toEqual(evaluatedShapeA.worldTransform);
    expect(
      stageLayerB.visual?.flaGraphic?.layers?.[0]?.nodes?.[0]?.children?.[0]?.worldTransform,
    ).toEqual(evaluatedShapeB.worldTransform);

    // Export preparation collects the isolated Shape SVG asset for export.
    const exportMediaIds = new Set(
      collectExportPreparationMedia(reopened.project).map((m) => m.asset.id),
    );
    expect(exportMediaIds.has(RING_SHAPE_ASSET_ID)).toBe(true);
    expect(unapplyFlaGraphicSubtreeViewBox(evaluatedShapeA.source, evaluatedShapeA.localTransform).tx).toBeCloseTo(22, 6);
  });

  it.skipIf(!existsSync(REAL_XIAOSHIMEI_FLA_PATH))(
    'verifies S0/S1/S2 on real F:\\素材\\唉小师妹唉.fla (朱孝天女儿) while preserving #1192 Hair/Sleeve extraction',
    async () => {
      const sourceRead = await readFlaSourceBytes(REAL_XIAOSHIMEI_FLA_PATH);
      let sourceBytes = sourceRead.bytes;
      const originalSha256 = sourceRead.sha256;
      try {
        preflightFlaBytes(sourceBytes, sourceRead.basename, sourceRead.sourcePath);
      } catch {
        const classification = classifyForFlaRecovery(sourceBytes);
        const normalized = normalizeRecoveryCandidate(sourceBytes, classification);
        if (normalized.applied) sourceBytes = normalized.bytes;
      }
      const normalizedSha256 = createHash('sha256').update(sourceBytes).digest('hex');
      const prepared = await prepareFlaStaticSnapshotDisplaySource(sourceBytes, 'preview');
      if (!prepared.ok) throw new Error(prepared.message);

      const zip = await JSZip.loadAsync(sourceBytes);
      const domDocXml = await zip.file('DOMDocument.xml')?.async('string');
      const ir = {
        source: { basename: sourceRead.basename, sha256: normalizedSha256 },
        document: {
          width: Number(domDocXml?.match(/\bwidth="(\d+(?:\.\d+)?)"/u)?.[1] ?? prepared.source.stageWidth),
          height: Number(domDocXml?.match(/\bheight="(\d+(?:\.\d+)?)"/u)?.[1] ?? prepared.source.stageHeight),
          frameRate: Number(domDocXml?.match(/\bframeRate="(\d+(?:\.\d+)?)"/u)?.[1] ?? 24),
        },
        media: [],
      };
      const scene = prepared.source.sceneTimelines[0]!;
      const targetId = stableRenderTargetId(sourceBytes, `scene\u0000timeline\u0000${scene.index}`);
      const sessionId = randomUUID();
      const previewService = new FlaPartPreviewService({
        flaImportService: {
          getSession: (id: string) =>
            id === sessionId ? { sessionId, ir, originalSourceSha256: originalSha256, sourceBytes } : null,
        } as unknown as FlaImportService,
        renderSession: {
          prepareDisplaySourceForPartPreview: async () => ({
            ok: true as const,
            source: prepared.source,
            xmlByteLength: prepared.xmlByteLength,
            cacheHit: false,
          }),
        } as never,
        rasterizer: {
          async rasterize(input) {
            return {
              pngBytes: makeSolidPng(input.width, input.height),
              width: input.width,
              height: input.height,
              pixelCount: input.pixelCount,
            };
          },
          cancel: () => true,
          close: () => undefined,
        } as FlaStaticSnapshotRasterizer,
        wallTimeMs: 30_000,
      });

      const previewResponse = await previewService.preview(
        FlaPartPreviewRequestSchema.parse({
          format: 'fla-part-preview',
          version: 1,
          requestId: randomUUID(),
          sessionId,
          generation: 1,
          purpose: 'graphic-instance',
          target: { renderTargetId: targetId, selectedFrameIndex: 0 },
        }),
      );
      if (!previewResponse.ok || previewResponse.capability !== 'GRAPHIC_INSTANCES_READY') {
        throw new Error('Failed to preview xiaoshimei Graphic instances');
      }
      const plan = previewService.getPlan(previewResponse.planId, sessionId, 1)!;
      const zhuUnit = plan.units.find(
        (u) => u.sourceSymbolId === '朱孝天女儿' || u.sourceAddress?.includes('朱孝天女儿'),
      ) ?? plan.units[0]!;

      const tempDir = await mkdtemp(path.join(os.tmpdir(), 'panda-xiaoshimei-shape-'));
      tempRoots.push(tempDir);
      const projectRoot = path.join(tempDir, 'XiaoshimeiShape.pandastage');
      const projectService = new ProjectService();
      const created = await projectService.create(projectRoot, { name: '小师妹 Shape 验证' });
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
      const commitService = new FlaGraphicInstanceCommitService({
        projectService: new ProjectService({
          onProjectSaved: (root, savedProject, savedRevision) => {
            if (root === projectRoot && savedRevision !== undefined) {
              snapshotState.project = savedProject;
              snapshotState.revision = savedRevision;
            }
          },
        }),
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
        plan: { planId: plan.planId, sessionId, generation: 1, poseIdentity: plan.poseIdentity, unitId: zhuUnit.unitId },
      });
      if (!commitResponse.ok) throw new Error(commitResponse.error.message);

      const committedGraphic = snapshotState.project.animations.find(
        (a): a is FlaGraphicDefinition => a.id === commitResponse.animationId && isFlaGraphicDefinition(a),
      )!;
      const evaluated = evaluateFlaGraphicVisual({
        definition: committedGraphic,
        frameOrdinal: 0,
        mode: 'instance',
      })!;

      // S0 lock-shape node (`图层_2 -> 形状`): enormous viewBox (267.25 x 240.75) due to styleless construction cubics,
      // while persisted isolated SVG has only 2 tiny primitives (fill #FFFFFF + stroke #FF0000).
      const lockShapeNode = evaluated.layers![1]!.nodes[0]!;
      expect(lockShapeNode.path).toEqual(['graphic:朱孝天女儿/layer-1-frame-0/0']);
      const lockSource = lockShapeNode.source;
      expect(lockSource.type).toBe('opaque');
      if (lockSource.type !== 'opaque') throw new Error('Expected opaque');
      expect(lockSource.sourceRef).toBe('fla-shape-75cca676afc56527d550ed9f');
      expect(lockSource.fallbackScope).toBe('subtree');
      const lockAsset = snapshotState.project.assets.find((a) => a.id === lockSource.fallbackAssetId)!;
      const lockSvgText = await readFile(path.join(projectRoot, lockAsset.relativePath), 'utf8');
      const lockGeom = parseFlaSvgShapeHitGeometry(lockSvgText);
      expect(lockGeom.primitives).toHaveLength(2);

      // S2 transform target: `layer-1-frame-0/20/0` (126.97 x 97.71 collar Shape with non-zero viewBox x=7.63, y=29.58)
      const collarPath = ['graphic:朱孝天女儿/layer-1-frame-0/20', 'graphic:朱孝天女儿/layer-1-frame-0/20/0'];
      const collarNode = evaluated.layers![1]!.nodes[20]!.children[0]!;
      expect(collarNode.path).toEqual(collarPath);
      expect(isFlaGraphicEditableSubtreeShapeNode(collarNode.source)).toBe(true);

      const committedLayerId = commitResponse.layerId;
      if (!committedLayerId) throw new Error('Expected committed layerId');
      const layerService = new LayerService();
      const moveMatrix = composeAffineMatrix({ tx: 18, ty: -12, rotationDeg: 10, scaleX: 1.15, scaleY: 1.15 });
      const updated = layerService.updateFlaGraphicInstanceTransform(
        snapshotState.project,
        IDS.shot,
        committedLayerId,
        0,
        collarPath,
        moveMatrix,
      );
      await projectService.save(projectRoot, updated, snapshotState.revision);
      const reopened = await projectService.open(projectRoot);
      const reopenedLayer = reopened.project.shots[0]!.layers.find((l) => l.id === committedLayerId)!;
      const reopenedDef = reopened.project.animations.find(
        (a): a is FlaGraphicDefinition => a.id === commitResponse.animationId && isFlaGraphicDefinition(a),
      )!;
      const evalReopened = evaluateFlaGraphicVisual({
        definition: reopenedDef,
        frameOrdinal: 0,
        mode: 'instance',
        instanceTransformOverrides: reopenedLayer.flaGraphicInstanceTransformOverrides,
      })!;
      const movedCollar = evalReopened.layers![1]!.nodes[20]!.children[0]!;
      const vb = collarNode.source.type === 'opaque' ? collarNode.source.fallbackViewBox! : { x: 0, y: 0 };
      const expectedLocal = multiplyAffineMatrices(moveMatrix, { a: 1, b: 0, c: 0, d: 1, tx: vb.x, ty: vb.y });
      for (const k of ['a', 'b', 'c', 'd', 'tx', 'ty'] as const) {
        expect(movedCollar.localTransform[k]).toBeCloseTo(expectedLocal[k], 8);
      }

      // Existing #1192 Hair & Sleeve CharacterPart assessments stay extractable without regression.
      expect(
        assessFlaGraphicSubtreeCandidate({
          definition: reopenedDef,
          frameOrdinal: 0,
          nodePath: ['graphic:朱孝天女儿/layer-2-frame-0/0'],
          assets: reopened.project.assets,
        }).extractable,
      ).toBe(true);
      expect(
        assessFlaGraphicSubtreeCandidate({
          definition: reopenedDef,
          frameOrdinal: 0,
          nodePath: ['graphic:朱孝天女儿/layer-1-frame-0/3'],
          assets: reopened.project.assets,
        }).extractable,
      ).toBe(true);

      // S3-A / S3-B spot check on real `唉小师妹唉.fla` (`layer-1-frame-0/20/0` collar Shape):
      // Decompose isolated SVG, edit/extract clean region, save & reopen cleanly.
      const collarSource = collarNode.source;
      if (collarSource.type === 'opaque' && collarSource.fallbackAssetId) {
        const collarAsset = reopened.project.assets.find(
          (a) => a.id === collarSource.fallbackAssetId,
        )!;
        const collarSvgText = await readFile(
          path.join(projectRoot, collarAsset.relativePath),
          'utf8',
        );
        const decomposedCollar = decomposeSvgToEditableShapeRegions(collarSvgText, {
          sourceShapeRef: collarSource.sourceRef,
          baseViewBox: collarSource.fallbackViewBox,
        });
        expect(decomposedCollar.regions.length).toBeGreaterThan(0);
        const solidRegion = decomposedCollar.regions.find(
          (r) =>
            r.fill.kind === 'solid' &&
            !decomposedCollar.ambiguousRegionRefs.has(r.regionRef),
        );
        if (solidRegion) {
          const afterRealColor = layerService.updateFlaGraphicShapeRegionFillColor(
            reopened.project,
            {
              shotId: IDS.shot,
              layerId: committedLayerId,
              frameOrdinal: 0,
              nodePath: collarPath,
              regionRef: solidRegion.regionRef,
              mode: 'instance',
              color: '#3399aa',
              svgText: collarSvgText,
            },
          );
          await projectService.save(projectRoot, afterRealColor, 2);
          const reopenedAfterEdit = await projectService.open(projectRoot);
          const reopenedLayerAfter = reopenedAfterEdit.project.shots[0]!.layers.find(
            (l) => l.id === committedLayerId,
          )!;
          const evalRealAfter = evaluateFlaGraphicVisual({
            definition: reopenedDef,
            frameOrdinal: 0,
            mode: 'instance',
            instanceShapeOverrides: reopenedLayerAfter.flaGraphicInstanceShapeOverrides,
          })!;
          const editedCollar = evalRealAfter.layers![1]!.nodes[20]!.children[0]!;
          expect(
            editedCollar.vectorVisual?.regions.find(
              (r) => r.regionRef === solidRegion.regionRef,
            )?.fill.color?.toLowerCase(),
          ).toBe('#3399aa');
        }
      }
    },
  );

  it('persists S3-A extracted regions, S3-B fill/vertex edits, and 2-region Adaptive CharacterParts across save/reopen with Stage/Export parity', async () => {
    const parentTemp = await mkdtemp(path.join(os.tmpdir(), 'panda-shape-s3-'));
    tempRoots.push(parentTemp);
    const projectRoot = path.join(parentTemp, 'ShapeS3.pandastage');
    const projectService = new ProjectService();
    const layerService = new LayerService();
    const created = await projectService.create(projectRoot, { name: 'Shape S3 Lifecycle' });

    await mkdir(path.join(projectRoot, 'assets'), { recursive: true });
    await writeFile(path.join(projectRoot, 'assets', 'frame-0.svg'), RING_SVG, 'utf8');
    await writeFile(path.join(projectRoot, 'assets', 'ring-shape.svg'), RING_SVG, 'utf8');

    const groupMatrix = composeAffineMatrix({ tx: 30, ty: 20, rotationDeg: 25, scaleX: 0.5, scaleY: 0.5 });
    const structure: FlaGraphicStructure = {
      version: 1,
      frames: [
        {
          ordinal: 0,
          layers: [
            {
              name: '图层_2',
              nodes: [
                {
                  type: 'group',
                  id: 'group-outfit',
                  sourceAddress: 'graphic:Shape/layer-0-frame-0/0',
                  drawOrder: 0,
                  localTransform: groupMatrix,
                  groupId: 'outfit',
                  children: [
                    {
                      type: 'opaque',
                      id: 'shape-ring',
                      sourceAddress: 'graphic:Shape/layer-0-frame-0/0/0',
                      drawOrder: 0,
                      localTransform: IDENTITY,
                      opaqueKind: 'shape',
                      sourceRef: 'fla-shape-ring',
                      fallbackScope: 'subtree',
                      fallbackAssetId: RING_SHAPE_ASSET_ID,
                      fallbackViewBox: { x: 40, y: 30, width: 220, height: 180 },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const definition = FlaGraphicDefinitionSchema.parse({
      id: GRAPHIC_ID,
      kind: 'fla-graphic',
      name: 'Shape Graphic',
      source: {
        basename: 'shape.fla',
        sha256: 'a'.repeat(64),
        renderTargetId: 'shape-target',
        targetKind: 'graphic-symbol',
        targetName: 'ShapeTarget',
        startFrameIndex: 0,
        endFrameIndex: 0,
        sourceFps: 24,
        canvas: { width: 320, height: 260 },
        anchor: { x: 0, y: 0 },
        documentCanvas: { width: 1920, height: 1080 },
      },
      durationMs: 1_000 / 24,
      frames: [
        {
          ordinal: 0,
          sourceFrameIndex: 0,
          assetId: FRAME_ASSET_ID,
          sha256: sha256Hex(RING_SVG),
          sourceViewport: { x: 0, y: 0, width: 320, height: 260 },
          offset: { x: 0, y: 0 },
          startMs: 0,
          durationMs: 1_000 / 24,
          createdBySequenceImport: false,
        },
      ],
      structure,
    });
    const baseSeed = migrateProject(exampleProject);
    baseSeed.assets.push(
      {
        id: FRAME_ASSET_ID,
        kind: 'image',
        name: 'frame-0.svg',
        relativePath: 'assets/frame-0.svg',
        mimeType: 'image/svg+xml',
        width: 320,
        height: 260,
        sha256: sha256Hex(RING_SVG),
        usage: 'prop',
        keywords: [],
      },
      {
        id: RING_SHAPE_ASSET_ID,
        kind: 'image',
        name: 'ring-shape.svg',
        relativePath: 'assets/ring-shape.svg',
        mimeType: 'image/svg+xml',
        width: 220,
        height: 180,
        sha256: sha256Hex(RING_SVG),
        usage: 'prop',
        keywords: [],
      },
    );
    baseSeed.animations.push(definition);
    const seedShot = baseSeed.shots[0]!;
    const templateLayer = seedShot.layers[0]!;
    seedShot.layers.push(
      {
        ...templateLayer,
        id: LAYER_A_ID,
        name: '实例A',
        source: { kind: 'animation', animationId: definition.id },
        startTimeMs: 0,
        animationPlayback: { mode: 'loop', endBehavior: 'hold' },
        zIndex: seedShot.layers.length,
      },
      {
        ...templateLayer,
        id: LAYER_B_ID,
        name: '实例B',
        source: { kind: 'animation', animationId: definition.id },
        startTimeMs: 0,
        animationPlayback: { mode: 'loop', endBehavior: 'hold' },
        zIndex: seedShot.layers.length + 1,
      },
    );
    const baseProject = ProjectSchema.parse({
      ...baseSeed,
      id: created.project.id,
      name: created.project.name,
      createdAt: created.project.createdAt,
      updatedAt: created.project.updatedAt,
    });
    await projectService.save(projectRoot, baseProject, 1);

    const reopenedSeed = await projectService.open(projectRoot);
    const ringPath = ['group-outfit', 'shape-ring'];
    const decomposed = decomposeSvgToEditableShapeRegions(RING_SVG);
    expect(decomposed.regions).toHaveLength(2);
    const regA = decomposed.regions[0]!;
    const regB = decomposed.regions[1]!;

    const extractedRes = layerService.extractFlaGraphicShapeRegion(
      reopenedSeed.project,
      {
        shotId: seedShot.id,
        layerId: LAYER_A_ID,
        frameOrdinal: 0,
        nodePath: ringPath,
        regionRef: regA.regionRef,
        mode: 'instance',
        svgText: RING_SVG,
        displayName: '区域 A',
      },
    );
    const withColor = layerService.updateFlaGraphicShapeRegionFillColor(
      extractedRes.project,
      {
        shotId: seedShot.id,
        layerId: LAYER_A_ID,
        frameOrdinal: 0,
        nodePath: extractedRes.extractedNodePath,
        regionRef: regA.regionRef,
        mode: 'instance',
        color: '#00aa88',
      },
    );
    const withVertex = layerService.moveFlaGraphicShapeRegionVertex(withColor, {
      shotId: seedShot.id,
      layerId: LAYER_A_ID,
      frameOrdinal: 0,
      nodePath: extractedRes.extractedNodePath,
      regionRef: regA.regionRef,
      mode: 'instance',
      target: { contourIndex: 0, commandIndex: 0, pointKind: 'anchor' },
      x: 24,
      y: 20,
    });

    const defForParts = withVertex.animations.find(
      (a): a is FlaGraphicDefinition => a.id === GRAPHIC_ID && isFlaGraphicDefinition(a),
    )!;
    const adaptiveInput = buildAdaptivePartsFromFlaGraphicSubtrees({
      project: withVertex,
      definition: defForParts,
      frameOrdinal: 0,
      selections: [
        { nodePath: ringPath, label: '局部 1', regionRef: regA.regionRef, regionVector: regA },
        { nodePath: ringPath, label: '局部 2', regionRef: regB.regionRef, regionVector: regB },
      ],
    });
    const projectWithChar = new CharacterService().createAdaptiveParts(
      withVertex,
      adaptiveInput,
    );
    const charId = projectWithChar.characters.at(-1)!.id;
    const charLayerId = randomUUID();
    const charLayer: Layer = {
      ...projectWithChar.shots[0]!.layers[0]!,
      id: charLayerId,
      name: '双区域角色图层',
      zIndex: 5,
      source: { kind: 'character', characterId: charId },
      animationPlayback: undefined,
    };
    const projectWithAll: Project = ProjectSchema.parse({
      ...projectWithChar,
      shots: [
        {
          ...projectWithChar.shots[0]!,
          layers: [...projectWithChar.shots[0]!.layers, charLayer],
        },
      ],
    });

    await projectService.save(projectRoot, projectWithAll, 1);
    const reopened = await projectService.open(projectRoot);
    const reopenedShot = reopened.project.shots[0]!;
    const reopenedLayerA = reopenedShot.layers.find((l) => l.id === LAYER_A_ID)!;
    const reopenedLayerB = reopenedShot.layers.find((l) => l.id === LAYER_B_ID)!;
    const reopenedDef = reopened.project.animations.find(
      (a): a is FlaGraphicDefinition => a.id === GRAPHIC_ID && isFlaGraphicDefinition(a),
    )!;

    expect(reopenedLayerB.flaGraphicInstanceShapeOverrides).toBeUndefined();
    const evalA = evaluateFlaGraphicVisual({
      definition: reopenedDef,
      frameOrdinal: 0,
      mode: 'instance',
      instanceShapeOverrides: reopenedLayerA.flaGraphicInstanceShapeOverrides,
    })!;
    const evalB = evaluateFlaGraphicVisual({
      definition: reopenedDef,
      frameOrdinal: 0,
      mode: 'instance',
      instanceShapeOverrides: reopenedLayerB.flaGraphicInstanceShapeOverrides,
    })!;
    expect(evalA.layers![0]!.nodes[0]!.children).toHaveLength(2);
    expect(evalB.layers![0]!.nodes[0]!.children).toHaveLength(1);
    const sourceA = evalA.layers![0]!.nodes[0]!.children[0]!;
    expect(sourceA.vectorVisual?.residueStrokes).toHaveLength(1);
    const extractedA = evalA.layers![0]!.nodes[0]!.children[1]!;
    expect(extractedA.path).toEqual(extractedRes.extractedNodePath);
    expect(extractedA.vectorVisual?.residueStrokes).toBeUndefined();
    const emittedSourceSvg = buildSvgFromFlaEditableShapeRegions({
      regions: sourceA.vectorVisual!.regions,
      residueStrokes: sourceA.vectorVisual!.residueStrokes,
      viewBox: sourceA.vectorVisual!.baseViewBox,
    });
    expect(emittedSourceSvg).toContain('M 155 60 L 195 60');
    expect(extractedA.vectorVisual?.regions[0]?.fill.color?.toLowerCase()).toBe('#00aa88');
    expect(extractedA.vectorVisual?.regions[0]?.contours[0]?.commands[0]).toEqual({
      type: 'M',
      x: 24,
      y: 20,
    });
    expect(extractedA.vectorVisual?.regions[0]?.contours[0]?.commands.at(-1)).toEqual({
      type: 'Z',
    });
    const emittedSvg = buildSvgFromFlaEditableShapeRegions({
      regions: extractedA.vectorVisual!.regions,
      viewBox: extractedA.vectorVisual!.baseViewBox,
    });
    expect(emittedSvg.toLowerCase()).toContain('#00aa88');
    expect(emittedSvg).toContain('M 24 20');

    const stageEval = evaluateShotAtTime(reopenedShot, 0, reopened.project);
    const stageRender = buildStageRenderModel(
      reopened.project,
      stageEval,
      Object.fromEntries(
        reopened.project.assets
          .filter((a) => a.kind === 'image')
          .map((a) => [a.id, `asset:///${a.id}`]),
      ),
    );
    expect(stageRender.layers.length).toBeGreaterThanOrEqual(3);
    const evalCharLayer = stageEval.layers.find((l) => l.id === charLayerId)!;
    const resolvedChar = resolveLayerVisualParts(
      reopened.project,
      reopenedShot,
      evalCharLayer,
    );
    expect(resolvedChar.kind).toBe('adaptive-parts-character');
    expect(resolvedChar.parts).toHaveLength(2);
    const adaptiveChar = reopened.project.characters.find((c) => c.id === charId)!;
    if (adaptiveChar.mode !== 'adaptive-parts') throw new Error('Expected adaptive-parts');
    const rad = (25 * Math.PI) / 180;
    const scaleFactor = 0.5 * (Math.cos(rad) + Math.sin(rad));
    expect(
      characterPartSourceBounds(
        adaptiveChar.parts[0]!,
        reopened.project.animations,
        reopened.project.assets,
      )!.width,
    ).toBeCloseTo(80 * scaleFactor, 6);
    expect(
      characterPartSourceBounds(
        adaptiveChar.parts[1]!,
        reopened.project.animations,
        reopened.project.assets,
      )!.width,
    ).toBeCloseTo(40 * scaleFactor, 6);
    const exportMedia = collectExportPreparationMedia(reopened.project);
    expect(exportMedia.length).toBeGreaterThan(0);

    // Issue #1200 Part B persistence spot check: unmatched regionRef stays fail-closed across reopen!
    expect(
      characterPartSourceBounds(
        {
          ...adaptiveChar.parts[0]!,
          visualSource: {
            kind: 'fla-graphic',
            animationId: reopenedDef.id,
            nodePath: ringPath,
            poseFrameOrdinal: 0,
            regionRef: 'reg-missing-after-reopen',
          },
        },
        reopened.project.animations,
        reopened.project.assets,
      ),
    ).toBeNull();
  });
});
