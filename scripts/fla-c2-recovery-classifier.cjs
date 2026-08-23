#!/usr/bin/env node
// @ts-check
/**
 * FLA V1.5-C2 research-only structural recovery classifier.
 *
 * This module is intentionally outside production import/preflight wiring.
 * It reads bytes, measures a bounded classic ZIP/XFL layout, and returns an
 * explicit state plus reason codes. It never mutates its input and never
 * performs decompression or Project/UI work.
 */

'use strict';

const { createHash } = require('node:crypto');

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const ZIP64_EXTRA_FIELD = 0x0001;
const ZIP_COMMENT_LIMIT = 0xffff;
const EOCD_BYTES = 22;
const CENTRAL_FIXED_BYTES = 46;
const LOCAL_FIXED_BYTES = 30;

const STATES = Object.freeze({
  STRICT_VALID: 'STRICT_VALID',
  RECOVERY_CANDIDATE: 'RECOVERY_CANDIDATE',
  REJECT: 'REJECT',
  AMBIGUOUS: 'AMBIGUOUS',
});

const DEFAULT_C2_BUDGETS = Object.freeze({
  maxSourceBytes: 256 * 1024 * 1024,
  maxZipEntries: 20_000,
  maxExpandedArchiveBytes: 1024 * 1024 * 1024,
  maxSingleEntryBytes: 64 * 1024 * 1024,
  maxCentralDirectoryBytes: 64 * 1024 * 1024,
  maxExactDuplicateLocalRecords: 1,
  supportedCompressionMethods: Object.freeze([0, 8]),
});

function readUint16(bytes, offset) {
  if (offset < 0 || offset + 2 > bytes.byteLength) return null;
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint32(bytes, offset) {
  if (offset < 0 || offset + 4 > bytes.byteLength) return null;
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
}

function isWithin(bytes, offset, length) {
  return (
    Number.isSafeInteger(offset) &&
    Number.isSafeInteger(length) &&
    offset >= 0 &&
    length >= 0 &&
    offset <= bytes.byteLength &&
    length <= bytes.byteLength - offset
  );
}

function sha256(bytes) {
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex').toUpperCase();
}

/**
 * EOCD candidates include signatures with a self-consistent comment length,
 * even when they are not the final record. Treating those as candidates makes
 * an embedded/forged EOCD fail closed instead of silently choosing the last
 * signature.
 */
function findEocdCandidates(bytes) {
  const candidates = [];
  const first = Math.max(0, bytes.byteLength - EOCD_BYTES - ZIP_COMMENT_LIMIT);
  for (let offset = bytes.byteLength - EOCD_BYTES; offset >= first; offset -= 1) {
    if (readUint32(bytes, offset) !== EOCD_SIGNATURE) continue;
    const commentLength = readUint16(bytes, offset + 20);
    if (commentLength === null) continue;
    const end = offset + EOCD_BYTES + commentLength;
    if (end <= bytes.byteLength) {
      candidates.push({
        offset,
        commentLength,
        end,
        endsAtInput: end === bytes.byteLength,
      });
    }
  }
  return candidates;
}

function decodeName(bytes, offset, length, flags) {
  if (!isWithin(bytes, offset, length)) {
    return { ok: false, reason: 'NAME_OUT_OF_BOUNDS' };
  }
  const raw = bytes.slice(offset, offset + length);
  try {
    const decoder = new TextDecoder('utf-8', { fatal: (flags & 0x800) !== 0 });
    return { ok: true, value: decoder.decode(raw) };
  } catch {
    return { ok: false, reason: 'NAME_ENCODING_INVALID' };
  }
}

function normalizeArchivePath(name) {
  if (
    name.includes('\0') ||
    name.includes('\\') ||
    name.startsWith('/') ||
    name.startsWith('//') ||
    /^[a-zA-Z]:/u.test(name)
  ) {
    return { ok: false, reason: 'PATH_UNSAFE' };
  }
  const segments = name.split('/');
  const directory = name.endsWith('/');
  const meaningful = directory ? segments.slice(0, -1) : segments;
  if (
    meaningful.length === 0 ||
    meaningful.some((segment) => segment.length === 0 || segment === '.' || segment === '..')
  ) {
    return { ok: false, reason: 'PATH_AMBIGUOUS' };
  }
  return { ok: true, value: name.normalize('NFKC').toLocaleLowerCase('en-US') };
}

function hasZip64Extra(bytes, offset, length) {
  if (!isWithin(bytes, offset, length)) return true;
  let cursor = offset;
  const end = offset + length;
  while (cursor < end) {
    if (cursor + 4 > end) return true;
    const id = readUint16(bytes, cursor);
    const size = readUint16(bytes, cursor + 2);
    if (id === null || size === null || cursor + 4 + size > end) return true;
    if (id === ZIP64_EXTRA_FIELD) return true;
    cursor += 4 + size;
  }
  return false;
}

function emptyPreconditions() {
  return {
    classicZipXfl: false,
    uniqueEocd: false,
    singleDisk: false,
    nonEncrypted: false,
    supportedCompression: false,
    resourcesWithinBudget: false,
    centralRecordsComplete: false,
    uniqueActualCentralBoundary: false,
    eocdOffsetConsistent: false,
    localHeadersInsideSource: false,
    localCentralMetadataConsistent: false,
    noOverlappingRanges: false,
    noHiddenPayload: false,
    noZip64: false,
    noPathTraversal: false,
    onlyDeclarationMetadataInconsistent: false,
  };
}

function emptyMeasurements(byteLength) {
  return {
    byteLength,
    eocdOffset: null,
    eocdCandidateCount: 0,
    exactEocdCandidateCount: 0,
    eocdCommentLength: null,
    diskNumber: null,
    centralDirectoryDiskNumber: null,
    entriesOnDisk: null,
    totalEntries: null,
    declaredCentralDirectoryOffset: null,
    declaredCentralDirectorySize: null,
    actualCentralDirectoryStart: null,
    actualCentralDirectoryEnd: null,
    actualCentralDirectorySize: null,
    centralDirectoryDeltaBytes: null,
    centralDirectoryRecordCount: 0,
    recordContinuity: false,
    localHeaderOffsets: [],
    localOnlyRecordCount: 0,
    exactDuplicateLocalRecordCount: 0,
    encryptedEntryCount: 0,
    compressionMethods: [],
    zip64Indicator: false,
    trailingBytes: null,
    domDocumentPresent: false,
  };
}

function baseResult(bytes) {
  return {
    state: STATES.REJECT,
    reasonCodes: [],
    measured: emptyMeasurements(bytes.byteLength),
    preconditions: emptyPreconditions(),
    sourceSha256: sha256(bytes),
  };
}

function finish(result, state, ...reasonCodes) {
  result.state = state;
  result.reasonCodes = [...new Set(reasonCodes.filter(Boolean))];
  return result;
}

function reject(result, ...reasonCodes) {
  return finish(result, STATES.REJECT, ...reasonCodes);
}

function ambiguous(result, ...reasonCodes) {
  return finish(result, STATES.AMBIGUOUS, ...reasonCodes);
}

function readCentralRecord(bytes, cursor, eocdOffset, budgets) {
  if (!isWithin(bytes, cursor, CENTRAL_FIXED_BYTES) || cursor + CENTRAL_FIXED_BYTES > eocdOffset) {
    return { ok: false, reason: 'CENTRAL_RECORD_TRUNCATED' };
  }
  if (readUint32(bytes, cursor) !== CENTRAL_SIGNATURE) {
    return { ok: false, reason: 'CENTRAL_RECORD_SIGNATURE_INVALID' };
  }
  const flags = readUint16(bytes, cursor + 8);
  const compressionMethod = readUint16(bytes, cursor + 10);
  const compressedSize = readUint32(bytes, cursor + 20);
  const uncompressedSize = readUint32(bytes, cursor + 24);
  const nameLength = readUint16(bytes, cursor + 28);
  const extraLength = readUint16(bytes, cursor + 30);
  const commentLength = readUint16(bytes, cursor + 32);
  const localHeaderOffset = readUint32(bytes, cursor + 42);
  if ([flags, compressionMethod, compressedSize, uncompressedSize, nameLength, extraLength, commentLength, localHeaderOffset].some((value) => value === null)) {
    return { ok: false, reason: 'CENTRAL_RECORD_FIELDS_TRUNCATED' };
  }
  if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) {
    return { ok: false, reason: 'ZIP64_ENTRY_FIELD' };
  }
  const recordLength = CENTRAL_FIXED_BYTES + nameLength + extraLength + commentLength;
  if (cursor + recordLength > eocdOffset) {
    return { ok: false, reason: 'CENTRAL_RECORD_VARIABLE_FIELDS_TRUNCATED' };
  }
  if (hasZip64Extra(bytes, cursor + CENTRAL_FIXED_BYTES + nameLength, extraLength)) {
    return { ok: false, reason: 'ZIP64_EXTRA_FIELD' };
  }
  const decoded = decodeName(bytes, cursor + CENTRAL_FIXED_BYTES, nameLength, flags);
  if (!decoded.ok) return { ok: false, reason: decoded.reason };
  const normalized = normalizeArchivePath(decoded.value);
  if (!normalized.ok) return { ok: false, reason: normalized.reason };
  if (flags & 0x1) return { ok: false, reason: 'ENCRYPTED_ENTRY' };
  if (flags & 0x8) return { ok: false, reason: 'DATA_DESCRIPTOR_UNSUPPORTED' };
  if (!budgets.supportedCompressionMethods.includes(compressionMethod)) {
    return { ok: false, reason: 'UNSUPPORTED_COMPRESSION' };
  }
  if (compressedSize > budgets.maxSingleEntryBytes || uncompressedSize > budgets.maxSingleEntryBytes) {
    return { ok: false, reason: 'SINGLE_ENTRY_BUDGET_EXCEEDED' };
  }
  return {
    ok: true,
    recordLength,
    cursor,
    flags,
    compressionMethod,
    compressedSize,
    uncompressedSize,
    name: decoded.value,
    normalizedName: normalized.value,
    extraLength,
    localHeaderOffset,
  };
}

function readLocalRecord(bytes, offset, limit, budgets) {
  if (!isWithin(bytes, offset, LOCAL_FIXED_BYTES) || offset + LOCAL_FIXED_BYTES > limit) {
    return { ok: false, reason: 'LOCAL_HEADER_TRUNCATED' };
  }
  if (readUint32(bytes, offset) !== LOCAL_SIGNATURE) {
    return { ok: false, reason: 'LOCAL_HEADER_SIGNATURE_INVALID' };
  }
  const flags = readUint16(bytes, offset + 6);
  const compressionMethod = readUint16(bytes, offset + 8);
  const compressedSize = readUint32(bytes, offset + 18);
  const uncompressedSize = readUint32(bytes, offset + 22);
  const nameLength = readUint16(bytes, offset + 26);
  const extraLength = readUint16(bytes, offset + 28);
  if ([flags, compressionMethod, compressedSize, uncompressedSize, nameLength, extraLength].some((value) => value === null)) {
    return { ok: false, reason: 'LOCAL_HEADER_FIELDS_TRUNCATED' };
  }
  if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
    return { ok: false, reason: 'ZIP64_LOCAL_FIELD' };
  }
  const dataOffset = offset + LOCAL_FIXED_BYTES + nameLength + extraLength;
  const end = dataOffset + compressedSize;
  if (!isWithin(bytes, offset, LOCAL_FIXED_BYTES + nameLength + extraLength) || end > limit) {
    return { ok: false, reason: 'LOCAL_ENTRY_DATA_TRUNCATED' };
  }
  if (hasZip64Extra(bytes, offset + LOCAL_FIXED_BYTES + nameLength, extraLength)) {
    return { ok: false, reason: 'ZIP64_EXTRA_FIELD' };
  }
  const decoded = decodeName(bytes, offset + LOCAL_FIXED_BYTES, nameLength, flags);
  if (!decoded.ok) return { ok: false, reason: decoded.reason };
  const normalized = normalizeArchivePath(decoded.value);
  if (!normalized.ok) return { ok: false, reason: normalized.reason };
  if (flags & 0x1) return { ok: false, reason: 'ENCRYPTED_ENTRY' };
  if (flags & 0x8) return { ok: false, reason: 'DATA_DESCRIPTOR_UNSUPPORTED' };
  if (!budgets.supportedCompressionMethods.includes(compressionMethod)) {
    return { ok: false, reason: 'UNSUPPORTED_COMPRESSION' };
  }
  if (compressedSize > budgets.maxSingleEntryBytes || uncompressedSize > budgets.maxSingleEntryBytes) {
    return { ok: false, reason: 'SINGLE_ENTRY_BUDGET_EXCEEDED' };
  }
  return {
    ok: true,
    offset,
    end,
    dataOffset,
    flags,
    compressionMethod,
    compressedSize,
    uncompressedSize,
    name: decoded.value,
    normalizedName: normalized.value,
    nameLength,
    extraLength,
    data: bytes.slice(dataOffset, end),
  };
}

function sameBytes(left, right) {
  return Buffer.from(left).equals(Buffer.from(right));
}

function exactDuplicateMatches(local, central, bytes) {
  return (
    local &&
    central &&
    local.normalizedName === central.normalizedName &&
    local.flags === central.flags &&
    local.compressionMethod === central.compressionMethod &&
    local.compressedSize === central.compressedSize &&
    local.uncompressedSize === central.uncompressedSize &&
    local.name === central.name &&
    sameBytes(local.data, bytes.slice(central.dataOffset, central.dataEnd))
  );
}

function parseLocalOnlyGap(bytes, start, end, centralByName, budgets) {
  const records = [];
  let cursor = start;
  while (cursor < end) {
    const local = readLocalRecord(bytes, cursor, end, budgets);
    if (!local.ok) return { ok: false, reason: 'UNACCOUNTED_LOCAL_REGION', detail: local.reason };
    const central = centralByName.get(local.normalizedName);
    if (!central || !exactDuplicateMatches(local, central, bytes)) {
      return { ok: false, reason: 'CONFLICTING_LOCAL_ONLY_PAYLOAD', detail: local.name };
    }
    records.push({ ...local, exactDuplicate: true });
    cursor = local.end;
  }
  return { ok: true, records };
}

/**
 * Classify a classic ZIP/XFL byte sequence without decompression.
 * The only recovery mismatch admitted by this evidence stage is the observed
 * +54 EOCD central-directory-size over-declaration. +54 is necessary, never
 * sufficient: every structural precondition below must also pass.
 */
function classifyForFlaRecovery(input, customBudgets = {}) {
  const bytes = Buffer.from(input || []);
  const budgets = {
    ...DEFAULT_C2_BUDGETS,
    ...customBudgets,
    supportedCompressionMethods: customBudgets.supportedCompressionMethods || DEFAULT_C2_BUDGETS.supportedCompressionMethods,
  };
  const result = baseResult(bytes);

  if (bytes.byteLength > budgets.maxSourceBytes) return reject(result, 'SOURCE_BUDGET_EXCEEDED');
  if (bytes.byteLength < LOCAL_FIXED_BYTES || readUint32(bytes, 0) !== LOCAL_SIGNATURE) {
    return reject(result, 'NOT_CLASSIC_ZIP_XFL');
  }
  result.preconditions.classicZipXfl = true;

  const candidates = findEocdCandidates(bytes);
  const exactCandidates = candidates.filter((candidate) => candidate.endsAtInput);
  result.measured.eocdCandidateCount = candidates.length;
  result.measured.exactEocdCandidateCount = exactCandidates.length;
  if (candidates.length === 0) return reject(result, 'EOCD_MISSING');
  if (candidates.length > 1 || exactCandidates.length > 1) {
    return ambiguous(result, 'MULTIPLE_EOCD_CANDIDATES');
  }
  if (exactCandidates.length !== 1) return ambiguous(result, 'EOCD_NOT_AT_INPUT_END');

  const eocd = exactCandidates[0];
  const m = result.measured;
  m.eocdOffset = eocd.offset;
  m.eocdCommentLength = eocd.commentLength;
  m.trailingBytes = bytes.byteLength - eocd.end;
  result.preconditions.uniqueEocd = true;
  if (m.trailingBytes !== 0) return ambiguous(result, 'TRAILING_BYTES_AFTER_EOCD');

  m.diskNumber = readUint16(bytes, eocd.offset + 4);
  m.centralDirectoryDiskNumber = readUint16(bytes, eocd.offset + 6);
  m.entriesOnDisk = readUint16(bytes, eocd.offset + 8);
  m.totalEntries = readUint16(bytes, eocd.offset + 10);
  m.declaredCentralDirectorySize = readUint32(bytes, eocd.offset + 12);
  m.declaredCentralDirectoryOffset = readUint32(bytes, eocd.offset + 16);
  if ([m.diskNumber, m.centralDirectoryDiskNumber, m.entriesOnDisk, m.totalEntries, m.declaredCentralDirectorySize, m.declaredCentralDirectoryOffset].some((value) => value === null)) {
    return reject(result, 'EOCD_FIELDS_TRUNCATED');
  }
  m.zip64Indicator = [m.entriesOnDisk, m.totalEntries].some((value) => value === 0xffff) ||
    [m.declaredCentralDirectorySize, m.declaredCentralDirectoryOffset].some((value) => value === 0xffffffff);
  if (m.zip64Indicator) return reject(result, 'ZIP64_UNSUPPORTED');
  result.preconditions.noZip64 = true;
  if (m.diskNumber !== 0 || m.centralDirectoryDiskNumber !== 0 || m.entriesOnDisk !== m.totalEntries) {
    return reject(result, 'MULTI_DISK_OR_ENTRY_COUNT_INCONSISTENT');
  }
  result.preconditions.singleDisk = true;
  if (m.totalEntries > budgets.maxZipEntries) return reject(result, 'ENTRY_COUNT_BUDGET_EXCEEDED');
  if (m.declaredCentralDirectorySize > budgets.maxCentralDirectoryBytes) return reject(result, 'CENTRAL_DIRECTORY_BUDGET_EXCEEDED');

  const centralStart = m.declaredCentralDirectoryOffset;
  const centralEnd = eocd.offset;
  if (!isWithin(bytes, centralStart, 0) || centralStart > centralEnd) {
    return reject(result, 'CENTRAL_DIRECTORY_OFFSET_OUT_OF_BOUNDS');
  }
  m.actualCentralDirectoryStart = centralStart;
  m.actualCentralDirectoryEnd = centralEnd;
  m.actualCentralDirectorySize = centralEnd - centralStart;
  m.centralDirectoryDeltaBytes = m.declaredCentralDirectorySize - m.actualCentralDirectorySize;
  if (m.actualCentralDirectorySize > budgets.maxCentralDirectoryBytes) return reject(result, 'CENTRAL_DIRECTORY_BUDGET_EXCEEDED');
  result.preconditions.uniqueActualCentralBoundary = true;
  result.preconditions.eocdOffsetConsistent = centralStart + m.actualCentralDirectorySize === eocd.offset;

  const entries = [];
  const centralByName = new Map();
  const ranges = [];
  let cursor = centralStart;
  let expandedBytes = 0;
  const compressionMethods = new Set();
  while (cursor < centralEnd) {
    const parsed = readCentralRecord(bytes, cursor, centralEnd, budgets);
    if (!parsed.ok) return reject(result, parsed.reason);
    if (centralByName.has(parsed.normalizedName)) return reject(result, 'DUPLICATE_CENTRAL_PATH');
    centralByName.set(parsed.normalizedName, parsed);
    compressionMethods.add(parsed.compressionMethod);
    expandedBytes += parsed.uncompressedSize;
    if (expandedBytes > budgets.maxExpandedArchiveBytes) return reject(result, 'EXPANDED_ARCHIVE_BUDGET_EXCEEDED');
    entries.push(parsed);
    cursor += parsed.recordLength;
  }
  m.centralDirectoryRecordCount = entries.length;
  m.recordContinuity = cursor === centralEnd;
  if (!m.recordContinuity) return reject(result, 'CENTRAL_RECORD_CONTINUITY_INVALID');
  if (entries.length !== m.totalEntries || entries.length !== m.entriesOnDisk) {
    return reject(result, 'CENTRAL_RECORD_COUNT_MISMATCH');
  }
  result.preconditions.centralRecordsComplete = true;
  m.compressionMethods = [...compressionMethods].sort((a, b) => a - b);
  if (!entries.some((entry) => entry.normalizedName === 'domdocument.xml')) {
    return reject(result, 'DOMDOCUMENT_MISSING');
  }
  m.domDocumentPresent = true;

  for (const central of entries) {
    const local = readLocalRecord(bytes, central.localHeaderOffset, centralStart, budgets);
    if (!local.ok) return reject(result, local.reason);
    if (local.normalizedName !== central.normalizedName || local.name !== central.name) {
      return reject(result, 'LOCAL_CENTRAL_NAME_MISMATCH');
    }
    if (local.flags !== central.flags) return reject(result, 'LOCAL_CENTRAL_FLAGS_MISMATCH');
    if (local.compressionMethod !== central.compressionMethod) return reject(result, 'LOCAL_CENTRAL_COMPRESSION_MISMATCH');
    if (local.compressedSize !== central.compressedSize || local.uncompressedSize !== central.uncompressedSize) {
      return reject(result, 'LOCAL_CENTRAL_SIZE_MISMATCH');
    }
    if (local.end > centralStart) return reject(result, 'LOCAL_ENTRY_OVERLAPS_CENTRAL_DIRECTORY');
    central.dataOffset = local.dataOffset;
    central.dataEnd = local.end;
    ranges.push({ start: local.offset, end: local.end, kind: 'referenced', central, local });
    m.localHeaderOffsets.push(central.localHeaderOffset);
  }
  result.preconditions.localHeadersInsideSource = true;

  ranges.sort((left, right) => left.start - right.start || left.end - right.end);
  for (let index = 1; index < ranges.length; index += 1) {
    if (ranges[index].start < ranges[index - 1].end) return reject(result, 'OVERLAPPING_LOCAL_DATA_RANGES');
  }
  result.preconditions.noOverlappingRanges = true;
  result.preconditions.localCentralMetadataConsistent = true;
  result.preconditions.nonEncrypted = true;
  result.preconditions.supportedCompression = true;
  result.preconditions.resourcesWithinBudget = true;
  result.preconditions.noPathTraversal = true;

  const orphanRecords = [];
  let coveredUntil = 0;
  for (const range of ranges) {
    if (range.start > coveredUntil) {
      const gap = parseLocalOnlyGap(bytes, coveredUntil, range.start, centralByName, budgets);
      if (!gap.ok) return reject(result, gap.reason);
      orphanRecords.push(...gap.records);
    }
    coveredUntil = Math.max(coveredUntil, range.end);
  }
  if (coveredUntil < centralStart) {
    const gap = parseLocalOnlyGap(bytes, coveredUntil, centralStart, centralByName, budgets);
    if (!gap.ok) return reject(result, gap.reason);
    orphanRecords.push(...gap.records);
  }
  if (orphanRecords.length > budgets.maxExactDuplicateLocalRecords) {
    return reject(result, 'EXACT_DUPLICATE_LOCAL_RECORD_BUDGET_EXCEEDED');
  }
  m.localOnlyRecordCount = orphanRecords.length;
  m.exactDuplicateLocalRecordCount = orphanRecords.length;
  result.preconditions.noHiddenPayload = true;
  if (m.localOnlyRecordCount > 0) {
    result.preconditions.noHiddenPayload = orphanRecords.every((record) => record.exactDuplicate);
  }

  if (m.centralDirectoryDeltaBytes === 0) {
    result.preconditions.onlyDeclarationMetadataInconsistent = true;
    return finish(result, STATES.STRICT_VALID, 'STRICT_PATH_VALID');
  }
  if (m.centralDirectoryDeltaBytes < 0) return reject(result, 'RECOVERY_DECLARATION_UNDERRUN_UNSUPPORTED');
  if (m.centralDirectoryDeltaBytes !== 54) return reject(result, 'RECOVERY_DELTA_NOT_SUPPORTED');
  result.preconditions.onlyDeclarationMetadataInconsistent = true;
  return finish(
    result,
    STATES.RECOVERY_CANDIDATE,
    'RECOVERY_EOCD_SIZE_DECLARATION_ONLY',
    'RECOVERY_BOUNDARY_RECONSTRUCTED',
    m.localOnlyRecordCount > 0 ? 'EXACT_DUPLICATE_LOCAL_RECORD_PROVEN' : null,
  );
}

function normalizeRecoveryCandidate(input, classification) {
  if (!classification || classification.state !== STATES.RECOVERY_CANDIDATE) {
    return { applied: false, reason: 'NOT_A_RECOVERY_CANDIDATE' };
  }
  const eocdOffset = classification.measured.eocdOffset;
  const actualSize = classification.measured.actualCentralDirectorySize;
  if (!Number.isInteger(eocdOffset) || !Number.isInteger(actualSize)) {
    return { applied: false, reason: 'RECOVERY_MEASUREMENTS_INCOMPLETE' };
  }
  const copy = Buffer.from(input);
  copy.writeUInt32LE(actualSize, eocdOffset + 12);
  return {
    applied: true,
    bytes: copy,
    field: 'EOCD.centralDirectorySize',
    offset: eocdOffset + 12,
    from: classification.measured.declaredCentralDirectorySize,
    to: actualSize,
    deltaBytes: classification.measured.centralDirectoryDeltaBytes,
    mode: 'in-memory-only',
    originalBytesWritten: false,
  };
}

module.exports = {
  DEFAULT_C2_BUDGETS,
  STATES,
  findEocdCandidates,
  classifyForFlaRecovery,
  normalizeRecoveryCandidate,
  sha256,
};
