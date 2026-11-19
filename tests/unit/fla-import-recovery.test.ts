import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { FlaWorkerStartRequest, FlaWorkerHydrateRequest, FlaBitmapMedia, FlaInspectionIR, AnimationImportIR } from '../../src/shared/fla-import-api';
import { FlaImportService } from '../../src/main/services/FlaImportService';
import type { FlaParserWindowManager } from '../../src/main/windows/fla-parser-window-manager';
import { routeFlaInspection } from '../../src/renderer/fla-import/fla-content-route';

const require = createRequire(import.meta.url);
const { buildNegativeFixtures } = require('../../scripts/fla-c2-safe-recovery-envelope.cjs') as {
  buildNegativeFixtures: () => Promise<readonly {
    id: string;
    expectedState: string;
    bytes: Uint8Array;
  }[]>;
};

const PARSER_COMMIT = '048000ccab67469980b8dedd1fc2b65a02d2b164';

function readUInt32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0) |
    ((bytes[offset + 1] ?? 0) << 8) |
    ((bytes[offset + 2] ?? 0) << 16) |
    ((bytes[offset + 3] ?? 0) << 24)
  ) >>> 0;
}

function writeUInt32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

function makeZip(xml = '<DOMDocument/>'): Uint8Array {
  const name = Buffer.from('DOMDocument.xml', 'utf8');
  const data = Buffer.from(xml, 'utf8');
  const local = Buffer.alloc(30 + name.byteLength + data.byteLength);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(0, 8);
  local.writeUInt32LE(data.byteLength, 14);
  local.writeUInt32LE(data.byteLength, 18);
  local.writeUInt32LE(data.byteLength, 22);
  local.writeUInt16LE(name.byteLength, 26);
  name.copy(local, 30);
  data.copy(local, 30 + name.byteLength);

  const centralOffset = local.byteLength;
  const central = Buffer.alloc(46 + name.byteLength);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(0, 10);
  central.writeUInt32LE(data.byteLength, 16);
  central.writeUInt32LE(data.byteLength, 20);
  central.writeUInt32LE(data.byteLength, 24);
  central.writeUInt16LE(name.byteLength, 28);
  central.writeUInt32LE(0, 42);
  name.copy(central, 46);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.byteLength, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  return Uint8Array.from(Buffer.concat([local, central, eocd]));
}

function patchDeclaredCentralSize(bytes: Uint8Array, delta: number): Uint8Array {
  const copy = Uint8Array.from(bytes);
  const eocd = copy.byteLength - 22;
  const centralOffset = readUInt32(copy, eocd + 16);
  writeUInt32(copy, eocd + 12, eocd - centralOffset + delta);
  return copy;
}

function makeTwoDuplicateLocalRecordsZip(xml = '<DOMDocument/>'): {
  bytes: Uint8Array;
  localRecordBytes: number;
  centralOffset: number;
} {
  const base = Buffer.from(makeZip(xml));
  const eocdOffset = base.byteLength - 22;
  const centralOffset = readUInt32(base, eocdOffset + 16);
  const localRecord = base.subarray(0, centralOffset);
  const centralDirectory = base.subarray(centralOffset, eocdOffset);
  const eocd = Buffer.from(base.subarray(eocdOffset));
  const combined = Buffer.concat([
    localRecord,
    localRecord,
    localRecord,
    centralDirectory,
    eocd,
  ]);
  const combinedEocdOffset = combined.byteLength - 22;
  const combinedCentralOffset = localRecord.byteLength * 3;
  writeUInt32(
    combined,
    combinedEocdOffset + 12,
    centralDirectory.byteLength + (2 * localRecord.byteLength) - 2,
  );
  writeUInt32(combined, combinedEocdOffset + 16, combinedCentralOffset);
  return {
    bytes: Uint8Array.from(combined),
    localRecordBytes: localRecord.byteLength,
    centralOffset: combinedCentralOffset,
  };
}

function sourceHash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function parserResult(request: FlaWorkerStartRequest): AnimationImportIR {
  return {
    source: {
      format: 'fla',
      basename: request.source.basename,
      byteLength: request.source.byteLength,
      sha256: request.source.sha256,
      parser: {
        package: 'lifeart/fla-viewer',
        entrypoint: 'FLAParser.parse',
        commit: PARSER_COMMIT,
      },
    },
    document: { width: 1, height: 1, frameRate: 24, backgroundColor: '#fff' },
    media: [],
    timelines: [],
    compatibility: [],
    summary: { placedInstanceCount: 0, libraryOnlyMediaCount: 0 },
  };
}

function makeHarness() {
  const inspect = vi.fn(async (request: FlaWorkerStartRequest): Promise<FlaInspectionIR> => parserResult(request));
  const hydrate = vi.fn<(request: FlaWorkerHydrateRequest) => Promise<FlaBitmapMedia>>();
  const cancel = vi.fn();
  const manager = { inspect, hydrate, cancel } as unknown as FlaParserWindowManager;
  return { inspect, hydrate, cancel, service: new FlaImportService(manager) };
}

async function withSource<T>(bytes: Uint8Array, action: (sourcePath: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-stage-c3-recovery-'));
  const sourcePath = path.join(root, 'sample.fla');
  try {
    await writeFile(sourcePath, bytes);
    return await action(sourcePath);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('FLA C3 production recovery entry path', () => {
  it('keeps strict-valid input on the normal parser path without recovery', async () => {
    const original = makeZip();
    const { service, inspect } = makeHarness();
    const response = await withSource(original, (sourcePath) =>
      service.inspectSource(sourcePath, crypto.randomUUID()),
    );

    expect(response.ok).toBe(true);
    expect(response.ok && response.trace).toMatchObject({
      ingestMode: 'strict',
      recoveryApplied: false,
      originalStrictResult: 'pass',
      classifierState: 'STRICT_VALID',
      recoveryAttempted: false,
      postNormalizationStrictResult: 'not-run',
      parserResult: 'success',
    });
    expect(inspect).toHaveBeenCalledTimes(1);
  });

  it('normalizes only the approved EOCD field in memory and revalidates before parsing', async () => {
    const original = patchDeclaredCentralSize(makeZip(), 54);
    const before = Uint8Array.from(original);
    const beforeHash = sourceHash(before);
    const { service, inspect } = makeHarness();
    const response = await withSource(original, async (sourcePath) => {
      const result = await service.inspectSource(sourcePath, crypto.randomUUID());
      expect(sourceHash(await readFile(sourcePath))).toBe(beforeHash);
      return result;
    });

    expect(response.ok).toBe(true);
    expect(response.ok && response.trace).toMatchObject({
      ingestMode: 'compatibility-recovered',
      recoveryApplied: true,
      originalStrictResult: 'reject',
      classifierState: 'RECOVERY_CANDIDATE',
      recoveryAttempted: true,
      postNormalizationStrictResult: 'pass',
      parserResult: 'success',
      recoveryReasonCode: 'RECOVERY_EOCD_SIZE_DECLARATION_ONLY',
    });
    expect(inspect).toHaveBeenCalledTimes(1);
    const request = inspect.mock.calls[0]?.[0];
    expect(request).toBeDefined();
    expect(request?.source.bytes).not.toEqual(before);
    expect(request && sourceHash(request.source.bytes)).not.toBe(beforeHash);
    if (!response.ok) throw new Error('Expected the recovered source to be inspected.');
    const session = service.getSession(response.sessionId);
    expect(session?.originalSourceSha256).toBe(beforeHash);
    expect(session?.ir.source.sha256).toBe(request?.source.sha256);
    const changedOffsets = request
      ? Array.from(request.source.bytes).flatMap((value, index) =>
          value === before[index] ? [] : [index],
        )
      : [];
    expect(changedOffsets).toEqual([before.length - 10]);
    expect(changedOffsets.every((offset) => offset >= before.length - 10 && offset < before.length - 6)).toBe(true);
  });

  it('recovers two exact duplicate local records only for the measured size signature', async () => {
    const original = makeTwoDuplicateLocalRecordsZip().bytes;
    const before = Uint8Array.from(original);
    const beforeHash = sourceHash(before);
    const { service, inspect } = makeHarness();
    const response = await withSource(original, async (sourcePath) => {
      const result = await service.inspectSource(sourcePath, crypto.randomUUID());
      expect(sourceHash(await readFile(sourcePath))).toBe(beforeHash);
      return result;
    });

    expect(response.ok).toBe(true);
    expect(response.ok && response.trace).toMatchObject({
      ingestMode: 'compatibility-recovered',
      recoveryApplied: true,
      originalStrictResult: 'reject',
      classifierState: 'RECOVERY_CANDIDATE',
      recoveryAttempted: true,
      postNormalizationStrictResult: 'pass',
      parserResult: 'success',
      recoveryReasonCode: 'RECOVERY_EOCD_SIZE_DECLARATION_ONLY',
    });
    expect(response.ok && response.trace?.classifierReasonCodes).toContain(
      'RECOVERY_DUPLICATE_LOCAL_SIZE_SIGNATURE',
    );
    expect(response.ok && response.trace?.classifierReasonCodes).toContain(
      'EXACT_DUPLICATE_LOCAL_RECORD_PROVEN',
    );
    expect(inspect).toHaveBeenCalledTimes(1);
    const request = inspect.mock.calls[0]?.[0];
    expect(request).toBeDefined();
    expect(request?.source.bytes).not.toEqual(before);
    expect(request && sourceHash(request.source.bytes)).not.toBe(beforeHash);
  });

  it('rejects a duplicate local record whose CRC differs from the central entry', async () => {
    const { bytes, localRecordBytes } = makeTwoDuplicateLocalRecordsZip();
    bytes[localRecordBytes + 14] = (bytes[localRecordBytes + 14] ?? 0) ^ 1;
    const { service, inspect } = makeHarness();
    const response = await withSource(bytes, (sourcePath) =>
      service.inspectSource(sourcePath, crypto.randomUUID()),
    );

    expect(response.ok).toBe(false);
    expect(response.ok ? null : response.trace).toMatchObject({
      classifierState: 'REJECT',
      parserResult: 'not-run',
    });
    expect(response.ok ? [] : response.trace?.classifierReasonCodes).toContain(
      'LOCAL_CENTRAL_CRC_MISMATCH',
    );
    expect(inspect).not.toHaveBeenCalled();
  });

  it('rejects a referenced local record whose CRC differs from the central entry', async () => {
    const { bytes, centralOffset } = makeTwoDuplicateLocalRecordsZip();
    bytes[centralOffset + 16] = (bytes[centralOffset + 16] ?? 0) ^ 1;
    const { service, inspect } = makeHarness();
    const response = await withSource(bytes, (sourcePath) =>
      service.inspectSource(sourcePath, crypto.randomUUID()),
    );

    expect(response.ok).toBe(false);
    expect(response.ok ? null : response.trace).toMatchObject({
      classifierState: 'REJECT',
      parserResult: 'not-run',
    });
    expect(response.ok ? [] : response.trace?.classifierReasonCodes).toContain(
      'LOCAL_CENTRAL_CRC_MISMATCH',
    );
    expect(inspect).not.toHaveBeenCalled();
  });

  it('rejects a two-duplicate archive when its size delta is one byte off the measured signature', async () => {
    const { bytes } = makeTwoDuplicateLocalRecordsZip();
    const eocdOffset = bytes.byteLength - 22;
    const actualDelta = readUInt32(bytes, eocdOffset + 12) -
      (eocdOffset - readUInt32(bytes, eocdOffset + 16));
    const original = patchDeclaredCentralSize(bytes, actualDelta + 1);
    const { service, inspect } = makeHarness();
    const response = await withSource(original, (sourcePath) =>
      service.inspectSource(sourcePath, crypto.randomUUID()),
    );

    expect(response.ok).toBe(false);
    expect(response.ok ? null : response.trace).toMatchObject({
      classifierState: 'REJECT',
      parserResult: 'not-run',
    });
    expect(response.ok ? [] : response.trace?.classifierReasonCodes).toContain(
      'RECOVERY_DELTA_NOT_SUPPORTED',
    );
    expect(inspect).not.toHaveBeenCalled();
  });

  it('stops before the parser when post-normalization strict validation fails', async () => {
    const original = patchDeclaredCentralSize(makeZip('<DOMDocument><broken></DOMDocument>'), 54);
    const { service, inspect } = makeHarness();
    const response = await withSource(original, (sourcePath) =>
      service.inspectSource(sourcePath, crypto.randomUUID()),
    );

    expect(response.ok).toBe(false);
    expect(response.ok ? null : response.trace).toMatchObject({
      classifierState: 'RECOVERY_CANDIDATE',
      recoveryAttempted: true,
      recoveryApplied: false,
      postNormalizationStrictResult: 'fail',
      parserResult: 'not-run',
    });
    expect(response.ok ? null : response.diagnostics?.[0]?.userMessage).toContain(
      '原文件没有被修改',
    );
    expect(inspect).not.toHaveBeenCalled();
  });

  it('keeps every C2 negative or ambiguous fixture out of production recovery and parser entry', async () => {
    const fixtures = await buildNegativeFixtures();
    expect(fixtures).toHaveLength(19);
    for (const fixture of fixtures) {
      const { service, inspect } = makeHarness();
      const response = await withSource(fixture.bytes, (sourcePath) =>
        service.inspectSource(sourcePath, crypto.randomUUID()),
      );
      expect(response.ok, fixture.id).toBe(false);
      const trace = response.ok ? undefined : response.trace;
      expect(trace?.classifierState, fixture.id).toBe(fixture.expectedState);
      expect(trace?.classifierState, fixture.id).not.toBe('RECOVERY_CANDIDATE');
      expect(trace?.recoveryApplied, fixture.id).not.toBe(true);
      expect(inspect, fixture.id).not.toHaveBeenCalled();
      expect(routeFlaInspection(response), fixture.id).toBe('blocked');
    }
  });
});

const selectedBitmapMetadata = ['left', 'right', 'broken'].map((directory) => ({
  id: 'fla-media-catalog-' + directory,
  name: directory + '/icon.png',
  sourceReference: directory + '/icon.png',
  bitmapDataReference: null,
  width: 0,
  height: 0,
  sourceFormat: 'png' as const,
}));

function decodedBitmap(bitmap: FlaWorkerHydrateRequest['bitmap'], value: number): FlaBitmapMedia {
  return {
    ...bitmap, width: 8, height: 8,
    payload: {
      mimeType: 'image/png', width: 8, height: 8, bytes: Uint8Array.of(value),
      alpha: { kind: 'opaque', zeroAlphaPixels: 0, partialAlphaPixels: 0 },
    },
  };
}

describe('FLA selected bitmap loading', () => {
  it('shares one selected result between preview and commit and isolates a failed item', async () => {
    await withSource(makeZip(), async (sourcePath) => {
      const { inspect, hydrate, service } = makeHarness();
      const [left, right, broken] = selectedBitmapMetadata;
      inspect.mockImplementationOnce(async (request) => ({ ...parserResult(request), media: selectedBitmapMetadata }));
      hydrate.mockImplementation(async ({ bitmap }) => {
        if (bitmap.id === broken!.id) throw new Error('Invalid bitmap');
        return decodedBitmap(bitmap, bitmap.id === left!.id ? 1 : 2);
      });
      const response = await service.inspectSource(sourcePath, crypto.randomUUID());
      if (!response.ok) throw new Error(response.error.message);
      const { sessionId } = response;
      expect(inspect).toHaveBeenCalledOnce();
      expect(hydrate).not.toHaveBeenCalled();
      const session = service.getSession(sessionId);
      await expect(service.previewRaster(sessionId, 'fla-media-absent')).resolves.toMatchObject({ ok: false });
      expect(hydrate).not.toHaveBeenCalled();

      const [preview, commit] = await Promise.all([
        service.previewRaster(sessionId, left!.id),
        session?.hydrateMedia?.(left!.id),
      ]);
      expect(hydrate).toHaveBeenCalledOnce();
      expect(hydrate.mock.calls[0]?.[0]).toMatchObject({
        mode: 'hydrate-raster', bitmap: left, allowHrefLeafFallback: false,
      });
      expect(preview).toMatchObject({ ok: true, payload: commit?.payload });
      await expect(service.previewRaster(sessionId, broken!.id)).resolves.toMatchObject({ ok: false });
      expect(hydrate).toHaveBeenCalledTimes(2);
      await expect(service.previewRaster(sessionId, right!.id)).resolves.toMatchObject({
        ok: true, payload: { bytes: Uint8Array.of(2) },
      });
      expect(hydrate).toHaveBeenCalledTimes(3);
      await expect(service.previewRaster(sessionId, broken!.id)).resolves.toMatchObject({ ok: false });
      expect(hydrate).toHaveBeenCalledTimes(4);
      await expect(service.previewRaster(sessionId, left!.id)).resolves.toEqual(preview);
      expect(hydrate).toHaveBeenCalledTimes(4);
      expect(inspect).toHaveBeenCalledOnce();
      expect(service.cancel({ sessionId })).toEqual({ accepted: true });
      expect(service.getSession(sessionId)).toBeNull();
    });
  });

  it('cancels the active item, drops queued items and ignores a late result on source replacement', async () => {
    await withSource(makeZip(), async (sourcePath) => {
      const { inspect, hydrate, cancel, service } = makeHarness();
      inspect.mockImplementation(async (request) => ({ ...parserResult(request), media: selectedBitmapMetadata }));
      const [left, right] = selectedBitmapMetadata;
      let complete!: () => void;
      let started!: () => void;
      const loading = new Promise<void>((resolve) => { started = resolve; });
      hydrate.mockImplementationOnce(({ bitmap }) => new Promise((resolve) => {
        complete = () => resolve(decodedBitmap(bitmap, 1));
        started();
      }));
      const first = await service.inspectSource(sourcePath, crypto.randomUUID());
      if (!first.ok) throw new Error(first.error.message);
      const preview = service.previewRaster(first.sessionId, left!.id);
      await loading;
      const queued = service.previewRaster(first.sessionId, right!.id);
      expect(service.cancel({ sessionId: first.sessionId })).toEqual({ accepted: true });
      expect(cancel).toHaveBeenCalledWith(hydrate.mock.calls[0]?.[0].sessionId);
      const next = service.inspectSource(sourcePath, crypto.randomUUID());
      complete();
      await expect(preview).resolves.toMatchObject({ ok: false, error: { code: 'USER_CANCELLED' } });
      await expect(queued).resolves.toMatchObject({ ok: false, error: { code: 'USER_CANCELLED' } });
      expect(hydrate).toHaveBeenCalledOnce();
      const replacement = await next;
      if (!replacement.ok) throw new Error(replacement.error.message);
      expect(replacement.sessionId).not.toBe(first.sessionId);
      hydrate.mockImplementationOnce(async ({ bitmap }) => decodedBitmap(bitmap, 2));
      await expect(service.previewRaster(replacement.sessionId, left!.id)).resolves.toMatchObject({
        ok: true, payload: { bytes: Uint8Array.of(2) },
      });
      expect(hydrate).toHaveBeenCalledTimes(2);
    });
  });
});
