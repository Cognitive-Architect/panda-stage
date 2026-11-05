#!/usr/bin/env node
/**
 * Issue #918 bounded private proof for the owner-authorized com8 FLA sample.
 *
 * The Main process reads and parses one FLA, prepares one Graphic timeline,
 * resolves its 21 authored frames, isolates source-addressable units, and
 * rasterizes those units through the existing sandboxed snapshot renderer.
 * Reassembly is built from the isolated unit PNGs. No project is opened or
 * modified, and all generated artwork stays in a caller-selected private
 * output directory outside the repository.
 */

'use strict';

const { app, ipcMain } = require('electron');
const { createHash, randomUUID } = require('node:crypto');
const {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} = require('node:fs');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const JSZip = require('jszip');
const { findEocdCandidates } = require('../../dist-electron/main/services/fla-recovery-classifier.js');
const {
  createPixelAlignedPngStackSvg,
  formatFiniteSvgNumber,
} = require('./issue918-com8-pixel-reassembly.cjs');

const REPO_ROOT = path.resolve(__dirname, '../..');
const EXPECTED_FRAME_COUNT = 21;
const EXPECTED_FPS = 25;
const MAX_PARTS = 24;
const MAX_AGGREGATE_PART_PNG_BYTES = 64 * 1024 * 1024;
const MAX_AGGREGATE_SHAPE_BLOCKS = 100_000;
const MAX_AGGREGATE_SHAPE_XML_BYTES = 64 * 1024 * 1024;
const MAX_EXPERIMENT_WALL_TIME_MS = 10 * 60 * 1000;
const MAX_OUTPUT_PIXELS = 16_777_216;

const {
  buildSvgForResolvedDisplayList,
  prepareFlaStaticSnapshotDisplaySource,
  stableRenderTargetId,
} = require('../../dist-electron/main/services/fla-static-snapshot-svg-builder.js');
const {
  resolveFlaDisplayList,
  FLA_DISPLAY_LIST_IDENTITY_MATRIX,
} = require('../../dist-electron/main/services/fla-display-list-resolver.js');
const {
  prepareFlaNestedGraphicFrameSelections,
} = require('../../dist-electron/main/services/fla-nested-graphic-frame-selector.js');
const {
  FlaFrameSequenceService,
} = require('../../dist-electron/main/services/fla-frame-sequence-service.js');
const {
  FlaStaticSnapshotWindowManager,
} = require('../../dist-electron/main/services/fla-static-snapshot-window-manager.js');
const { FlaImportService } = require('../../dist-electron/main/services/FlaImportService.js');
const {
  FlaParserWindowManager,
} = require('../../dist-electron/main/windows/fla-parser-window-manager.js');
const {
  createFlaStaticSnapshotBitmapMediaLookup,
} = require('../../dist-electron/main/services/fla-static-snapshot-media-resolver.js');
const { IPC_CHANNELS } = require('../../dist-electron/shared/ipc/channels.js');
const {
  FLA_STATIC_SNAPSHOT_LIMITS,
} = require('../../dist-electron/shared/fla-static-snapshot-api.js');

class ProbeFailure extends Error {
  constructor(stage, code, message, fallbackVerdict, details) {
    super(message);
    this.name = 'ProbeFailure';
    this.stage = stage;
    this.code = code;
    this.fallbackVerdict = fallbackVerdict || 'BLOCKED/UNSUPPORTED';
    this.details = details || null;
  }
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === '--help' || name === '-h') {
      values.help = true;
      continue;
    }
    if (!name.startsWith('--')) continue;
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error('Missing value for ' + name);
    }
    values[name.slice(2)] = value;
    index += 1;
  }
  return values;
}

function usage() {
  return [
    'Usage: pnpm exec electron scripts/research/issue918-com8-cross-frame-probe.cjs',
    '  --mode n0-preflight --source <owner-authorized.fla> --expected-sha <sha256>',
    '  --expected-render-target <fla-render-target-id> --output-dir <fresh-private-dir>',
    '  (read-only 21-frame selector coverage; writes only a private receipt)',
    'Or run the bounded native proof:',
    '  --source <owner-authorized.fla> --expected-sha <sha256>',
    '  --expected-render-target <fla-render-target-id>',
    '  --reference-project <same-source-project-dir> --output-dir <fresh-private-dir>',
  ].join('\n');
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex').toUpperCase();
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const digest = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => digest.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(digest.digest('hex').toUpperCase()));
  });
}

function isWithin(parentPath, candidatePath) {
  const relative = path.relative(parentPath, candidatePath);
  return relative === '' ||
    (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

function resolveOutsideRepo(inputPath, label) {
  const resolved = path.resolve(inputPath);
  if (!existsSync(resolved)) throw new Error(label + ' does not exist');
  const actual = realpathSync(resolved);
  const repo = realpathSync(REPO_ROOT);
  if (isWithin(repo, actual)) throw new Error(label + ' must stay outside the repository');
  return actual;
}

function createFreshOutputDirectory(inputPath) {
  const resolved = path.resolve(inputPath);
  if (existsSync(resolved)) throw new Error('Output directory already exists; use a fresh path');
  const parent = path.dirname(resolved);
  mkdirSync(parent, { recursive: true });
  const actualParent = realpathSync(parent);
  const repo = realpathSync(REPO_ROOT);
  if (isWithin(repo, actualParent) || isWithin(repo, resolved)) {
    throw new Error('Output directory must stay outside the repository');
  }
  mkdirSync(resolved);
  return realpathSync(resolved);
}

function outputPath(outputDir, ...segments) {
  const target = path.resolve(outputDir, ...segments);
  if (!isWithin(outputDir, target)) throw new Error('Output path escaped the private proof directory');
  return target;
}

function writeJson(filePath, value) {
  writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
}

function createRunRecord(args, outputDir) {
  return {
    format: 'panda-issue918-com8-proof',
    version: 1,
    startedAt: new Date().toISOString(),
    status: 'RUNNING',
    verdict: 'BLOCKED/UNSUPPORTED',
    completedStage: null,
    failure: null,
    source: {
      basename: path.basename(args.source),
      expectedSha256: args['expected-sha'].toUpperCase(),
      originalSha256: null,
      inputSha256After: null,
      inputUnchanged: null,
      mainSessionSha256: null,
      mainSessionByteLength: null,
      ingestMode: null,
      recoveryApplied: null,
      originalVsRecoveredXml: null,
    },
    target: {
      renderTargetId: args['expected-render-target'],
      sourceLibraryItemName: null,
      userLabel: null,
      frameCount: null,
      startFrameIndex: 0,
      endFrameIndex: EXPECTED_FRAME_COUNT - 1,
      sourceFps: null,
      durationMs: null,
      frameSequence: [],
    },
    reference: {
      type: 'same-source-prior-project-full-frame-pngs',
      projectLabel: path.basename(args['reference-project']),
      independentAnimate2023Reference: 'NOT_AVAILABLE',
      integrity: null,
      frameComparisons: [],
    },
    metrics: {
      parserCallCount: 0,
      preparedDisplaySourceCallCount: 0,
      targetFrameContextBuildCount: 0,
      nestedSelectorCallCount: 0,
      fullFrameResolveCount: 0,
      fullFrameRasterCount: 0,
      partResolveCount: 0,
      partRasterCount: 0,
      reassemblySequenceRasterCount: 0,
      partTrackCount: 0,
      maxObservedPartsInFrame: 0,
      totalPartPngBytes: 0,
      elapsedMs: 0,
    },
    outputDirectoryLabel: path.basename(outputDir),
  };
}

function fail(stage, code, message, fallbackVerdict) {
  throw new ProbeFailure(stage, code, message, fallbackVerdict);
}

function failWithDetails(stage, code, message, details, fallbackVerdict) {
  throw new ProbeFailure(stage, code, message, fallbackVerdict, details);
}

async function compareArchiveXmlEntries(originalBytes, recoveredBytes) {
  const original = Buffer.from(originalBytes);
  const recovered = Buffer.from(recoveredBytes);
  const originalEocd = findEocdCandidates(original).filter((candidate) => candidate.endsAtInput);
  const recoveredEocd = findEocdCandidates(recovered).filter((candidate) => candidate.endsAtInput);
  const eocdOffset = originalEocd.length === 1 && recoveredEocd.length === 1 &&
      originalEocd[0].offset === recoveredEocd[0].offset
    ? originalEocd[0].offset
    : null;
  const changedOffsets = [];
  let changedByteCount = 0;
  let differencesWithinEocdSizeFieldOnly = original.byteLength === recovered.byteLength && eocdOffset !== null;
  if (original.byteLength === recovered.byteLength) {
    for (let offset = 0; offset < original.byteLength; offset += 1) {
      if (original[offset] === recovered[offset]) continue;
      changedByteCount += 1;
      if (changedOffsets.length < 16) changedOffsets.push(offset);
      if (eocdOffset === null || offset < eocdOffset + 12 || offset >= eocdOffset + 16) {
        differencesWithinEocdSizeFieldOnly = false;
      }
    }
  } else {
    differencesWithinEocdSizeFieldOnly = false;
  }
  const originalDeclaredCentralDirectorySize = eocdOffset === null
    ? null
    : original.readUInt32LE(eocdOffset + 12);
  const recoveredDeclaredCentralDirectorySize = eocdOffset === null
    ? null
    : recovered.readUInt32LE(eocdOffset + 12);
  let correctedOriginal = null;
  if (differencesWithinEocdSizeFieldOnly) {
    correctedOriginal = Buffer.from(original);
    correctedOriginal.writeUInt32LE(recoveredDeclaredCentralDirectorySize, eocdOffset + 12);
  }
  const archiveMatchesAfterEocdCorrection = Boolean(
    correctedOriginal && correctedOriginal.equals(recovered),
  );
  if (!archiveMatchesAfterEocdCorrection) {
    return {
      status: 'MISMATCH',
      sourceByteLength: original.byteLength,
      recoveredByteLength: recovered.byteLength,
      eocdOffset,
      originalDeclaredCentralDirectorySize,
      recoveredDeclaredCentralDirectorySize,
      recoveryDeltaBytes: originalDeclaredCentralDirectorySize === null || recoveredDeclaredCentralDirectorySize === null
        ? null
        : originalDeclaredCentralDirectorySize - recoveredDeclaredCentralDirectorySize,
      changedByteCount,
      changedOffsets,
      differencesWithinEocdSizeFieldOnly,
      archiveMatchesAfterEocdCorrection,
    };
  }
  const [originalZip, recoveredZip] = await Promise.all([
    JSZip.loadAsync(correctedOriginal, { checkCRC32: false, createFolders: false }),
    JSZip.loadAsync(recovered, { checkCRC32: false, createFolders: false }),
  ]);
  const originalNames = Object.keys(originalZip.files)
    .filter((name) => !originalZip.files[name].dir && /\.xml$/iu.test(name))
    .sort();
  const recoveredNames = Object.keys(recoveredZip.files)
    .filter((name) => !recoveredZip.files[name].dir && /\.xml$/iu.test(name))
    .sort();
  if (originalNames.length > 20_000 || recoveredNames.length > 20_000) {
    throw new Error('XML entry comparison exceeds the Main archive entry budget');
  }
  let expandedBytes = 0;
  let identicalEntryCount = 0;
  let differingEntryCount = 0;
  let missingEntryCount = 0;
  for (const name of originalNames) {
    const originalEntry = originalZip.file(name);
    const recoveredEntry = recoveredZip.file(name);
    if (!originalEntry || !recoveredEntry) {
      missingEntryCount += 1;
      continue;
    }
    const [originalXml, recoveredXml] = await Promise.all([
      originalEntry.async('nodebuffer'),
      recoveredEntry.async('nodebuffer'),
    ]);
    expandedBytes += originalXml.byteLength + recoveredXml.byteLength;
    if (expandedBytes > 64 * 1024 * 1024) {
      throw new Error('Expanded XML comparison exceeds its 64 MiB evidence cap');
    }
    if (sha256(originalXml) === sha256(recoveredXml)) identicalEntryCount += 1;
    else differingEntryCount += 1;
  }
  for (const name of recoveredNames) {
    if (!originalZip.file(name)) missingEntryCount += 1;
  }
  return {
    status: originalNames.length === recoveredNames.length &&
        identicalEntryCount === originalNames.length &&
        differingEntryCount === 0 &&
        missingEntryCount === 0
      ? 'MATCH'
      : 'MISMATCH',
    recoveryField: 'EOCD.centralDirectorySize',
    sourceByteLength: original.byteLength,
    recoveredByteLength: recovered.byteLength,
    eocdOffset,
    originalDeclaredCentralDirectorySize,
    recoveredDeclaredCentralDirectorySize,
    recoveryDeltaBytes: originalDeclaredCentralDirectorySize - recoveredDeclaredCentralDirectorySize,
    changedByteCount,
    changedOffsets,
    differencesWithinEocdSizeFieldOnly,
    archiveMatchesAfterEocdCorrection,
    originalXmlEntryCount: originalNames.length,
    recoveredXmlEntryCount: recoveredNames.length,
    identicalEntryCount,
    differingEntryCount,
    missingEntryCount,
    comparedExpandedBytes: expandedBytes,
  };
}

function collectContextSymbols(frameContext) {
  const items = [];
  const visit = (elements, layerIndex) => {
    for (let elementIndex = 0; elementIndex < elements.length; elementIndex += 1) {
      const element = elements[elementIndex];
      if (!element || element.visible === false) continue;
      if (element.kind === 'symbol') items.push({ element, layerIndex, elementIndex });
      else if (element.kind === 'group') visit(element.elements, layerIndex);
    }
  };
  for (let layerIndex = 0; layerIndex < frameContext.layers.length; layerIndex += 1) {
    const layer = frameContext.layers[layerIndex];
    if (layer && layer.visible) visit(layer.elements, layerIndex);
  }
  return items;
}

function selectorFailureEvidence(failure, observedContexts, source) {
  const matches = [];
  for (const context of observedContexts) {
    for (const found of collectContextSymbols(context.frameContext)) {
      if (found.element.sourceAddress === failure.sourceAddress) {
        matches.push({ ...found, context });
      }
    }
  }
  const match = matches[0];
  if (!match) {
    return {
      selectorFailureCode: failure.code,
      sourceAddress: failure.sourceAddress || null,
      exactContextMatchCount: matches.length,
      evidenceStatus: 'SOURCE_ELEMENT_NOT_FOUND_IN_CAPTURED_CONTEXTS',
    };
  }
  const element = match.element;
  const descriptor = source.graphicSymbols.find(
    (symbol) => symbol.sourceLibraryItemName === element.libraryItemName,
  );
  const layerNumber = Number(match.element.sourceAddress.match(/\/layer-(\d+)-frame-/u)?.[1]);
  const parentSpanStart = element.sourceParentFrameSpanStart;
  const parentSpan = Number.isSafeInteger(layerNumber) && Number.isSafeInteger(parentSpanStart)
    ? match.context.frameSpanIndex.layers[layerNumber]?.spans.find((span) => span.index === parentSpanStart)
    : undefined;
  const authoredFrameAttributes = parentSpan && parentSpan.sourceFrame
    ? { ...parentSpan.sourceFrame.attributes }
    : null;
  const parentFrameIndex = element.sourceParentFrameIndex;
  const elapsed = Number.isSafeInteger(parentFrameIndex) && Number.isSafeInteger(parentSpanStart)
    ? parentFrameIndex - parentSpanStart
    : null;
  return {
    evidenceStatus: matches.length === 1 ? 'EXACT_MATCH' : 'AMBIGUOUS_EXACT_MATCH',
    selectorFailureCode: failure.code,
    selectorFailureMessage: failure.message,
    exactContextMatchCount: matches.length,
    sourceAddress: element.sourceAddress || null,
    contextScope: match.context.scope,
    contextFrameIndex: match.context.frameIndex,
    sourceLibraryItemName: element.libraryItemName,
    effectiveSymbolType: element.symbolType,
    rawInstanceAttributesPreservedByAdapter: {
      loopPresent: Object.prototype.hasOwnProperty.call(element, 'playbackMode'),
      loop: element.playbackMode ?? null,
      firstFramePresent: Object.prototype.hasOwnProperty.call(element, 'firstFrame'),
      firstFrame: element.firstFrame ?? null,
      lastFramePresent: Object.prototype.hasOwnProperty.call(element, 'lastFrame'),
      lastFrame: element.lastFrame ?? null,
    },
    owningSpan: {
      parentFrameIndex,
      parentSpanStart,
      elapsed,
      spanType: element.sourceParentSpanTweenType ?? null,
      rawDomFrameAttributes: authoredFrameAttributes,
      indexedSpan: parentSpan
        ? {
            index: parentSpan.index,
            duration: parentSpan.duration,
            endExclusive: parentSpan.endExclusive,
            tweenType: parentSpan.tweenType,
          }
        : null,
    },
    childTimeline: descriptor
      ? {
          sourceLibraryItemName: descriptor.sourceLibraryItemName,
          frameCount: descriptor.frameCount,
          totalTimelineFrameCount: descriptor.frameSpanIndex.frameCount,
        }
      : null,
    sourceTransform: element.localTransform || FLA_DISPLAY_LIST_IDENTITY_MATRIX,
  };
}

function collectContextSymbolsWithPath(frameContext) {
  const items = [];
  const visit = (elements, path) => {
    for (let elementIndex = 0; elementIndex < elements.length; elementIndex += 1) {
      const element = elements[elementIndex];
      if (!element || element.visible === false) continue;
      const segment = {
        elementIndex,
        kind: element.kind,
        sourceAddress: element.sourceAddress || null,
        libraryItemName: element.kind === 'symbol' ? element.libraryItemName : null,
      };
      if (element.kind === 'symbol') {
        items.push({ element, path: [...path, segment] });
      } else if (element.kind === 'group') {
        visit(element.elements, [...path, segment]);
      }
    }
  };
  for (let layerIndex = 0; layerIndex < frameContext.layers.length; layerIndex += 1) {
    const layer = frameContext.layers[layerIndex];
    if (layer && layer.visible) visit(layer.elements, [{ layerIndex }]);
  }
  return items;
}

function isolateFrameContextToSymbol(frameContext, candidate) {
  const isolateElements = (elements, path, pathIndex) => {
    const segment = path[pathIndex];
    const element = elements[segment.elementIndex];
    if (!element || element.kind !== segment.kind ||
        (segment.sourceAddress && element.sourceAddress !== segment.sourceAddress) ||
        (segment.libraryItemName && element.libraryItemName !== segment.libraryItemName)) {
      throw new Error('Source-address path changed while isolating a visible symbol instance');
    }
    if (pathIndex === path.length - 1) return [element];
    if (element.kind !== 'group') {
      throw new Error('Visible symbol source-address path crosses a non-group element');
    }
    return [{
      ...element,
      elements: isolateElements(element.elements, path, pathIndex + 1),
    }];
  };

  const layerSegment = candidate.path[0];
  const elementPath = candidate.path.slice(1);
  return {
    ...frameContext,
    layers: frameContext.layers.map((layer, layerIndex) => {
      if (!layer) return layer;
      return layerIndex === layerSegment.layerIndex
        ? { ...layer, elements: isolateElements(layer.elements, elementPath, 0) }
        : { ...layer, elements: [] };
    }),
  };
}

function findOwningSpanEvidence(frameSpanIndex, element) {
  const layerMatch = String(element.sourceAddress || '').match(/\/layer-(\d+)-frame-/u);
  const layerIndex = layerMatch ? Number(layerMatch[1]) : null;
  const spanStart = element.sourceParentFrameSpanStart;
  const layer = Number.isSafeInteger(layerIndex) ? frameSpanIndex.layers[layerIndex] : null;
  const span = layer && Number.isSafeInteger(spanStart)
    ? layer.spans.find((item) => item.index === spanStart)
    : null;
  const sourceFrameAttributes = span && span.sourceFrame
    ? { ...span.sourceFrame.attributes }
    : null;
  return {
    layerIndex,
    span: span ? {
      index: span.index,
      duration: span.duration,
      endExclusive: span.endExclusive,
      tweenType: span.tweenType,
      rawDomFrameAttributes: sourceFrameAttributes,
    } : null,
  };
}

function classifyIssue920SingleFrameBlocker(element, descriptorMatches, owningSpan, failure) {
  const parentFrameIndex = element.sourceParentFrameIndex;
  const parentSpanStart = element.sourceParentFrameSpanStart;
  const span = owningSpan.span;
  const rawMode = element.playbackMode;
  const mode = rawMode === undefined ? undefined : rawMode.trim().toLocaleLowerCase('en-US');
  const coordinatesValid = Number.isSafeInteger(parentFrameIndex) &&
    Number.isSafeInteger(parentSpanStart) && parentSpanStart >= 0 &&
    parentFrameIndex >= parentSpanStart;
  const spanValid = Boolean(span && span.index === parentSpanStart &&
    Number.isSafeInteger(span.duration) && span.duration > 0 &&
    span.endExclusive === span.index + span.duration &&
    parentFrameIndex >= span.index && parentFrameIndex < span.endExclusive &&
    span.tweenType === 'motion' && element.sourceParentSpanTweenType === 'motion');
  const isSameClass = failure.code === 'UNSUPPORTED_TIMING' &&
    /containing span starts at \d+ is outside the proven origin boundary/u.test(failure.message || '') &&
    element.symbolType === 'graphic' && mode === 'loop' &&
    !Object.prototype.hasOwnProperty.call(element, 'firstFrame') &&
    !Object.prototype.hasOwnProperty.call(element, 'lastFrame') &&
    descriptorMatches.length === 1 && descriptorMatches[0].frameCount === 1 &&
    coordinatesValid && spanValid && parentSpanStart > 0;
  return {
    isSameClass,
    coordinatesValid,
    spanValid,
    matchedGraphicDescriptorCount: descriptorMatches.length,
    childFrameCount: descriptorMatches.length === 1 ? descriptorMatches[0].frameCount : null,
    normalizedPlaybackMode: mode ?? null,
  };
}

function knownUnsupportedOtherSelectorPath(element, descriptorMatches, failure) {
  if (failure.code === 'UNSUPPORTED_SYMBOL_TYPE') return true;
  if (failure.code === 'UNKNOWN_PLAYBACK_DEFAULT') return false;
  if (failure.code !== 'UNSUPPORTED_TIMING') return false;
  if (element.symbolType !== 'graphic') return true;
  if (descriptorMatches.length !== 1) return false;
  if (element.playbackMode === undefined) return descriptorMatches[0].frameCount > 1;
  const mode = element.playbackMode.trim().toLocaleLowerCase('en-US');
  return mode !== 'loop' || element.firstFrame !== undefined || element.lastFrame !== undefined ||
    descriptorMatches[0].frameCount !== 1;
}

async function runN0Preflight(args) {
  for (const key of ['source', 'expected-sha', 'expected-render-target', 'output-dir']) {
    if (!args[key]) throw new Error('Missing --' + key + ' for --mode n0-preflight');
  }
  const expectedSha256 = args['expected-sha'].replace(/[^a-f0-9]/giu, '').toUpperCase();
  if (!/^[A-F0-9]{64}$/u.test(expectedSha256)) throw new Error('--expected-sha must be a 64-character SHA-256');
  const expectedTargetId = args['expected-render-target'];
  if (!/^fla-render-target-[a-f0-9]{64}$/u.test(expectedTargetId)) {
    throw new Error('--expected-render-target must be a stable Panda render target id');
  }

  const sourcePath = resolveOutsideRepo(args.source, 'Authorized source FLA');
  const outputDir = createFreshOutputDirectory(args['output-dir']);
  const userDataPath = outputPath(outputDir, '.electron-user-data');
  mkdirSync(userDataPath);
  app.setPath('userData', userDataPath);

  const receipt = {
    format: 'panda-issue920-com8-n0-preflight',
    version: 1,
    startedAt: new Date().toISOString(),
    status: 'RUNNING',
    gate: 'STOP',
    source: {
      basename: path.basename(sourcePath),
      expectedSha256,
      originalSha256: null,
      inputSha256After: null,
      inputUnchanged: null,
      mainSessionSha256: null,
      recoveryApplied: null,
    },
    target: {
      renderTargetId: expectedTargetId,
      sourceLibraryItemName: null,
      userLabel: null,
      frameCount: null,
      sourceFps: null,
    },
    coverage: {
      expectedFrameCount: EXPECTED_FRAME_COUNT,
      scannedFrameCount: 0,
      frameRowsAccountedExactlyOnce: false,
      classificationCounts: {
        SUPPORTED: 0,
        SINGLE_FRAME_SAME_CLASS: 0,
        UNSUPPORTED_OTHER: 0,
        UNKNOWN: 0,
      },
      visibleGraphicInstanceCount: 0,
      selectorCandidateCount: 0,
      selectorCallCount: 0,
      contextBuildCount: 0,
      scanBlindSpots: [],
    },
    frames: Array.from({ length: EXPECTED_FRAME_COUNT }, (_, frameIndex) => ({
      frameIndex,
      classification: 'UNKNOWN',
      coverageStatus: 'NOT_SCANNED',
      visibleGraphicInstanceCount: 0,
      selectorCandidateCount: 0,
      contextCount: 0,
      instances: [],
      blockers: [],
      scanBlindSpots: [],
    })),
    n0Decision: null,
    completedAt: null,
  };

  const parserWindowManager = new FlaParserWindowManager();
  const importService = new FlaImportService(parserWindowManager);
  const listeners = {
    onReady: (event) => { try { importService.markWorkerReady(event.sender.id); } catch (error) { console.error('Parser READY rejected:', error.message); } },
    onProgress: (event, payload) => { try { importService.markWorkerProgress(event.sender.id, payload); } catch (error) { console.error('Parser progress rejected:', error.message); } },
    onResult: (event, payload) => { try { importService.markWorkerResult(event.sender.id, payload); } catch (error) { console.error('Parser result rejected:', error.message); } },
    onError: (event, payload) => { try { importService.markWorkerError(event.sender.id, payload); } catch (error) { console.error('Parser error rejected:', error.message); } },
  };
  ipcMain.on(IPC_CHANNELS.FLA_WORKER_READY, listeners.onReady);
  ipcMain.on(IPC_CHANNELS.FLA_WORKER_PROGRESS, listeners.onProgress);
  ipcMain.on(IPC_CHANNELS.FLA_WORKER_RESULT, listeners.onResult);
  ipcMain.on(IPC_CHANNELS.FLA_WORKER_ERROR, listeners.onError);
  let sessionId = null;
  const startedAt = performance.now();

  try {
    const inputHashBefore = await sha256File(sourcePath);
    if (inputHashBefore !== expectedSha256) throw new Error('Authorized source SHA-256 does not match the requested digest');
    const inspection = await importService.inspectSource(sourcePath, randomUUID());
    if (!inspection.ok) throw new Error('Main FLA inspection rejected the source: ' + inspection.error.code + ' ' + inspection.error.message);
    sessionId = inspection.sessionId;
    const session = importService.getSession(sessionId);
    if (!session) throw new Error('Main FLA inspection did not retain an active source session');
    receipt.source.originalSha256 = session.originalSourceSha256.toUpperCase();
    receipt.source.mainSessionSha256 = sha256(session.sourceBytes);
    receipt.source.recoveryApplied = Boolean(inspection.trace && inspection.trace.recoveryApplied);
    if (receipt.source.originalSha256 !== expectedSha256) throw new Error('Main session source SHA-256 differs from the authorized source');

    const prepared = await prepareFlaStaticSnapshotDisplaySource(session.sourceBytes, 'preview');
    if (!prepared.ok) throw new Error('Main static display source preparation failed: ' + prepared.message);
    const source = prepared.source;
    const targetCandidates = source.graphicSymbols.filter((symbol) => stableRenderTargetId(
      session.sourceBytes,
      'graphic-symbol\u0000' + symbol.sourceLibraryItemName + '\u0000' + symbol.userLabel,
    ) === expectedTargetId);
    if (targetCandidates.length !== 1) throw new Error('Stable target ID resolved to ' + targetCandidates.length + ' Graphic symbols');
    const target = targetCandidates[0];
    receipt.target.sourceLibraryItemName = target.sourceLibraryItemName;
    receipt.target.userLabel = target.userLabel;
    receipt.target.frameCount = target.frameCount;
    receipt.target.sourceFps = inspection.ir.document.frameRate;
    if (target.frameCount !== EXPECTED_FRAME_COUNT) throw new Error('Target has ' + target.frameCount + ' frames; expected 21');
    if (inspection.ir.document.frameRate !== EXPECTED_FPS) throw new Error('Source frame rate is ' + inspection.ir.document.frameRate + '; expected 25');

    const descriptorByName = new Map();
    for (const descriptor of source.graphicSymbols) {
      const list = descriptorByName.get(descriptor.sourceLibraryItemName) || [];
      list.push(descriptor);
      descriptorByName.set(descriptor.sourceLibraryItemName, list);
    }

    for (let frameIndex = 0; frameIndex < EXPECTED_FRAME_COUNT; frameIndex += 1) {
      const row = receipt.frames[frameIndex];
      const worklist = [];
      const seenContexts = new Set();
      const markUnknown = (message, contextPath) => {
        row.scanBlindSpots.push({ message, contextPath: contextPath || null });
        receipt.coverage.scanBlindSpots.push({ frameIndex, message, contextPath: contextPath || null });
      };
      try {
        receipt.coverage.contextBuildCount += 1;
        const rootResult = source.buildGraphicFrameContext(
          target.timelineXml,
          target.frameSpanIndex,
          frameIndex,
          'graphic:' + target.sourceLibraryItemName,
        );
        if (!rootResult.ok) {
          markUnknown('Target frame context failed: ' + rootResult.message, 'graphic:' + target.sourceLibraryItemName);
        } else {
          worklist.push({
            frameContext: rootResult.value,
            timeline: target,
            sourcePath: [],
            contextPath: 'graphic:' + target.sourceLibraryItemName,
            depth: 0,
            symbolStack: [target.sourceLibraryItemName],
          });
        }
      } catch (error) {
        markUnknown('Target frame context threw: ' + (error instanceof Error ? error.message : String(error)), null);
      }

      while (worklist.length > 0) {
        if (performance.now() - startedAt > MAX_EXPERIMENT_WALL_TIME_MS) {
          markUnknown('Read-only N0 scan reached the ten-minute bounded runtime', null);
          worklist.length = 0;
          break;
        }
        if (row.contextCount >= 20_000) {
          markUnknown('Per-frame nested context coverage exceeded the 20,000-context scan cap', null);
          worklist.length = 0;
          break;
        }
        const work = worklist.shift();
        const contextKey = work.contextPath + '\u0000' + work.frameContext.frameIndex;
        if (seenContexts.has(contextKey)) continue;
        seenContexts.add(contextKey);
        row.contextCount += 1;
        if (work.depth > 64) {
          markUnknown('Nested Graphic path exceeded the selector depth bound', work.contextPath);
          continue;
        }
        if (work.frameContext.unsupportedDisplayReason) {
          markUnknown('Visible source content is outside the adapter coverage: ' + work.frameContext.unsupportedDisplayReason, work.contextPath);
        }

        const candidates = collectContextSymbolsWithPath(work.frameContext);
        row.selectorCandidateCount += candidates.length;
        row.visibleGraphicInstanceCount += candidates.filter(({ element }) => element.symbolType === 'graphic').length;
        receipt.coverage.selectorCandidateCount += candidates.length;
        receipt.coverage.visibleGraphicInstanceCount += candidates.filter(({ element }) => element.symbolType === 'graphic').length;

        for (const candidate of candidates) {
          const element = candidate.element;
          const address = element.sourceAddress || null;
          const descriptorMatches = descriptorByName.get(element.libraryItemName) || [];
          const owningSpan = findOwningSpanEvidence(work.timeline.frameSpanIndex, element);
          const parentFrameIndex = element.sourceParentFrameIndex ?? null;
          const parentSpanStart = element.sourceParentFrameSpanStart ?? null;
          const instance = {
            outerSourceFrameIndex: frameIndex,
            contextFrameIndex: work.frameContext.frameIndex,
            contextPath: work.contextPath,
            nestedSourcePath: [...work.sourcePath, address].filter(Boolean),
            nestingDepth: work.depth,
            sourceAddress: address,
            sourceLibraryItemName: element.libraryItemName,
            symbolType: element.symbolType,
            visible: element.visible !== false,
            owningSpan: {
              parentFrameIndex,
              parentSpanStart,
              elapsed: Number.isSafeInteger(parentFrameIndex) && Number.isSafeInteger(parentSpanStart)
                ? parentFrameIndex - parentSpanStart
                : null,
              spanType: element.sourceParentSpanTweenType ?? null,
              span: owningSpan.span,
            },
            rawInstanceAttributes: {
              loopPresent: Object.prototype.hasOwnProperty.call(element, 'playbackMode'),
              loop: element.playbackMode ?? null,
              firstFramePresent: Object.prototype.hasOwnProperty.call(element, 'firstFrame'),
              firstFrame: element.firstFrame ?? null,
              lastFramePresent: Object.prototype.hasOwnProperty.call(element, 'lastFrame'),
              lastFrame: element.lastFrame ?? null,
            },
            childGraphicCount: descriptorMatches.length === 1 ? descriptorMatches[0].frameCount : null,
            childDescriptorMatchCount: descriptorMatches.length,
            sourceTransform: element.localTransform || FLA_DISPLAY_LIST_IDENTITY_MATRIX,
            currentSelectorDecision: null,
            blockerClass: null,
            coverageStatus: 'PENDING',
          };
          row.instances.push(instance);

          let isolatedContext;
          try {
            isolatedContext = isolateFrameContextToSymbol(work.frameContext, candidate);
          } catch (error) {
            instance.currentSelectorDecision = {
              status: 'UNKNOWN_ISOLATION_FAILURE',
              message: error instanceof Error ? error.message : String(error),
            };
            instance.coverageStatus = 'UNKNOWN';
            markUnknown('Could not isolate a visible instance by its adapter source path', work.contextPath);
            continue;
          }

          const observedContexts = [];
          const observedSource = {
            ...source,
            buildGraphicFrameContext: (timelineXml, frameSpanIndex, selectedFrameIndex, scope) => {
              receipt.coverage.contextBuildCount += 1;
              const result = source.buildGraphicFrameContext(timelineXml, frameSpanIndex, selectedFrameIndex, scope);
              observedContexts.push({ scope, frameIndex: selectedFrameIndex, frameSpanIndex, frameContext: result.ok ? result.value : null, result, timelineXml });
              return result;
            },
          };
          receipt.coverage.selectorCallCount += 1;
          let selected;
          try {
            selected = prepareFlaNestedGraphicFrameSelections(observedSource, {
              kind: 'graphic',
              name: work.timeline.sourceLibraryItemName,
              frameContext: isolatedContext,
            });
          } catch (error) {
            selected = {
              ok: false,
              code: 'SCAN_EXCEPTION',
              message: error instanceof Error ? error.message : String(error),
              sourceAddress: address,
            };
          }

          const ownSelection = selected.ok
            ? selected.selections.find((selection) => selection.sourceAddress === address)
            : null;
          if (selected.ok && ownSelection) {
            instance.currentSelectorDecision = {
              status: 'SUPPORTED',
              selectedChildFrameIndex: ownSelection.selectedChildFrameIndex,
              selectionRule: ownSelection.selectionRule,
              effectiveFirstFrame: ownSelection.effectiveFirstFrame,
            };
            instance.coverageStatus = 'COVERED';
          } else if (!selected.ok && selected.sourceAddress === address) {
            instance.currentSelectorDecision = {
              status: 'BLOCKED',
              code: selected.code,
              message: selected.message,
            };
            const sameClass = classifyIssue920SingleFrameBlocker(element, descriptorMatches, owningSpan, selected);
            if (sameClass.isSameClass) {
              instance.blockerClass = 'SINGLE_FRAME_SAME_CLASS';
              instance.coverageStatus = 'COVERED_UNIQUE_CHILD_FRAME';
              row.blockers.push({
                sourceAddress: address,
                libraryItemName: element.libraryItemName,
                failure: { code: selected.code, message: selected.message },
                blockerClass: 'SINGLE_FRAME_SAME_CLASS',
                uniquenessEvidence: sameClass,
              });
            } else {
              const other = knownUnsupportedOtherSelectorPath(element, descriptorMatches, selected);
              instance.blockerClass = other ? 'UNSUPPORTED_OTHER' : 'UNKNOWN';
              instance.coverageStatus = 'UNKNOWN_UNSELECTED_CHILD_FRAME';
              if (other) {
                row.blockers.push({
                  sourceAddress: address,
                  libraryItemName: element.libraryItemName,
                  failure: { code: selected.code, message: selected.message },
                  blockerClass: 'UNSUPPORTED_OTHER',
                  uniquenessEvidence: sameClass,
                });
              }
              markUnknown('A blocked instance has no safely selected child frame, so its nested source path cannot be exhausted', work.contextPath);
            }
          } else if (!selected.ok) {
            const directChildPrefix = 'nested:' + address + '->';
            const directChild = observedContexts.find((context) => context.scope.startsWith(directChildPrefix));
            if (directChild && directChild.result.ok) {
              instance.currentSelectorDecision = {
                status: 'SELECTED_DESCENDANT_BLOCKED',
                descendantFailure: {
                  code: selected.code,
                  message: selected.message,
                  sourceAddress: selected.sourceAddress || null,
                },
              };
              instance.coverageStatus = 'COVERED_CHILD_CONTEXT';
            } else {
              instance.currentSelectorDecision = {
                status: 'UNKNOWN_SELECTOR_FAILURE',
                code: selected.code,
                message: selected.message,
                sourceAddress: selected.sourceAddress || null,
              };
              instance.coverageStatus = 'UNKNOWN';
              markUnknown('Selector failure could not be tied to a safely selected descendant context', work.contextPath);
            }
          } else {
            instance.currentSelectorDecision = { status: 'UNKNOWN_SELECTION_NOT_RETURNED' };
            instance.coverageStatus = 'UNKNOWN';
            markUnknown('Selector succeeded without returning a decision for the isolated instance', work.contextPath);
          }

          const directChildPrefix = 'nested:' + address + '->';
          if (work.symbolStack.includes(element.libraryItemName) && observedContexts.some((context) => context.scope.startsWith(directChildPrefix))) {
            instance.coverageStatus = 'UNKNOWN_SYMBOL_CYCLE';
            markUnknown('Selected child Graphic repeats a source symbol already on the nested path', address);
          }
          for (const childContext of observedContexts) {
            if (!childContext.scope.startsWith(directChildPrefix)) continue;
            if (!childContext.result.ok || !childContext.frameContext) {
              instance.coverageStatus = 'UNKNOWN_CHILD_CONTEXT_FAILED';
              markUnknown('Selected child Graphic frame context failed: ' + childContext.result.message, childContext.scope);
              continue;
            }
            if (work.symbolStack.includes(element.libraryItemName)) continue;
            const childDescriptor = descriptorMatches.length === 1 ? descriptorMatches[0] : null;
            if (!childDescriptor) {
              markUnknown('Selected child context has no unique Graphic descriptor identity', childContext.scope);
              continue;
            }
            worklist.push({
              frameContext: childContext.frameContext,
              timeline: childDescriptor,
              sourcePath: [...work.sourcePath, address],
              contextPath: childContext.scope,
              depth: work.depth + 1,
              symbolStack: [...work.symbolStack, element.libraryItemName],
            });
          }

          if (instance.blockerClass === 'SINGLE_FRAME_SAME_CLASS') {
            const childDescriptor = descriptorMatches[0];
            if (work.symbolStack.includes(element.libraryItemName)) {
              instance.coverageStatus = 'UNKNOWN_SYMBOL_CYCLE';
              markUnknown('Single-frame blocked instance repeats a symbol already on its source path', address);
            } else if (work.depth >= 64) {
              instance.coverageStatus = 'UNKNOWN_DEPTH_LIMIT';
              markUnknown('Single-frame blocked instance reaches the nested depth limit', address);
            } else {
              const manualScope = 'issue920-n0-unique-child:' + address + '->' + element.libraryItemName + '@0';
              receipt.coverage.contextBuildCount += 1;
              const childResult = source.buildGraphicFrameContext(
                childDescriptor.timelineXml,
                childDescriptor.frameSpanIndex,
                0,
                manualScope,
              );
              if (!childResult.ok) {
                instance.coverageStatus = 'UNKNOWN_UNIQUE_CHILD_CONTEXT_FAILED';
                markUnknown('Unique frame-0 child context failed: ' + childResult.message, manualScope);
              } else {
                worklist.push({
                  frameContext: childResult.value,
                  timeline: childDescriptor,
                  sourcePath: [...work.sourcePath, address],
                  contextPath: manualScope,
                  depth: work.depth + 1,
                  symbolStack: [...work.symbolStack, element.libraryItemName],
                });
              }
            }
          }
        }
      }

      const unknown = row.scanBlindSpots.length > 0 || row.instances.some((item) => item.blockerClass === 'UNKNOWN' || item.coverageStatus.startsWith('UNKNOWN'));
      const other = row.blockers.some((item) => item.blockerClass === 'UNSUPPORTED_OTHER');
      const sameClass = row.blockers.some((item) => item.blockerClass === 'SINGLE_FRAME_SAME_CLASS');
      row.classification = unknown ? 'UNKNOWN' : other ? 'UNSUPPORTED_OTHER' : sameClass ? 'SINGLE_FRAME_SAME_CLASS' : 'SUPPORTED';
      row.coverageStatus = unknown ? 'INCOMPLETE_OR_UNKNOWN' : 'COMPLETE_REACHABLE_VISIBLE_PATHS';
      receipt.coverage.scannedFrameCount += 1;
      receipt.coverage.classificationCounts[row.classification] += 1;
      process.stderr.write('[N0] scanned target frame ' + frameIndex + ': ' + row.classification + ', contexts=' + row.contextCount + ', instances=' + row.instances.length + '\n');
    }

    receipt.coverage.frameRowsAccountedExactlyOnce = receipt.frames.length === EXPECTED_FRAME_COUNT &&
      receipt.frames.every((row, index) => row.frameIndex === index &&
        ['SUPPORTED', 'SINGLE_FRAME_SAME_CLASS', 'UNSUPPORTED_OTHER', 'UNKNOWN'].includes(row.classification)) &&
      Object.values(receipt.coverage.classificationCounts).reduce((sum, count) => sum + count, 0) === EXPECTED_FRAME_COUNT;
    const onlySameClassBlockers = receipt.coverage.classificationCounts.SINGLE_FRAME_SAME_CLASS > 0 &&
      receipt.coverage.classificationCounts.SUPPORTED + receipt.coverage.classificationCounts.SINGLE_FRAME_SAME_CLASS === EXPECTED_FRAME_COUNT &&
      receipt.frames.every((row) => row.blockers.every((blocker) => blocker.blockerClass === 'SINGLE_FRAME_SAME_CLASS'));
    receipt.n0Decision = {
      gate: onlySameClassBlockers && receipt.coverage.frameRowsAccountedExactlyOnce ? 'GO_ONE_SHOT_FIX' : 'STOP_NO_PRODUCTION_EDIT',
      reason: onlySameClassBlockers
        ? 'Every frame is fully covered; all remaining selector blockers are the uniquely legal one-frame motion-tween Loop case.'
        : 'At least one frame is UNKNOWN, UNSUPPORTED_OTHER, or the scan did not prove that every remaining blocker is the same one-frame case.',
      productionSelectorEdited: false,
      sourceArtworkWritten: false,
    };
    receipt.gate = receipt.n0Decision.gate;
    receipt.status = 'COMPLETE';
  } catch (error) {
    receipt.status = 'INCOMPLETE';
    receipt.failure = error instanceof Error ? error.message : String(error);
    receipt.n0Decision = {
      gate: 'STOP_NO_PRODUCTION_EDIT',
      reason: 'The N0 preflight did not complete safely; unscanned rows remain UNKNOWN.',
      productionSelectorEdited: false,
      sourceArtworkWritten: false,
    };
    receipt.gate = 'STOP_NO_PRODUCTION_EDIT';
  } finally {
    for (const row of receipt.frames) {
      if (row.coverageStatus === 'NOT_SCANNED') {
        const message = 'Frame was not scanned: ' + (receipt.failure || 'the preflight stopped before reaching this frame');
        row.scanBlindSpots.push({ message, contextPath: null });
        receipt.coverage.scanBlindSpots.push({ frameIndex: row.frameIndex, message, contextPath: null });
      }
    }
    receipt.coverage.classificationCounts = {
      SUPPORTED: 0,
      SINGLE_FRAME_SAME_CLASS: 0,
      UNSUPPORTED_OTHER: 0,
      UNKNOWN: 0,
    };
    for (const row of receipt.frames) receipt.coverage.classificationCounts[row.classification] += 1;
    receipt.coverage.frameRowsAccountedExactlyOnce = receipt.frames.length === EXPECTED_FRAME_COUNT &&
      receipt.frames.every((row, index) => row.frameIndex === index &&
        ['SUPPORTED', 'SINGLE_FRAME_SAME_CLASS', 'UNSUPPORTED_OTHER', 'UNKNOWN'].includes(row.classification)) &&
      Object.values(receipt.coverage.classificationCounts).reduce((sum, count) => sum + count, 0) === EXPECTED_FRAME_COUNT;
    if (sessionId) {
      try { importService.releaseSession(sessionId); } catch { /* best-effort private-session cleanup */ }
    }
    try { importService.close(); } catch { /* best-effort parser-window cleanup */ }
    ipcMain.removeListener(IPC_CHANNELS.FLA_WORKER_READY, listeners.onReady);
    ipcMain.removeListener(IPC_CHANNELS.FLA_WORKER_PROGRESS, listeners.onProgress);
    ipcMain.removeListener(IPC_CHANNELS.FLA_WORKER_RESULT, listeners.onResult);
    ipcMain.removeListener(IPC_CHANNELS.FLA_WORKER_ERROR, listeners.onError);
    try {
      receipt.source.inputSha256After = await sha256File(sourcePath);
      receipt.source.inputUnchanged = receipt.source.inputSha256After === expectedSha256;
    } catch (error) {
      receipt.source.inputSha256After = null;
      receipt.source.inputUnchanged = false;
      receipt.source.inputHashAfterError = error instanceof Error ? error.message : String(error);
    }
    if (receipt.source.inputUnchanged === false) {
      receipt.status = 'INCOMPLETE';
      receipt.gate = 'STOP_NO_PRODUCTION_EDIT';
      receipt.n0Decision = {
        gate: 'STOP_NO_PRODUCTION_EDIT',
        reason: 'Source hash after inspection did not match the authorized digest.',
        productionSelectorEdited: false,
        sourceArtworkWritten: false,
      };
    }
    receipt.metrics = { elapsedMs: Math.round(performance.now() - startedAt) };
    receipt.completedAt = new Date().toISOString();
    try {
      writeJson(outputPath(outputDir, 'n0-receipt.json'), receipt);
    } catch (error) {
      console.error('Could not write private N0 receipt:', error instanceof Error ? error.message : String(error));
    }
  }
  process.stdout.write(JSON.stringify({
    status: receipt.status,
    gate: receipt.gate,
    outputDirectory: outputDir,
    frameRowsAccountedExactlyOnce: receipt.coverage.frameRowsAccountedExactlyOnce,
    classificationCounts: receipt.coverage.classificationCounts,
    failure: receipt.failure || null,
  }, null, 2) + '\n');
  return receipt.gate === 'GO_ONE_SHOT_FIX' ? 0 : 2;
}

function inspectPngHeader(buffer) {
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer);
  if (buffer.length < 33 || buffer.readUInt32BE(0) !== 0x89504e47) {
    throw new Error('PNG signature is invalid');
  }
  if (buffer.toString('ascii', 12, 16) !== 'IHDR') throw new Error('PNG IHDR chunk is missing');
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (!width || !height || width > 4096 || height > 4096 || width * height > MAX_OUTPUT_PIXELS) {
    throw new Error('PNG dimensions exceed the existing image budget');
  }
  return { width, height };
}

function decodePng(buffer) {
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!buffer.subarray(0, 8).equals(signature)) throw new Error('PNG signature is invalid');
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let interlace = -1;
  const idat = [];
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const start = offset + 8;
    const end = start + length;
    if (end + 4 > buffer.length) throw new Error('PNG chunk length exceeds file size');
    const data = buffer.subarray(start, end);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset = end + 4;
  }
  if (!width || !height || width > 4096 || height > 4096 || width * height > MAX_OUTPUT_PIXELS) {
    throw new Error('PNG dimensions exceed the existing image budget');
  }
  if (bitDepth !== 8 || interlace !== 0) {
    throw new Error('PNG comparison supports non-interlaced 8-bit images only');
  }
  const components = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 0 ? 1 : 0;
  if (!components) throw new Error('PNG color type ' + colorType + ' is unsupported');
  const rowBytes = width * components;
  const expectedBytes = (rowBytes + 1) * height;
  if (expectedBytes > 64 * 1024 * 1024) throw new Error('PNG decoded bytes exceed comparison budget');
  const raw = zlib.inflateSync(Buffer.concat(idat), { maxOutputLength: expectedBytes });
  if (raw.length !== expectedBytes) throw new Error('PNG decoded byte count is invalid');
  const decoded = Buffer.allocUnsafe(rowBytes * height);
  const paeth = (left, above, upperLeft) => {
    const estimate = left + above - upperLeft;
    const dl = Math.abs(estimate - left);
    const da = Math.abs(estimate - above);
    const dul = Math.abs(estimate - upperLeft);
    return dl <= da && dl <= dul ? left : da <= dul ? above : upperLeft;
  };
  for (let row = 0; row < height; row += 1) {
    const filter = raw[row * (rowBytes + 1)];
    const rawOffset = row * (rowBytes + 1) + 1;
    const outputOffset = row * rowBytes;
    for (let column = 0; column < rowBytes; column += 1) {
      const sourceValue = raw[rawOffset + column];
      const left = column >= components ? decoded[outputOffset + column - components] : 0;
      const above = row > 0 ? decoded[outputOffset + column - rowBytes] : 0;
      const upperLeft = row > 0 && column >= components
        ? decoded[outputOffset + column - rowBytes - components]
        : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = above;
      else if (filter === 3) predictor = Math.floor((left + above) / 2);
      else if (filter === 4) predictor = paeth(left, above, upperLeft);
      else if (filter !== 0) throw new Error('PNG row uses unsupported filter ' + filter);
      decoded[outputOffset + column] = (sourceValue + predictor) & 0xff;
    }
  }
  const rgba = Buffer.allocUnsafe(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const sourceOffset = pixel * components;
    const targetOffset = pixel * 4;
    if (colorType === 6) {
      decoded.copy(rgba, targetOffset, sourceOffset, sourceOffset + 4);
    } else if (colorType === 2) {
      rgba[targetOffset] = decoded[sourceOffset];
      rgba[targetOffset + 1] = decoded[sourceOffset + 1];
      rgba[targetOffset + 2] = decoded[sourceOffset + 2];
      rgba[targetOffset + 3] = 255;
    } else if (colorType === 4) {
      rgba[targetOffset] = decoded[sourceOffset];
      rgba[targetOffset + 1] = decoded[sourceOffset];
      rgba[targetOffset + 2] = decoded[sourceOffset];
      rgba[targetOffset + 3] = decoded[sourceOffset + 1];
    } else {
      rgba[targetOffset] = decoded[sourceOffset];
      rgba[targetOffset + 1] = decoded[sourceOffset];
      rgba[targetOffset + 2] = decoded[sourceOffset];
      rgba[targetOffset + 3] = 255;
    }
  }
  return { width, height, rgba };
}

function comparePngs(leftBytes, rightBytes) {
  const leftHash = sha256(leftBytes);
  const rightHash = sha256(rightBytes);
  const leftHeader = inspectPngHeader(leftBytes);
  const rightHeader = inspectPngHeader(rightBytes);
  const result = {
    byteIdentical: leftHash === rightHash,
    pixelIdentical: false,
    leftSha256: leftHash,
    rightSha256: rightHash,
    leftDimensions: leftHeader,
    rightDimensions: rightHeader,
    differingPixelCount: null,
    maxChannelDelta: null,
    meanAbsoluteChannelDelta: null,
  };
  if (leftHeader.width !== rightHeader.width || leftHeader.height !== rightHeader.height) return result;
  if (result.byteIdentical) {
    result.pixelIdentical = true;
    result.differingPixelCount = 0;
    result.maxChannelDelta = 0;
    result.meanAbsoluteChannelDelta = 0;
    return result;
  }
  const left = decodePng(leftBytes);
  const right = decodePng(rightBytes);
  let differingPixels = 0;
  let maxDelta = 0;
  let deltaSum = 0;
  for (let index = 0; index < left.rgba.length; index += 4) {
    let pixelDiffers = false;
    for (let channel = 0; channel < 4; channel += 1) {
      const delta = Math.abs(left.rgba[index + channel] - right.rgba[index + channel]);
      if (delta !== 0) pixelDiffers = true;
      maxDelta = Math.max(maxDelta, delta);
      deltaSum += delta;
    }
    if (pixelDiffers) differingPixels += 1;
  }
  result.pixelIdentical = differingPixels === 0;
  result.differingPixelCount = differingPixels;
  result.maxChannelDelta = maxDelta;
  result.meanAbsoluteChannelDelta = deltaSum / left.rgba.length;
  return result;
}

function matrixMultiply(parent, local) {
  return {
    a: parent.a * local.a + parent.c * local.b,
    b: parent.b * local.a + parent.d * local.b,
    c: parent.a * local.c + parent.c * local.d,
    d: parent.b * local.c + parent.d * local.d,
    tx: parent.a * local.tx + parent.c * local.ty + parent.tx,
    ty: parent.b * local.tx + parent.d * local.ty + parent.ty,
  };
}

function visibleElements(frameContext) {
  const result = [];
  for (let layerIndex = 0; layerIndex < frameContext.layers.length; layerIndex += 1) {
    const layer = frameContext.layers[layerIndex];
    if (!layer || !layer.visible || layer.maskLayerId) continue;
    for (let elementIndex = 0; elementIndex < layer.elements.length; elementIndex += 1) {
      const element = layer.elements[elementIndex];
      if (element && element.visible !== false) {
        result.push({ layerIndex, elementIndex, layer, element });
      }
    }
  }
  return result;
}

function maskDependencies(frameContext, contextPath) {
  return frameContext.layers.flatMap((layer, layerIndex) => {
    if (!layer.maskLayerId && !layer.maskedBy) return [];
    return [{
      contextPath,
      layerIndex,
      layerName: layer.name,
      maskLayerId: layer.maskLayerId || null,
      maskedBy: layer.maskedBy || null,
      layerVisible: layer.visible,
    }];
  });
}

function collectPartUnits(root, symbols, sourceSha256) {
  const units = [];
  const notices = [];

  function append(element, segment, pathSegments, worldTransform, contextPath, layer, compositeReason) {
    const pathIdentity = pathSegments.map((item) => {
      const address = item.sourceAddress || item.adapterIdentity || item.libraryItemName || item.kind;
      return address + '@' + item.layerIndex + ':' + item.elementIndex;
    }).join('>');
    const normalizedPath = pathSegments.map((item) => {
      const address = normalizeSourceAddress(item.sourceAddress || item.adapterIdentity || item.libraryItemName || item.kind);
      return address + '@' + item.layerIndex + ':' + item.elementIndex;
    }).join('>');
    const sourceKind = element.kind === 'symbol'
      ? 'graphic-symbol-occurrence'
      : element.kind + '-occurrence';
    const trackKey = sourceKind + '\u0000' + normalizedPath;
    const trackDigest = createHash('sha256')
      .update(sourceSha256)
      .update('\u0000' + trackKey)
      .digest('hex')
      .slice(0, 24);
    const directAddress = element.sourceAddress || null;
    if (!directAddress) {
      notices.push({
        code: 'MISSING_SOURCE_ADDRESS',
        message: 'An adapted element has no source address; identity uses its bounded adapter path.',
        adapterIdentity: element.shapeId || element.groupId || element.libraryItemName || null,
      });
    }
    units.push({
      trackKey,
      trackId: 'part-track-' + trackDigest,
      sourceKind,
      terminalKind: element.kind,
      sourceSymbolId: element.kind === 'symbol' ? element.libraryItemName : null,
      sourceAddress: directAddress,
      sourceAddressPath: pathSegments.map((item) => item.sourceAddress || null),
      normalizedSourcePath: normalizedPath,
      rawSourcePath: pathIdentity,
      contextPath,
      localTransform: element.localTransform || FLA_DISPLAY_LIST_IDENTITY_MATRIX,
      worldTransform,
      sourceFrame: {
        parentFrameIndex: element.sourceParentFrameIndex ?? null,
        parentFrameSpanStart: element.sourceParentFrameSpanStart ?? null,
        parentSpanTweenType: element.sourceParentSpanTweenType ?? null,
        playbackMode: element.playbackMode ?? null,
        firstFrame: element.firstFrame ?? null,
        lastFrame: element.lastFrame ?? null,
      },
      layer: {
        name: layer.name,
        sourceLayerIndex: segment.layerIndex,
        visible: layer.visible,
      },
      drawOrder: units.length,
      composite: Boolean(compositeReason),
      compositeReason: compositeReason || null,
      maskDependencies: pathSegments.flatMap((item) => item.maskDependencies || []),
      isolatePath: pathSegments.map((item) => ({
        layerIndex: item.layerIndex,
        elementIndex: item.elementIndex,
        sourceAddress: item.sourceAddress || null,
        libraryItemName: item.libraryItemName || null,
        kind: item.kind,
        adapterIdentity: item.adapterIdentity || null,
      })),
    });
  }

  function walk(frameContext, contextPath, parentWorld, prefixSegments, symbolStack, sourceSha256) {
    for (let layerIndex = 0; layerIndex < frameContext.layers.length; layerIndex += 1) {
      const layer = frameContext.layers[layerIndex];
      if (!layer || !layer.visible || layer.maskLayerId) continue;
      for (let elementIndex = 0; elementIndex < layer.elements.length; elementIndex += 1) {
        const element = layer.elements[elementIndex];
        if (!element || element.visible === false) continue;
        const local = element.localTransform || FLA_DISPLAY_LIST_IDENTITY_MATRIX;
        const world = matrixMultiply(parentWorld, local);
        const segment = { layerIndex, elementIndex, layer, element };
        const segmentForPath = {
          ...element,
          kind: element.kind,
          layerIndex,
          elementIndex,
          contextPath,
          adapterIdentity: element.shapeId || element.groupId || element.libraryItemName || null,
          maskDependencies: maskDependencies(frameContext, contextPath),
        };
        if (element.kind !== 'symbol') {
          append(
            element,
            segment,
            [...prefixSegments, segmentForPath],
            world,
            contextPath,
            layer,
            element.kind === 'group'
              ? 'Group kept atomic to preserve authored membership and painter order.'
              : null,
          );
          continue;
        }

        const definitionKey = element.frameSelectionKey || element.libraryItemName;
        const definition = symbols.get(definitionKey);
        const occurrencePath = [...prefixSegments, segmentForPath];
        if (!definition || definition.kind !== 'graphic' || element.symbolType !== 'graphic') {
          append(
            element,
            segment,
            occurrencePath,
            world,
            contextPath,
            layer,
            !definition ? 'Missing Graphic definition; retained as one closed occurrence.' :
              'Unsupported symbol kind; retained as one closed occurrence.',
          );
          notices.push({
            code: 'COMPOSITE_SYMBOL',
            sourceAddress: element.sourceAddress || null,
            reason: 'symbol definition or type could not be expanded safely',
          });
          continue;
        }
        if (symbolStack.includes(element.libraryItemName)) {
          append(element, segment, occurrencePath, world, contextPath, layer, 'Symbol cycle retained as a closed occurrence.');
          notices.push({ code: 'SYMBOL_CYCLE', sourceAddress: element.sourceAddress || null });
          continue;
        }
        const children = visibleElements(definition.frameContext);
        const childSymbols = children.filter((item) => item.element.kind === 'symbol');
        const childOtherContent = children.filter((item) => item.element.kind !== 'symbol');
        const definitionHasMask = definition.frameContext.layers.some((item) => item.maskLayerId || item.maskedBy);
        const canDescend = childSymbols.length > 0 &&
          childOtherContent.length === 0 &&
          !definitionHasMask &&
          !definition.frameContext.unsupportedDisplayReason;
        if (canDescend) {
          walk(
            definition.frameContext,
            'graphic:' + element.libraryItemName,
            world,
            occurrencePath,
            [...symbolStack, element.libraryItemName],
            sourceSha256,
          );
          continue;
        }
        const reasons = [];
        if (childSymbols.length > 0 && childOtherContent.length > 0) {
          reasons.push('Nested Graphic instances share the definition with vector, bitmap, or group content.');
        }
        if (definitionHasMask) reasons.push('Graphic owns mask dependencies.');
        if (definition.frameContext.unsupportedDisplayReason) reasons.push(definition.frameContext.unsupportedDisplayReason);
        if (children.length === 0) reasons.push('Blank Graphic definition.');
        append(
          element,
          segment,
          occurrencePath,
          world,
          contextPath,
          layer,
          reasons.length ? reasons.join(' ') : null,
        );
      }
    }
  }

  // Attach the source hash to path segments so track ids have a stable source scope.
  walk(root.frameContext, 'graphic:' + root.name, FLA_DISPLAY_LIST_IDENTITY_MATRIX, [], [], sourceSha256);
  for (const unit of units) {
    const digest = createHash('sha256')
      .update(sourceSha256)
      .update('\u0000')
      .update(unit.sourceAddressPath.map((address) => normalizeSourceAddress(address || '(missing)')).join('>'))
      .update('\u0000' + unit.sourceKind + '\u0000' + unit.normalizedSourcePath)
      .digest('hex')
      .slice(0, 24);
    unit.trackId = 'part-track-' + digest;
  }
  return { units, notices };
}

function normalizeSourceAddress(value) {
  return String(value)
    .replace(/(->[^/]+)@\d+(?=\/)/gu, '$1@child-frame')
    .replace(/(\/layer-\d+-frame-)\d+/gu, '$1span')
    .replace(/(\/frame-)\d+(?=\/)/gu, '$1span');
}

function pruneFrameContext(frameContext, segment, selectedElement) {
  return {
    ...frameContext,
    layers: frameContext.layers.map((layer, index) => {
      if (!layer) return layer;
      if (index === segment.layerIndex) return { ...layer, elements: [selectedElement] };
      if (layer.maskLayerId) return layer;
      return { ...layer, elements: [] };
    }),
  };
}

function isolateOccurrence(root, sourceSymbols, isolatePath, trackId) {
  const symbols = new Map(sourceSymbols);
  let overlayCounter = 0;

  function isolate(frameContext, pathIndex) {
    const pathItem = isolatePath[pathIndex];
    const layer = frameContext.layers[pathItem.layerIndex];
    const element = layer && layer.elements[pathItem.elementIndex];
    if (!layer || !element) throw new Error('Isolate path no longer resolves at index ' + pathIndex);
    if ((element.sourceAddress || null) !== pathItem.sourceAddress || element.kind !== pathItem.kind) {
      throw new Error('Isolate path identity changed at index ' + pathIndex);
    }
    const currentIdentity = element.shapeId || element.groupId || element.libraryItemName || null;
    if (pathItem.adapterIdentity && currentIdentity !== pathItem.adapterIdentity) {
      throw new Error('Isolate adapter identity changed at index ' + pathIndex);
    }
    if (pathIndex === isolatePath.length - 1) return pruneFrameContext(frameContext, pathItem, element);
    if (element.kind !== 'symbol') throw new Error('Only Graphic ancestors may be traversed for part isolation');
    const definitionKey = element.frameSelectionKey || element.libraryItemName;
    const definition = symbols.get(definitionKey);
    if (!definition || definition.kind !== 'graphic') {
      throw new Error('Missing selected Graphic definition while isolating ' + element.libraryItemName);
    }
    const isolatedChild = isolate(definition.frameContext, pathIndex + 1);
    const overlayKey = 'issue918:' + trackId + ':' + overlayCounter;
    overlayCounter += 1;
    symbols.set(overlayKey, { ...definition, frameContext: isolatedChild });
    const isolatedElement = { ...element, frameSelectionKey: overlayKey };
    return pruneFrameContext(frameContext, pathItem, isolatedElement);
  }

  return {
    root: {
      ...root,
      frameContext: isolate(root.frameContext, 0),
    },
    symbols,
  };
}

function buildFrame(source, target, frameIndex, mediaLookup, run) {
  if (!Number.isSafeInteger(frameIndex) || frameIndex < 0 || frameIndex >= target.frameCount) {
    fail('A', 'FRAME_OUT_OF_RANGE', 'Requested target frame is outside the prepared Graphic timeline.');
  }
  const shapeBlocks = new Map();
  const observedContexts = [];
  let shapeXmlByteLength = 0;
  const mergeCurrentShapeBlocks = () => {
    for (const [shapeId, xml] of source.shapeBlocks) {
      if (shapeBlocks.has(shapeId)) continue;
      shapeXmlByteLength += Buffer.byteLength(xml, 'utf8');
      if (shapeBlocks.size + 1 > MAX_AGGREGATE_SHAPE_BLOCKS ||
          shapeXmlByteLength > MAX_AGGREGATE_SHAPE_XML_BYTES) {
        fail('A', 'SHAPE_BLOCK_ACCUMULATION_BUDGET_EXCEEDED', 'Frame-scoped shape definitions exceed the prototype 100,000-block / 64 MiB cap.');
      }
      shapeBlocks.set(shapeId, xml);
    }
  };
  mergeCurrentShapeBlocks();
  const frameSource = {
    ...source,
    shapeBlocks,
    buildGraphicFrameContext: (timelineXml, frameSpanIndex, selectedFrameIndex, scope) => {
      const result = source.buildGraphicFrameContext(
        timelineXml,
        frameSpanIndex,
        selectedFrameIndex,
        scope,
      );
      if (result.ok) mergeCurrentShapeBlocks();
      if (result.ok) observedContexts.push({
        scope,
        frameIndex: selectedFrameIndex,
        frameSpanIndex,
        frameContext: result.value,
      });
      return result;
    },
  };
  const context = frameSource.buildGraphicFrameContext(
    target.timelineXml,
    target.frameSpanIndex,
    frameIndex,
    'graphic:' + target.sourceLibraryItemName,
  );
  run.metrics.targetFrameContextBuildCount += 1;
  if (!context.ok) {
    fail('A', 'FRAME_CONTEXT_UNSUPPORTED', 'Graphic frame ' + frameIndex + ' is unsupported: ' + context.message);
  }
  if (context.value.frameIndex !== frameIndex) {
    fail('A', 'FRAME_IDENTITY_MISMATCH', 'Graphic frame context identity does not match requested source frame ' + frameIndex);
  }
  const root = {
    kind: 'graphic',
    name: target.sourceLibraryItemName,
    frameContext: context.value,
  };
  const selected = prepareFlaNestedGraphicFrameSelections(frameSource, root);
  run.metrics.nestedSelectorCallCount += 1;
  if (!selected.ok) {
    const evidence = selectorFailureEvidence(selected, observedContexts, source);
    run.rawFirstBlocker = evidence;
    failWithDetails(
      'A',
      selected.code,
      'Nested Graphic selection failed at frame ' + frameIndex + ': ' + selected.message,
      evidence,
    );
  }
  const resolved = resolveFlaDisplayList(selected.resolverInput);
  run.metrics.fullFrameResolveCount += 1;
  if (!resolved.ok) {
    fail('A', 'DISPLAY_LIST_UNSUPPORTED', 'Graphic frame ' + frameIndex + ' could not be resolved: ' + resolved.message);
  }
  const composed = buildSvgForResolvedDisplayList({
    displayList: resolved.displayList,
    renderTargetId: target.renderTargetId,
    stageWidth: source.stageWidth,
    stageHeight: source.stageHeight,
    shapeBlocks: frameSource.shapeBlocks,
    resolveBitmapMedia: mediaLookup,
  });
  if (!composed.ok) {
    fail('A', 'FRAME_COMPOSITION_UNSUPPORTED', 'Graphic frame ' + frameIndex + ' could not be composed: ' + composed.message);
  }
  const selectionSummary = selected.selections.map((selection) => ({
    sourceAddress: selection.sourceAddress,
    libraryItemName: selection.libraryItemName,
    playbackMode: selection.playbackMode || null,
    firstFrame: selection.firstFrame || null,
    effectiveFirstFrame: selection.effectiveFirstFrame,
    sourceParentFrameIndex: selection.sourceParentFrameIndex,
    sourceParentFrameSpanStart: selection.sourceParentFrameSpanStart,
    childFrameCount: selection.childFrameCount,
    selectedChildFrameIndex: selection.selectedChildFrameIndex,
    selectionRule: selection.selectionRule,
    sourceTransform: selection.sourceTransform,
  }));
  return {
    frameIndex,
    root: selected.resolverInput.root,
    symbols: selected.resolverInput.symbols,
    displayList: resolved.displayList,
    shapeBlocks: frameSource.shapeBlocks,
    composed,
    selections: selectionSummary,
  };
}

function rasterizeSvg(rasterizer, svg, width, height, label) {
  const pixelCount = width * height;
  if (!Number.isSafeInteger(pixelCount) || pixelCount <= 0 || pixelCount > MAX_OUTPUT_PIXELS) {
    throw new Error(label + ': output pixel count exceeds the existing snapshot budget');
  }
  const svgByteLength = Buffer.byteLength(svg, 'utf8');
  if (svgByteLength > FLA_STATIC_SNAPSHOT_LIMITS.maxSnapshotBytes) {
    throw new Error(label + ': SVG exceeds the existing snapshot byte budget');
  }
  return rasterizer.rasterize({ requestId: randomUUID(), svg, width, height, pixelCount });
}

function replaceSvgViewport(svg, framing) {
  const svgStart = svg.indexOf('<svg ');
  const rootEnd = svg.indexOf('>', svgStart);
  const svgEnd = svg.lastIndexOf('</svg>');
  if (svgStart < 0 || rootEnd < 0 || svgEnd < rootEnd) throw new Error('Composed SVG root could not be isolated');
  const inner = svg.slice(rootEnd + 1, svgEnd);
  const viewBox = framing.viewBox;
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' +
    formatFiniteSvgNumber(viewBox.x) + ' ' + formatFiniteSvgNumber(viewBox.y) + ' ' +
    formatFiniteSvgNumber(viewBox.width) + ' ' + formatFiniteSvgNumber(viewBox.height) +
    '" width="' + framing.outputWidth + '" height="' + framing.outputHeight + '">' +
    inner + '</svg>';
}

function createReassemblySvg(frame, partPngs) {
  const framing = frame.composed.composition.framing;
  const svg = createPixelAlignedPngStackSvg(framing, partPngs);
  if (Buffer.byteLength(svg, 'utf8') > FLA_STATIC_SNAPSHOT_LIMITS.maxSnapshotBytes) {
    fail('B', 'REASSEMBLY_SVG_BUDGET_EXCEEDED', 'Raster-part reassembly SVG exceeds the existing snapshot byte budget.', 'GO_FRAME_PARTS_ONLY');
  }
  return svg;
}

function readReferenceProject(referenceProjectPath, expectedSha256, expectedTargetId) {
  const projectJsonPath = path.join(referenceProjectPath, 'project.json');
  if (!existsSync(projectJsonPath)) throw new Error('Reference project.json is missing');
  const project = JSON.parse(readFileSync(projectJsonPath, 'utf8'));
  const candidates = (project.animations || []).filter((animation) =>
    String(animation.source && animation.source.sha256 || '').toLowerCase() === expectedSha256.toLowerCase() &&
    animation.source && animation.source.renderTargetId === expectedTargetId &&
    animation.source.targetKind === 'graphic-symbol',
  );
  if (candidates.length !== 1) {
    throw new Error('Reference project must contain exactly one matching same-source Graphic animation; found ' + candidates.length);
  }
  const animation = candidates[0];
  if (animation.source.startFrameIndex !== 0 ||
      animation.source.endFrameIndex !== EXPECTED_FRAME_COUNT - 1 ||
      animation.source.sourceFps !== EXPECTED_FPS ||
      !Array.isArray(animation.frames) ||
      animation.frames.length !== EXPECTED_FRAME_COUNT ||
      animation.durationMs !== 840) {
    throw new Error('Same-source reference animation range, FPS, duration, or frame count does not match the authorized 21-frame target.');
  }
  const frames = [];
  for (let ordinal = 0; ordinal < animation.frames.length; ordinal += 1) {
    const frame = animation.frames[ordinal];
    if (frame.ordinal !== ordinal || frame.sourceFrameIndex !== ordinal || frame.durationMs !== 40) {
      throw new Error('Reference frame identity/order/duration is invalid at ordinal ' + ordinal);
    }
    const assetRecord = (project.assets || []).find((asset) => asset.id === frame.assetId);
    if (!assetRecord || typeof assetRecord.relativePath !== 'string') {
      throw new Error('Reference project has no relative asset record at ordinal ' + ordinal);
    }
    const assetPath = path.resolve(referenceProjectPath, assetRecord.relativePath);
    if (!isWithin(referenceProjectPath, assetPath)) {
      throw new Error('Reference asset path escaped the read-only project root at ordinal ' + ordinal);
    }
    if (!existsSync(assetPath)) throw new Error('Reference PNG asset is missing at ordinal ' + ordinal);
    const bytes = readFileSync(assetPath);
    const digest = sha256(bytes);
    if (digest.toLowerCase() !== String(frame.sha256).toLowerCase()) {
      throw new Error('Reference PNG SHA-256 mismatch at ordinal ' + ordinal);
    }
    const dimensions = inspectPngHeader(bytes);
    frames.push({
      ordinal,
      sourceFrameIndex: frame.sourceFrameIndex,
      durationMs: frame.durationMs,
      sha256: digest,
      dimensions,
      sourceViewport: frame.sourceViewport || null,
      offset: frame.offset || null,
      bytes,
    });
  }
  return {
    projectLabel: path.basename(referenceProjectPath),
    animationName: animation.name,
    source: animation.source,
    durationMs: animation.durationMs,
    frames,
  };
}

function fillTrackFrame(track, frameIndex, unit, image) {
  track.frameStates[frameIndex] = {
    sourceFrameIndex: frameIndex,
    durationMs: 1000 / EXPECTED_FPS,
    visible: true,
    drawOrder: unit.drawOrder,
    sourceAddress: unit.sourceAddress,
    sourceAddressPath: unit.sourceAddressPath,
    localTransform: unit.localTransform,
    worldTransform: unit.worldTransform,
    sourceFrame: unit.sourceFrame,
    layer: unit.layer,
    composite: unit.composite,
    compositeReason: unit.compositeReason,
    nestedGraphicSelections: image.nestedGraphicSelections,
    image: {
      path: image.relativePath.replace(/\\/gu, '/'),
      sha256: image.sha256,
      width: image.width,
      height: image.height,
      coordinateSpace: 'Graphic target frame viewport; transforms are resolved once into the image and retained as provenance.',
    },
  };
}

function createActionClipDraft(target, sourceSha256, trackRecords, frameFacts, reassemblyComparisons) {
  const unionViewBox = frameFacts.reduce((bounds, fact) => {
    const view = fact.viewBox;
    if (!bounds) return { x: view.x, y: view.y, maxX: view.x + view.width, maxY: view.y + view.height };
    return {
      x: Math.min(bounds.x, view.x),
      y: Math.min(bounds.y, view.y),
      maxX: Math.max(bounds.maxX, view.x + view.width),
      maxY: Math.max(bounds.maxY, view.y + view.height),
    };
  }, null);
  const tracks = trackRecords.map((track) => ({
    partTrackId: track.trackId,
    identity: {
      basis: 'normalized source occurrence path; frame-span and selected nested-frame numbers normalized while authored layer/element path is retained',
      normalizedSourcePath: track.normalizedSourcePath,
      sourceKind: track.sourceKind,
      terminalKind: track.terminalKind,
      sourceSymbolIdsObserved: [...track.sourceSymbolIds].sort(),
      sourceAddressesObserved: [...track.sourceAddresses].sort(),
    },
    frameStates: track.frameStates.map((state, frameIndex) => state || ({
      sourceFrameIndex: frameIndex,
      durationMs: 1000 / EXPECTED_FPS,
      visible: false,
      drawOrder: null,
      sourceAddress: null,
      localTransform: null,
      worldTransform: null,
      sourceFrame: null,
      image: null,
    })),
  }));
  return {
    format: 'panda-action-clip-draft',
    version: 1,
    status: 'prototype-only',
    clip: {
      name: target.userLabel || target.sourceLibraryItemName,
      source: {
        basename: target.sourceBasename,
        sha256: sourceSha256,
        renderTargetId: target.renderTargetId,
        targetKind: 'graphic-symbol',
        sourceLibraryItemName: target.sourceLibraryItemName,
      },
      sourceFps: EXPECTED_FPS,
      sourceFrameRange: { startFrameIndex: 0, endFrameIndex: EXPECTED_FRAME_COUNT - 1 },
      frameCount: EXPECTED_FRAME_COUNT,
      frameDurationMs: 1000 / EXPECTED_FPS,
      durationMs: EXPECTED_FRAME_COUNT * 1000 / EXPECTED_FPS,
      playback: {
        mode: 'loop',
        initialFrameIndex: 0,
        frameOrder: Array.from({ length: EXPECTED_FRAME_COUNT }, (_, index) => index),
        context: 'Play one source Graphic target at its source FPS. Nested Graphic selections use the captured authored selection per parent frame.',
        stageViewBox: {
          x: unionViewBox.x,
          y: unionViewBox.y,
          width: unionViewBox.maxX - unionViewBox.x,
          height: unionViewBox.maxY - unionViewBox.y,
        },
        fullReassemblyFrameImages: frameFacts.map((fact) => ({
          sourceFrameIndex: fact.sourceFrameIndex,
          path: fact.reassemblyPath,
          sha256: fact.reassemblySha256,
          viewBox: fact.viewBox,
          width: fact.width,
          height: fact.height,
        })),
      },
    },
    tracks,
    validation: {
      reassemblyMatchesNativePixelForPixel: reassemblyComparisons.every((item) => item.pixelIdentical),
      frameComparisons: reassemblyComparisons,
      sourceFramesUseMilliseconds: true,
      projectAndSchemaMutation: false,
    },
  };
}

function createPlaybackHtml(frameFacts, fps) {
  const payload = JSON.stringify({
    fps,
    loop: true,
    frames: frameFacts.map((frame) => ({
      sourceFrameIndex: frame.sourceFrameIndex,
      path: frame.reassemblyPath.replace(/\\/gu, '/'),
      viewBox: frame.viewBox,
      width: frame.width,
      height: frame.height,
    })),
    stageViewBox: frameFacts.reduce((bounds, frame) => {
      const view = frame.viewBox;
      if (!bounds) return { x: view.x, y: view.y, maxX: view.x + view.width, maxY: view.y + view.height };
      return {
        x: Math.min(bounds.x, view.x),
        y: Math.min(bounds.y, view.y),
        maxX: Math.max(bounds.maxX, view.x + view.width),
        maxY: Math.max(bounds.maxY, view.y + view.height),
      };
    }, null),
  });
  return '<!doctype html>\n' +
    '<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Issue #918 com8 ActionClipDraft playback</title>' +
    '<style>body{font:14px system-ui,sans-serif;margin:24px;background:#151923;color:#f4f6fb}canvas{display:block;background:transparent;border:1px solid #535d73;max-width:100%;image-rendering:auto}button{margin:12px 8px 0 0;padding:8px 14px}#meta{color:#b8c2d8}</style>' +
    '</head><body><h1>com8 walk · prototype playback context</h1>' +
    '<p id="meta">Loading reassembled source-part frames…</p><canvas id="stage"></canvas><div><button id="toggle">Pause</button><button id="step">Step</button></div>' +
    '<script>const proof=' + payload + ';const canvas=document.getElementById("stage");const ctx=canvas.getContext("2d");' +
    'const meta=document.getElementById("meta");const images=proof.frames.map((frame)=>{const image=new Image();image.src=frame.path;return image;});' +
    'let current=0;let playing=true;let last=0;const bounds=proof.stageViewBox;const scale=Math.min(3,720/Math.max(bounds.maxX-bounds.x,bounds.maxY-bounds.y));' +
    'canvas.width=Math.ceil((bounds.maxX-bounds.x)*scale);canvas.height=Math.ceil((bounds.maxY-bounds.y)*scale);' +
    'function draw(){ctx.clearRect(0,0,canvas.width,canvas.height);const frame=proof.frames[current];const image=images[current];' +
    'ctx.drawImage(image,(frame.viewBox.x-bounds.x)*scale,(frame.viewBox.y-bounds.y)*scale,frame.viewBox.width*scale,frame.viewBox.height*scale);' +
    'meta.textContent="Frame "+(current+1)+" / "+proof.frames.length+" · "+proof.fps+" FPS · source Graphic viewport aligned on a shared canvas";}' +
    'function showLoadError(){meta.textContent="A reassembly frame could not be loaded from this private evidence folder."}' +
    'document.getElementById("toggle").addEventListener("click",()=>{playing=!playing;document.getElementById("toggle").textContent=playing?"Pause":"Play";});' +
    'document.getElementById("step").addEventListener("click",()=>{current=(current+1)%proof.frames.length;draw();});' +
    'function tick(now){if(playing&&now-last>=1000/proof.fps){current=(current+1)%proof.frames.length;last=now;draw();}requestAnimationFrame(tick);}' +
    'Promise.all(images.map((image)=>image.decode())).then(()=>{draw();requestAnimationFrame(tick);}).catch(showLoadError);</script>' +
    '</body></html>\n';
}

function createReviewSvg(nativeFrames, reassembledFrames, referenceFrames, frameFacts, referenceLabel) {
  const width = 1050;
  const cellWidth = 350;
  const rowHeight = 270;
  const height = 54 + frameFacts.length * rowHeight;
  const labels = ['Main full-frame', 'Reassembled source parts', referenceLabel];
  const panels = [];
  for (let frameIndex = 0; frameIndex < frameFacts.length; frameIndex += 1) {
    const rowY = 54 + frameIndex * rowHeight;
    panels.push('<text x="12" y="' + (rowY + 18) + '" font-size="14" fill="#f3f4f6">F' +
      String(frameIndex).padStart(2, '0') + ' · ' + frameFacts[frameIndex].durationMs + ' ms</text>');
    const bytes = [nativeFrames[frameIndex], reassembledFrames[frameIndex], referenceFrames[frameIndex]];
    for (let column = 0; column < 3; column += 1) {
      const x = column * cellWidth + 10;
      const imageY = rowY + 28;
      panels.push('<text x="' + x + '" y="' + (rowY + 44) + '" font-size="12" fill="#cbd5e1">' + labels[column] + '</text>');
      panels.push('<image x="' + x + '" y="' + (imageY + 4) + '" width="320" height="214" preserveAspectRatio="xMidYMid meet" href="data:image/png;base64,' +
        bytes[ column ].toString('base64') + '"/>');
    }
  }
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' +
    width + ' ' + height + '"><rect width="100%" height="100%" fill="#151923"/>' +
    '<text x="12" y="30" font-size="18" font-weight="600" fill="#ffffff">Issue #918 · 21-frame com8 proof</text>' +
    panels.join('') + '</svg>\n';
}

async function runProbe() {
  process.stderr.write('[N0] runProbe entered\n');
  const args = parseArgs(process.argv.slice(1));
  if (args.help) {
    process.stdout.write(usage() + '\n');
    return 0;
  }
  if (args.mode === 'n0-preflight') return runN0Preflight(args);
  for (const key of ['source', 'expected-sha', 'expected-render-target', 'reference-project', 'output-dir']) {
    if (!args[key]) throw new Error('Missing --' + key);
  }
  const expectedSha256 = args['expected-sha'].replace(/[^a-f0-9]/giu, '').toUpperCase();
  if (!/^[A-F0-9]{64}$/u.test(expectedSha256)) throw new Error('--expected-sha must be a 64-character SHA-256');
  const expectedTargetId = args['expected-render-target'];
  if (!/^fla-render-target-[a-f0-9]{64}$/u.test(expectedTargetId)) {
    throw new Error('--expected-render-target must be a stable Panda render target id');
  }
  const sourcePath = resolveOutsideRepo(args.source, 'Authorized source FLA');
  const referenceProjectPath = resolveOutsideRepo(args['reference-project'], 'Same-source reference project');
  if (!statSync(referenceProjectPath).isDirectory()) throw new Error('Reference project must be a directory');
  const outputDir = createFreshOutputDirectory(args['output-dir']);
  process.stderr.write('[N0] private output directory created\n');
  const userDataPath = outputPath(outputDir, '.electron-user-data');
  mkdirSync(userDataPath);
  app.setPath('userData', userDataPath);

  const run = createRunRecord(args, outputDir);
  const startedAt = performance.now();
  let verdict = 'BLOCKED/UNSUPPORTED';
  let exitCode;
  let importService = null;
  let rasterizer = null;
  let sequenceService;
  let sessionId = null;
  let nativeFrames = [];
  let target = null;
  let source = null;
  let frameFacts = [];
  let partTrackRecords = new Map();
  let reassemblyComparisons = [];

  const parserWindowManager = new FlaParserWindowManager();
  importService = new FlaImportService(parserWindowManager);
  const onWorkerReady = (event) => {
    try { importService.markWorkerReady(event.sender.id); } catch (error) { console.error('Parser READY rejected:', error.message); }
  };
  const onWorkerProgress = (event, payload) => {
    try { importService.markWorkerProgress(event.sender.id, payload); } catch (error) { console.error('Parser progress rejected:', error.message); }
  };
  const onWorkerResult = (event, payload) => {
    try { importService.markWorkerResult(event.sender.id, payload); } catch (error) { console.error('Parser result rejected:', error.message); }
  };
  const onWorkerError = (event, payload) => {
    try { importService.markWorkerError(event.sender.id, payload); } catch (error) { console.error('Parser error rejected:', error.message); }
  };
  ipcMain.on(IPC_CHANNELS.FLA_WORKER_READY, onWorkerReady);
  ipcMain.on(IPC_CHANNELS.FLA_WORKER_PROGRESS, onWorkerProgress);
  ipcMain.on(IPC_CHANNELS.FLA_WORKER_RESULT, onWorkerResult);
  ipcMain.on(IPC_CHANNELS.FLA_WORKER_ERROR, onWorkerError);
  const parserListeners = { onWorkerReady, onWorkerProgress, onWorkerResult, onWorkerError };

  rasterizer = new FlaStaticSnapshotWindowManager();
  const onSnapshotReady = (event) => rasterizer.markReady(event.sender.id);
  const onSnapshotResult = (event, payload) => rasterizer.markResult(event.sender.id, payload);
  const onSnapshotError = (event, payload) => rasterizer.markError(event.sender.id, payload);
  ipcMain.on(IPC_CHANNELS.FLA_SNAPSHOT_RENDERER_READY, onSnapshotReady);
  ipcMain.on(IPC_CHANNELS.FLA_SNAPSHOT_RENDER_RESULT, onSnapshotResult);
  ipcMain.on(IPC_CHANNELS.FLA_SNAPSHOT_RENDER_ERROR, onSnapshotError);
  const rasterListeners = { onSnapshotReady, onSnapshotResult, onSnapshotError };

  sequenceService = new FlaFrameSequenceService({ rasterizer });
  process.stderr.write('[N0] Main services initialized\n');
  try {
    const inputHashBefore = await sha256File(sourcePath);
    if (inputHashBefore !== expectedSha256) {
      fail('A', 'SOURCE_SHA_MISMATCH', 'The Main source reader input does not match the authorized SHA-256.');
    }
    process.stderr.write('[N0] authorized source hash confirmed; invoking Main inspection\n');
    run.metrics.parserCallCount += 1;
    const inspection = await importService.inspectSource(sourcePath, randomUUID());
    process.stderr.write('[N0] Main inspection returned: ok=' + inspection.ok + '\n');
    if (!inspection.ok) {
      fail('A', 'MAIN_IMPORT_REJECTED', 'Main FLA inspection rejected the source: ' + inspection.error.code + ' ' + inspection.error.message);
    }
    sessionId = inspection.sessionId;
    const session = importService.getSession(sessionId);
    if (!session) fail('A', 'MAIN_SESSION_MISSING', 'Main FLA inspection did not retain an active source session.');
    run.source.originalSha256 = session.originalSourceSha256.toUpperCase();
    run.source.mainSessionSha256 = sha256(session.sourceBytes);
    run.source.mainSessionByteLength = session.sourceBytes.byteLength;
    run.source.ingestMode = inspection.trace && inspection.trace.ingestMode || null;
    run.source.recoveryApplied = inspection.trace && inspection.trace.recoveryApplied || false;
    if (run.source.originalSha256 !== expectedSha256) {
      fail('A', 'MAIN_SOURCE_SHA_MISMATCH', 'Main inspection source identity does not match the authorized SHA-256.');
    }
    if (run.source.recoveryApplied) {
      const originalBytes = readFileSync(sourcePath);
      run.source.originalVsRecoveredXml = await compareArchiveXmlEntries(
        originalBytes,
        session.sourceBytes,
      );
      if (run.source.originalVsRecoveredXml.status !== 'MATCH') {
        fail('N0', 'RECOVERED_XML_DIVERGENCE', 'Original and Main-recovered archive XML payloads differ.');
      }
    } else {
      run.source.originalVsRecoveredXml = {
        status: 'IDENTICAL_SOURCE_BYTES',
        originalSha256: run.source.originalSha256,
        recoveredSha256: run.source.mainSessionSha256,
      };
    }

    const reference = readReferenceProject(referenceProjectPath, expectedSha256, expectedTargetId);
    run.reference.integrity = {
      animationName: reference.animationName,
      sourceFrameCount: reference.frames.length,
      sourceFps: reference.source.sourceFps,
      durationMs: reference.durationMs,
      orderedFrameIndices: reference.frames.map((frame) => frame.sourceFrameIndex),
      assetSha256VerifiedCount: reference.frames.length,
    };
    run.reference.animationName = reference.animationName;

    run.metrics.preparedDisplaySourceCallCount += 1;
    const prepared = await prepareFlaStaticSnapshotDisplaySource(session.sourceBytes, 'preview');
    if (!prepared.ok) {
      fail('A', 'DISPLAY_SOURCE_PREPARATION_FAILED', 'Main static display source preparation failed: ' + prepared.message);
    }
    source = prepared.source;
    const targetCandidates = source.graphicSymbols.filter((symbol) => {
      const targetId = stableRenderTargetId(
        session.sourceBytes,
        'graphic-symbol\u0000' + symbol.sourceLibraryItemName + '\u0000' + symbol.userLabel,
      );
      return targetId === expectedTargetId;
    });
    if (targetCandidates.length !== 1) {
      fail('A', 'TARGET_IDENTITY_NOT_UNIQUE', 'The authorized stable Graphic target ID resolved to ' + targetCandidates.length + ' prepared symbols.');
    }
    const descriptor = targetCandidates[0];
    if (descriptor.frameCount !== EXPECTED_FRAME_COUNT) {
      fail('A', 'TARGET_FRAME_COUNT_MISMATCH', 'The selected Graphic target has ' + descriptor.frameCount + ' frames; expected 21.');
    }
    if (inspection.ir.document.frameRate !== EXPECTED_FPS) {
      fail('A', 'SOURCE_FPS_MISMATCH', 'Main parsed source FPS ' + inspection.ir.document.frameRate + '; expected 25.');
    }
    target = {
      renderTargetId: expectedTargetId,
      sourceLibraryItemName: descriptor.sourceLibraryItemName,
      userLabel: descriptor.userLabel,
      frameCount: descriptor.frameCount,
      timelineXml: descriptor.timelineXml,
      frameSpanIndex: descriptor.frameSpanIndex,
      sourceBasename: path.basename(sourcePath),
    };
    run.target.sourceLibraryItemName = target.sourceLibraryItemName;
    run.target.userLabel = target.userLabel;
    run.target.frameCount = target.frameCount;
    run.target.sourceFps = inspection.ir.document.frameRate;
    run.target.durationMs = EXPECTED_FRAME_COUNT * 1000 / EXPECTED_FPS;

    const mediaLookup = createFlaStaticSnapshotBitmapMediaLookup(inspection.ir.media);
    const nativeRequestId = randomUUID();
    const nativeResult = await sequenceService.renderSequence(
      sessionId,
      { startFrameIndex: 0, endFrameIndex: EXPECTED_FRAME_COUNT - 1 },
      (async function* nativeFrameSource() {
        for (let frameIndex = 0; frameIndex < EXPECTED_FRAME_COUNT; frameIndex += 1) {
          if (performance.now() - startedAt > MAX_EXPERIMENT_WALL_TIME_MS) {
            fail('A', 'EXPERIMENT_WALL_BUDGET_REACHED', 'Bounded proof elapsed-time budget reached during full-frame rendering.');
          }
          const frame = buildFrame(source, {
            ...target,
            renderTargetId: expectedTargetId,
          }, frameIndex, mediaLookup, run);
          const framing = frame.composed.composition.framing;
          const sourceFrame = {
            sourceFrameIndex: frameIndex,
            sequenceOrdinal: frameIndex,
            durationMs: 1000 / EXPECTED_FPS,
            viewBox: framing.viewBox,
            width: frame.composed.width,
            height: frame.composed.height,
            resolvedNodeCount: frame.displayList.resolvedNodeCount,
            nestedSelectionCount: frame.selections.length,
            nestedGraphicSelections: frame.selections,
          };
          frameFacts.push(sourceFrame);
          run.target.frameSequence.push({
            ordinal: frameIndex,
            sourceFrameIndex: frameIndex,
            durationMs: sourceFrame.durationMs,
            resolvedNodeCount: sourceFrame.resolvedNodeCount,
            nestedSelectionCount: sourceFrame.nestedSelectionCount,
            viewBox: sourceFrame.viewBox,
            width: sourceFrame.width,
            height: sourceFrame.height,
          });
          run.metrics.fullFrameRasterCount += 1;
          yield { frameIndex, svg: frame.composed.svg };
        }
      })(),
      { sequenceRequestId: nativeRequestId },
    );
    if (!nativeResult.ok) {
      fail('A', 'FULL_FRAME_SEQUENCE_FAILED', 'Full-frame sequence failed: ' + nativeResult.error.code + ' ' + nativeResult.error.message);
    }
    const nativeSequenceId = nativeResult.requestId;
    const confirmedNative = sequenceService.getConfirmedSequence(nativeSequenceId);
    if (!confirmedNative || confirmedNative.length !== EXPECTED_FRAME_COUNT) {
      fail('A', 'FULL_FRAME_SEQUENCE_INCOMPLETE', 'Main frame-sequence service did not confirm all 21 source frames.');
    }
    for (let frameIndex = 0; frameIndex < confirmedNative.length; frameIndex += 1) {
      const item = confirmedNative[frameIndex];
      if (item.frameIndex !== frameIndex || item.sequenceOrdinal !== frameIndex) {
        fail('A', 'FULL_FRAME_ORDER_MISMATCH', 'Main sequence output order does not match source frame ' + frameIndex + '.');
      }
      const filePath = outputPath(outputDir, 'native', 'frame-' + String(frameIndex).padStart(3, '0') + '.png');
      mkdirSync(path.dirname(filePath), { recursive: true });
      writeFileSync(filePath, item.pngBytes, { flag: 'wx' });
      nativeFrames.push(Buffer.from(item.pngBytes));
      frameFacts[frameIndex].nativePath = path.relative(outputDir, filePath);
      frameFacts[frameIndex].nativeSha256 = item.sha256;
      frameFacts[frameIndex].durationMs = 1000 / EXPECTED_FPS;
    }
    sequenceService.releaseSequence(nativeSequenceId);

    run.reference.frameComparisons = reference.frames.map((referenceFrame, frameIndex) => {
      const comparison = comparePngs(nativeFrames[frameIndex], referenceFrame.bytes);
      return {
        sourceFrameIndex: frameIndex,
        durationMs: referenceFrame.durationMs,
        ...comparison,
      };
    });
    const referenceHashesIntact = run.reference.integrity.assetSha256VerifiedCount === EXPECTED_FRAME_COUNT;
    if (!referenceHashesIntact) fail('A', 'REFERENCE_INTEGRITY_FAILED', 'Not all same-source reference frame assets passed SHA-256 integrity.');
    run.completedStage = 'A';

    const frameBuffersForReassembly = [];
    let aggregatePartBytes = 0;
    for (let frameIndex = 0; frameIndex < EXPECTED_FRAME_COUNT; frameIndex += 1) {
      if (performance.now() - startedAt > MAX_EXPERIMENT_WALL_TIME_MS) {
        fail('B', 'EXPERIMENT_WALL_BUDGET_REACHED', 'Bounded proof elapsed-time budget reached during part reconstruction.', 'GO_FRAME_PARTS_ONLY');
      }
      const frame = buildFrame(source, target, frameIndex, mediaLookup, run);
      const unitsResult = collectPartUnits(frame.root, frame.symbols, expectedSha256);
      const units = unitsResult.units;
      run.metrics.maxObservedPartsInFrame = Math.max(run.metrics.maxObservedPartsInFrame, units.length);
      if (units.length === 0) {
        fail('B', 'NO_SOURCE_PARTS', 'Graphic frame ' + frameIndex + ' contains no source-addressable part units.', 'GO_FRAME_PARTS_ONLY');
      }
      if (units.length > MAX_PARTS) {
        fail('B', 'PART_COUNT_BUDGET_EXCEEDED', 'Graphic frame ' + frameIndex + ' has ' + units.length + ' parts; proof cap is ' + MAX_PARTS + '.', 'GO_FRAME_PARTS_ONLY');
      }
      const identitiesInFrame = new Set();
      const frameParts = [];
      const nativeFact = frameFacts[frameIndex];
      const nativeDimensions = inspectPngHeader(nativeFrames[frameIndex]);
      if (nativeDimensions.width !== frame.composed.width || nativeDimensions.height !== frame.composed.height) {
        fail('B', 'FRAME_VIEWPORT_CHANGED', 'Part pass viewport differs from the full-frame pass at source frame ' + frameIndex + '.', 'GO_FRAME_PARTS_ONLY');
      }
      const nativeView = nativeFact.viewBox;
      const currentView = frame.composed.composition.framing.viewBox;
      if (Math.abs(nativeView.x - currentView.x) > 0.00001 ||
          Math.abs(nativeView.y - currentView.y) > 0.00001 ||
          Math.abs(nativeView.width - currentView.width) > 0.00001 ||
          Math.abs(nativeView.height - currentView.height) > 0.00001) {
        fail('B', 'FRAME_VIEWPORT_NONDETERMINISTIC', 'Full-frame Graphic viewBox changed between passes at frame ' + frameIndex + '.', 'GO_FRAME_PARTS_ONLY');
      }
      for (const unit of units) {
        if (identitiesInFrame.has(unit.trackKey)) {
          fail('B', 'AMBIGUOUS_TRACK_IDENTITY', 'More than one visible occurrence maps to the same normalized source path in frame ' + frameIndex + '.', 'GO_FRAME_PARTS_ONLY');
        }
        identitiesInFrame.add(unit.trackKey);
        if (!partTrackRecords.has(unit.trackKey)) {
          if (partTrackRecords.size >= MAX_PARTS) {
            fail('B', 'TRACK_COUNT_BUDGET_EXCEEDED', 'Unique part track count exceeds the existing proof cap of ' + MAX_PARTS + '.', 'GO_FRAME_PARTS_ONLY');
          }
          partTrackRecords.set(unit.trackKey, {
            trackId: unit.trackId,
            normalizedSourcePath: unit.normalizedSourcePath,
            sourceKind: unit.sourceKind,
            terminalKind: unit.terminalKind,
            sourceSymbolIds: new Set(),
            sourceAddresses: new Set(),
            frameStates: Array(EXPECTED_FRAME_COUNT).fill(null),
          });
        }
        const track = partTrackRecords.get(unit.trackKey);
        if (unit.sourceSymbolId) track.sourceSymbolIds.add(unit.sourceSymbolId);
        if (unit.sourceAddress) track.sourceAddresses.add(unit.sourceAddress);
        const isolated = isolateOccurrence(frame.root, frame.symbols, unit.isolatePath, unit.trackId);
        const isolatedResolved = resolveFlaDisplayList(isolated);
        run.metrics.partResolveCount += 1;
        if (!isolatedResolved.ok) {
          fail('B', 'PART_RESOLVE_FAILED', 'Part ' + unit.trackId + ' failed to resolve at frame ' + frameIndex + ': ' + isolatedResolved.message, 'GO_FRAME_PARTS_ONLY');
        }
        const partComposed = buildSvgForResolvedDisplayList({
          displayList: isolatedResolved.displayList,
          renderTargetId: stableRenderTargetId(
            session.sourceBytes,
            'issue918-part\u0000' + unit.trackId + '\u0000frame\u0000' + frameIndex,
          ),
          stageWidth: source.stageWidth,
          stageHeight: source.stageHeight,
          shapeBlocks: frame.shapeBlocks,
          resolveBitmapMedia: mediaLookup,
        });
        if (!partComposed.ok) {
          fail('B', 'PART_COMPOSITION_FAILED', 'Part ' + unit.trackId + ' could not be composed at frame ' + frameIndex + ': ' + partComposed.message, 'GO_FRAME_PARTS_ONLY');
        }
        const partSvg = replaceSvgViewport(partComposed.svg, frame.composed.composition.framing);
        run.metrics.partRasterCount += 1;
        let partRaster;
        try {
          partRaster = await rasterizeSvg(
            rasterizer,
            partSvg,
            frame.composed.width,
            frame.composed.height,
            'Part ' + unit.trackId + ' frame ' + frameIndex,
          );
        } catch (error) {
          fail('B', 'PART_RASTER_FAILED', 'Part ' + unit.trackId + ' failed rasterization at frame ' + frameIndex + ': ' + error.message, 'GO_FRAME_PARTS_ONLY');
        }
        if (partRaster.width !== frame.composed.width || partRaster.height !== frame.composed.height) {
          fail('B', 'PART_RASTER_DIMENSION_MISMATCH', 'Part image did not preserve the Graphic viewport at frame ' + frameIndex + '.', 'GO_FRAME_PARTS_ONLY');
        }
        aggregatePartBytes += partRaster.pngBytes.byteLength;
        run.metrics.totalPartPngBytes = aggregatePartBytes;
        if (aggregatePartBytes > MAX_AGGREGATE_PART_PNG_BYTES) {
          fail('B', 'PART_IMAGE_BYTE_BUDGET_EXCEEDED', 'Aggregate isolated part PNGs exceed the 64 MiB proof cap.', 'GO_FRAME_PARTS_ONLY');
        }
        const trackDir = outputPath(outputDir, 'tracks', unit.trackId);
        mkdirSync(trackDir, { recursive: true });
        const imagePath = outputPath(trackDir, 'frame-' + String(frameIndex).padStart(3, '0') + '.png');
        writeFileSync(imagePath, partRaster.pngBytes, { flag: 'wx' });
        const relativePath = path.relative(outputDir, imagePath);
        const nestedGraphicSelections = frame.selections.filter((selection) =>
          unit.sourceAddressPath.some((address) => address && (
            address === selection.sourceAddress ||
            address.startsWith(selection.sourceAddress + '/')
          )),
        );
        fillTrackFrame(track, frameIndex, unit, {
          relativePath,
          sha256: sha256(partRaster.pngBytes),
          width: partRaster.width,
          height: partRaster.height,
          nestedGraphicSelections,
        });
        frameParts.push({
          trackKey: unit.trackKey,
          trackId: unit.trackId,
          pngBytes: Buffer.from(partRaster.pngBytes),
          drawOrder: unit.drawOrder,
        });
      }
      frameParts.sort((left, right) => left.drawOrder - right.drawOrder);
      frameBuffersForReassembly.push(frameParts);
    }
    run.metrics.partTrackCount = partTrackRecords.size;
    if (partTrackRecords.size === 0) {
      fail('B', 'NO_STABLE_PART_TRACKS', 'No stable source-addressed tracks were derived.', 'GO_FRAME_PARTS_ONLY');
    }

    const reassemblySvgFrames = [];
    for (let frameIndex = 0; frameIndex < EXPECTED_FRAME_COUNT; frameIndex += 1) {
      const nativeFrame = frameFacts[frameIndex];
      const frameProxy = {
        composed: {
          composition: {
            framing: {
              viewBox: nativeFrame.viewBox,
              outputWidth: nativeFrame.width,
              outputHeight: nativeFrame.height,
            },
          },
        },
      };
      reassemblySvgFrames.push(createReassemblySvg(frameProxy, frameBuffersForReassembly[frameIndex]));
    }
    const reassemblyRequestId = randomUUID();
    const reassemblyResult = await sequenceService.renderSequence(
      sessionId,
      { startFrameIndex: 0, endFrameIndex: EXPECTED_FRAME_COUNT - 1 },
      (async function* reassemblyFrameSource() {
        for (let frameIndex = 0; frameIndex < EXPECTED_FRAME_COUNT; frameIndex += 1) {
          run.metrics.reassemblySequenceRasterCount += 1;
          yield { frameIndex, svg: reassemblySvgFrames[frameIndex] };
        }
      })(),
      { sequenceRequestId: reassemblyRequestId },
    );
    if (!reassemblyResult.ok) {
      fail('B', 'REASSEMBLY_SEQUENCE_FAILED', 'Part reassembly sequence failed: ' + reassemblyResult.error.code + ' ' + reassemblyResult.error.message, 'GO_FRAME_PARTS_ONLY');
    }
    const reassemblySequenceId = reassemblyResult.requestId;
    const confirmedReassembly = sequenceService.getConfirmedSequence(reassemblySequenceId);
    if (!confirmedReassembly || confirmedReassembly.length !== EXPECTED_FRAME_COUNT) {
      fail('B', 'REASSEMBLY_SEQUENCE_INCOMPLETE', 'Reassembly sequence did not confirm all 21 frames.', 'GO_FRAME_PARTS_ONLY');
    }
    const reassembledFrames = [];
    for (let frameIndex = 0; frameIndex < confirmedReassembly.length; frameIndex += 1) {
      const item = confirmedReassembly[frameIndex];
      if (item.frameIndex !== frameIndex || item.sequenceOrdinal !== frameIndex) {
        fail('B', 'REASSEMBLY_ORDER_MISMATCH', 'Reassembly sequence output order differs from source frame order.', 'GO_FRAME_PARTS_ONLY');
      }
      const filePath = outputPath(outputDir, 'reassembled', 'frame-' + String(frameIndex).padStart(3, '0') + '.png');
      mkdirSync(path.dirname(filePath), { recursive: true });
      writeFileSync(filePath, item.pngBytes, { flag: 'wx' });
      reassembledFrames.push(Buffer.from(item.pngBytes));
      frameFacts[frameIndex].reassemblyPath = path.relative(outputDir, filePath);
      frameFacts[frameIndex].reassemblySha256 = item.sha256;
      reassemblyComparisons.push({
        sourceFrameIndex: frameIndex,
        ...comparePngs(nativeFrames[frameIndex], item.pngBytes),
      });
    }
    sequenceService.releaseSequence(reassemblySequenceId);
    run.completedStage = 'B';

    const referenceFrameBytes = reference.frames.map((frame) => frame.bytes);
    writeFileSync(
      outputPath(outputDir, 'frame-review.svg'),
      createReviewSvg(nativeFrames, reassembledFrames, referenceFrameBytes, frameFacts, 'Prior same-source render'),
      { flag: 'wx' },
    );

    const trackRecords = [...partTrackRecords.values()];
    const draft = createActionClipDraft(
      {
        ...target,
        sourceBasename: path.basename(sourcePath),
      },
      expectedSha256,
      trackRecords,
      frameFacts.map((frame, index) => ({
        sourceFrameIndex: index,
        durationMs: 1000 / EXPECTED_FPS,
        viewBox: frame.viewBox,
        width: frame.width,
        height: frame.height,
        reassemblyPath: frame.reassemblyPath,
        reassemblySha256: frame.reassemblySha256,
      })),
      reassemblyComparisons,
    );
    writeJson(outputPath(outputDir, 'action-clip-draft.json'), draft);
    writeJson(outputPath(outputDir, 'playback-context.json'), {
      format: 'panda-issue918-playback-context',
      version: 1,
      clip: 'com8 walk',
      sourceFps: EXPECTED_FPS,
      frameCount: EXPECTED_FRAME_COUNT,
      frameDurationMs: 1000 / EXPECTED_FPS,
      durationMs: 840,
      playbackMode: 'loop',
      sourceFrameOrder: Array.from({ length: EXPECTED_FRAME_COUNT }, (_, index) => index),
      alignedCanvas: draft.clip.playback.stageViewBox,
      demonstration: 'Open playback-demo.html in a Windows browser to play the isolated-part reassembly at source FPS.',
      sourceFrameImages: draft.clip.playback.fullReassemblyFrameImages,
    });
    writeFileSync(outputPath(outputDir, 'playback-demo.html'), createPlaybackHtml(frameFacts, EXPECTED_FPS), { flag: 'wx' });

    const partsReassemble = reassemblyComparisons.length === EXPECTED_FRAME_COUNT &&
      reassemblyComparisons.every((item) => item.pixelIdentical);
    const firstReassemblyMismatch = reassemblyComparisons.find((item) => !item.pixelIdentical) || null;
    const nativeMatchesReference = run.reference.frameComparisons.length === EXPECTED_FRAME_COUNT &&
      run.reference.frameComparisons.every((item) => item.pixelIdentical);
    const frameOrderValidated = run.target.frameSequence.length === EXPECTED_FRAME_COUNT &&
      run.target.frameSequence.every((item, index) => item.sourceFrameIndex === index && item.ordinal === index);
    run.metrics.elapsedMs = Math.round(performance.now() - startedAt);
    run.completedStage = 'C';
    run.status = partsReassemble && nativeMatchesReference && frameOrderValidated ? 'PASS' : 'BLOCKED';
    verdict = partsReassemble && nativeMatchesReference && frameOrderValidated
      ? 'GO_PART_TRACK'
      : 'BLOCKED/UNSUPPORTED';
    run.verdict = verdict;
    run.finishedAt = new Date().toISOString();
    run.nativeReferenceAgreement = nativeMatchesReference;
    run.partReassemblyAgreement = partsReassemble;
    run.reassemblyComparisons = reassemblyComparisons;
    if (!partsReassemble) {
      run.failure = {
        stage: 'C',
        code: 'PART_REASSEMBLY_PIXEL_MISMATCH',
        message: firstReassemblyMismatch
          ? 'Source-part reassembly first differs from the native frame at source frame ' +
            firstReassemblyMismatch.sourceFrameIndex + ' (' + firstReassemblyMismatch.differingPixelCount + ' pixels differ).'
          : 'Source-part reassembly did not produce 21 pixel-identical native frames.',
        firstMismatch: firstReassemblyMismatch ? {
          sourceFrameIndex: firstReassemblyMismatch.sourceFrameIndex,
          differingPixelCount: firstReassemblyMismatch.differingPixelCount,
          maxChannelDelta: firstReassemblyMismatch.maxChannelDelta,
          meanAbsoluteChannelDelta: firstReassemblyMismatch.meanAbsoluteChannelDelta,
        } : null,
      };
    }
    run.validation = {
      sourceIdentityValidated: run.source.originalSha256 === expectedSha256,
      graphicTargetIdentityValidated: true,
      sourceFrameOrderValidated: frameOrderValidated,
      sourceFpsValidated: run.target.sourceFps === EXPECTED_FPS,
      targetDurationMs: run.target.durationMs,
      nestedFrameSelectionCapturedPerParentFrame: true,
      fullNativeFramesMatchPriorProjectPixels: nativeMatchesReference,
      partReassemblyMatchesFullNativePixels: partsReassemble,
      independentAnimate2023Reference: 'NOT_AVAILABLE',
      formalProjectOrSchemaWritten: false,
    };
    run.outputs = {
      actionClipDraft: 'action-clip-draft.json',
      playbackContext: 'playback-context.json',
      playbackDemo: 'playback-demo.html',
      visualReview: 'frame-review.svg',
      fullNativeFrames: 'native/frame-000.png through native/frame-020.png',
      reassembledFrames: 'reassembled/frame-000.png through reassembled/frame-020.png',
      perTrackFrameImages: 'tracks/<partTrackId>/frame-<sourceFrameIndex>.png',
    };
    exitCode = verdict === 'GO_PART_TRACK' ? 0 : 2;
  } catch (error) {
    run.metrics.elapsedMs = Math.round(performance.now() - startedAt);
    run.finishedAt = new Date().toISOString();
    if (error instanceof ProbeFailure) {
      run.status = 'BLOCKED';
      run.completedStage = run.completedStage || (error.stage === 'A' ? 'NONE' : 'A');
      run.failure = {
        stage: error.stage,
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      };
      verdict = error.fallbackVerdict;
    } else {
      run.status = 'BLOCKED';
      run.failure = {
        stage: run.completedStage === 'A' ? 'B' : 'A',
        code: 'UNEXPECTED_PROBE_ERROR',
        message: error instanceof Error ? error.message : String(error),
      };
      verdict = run.completedStage === 'A' ? 'GO_FRAME_PARTS_ONLY' : 'BLOCKED/UNSUPPORTED';
    }
    run.verdict = verdict;
    run.nativeFramesWritten = nativeFrames.length;
    run.partTrackCount = partTrackRecords.size;
    run.reassemblyComparisons = reassemblyComparisons;
    run.referenceComparisons = run.reference.frameComparisons;
    exitCode = verdict === 'GO_FRAME_PARTS_ONLY' || verdict === 'RASTER_ONLY' ? 2 : 1;
  } finally {
    if (sessionId && importService) {
      try { importService.releaseSession(sessionId); } catch { /* best-effort private-session cleanup */ }
    }
    if (sequenceService) {
      try { sequenceService.close(); } catch { /* best-effort sequence cleanup */ }
    }
    if (importService) {
      try { importService.close(); } catch { /* best-effort parser-window cleanup */ }
    }
    if (rasterizer) {
      try { rasterizer.close(); } catch { /* best-effort hidden-window cleanup */ }
    }
    if (parserListeners) {
      ipcMain.removeListener(IPC_CHANNELS.FLA_WORKER_READY, parserListeners.onWorkerReady);
      ipcMain.removeListener(IPC_CHANNELS.FLA_WORKER_PROGRESS, parserListeners.onWorkerProgress);
      ipcMain.removeListener(IPC_CHANNELS.FLA_WORKER_RESULT, parserListeners.onWorkerResult);
      ipcMain.removeListener(IPC_CHANNELS.FLA_WORKER_ERROR, parserListeners.onWorkerError);
    }
    if (rasterListeners) {
      ipcMain.removeListener(IPC_CHANNELS.FLA_SNAPSHOT_RENDERER_READY, rasterListeners.onSnapshotReady);
      ipcMain.removeListener(IPC_CHANNELS.FLA_SNAPSHOT_RENDER_RESULT, rasterListeners.onSnapshotResult);
      ipcMain.removeListener(IPC_CHANNELS.FLA_SNAPSHOT_RENDER_ERROR, rasterListeners.onSnapshotError);
    }
    run.finishedAt = run.finishedAt || new Date().toISOString();
    try {
      run.source.inputSha256After = await sha256File(sourcePath);
      run.source.inputUnchanged = run.source.inputSha256After === run.source.expectedSha256;
    } catch (error) {
      run.source.inputSha256After = null;
      run.source.inputUnchanged = false;
      run.source.inputHashAfterError = error instanceof Error ? error.message : String(error);
    }
    run.verdict = verdict;
    try {
      writeJson(outputPath(outputDir, 'receipt.json'), run);
    } catch (writeError) {
      console.error('Could not write private proof receipt:', writeError.message);
      exitCode = 1;
    }
    process.stdout.write(JSON.stringify({
      status: run.status,
      verdict: run.verdict,
      completedStage: run.completedStage,
      outputDirectory: outputDir,
      failure: run.failure,
    }, null, 2) + '\n');
  }
  return exitCode;
}

app.on('window-all-closed', () => {
  process.stderr.write('[N0] helper windows closed; keeping proof process alive\n');
});

app.whenReady()
  .then(() => {
    process.stderr.write('[N0] Electron ready\n');
    return runProbe();
  })
  .then((code) => {
    process.exitCode = code;
    app.quit();
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
    app.quit();
  });
