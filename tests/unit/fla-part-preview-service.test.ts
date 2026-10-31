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
import { FlaPartPreviewRequestSchema } from '../../src/shared/fla-part-preview-api';

const SESSION_ID = '90600000-0000-4000-8000-000000000001';

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

async function buildTwoPartFla(
  sceneKind: 'parts' | 'visible-text' | 'empty-mask' = 'parts',
  includeSecondScene = false,
): Promise<Uint8Array> {
  const sceneLayers = sceneKind === 'parts'
    ? `<DOMLayer name="Parts"><frames>
        <DOMFrame index="0" duration="1"><elements>
          <DOMSymbolInstance libraryItemName="MyGraphic" symbolType="graphic" loop="loop" firstFrame="0">
            <matrix><Matrix a="1" b="0" c="0" d="1" tx="0" ty="0"/></matrix>
          </DOMSymbolInstance>
          <DOMSymbolInstance libraryItemName="MyGraphic" symbolType="graphic" loop="loop" firstFrame="0">
            <matrix><Matrix a="1" b="0" c="0" d="1" tx="10" ty="2"/></matrix>
          </DOMSymbolInstance>
        </elements></DOMFrame>
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
  const graphic = `<?xml version="1.0" encoding="UTF-8"?>
<DOMSymbolItem name="MyGraphic" xmlns="http://ns.adobe.com/xfl/2008/">
  <timelines><DOMTimeline name="MyGraphic"><layers><DOMLayer name="Artwork"><frames>
    <DOMFrame index="0" duration="1"><elements><DOMGroup><members><DOMShape>
      <fills><FillStyle index="1"><SolidColor color="#f03a55" alpha="1"/></FillStyle></fills>
      <edges><Edge fillStyle1="1" cubics="!0 0|12 0[6 6 12 12 12 12|0 0"/></edges>
    </DOMShape></members></DOMGroup></elements></DOMFrame>
  </frames></DOMLayer></layers></DOMTimeline></timelines>
</DOMSymbolItem>`;
  const zip = new JSZip();
  zip.file('DOMDocument.xml', document);
  zip.file('LIBRARY/MyGraphic.xml', graphic);
  return zip.generateAsync({ type: 'uint8array' });
}

async function fixture(
  withAddresses = true,
  sceneKind: 'parts' | 'visible-text' | 'empty-mask' = 'parts',
  includeSecondScene = false,
) {
  const bytes = await buildTwoPartFla(sceneKind, includeSecondScene);
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
      media: [],
    },
    originalSourceSha256: rawSha256,
    sourceBytes: bytes,
  };
  const flaImportService = {
    getSession: vi.fn((sessionId: string) => sessionId === SESSION_ID ? inspectionSession : null),
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
  const secondScene = displaySource.sceneTimelines[1];
  return {
    bytes,
    rawSha256,
    displaySource,
    inspectionSession,
    flaImportService,
    renderSession,
    targetId,
    secondTargetId: secondScene
      ? stableRenderTargetId(bytes, `scene\u0000timeline\u0000${secondScene.index}`)
      : null,
  };
}

function request(generation = 1) {
  return FlaPartPreviewRequestSchema.parse({
    format: 'fla-part-preview',
    version: 1,
    requestId: `90600000-0000-4000-8000-${String(generation).padStart(12, '0')}`,
    sessionId: SESSION_ID,
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
    previewService.close();
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

    const stale = await previewService.preview(firstRequest);
    expect(stale.ok).toBe(false);
    if (stale.ok) throw new Error('Expected stale generation rejection');
    expect(stale.error.code).toBe('STALE_GENERATION');
    previewService.close();
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

    staleRaster.complete?.();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(previewService.getPlan(replacement.planId, SESSION_ID, 2)).not.toBeNull();
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
    expect(service.getPlan(response.planId)).not.toBeNull();
    now = new Date(now.getTime() + 6 * 60_000);
    expect(service.getPlan(response.planId)).toBeNull();
    service.close();
  });
});
