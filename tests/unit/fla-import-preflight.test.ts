import { createHash } from 'node:crypto';
import {
  mkdtemp,
  rm,
  writeFile,
} from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FLA_IMPORT_LIMITS,
} from '../../src/shared/fla-import-api';
import {
  FlaPreflightError,
  preflightFlaBytes,
  preflightFlaSource,
} from '../../src/main/services/fla-import-preflight-service';

interface TestEntry {
  name: string;
  data?: string;
  declaredSize?: number;
  localDeclaredSize?: number;
  compressionMethod?: number;
  localName?: string;
}

function makeZip(entries: readonly TestEntry[]): Uint8Array {
  const localRecords: Buffer[] = [];
  const centralRecords: Buffer[] = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const localName = Buffer.from(entry.localName ?? entry.name, 'utf8');
    const data = Buffer.from(entry.data ?? '', 'utf8');
    const declaredSize = entry.declaredSize ?? data.byteLength;
    const localDeclaredSize = entry.localDeclaredSize ?? declaredSize;
    const compressionMethod = entry.compressionMethod ?? 0;
    const local = Buffer.alloc(30 + localName.byteLength + data.byteLength);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(compressionMethod, 8);
    local.writeUInt32LE(data.byteLength, 18);
    local.writeUInt32LE(localDeclaredSize, 22);
    local.writeUInt16LE(localName.byteLength, 26);
    localName.copy(local, 30);
    data.copy(local, 30 + localName.byteLength);
    localRecords.push(local);

    const central = Buffer.alloc(46 + name.byteLength);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(compressionMethod, 10);
    central.writeUInt32LE(data.byteLength, 20);
    central.writeUInt32LE(declaredSize, 24);
    central.writeUInt16LE(name.byteLength, 28);
    central.writeUInt32LE(localOffset, 42);
    name.copy(central, 46);
    centralRecords.push(central);
    localOffset += local.byteLength;
  }
  const central = Buffer.concat(centralRecords);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(central.byteLength, 12);
  eocd.writeUInt32LE(localOffset, 16);
  return Uint8Array.from(Buffer.concat([...localRecords, central, eocd]));
}

function expectPreflightCode(action: () => unknown, code: FlaPreflightError['code']): void {
  try {
    action();
    throw new Error('expected preflight to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(FlaPreflightError);
    expect((error as FlaPreflightError).code).toBe(code);
  }
}

describe('FLA source preflight', () => {
  it('accepts a synthetic file-backed archive and preserves its source identity', async () => {
    const sourceBytes = makeZip([
      { name: 'DOMDocument.xml', data: '<DOMDocument/>' },
      { name: 'media/fixture.dat', data: 'synthetic media' },
    ]);
    const temporaryRoot = await mkdtemp(
      path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-stage-fla-preflight-'),
    );
    const sourcePath = path.join(temporaryRoot, 'synthetic.fla');

    try {
      await writeFile(sourcePath, sourceBytes);
      const result = await preflightFlaSource(sourcePath);

      expect(result.sourcePath).toBe(sourcePath);
      expect(result.sha256).toBe(createHash('sha256').update(sourceBytes).digest('hex'));
      expect(result.basename).toBe('synthetic.fla');
      expect(result.byteLength).toBe(sourceBytes.byteLength);
      expect(result.entries).toHaveLength(2);
      expect(result.entries.some((entry) => entry.name === 'DOMDocument.xml')).toBe(true);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('rejects a non-ZIP container and a missing XFL document', () => {
    expectPreflightCode(() => preflightFlaBytes(Uint8Array.from([1, 2, 3]), 'bad.fla'), 'UNSUPPORTED_FLA_CONTAINER');
    expectPreflightCode(() => preflightFlaBytes(makeZip([{ name: 'readme.txt', data: 'x' }]), 'bad.fla'), 'MALFORMED_XFL');
  });

  it('rejects Zip Slip, ambiguous paths, and external XML resources', () => {
    const base = { name: 'DOMDocument.xml', data: '<DOMDocument/>' };
    expectPreflightCode(() => preflightFlaBytes(makeZip([base, { name: '../evil.dat', data: 'x' }]), 'bad.fla'), 'MALFORMED_ARCHIVE');
    expectPreflightCode(() => preflightFlaBytes(makeZip([base, { name: 'a\\b.dat', data: 'x' }]), 'bad.fla'), 'MALFORMED_ARCHIVE');
    expectPreflightCode(() => preflightFlaBytes(makeZip([{ name: 'DOMDocument.xml', data: '<!DOCTYPE x SYSTEM "file:///secret"><DOMDocument/>' }]), 'bad.fla'), 'MALFORMED_XFL');
    expectPreflightCode(() => preflightFlaBytes(makeZip([{ name: 'DOMDocument.xml', data: '<DOMDocument><child></DOMDocument>' }]), 'bad.fla'), 'MALFORMED_XFL');
    expectPreflightCode(() => preflightFlaBytes(makeZip([{ name: 'DOMDocument.xml', data: '<DOMDocument></DOMDocument>' }, { name: 'C:/outside.dat', data: 'x' }]), 'bad.fla'), 'MALFORMED_ARCHIVE');
    expectPreflightCode(() => preflightFlaBytes(makeZip([{ name: 'DOMDocument.xml', data: '<DOMDocument></DOMDocument>' }, { name: 'media.dat', localName: 'other.dat', data: 'x' }]), 'bad.fla'), 'MALFORMED_ARCHIVE');
    expectPreflightCode(() => preflightFlaBytes(makeZip([{ name: 'DOMDocument.xml', data: '<DOMDocument></DOMDocument>' }, { name: 'media.dat', compressionMethod: 99, data: 'x' }]), 'bad.fla'), 'MALFORMED_ARCHIVE');
  });

  it('enforces source, entry, expanded, and XML budgets before parsing', () => {
    expectPreflightCode(
      () => preflightFlaBytes({ byteLength: FLA_IMPORT_LIMITS.maxSourceBytes + 1 } as Uint8Array, 'large.fla'),
      'ARCHIVE_LIMIT_EXCEEDED',
    );
    const tooMany = [{ name: 'DOMDocument.xml', data: '<DOMDocument/>' }, ...Array.from({ length: FLA_IMPORT_LIMITS.maxZipEntries }, (_, index) => ({ name: `media/${index}.dat`, data: '' }))];
    expectPreflightCode(() => preflightFlaBytes(makeZip(tooMany), 'large.fla'), 'ARCHIVE_LIMIT_EXCEEDED');
    const expanded = [baseEntry(), ...Array.from({ length: 17 }, (_, index) => ({ name: `media/${index}.dat`, data: '', declaredSize: 64 * 1024 * 1024 }))];
    expectPreflightCode(() => preflightFlaBytes(makeZip(expanded), 'large.fla'), 'ARCHIVE_LIMIT_EXCEEDED');
    expectPreflightCode(() => preflightFlaBytes(makeZip([{ name: 'DOMDocument.xml', data: '', declaredSize: FLA_IMPORT_LIMITS.maxXmlBytes + 1 }]), 'large.fla'), 'XML_LIMIT_EXCEEDED');
    const deeplyNested = `<DOMDocument>${'<layer>'.repeat(FLA_IMPORT_LIMITS.maxRecursionDepth)}${'</layer>'.repeat(FLA_IMPORT_LIMITS.maxRecursionDepth)}</DOMDocument>`;
    expectPreflightCode(() => preflightFlaBytes(makeZip([{ name: 'DOMDocument.xml', data: deeplyNested }]), 'deep.fla'), 'XML_LIMIT_EXCEEDED');
  });
});

function baseEntry(): TestEntry {
  return { name: 'DOMDocument.xml', data: '<DOMDocument/>' };
}
