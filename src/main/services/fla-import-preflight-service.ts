import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { basename } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import {
  FLA_IMPORT_LIMITS,
  type FlaImportErrorCode,
} from '../../shared/fla-import-api';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const OLE2_SIGNATURE = 0xe011cfd0;
const ZIP_COMMENT_LIMIT = 0xffff;

export interface FlaArchiveEntry {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  compressionMethod: number;
  dataOffset: number;
  isXml: boolean;
}

export interface FlaPreflightResult {
  sourcePath: string;
  basename: string;
  byteLength: number;
  sha256: string;
  bytes: Uint8Array;
  entries: FlaArchiveEntry[];
  containsActionScript: boolean;
}

export interface FlaSourceBytes {
  sourcePath: string;
  basename: string;
  byteLength: number;
  sha256: string;
  bytes: Uint8Array;
}

export class FlaPreflightError extends Error {
  readonly code: FlaImportErrorCode;

  constructor(code: FlaImportErrorCode, message: string) {
    super(message);
    this.name = 'FlaPreflightError';
    this.code = code;
  }
}

function fail(code: FlaImportErrorCode, message: string): never {
  throw new FlaPreflightError(code, message);
}

function readUInt16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function readUInt32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0) |
    ((bytes[offset + 1] ?? 0) << 8) |
    ((bytes[offset + 2] ?? 0) << 16) |
    ((bytes[offset + 3] ?? 0) << 24)
  ) >>> 0;
}

function isWithin(bytes: Uint8Array, offset: number, length: number): boolean {
  return (
    Number.isSafeInteger(offset) &&
    Number.isSafeInteger(length) &&
    offset >= 0 &&
    length >= 0 &&
    offset <= bytes.byteLength &&
    length <= bytes.byteLength - offset
  );
}

function decodeName(bytes: Uint8Array, offset: number, length: number): string {
  if (!isWithin(bytes, offset, length)) {
    fail('MALFORMED_ARCHIVE', 'ZIP filename exceeds the source boundary');
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(
      bytes.slice(offset, offset + length),
    );
  } catch {
    fail('MALFORMED_ARCHIVE', 'ZIP filename is not valid UTF-8');
  }
}

function normalizedArchivePath(name: string): string {
  if (
    name.includes('\0') ||
    name.includes('\\') ||
    name.startsWith('/') ||
    name.startsWith('//') ||
    /^[a-zA-Z]:/u.test(name)
  ) {
    fail('MALFORMED_ARCHIVE', `Unsafe archive path: ${name}`);
  }

  const segments = name.split('/');
  const isDirectory = name.endsWith('/');
  const meaningfulSegments = isDirectory ? segments.slice(0, -1) : segments;
  if (
    meaningfulSegments.length === 0 ||
    meaningfulSegments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')
  ) {
    fail('MALFORMED_ARCHIVE', `Ambiguous archive path: ${name}`);
  }

  // Windows is case-insensitive and Unicode-normalizing filesystems can
  // collapse distinct spellings.  This key is only for collision detection;
  // no archive name is ever used as a filesystem path.
  return name.normalize('NFKC').toLocaleLowerCase('en-US');
}

function locateEndOfCentralDirectory(bytes: Uint8Array): number {
  const first = Math.max(0, bytes.byteLength - (22 + ZIP_COMMENT_LIMIT));
  for (let offset = bytes.byteLength - 22; offset >= first; offset -= 1) {
    if (isWithin(bytes, offset, 22) && readUInt32(bytes, offset) === EOCD_SIGNATURE) {
      const commentLength = readUInt16(bytes, offset + 20);
      if (offset + 22 + commentLength === bytes.byteLength) {
        return offset;
      }
    }
  }
  fail('MALFORMED_ARCHIVE', 'ZIP end-of-central-directory record is missing');
}

function readEntryData(bytes: Uint8Array, entry: FlaArchiveEntry): Uint8Array {
  if (!isWithin(bytes, entry.dataOffset, entry.compressedSize)) {
    fail('MALFORMED_ARCHIVE', `ZIP entry data exceeds the source boundary: ${entry.name}`);
  }

  const compressed = bytes.slice(
    entry.dataOffset,
    entry.dataOffset + entry.compressedSize,
  );
  if (entry.compressionMethod === 0) {
    return compressed;
  }
  if (entry.compressionMethod === 8) {
    try {
      return new Uint8Array(
        inflateRawSync(compressed, {
          maxOutputLength: FLA_IMPORT_LIMITS.maxXmlBytes + 1,
        }),
      );
    } catch (error) {
      fail(
        'MALFORMED_ARCHIVE',
        `ZIP entry could not be safely inflated: ${entry.name} (${String(error)})`,
      );
    }
  }
  fail(
    'MALFORMED_ARCHIVE',
    `Unsupported or unsafe ZIP compression method for ${entry.name}`,
  );
}

function enforceXmlDepth(text: string, entryName: string): void {
  let depth = 0;
  let rootCount = 0;
  const stack: string[] = [];
  const tokenPattern = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\/?([A-Za-z_][A-Za-z0-9_.:-]*)(?:\s[^<>]*?)?\/?\s*>/gu;
  for (const match of text.matchAll(tokenPattern)) {
    const token = match[0];
    if (token.startsWith('<!--') || token.startsWith('<![CDATA[')) continue;
    const tagName = match[1];
    if (!tagName) fail('MALFORMED_XFL', `XML tag is malformed: ${entryName}`);
    if (token.startsWith('</')) {
      depth -= 1;
      if (depth < 0 || stack.pop() !== tagName) {
        fail('MALFORMED_XFL', `XML closing tag is malformed: ${entryName}`);
      }
      continue;
    }
    if (depth === 0) {
      rootCount += 1;
      if (rootCount > 1) fail('MALFORMED_XFL', `XML has multiple roots: ${entryName}`);
    }
    if (!token.endsWith('/>')) {
      depth += 1;
      stack.push(tagName);
      if (depth > FLA_IMPORT_LIMITS.maxRecursionDepth) {
        fail('XML_LIMIT_EXCEEDED', `XML nesting depth exceeds the limit: ${entryName}`);
      }
    }
  }
  if (depth !== 0 || stack.length !== 0 || rootCount !== 1) {
    fail('MALFORMED_XFL', `XML document is not balanced: ${entryName}`);
  }
}

function inspectXml(bytes: Uint8Array, entry: FlaArchiveEntry): boolean {
  if (!entry.isXml) return false;
  if (entry.uncompressedSize > FLA_IMPORT_LIMITS.maxXmlBytes) {
    fail('XML_LIMIT_EXCEEDED', `XML entry exceeds the limit: ${entry.name}`);
  }

  const xmlBytes = readEntryData(bytes, entry);
  if (xmlBytes.byteLength > FLA_IMPORT_LIMITS.maxXmlBytes) {
    fail('XML_LIMIT_EXCEEDED', `Expanded XML entry exceeds the limit: ${entry.name}`);
  }
  const text = new TextDecoder('utf-8', { fatal: false }).decode(xmlBytes);
  if (!text.trim()) {
    if (entry.name === 'DOMDocument.xml') {
      fail('MALFORMED_XFL', 'DOMDocument.xml is empty');
    }
    return false;
  }
  enforceXmlDepth(text, entry.name);
  // XML namespace declarations commonly contain http:// URLs; they are
  // identifiers, not fetches.  Remove those attributes before applying the
  // external-resource policy.
  const policyText = text.replace(/\s+xmlns(?::[A-Za-z_][A-Za-z0-9_.-]*)?\s*=\s*(?:"[^"]*"|'[^']*')/gu, '');
  const lower = policyText.toLocaleLowerCase('en-US');
  if (
    lower.includes('<!doctype') ||
    lower.includes('<!entity') ||
    lower.includes(' system ') ||
    lower.includes(' public ') ||
    lower.includes('xinclude') ||
    lower.includes('http://') ||
    lower.includes('https://') ||
    lower.includes('file:')
  ) {
    fail('MALFORMED_XFL', `External XML resources are not permitted: ${entry.name}`);
  }

  return /<script(?:\s|>)/iu.test(text) || /actionscript|doabc/iu.test(text);
}

function parseZip(bytes: Uint8Array): {
  entries: FlaArchiveEntry[];
  containsActionScript: boolean;
} {
  if (bytes.byteLength < 4 || readUInt32(bytes, 0) !== 0x04034b50) {
    if (bytes.byteLength >= 4 && readUInt32(bytes, 0) === OLE2_SIGNATURE) {
      fail('UNSUPPORTED_FLA_CONTAINER', 'Legacy OLE2 FLA containers are not supported in Slice 1');
    }
    fail('UNSUPPORTED_FLA_CONTAINER', 'The selected file is not a ZIP-based FLA container');
  }

  const eocd = locateEndOfCentralDirectory(bytes);
  const diskNumber = readUInt16(bytes, eocd + 4);
  const centralDisk = readUInt16(bytes, eocd + 6);
  const entriesOnDisk = readUInt16(bytes, eocd + 8);
  const entryCount = readUInt16(bytes, eocd + 10);
  const centralSize = readUInt32(bytes, eocd + 12);
  const centralOffset = readUInt32(bytes, eocd + 16);

  if (
    diskNumber !== 0 ||
    centralDisk !== 0 ||
    entriesOnDisk !== entryCount ||
    entryCount === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff
  ) {
    fail('MALFORMED_ARCHIVE', 'Multi-disk or ZIP64 archives are not supported');
  }
  if (entryCount > FLA_IMPORT_LIMITS.maxZipEntries) {
    fail('ARCHIVE_LIMIT_EXCEEDED', 'ZIP entry count exceeds the limit');
  }
  if (!isWithin(bytes, centralOffset, centralSize) || centralOffset + centralSize > eocd) {
    fail('MALFORMED_ARCHIVE', 'ZIP central directory exceeds the source boundary');
  }

  const entries: FlaArchiveEntry[] = [];
  const names = new Set<string>();
  let cursor = centralOffset;
  let expandedBytes = 0;
  let containsActionScript = false;

  for (let index = 0; index < entryCount; index += 1) {
    if (!isWithin(bytes, cursor, 46) || readUInt32(bytes, cursor) !== CENTRAL_SIGNATURE) {
      fail('MALFORMED_ARCHIVE', 'ZIP central directory entry is malformed');
    }

    const flags = readUInt16(bytes, cursor + 8);
    const compressionMethod = readUInt16(bytes, cursor + 10);
    const compressedSize = readUInt32(bytes, cursor + 20);
    const uncompressedSize = readUInt32(bytes, cursor + 24);
    const nameLength = readUInt16(bytes, cursor + 28);
    const extraLength = readUInt16(bytes, cursor + 30);
    const commentLength = readUInt16(bytes, cursor + 32);
    const localHeaderOffset = readUInt32(bytes, cursor + 42);
    const recordLength = 46 + nameLength + extraLength + commentLength;
    if (!isWithin(bytes, cursor, recordLength)) {
      fail('MALFORMED_ARCHIVE', 'ZIP central directory record is truncated');
    }

    const name = decodeName(bytes, cursor + 46, nameLength);
    const normalizedName = normalizedArchivePath(name);
    if (names.has(normalizedName)) {
      fail('MALFORMED_ARCHIVE', `Duplicate or ambiguous archive path: ${name}`);
    }
    names.add(normalizedName);

    const isXml = /\.xml$/iu.test(name);
    if (uncompressedSize > FLA_IMPORT_LIMITS.maxSingleEntryBytes) {
      if (isXml) {
        fail('XML_LIMIT_EXCEEDED', `XML entry exceeds the per-entry limit: ${name}`);
      }
      fail('ARCHIVE_LIMIT_EXCEEDED', `ZIP entry exceeds the per-entry limit: ${name}`);
    }
    expandedBytes += uncompressedSize;
    if (expandedBytes > FLA_IMPORT_LIMITS.maxExpandedArchiveBytes) {
      fail('ARCHIVE_LIMIT_EXCEEDED', 'Expanded ZIP size exceeds the limit');
    }
    if (compressionMethod !== 0 && compressionMethod !== 8) {
      fail('MALFORMED_ARCHIVE', `Unsupported ZIP compression method for ${name}`);
    }
    if ((flags & 0x1) !== 0) {
      fail('MALFORMED_ARCHIVE', `Encrypted ZIP entries are not supported: ${name}`);
    }
    if (!isWithin(bytes, localHeaderOffset, 30) || readUInt32(bytes, localHeaderOffset) !== LOCAL_SIGNATURE) {
      fail('MALFORMED_ARCHIVE', `ZIP local header is malformed: ${name}`);
    }
    const localNameLength = readUInt16(bytes, localHeaderOffset + 26);
    const localExtraLength = readUInt16(bytes, localHeaderOffset + 28);
    const localFlags = readUInt16(bytes, localHeaderOffset + 6);
    const localCompressionMethod = readUInt16(bytes, localHeaderOffset + 8);
    const localCompressedSize = readUInt32(bytes, localHeaderOffset + 18);
    const localUncompressedSize = readUInt32(bytes, localHeaderOffset + 22);
    if (localCompressionMethod !== compressionMethod) {
      fail('MALFORMED_ARCHIVE', `ZIP local and central compression differ: ${name}`);
    }
    if (
      (localFlags & 0x08) === 0 &&
      (localCompressedSize !== compressedSize || localUncompressedSize !== uncompressedSize)
    ) {
      fail('MALFORMED_ARCHIVE', `ZIP local and central sizes differ: ${name}`);
    }
    const localName = decodeName(bytes, localHeaderOffset + 30, localNameLength);
    if (normalizedArchivePath(localName) !== normalizedName) {
      fail('MALFORMED_ARCHIVE', `ZIP local and central names differ: ${name}`);
    }
    const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;
    if (!isWithin(bytes, dataOffset, compressedSize)) {
      fail('MALFORMED_ARCHIVE', `ZIP entry data is truncated: ${name}`);
    }

    const entry: FlaArchiveEntry = {
      name,
      compressedSize,
      uncompressedSize,
      compressionMethod,
      dataOffset,
      isXml,
    };
    entries.push(entry);
    containsActionScript = inspectXml(bytes, entry) || containsActionScript;
    cursor += recordLength;
  }

  if (cursor !== centralOffset + centralSize) {
    fail('MALFORMED_ARCHIVE', 'ZIP central directory has trailing or missing records');
  }
  if (!entries.some((entry) => entry.name === 'DOMDocument.xml')) {
    fail('MALFORMED_XFL', 'DOMDocument.xml is missing from the XFL archive');
  }

  return { entries, containsActionScript };
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function preflightFlaBytes(
  bytes: Uint8Array,
  sourceBasename: string,
  sourcePath = '',
): FlaPreflightResult {
  if (bytes.byteLength > FLA_IMPORT_LIMITS.maxSourceBytes) {
    fail('ARCHIVE_LIMIT_EXCEEDED', 'The FLA source exceeds the byte limit');
  }
  if (bytes.byteLength === 0) {
    fail('UNSUPPORTED_FLA_CONTAINER', 'The FLA source is empty');
  }
  const parsed = parseZip(bytes);
  return {
    sourcePath,
    basename: basename(sourceBasename),
    byteLength: bytes.byteLength,
    sha256: sha256(bytes),
    bytes: Uint8Array.from(bytes),
    entries: parsed.entries,
    containsActionScript: parsed.containsActionScript,
  };
}

export async function preflightFlaSource(
  sourcePath: string,
  signal?: AbortSignal,
): Promise<FlaPreflightResult> {
  const source = await readFlaSourceBytes(sourcePath, signal);
  return preflightFlaBytes(source.bytes, source.basename, source.sourcePath);
}

/**
 * Read a bounded source once so Main can first run the existing strict
 * preflight and, only after a strict rejection, inspect the same immutable
 * bytes with the C2 classifier.  No copy is written beside the source.
 */
export async function readFlaSourceBytes(
  sourcePath: string,
  signal?: AbortSignal,
): Promise<FlaSourceBytes> {
  let stat;
  try {
    stat = await fs.stat(sourcePath);
  } catch {
    fail('UNSUPPORTED_FLA_CONTAINER', 'The selected FLA source is not readable');
  }
  if (!stat.isFile()) {
    fail('UNSUPPORTED_FLA_CONTAINER', 'The selected FLA source is not a file');
  }
  if (stat.size > FLA_IMPORT_LIMITS.maxSourceBytes) {
    fail('ARCHIVE_LIMIT_EXCEEDED', 'The FLA source exceeds the byte limit');
  }

  let bytes: Buffer;
  try {
    bytes = await fs.readFile(sourcePath, { signal });
  } catch (error) {
    if (signal?.aborted) {
      fail('USER_CANCELLED', 'FLA inspection was cancelled before parsing');
    }
    fail('UNSUPPORTED_FLA_CONTAINER', `The selected FLA source is not readable: ${String(error)}`);
  }
  const ownedBytes = Uint8Array.from(bytes);
  return {
    sourcePath,
    basename: basename(sourcePath),
    byteLength: ownedBytes.byteLength,
    sha256: sha256(ownedBytes),
    bytes: ownedBytes,
  };
}
