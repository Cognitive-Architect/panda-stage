import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import JSZip from 'jszip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  evaluateFlaGraphicNodeCompositePlan,
  evaluateFlaGraphicVisual,
  isFlaGraphicNodeTransformable,
  ShotService,
  type FlaGraphicDefinition,
  type Project,
} from '../../src/domain';
import { FlaGraphicInstanceCommitService } from '../../src/main/services/FlaGraphicInstanceCommitService';
import type { FlaImportService } from '../../src/main/services/FlaImportService';
import { FlaPartPreviewService } from '../../src/main/services/FlaPartPreviewService';
import type { FlaStaticSnapshotRasterizer } from '../../src/main/services/fla-static-snapshot-render-session';
import {
  prepareFlaStaticSnapshotDisplaySource,
  stableRenderTargetId,
} from '../../src/main/services/fla-static-snapshot-svg-builder';
import { ProjectService } from '../../src/main/services/ProjectService';
import { renderFlaGraphicCanvas } from '../../src/renderer/features/canvas/flaGraphicCanvasRenderer';
import { FlaGraphicInstanceCommitRequestSchema } from '../../src/shared/fla-graphic-instance-api';
import { FlaPartPreviewRequestSchema } from '../../src/shared/fla-part-preview-api';
import { FLA_STATIC_TEXT_PLACEHOLDER_BASE64 } from '../../src/shared/fla-static-text';

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
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((1 + width * 4) * height, 0);
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
  vi.unstubAllGlobals();
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

function makeRasterizer(): FlaStaticSnapshotRasterizer {
  const resolvedTextBase64 = ONE_PIXEL_PNG.toString('base64');
  return {
    async rasterize(input) {
      let resolvedSvg = input.svg;
      if (input.returnResolvedSvg && input.staticTexts?.length) {
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

class FakeCanvasContext {
  globalAlpha = 1;
  globalCompositeOperation = 'source-over';
  draws: Array<{ image: unknown; alpha: number; compositeOperation: string }> = [];
  readCount = 0;
  private readonly stack: Array<{ alpha: number; operation: string }> = [];

  save(): void {
    this.stack.push({ alpha: this.globalAlpha, operation: this.globalCompositeOperation });
  }
  restore(): void {
    const saved = this.stack.pop();
    this.globalAlpha = saved?.alpha ?? 1;
    this.globalCompositeOperation = saved?.operation ?? 'source-over';
  }
  setTransform(): void {}
  clearRect(): void {}
  drawImage(image: unknown): void {
    this.draws.push({
      image,
      alpha: this.globalAlpha,
      compositeOperation: this.globalCompositeOperation,
    });
  }
  getImageData(): ImageData {
    this.readCount += 1;
    return { data: new Uint8ClampedArray([200, 160, 120, 255]) } as ImageData;
  }
  putImageData(): void {}
}

class FakeCanvas {
  width = 0;
  height = 0;
  context = new FakeCanvasContext();
  getContext(): CanvasRenderingContext2D {
    return this.context as unknown as CanvasRenderingContext2D;
  }
}

class FakeImage {
  width = 128;
  height = 128;
  constructor(readonly assetId: string) {}
}

async function setupCommitPipeline(flaBytes: Uint8Array) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'panda-i01-'));
  tempRoots.push(root);
  const projectRoot = path.join(root, 'sample.pandastage');
  const projectService = new ProjectService();
  const created = await projectService.create(projectRoot, { name: 'I01 Cross Integration' });
  const shotService = new ShotService();
  const withShot = shotService.create(created.project, { name: 'Shot 1', durationMs: 2_000 });
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
    source: { basename: 'i01.fla', sha256 },
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
    rasterizer: makeRasterizer(),
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
      target: { renderTargetId: sceneTargetId, selectedFrameIndex: 0 },
    }),
  );
  if (!preview.ok || preview.status !== 'PREVIEW_READY' || preview.capability !== 'GRAPHIC_INSTANCES_READY') {
    throw new Error(`Part preview failed: ${JSON.stringify(preview)}`);
  }
  const plan = partPreviewService.getPlan(preview.planId);
  if (!plan) throw new Error('Held PartPlan missing after preview');

  const commitUnit = async (unitIndex: number) => {
    const unit = plan.units[unitIndex]!;
    const response = await commitService.commit(
      FlaGraphicInstanceCommitRequestSchema.parse({
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
      }),
    );
    if (response.ok) {
      currentProject = response.project;
      currentRevision += 1;
    }
    return response;
  };

  return { projectRoot, projectService, commitUnit };
}

describe('I01 cross-integration: S01 effects/blend + S02 partial fidelity', () => {
  it('preserves runtime Multiply blend on isolated Glow subtree alongside editable A/C, R01 outer instance color, dynamic frames, and save/reopen', async () => {
    const flaBytes = await buildFlaBytes(
      `<?xml version="1.0" encoding="utf-8"?>
<DOMDocument width="320" height="240" frameRate="24" backgroundColor="#ffffff">
  <symbols>
    <Include href="MixedGraphic.xml"/>
    <Include href="GlowBadge.xml"/>
  </symbols>
  <timelines>
    <DOMTimeline name="Scene 1">
      <layers>
        <DOMLayer name="Main">
          <frames>
            <DOMFrame index="0" duration="2" keyMode="9728">
              <elements>
                <DOMSymbolInstance libraryItemName="MixedGraphic" symbolType="graphic" loop="loop">
                  <matrix><Matrix tx="40" ty="30"/></matrix>
                  <color><Color alphaMultiplier="0.8" tintColor="#3366ff" tintMultiplier="0.25"/></color>
                </DOMSymbolInstance>
              </elements>
            </DOMFrame>
          </frames>
        </DOMLayer>
      </layers>
    </DOMTimeline>
  </timelines>
</DOMDocument>`,
      [
        {
          name: 'LIBRARY/GlowBadge.xml',
          xml: `<?xml version="1.0" encoding="utf-8"?>
<DOMSymbolItem name="GlowBadge" symbolType="graphic">
  <timeline>
    <DOMTimeline name="GlowBadge">
      <layers>
        <DOMLayer name="Badge">
          <frames>
            <DOMFrame index="0" duration="1" keyMode="9728">
              <elements>${makeRectShapeXml('#ff6600', 0, 0, 50, 50)}</elements>
            </DOMFrame>
            <DOMFrame index="1" duration="1" keyMode="9728">
              <elements>${makeRectShapeXml('#00aa88', 0, 0, 70, 50)}</elements>
            </DOMFrame>
          </frames>
        </DOMLayer>
      </layers>
    </DOMTimeline>
  </timeline>
</DOMSymbolItem>`,
        },
        {
          name: 'LIBRARY/MixedGraphic.xml',
          xml: `<?xml version="1.0" encoding="utf-8"?>
<DOMSymbolItem name="MixedGraphic" symbolType="graphic">
  <timeline>
    <DOMTimeline name="MixedGraphic">
      <layers>
        <DOMLayer name="NormalC">
          <frames>
            <DOMFrame index="0" duration="2" keyMode="9728">
              <elements>${makeRectShapeXml('#228833', 130, 20, 40, 40)}</elements>
            </DOMFrame>
          </frames>
        </DOMLayer>
        <DOMLayer name="ComplexB">
          <frames>
            <DOMFrame index="0" duration="2" keyMode="9728">
              <elements>
                <DOMSymbolInstance libraryItemName="GlowBadge" symbolType="graphic" loop="loop" blendMode="multiply">
                  <matrix><Matrix tx="60" ty="20"/></matrix>
                  <filters><GlowFilter blurX="8" blurY="8" color="#ffee00" strength="1.5" quality="1"/></filters>
                </DOMSymbolInstance>
              </elements>
            </DOMFrame>
          </frames>
        </DOMLayer>
        <DOMLayer name="NormalA">
          <frames>
            <DOMFrame index="0" duration="2" keyMode="9728">
              <elements>${makeRectShapeXml('#3355cc', 10, 20, 90, 60)}</elements>
            </DOMFrame>
          </frames>
        </DOMLayer>
      </layers>
    </DOMTimeline>
  </timeline>
</DOMSymbolItem>`,
        },
      ],
    );

    const { projectRoot, projectService, commitUnit } = await setupCommitPipeline(flaBytes);
    const committed = await commitUnit(0);
    expect(committed.ok).toBe(true);
    if (!committed.ok) return;

    // Persist + reopen round-trip to verify schema persistence of opaque blendMode & dynamic frames.
    const reopened = await projectService.open(projectRoot);
    const definition = reopened.project.animations.find(
      (anim): anim is FlaGraphicDefinition => 'kind' in anim && anim.kind === 'fla-graphic',
    );
    expect(definition).toBeDefined();
    expect(definition!.structure).toBeDefined();
    expect(definition!.structure!.frames).toHaveLength(2);

    const layer = reopened.project.shots[0]!.layers.find(
      (entry) => entry.source.kind === 'animation' && entry.source.animationId === definition!.id,
    );
    expect(layer).toBeDefined();
    if (!layer || layer.source.kind !== 'animation') return;
    const outerInstanceColor = layer.source.flaOccurrence?.instanceColor;
    expect(outerInstanceColor).toBeDefined();

    // Verify frame 0 and frame 1 structure: Normal A & Normal C remain editable, Complex B is isolated opaque with blendMode='multiply'.
    const frame0Visual = evaluateFlaGraphicVisual({
      definition: definition!,
      frameOrdinal: 0,
      mode: 'instance',
      instanceColor: outerInstanceColor,
    });
    const frame1Visual = evaluateFlaGraphicVisual({
      definition: definition!,
      frameOrdinal: 1,
      mode: 'instance',
      instanceColor: outerInstanceColor,
    });
    expect(frame0Visual).not.toBeNull();
    expect(frame1Visual).not.toBeNull();
    expect(frame0Visual!.layers).not.toBeNull();
    expect(frame1Visual!.layers).not.toBeNull();

    const frame0Nodes = frame0Visual!.layers!.flatMap((l) => l.nodes);
    const frame1Nodes = frame1Visual!.layers!.flatMap((l) => l.nodes);
    expect(frame0Nodes).toHaveLength(3);

    const [nodeA, nodeB0, nodeC] = frame0Nodes;
    const nodeB1 = frame1Nodes[1]!;
    expect(isFlaGraphicNodeTransformable(nodeA!.source)).toBe(true);
    expect(isFlaGraphicNodeTransformable(nodeC!.source)).toBe(true);
    expect(isFlaGraphicNodeTransformable(nodeB0!.source)).toBe(false);

    // Moving healthy sibling A via instanceTransformOverrides leaves B intact; removing override (Undo) restores exact original position.
    const movedVisual = evaluateFlaGraphicVisual({
      definition: definition!,
      frameOrdinal: 0,
      mode: 'instance',
      instanceColor: outerInstanceColor,
      instanceTransformOverrides: {
        '0': {
          [JSON.stringify([nodeA!.source.id])]: { a: 1, b: 0, c: 0, d: 1, tx: 30, ty: 15 },
        },
      },
    });
    expect(movedVisual).not.toBeNull();
    const movedNodes = movedVisual!.layers!.flatMap((l) => l.nodes);
    expect(movedNodes[0]!.worldTransform.tx - nodeA!.worldTransform.tx).toBeCloseTo(30, 6);
    expect(movedNodes[1]!.worldTransform).toEqual(nodeB0!.worldTransform);
    expect(movedNodes[2]!.worldTransform).toEqual(nodeC!.worldTransform);

    expect(nodeB0!.source.type).toBe('opaque');
    expect(nodeB1.source.type).toBe('opaque');
    if (nodeB0!.source.type !== 'opaque' || nodeB1.source.type !== 'opaque') return;

    expect(nodeB0!.source.opaqueKind).toBe('filter');
    expect(nodeB0!.source.fallbackScope).toBe('subtree');
    expect(nodeB0!.source.blendMode).toBe('multiply');
    expect(nodeB1.source.blendMode).toBe('multiply');
    expect(nodeB0!.source.fallbackAssetId).toBeDefined();
    expect(nodeB1.source.fallbackAssetId).toBeDefined();
    // Dynamic 2-frame GlowBadge produces distinct isolated assets per state.
    expect(nodeB0!.source.fallbackAssetId).not.toBe(nodeB1.source.fallbackAssetId);

    // Inspect isolated SVG on disk: Glow filter is present, futile mix-blend-mode is NOT baked on isolated root.
    const b0FallbackAssetId = nodeB0!.source.fallbackAssetId;
    const assetB0 = reopened.project.assets.find((a) => a.id === b0FallbackAssetId);
    expect(assetB0).toBeDefined();
    const svgB0 = await fs.readFile(path.join(projectRoot, assetB0!.relativePath), 'utf8');
    expect(svgB0).toContain('feGaussianBlur');
    expect(svgB0).not.toContain('mix-blend-mode:multiply');

    // Composite plan preserves runtime multiply blend without double-applying opacity/rgb.
    const planB0 = evaluateFlaGraphicNodeCompositePlan(nodeB0!);
    expect(planB0).toEqual({
      needsComposite: true,
      hasClips: false,
      opacity: 1,
      rgbTransform: null,
      blendMode: 'multiply',
      canvasCompositeOperation: 'multiply',
    });

    // Formal Canvas renderer draws A (source-over) -> B scratch (multiply against live backdrop) -> C (source-over),
    // then applies R01 outer instanceColor ONCE.
    const createdCanvases: FakeCanvas[] = [];
    vi.stubGlobal('document', {
      createElement: () => {
        const c = new FakeCanvas();
        createdCanvases.push(c);
        return c;
      },
    });
    const imageMap = new Map<string, HTMLImageElement>();
    for (const assetId of frame0Visual!.resourceAssetIds) {
      imageMap.set(assetId, new FakeImage(assetId) as unknown as HTMLImageElement);
    }
    const rendered = renderFlaGraphicCanvas(frame0Visual!, imageMap);
    expect(rendered).not.toBeNull();
    const mainCanvas = createdCanvases[0]!;
    expect(mainCanvas.context.draws.map((d) => d.compositeOperation)).toEqual([
      'source-over',
      'multiply',
      'source-over',
    ]);
    // Outer R01 instanceColor applied exactly once on the main canvas (no double-tinting).
    expect(mainCanvas.context.readCount).toBe(1);
  });

  it('preserves static text own S01-B DropShadow/Glow filter inside S02 isolated subtree while keeping A/C editable', async () => {
    const flaBytes = await buildFlaBytes(
      `<?xml version="1.0" encoding="utf-8"?>
<DOMDocument width="320" height="240" frameRate="24" backgroundColor="#ffffff">
  <symbols>
    <Include href="TextCard.xml"/>
  </symbols>
  <timelines>
    <DOMTimeline name="Scene 1">
      <layers>
        <DOMLayer name="Main">
          <frames>
            <DOMFrame index="0" duration="1" keyMode="9728">
              <elements>
                <DOMSymbolInstance libraryItemName="TextCard" symbolType="graphic" loop="single frame" firstFrame="0"/>
              </elements>
            </DOMFrame>
          </frames>
        </DOMLayer>
      </layers>
    </DOMTimeline>
  </timelines>
</DOMDocument>`,
      [
        {
          name: 'LIBRARY/TextCard.xml',
          xml: `<?xml version="1.0" encoding="utf-8"?>
<DOMSymbolItem name="TextCard" symbolType="graphic">
  <timeline>
    <DOMTimeline name="TextCard">
      <layers>
        <DOMLayer name="TopAccent">
          <frames>
            <DOMFrame index="0" duration="1" keyMode="9728">
              <elements>${makeRectShapeXml('#22aa55', 140, 10, 30, 30)}</elements>
            </DOMFrame>
          </frames>
        </DOMLayer>
        <DOMLayer name="FilteredLabel">
          <frames>
            <DOMFrame index="0" duration="1" keyMode="9728">
              <elements>
                <DOMStaticText width="100" height="28" isSelectable="false">
                  <matrix><Matrix tx="20" ty="30"/></matrix>
                  <filters>
                    <DropShadowFilter blurX="6" blurY="6" color="#000000" distance="4" angle="45" strength="1" quality="1"/>
                  </filters>
                  <textRuns>
                    <DOMTextRun>
                      <characters>Hello</characters>
                      <textAttrs><DOMTextAttrs size="20" fillColor="#ffffff" face="Arial"/></textAttrs>
                    </DOMTextRun>
                  </textRuns>
                </DOMStaticText>
              </elements>
            </DOMFrame>
          </frames>
        </DOMLayer>
        <DOMLayer name="BaseCard">
          <frames>
            <DOMFrame index="0" duration="1" keyMode="9728">
              <elements>${makeRectShapeXml('#224488', 0, 0, 180, 90)}</elements>
            </DOMFrame>
          </frames>
        </DOMLayer>
      </layers>
    </DOMTimeline>
  </timeline>
</DOMSymbolItem>`,
        },
      ],
    );

    const { projectRoot, projectService, commitUnit } = await setupCommitPipeline(flaBytes);
    const committed = await commitUnit(0);
    expect(committed.ok).toBe(true);
    if (!committed.ok) return;

    const reopened = await projectService.open(projectRoot);
    const definition = reopened.project.animations.find(
      (anim): anim is FlaGraphicDefinition => 'kind' in anim && anim.kind === 'fla-graphic',
    );
    expect(definition?.structure).toBeDefined();

    const visual = evaluateFlaGraphicVisual({
      definition: definition!,
      frameOrdinal: 0,
      mode: 'instance',
    });
    expect(visual).not.toBeNull();
    expect(visual!.layers).not.toBeNull();
    const nodes = visual!.layers!.flatMap((l) => l.nodes);
    expect(nodes).toHaveLength(3);

    const [baseCard, labelNode, topAccent] = nodes;
    expect(isFlaGraphicNodeTransformable(baseCard!.source)).toBe(true);
    expect(isFlaGraphicNodeTransformable(topAccent!.source)).toBe(true);
    expect(isFlaGraphicNodeTransformable(labelNode!.source)).toBe(false);
    expect(labelNode!.source.type).toBe('opaque');
    if (labelNode!.source.type !== 'opaque') return;

    expect(labelNode!.source.opaqueKind).toBe('text');
    expect(labelNode!.source.fallbackScope).toBe('subtree');
    expect(labelNode!.source.fallbackAssetId).toBeDefined();
    expect(labelNode!.source.fallbackViewBox).toBeDefined();

    // Isolated text SVG preserves S01-B DropShadow filter with expanded unclipped bounds.
    const textFallbackAssetId = labelNode!.source.fallbackAssetId;
    const textAsset = reopened.project.assets.find((a) => a.id === textFallbackAssetId);
    expect(textAsset).toBeDefined();
    const textSvg = await fs.readFile(path.join(projectRoot, textAsset!.relativePath), 'utf8');
    expect(textSvg).toContain('feGaussianBlur');
    expect(textSvg).toContain('feOffset');
    // Expanded bounds exceed bare 100x28 text box to avoid shadow clipping.
    expect(labelNode!.source.fallbackViewBox!.width).toBeGreaterThan(100);
    expect(labelNode!.source.fallbackViewBox!.height).toBeGreaterThan(28);
  });
});
