import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { deflateSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { FlaPartPreviewService } from '../../src/main/services/FlaPartPreviewService';
import { prepareFlaStaticSnapshotDisplaySource } from '../../src/main/services/fla-static-snapshot-svg-builder';
import type {
  FlaStaticSnapshotRasterizeInput,
  FlaStaticSnapshotRasterizer,
} from '../../src/main/services/fla-static-snapshot-render-session';
import { stableRenderTargetId } from '../../src/main/services/fla-static-snapshot-svg-builder';
import type { FlaImportService } from '../../src/main/services/FlaImportService';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { migrateProject } from '../../src/domain';
import exampleProject from '../../demo-project/project-v1.example.json';
import { FLA_PART_PREVIEW_LIMITS, FlaPartPreviewRequestSchema } from '../../src/shared/fla-part-preview-api';

const SESSION_ID = '90600000-0000-4000-8000-000000000001';
const SECOND_SESSION_ID = '90600000-0000-4000-8000-000000000003';
const R05_SOURCE_SHA256 = '98fe84604b01edc3224b52cdcb07c11a3c2916f99ce1a99c224f026ecbc64606';

interface FixtureMatrix {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly tx: number;
  readonly ty: number;
}

const DEFAULT_SCENE_MATRICES: readonly FixtureMatrix[] = [
  { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
  { a: 1, b: 0, c: 0, d: 1, tx: 10, ty: 2 },
];

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(name: string, data: Buffer): Buffer {
  const type = Buffer.from(name, 'ascii');
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  type.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([type, data])), 8 + data.length);
  return output;
}

function makePng(width: number, height: number, paint: number): Uint8Array {
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
      scanlines[offset] = paint;
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

function makePngWithTextChunk(width: number, height: number, paint: number, textByteLength: number): Uint8Array {
  const png = Buffer.from(makePng(width, height, paint));
  const signatureLength = 8;
  const headerChunkLength = 12 + 13;
  const textData = Buffer.alloc(textByteLength, 0x61);
  Buffer.from('preview\0', 'ascii').copy(textData);
  const textChunk = pngChunk('tEXt', textData);
  return new Uint8Array(Buffer.concat([
    png.subarray(0, signatureLength + headerChunkLength),
    textChunk,
    png.subarray(signatureLength + headerChunkLength),
  ]));
}

async function buildTwoPartFla(
  sceneKind: 'parts' | 'visible-text' | 'empty-mask' = 'parts',
  includeSecondScene = false,
  sceneMatrices: readonly FixtureMatrix[] = DEFAULT_SCENE_MATRICES,
  graphicName = 'MyGraphic',
  graphicHasParts = false,
): Promise<Uint8Array> {
  const symbolElements = sceneMatrices.map((matrix) => `<DOMSymbolInstance libraryItemName="${graphicName}" symbolType="graphic" loop="loop" firstFrame="0">
            <matrix><Matrix a="${matrix.a}" b="${matrix.b}" c="${matrix.c}" d="${matrix.d}" tx="${matrix.tx}" ty="${matrix.ty}"/></matrix>
          </DOMSymbolInstance>`).join('\n          ');
  const sceneLayers = sceneKind === 'parts'
    ? `<DOMLayer name="Parts"><frames>
        <DOMFrame index="0" duration="1"><elements>${symbolElements}</elements></DOMFrame>
      </frames></DOMLayer>`
    : sceneKind === 'visible-text'
      ? `<DOMLayer name="Visible text"><frames>
          <DOMFrame index="0" duration="1"><elements><DOMText><matrix><Matrix a="1" d="1"/></matrix></DOMText></elements></DOMFrame>
        </frames></DOMLayer>`
      : `<DOMLayer name="Empty mask" layerType="mask"><frames>
          <DOMFrame index="0" duration="1"><elements/></DOMFrame>
        </frames></DOMLayer>
        <DOMLayer name="Masked content" parentLayerIndex="0"><frames>
          <DOMFrame index="0" duration="1"><elements><DOMShape>
            <fills><FillStyle index="1"><SolidColor color="#f03a55" alpha="1"/></FillStyle></fills>
            <edges><Edge fillStyle1="1" cubics="!0 0|12 0|12 12|0 12|0 0"/></edges>
          </DOMShape></elements></DOMFrame>
        </frames></DOMLayer>`;
  const secondScene = includeSecondScene
    ? `<DOMTimeline name="Second Scene"><layers>${sceneLayers}</layers></DOMTimeline>`
    : '';
  const document = `<?xml version="1.0" encoding="UTF-8"?>
<DOMDocument width="32" height="24" xmlns="http://ns.adobe.com/xfl/2008/">
  <timelines><DOMTimeline name="Scene"><layers>${sceneLayers}</layers></DOMTimeline>${secondScene}</timelines>
</DOMDocument>`;
  const graphicArtwork = graphicHasParts
    ? `<DOMShape><fills><FillStyle index="1"><SolidColor color="#f03a55" alpha="1"/></FillStyle></fills>
        <edges><Edge fillStyle1="1" cubics="!0 0|12 0[6 6 12 12 12 12|0 0"/></edges></DOMShape>
       <DOMShape><fills><FillStyle index="1"><SolidColor color="#2555aa" alpha="1"/></FillStyle></fills>
        <edges><Edge fillStyle1="1" cubics="!14 0|26 0[20 6 26 12 26 12|14 0"/></edges></DOMShape>`
    : `<DOMGroup><members><DOMShape>
        <fills><FillStyle index="1"><SolidColor color="#f03a55" alpha="1"/></FillStyle></fills>
        <edges><Edge fillStyle1="1" cubics="!0 0|12 0[6 6 12 12 12 12|0 0"/></edges>
      </DOMShape></members></DOMGroup>`;
  const graphic = `<?xml version="1.0" encoding="UTF-8"?>
<DOMSymbolItem name="${graphicName}" xmlns="http://ns.adobe.com/xfl/2008/">
  <timelines><DOMTimeline name="${graphicName}"><layers><DOMLayer name="Artwork"><frames>
    <DOMFrame index="0" duration="1"><elements>${graphicArtwork}</elements></DOMFrame>
  </frames></DOMLayer></layers></DOMTimeline></timelines>
</DOMSymbolItem>`;
  const zip = new JSZip();
  zip.file('DOMDocument.xml', document);
  zip.file(`LIBRARY/${graphicName}.xml`, graphic);
  return zip.generateAsync({ type: 'uint8array' });
}

async function buildTwoInstanceNestedGraphicFla(
  lastFrame: string | null = null,
  playbackMode = 'loop',
  firstFrame = '8',
): Promise<Uint8Array> {
  const secondLastFrame = lastFrame === null ? '' : ` lastFrame="${lastFrame}"`;
  const scene = `<?xml version="1.0" encoding="UTF-8"?>
<DOMDocument width="32" height="24" xmlns="http://ns.adobe.com/xfl/2008/">
  <timelines><DOMTimeline name="Scene"><layers><DOMLayer name="Parts"><frames>
    <DOMFrame index="0" duration="1"><elements>
      <DOMSymbolInstance libraryItemName="MyGraphic" symbolType="graphic" loop="loop" firstFrame="0">
        <matrix><Matrix a="1" d="1" tx="0" ty="0"/></matrix>
      </DOMSymbolInstance>
      <DOMSymbolInstance libraryItemName="MyGraphic" symbolType="graphic" loop="${playbackMode}" firstFrame="${firstFrame}"${secondLastFrame}>
        <matrix><Matrix a="1" d="1" tx="16" ty="0"/></matrix>
      </DOMSymbolInstance>
    </elements></DOMFrame>
  </frames></DOMLayer></layers></DOMTimeline></timelines>
</DOMDocument>`;
  const frames = Array.from({ length: 9 }, (_, frameIndex) => `
    <DOMFrame index="${frameIndex}" duration="1"><elements><DOMShape>
      <fills><FillStyle index="1"><SolidColor color="#12000${frameIndex}" alpha="1"/></FillStyle></fills>
      <edges><Edge fillStyle1="1" cubics="!0 0|12 0|12 12|0 12|0 0"/></edges>
    </DOMShape></elements></DOMFrame>`).join('');
  const graphic = `<?xml version="1.0" encoding="UTF-8"?>
<DOMSymbolItem name="MyGraphic" symbolType="graphic" xmlns="http://ns.adobe.com/xfl/2008/">
  <timelines><DOMTimeline name="MyGraphic"><layers><DOMLayer name="Artwork"><frames>${frames}
  </frames></DOMLayer></layers></DOMTimeline></timelines>
</DOMSymbolItem>`;
  const zip = new JSZip();
  zip.file('DOMDocument.xml', scene);
  zip.file('LIBRARY/MyGraphic.xml', graphic);
  return zip.generateAsync({ type: 'uint8array' });
}

async function buildOneFrameGroupedGraphicFla(): Promise<Uint8Array> {
  const scene = `<?xml version="1.0" encoding="UTF-8"?>
<DOMDocument width="32" height="24" xmlns="http://ns.adobe.com/xfl/2008/">
  <timelines><DOMTimeline name="Scene"><layers><DOMLayer name="Parts"><frames>
    <DOMFrame index="0" duration="1"><elements>
      <DOMSymbolInstance libraryItemName="MyGraphic" symbolType="graphic" loop="loop" firstFrame="0">
        <matrix><Matrix a="1" d="1" tx="0" ty="0"/></matrix>
      </DOMSymbolInstance>
      <DOMSymbolInstance libraryItemName="MyGraphic" symbolType="graphic" loop="loop" firstFrame="0">
        <matrix><Matrix a="1" d="1" tx="16" ty="0"/></matrix>
      </DOMSymbolInstance>
    </elements></DOMFrame>
  </frames></DOMLayer></layers></DOMTimeline></timelines>
</DOMDocument>`;
  const graphic = `<?xml version="1.0" encoding="UTF-8"?>
<DOMSymbolItem name="MyGraphic" symbolType="graphic" xmlns="http://ns.adobe.com/xfl/2008/">
  <timelines><DOMTimeline name="MyGraphic"><layers><DOMLayer name="Artwork"><frames>
    <DOMFrame index="0" duration="1"><elements>
      <DOMShape><fills><FillStyle index="1"><SolidColor color="#222222" alpha="1"/></FillStyle></fills>
        <edges><Edge fillStyle1="1" cubics="!28 0|32 0|32 4|28 4|28 0"/></edges>
      </DOMShape>
      <DOMGroup><matrix><Matrix a="0" b="2" c="-2" d="0" tx="20" ty="10"/></matrix><members>
        <DOMShape><matrix><Matrix a="0" b="2" c="-2" d="0" tx="14" ty="14"/></matrix>
          <fills><FillStyle index="1"><SolidColor color="#f03a55" alpha="1"/></FillStyle></fills>
          <edges><Edge fillStyle1="1" cubics="!0 0|12 0|12 12|0 12|0 0"/></edges>
        </DOMShape>
        <DOMShape><matrix><Matrix a="0" b="2" c="-2" d="0" tx="18" ty="2"/></matrix>
          <fills><FillStyle index="1"><SolidColor color="#2555aa" alpha="1"/></FillStyle></fills>
          <edges><Edge fillStyle1="1" cubics="!0 0|8 0|8 8|0 8|0 0"/></edges>
        </DOMShape>
      </members></DOMGroup>
    </elements></DOMFrame>
  </frames></DOMLayer></layers></DOMTimeline></timelines>
</DOMSymbolItem>`;
  const zip = new JSZip();
  zip.file('DOMDocument.xml', scene);
  zip.file('LIBRARY/MyGraphic.xml', graphic);
  return zip.generateAsync({ type: 'uint8array' });
}

async function buildMultiGroupWithSymbolGraphicFla(): Promise<Uint8Array> {
  const scene = `<?xml version="1.0" encoding="UTF-8"?>
<DOMDocument width="32" height="24" xmlns="http://ns.adobe.com/xfl/2008/">
  <timelines><DOMTimeline name="Scene"><layers><DOMLayer name="Parts"><frames>
    <DOMFrame index="0" duration="1"><elements>
      <DOMSymbolInstance libraryItemName="MyGraphic" symbolType="graphic" loop="loop" firstFrame="0">
        <matrix><Matrix a="1" d="1" tx="0" ty="0"/></matrix>
      </DOMSymbolInstance>
      <DOMSymbolInstance libraryItemName="MyGraphic" symbolType="graphic" loop="loop" firstFrame="0">
        <matrix><Matrix a="1" d="1" tx="16" ty="0"/></matrix>
      </DOMSymbolInstance>
    </elements></DOMFrame>
  </frames></DOMLayer></layers></DOMTimeline></timelines>
</DOMDocument>`;
  const shape = (color: string, tx: number) => `<DOMShape>
    <matrix><Matrix a="1" d="1" tx="${tx}" ty="0"/></matrix>
    <fills><FillStyle index="1"><SolidColor color="${color}" alpha="1"/></FillStyle></fills>
    <edges><Edge fillStyle1="1" cubics="!0 0|8 0|8 8|0 8|0 0"/></edges>
  </DOMShape>`;
  const graphic = `<?xml version="1.0" encoding="UTF-8"?>
<DOMSymbolItem name="MyGraphic" symbolType="graphic" xmlns="http://ns.adobe.com/xfl/2008/">
  <timelines><DOMTimeline name="MyGraphic"><layers><DOMLayer name="Artwork"><frames>
    <DOMFrame index="0" duration="1"><elements>
      ${shape('#222222', 0)}
      <DOMGroup><members>${shape('#19a45b', 2)}</members></DOMGroup>
      <DOMSymbolInstance libraryItemName="Backdrop" symbolType="graphic" loop="loop" firstFrame="0">
        <matrix><Matrix a="1" d="1" tx="5" ty="1"/></matrix>
      </DOMSymbolInstance>
      <DOMGroup><members>${shape('#f03a55', 4)}${shape('#2555aa', 12)}</members></DOMGroup>
      ${shape('#e8b72a', 20)}
    </elements></DOMFrame>
  </frames></DOMLayer></layers></DOMTimeline></timelines>
</DOMSymbolItem>`;
  const backdrop = `<?xml version="1.0" encoding="UTF-8"?>
<DOMSymbolItem name="Backdrop" symbolType="graphic" xmlns="http://ns.adobe.com/xfl/2008/">
  <timelines><DOMTimeline name="Backdrop"><layers><DOMLayer name="Artwork"><frames>
    <DOMFrame index="0" duration="1"><elements>${shape('#873bb5', 0)}</elements></DOMFrame>
  </frames></DOMLayer></layers></DOMTimeline></timelines>
</DOMSymbolItem>`;
  const zip = new JSZip();
  zip.file('DOMDocument.xml', scene);
  zip.file('LIBRARY/MyGraphic.xml', graphic);
  zip.file('LIBRARY/Backdrop.xml', backdrop);
  return zip.generateAsync({ type: 'uint8array' });
}

async function fixture(
  withAddresses = true,
  sceneKind: 'parts' | 'visible-text' | 'empty-mask' = 'parts',
  includeSecondScene = false,
  sceneMatrices: readonly FixtureMatrix[] = DEFAULT_SCENE_MATRICES,
  graphicName = 'MyGraphic',
  originalSourceSha256?: string,
  graphicHasParts = false,
  sourceBytesOverride?: Uint8Array,
) {
  const bytes = sourceBytesOverride ?? await buildTwoPartFla(sceneKind, includeSecondScene, sceneMatrices, graphicName, graphicHasParts);
  const prepared = await prepareFlaStaticSnapshotDisplaySource(bytes, 'preview');
  if (!prepared.ok) throw new Error(prepared.message);
  const rawSha256 = createHash('sha256').update(bytes).digest('hex');
  let displaySource = prepared.source;
  if (!withAddresses) {
    const scene = displaySource.sceneTimelines[0];
    if (!scene) throw new Error('Fixture Scene missing');
    const frameContext = {
      ...scene.frameContext,
      layers: scene.frameContext.layers.map((layer) => layer && ({
        ...layer,
        elements: layer.elements.map((element, index) => index === 0
          ? { ...element, sourceAddress: undefined }
          : element),
      })),
    };
    displaySource = {
      ...displaySource,
      sceneTimelines: [{ ...scene, frameContext }, ...displaySource.sceneTimelines.slice(1)],
    };
  }
  const inspectionSession = {
    sessionId: SESSION_ID,
    ir: {
      source: { basename: 'parts.fla', sha256: rawSha256 },
      document: { width: 32, height: 24, frameRate: 12 },
      media: [],
    },
    originalSourceSha256: originalSourceSha256 ?? rawSha256,
    sourceBytes: bytes,
  };
  const registeredSessionIds = new Set([SESSION_ID]);
  const flaImportService = {
    getSession: vi.fn((sessionId: string) => registeredSessionIds.has(sessionId)
      ? { ...inspectionSession, sessionId }
      : null),
  } as unknown as FlaImportService;
  const renderSession = {
    prepareDisplaySourceForPartPreview: vi.fn(async () => ({
      ok: true as const,
      source: displaySource,
      xmlByteLength: 1,
      cacheHit: false,
    })),
  };
  const scene = displaySource.sceneTimelines[0];
  if (!scene) throw new Error('Fixture Scene missing');
  const targetId = stableRenderTargetId(bytes, `scene\u0000timeline\u0000${scene.index}`);
  const graphic = displaySource.graphicSymbols.find((symbol) => symbol.sourceLibraryItemName === graphicName);
  const secondScene = displaySource.sceneTimelines[1];
  return {
    bytes,
    rawSha256,
    displaySource,
    inspectionSession,
    flaImportService,
    registerSession: (sessionId: string) => registeredSessionIds.add(sessionId),
    renderSession,
    targetId,
    graphicTargetId: graphic
      ? stableRenderTargetId(bytes, `graphic-symbol\u0000${graphic.sourceLibraryItemName}\u0000${graphic.userLabel}`)
      : null,
    secondTargetId: secondScene
      ? stableRenderTargetId(bytes, `scene\u0000timeline\u0000${secondScene.index}`)
      : null,
  };
}

function request(
  generation = 1,
  sessionId = SESSION_ID,
  requestId = `90600000-0000-4000-8000-${String(generation).padStart(12, '0')}`,
) {
  return FlaPartPreviewRequestSchema.parse({
    format: 'fla-part-preview',
    version: 1,
    requestId,
    sessionId,
    generation,
    target: {
      renderTargetId: 'fla-render-target-placeholder0000',
      selectedFrameIndex: 0,
    },
  });
}

function rasterizerFor(fixtureData: Awaited<ReturnType<typeof fixture>>) {
  const calls: FlaStaticSnapshotRasterizeInput[] = [];
  const outputs: Uint8Array[] = [];
  const rasterizer: FlaStaticSnapshotRasterizer = {
    async rasterize(input) {
      calls.push(input);
      const pngBytes = makePng(input.width, input.height, calls.length * 31);
      outputs.push(pngBytes);
      return { pngBytes, width: input.width, height: input.height, pixelCount: input.pixelCount };
    },
    cancel: vi.fn(() => true),
    close: vi.fn(),
  };
  const previewService = new FlaPartPreviewService({
    flaImportService: fixtureData.flaImportService,
    renderSession: fixtureData.renderSession as never,
    rasterizer,
    wallTimeMs: 10_000,
  });
  return { calls, outputs, rasterizer, previewService };
}

function projectStateSnapshot(store: EditorProjectStore) {
  const snapshot = store.getSnapshot();
  if (!snapshot) throw new Error('Expected a current EditorProjectStore snapshot');
  const history = store.history.getSnapshot();
  return {
    projectInstanceId: store.getProjectInstanceId(),
    projectId: snapshot.project.id,
    revision: snapshot.revision,
    dirty: snapshot.dirty,
    historyUndoCount: history.undoCount,
    historyRedoCount: history.redoCount,
    characterCount: snapshot.project.characters.length,
    assetCount: snapshot.project.assets.length,
    imageAssetCount: snapshot.project.assets.filter((asset) => asset.kind === 'image').length,
  };
}

function heldPartPreviewStorage(service: FlaPartPreviewService) {
  return (service as unknown as {
    heldResult: {
      parts: readonly { image: { bytes: Uint8Array } }[] | null;
      partPngBytes: number;
    } | null;
  }).heldResult;
}

function cancelRequest(
  requestId?: string,
  sessionId?: string,
  generation?: number,
) {
  return {
    format: 'fla-part-preview-cancel',
    version: 1,
    ...(requestId ? { requestId } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(generation === undefined ? {} : { generation }),
  };
}

describe('F1-02 Main part preview service', () => {
  it('keeps a source-addressed plan in Main and reassembles from emitted PNG bytes', async () => {
    const data = await fixture();
    const { calls, outputs, previewService } = rasterizerFor(data);
    const previewRequest = { ...request(1), target: { renderTargetId: data.targetId, selectedFrameIndex: 0 } };

    const response = await previewService.preview(previewRequest);

    expect(response.ok).toBe(true);
    if (!response.ok || response.capability !== 'EDITABLE_PARTS_READY') {
      throw new Error('Expected independently addressable parts');
    }
    expect(response.partPreviews).toHaveLength(2);
    expect(response.metrics.sourcePreparationCountForRequest).toBe(1);
    expect(response.metrics.rasterCount).toBe(4);
    expect(calls).toHaveLength(4); // native, two parts, reassembly
    const reassembly = calls.at(-1)?.svg ?? '';
    expect(reassembly.match(/<image /gu)).toHaveLength(2);
    for (const emittedPartPng of outputs.slice(1, 3)) {
      const encoded = Buffer.from(emittedPartPng).toString('base64');
      expect(reassembly).toContain(`href="data:image/png;base64,${encoded}"`);
    }
    const plan = previewService.getPlan(response.planId, SESSION_ID, 1);
    expect(plan?.capability).toBe('EDITABLE_PARTS_READY');
    expect(plan?.units.map((unit) => unit.sourceSymbolId)).toEqual(['MyGraphic', 'MyGraphic']);
    expect(new Set(plan?.units.map((unit) => unit.occurrenceId)).size).toBe(2);
    expect(plan?.units.every((unit) => unit.sourceAddress && unit.occurrencePath.length > 0)).toBe(true);
    // The renderer response carries only an opaque plan id and PNGs.
    expect(response).not.toHaveProperty('plan');
    previewService.close();
  });

  it('prepares editable Parts for the source-bound, visible Scene Graphic root', async () => {
    const data = await fixture(
      true,
      'parts',
      false,
      DEFAULT_SCENE_MATRICES,
      '修仙男-cilisucai.com1/修仙男-cilisucai.com2',
      R05_SOURCE_SHA256,
      true,
    );
    const { previewService } = rasterizerFor(data);
    if (!data.graphicTargetId) throw new Error('Expected the approved Graphic fixture target');

    const response = await previewService.preview({
      ...request(1),
      target: { renderTargetId: data.graphicTargetId, selectedFrameIndex: 0 },
    });

    if (!response.ok) throw new Error(`Approved Graphic preview failed: ${response.error.code}: ${response.error.message}`);
    if (response.status !== 'PREVIEW_READY' || response.capability !== 'EDITABLE_PARTS_READY') {
      throw new Error('Expected an editable Part plan for the approved Graphic root');
    }
    const plan = previewService.getPlan(response.planId, SESSION_ID, 1);
    expect(plan?.target).toMatchObject({
      renderTargetId: data.graphicTargetId,
      kind: 'graphic-symbol',
      sceneIndex: null,
      sourceLibraryItemName: '修仙男-cilisucai.com1/修仙男-cilisucai.com2',
      selectedFrameIndex: 0,
      frameSelectionBasis: 'approved Graphic root frame selected through Main prepared source',
    });
    expect(plan?.stage.coordinateSpace).toBe('root-graphic-local-pixels');
    expect(plan?.units.length).toBeGreaterThanOrEqual(2);
    expect(plan?.units.every((unit) => unit.stageMapping.coordinateSpace === 'root-graphic-local-pixels')).toBe(true);
    previewService.close();
  });

  it.each([
    { graphicName: '修仙男-cilisucai.com1/修仙男-cilisucai.com20', originalSourceSha256: R05_SOURCE_SHA256, sceneKind: 'parts', selectedFrameIndex: 0 },
    { graphicName: '修仙男-cilisucai.com1/修仙男-cilisucai.com2', originalSourceSha256: '0'.repeat(64), sceneKind: 'parts', selectedFrameIndex: 0 },
    { graphicName: '修仙男-cilisucai.com1/修仙男-cilisucai.com2', originalSourceSha256: R05_SOURCE_SHA256, sceneKind: 'visible-text', selectedFrameIndex: 0 },
    { graphicName: '修仙男-cilisucai.com1/修仙男-cilisucai.com2', originalSourceSha256: R05_SOURCE_SHA256, sceneKind: 'parts', selectedFrameIndex: 1 },
  ] as const)(
    'rejects an unproven Graphic Part plan for $graphicName',
    async ({ graphicName, originalSourceSha256, sceneKind, selectedFrameIndex }) => {
      const data = await fixture(
        true,
        sceneKind,
        false,
        DEFAULT_SCENE_MATRICES,
        graphicName,
        originalSourceSha256,
        true,
      );
      const { previewService } = rasterizerFor(data);
      if (!data.graphicTargetId) throw new Error('Expected a Graphic fixture target');

      const response = await previewService.preview({
        ...request(1),
        target: { renderTargetId: data.graphicTargetId, selectedFrameIndex },
      });

      expect(response.ok).toBe(false);
      if (response.ok) throw new Error('Expected unsafe Graphic root rejection');
      expect(response.error.code).toBe('TARGET_NOT_FOUND');
      expect(previewService.getPlan('any-plan-id', SESSION_ID, 1)).toBeNull();
      expect(heldPartPreviewStorage(previewService)).toBeNull();
      previewService.close();
    },
  );

  it('uses each explicit nested Graphic firstFrame in native, isolated, and PartPlan output', async () => {
    const sourceBytes = await buildTwoInstanceNestedGraphicFla();
    const data = await fixture(true, 'parts', false, DEFAULT_SCENE_MATRICES, 'MyGraphic', undefined, false, sourceBytes);
    const { calls, previewService } = rasterizerFor(data);
    const previewRequest = { ...request(1), target: { renderTargetId: data.targetId, selectedFrameIndex: 0 } };

    const response = await previewService.preview(previewRequest);

    expect(response.ok).toBe(true);
    if (!response.ok || response.capability !== 'EDITABLE_PARTS_READY') {
      throw new Error('Expected two independently addressable nested Graphic instances');
    }
    expect(response.partPreviews).toHaveLength(2);
    const plan = previewService.getPlan(response.planId, SESSION_ID, 1);
    expect(response.partPreviews.map((part) => ({
      unitId: part.unitId,
      occurrenceId: part.occurrenceId,
      sourceKind: part.sourceKind,
      sourceSymbolId: part.sourceSymbolId,
      sourceAddress: part.sourceAddress,
      adapterIdentity: part.adapterIdentity,
      sourceDefinitionFrameCount: part.sourceDefinitionFrameCount,
      layerName: part.layerName,
    }))).toEqual(plan?.units.map((unit) => ({
      unitId: unit.unitId,
      occurrenceId: unit.occurrenceId,
      sourceKind: unit.sourceKind,
      sourceSymbolId: unit.sourceSymbolId,
      sourceAddress: unit.sourceAddress,
      adapterIdentity: unit.adapterIdentity,
      sourceDefinitionFrameCount: unit.sourceDefinitionFrameCount,
      layerName: unit.layer.name,
    })));
    expect(new Set(response.partPreviews.map((part) => part.sourceAddress)).size).toBe(2);
    expect(plan?.units.map((unit) => unit.selectedEffectiveChildFrameIndex)).toEqual([0, 8]);
    expect(plan?.units.map((unit) => unit.sourceFrame.effectiveChildFrameIndex)).toEqual([0, 8]);
    expect(response.poseIdentity).toBe(plan?.poseIdentity);

    expect(calls).toHaveLength(4); // native, two isolated parts, reassembly
    expect(calls[0]?.svg).toContain('fill="#120000"');
    expect(calls[0]?.svg).toContain('fill="#120008"');
    expect(calls[1]?.svg).toContain('fill="#120000"');
    expect(calls[1]?.svg).not.toContain('fill="#120008"');
    expect(calls[2]?.svg).toContain('fill="#120008"');
    expect(calls[2]?.svg).not.toContain('fill="#120000"');
    expect(calls[3]?.svg.match(/<image /gu)).toHaveLength(2);
    previewService.close();
  });

  it('retains a selected Scene Graphic instance and renders every bounded Definition frame', async () => {
    const sourceBytes = await buildTwoInstanceNestedGraphicFla();
    const data = await fixture(true, 'parts', false, DEFAULT_SCENE_MATRICES, 'MyGraphic', undefined, false, sourceBytes);
    const { previewService } = rasterizerFor(data);

    const response = await previewService.preview({
      ...request(1),
      target: { renderTargetId: data.targetId, selectedFrameIndex: 0 },
    });

    expect(response.ok).toBe(true);
    if (!response.ok || response.capability !== 'EDITABLE_PARTS_READY') {
      throw new Error('Expected a source-addressed Scene Graphic instance preview');
    }
    expect(response.partPreviews.map((part) => part.graphicInstanceImportable)).toEqual([true, true]);
    const plan = previewService.getPlan(response.planId, SESSION_ID, 1);
    const secondUnit = plan?.units[1];
    expect(secondUnit?.sourceFrame.firstFrame).toBe('8');
    if (!plan || !secondUnit) throw new Error('Expected a held Graphic occurrence plan');

    const result = await previewService.buildGraphicDefinitionFrameBatch({
      sessionId: SESSION_ID,
      planId: response.planId,
      generation: 1,
      poseIdentity: response.poseIdentity,
      unitId: secondUnit.unitId,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.batch.frames).toHaveLength(9);
    expect(result.batch.unit.occurrenceId).toBe(secondUnit.occurrenceId);
    expect(result.batch.frames.map((frame) => frame.sourceFrameIndex)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8,
    ]);
    expect(result.batch.frames.every((frame) =>
      createHash('sha256').update(frame.svg).digest('hex') === frame.sha256,
    )).toBe(true);
    previewService.close();
  });

  it('keeps one real XFL Group and its source-addressed direct vector children interactive before full-frame baking', async () => {
    const sourceBytes = await buildOneFrameGroupedGraphicFla();
    const data = await fixture(true, 'parts', false, DEFAULT_SCENE_MATRICES, 'MyGraphic', undefined, false, sourceBytes);
    const { previewService } = rasterizerFor(data);
    const response = await previewService.preview({
      ...request(1),
      target: { renderTargetId: data.targetId, selectedFrameIndex: 0 },
    });
    expect(response.ok).toBe(true);
    if (!response.ok || response.capability !== 'EDITABLE_PARTS_READY') {
      throw new Error('Expected a source-addressed Graphic instance');
    }
    const plan = previewService.getPlan(response.planId, SESSION_ID, 1);
    const unit = plan?.units[0];
    if (!unit) throw new Error('Expected one source Graphic instance');

    const result = await previewService.buildGraphicDefinitionFrameBatch({
      sessionId: SESSION_ID,
      planId: response.planId,
      generation: 1,
      poseIdentity: response.poseIdentity,
      unitId: unit.unitId,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    const editPreview = result.batch.groupEditPreview;
    expect(editPreview).toBeDefined();
    if (!editPreview) throw new Error('Expected a transient Group edit preview');
    expect(editPreview.source.outerOccurrenceId).toBe(unit.occurrenceId);
    expect(editPreview.source.outerSourceAddress).toBe(unit.sourceAddress);
    expect(editPreview.children).toHaveLength(2);
    expect(editPreview.children.map((child) => child.kind)).toEqual(['shape', 'shape']);
    expect(editPreview.children[0]?.sourceAddress).not.toBe(editPreview.children[1]?.sourceAddress);
    expect(editPreview.children[0]?.localTransform).toEqual({ a: 1, b: 0, c: 0, d: 1, tx: 2, ty: 3 });
    expect(editPreview.children[1]?.localTransform).toEqual({ a: 1, b: 0, c: 0, d: 1, tx: -4, ty: 1 });
    expect(editPreview.children[0]?.artwork.svg).toContain('#f03a55');
    expect(editPreview.children[0]?.artwork.svg).not.toContain('#2555aa');
    expect(editPreview.children[1]?.artwork.svg).toContain('#2555aa');
    expect(editPreview.children[1]?.artwork.svg).not.toContain('#f03a55');
    expect(editPreview.background?.artwork.svg).toContain('#222222');
    expect(editPreview.background?.artwork.svg).not.toContain('#f03a55');
    expect(editPreview.background?.artwork.svg).not.toContain('#2555aa');
    previewService.close();
  });

  it('selects the topmost eligible Group among multiple Groups and preserves sibling Symbol painter order', async () => {
    const sourceBytes = await buildMultiGroupWithSymbolGraphicFla();
    const data = await fixture(true, 'parts', false, DEFAULT_SCENE_MATRICES, 'MyGraphic', undefined, false, sourceBytes);
    const { previewService } = rasterizerFor(data);
    const response = await previewService.preview({
      ...request(1),
      target: { renderTargetId: data.targetId, selectedFrameIndex: 0 },
    });
    expect(response.ok).toBe(true);
    if (!response.ok || response.capability !== 'EDITABLE_PARTS_READY') {
      throw new Error(`Expected a source-addressed Graphic instance: ${JSON.stringify(response)}`);
    }
    const plan = previewService.getPlan(response.planId, SESSION_ID, 1);
    const unit = plan?.units[0];
    if (!unit) throw new Error('Expected one source Graphic instance');
    const result = await previewService.buildGraphicDefinitionFrameBatch({
      sessionId: SESSION_ID,
      planId: response.planId,
      generation: 1,
      poseIdentity: response.poseIdentity,
      unitId: unit.unitId,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    const editPreview = result.batch.groupEditPreview;
    expect(editPreview).toBeDefined();
    if (!editPreview) throw new Error('Expected a transient multi-Group edit preview');
    expect(editPreview.children).toHaveLength(2);
    expect(editPreview.group.sourceAddress).toBe(editPreview.children[0]?.parentGroupSourceAddress);
    expect(editPreview.children[0]?.artwork.svg).toContain('#f03a55');
    expect(editPreview.children[0]?.artwork.svg).not.toContain('#19a45b');
    expect(editPreview.children[1]?.artwork.svg).toContain('#2555aa');
    expect(editPreview.background?.artwork.svg).toContain('#222222');
    expect(editPreview.background?.artwork.svg).toContain('#19a45b');
    expect(editPreview.background?.artwork.svg).toContain('#873bb5');
    expect(editPreview.background?.artwork.svg).not.toContain('#e8b72a');
    expect(editPreview.foreground?.artwork.svg).toContain('#e8b72a');
    expect(editPreview.foreground?.artwork.svg).not.toContain('#f03a55');
    const backgroundSvg = editPreview.background?.artwork.svg ?? '';
    expect(backgroundSvg.indexOf('#222222')).toBeLessThan(backgroundSvg.indexOf('#19a45b'));
    expect(backgroundSvg.indexOf('#19a45b')).toBeLessThan(backgroundSvg.indexOf('#873bb5'));
    previewService.close();
  });

  it('keeps the Group edit preview fail-closed when the selected Group layer owns a frame filter', async () => {
    const data = await fixture(true, 'parts', false, DEFAULT_SCENE_MATRICES, 'MyGraphic', undefined, false,
      await buildOneFrameGroupedGraphicFla());
    const filteredDisplaySource = {
      ...data.displaySource,
      graphicSymbols: data.displaySource.graphicSymbols.map((symbol) =>
        symbol.sourceLibraryItemName === 'MyGraphic'
          ? {
            ...symbol,
            frameContext: {
              ...symbol.frameContext,
              layers: symbol.frameContext.layers.map((layer, index) => index === 0 && layer
                ? {
                  ...layer,
                  frameFilter: {
                    kind: 'blur' as const,
                    blurX: 2,
                    blurY: 2,
                    quality: 'low' as const,
                    enabled: true as const,
                  },
                }
                : layer),
            },
          }
          : symbol),
    };
    data.renderSession.prepareDisplaySourceForPartPreview.mockResolvedValue({
      ok: true,
      source: filteredDisplaySource,
      xmlByteLength: 1,
      cacheHit: false,
    });
    const { previewService } = rasterizerFor(data);
    const response = await previewService.preview({
      ...request(1),
      target: { renderTargetId: data.targetId, selectedFrameIndex: 0 },
    });
    expect(response.ok).toBe(true);
    if (!response.ok || response.capability !== 'EDITABLE_PARTS_READY') {
      throw new Error('Expected a source-addressed Graphic instance');
    }
    const plan = previewService.getPlan(response.planId, SESSION_ID, 1);
    const unit = plan?.units[0];
    if (!unit) throw new Error('Expected one source Graphic instance');
    const result = await previewService.buildGraphicDefinitionFrameBatch({
      sessionId: SESSION_ID,
      planId: response.planId,
      generation: 1,
      poseIdentity: response.poseIdentity,
      unitId: unit.unitId,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.batch.groupEditPreview).toBeUndefined();
    previewService.close();
  });

  it.each([
    ['omitted lastFrame with nonzero loop firstFrame', null, 'loop', '8', true],
    ['explicit terminal frame', '8', 'loop', '8', true],
    ['truncated loop range', '4', 'loop', '1', false],
    ['wrapped loop range', '1', 'loop', '8', false],
    ['nonzero firstFrame single-frame playback', '7', 'single frame', '8', true],
  ] as const)('classifies %s at preview and Main frame-batch boundaries', async (_label, lastFrame, playbackMode, firstFrame, importable) => {
    const sourceBytes = await buildTwoInstanceNestedGraphicFla(lastFrame, playbackMode, firstFrame);
    const data = await fixture(true, 'parts', false, DEFAULT_SCENE_MATRICES, 'MyGraphic', undefined, false, sourceBytes);
    const { previewService } = rasterizerFor(data);
    const response = await previewService.preview({
      ...request(1),
      target: { renderTargetId: data.targetId, selectedFrameIndex: 0 },
    });

    expect(response.ok).toBe(true);
    if (!response.ok || response.capability !== 'EDITABLE_PARTS_READY') {
      throw new Error('Expected a source-addressed Scene Graphic instance preview');
    }
    expect(response.partPreviews.map((part) => part.graphicInstanceImportable)).toEqual([true, importable]);
    const plan = previewService.getPlan(response.planId, SESSION_ID, 1);
    const unit = plan?.units[1];
    if (!plan || !unit) throw new Error('Expected a held Graphic occurrence plan');

    const result = await previewService.buildGraphicDefinitionFrameBatch({
      sessionId: SESSION_ID,
      planId: response.planId,
      generation: 1,
      poseIdentity: response.poseIdentity,
      unitId: unit.unitId,
    });
    expect(result.ok).toBe(importable);
    if (importable) {
      if (!result.ok) throw new Error(result.message);
      expect(result.batch.frames).toHaveLength(9);
    } else if (result.ok) {
      throw new Error('A restricted Graphic range must fail closed before frame rendering.');
    } else {
      expect(result.code).toBe('UNSUPPORTED_SOURCE');
    }
    previewService.close();
  });

  it('retains the exact successful Part PNG batch with its matching Main-held plan', async () => {
    const data = await fixture();
    const { calls, outputs, previewService } = rasterizerFor(data);
    const previewRequest = { ...request(1), target: { renderTargetId: data.targetId, selectedFrameIndex: 0 } };

    const response = await previewService.preview(previewRequest);

    expect(response.ok).toBe(true);
    if (!response.ok || response.capability !== 'EDITABLE_PARTS_READY') {
      throw new Error('Expected a successful editable Part preview');
    }
    const batch = previewService.getPreparedBatch(response.planId, SESSION_ID, 1);
    expect(batch).not.toBeNull();
    if (!batch) throw new Error('Expected Main to retain the generated Part batch');
    const metadata = previewService.getPreparedBatchMetadata(response.planId, SESSION_ID, 1);
    expect(metadata).not.toBeNull();
    if (!metadata) throw new Error('Expected Main to expose metadata for final commit revalidation');
    expect(metadata.plan).toEqual(batch.plan);
    expect(metadata.identity).toEqual(batch.identity);
    expect(metadata.parts.map((part) => part.image)).toEqual(batch.parts.map(({ image }) => ({
      width: image.width,
      height: image.height,
      pixelCount: image.pixelCount,
      sha256: image.sha256,
      byteLength: image.byteLength,
    })));
    expect(metadata.parts[0]?.image).not.toHaveProperty('bytes');
    expect(metadata.partPngBytes).toBe(batch.partPngBytes);
    expect(batch.identity).toEqual({
      planId: response.planId,
      sessionId: SESSION_ID,
      requestId: previewRequest.requestId,
      generation: 1,
      rawSourceSha256: data.rawSha256,
      normalizedSourceSha256: batch.plan.source.normalizedSha256,
      poseIdentity: response.poseIdentity,
      target: {
        renderTargetId: data.targetId,
        kind: batch.plan.target.kind,
        sceneIndex: batch.plan.target.sceneIndex,
        sourceLibraryItemName: batch.plan.target.sourceLibraryItemName,
        selectedFrameIndex: 0,
      },
    });
    expect(batch.plan).toEqual(previewService.getPlan(response.planId, SESSION_ID, 1));
    expect(batch.parts.map((part) => ({
      unitId: part.unitId,
      occurrenceId: part.occurrenceId,
      drawOrder: part.drawOrder,
      sha256: part.image.sha256,
      byteLength: part.image.byteLength,
    }))).toEqual(response.partPreviews.map((part) => ({
      unitId: part.unitId,
      occurrenceId: part.occurrenceId,
      drawOrder: part.drawOrder,
      sha256: part.image.sha256,
      byteLength: part.image.byteLength,
    })));
    expect(batch.parts.map((part) => part.stageMapping)).toEqual(
      batch.plan.units.map((unit) => unit.stageMapping),
    );
    const expectedPartPngs = outputs.slice(1, 3).map((bytes) => Buffer.from(bytes));
    expect(batch.parts.map((part) => createHash('sha256').update(part.image.bytes).digest('hex')))
      .toEqual(response.partPreviews.map((part) => part.image.sha256));
    expect(batch.parts.map((part) => Buffer.from(part.image.bytes)))
      .toEqual(expectedPartPngs);
    expect(batch.partPngBytes).toBe(batch.parts.reduce((sum, part) => sum + part.image.byteLength, 0));
    expect(batch.partPngBytes).toBeLessThanOrEqual(FLA_PART_PREVIEW_LIMITS.maxCompositionInputBytes);
    expect(heldPartPreviewStorage(previewService)?.parts).toHaveLength(2);

    const originalWorldTx = batch.plan.units[0]?.worldTransform.tx;
    batch.parts[0]!.image.bytes[0] = batch.parts[0]!.image.bytes[0]! ^ 0xff;
    batch.plan.units[0]!.worldTransform.tx += 999;
    response.partPreviews[0]!.image.bytes[0] = response.partPreviews[0]!.image.bytes[0]! ^ 0xff;
    const freshBatch = previewService.getPreparedBatch(response.planId, SESSION_ID, 1);
    expect(freshBatch?.parts.map((part) => Buffer.from(part.image.bytes)))
      .toEqual(expectedPartPngs);
    expect(freshBatch?.parts.map((part) => part.image.sha256)).toEqual(
      response.partPreviews.map((part) => part.image.sha256),
    );
    expect(freshBatch?.plan.units[0]?.worldTransform.tx).toBe(originalWorldTx);
    expect(calls).toHaveLength(4);
    expect(data.renderSession.prepareDisplaySourceForPartPreview).toHaveBeenCalledTimes(1);
    previewService.close();
  });

  it.each([
    ['negative translation', { a: 1, b: 0, c: 0, d: 1, tx: -4, ty: 3 }],
    ['mirror', { a: -1, b: 0, c: 0, d: 1, tx: 12, ty: 0 }],
    ['skew', { a: 1, b: 0.25, c: 0.1, d: 1, tx: 2, ty: -1 }],
  ] as const)('preserves %s in the full-stage PartPlan contract', async (_label, firstMatrix) => {
    const data = await fixture(true, 'parts', false, [firstMatrix, DEFAULT_SCENE_MATRICES[1]!]);
    const { previewService } = rasterizerFor(data);
    const previewRequest = { ...request(1), target: { renderTargetId: data.targetId, selectedFrameIndex: 0 } };

    const response = await previewService.preview(previewRequest);

    expect(response.ok).toBe(true);
    if (!response.ok || response.capability !== 'EDITABLE_PARTS_READY') {
      throw new Error('Expected transformed occurrences to remain independently previewable');
    }
    const plan = previewService.getPlan(response.planId, SESSION_ID, 1);
    expect(plan?.units[0]?.worldTransform).toEqual(firstMatrix);
    expect(plan?.units[0]?.drawOrder).toBe(0);
    expect(plan?.stage).toMatchObject({
      width: 32,
      height: 24,
      coordinateSpace: 'root-scene-stage-pixels',
    });
    expect(plan?.units.every((unit) => unit.stageMapping.crop === null &&
      unit.stageMapping.outputScale === 1 &&
      unit.stageMapping.stageOrigin.x === 0 &&
      unit.stageMapping.stageOrigin.y === 0)).toBe(true);
    expect(response.stage).toMatchObject({ width: 32, height: 24 });
    expect(response.partPreviews).toHaveLength(2);
    expect(response.partPreviews.every((part) => part.image.width === 32 && part.image.height === 24)).toBe(true);
    expect(response.reassembledPreview).toMatchObject({ width: 32, height: 24 });
    previewService.close();
  });

  it('uses whole-image-only for a singular occurrence transform without emitting a false Part', async () => {
    const singular: FixtureMatrix = { a: 0, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
    const data = await fixture(true, 'parts', false, [singular, DEFAULT_SCENE_MATRICES[1]!]);
    const { calls, previewService } = rasterizerFor(data);
    const previewRequest = { ...request(1), target: { renderTargetId: data.targetId, selectedFrameIndex: 0 } };

    const response = await previewService.preview(previewRequest);

    expect(response.ok).toBe(true);
    if (!response.ok || response.capability !== 'WHOLE_IMAGE_ONLY') {
      throw new Error('Expected singular transforms to fall back to a whole-image preview');
    }
    expect(response.reason).toContain('non-invertible world transform');
    expect(response.partPreviews).toEqual([]);
    expect(response.reassembledPreview).toBeNull();
    expect(calls).toHaveLength(1);
    expect(previewService.getPlan(response.planId, SESSION_ID, 1)?.units).toEqual([]);
    expect(previewService.getPreparedBatch(response.planId, SESSION_ID, 1)).toBeNull();
    expect(heldPartPreviewStorage(previewService)).toMatchObject({ parts: null, partPngBytes: 0 });
    previewService.close();
  });

  it('falls back to whole-image-only when a visible occurrence lacks a source address', async () => {
    const data = await fixture(false);
    const { calls, previewService } = rasterizerFor(data);
    const previewRequest = { ...request(1), target: { renderTargetId: data.targetId, selectedFrameIndex: 0 } };

    const response = await previewService.preview(previewRequest);

    expect(response.ok).toBe(true);
    if (!response.ok || response.capability !== 'WHOLE_IMAGE_ONLY') {
      throw new Error('Expected whole-image-only fallback');
    }
    expect(response.partPreviews).toEqual([]);
    expect(response.reassembledPreview).toBeNull();
    expect(calls).toHaveLength(1);
    expect(previewService.getPlan(response.planId)?.units).toEqual([]);
    expect(previewService.getPreparedBatch(response.planId, SESSION_ID, 1)).toBeNull();
    expect(heldPartPreviewStorage(previewService)).toMatchObject({ parts: null, partPngBytes: 0 });
    previewService.close();
  });

  it.each([
    ['visible-text', 'Visible display content is outside the supported static preview subset'],
    ['empty-mask', 'Mask layer has no filled vector-shape items'],
  ] as const)('fails closed for %s in the production display-source path', async (sceneKind, expectedReason) => {
    const data = await fixture(true, sceneKind);
    const { calls, previewService } = rasterizerFor(data);
    const previewRequest = { ...request(1), target: { renderTargetId: data.targetId, selectedFrameIndex: 0 } };

    const response = await previewService.preview(previewRequest);

    expect(response.ok).toBe(false);
    if (response.ok) throw new Error('Expected unsupported display content to be rejected');
    expect(response).toMatchObject({ capability: 'UNSUPPORTED' });
    expect(response.error.code).toBe('UNSUPPORTED_SOURCE');
    expect(response.error.message).toContain(expectedReason);
    expect(response).not.toHaveProperty('partPreviews');
    expect(calls).toHaveLength(0);
    expect(previewService.getPlan('any-plan-id', SESSION_ID, 1)).toBeNull();
    previewService.close();
  });

  it('returns a typed failure when the native preview raster fails', async () => {
    const data = await fixture();
    const rasterize = vi.fn<FlaStaticSnapshotRasterizer['rasterize']>(async () => {
      throw new Error('controlled raster failure');
    });
    const previewService = new FlaPartPreviewService({
      flaImportService: data.flaImportService,
      renderSession: data.renderSession as never,
      rasterizer: { rasterize, cancel: vi.fn(() => true), close: vi.fn() },
      wallTimeMs: 10_000,
    });
    const previewRequest = { ...request(1), target: { renderTargetId: data.targetId, selectedFrameIndex: 0 } };

    const response = await previewService.preview(previewRequest);

    expect(response.ok).toBe(false);
    if (response.ok) throw new Error('Expected raster failure');
    expect(response.error.code).toBe('RENDER_FAILED');
    expect(response.error.message).toBe('controlled raster failure');
    expect(rasterize).toHaveBeenCalledTimes(1);
    expect(response).not.toHaveProperty('partPreviews');
    expect(heldPartPreviewStorage(previewService)).toBeNull();
    previewService.close();
  });

  it('does not retain a partial independent PNG batch when a later Part raster fails', async () => {
    const data = await fixture();
    let rasterCount = 0;
    const rasterizer: FlaStaticSnapshotRasterizer = {
      async rasterize(input) {
        rasterCount += 1;
        if (rasterCount === 3) throw new Error('controlled second-Part raster failure');
        const pngBytes = makePng(input.width, input.height, rasterCount * 23);
        return { pngBytes, width: input.width, height: input.height, pixelCount: input.pixelCount };
      },
      cancel: vi.fn(() => true),
      close() {},
    };
    const service = new FlaPartPreviewService({
      flaImportService: data.flaImportService,
      renderSession: data.renderSession as never,
      rasterizer,
      wallTimeMs: 10_000,
    });

    const response = await service.preview({
      ...request(1),
      target: { renderTargetId: data.targetId, selectedFrameIndex: 0 },
    });

    expect(response.ok).toBe(true);
    if (!response.ok || response.capability !== 'WHOLE_IMAGE_ONLY') {
      throw new Error('Expected partial Part rasterization to fall back to a whole image');
    }
    expect(response.partPreviews).toEqual([]);
    expect(response.reassembledPreview).toBeNull();
    expect(service.getPlan(response.planId)?.capability).toBe('WHOLE_IMAGE_ONLY');
    expect(service.getPreparedBatch(response.planId, SESSION_ID, 1)).toBeNull();
    expect(heldPartPreviewStorage(service)).toMatchObject({ parts: null, partPngBytes: 0 });
    expect(rasterCount).toBe(3);
    service.close();
  });

  it('does not hold a plan or batch for an invalid Scene target', async () => {
    const data = await fixture();
    const { previewService } = rasterizerFor(data);

    const response = await previewService.preview({
      ...request(1),
      target: { renderTargetId: 'fla-render-target-missing000000', selectedFrameIndex: 0 },
    });

    expect(response.ok).toBe(false);
    if (response.ok) throw new Error('Expected invalid target rejection');
    expect(response.error.code).toBe('TARGET_NOT_FOUND');
    expect(heldPartPreviewStorage(previewService)).toBeNull();
    previewService.close();
  });

  it('returns whole-image-only when valid part PNGs exceed the reassembly input budget', async () => {
    const data = await fixture();
    const calls: FlaStaticSnapshotRasterizeInput[] = [];
    const rasterizer: FlaStaticSnapshotRasterizer = {
      async rasterize(input) {
        calls.push(input);
        const pngBytes = calls.length === 2
          ? makePngWithTextChunk(
              input.width,
              input.height,
              29,
              FLA_PART_PREVIEW_LIMITS.maxCompositionInputBytes + 1,
            )
          : makePng(input.width, input.height, calls.length * 31);
        return { pngBytes, width: input.width, height: input.height, pixelCount: input.pixelCount };
      },
      cancel: vi.fn(() => true),
      close: vi.fn(),
    };
    const previewService = new FlaPartPreviewService({
      flaImportService: data.flaImportService,
      renderSession: data.renderSession as never,
      rasterizer,
      wallTimeMs: 10_000,
    });
    const previewRequest = { ...request(1), target: { renderTargetId: data.targetId, selectedFrameIndex: 0 } };

    const response = await previewService.preview(previewRequest);

    expect(response.ok).toBe(true);
    if (!response.ok || response.capability !== 'WHOLE_IMAGE_ONLY') {
      throw new Error('Expected bounded PNG output to fall back to the native whole image');
    }
    expect(response.reason).toContain('independent PNGs exceed the bounded reassembly input budget');
    expect(response.partPreviews).toEqual([]);
    expect(response.reassembledPreview).toBeNull();
    expect(response.metrics.unitCount).toBe(0);
    expect(response.metrics.rasterCount).toBe(2);
    expect(calls).toHaveLength(2);
    expect(previewService.getPreparedBatch(response.planId, SESSION_ID, 1)).toBeNull();
    expect(heldPartPreviewStorage(previewService)).toMatchObject({ parts: null, partPngBytes: 0 });
    previewService.close();
  }, 15_000);

  it('keeps an open EditorProjectStore snapshot unchanged after success, cancellation, and failure', async () => {
    const projectStore = new EditorProjectStore();
    const project = migrateProject(exampleProject);
    projectStore.open('D:\\PandaStage-Acceptance\\issue906-f1-02-project-fixture', project);
    projectStore.updateProject({ ...project, name: `${project.name} with a pending edit` });
    const before = projectStateSnapshot(projectStore);
    expect(before).toMatchObject({
      projectInstanceId: 1,
      revision: 1,
      dirty: true,
      historyUndoCount: 1,
      historyRedoCount: 0,
      characterCount: 1,
      assetCount: 4,
      imageAssetCount: 3,
    });

    const data = await fixture();
    const rasterCounter = { count: 0, cancellationReject: null as ((error: Error) => void) | null };
    const rasterizer: FlaStaticSnapshotRasterizer = {
      rasterize(input) {
        rasterCounter.count += 1;
        if (rasterCounter.count === 5) {
          return new Promise((_resolve, reject) => { rasterCounter.cancellationReject = reject; });
        }
        const pngBytes = makePng(input.width, input.height, rasterCounter.count * 19);
        return Promise.resolve({ pngBytes, width: input.width, height: input.height, pixelCount: input.pixelCount });
      },
      cancel() {
        rasterCounter.cancellationReject?.(new Error('controlled project-state cancellation'));
        return true;
      },
      close() {},
    };
    const previewService = new FlaPartPreviewService({
      flaImportService: data.flaImportService,
      renderSession: data.renderSession as never,
      rasterizer,
      wallTimeMs: 10_000,
    });
    const sourceHashBefore = createHash('sha256').update(data.bytes).digest('hex');

    const success = await previewService.preview({
      ...request(1),
      target: { renderTargetId: data.targetId, selectedFrameIndex: 0 },
    });
    expect(success.ok).toBe(true);
    if (!success.ok || success.capability !== 'EDITABLE_PARTS_READY') {
      throw new Error('Expected a completed editable preview for the project-state fixture');
    }
    expect(previewService.getPreparedBatch(success.planId, SESSION_ID, 1)).not.toBeNull();
    expect(projectStateSnapshot(projectStore)).toEqual(before);
    expect(previewService.cancel(cancelRequest(success.requestId))).toMatchObject({
      accepted: true,
      cancelledRequestId: success.requestId,
    });
    expect(previewService.getPlan(success.planId, SESSION_ID, 1)).toBeNull();
    expect(previewService.getPreparedBatch(success.planId, SESSION_ID, 1)).toBeNull();
    expect(heldPartPreviewStorage(previewService)).toBeNull();
    expect(projectStateSnapshot(projectStore)).toEqual(before);

    const cancellationRequest = {
      ...request(2),
      target: { renderTargetId: data.targetId, selectedFrameIndex: 0 },
    };
    const cancellationPromise = previewService.preview(cancellationRequest);
    await vi.waitFor(() => expect(rasterCounter.cancellationReject).not.toBeNull());
    expect(previewService.cancel({
      format: 'fla-part-preview-cancel',
      version: 1,
      requestId: cancellationRequest.requestId,
      sessionId: SESSION_ID,
      generation: 2,
    }).accepted).toBe(true);
    const cancelled = await cancellationPromise;
    expect(cancelled.ok).toBe(false);
    if (cancelled.ok) throw new Error('Expected cancelled preview');
    expect(cancelled.error.code).toBe('RENDER_CANCELLED');
    expect(heldPartPreviewStorage(previewService)).toBeNull();
    expect(projectStateSnapshot(projectStore)).toEqual(before);
    previewService.close();

    const failureData = await fixture(true, 'visible-text');
    const failedPreview = rasterizerFor(failureData).previewService;
    const failure = await failedPreview.preview({
      ...request(1),
      target: { renderTargetId: failureData.targetId, selectedFrameIndex: 0 },
    });
    expect(failure.ok).toBe(false);
    if (failure.ok) throw new Error('Expected unsupported-content failure');
    expect(failure.error.code).toBe('UNSUPPORTED_SOURCE');
    expect(projectStateSnapshot(projectStore)).toEqual(before);
    expect(createHash('sha256').update(data.bytes).digest('hex')).toBe(sourceHashBefore);
    failedPreview.close();
  });

  it('rejects stale generations and cancels the active sandbox raster job', async () => {
    const data = await fixture();
    const pending = new Map<string, (error: Error) => void>();
    const cancelled: string[] = [];
    const rasterizer: FlaStaticSnapshotRasterizer = {
      rasterize(input) {
        return new Promise((_resolve, reject) => pending.set(input.requestId, reject));
      },
      cancel(requestId) {
        cancelled.push(requestId);
        pending.get(requestId)?.(new Error('cancelled by test'));
        return true;
      },
      close() {},
    };
    const previewService = new FlaPartPreviewService({
      flaImportService: data.flaImportService,
      renderSession: data.renderSession as never,
      rasterizer,
      wallTimeMs: 10_000,
    });
    const firstRequest = { ...request(1), target: { renderTargetId: data.targetId, selectedFrameIndex: 0 } };
    const firstPromise = previewService.preview(firstRequest);
    await vi.waitFor(() => expect(pending.size).toBe(1));
    const cancelResult = previewService.cancel({
      format: 'fla-part-preview-cancel',
      version: 1,
      requestId: firstRequest.requestId,
      sessionId: SESSION_ID,
      generation: 1,
    });
    expect(cancelResult.accepted).toBe(true);
    const cancelledResponse = await firstPromise;
    expect(cancelledResponse.ok).toBe(false);
    if (cancelledResponse.ok) throw new Error('Expected cancelled response');
    expect(cancelledResponse.status).toBe('CANCELLED');
    expect(cancelled).toHaveLength(1);
    expect(heldPartPreviewStorage(previewService)).toBeNull();

    const stale = await previewService.preview(firstRequest);
    expect(stale.ok).toBe(false);
    if (stale.ok) throw new Error('Expected stale generation rejection');
    expect(stale.error.code).toBe('STALE_GENERATION');
    previewService.close();
  });

  it('cancels a completed held batch by request ID alone and rejects stale identity', async () => {
    const data = await fixture();
    const { previewService } = rasterizerFor(data);
    const previewRequest = { ...request(1), target: { renderTargetId: data.targetId, selectedFrameIndex: 0 } };
    const response = await previewService.preview(previewRequest);
    expect(response.ok).toBe(true);
    if (!response.ok || response.capability !== 'EDITABLE_PARTS_READY') {
      throw new Error('Expected a completed editable preview');
    }
    expect(previewService.getPreparedBatch(response.planId, SESSION_ID, 1)).not.toBeNull();

    expect(previewService.cancel(cancelRequest('90700000-0000-4000-8000-000000000001', SESSION_ID, 1)))
      .toEqual({ accepted: false });
    expect(previewService.cancel(cancelRequest(previewRequest.requestId, SESSION_ID, 2)))
      .toEqual({ accepted: false });
    expect(previewService.cancel(cancelRequest(previewRequest.requestId, SECOND_SESSION_ID, 1)))
      .toEqual({ accepted: false });
    expect(previewService.getPreparedBatch(response.planId, SESSION_ID, 1)).not.toBeNull();

    expect(previewService.cancel(cancelRequest(previewRequest.requestId))).toEqual({
      accepted: true,
      cancelledRequestId: previewRequest.requestId,
    });
    expect(previewService.getPlan(response.planId, SESSION_ID, 1)).toBeNull();
    expect(previewService.getPreparedBatch(response.planId, SESSION_ID, 1)).toBeNull();
    expect(heldPartPreviewStorage(previewService)).toBeNull();
    expect(previewService.cancel(cancelRequest(previewRequest.requestId))).toEqual({ accepted: false });
    previewService.close();
  });

  it('replaces completed batches on same-session and cross-session previews', async () => {
    const data = await fixture();
    data.registerSession(SECOND_SESSION_ID);
    const { calls, previewService } = rasterizerFor(data);

    const firstRequest = { ...request(1), target: { renderTargetId: data.targetId, selectedFrameIndex: 0 } };
    const first = await previewService.preview(firstRequest);
    expect(first.ok).toBe(true);
    if (!first.ok || first.capability !== 'EDITABLE_PARTS_READY') throw new Error('Expected first Part batch');
    expect(previewService.getPreparedBatch(first.planId, SESSION_ID, 1)).not.toBeNull();

    const sameSessionRequest = { ...request(2), target: firstRequest.target };
    const sameSession = await previewService.preview(sameSessionRequest);
    expect(sameSession.ok).toBe(true);
    if (!sameSession.ok || sameSession.capability !== 'EDITABLE_PARTS_READY') {
      throw new Error('Expected same-session replacement Part batch');
    }
    expect(previewService.getPreparedBatch(first.planId, SESSION_ID, 1)).toBeNull();
    expect(previewService.getPreparedBatch(sameSession.planId, SESSION_ID, 2)).not.toBeNull();
    expect(heldPartPreviewStorage(previewService)?.parts).toHaveLength(2);

    const crossSessionRequest = {
      ...request(1, SECOND_SESSION_ID, '90700000-0000-4000-8000-000000000002'),
      target: firstRequest.target,
    };
    const crossSession = await previewService.preview(crossSessionRequest);
    expect(crossSession.ok).toBe(true);
    if (!crossSession.ok || crossSession.capability !== 'EDITABLE_PARTS_READY') {
      throw new Error('Expected cross-session replacement Part batch');
    }
    expect(previewService.getPreparedBatch(sameSession.planId, SESSION_ID, 2)).toBeNull();
    expect(previewService.getPreparedBatch(crossSession.planId, SECOND_SESSION_ID, 1)?.identity).toMatchObject({
      requestId: crossSessionRequest.requestId,
      sessionId: SECOND_SESSION_ID,
      generation: 1,
    });
    expect(heldPartPreviewStorage(previewService)?.parts).toHaveLength(2);
    expect(calls).toHaveLength(12);
    previewService.close();
    expect(heldPartPreviewStorage(previewService)).toBeNull();
  });

  it('replaces an active generation across Scene targets and ignores its late raster result', async () => {
    const data = await fixture(true, 'parts', true);
    if (!data.secondTargetId) throw new Error('Expected second Scene target');
    const staleRaster = { complete: null as (() => void) | null };
    const cancelled: string[] = [];
    const rasterizer: FlaStaticSnapshotRasterizer = {
      rasterize(input) {
        if (!staleRaster.complete) {
          return new Promise((resolve) => {
            staleRaster.complete = () => resolve({
              pngBytes: makePng(input.width, input.height, 11),
              width: input.width,
              height: input.height,
              pixelCount: input.pixelCount,
            });
          });
        }
        const pngBytes = makePng(input.width, input.height, 17);
        return Promise.resolve({ pngBytes, width: input.width, height: input.height, pixelCount: input.pixelCount });
      },
      cancel(requestId) {
        cancelled.push(requestId);
        return true;
      },
      close() {},
    };
    const previewService = new FlaPartPreviewService({
      flaImportService: data.flaImportService,
      renderSession: data.renderSession as never,
      rasterizer,
      wallTimeMs: 10_000,
    });
    const firstRequest = { ...request(1), target: { renderTargetId: data.targetId, selectedFrameIndex: 0 } };
    const stalePromise = previewService.preview(firstRequest);
    await vi.waitFor(() => expect(staleRaster.complete).not.toBeNull());

    const replacementRequest = {
      ...request(2),
      target: { renderTargetId: data.secondTargetId, selectedFrameIndex: 0 },
    };
    const replacementPromise = previewService.preview(replacementRequest);
    const staleResponse = await stalePromise;
    expect(staleResponse.ok).toBe(false);
    if (staleResponse.ok) throw new Error('Expected superseded Scene response');
    expect(staleResponse.error.code).toBe('RENDER_CANCELLED');
    expect(cancelled).toHaveLength(1);

    const replacement = await replacementPromise;
    expect(replacement.ok).toBe(true);
    if (!replacement.ok) throw new Error('Expected replacement preview');
    expect(previewService.getPlan(replacement.planId, SESSION_ID, 2)).not.toBeNull();
    expect(previewService.getPreparedBatch(replacement.planId, SESSION_ID, 2)).not.toBeNull();

    staleRaster.complete?.();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(previewService.getPlan(replacement.planId, SESSION_ID, 2)).not.toBeNull();
    expect(previewService.getPreparedBatch(replacement.planId, SESSION_ID, 2)).not.toBeNull();
    previewService.close();
  });

  it('settles a batch timeout and cancels its current raster request', async () => {
    const data = await fixture();
    const pending = new Map<string, (error: Error) => void>();
    const cancelled: string[] = [];
    const rasterizer: FlaStaticSnapshotRasterizer = {
      rasterize(input) {
        return new Promise((_resolve, reject) => pending.set(input.requestId, reject));
      },
      cancel(requestId) {
        cancelled.push(requestId);
        pending.get(requestId)?.(new Error('cancelled by timeout'));
        return true;
      },
      close() {},
    };
    const previewService = new FlaPartPreviewService({
      flaImportService: data.flaImportService,
      renderSession: data.renderSession as never,
      rasterizer,
      wallTimeMs: 30,
    });
    const previewRequest = { ...request(1), target: { renderTargetId: data.targetId, selectedFrameIndex: 0 } };

    const response = await previewService.preview(previewRequest);

    expect(response.ok).toBe(false);
    if (response.ok) throw new Error('Expected timeout response');
    expect(response.error.code).toBe('RENDER_TIMEOUT');
    expect(cancelled).toHaveLength(1);
    expect(heldPartPreviewStorage(previewService)).toBeNull();
    previewService.close();
  });

  it('expires the Main-held plan', async () => {
    const data = await fixture();
    let now = new Date('2026-10-31T00:00:00.000Z');
    const service = new FlaPartPreviewService({
      flaImportService: data.flaImportService,
      renderSession: data.renderSession as never,
      rasterizer: {
        async rasterize(input) {
          const pngBytes = makePng(input.width, input.height, 7);
          return { pngBytes, width: input.width, height: input.height, pixelCount: input.pixelCount };
        },
        cancel: vi.fn(() => true),
        close() {},
      },
      now: () => now,
      wallTimeMs: 10_000,
    });
    const previewRequest = { ...request(1), target: { renderTargetId: data.targetId, selectedFrameIndex: 0 } };
    const response = await service.preview(previewRequest);
    expect(response.ok).toBe(true);
    if (!response.ok || response.status !== 'PREVIEW_READY') throw new Error('Expected preview plan');
    if (response.capability !== 'EDITABLE_PARTS_READY') throw new Error('Expected retained Parts');
    expect(service.getPlan(response.planId)).not.toBeNull();
    expect(service.getPreparedBatch(response.planId, SESSION_ID, 1)).not.toBeNull();
    expect(heldPartPreviewStorage(service)?.partPngBytes).toBeGreaterThan(0);
    now = new Date(now.getTime() + 6 * 60_000);
    expect(service.getPlan(response.planId)).toBeNull();
    expect(service.getPreparedBatch(response.planId, SESSION_ID, 1)).toBeNull();
    expect(heldPartPreviewStorage(service)).toBeNull();
    service.close();
  });

  it.each(['inspection-session release', 'project context change', 'service close'] as const)(
    'releases the Main-held Part PNG bytes on %s',
    async (invalidation) => {
      const data = await fixture();
      const { previewService } = rasterizerFor(data);
      const response = await previewService.preview({
        ...request(1),
        target: { renderTargetId: data.targetId, selectedFrameIndex: 0 },
      });
      expect(response.ok).toBe(true);
      if (!response.ok || response.capability !== 'EDITABLE_PARTS_READY') {
        throw new Error('Expected a completed editable Part batch');
      }
      expect(previewService.getPreparedBatch(response.planId, SESSION_ID, 1)).not.toBeNull();
      expect(heldPartPreviewStorage(previewService)?.partPngBytes).toBeGreaterThan(0);

      if (invalidation === 'inspection-session release') previewService.invalidateSession(SESSION_ID);
      else if (invalidation === 'project context change') previewService.invalidateAll();
      else previewService.close();

      expect(previewService.getPlan(response.planId, SESSION_ID, 1)).toBeNull();
      expect(previewService.getPreparedBatch(response.planId, SESSION_ID, 1)).toBeNull();
      expect(heldPartPreviewStorage(previewService)).toBeNull();
      previewService.close();
    },
  );
});
