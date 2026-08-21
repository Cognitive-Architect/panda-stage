/**
 * V2-R1 Static Snapshot — render session orchestration tests (R1-B / R1-D).
 *
 * Exercises the Main-side orchestrator without Electron: a fake rasterizer
 * and a fake source lookup stand in for the sandboxed BrowserWindow and the
 * FLA inspection session. Covers catalog discovery, preview success + confirmed
 * preview bookkeeping, latest-request-wins cancellation, explicit cancel,
 * wall-clock timeout, and session-not-found guards.
 */

import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  FlaStaticSnapshotRenderSession,
  type FlaStaticSnapshotRasterizer,
  type FlaStaticSnapshotSource,
  type FlaStaticSnapshotSourceLookup,
} from '../../src/main/services/fla-static-snapshot-render-session';
import {
  FlaStaticSnapshotCancelRequestSchema,
  FlaStaticSnapshotPreviewRequestSchema,
  type FlaRenderTarget,
} from '../../src/shared/fla-static-snapshot-api';

const SESSION_ID = '27000000-0000-4000-8000-0000000000a1';
const PREVIEW_A = '27000000-0000-4000-8000-0000000000a2';
const PREVIEW_B = '27000000-0000-4000-8000-0000000000a3';
const SOURCE = { basename: 'scene.fla', sha256: 'a'.repeat(64) };

function pngBytes(width: number, height: number): Uint8Array {
  // Minimal valid PNG (8x8 RGBA) — validatePngEncodedImage only needs a
  // decodable PNG of the declared dimensions; the pixel content is irrelevant.
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const idat = Buffer.from([0x78, 0x9c, 0x63, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01]);
  const chunk = (type: string, data: Buffer): Buffer => {
    const typeBytes = Buffer.from(type, 'ascii');
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    typeBytes.copy(out, 4);
    data.copy(out, 8);
    return out;
  };
  return new Uint8Array(
    Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]),
  );
}

const FIXED_PNG = pngBytes(8, 8);
const FIXED_PNG_SHA256 = createHash('sha256').update(Buffer.from(FIXED_PNG)).digest('hex');

/** Build a minimal but real FLA (ZIP) with one graphic symbol + a scene shape. */
async function buildMinimalFla(): Promise<Uint8Array> {
  const docXml = `<?xml version="1.0" encoding="UTF-8"?>
<DOMDocument width="550" height="400" xmlns="http://ns.adobe.com/xfl/2008/">
  <timelines>
    <DOMTimeline name="1">
      <layers>
        <DOMLayer>
          <frames>
            <DOMFrame index="0">
              <elements>
                <DOMGroup>
                  <members>
                    <DOMShape>
                      <fills><FillStyle index="0"><SolidColor color="#00ff00" alpha="1"/></FillStyle></fills>
                      <edges><Edge cubics="!0 0|200 0[100 100 200 200 200 200]/"/></edges>
                    </DOMShape>
                  </members>
                </DOMGroup>
              </elements>
            </DOMFrame>
          </frames>
        </DOMLayer>
      </layers>
    </DOMTimeline>
  </timelines>
</DOMDocument>`;
  const libXml = `<?xml version="1.0" encoding="UTF-8"?>
<DOMSymbolItem name="MyGraphic" xmlns="http://ns.adobe.com/xfl/2008/">
  <timelines>
    <DOMTimeline name="1">
      <layers>
        <DOMLayer>
          <frames>
            <DOMFrame index="0">
              <elements>
                <DOMGroup>
                  <members>
                    <DOMShape>
                      <matrix><Matrix a="1" b="0" c="0" d="1" tx="0" ty="0"/></matrix>
                      <fills><FillStyle index="0"><SolidColor color="#ff0000" alpha="1"/></FillStyle></fills>
                      <edges><Edge cubics="!0 0|100 0[50 50 100 100 100 0]/"/></edges>
                    </DOMShape>
                  </members>
                </DOMGroup>
              </elements>
            </DOMFrame>
          </frames>
        </DOMLayer>
      </layers>
    </DOMTimeline>
  </timelines>
</DOMSymbolItem>`;
  const zip = new JSZip();
  zip.file('DOMDocument.xml', docXml);
  zip.file('LIBRARY/MyGraphic.xml', libXml);
  return zip.generateAsync({ type: 'uint8array' });
}

function sourceLookup(bytes: Uint8Array): FlaStaticSnapshotSourceLookup {
  return {
    getSource: (id) =>
      id === SESSION_ID ? ({ bytes, basename: SOURCE.basename, sha256: SOURCE.sha256 } as FlaStaticSnapshotSource) : null,
  };
}

function resolvingRasterizer(): FlaStaticSnapshotRasterizer {
  return {
    async rasterize() {
      return { pngBytes: FIXED_PNG, width: 8, height: 8, pixelCount: 64 };
    },
    close() {},
  };
}

function stallingRasterizer(): FlaStaticSnapshotRasterizer {
  return {
    // Never resolves within the test's wall-clock budget.
    rasterize() {
      return new Promise(() => undefined);
    },
    close() {},
  };
}

function firstTarget(entries: ReadonlyArray<{ target: FlaRenderTarget }>): FlaRenderTarget {
  return entries[0]!.target;
}

describe('FlaStaticSnapshotRenderSession', () => {
  it('discovers renderable targets from a zero-raster FLA', async () => {
    const session = new FlaStaticSnapshotRenderSession({
      rasterizer: resolvingRasterizer(),
      sourceLookup: sourceLookup(await buildMinimalFla()),
    });
    const catalog = await session.catalog(SESSION_ID);
    expect(catalog.ok).toBe(true);
    if (!catalog.ok) throw new Error('catalog should succeed');
    expect(catalog.entries.length).toBeGreaterThan(0);
    expect(catalog.summary.length).toBeGreaterThan(0);
    session.close();
  });

  it('records a confirmed, latest-accepted preview on success', async () => {
    const fla = await buildMinimalFla();
    const session = new FlaStaticSnapshotRenderSession({
      rasterizer: resolvingRasterizer(),
      sourceLookup: sourceLookup(fla),
    });
    const catalog = await session.catalog(SESSION_ID);
    if (!catalog.ok) throw new Error('catalog should succeed');
    const target = firstTarget(catalog.entries);
    const response = await session.preview(
      FlaStaticSnapshotPreviewRequestSchema.parse({
        format: 'fla-static-snapshot-preview',
        version: 1,
        requestId: PREVIEW_A,
        sessionId: SESSION_ID,
        target,
      }),
    );
    expect(response.ok).toBe(true);
    if (!response.ok) throw new Error('preview should succeed');
    expect(response.requestId).toBe(PREVIEW_A);
    expect(response.sha256).toBe(FIXED_PNG_SHA256);
    expect(session.isLatestAcceptedPreview(SESSION_ID, PREVIEW_A)).toBe(true);
    expect(session.getConfirmedPreview(PREVIEW_A)?.pngBytes.byteLength).toBe(FIXED_PNG.length);
    session.close();
  });

  it('treats the most recent preview as the latest accepted (latest-request-wins)', async () => {
    const fla = await buildMinimalFla();
    const session = new FlaStaticSnapshotRenderSession({
      rasterizer: resolvingRasterizer(),
      sourceLookup: sourceLookup(fla),
    });
    const catalog = await session.catalog(SESSION_ID);
    if (!catalog.ok) throw new Error('catalog should succeed');
    const target = firstTarget(catalog.entries);
    await session.preview(
      FlaStaticSnapshotPreviewRequestSchema.parse({
        format: 'fla-static-snapshot-preview',
        version: 1,
        requestId: PREVIEW_A,
        sessionId: SESSION_ID,
        target,
      }),
    );
    await session.preview(
      FlaStaticSnapshotPreviewRequestSchema.parse({
        format: 'fla-static-snapshot-preview',
        version: 1,
        requestId: PREVIEW_B,
        sessionId: SESSION_ID,
        target,
      }),
    );
    // Both confirmed previews are still retrievable, but only B is "latest".
    expect(session.isLatestAcceptedPreview(SESSION_ID, PREVIEW_A)).toBe(false);
    expect(session.isLatestAcceptedPreview(SESSION_ID, PREVIEW_B)).toBe(true);
    expect(session.getConfirmedPreview(PREVIEW_A)).not.toBeNull();
    session.close();
  });

  it('resolves a cancelled preview with RENDER_CANCELLED', async () => {
    const fla = await buildMinimalFla();
    const session = new FlaStaticSnapshotRenderSession({
      rasterizer: resolvingRasterizer(),
      sourceLookup: sourceLookup(fla),
    });
    const catalog = await session.catalog(SESSION_ID);
    if (!catalog.ok) throw new Error('catalog should succeed');
    const target = firstTarget(catalog.entries);
    const pending = session.preview(
      FlaStaticSnapshotPreviewRequestSchema.parse({
        format: 'fla-static-snapshot-preview',
        version: 1,
        requestId: PREVIEW_A,
        sessionId: SESSION_ID,
        target,
      }),
    );
    const cancel = session.cancel(
      FlaStaticSnapshotCancelRequestSchema.parse({
        format: 'fla-static-snapshot-cancel',
        version: 1,
        sessionId: SESSION_ID,
      }),
    );
    expect(cancel.accepted).toBe(true);
    const response = await pending;
    expect(response.ok).toBe(false);
    if (response.ok) throw new Error('cancelled preview must fail');
    expect(response.error.code).toBe('RENDER_CANCELLED');
    session.close();
  });

  it('times out a preview that exceeds the wall-clock budget', async () => {
    const fla = await buildMinimalFla();
    const session = new FlaStaticSnapshotRenderSession({
      rasterizer: stallingRasterizer(),
      sourceLookup: sourceLookup(fla),
      wallTimeMs: 10,
    });
    const catalog = await session.catalog(SESSION_ID);
    if (!catalog.ok) throw new Error('catalog should succeed');
    const target = firstTarget(catalog.entries);
    const response = await session.preview(
      FlaStaticSnapshotPreviewRequestSchema.parse({
        format: 'fla-static-snapshot-preview',
        version: 1,
        requestId: PREVIEW_A,
        sessionId: SESSION_ID,
        target,
      }),
    );
    expect(response.ok).toBe(false);
    if (response.ok) throw new Error('timed-out preview must fail');
    expect(response.error.code).toBe('RENDER_TIMEOUT');
    session.close();
  });

  it('rejects catalog/preview for an unknown session', async () => {
    const session = new FlaStaticSnapshotRenderSession({
      rasterizer: resolvingRasterizer(),
      sourceLookup: sourceLookup(await buildMinimalFla()),
    });
    const catalog = await session.catalog('27000000-0000-4000-8000-00000000dead');
    expect(catalog.ok).toBe(false);
    if (catalog.ok) throw new Error('catalog must fail');
    expect(catalog.code).toBe('SESSION_NOT_FOUND');
    const unknown = await session.preview(
      FlaStaticSnapshotPreviewRequestSchema.parse({
        format: 'fla-static-snapshot-preview',
        version: 1,
        requestId: PREVIEW_A,
        sessionId: '27000000-0000-4000-8000-00000000dead',
        target: {
          renderTargetId: 'fla-render-target-deadbeef0001',
          kind: 'scene',
          userLabel: 'x',
          frameCount: 1,
          compatibility: ['degraded'],
        },
      }),
    );
    expect(unknown.ok).toBe(false);
    if (unknown.ok) throw new Error('preview must fail');
    expect(unknown.error.code).toBe('SESSION_NOT_FOUND');
    session.close();
  });
});
