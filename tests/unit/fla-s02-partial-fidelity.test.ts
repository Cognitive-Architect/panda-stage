import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import JSZip from 'jszip';
import { afterEach, describe, expect, it } from 'vitest';
import {
  evaluateFlaGraphicVisual,
  isFlaGraphicEditableSubtreeShapeNode,
  isFlaGraphicNodeTransformable,
  reconstructFlaGraphicStructure,
  ShotService,
  type FlaGraphicDefinition,
  type Project,
} from '../../src/domain';
import { isGeneratedFlaSvgAsset } from '../../src/domain/selectors/isGeneratedFlaSvgAsset';
import { FlaGraphicInstanceCommitService } from '../../src/main/services/FlaGraphicInstanceCommitService';
import type { FlaImportService } from '../../src/main/services/FlaImportService';
import { FlaPartPreviewService } from '../../src/main/services/FlaPartPreviewService';
import type { FlaStaticSnapshotRasterizer } from '../../src/main/services/fla-static-snapshot-render-session';
import {
  prepareFlaStaticSnapshotDisplaySource,
  stableRenderTargetId,
} from '../../src/main/services/fla-static-snapshot-svg-builder';
import { ProjectService } from '../../src/main/services/ProjectService';
import { FlaGraphicInstanceCommitRequestSchema } from '../../src/shared/fla-graphic-instance-api';
import { FlaPartPreviewRequestSchema } from '../../src/shared/fla-part-preview-api';
import {
  FLA_STATIC_TEXT_PLACEHOLDER_BASE64,
} from '../../src/shared/fla-static-text';

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) !== 0 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.byteLength, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

function makeSolidPng(width: number, height: number): Uint8Array {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const rowSize = 1 + width * 4;
  const raw = Buffer.alloc(rowSize * height, 0);
  const idat = zlib.deflateSync(raw);
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      pngChunk('IHDR', ihdr),
      pngChunk('IDAT', idat),
      pngChunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

const ONE_PIXEL_PNG = Buffer.from(makeSolidPng(1, 1));

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

async function buildFlaBytes(
  docXml: string,
  libraryEntries: readonly { name: string; xml: string }[],
): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('DOMDocument.xml', docXml);
  for (const entry of libraryEntries) {
    zip.file(entry.name, entry.xml);
  }
  return new Uint8Array(await zip.generateAsync({ type: 'uint8array' }));
}

function makeRectShapeXml(color: string, x: number, y: number, w: number, h: number): string {
  const x0 = Math.round(x * 20);
  const y0 = Math.round(y * 20);
  const x1 = Math.round((x + w) * 20);
  const y1 = Math.round((y + h) * 20);
  return (
    `<DOMShape><fills><FillStyle index="1"><SolidColor color="${color}"/></FillStyle></fills>` +
    `<edges><Edge fillStyle1="1" edges="!${x0} ${y0}|${x1} ${y0}|${x1} ${y1}|${x0} ${y1}|${x0} ${y0}"/></edges></DOMShape>`
  );
}

function makeRasterizer(options: { failTextOnMatch?: string } = {}): FlaStaticSnapshotRasterizer {
  const resolvedTextBase64 = ONE_PIXEL_PNG.toString('base64');
  return {
    async rasterize(input) {
      let resolvedSvg = input.svg;
      if (input.returnResolvedSvg && input.staticTexts?.length) {
        if (options.failTextOnMatch && input.svg.includes(options.failTextOnMatch)) {
          return {
            pngBytes: makeSolidPng(input.width, input.height),
            width: input.width,
            height: input.height,
            pixelCount: input.width * input.height,
            resolvedSvg: input.svg,
          };
        }
        resolvedSvg = resolvedSvg.replaceAll(
          FLA_STATIC_TEXT_PLACEHOLDER_BASE64,
          resolvedTextBase64,
        );
      }
      return {
        pngBytes: makeSolidPng(input.width, input.height),
        width: input.width,
        height: input.height,
        pixelCount: input.width * input.height,
        ...(input.returnResolvedSvg ? { resolvedSvg } : {}),
      };
    },
    cancel: () => true,
    close: () => {},
  };
}

async function setupCommitPipeline(
  flaBytes: Uint8Array,
  rasterizer: FlaStaticSnapshotRasterizer = makeRasterizer(),
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'panda-s02-a-'));
  tempRoots.push(root);
  const projectRoot = path.join(root, 'sample.pandastage');
  const flaPath = path.join(root, 'sample.fla');
  await fs.writeFile(flaPath, flaBytes);

  const projectService = new ProjectService();
  const created = await projectService.create(projectRoot, { name: 'S02-A Test' });
  const shotService = new ShotService();
  const withShot = shotService.create(created.project, { name: 'Shot 1', durationMs: 3_000 });
  const savedWithShot = await projectService.save(projectRoot, withShot);
  let currentProject: Project = savedWithShot.project;
  let currentRevision = 1;

  const sha256 = crypto.createHash('sha256').update(flaBytes).digest('hex');
  const prepared = await prepareFlaStaticSnapshotDisplaySource(flaBytes, 'preview');
  if (!prepared.ok) {
    throw new Error(`Display source prepare failed: ${prepared.message}`);
  }
  const sessionId = crypto.randomUUID();
  const ir = {
    source: { basename: 'sample.fla', sha256 },
    document: {
      width: prepared.source.stageWidth,
      height: prepared.source.stageHeight,
      frameRate: 24,
    },
    media: [],
  };

  const partPreviewService = new FlaPartPreviewService({
    flaImportService: {
      getSession: (id: string) =>
        id === sessionId ? { sessionId, ir, originalSourceSha256: sha256, sourceBytes: flaBytes } : null,
    } as unknown as FlaImportService,
    renderSession: {
      prepareDisplaySourceForPartPreview: async () => ({
        ok: true as const,
        source: prepared.source,
        xmlByteLength: prepared.xmlByteLength,
        cacheHit: false,
      }),
    } as never,
    rasterizer,
    wallTimeMs: 30_000,
  });

  const commitService = new FlaGraphicInstanceCommitService({
    projectService,
    partPreviewService,
    getCurrentProjectSnapshot: (targetRoot) =>
      targetRoot === projectRoot
        ? { project: currentProject, revision: currentRevision, openInstanceId: 1 }
        : null,
  });

  const sceneTargetId = stableRenderTargetId(flaBytes, 'scene\u0000timeline\u00000');
  const preview = await partPreviewService.preview(
    FlaPartPreviewRequestSchema.parse({
      format: 'fla-part-preview',
      version: 1,
      requestId: crypto.randomUUID(),
      sessionId,
      generation: 1,
      purpose: 'graphic-instance',
      target: {
        renderTargetId: sceneTargetId,
        selectedFrameIndex: 0,
      },
    }),
  );
  if (!preview.ok || preview.status !== 'PREVIEW_READY' || preview.capability !== 'GRAPHIC_INSTANCES_READY') {
    throw new Error(`Part preview failed: ${JSON.stringify(preview)}`);
  }
  const plan = partPreviewService.getPlan(preview.planId);
  if (!plan) throw new Error('Held PartPlan missing after preview');

  const commitUnit = async (unitIndex: number) => {
    const unit = plan.units[unitIndex];
    if (!unit) throw new Error(`Missing unit at index ${unitIndex}`);
    const response = await commitService.commit(FlaGraphicInstanceCommitRequestSchema.parse({
      format: 'fla-graphic-instance-commit',
      version: 1,
      requestId: crypto.randomUUID(),
      projectRoot,
      projectId: currentProject.id,
      baseRevision: currentRevision,
      openInstanceId: 1,
      shotId: currentProject.shots[0]!.id,
      startTimeMs: 0,
      plan: {
        sessionId,
        planId: plan.planId,
        generation: 1,
        poseIdentity: plan.poseIdentity,
        unitId: unit.unitId,
      },
    }));
    if (response.ok) {
      currentProject = response.project;
      currentRevision += 1;
    }
    return response;
  };

  return {
    projectRoot,
    projectService,
    partPreviewService,
    commitService,
    preview,
    plan,
    sessionId,
    commitUnit,
    getCurrentProject: () => currentProject,
    cleanup: () => {
      partPreviewService.close();
    },
  };
}

describe('S02-A (#1298): isolated static text & static filter subtree partial fidelity', () => {
  it('keeps healthy sibling shapes A/C editable while isolating static text B without baking neighbors', async () => {
    const badgeSymbolXml =
      '<DOMSymbolItem name="BadgeWithText" symbolType="graphic"><timeline><DOMTimeline name="BadgeWithText"><layers>' +
      '<DOMLayer name="Content"><frames><DOMFrame index="0"><elements>' +
      makeRectShapeXml('#ff0000', 0, 0, 40, 40) +
      '<DOMStaticText width="100" height="30">' +
      '<matrix><Matrix tx="60" ty="10"/></matrix>' +
      '<textRuns><DOMTextRun><characters>Hello Panda</characters>' +
      '<textAttrs><DOMTextAttrs size="18" fillColor="#111111"/></textAttrs></DOMTextRun></textRuns>' +
      '</DOMStaticText>' +
      makeRectShapeXml('#0000ff', 180, 0, 40, 40) +
      '</elements></DOMFrame></frames></DOMLayer>' +
      '</layers></DOMTimeline></timeline></DOMSymbolItem>';

    const docXml =
      '<DOMDocument width="400" height="200" frameRate="24">' +
      '<symbols><Include href="BadgeWithText.xml"/></symbols>' +
      '<timelines><DOMTimeline name="Scene 1"><layers>' +
      '<DOMLayer name="Main"><frames><DOMFrame index="0"><elements>' +
      '<DOMSymbolInstance libraryItemName="BadgeWithText" symbolType="graphic" loop="single frame" firstFrame="0">' +
      '<matrix><Matrix tx="20" ty="20"/></matrix>' +
      '</DOMSymbolInstance>' +
      '<DOMSymbolInstance libraryItemName="BadgeWithText" symbolType="graphic" loop="single frame" firstFrame="0">' +
      '<matrix><Matrix tx="200" ty="80"/></matrix>' +
      '</DOMSymbolInstance>' +
      '</elements></DOMFrame></frames></DOMLayer>' +
      '</layers></DOMTimeline></timelines></DOMDocument>';

    const flaBytes = await buildFlaBytes(docXml, [{ name: 'LIBRARY/BadgeWithText.xml', xml: badgeSymbolXml }]);
    const ctx = await setupCommitPipeline(flaBytes);
    try {
      const firstCommit = await ctx.commitUnit(0);
      if (!firstCommit.ok) throw new Error(`${firstCommit.error.code}: ${firstCommit.error.message}`);
      expect(firstCommit.ok).toBe(true);

      const def = firstCommit.project.animations.find(
        (candidate): candidate is FlaGraphicDefinition =>
          'kind' in candidate && candidate.kind === 'fla-graphic' && candidate.id === firstCommit.animationId,
      );
      expect(def).toBeDefined();
      expect(def!.structure).toBeDefined();

      const flat = reconstructFlaGraphicStructure(def!.structure!);
      expect(flat).toHaveLength(3);
      const [nodeA, nodeB, nodeC] = flat.map((entry) => entry.node);

      // Healthy siblings A and C remain editable subtree shapes with drawOrder 0 and 2.
      expect(nodeA).toMatchObject({ type: 'opaque', opaqueKind: 'shape', drawOrder: 0, fallbackScope: 'subtree' });
      expect(nodeC).toMatchObject({ type: 'opaque', opaqueKind: 'shape', drawOrder: 2, fallbackScope: 'subtree' });
      expect(isFlaGraphicEditableSubtreeShapeNode(nodeA!)).toBe(true);
      expect(isFlaGraphicEditableSubtreeShapeNode(nodeC!)).toBe(true);
      expect(isFlaGraphicNodeTransformable(nodeA!)).toBe(true);
      expect(isFlaGraphicNodeTransformable(nodeC!)).toBe(true);

      // Static text B is an isolated subtree opaque node preserving localTransform, sourceAddress, and drawOrder 1.
      expect(nodeB).toMatchObject({
        type: 'opaque',
        opaqueKind: 'text',
        drawOrder: 1,
        fallbackScope: 'subtree',
        localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 60, ty: 10 },
      });
      expect(nodeB!.sourceAddress).toBeTruthy();
      expect(isFlaGraphicNodeTransformable(nodeB!)).toBe(false);
      if (nodeB!.type !== 'opaque' || !nodeB!.fallbackAssetId) throw new Error('Expected bound text fallback asset');

      // B's asset is owned as a generated FLA SVG asset and does NOT contain neighbors A (#ff0000) or C (#0000ff).
      const textAsset = firstCommit.project.assets.find((asset) => asset.id === nodeB!.fallbackAssetId);
      expect(textAsset).toBeDefined();
      expect(isGeneratedFlaSvgAsset(firstCommit.project, textAsset!)).toBe(true);
      const textSvgContent = await fs.readFile(path.join(ctx.projectRoot, textAsset!.relativePath), 'utf8');
      expect(textSvgContent).not.toContain('#ff0000');
      expect(textSvgContent).not.toContain('#0000ff');
      expect(textSvgContent).not.toContain(FLA_STATIC_TEXT_PLACEHOLDER_BASE64);

      // Second instance shares the exact same Definition and assets without duplicating files.
      const assetCountAfterFirst = firstCommit.project.assets.length;
      const secondCommit = await ctx.commitUnit(1);
      expect(secondCommit.ok).toBe(true);
      if (!secondCommit.ok) throw new Error(secondCommit.error.message);
      expect(secondCommit.animationId).toBe(firstCommit.animationId);
      expect(secondCommit.project.animations).toHaveLength(1);
      expect(secondCommit.project.assets).toHaveLength(assetCountAfterFirst);

      // Moving healthy sibling A in instance 1 leaves B intact and does not affect instance 2.
      const movedVisual = evaluateFlaGraphicVisual({
        definition: def!,
        frameOrdinal: 0,
        mode: 'instance',
        instanceTransformOverrides: {
          '0': {
            [JSON.stringify([nodeA!.id])]: { a: 1, b: 0, c: 0, d: 1, tx: 25, ty: 15 },
          },
        },
      });
      const untouchedVisual = evaluateFlaGraphicVisual({
        definition: def!,
        frameOrdinal: 0,
        mode: 'instance',
      });
      expect(movedVisual).not.toBeNull();
      expect(untouchedVisual).not.toBeNull();
      expect(movedVisual!.resourceAssetIds).toContain(nodeB!.fallbackAssetId);
      const movedNodes = movedVisual!.layers![0]!.nodes;
      const untouchedNodes = untouchedVisual!.layers![0]!.nodes;
      expect(movedNodes[0]!.worldTransform.tx - untouchedNodes[0]!.worldTransform.tx).toBeCloseTo(25, 6);
      expect(movedNodes[0]!.worldTransform.ty - untouchedNodes[0]!.worldTransform.ty).toBeCloseTo(15, 6);
      expect(movedNodes[1]!.renderable).toBe(true);
      expect(movedNodes[1]!.worldTransform).toEqual(untouchedNodes[1]!.worldTransform);
      expect(movedNodes[1]!.authoredLocalTransform).toMatchObject({ tx: 60, ty: 10 });

      // Save & reopen preserves structure and bound fallback assets.
      const reopened = await ctx.projectService.open(ctx.projectRoot);
      const reopenedDef = reopened.project.animations.find(
        (candidate): candidate is FlaGraphicDefinition =>
          'kind' in candidate && candidate.kind === 'fla-graphic' && candidate.id === firstCommit.animationId,
      );
      expect(reopenedDef?.structure).toEqual(def!.structure);
    } finally {
      ctx.cleanup();
    }
  });

  it('isolates a static Glow/DropShadow filtered symbol subtree B while keeping siblings A/C editable and external mask runtime-evaluated', async () => {
    const glowTargetXml =
      '<DOMSymbolItem name="GlowCore" symbolType="graphic"><timeline><DOMTimeline name="GlowCore"><layers>' +
      '<DOMLayer name="Core"><frames><DOMFrame index="0"><elements>' +
      makeRectShapeXml('#00ff00', 0, 0, 50, 50) +
      '</elements></DOMFrame></frames></DOMLayer>' +
      '</layers></DOMTimeline></timeline></DOMSymbolItem>';

    const compositeGraphicXml =
      '<DOMSymbolItem name="CardWithGlow" symbolType="graphic"><timeline><DOMTimeline name="CardWithGlow"><layers>' +
      '<DOMLayer name="MaskLayer" layerType="mask"><frames><DOMFrame index="0"><elements>' +
      makeRectShapeXml('#ffffff', 50, 0, 100, 100) +
      '</elements></DOMFrame></frames></DOMLayer>' +
      '<DOMLayer name="MaskedGlow" parentLayerIndex="0"><frames><DOMFrame index="0"><elements>' +
      '<DOMSymbolInstance libraryItemName="GlowCore" symbolType="graphic" loop="single frame" firstFrame="0">' +
      '<matrix><Matrix tx="70" ty="20"/></matrix>' +
      '<filters><GlowFilter blurX="6" blurY="6" color="#ff9900" strength="1"/></filters>' +
      '</DOMSymbolInstance>' +
      '</elements></DOMFrame></frames></DOMLayer>' +
      '<DOMLayer name="HealthySiblings"><frames><DOMFrame index="0"><elements>' +
      makeRectShapeXml('#ff0000', 0, 0, 30, 30) +
      makeRectShapeXml('#0000ff', 180, 0, 30, 30) +
      '</elements></DOMFrame></frames></DOMLayer>' +
      '</layers></DOMTimeline></timeline></DOMSymbolItem>';

    const docXml =
      '<DOMDocument width="400" height="200" frameRate="24">' +
      '<symbols><Include href="GlowCore.xml"/><Include href="CardWithGlow.xml"/></symbols>' +
      '<timelines><DOMTimeline name="Scene 1"><layers>' +
      '<DOMLayer name="Main"><frames><DOMFrame index="0"><elements>' +
      '<DOMSymbolInstance libraryItemName="CardWithGlow" symbolType="graphic" loop="single frame" firstFrame="0">' +
      '<matrix><Matrix tx="10" ty="10"/></matrix>' +
      '</DOMSymbolInstance>' +
      '</elements></DOMFrame></frames></DOMLayer>' +
      '</layers></DOMTimeline></timelines></DOMDocument>';

    const flaBytes = await buildFlaBytes(docXml, [
      { name: 'LIBRARY/GlowCore.xml', xml: glowTargetXml },
      { name: 'LIBRARY/CardWithGlow.xml', xml: compositeGraphicXml },
    ]);
    const ctx = await setupCommitPipeline(flaBytes);
    try {
      const committed = await ctx.commitUnit(0);
      if (!committed.ok) throw new Error(`${committed.error.code}: ${committed.error.message}`);
      expect(committed.ok).toBe(true);

      const def = committed.project.animations.find(
        (candidate): candidate is FlaGraphicDefinition =>
          'kind' in candidate && candidate.kind === 'fla-graphic' && candidate.id === committed.animationId,
      );
      expect(def?.structure).toBeDefined();

      const flat = reconstructFlaGraphicStructure(def!.structure!);
      const filterNode = flat.find((entry) => entry.node.type === 'opaque' && entry.node.opaqueKind === 'filter')?.node;
      const editableShapes = flat
        .map((entry) => entry.node)
        .filter((node) => isFlaGraphicEditableSubtreeShapeNode(node));

      expect(editableShapes).toHaveLength(2);
      expect(filterNode).toBeDefined();
      expect(filterNode).toMatchObject({
        type: 'opaque',
        opaqueKind: 'filter',
        fallbackScope: 'subtree',
        localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 70, ty: 20 },
      });
      // External mask is preserved on the structure node for runtime evaluation, not baked into the isolated SVG.
      expect(filterNode!.clipPaths?.length).toBe(1);
      if (filterNode!.type !== 'opaque' || !filterNode!.fallbackAssetId) {
        throw new Error('Expected bound filter fallback asset');
      }
      const filterAsset = committed.project.assets.find((asset) => asset.id === filterNode!.fallbackAssetId);
      expect(filterAsset).toBeDefined();
      expect(isGeneratedFlaSvgAsset(committed.project, filterAsset!)).toBe(true);

      const filterSvg = await fs.readFile(path.join(ctx.projectRoot, filterAsset!.relativePath), 'utf8');
      expect(filterSvg).toContain('<filter ');
      expect(filterSvg).toContain('#00ff00');
      expect(filterSvg).not.toContain('#ff0000');
      expect(filterSvg).not.toContain('#0000ff');
      expect(filterSvg).not.toContain('clip-path=');

      // Evaluated visual keeps filterNode renderable with evaluated clipPaths.
      const visual = evaluateFlaGraphicVisual({
        definition: def!,
        frameOrdinal: 0,
        mode: 'instance',
      });
      expect(visual).not.toBeNull();
      const evaluatedFilter = visual!.layers!
        .flatMap((layer) => layer.nodes)
        .find((node) => node.source.id === filterNode!.id);
      expect(evaluatedFilter?.renderable).toBe(true);
      expect(evaluatedFilter?.clipPaths.length).toBe(1);
    } finally {
      ctx.cleanup();
    }
  });

  it('falls back safely to requiresFullFrame when an isolated text subtree cannot be finalized', async () => {
    const symbolXml =
      '<DOMSymbolItem name="BrokenTextIsolation" symbolType="graphic"><timeline><DOMTimeline name="BrokenTextIsolation"><layers>' +
      '<DOMLayer name="L1"><frames><DOMFrame index="0"><elements>' +
      makeRectShapeXml('#ff0000', 0, 0, 30, 30) +
      '<DOMStaticText width="80" height="24">' +
      '<textRuns><DOMTextRun><characters>FallbackCheck</characters>' +
      '<textAttrs><DOMTextAttrs size="16" fillColor="#111111"/></textAttrs></DOMTextRun></textRuns>' +
      '</DOMStaticText>' +
      '</elements></DOMFrame></frames></DOMLayer>' +
      '</layers></DOMTimeline></timeline></DOMSymbolItem>';

    const docXml =
      '<DOMDocument width="300" height="200" frameRate="24">' +
      '<symbols><Include href="BrokenTextIsolation.xml"/></symbols>' +
      '<timelines><DOMTimeline name="Scene 1"><layers>' +
      '<DOMLayer name="Main"><frames><DOMFrame index="0"><elements>' +
      '<DOMSymbolInstance libraryItemName="BrokenTextIsolation" symbolType="graphic" loop="single frame" firstFrame="0"/>' +
      '</elements></DOMFrame></frames></DOMLayer>' +
      '</layers></DOMTimeline></timelines></DOMDocument>';

    const flaBytes = await buildFlaBytes(docXml, [{ name: 'LIBRARY/BrokenTextIsolation.xml', xml: symbolXml }]);
    // Succeed on full-frame render (which contains #ff0000), fail on isolated text render (which does not).
    const resolvedTextBase64 = ONE_PIXEL_PNG.toString('base64');
    const selectiveRasterizer: FlaStaticSnapshotRasterizer = {
      async rasterize(input) {
        if (input.returnResolvedSvg && input.staticTexts?.length) {
          const isFullFrame = input.svg.includes('#ff0000');
          return {
            pngBytes: makeSolidPng(input.width, input.height),
            width: input.width,
            height: input.height,
            pixelCount: input.width * input.height,
            resolvedSvg: isFullFrame
              ? input.svg.replaceAll(FLA_STATIC_TEXT_PLACEHOLDER_BASE64, resolvedTextBase64)
              : input.svg, // leave placeholder unresolved for isolated text
          };
        }
        return {
          pngBytes: makeSolidPng(input.width, input.height),
          width: input.width,
          height: input.height,
          pixelCount: input.width * input.height,
        };
      },
      cancel: () => true,
      close: () => {},
    };

    const ctx = await setupCommitPipeline(flaBytes, selectiveRasterizer);
    try {
      const batchResult = await ctx.partPreviewService.buildGraphicDefinitionFrameBatch({
        sessionId: ctx.sessionId,
        planId: ctx.plan.planId,
        generation: 1,
        poseIdentity: ctx.plan.poseIdentity,
        unitId: ctx.plan.units[0]!.unitId,
      });
      expect(batchResult.ok).toBe(true);
      if (!batchResult.ok) throw new Error(batchResult.message);
      expect(batchResult.batch.requiresFullFrame).toBe(true);
      expect(batchResult.batch.structure).toBeUndefined();
    } finally {
      ctx.cleanup();
    }
  });
});
