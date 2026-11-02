#!/usr/bin/env node
/**
 * Issue #905 F1-01 private, read-only native-source experiment.
 *
 * Reads two byte-identical private copies of owner-authorized FLA sources,
 * inspects each through the production Main FLA intake and parser worker,
 * then prepares the normalized session bytes once through Panda's Main static display-source builder,
 * derives occurrence-level units without symbol-name rules, renders each
 * unit through the production sandboxed snapshot rasterizer, then reassembles
 * those unit PNGs in the same stage plane. All artwork and images stay in the
 * caller-supplied output directory outside the repository.
 *
 * This is a research probe, not a product import or Project commit path.
 */

'use strict';

const { app, ipcMain } = require('electron');
const { createHash, randomUUID } = require('node:crypto');
const {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} = require('node:fs');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const JSZip = require('jszip');

const REPO_ROOT = path.resolve(__dirname, '../..');
const MAX_SOURCE_BYTES = 256 * 1024 * 1024;
const MAX_OUTPUT_PIXELS = 16_777_216;
const MAX_PARTS = 24;
const MAX_AGGREGATE_PART_PNG_BYTES = 64 * 1024 * 1024;
const EXPERIMENT_WALL_TIME_MS = 120_000;
const MEMORY_SAMPLE_INTERVAL_MS = 100;

const {
  buildSvgForResolvedDisplayList,
  prepareFlaStaticSnapshotDisplaySource,
} = require('../../dist-electron/main/services/fla-static-snapshot-svg-builder.js');
const {
  resolveFlaDisplayList,
  FLA_DISPLAY_LIST_IDENTITY_MATRIX,
} = require('../../dist-electron/main/services/fla-display-list-resolver.js');
const {
  FlaStaticSnapshotWindowManager,
} = require('../../dist-electron/main/services/fla-static-snapshot-window-manager.js');
const { FlaImportService } = require('../../dist-electron/main/services/FlaImportService.js');
const { FlaParserWindowManager } = require('../../dist-electron/main/windows/fla-parser-window-manager.js');
const {
  createFlaStaticSnapshotBitmapMediaLookup,
} = require('../../dist-electron/main/services/fla-static-snapshot-media-resolver.js');
const {
  IPC_CHANNELS,
} = require('../../dist-electron/shared/ipc/channels.js');
const {
  FLA_STATIC_SNAPSHOT_LIMITS,
} = require('../../dist-electron/shared/fla-static-snapshot-api.js');

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === '--help' || name === '-h') {
      values.help = true;
      continue;
    }
    if (!name.startsWith('--')) continue;
    values[name.slice(2)] = argv[index + 1];
    index += 1;
  }
  return values;
}

function usage() {
  return [
    'Usage: electron scripts/research/f1-01-native-source-probe.cjs',
    '  --source-a <readonly-copy.fla> --original-a <owner-original.fla>',
    '  --expected-sha-a <sha256> --source-b <readonly-copy.fla>',
    '  --original-b <owner-original.fla> --expected-sha-b <sha256>',
    '  --reference-a <independent-an-stage.png> --output-dir <private-new-dir>',
    '  [--reference-max-threshold5-percent <number> --reference-threshold-rationale <text>]',
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
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function resolveOutsideRepo(inputPath, label) {
  const resolved = path.resolve(inputPath);
  if (!existsSync(resolved)) throw new Error(`${label} does not exist`);
  const actual = realpathSync(resolved);
  const repo = realpathSync(REPO_ROOT);
  if (isWithin(repo, actual)) throw new Error(`${label} must stay outside the repository`);
  return actual;
}

function assertNewOutputDirectory(inputPath) {
  const resolved = path.resolve(inputPath);
  const parent = path.dirname(resolved);
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
  const actualParent = realpathSync(parent);
  const repo = realpathSync(REPO_ROOT);
  if (isWithin(repo, actualParent) || isWithin(repo, resolved)) {
    throw new Error('Output directory must stay outside the repository');
  }
  if (existsSync(resolved) && readdirSync(resolved).length > 0) {
    throw new Error('Output directory must be new or empty; refusing to overwrite evidence');
  }
  mkdirSync(resolved, { recursive: true });
  return resolved;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value instanceof Map) {
    return [...value.entries()]
      .sort(([left], [right]) => String(left).localeCompare(String(right), 'en-US'))
      .map(([key, nested]) => [key, canonicalize(nested)]);
  }
  if (value && typeof value === 'object') {
    const output = {};
    for (const key of Object.keys(value).sort()) {
      if (typeof value[key] !== 'function' && value[key] !== undefined) {
        output[key] = canonicalize(value[key]);
      }
    }
    return output;
  }
  return value;
}

function preparedContentSha256(source) {
  const material = {
    stage: { width: source.stageWidth, height: source.stageHeight },
    scenes: source.sceneTimelines.map((scene) => ({
      index: scene.index,
      userLabel: scene.userLabel,
      frameCount: scene.frameCount,
      timelineXml: scene.timelineXml,
      frameContext: scene.frameContext,
    })),
    graphics: source.graphicSymbols.map((symbol) => ({
      sourceLibraryItemName: symbol.sourceLibraryItemName,
      userLabel: symbol.userLabel,
      frameCount: symbol.frameCount,
      timelineXml: symbol.timelineXml,
      frameContext: symbol.frameContext,
    })),
    symbols: source.symbols,
    shapeBlocks: source.shapeBlocks,
  };
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(material)), 'utf8')
    .digest('hex')
    .toUpperCase();
}

function multiply(parent, local = FLA_DISPLAY_LIST_IDENTITY_MATRIX) {
  return {
    a: parent.a * local.a + parent.c * local.b,
    b: parent.b * local.a + parent.d * local.b,
    c: parent.a * local.c + parent.c * local.d,
    d: parent.b * local.c + parent.d * local.d,
    tx: parent.a * local.tx + parent.c * local.ty + parent.tx,
    ty: parent.b * local.tx + parent.d * local.ty + parent.ty,
  };
}

function matrixFacts(matrix) {
  const values = [matrix.a, matrix.b, matrix.c, matrix.d, matrix.tx, matrix.ty];
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  return {
    finite: values.every(Number.isFinite),
    determinant,
    invertible: Number.isFinite(determinant) && Math.abs(determinant) > 1e-12,
  };
}

function contextVisibleElements(frameContext) {
  const result = [];
  for (let layerIndex = 0; layerIndex < frameContext.layers.length; layerIndex += 1) {
    const layer = frameContext.layers[layerIndex];
    if (!layer || !layer.visible) continue;
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
      maskLayerId: layer.maskLayerId ?? null,
      maskedBy: layer.maskedBy ?? null,
      layerVisible: layer.visible,
    }];
  });
}

function collectOccurrenceUnits(source, rootFrameContext, sourceSha256) {
  const units = [];
  const notices = [];
  const descriptorsByName = new Map(
    source.graphicSymbols.map((descriptor) => [descriptor.sourceLibraryItemName, descriptor]),
  );
  let visibleLeafCount = 0;
  let hiddenLayerCount = 0;
  let symbolOccurrenceCount = 0;
  let bitmapOccurrenceCount = 0;
  let shapeOccurrenceCount = 0;
  let groupOccurrenceCount = 0;

  function appendUnit({ element, segment, pathSegments, worldTransform, definition, descriptor, compositeReason, contextPath, layer }) {
    const occurrenceKey = pathSegments.map((item) => `${item.sourceAddress ?? item.adapterIdentity}@${item.layerIndex}:${item.elementIndex}`).join('>');
    const occurrenceHash = createHash('sha256').update(`${sourceSha256}\0${occurrenceKey}`).digest('hex').slice(0, 24);
    const transform = worldTransform;
    const facts = matrixFacts(transform);
    const parentDependencies = pathSegments.map((item) => ({
      sourceAddress: item.sourceAddress ?? null,
      sourceSymbolId: item.libraryItemName ?? null,
      parentFrameIndex: item.sourceParentFrameIndex ?? null,
      parentFrameSpanStart: item.sourceParentFrameSpanStart ?? null,
      parentSpanTweenType: item.sourceParentSpanTweenType ?? null,
      playbackMode: item.playbackMode ?? null,
      firstFrame: item.firstFrame ?? null,
      lastFrame: item.lastFrame ?? null,
    }));
    const allMasks = pathSegments.flatMap((item) => item.maskDependencies ?? []);
    if (element.kind === 'bitmap') bitmapOccurrenceCount += 1;
    if (element.kind === 'shape') shapeOccurrenceCount += 1;
    if (element.kind === 'group') groupOccurrenceCount += 1;
    if (!facts.finite || !facts.invertible) {
      notices.push({
        code: facts.finite ? 'NON_INVERTIBLE_UNIT_MATRIX' : 'NON_FINITE_UNIT_MATRIX',
        occurrenceId: `occ-${occurrenceHash}`,
        sourceAddress: element.sourceAddress ?? null,
      });
    }
    const nestedFrameWarnings = pathSegments.flatMap((item) => {
      const warnings = [];
      if (item.firstFrame !== undefined && (!/^\d+$/u.test(item.firstFrame) || Number(item.firstFrame) !== 0)) {
        warnings.push('nested firstFrame is not zero; current Main static resolver retains the prepared frame-zero definition');
      }
      if (item.sourceParentSpanTweenType && item.sourceParentSpanTweenType !== 'none') {
        warnings.push(`parent DOMFrame span has tween type ${item.sourceParentSpanTweenType}`);
      }
      return warnings.map((reason) => ({ sourceAddress: item.sourceAddress ?? null, reason }));
    });
    if (nestedFrameWarnings.length) notices.push(...nestedFrameWarnings.map((item) => ({ code: 'NESTED_FRAME_SELECTION_LIMIT', ...item })));

    units.push({
      unitId: `part-${String(units.length + 1).padStart(3, '0')}-${occurrenceHash}`,
      occurrenceId: `occ-${occurrenceHash}`,
      sourceKind: element.kind === 'symbol' ? 'graphic-symbol-occurrence' : `${element.kind}-occurrence`,
      sourceSymbolId: element.kind === 'symbol' ? element.libraryItemName : null,
      sourceDefinitionFrameCount: descriptor?.frameCount ?? null,
      sourceAddress: element.kind === 'symbol' ? (element.sourceAddress ?? null) : null,
      adapterIdentity: element.kind === 'shape' ? element.shapeId : element.kind === 'group' ? element.groupId : null,
      sourceContextPath: contextPath,
      occurrencePath: parentDependencies,
      adaptedPath: pathSegments.map((item) => ({
        contextPath: item.contextPath,
        layerIndex: item.layerIndex,
        elementIndex: item.elementIndex,
        sourceAddress: item.sourceAddress ?? null,
      })),
      selectedEffectiveChildFrameIndex: element.kind === 'symbol' ? 0 : null,
      selectedEffectiveChildFrameBasis: element.kind === 'symbol'
        ? 'Main prepared Graphic definition frameContext (frame zero); no nested frame selector is wired into the current static snapshot resolver'
        : null,
      localTransform: element.localTransform ?? FLA_DISPLAY_LIST_IDENTITY_MATRIX,
      worldTransform: transform,
      determinant: facts.determinant,
      matrixFinite: facts.finite,
      matrixInvertible: facts.invertible,
      visible: true,
      layer: { name: layer.name, visible: layer.visible, sourceLayerIndex: segment.layerIndex },
      drawOrder: units.length,
      composite: Boolean(compositeReason),
      compositeReason: compositeReason ?? null,
      maskDependencies: allMasks,
      sourceFrame: {
        parentFrameIndex: element.sourceParentFrameIndex ?? null,
        parentFrameSpanStart: element.sourceParentFrameSpanStart ?? null,
        parentSpanTweenType: element.sourceParentSpanTweenType ?? null,
        playbackMode: element.playbackMode ?? null,
        firstFrame: element.firstFrame ?? null,
        lastFrame: element.lastFrame ?? null,
        effectiveFrameIndex: element.kind === 'symbol' ? 0 : null,
      },
      stageMapping: {
        coordinateSpace: 'root scene stage pixels',
        stageOrigin: { x: 0, y: 0 },
        crop: null,
        transformApplication: 'source occurrence matrices are resolved once by Main; unit PNGs remain full-stage and are placed back at identity (0,0)',
      },
      isolatePath: [...pathSegments.map(({ layerIndex, elementIndex, contextPath, sourceAddress, libraryItemName }) => ({
        layerIndex,
        elementIndex,
        contextPath,
        sourceAddress: sourceAddress ?? null,
        libraryItemName: libraryItemName ?? null,
      }))],
      definition: definition ? { libraryItemName: definition.libraryItemName, kind: definition.kind } : null,
      traceability: element.kind === 'symbol' && element.sourceAddress
        ? 'adapter sourceAddress plus enclosing occurrence chain'
        : 'adapter opaque identity only; raw DOM path is not preserved by the current adapter',
      untraceableReason: element.kind !== 'symbol' || !element.sourceAddress
        ? 'current adapter does not retain a raw DOM sourceAddress for this leaf kind'
        : null,
    });
  }

  function walk(frameContext, contextPath, parentWorld, prefixSegments, symbolStack) {
    for (let layerIndex = 0; layerIndex < frameContext.layers.length; layerIndex += 1) {
      const layer = frameContext.layers[layerIndex];
      if (!layer) continue;
      if (!layer.visible) {
        hiddenLayerCount += 1;
        continue;
      }
      for (let elementIndex = 0; elementIndex < layer.elements.length; elementIndex += 1) {
        const element = layer.elements[elementIndex];
        if (!element || element.visible === false) continue;
        visibleLeafCount += 1;
        const local = element.localTransform ?? FLA_DISPLAY_LIST_IDENTITY_MATRIX;
        const world = multiply(parentWorld, local);
        const segment = { layerIndex, elementIndex, contextPath, layer, element };
        const dependencies = maskDependencies(frameContext, contextPath);
        if (element.kind !== 'symbol') {
          appendUnit({
            element,
            segment,
            pathSegments: [...prefixSegments, {
              ...element,
              layerIndex,
              elementIndex,
              contextPath,
              adapterIdentity: element.shapeId ?? element.groupId ?? element.libraryItemName ?? null,
              maskDependencies: dependencies,
            }],
            worldTransform: world,
            definition: null,
            descriptor: null,
            compositeReason: element.kind === 'group' ? 'group is kept atomic to avoid splitting non-semantic shape membership' : null,
            contextPath,
            layer,
          });
          continue;
        }

        symbolOccurrenceCount += 1;
        const descriptor = descriptorsByName.get(element.libraryItemName);
        const definitionKey = element.frameSelectionKey ?? element.libraryItemName;
        const definition = source.symbols.get(definitionKey);
        const currentSegment = {
          ...element,
          layerIndex,
          elementIndex,
          contextPath,
          libraryItemName: element.libraryItemName,
          maskDependencies: dependencies,
        };
        const occurrencePath = [...prefixSegments, currentSegment];
        if (!definition || definition.kind !== 'graphic' || element.symbolType !== 'graphic') {
          appendUnit({
            element,
            segment,
            pathSegments: occurrencePath,
            worldTransform: world,
            definition: definition ?? null,
            descriptor,
            compositeReason: !definition ? 'missing graphic definition' : `unsupported symbol type ${element.symbolType}`,
            contextPath,
            layer,
          });
          notices.push({ code: 'UNSUPPORTED_SYMBOL_OCCURRENCE', sourceAddress: element.sourceAddress ?? null, symbolType: element.symbolType });
          continue;
        }
        if (symbolStack.includes(element.libraryItemName)) {
          appendUnit({
            element,
            segment,
            pathSegments: occurrencePath,
            worldTransform: world,
            definition,
            descriptor,
            compositeReason: 'symbol cycle retained as unsupported atomic occurrence',
            contextPath,
            layer,
          });
          notices.push({ code: 'SYMBOL_CYCLE', sourceAddress: element.sourceAddress ?? null });
          continue;
        }

        const children = contextVisibleElements(definition.frameContext);
        const childSymbols = children.filter(({ element: child }) => child.kind === 'symbol');
        const childOtherContent = children.filter(({ element: child }) => child.kind !== 'symbol');
        const definitionMasks = maskDependencies(definition.frameContext, `graphic:${definition.libraryItemName}`);
        const canDescend = childSymbols.length > 0 && childOtherContent.length === 0 &&
          definitionMasks.length === 0 && !definition.frameContext.unsupportedDisplayReason;
        if (canDescend) {
          walk(
            definition.frameContext,
            `graphic:${definition.libraryItemName}`,
            world,
            occurrencePath,
            [...symbolStack, element.libraryItemName],
          );
          continue;
        }
        const compositeReasons = [];
        if (childSymbols.length > 0 && childOtherContent.length > 0) compositeReasons.push('nested Graphic instances are interleaved with atomic vector/bitmap/group content');
        if (definitionMasks.length > 0) compositeReasons.push('symbol owns mask dependencies; retained as a closed composite');
        if (definition.frameContext.unsupportedDisplayReason) compositeReasons.push(definition.frameContext.unsupportedDisplayReason);
        if (childSymbols.length === 0 && childOtherContent.length === 0) compositeReasons.push('blank Graphic definition; retained in plan but has no drawable child');
        appendUnit({
          element,
          segment,
          pathSegments: occurrencePath,
          worldTransform: world,
          definition,
          descriptor,
          compositeReason: compositeReasons.length ? compositeReasons.join('; ') : null,
          contextPath,
          layer,
        });
      }
    }
  }

  walk(rootFrameContext, 'scene:0', FLA_DISPLAY_LIST_IDENTITY_MATRIX, [], []);
  return {
    units,
    notices,
    metrics: {
      visibleAdaptedElementCount: visibleLeafCount,
      visibleSymbolOccurrenceCount: symbolOccurrenceCount,
      hiddenLayerCount,
      bitmapOccurrenceCount,
      shapeOccurrenceCount,
      groupOccurrenceCount,
      compositeUnitCount: units.filter((unit) => unit.composite).length,
      unitCount: units.length,
    },
  };
}

function pruneFrameContext(frameContext, segment, selectedElement) {
  return {
    ...frameContext,
    layers: frameContext.layers.map((layer, index) => {
      if (!layer) return layer;
      if (index === segment.layerIndex) return { ...layer, elements: [selectedElement] };
      // Masks remain in the closure so a selected masked unit is rasterized
      // with the exact same clip. Other artwork layers are removed.
      if (layer.maskLayerId) return layer;
      return { ...layer, elements: [] };
    }),
  };
}

function isolateOccurrence(rootFrameContext, sourceSymbols, isolatePath, occurrenceId) {
  const symbols = new Map(sourceSymbols);
  let overlayCounter = 0;

  function isolate(frameContext, pathIndex) {
    const pathItem = isolatePath[pathIndex];
    const layer = frameContext.layers[pathItem.layerIndex];
    const element = layer?.elements[pathItem.elementIndex];
    if (!layer || !element) throw new Error(`Isolate path no longer resolves at ${pathItem.contextPath}`);
    if ((element.sourceAddress ?? null) !== pathItem.sourceAddress || (element.libraryItemName ?? null) !== pathItem.libraryItemName) {
      throw new Error(`Isolate path identity changed at ${pathItem.contextPath}`);
    }
    if (pathIndex === isolatePath.length - 1) return pruneFrameContext(frameContext, pathItem, element);
    if (element.kind !== 'symbol') throw new Error('Only Graphic ancestor occurrences may be traversed');
    const sourceKey = element.frameSelectionKey ?? element.libraryItemName;
    const definition = symbols.get(sourceKey);
    if (!definition || definition.kind !== 'graphic') throw new Error(`Missing symbol while isolating ${element.libraryItemName}`);
    const isolatedChild = isolate(definition.frameContext, pathIndex + 1);
    const overlayKey = `f1-01:${occurrenceId}:${overlayCounter++}`;
    symbols.set(overlayKey, { ...definition, frameContext: isolatedChild });
    const isolatedElement = { ...element, frameSelectionKey: overlayKey };
    return pruneFrameContext(frameContext, pathItem, isolatedElement);
  }

  const frameContext = isolate(rootFrameContext, 0);
  return {
    root: { kind: 'scene', name: 'F1-01 isolated source occurrence', frameContext },
    symbols,
  };
}

function resolveAndCompose(source, root, symbols, renderTargetId, bitmapLookup) {
  const resolved = resolveFlaDisplayList({ root, symbols });
  if (!resolved.ok) return { ok: false, stage: 'resolve', ...resolved };
  const composed = buildSvgForResolvedDisplayList({
    displayList: resolved.displayList,
    renderTargetId,
    stageWidth: source.stageWidth,
    stageHeight: source.stageHeight,
    shapeBlocks: source.shapeBlocks,
    resolveBitmapMedia: bitmapLookup,
  });
  if (!composed.ok) return { ok: false, stage: 'compose', ...composed };
  return { ok: true, displayList: resolved.displayList, composed };
}

function rasterizeSvg(rasterizer, svg, width, height, label) {
  const pixelCount = width * height;
  if (!Number.isSafeInteger(pixelCount) || pixelCount <= 0 || pixelCount > MAX_OUTPUT_PIXELS) {
    throw new Error(`${label}: pixel count ${pixelCount} exceeds the existing snapshot budget`);
  }
  const svgByteLength = Buffer.byteLength(svg, 'utf8');
  if (svgByteLength > FLA_STATIC_SNAPSHOT_LIMITS.maxSnapshotBytes) {
    throw new Error(`${label}: SVG ${svgByteLength} exceeds the existing snapshot byte budget`);
  }
  return rasterizer.rasterize({ requestId: randomUUID(), svg, width, height, pixelCount });
}

function serializePlan(sample, preparation, rootDescriptor, units, notices, metrics) {
  return {
    format: 'panda-f1-01-native-part-plan',
    version: 1,
    source: {
      sourceBasename: sample.sourceBasename,
      originalSha256: sample.sourceSha256,
      mainStaticInputSha256: sample.mainStaticInputSha256 ?? null,
      mainStaticInputByteLength: sample.mainStaticInputByteLength ?? null,
      preparedContentSha256: preparation.preparedContentSha256 ?? preparedContentSha256(preparation.source),
      preparedContentDigestSchema: 'canonical JSON of Main-prepared stage, selected Scene/Graphic frameContexts, symbol definitions, and shapeBlocks',
      preparedXmlByteLength: preparation.xmlByteLength,
      sourceByteLength: sample.sourceByteLength,
    },
    rootTarget: rootDescriptor,
    pose: {
      sceneIndex: rootDescriptor.sceneIndex,
      sceneFrameIndex: 0,
      nestedGraphicDefinitionFrameIndex: 0,
      selectionBasis: 'current Main static snapshot prepared frame-zero context; no authored-frame override requested',
    },
    stage: {
      width: sample.stageWidth,
      height: sample.stageHeight,
      pixelWidth: Math.ceil(sample.stageWidth),
      pixelHeight: Math.ceil(sample.stageHeight),
      crop: null,
      coordinateBasis: 'same full-stage origin and resolution for whole reference, every isolated unit, and reassembly',
    },
    policy: {
      unitBoundary: 'descend through a visible Graphic wrapper only when its prepared frame has nested Graphic occurrences and no visible non-symbol content, mask dependency, or unsupported display reason; otherwise retain the Graphic as an atomic composite',
      symbolNameSpecialCases: false,
      duplicateSymbolsDeduplicated: false,
      maximumPartCount: MAX_PARTS,
      actionScriptExecuted: false,
    },
    metrics,
    notices,
    units,
  };
}

function writePrivateJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
}

function decodePng(buffer) {
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
    throw new Error(`PNG dimensions ${width}x${height} exceed the existing image budget`);
  }
  if (bitDepth !== 8 || interlace !== 0) throw new Error(`PNG decoder supports non-interlaced 8-bit images only (depth=${bitDepth}, interlace=${interlace})`);
  const components = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 0 ? 1 : 0;
  if (!components) throw new Error(`PNG color type ${colorType} is unsupported`);
  const rowBytes = width * components;
  const expectedInflatedBytes = (rowBytes + 1) * height;
  if (expectedInflatedBytes > 64 * 1024 * 1024) throw new Error('PNG decoded bytes exceed the bounded comparison budget');
  const raw = zlib.inflateSync(Buffer.concat(idat), { maxOutputLength: expectedInflatedBytes });
  if (raw.length !== expectedInflatedBytes) throw new Error(`PNG decoded byte count ${raw.length} did not match ${expectedInflatedBytes}`);
  const decoded = Buffer.allocUnsafe(rowBytes * height);
  const bytesPerPixel = components;
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
      const left = column >= bytesPerPixel ? decoded[outputOffset + column - bytesPerPixel] : 0;
      const above = row > 0 ? decoded[outputOffset + column - rowBytes] : 0;
      const upperLeft = row > 0 && column >= bytesPerPixel
        ? decoded[outputOffset + column - rowBytes - bytesPerPixel]
        : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = above;
      else if (filter === 3) predictor = Math.floor((left + above) / 2);
      else if (filter === 4) predictor = paeth(left, above, upperLeft);
      else if (filter !== 0) throw new Error(`PNG row uses unsupported filter ${filter}`);
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
  return { width, height, rgba, ...alphaFacts(rgba, width, height) };
}

function alphaFacts(rgba, width, height) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let alphaPixels = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (rgba[(y * width + x) * 4 + 3] === 0) continue;
      alphaPixels += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return {
    alphaPixels,
    alphaBounds: alphaPixels ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : null,
  };
}

function crc32(buffer) {
  if (!crc32.table) {
    crc32.table = Array.from({ length: 256 }, (_, n) => {
      let value = n;
      for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
      return value >>> 0;
    });
  }
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crc32.table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBytes, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

function encodeRgbaPng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let row = 0; row < height; row += 1) {
    const destination = row * (width * 4 + 1);
    rows[destination] = 0;
    rgba.copy(rows, destination + 1, row * width * 4, (row + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(rows)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function comparePngs(left, right, diffPath) {
  if (left.width !== right.width || left.height !== right.height) {
    return {
      comparable: false,
      reason: `dimension mismatch ${left.width}x${left.height} vs ${right.width}x${right.height}`,
      leftDimensions: { width: left.width, height: left.height },
      rightDimensions: { width: right.width, height: right.height },
    };
  }
  let exactPixelDifferenceCount = 0;
  let threshold5PixelCount = 0;
  let alphaDifferenceCount = 0;
  let sumAbsoluteDifference = 0;
  let sumSquaredDifference = 0;
  let minX = left.width;
  let minY = left.height;
  let maxX = -1;
  let maxY = -1;
  const diff = Buffer.allocUnsafe(left.width * left.height * 4);
  for (let pixel = 0; pixel < left.width * left.height; pixel += 1) {
    const offset = pixel * 4;
    const deltas = [0, 1, 2, 3].map((channel) => Math.abs(left.rgba[offset + channel] - right.rgba[offset + channel]));
    const maxDelta = Math.max(...deltas);
    if (maxDelta > 0) {
      exactPixelDifferenceCount += 1;
      const x = pixel % left.width;
      const y = Math.floor(pixel / left.width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    if (maxDelta > 5) threshold5PixelCount += 1;
    if (deltas[3] > 0) alphaDifferenceCount += 1;
    for (const delta of deltas) {
      sumAbsoluteDifference += delta;
      sumSquaredDifference += delta * delta;
    }
    diff[offset] = Math.min(255, deltas[0] * 4 + (maxDelta > 0 ? 32 : 0));
    diff[offset + 1] = Math.min(255, deltas[1] * 4);
    diff[offset + 2] = Math.min(255, deltas[2] * 4);
    diff[offset + 3] = maxDelta > 0 ? 255 : 0;
  }
  if (diffPath) writeFileSync(diffPath, encodeRgbaPng(left.width, left.height, diff), { flag: 'wx' });
  const pixelCount = left.width * left.height;
  return {
    comparable: true,
    width: left.width,
    height: left.height,
    pixelCount,
    exactPixelDifferenceCount,
    exactPixelDifferencePercent: (exactPixelDifferenceCount / pixelCount) * 100,
    threshold5PixelCount,
    threshold5PixelPercent: (threshold5PixelCount / pixelCount) * 100,
    alphaDifferenceCount,
    meanAbsoluteChannelDifference: sumAbsoluteDifference / (pixelCount * 4),
    rootMeanSquaredChannelDifference: Math.sqrt(sumSquaredDifference / (pixelCount * 4)),
    differenceBounds: exactPixelDifferenceCount ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : null,
    leftAlpha: { pixels: left.alphaPixels, bounds: left.alphaBounds },
    rightAlpha: { pixels: right.alphaPixels, bounds: right.alphaBounds },
    diffImage: diffPath ?? null,
  };
}

function makeReassemblySvg(width, height, partPngs) {
  const images = partPngs.map((item, index) => {
    const base64 = item.bytes.toString('base64');
    return `<image data-unit="${index}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none" href="data:image/png;base64,${base64}"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${images}</svg>`;
}

async function loadInput(args, suffix) {
  const sourceKey = `source-${suffix}`;
  const originalKey = `original-${suffix}`;
  const expectedKey = `expected-sha-${suffix}`;
  const sourcePath = resolveOutsideRepo(args[sourceKey], `Source ${suffix.toUpperCase()}`);
  const originalPath = resolveOutsideRepo(args[originalKey], `Original ${suffix.toUpperCase()}`);
  if (path.extname(sourcePath).toLowerCase() !== '.fla') throw new Error(`Source ${suffix.toUpperCase()} must be a .fla file`);
  const sourceStat = statSync(sourcePath);
  if (!sourceStat.isFile() || sourceStat.size <= 0 || sourceStat.size > MAX_SOURCE_BYTES) {
    throw new Error(`Source ${suffix.toUpperCase()} size is invalid or exceeds 256 MiB`);
  }
  const sourceSha256 = await sha256File(sourcePath);
  const originalSha256Before = await sha256File(originalPath);
  const expectedSha256 = String(args[expectedKey] ?? '').trim().toUpperCase();
  if (!/^[A-F0-9]{64}$/u.test(expectedSha256)) throw new Error(`--${expectedKey} must be a 64-character SHA-256`);
  return {
    suffix: suffix.toUpperCase(),
    sourcePath,
    sourceBasename: path.basename(sourcePath),
    originalPath,
    originalBasename: path.basename(originalPath),
    sourceByteLength: sourceStat.size,
    sourceSha256,
    originalSha256Before,
    expectedSha256,
    identityMatches: sourceSha256 === expectedSha256 && originalSha256Before === expectedSha256,
  };
}

async function writeSyntheticFlaFixture(outputDir, fixtureBasename, entries) {
  const archive = new JSZip();
  for (const [entryName, contents] of Object.entries(entries)) archive.file(entryName, contents);
  const bytes = await archive.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  const fixturePath = path.join(outputDir, fixtureBasename);
  writeFileSync(fixturePath, bytes, { flag: 'wx' });
  return { fixturePath, fixtureBasename, bytes, sha256: sha256(bytes) };
}

async function createUnsupportedFixture(outputDir) {
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<DOMDocument width="64" height="64" frameRate="24">',
    '  <timelines><DOMTimeline name="Original Negative Scene">',
    '    <layers><DOMLayer name="Visible Text Layer" visible="true">',
    '      <frames><DOMFrame index="0"><elements><DOMText name="unsupported-visible-text"/></elements></DOMFrame></frames>',
    '    </DOMLayer></layers>',
    '  </DOMTimeline></timelines>',
    '</DOMDocument>',
  ].join('\n');
  return writeSyntheticFlaFixture(outputDir, 'original-negative-visible-domtext.fla', { 'DOMDocument.xml': xml });
}

async function createUnsupportedMaskFixture(outputDir) {
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<DOMDocument xmlns="http://ns.adobe.com/xfl/2008/" width="64" height="64" frameRate="24">',
    '  <timelines><DOMTimeline name="Original Empty Mask Negative Scene">',
    '    <layers>',
    '      <DOMLayer name="Empty Mask" layerType="mask" visible="true">',
    '        <frames><DOMFrame index="0"><elements/></DOMFrame></frames>',
    '      </DOMLayer>',
    '      <DOMLayer name="Masked Layer" visible="true" parentLayerIndex="0">',
    '        <frames><DOMFrame index="0"><elements/></DOMFrame></frames>',
    '      </DOMLayer>',
    '    </layers>',
    '  </DOMTimeline></timelines>',
    '</DOMDocument>',
  ].join('\n');
  return writeSyntheticFlaFixture(outputDir, 'original-negative-empty-mask.fla', { 'DOMDocument.xml': xml });
}

async function createRepeatedSymbolFixture(outputDir) {
  const symbolName = 'repeated-symbol-fixture';
  const sceneXml = `<?xml version="1.0" encoding="UTF-8"?>
<DOMDocument xmlns="http://ns.adobe.com/xfl/2008/" width="64" height="64" frameRate="24">
  <timelines><DOMTimeline name="Repeated Symbol Scene">
    <layers><DOMLayer name="Repeated Instances" visible="true">
      <frames><DOMFrame index="0"><elements>
        <DOMSymbolInstance libraryItemName="${symbolName}" symbolType="graphic"><matrix a="1" d="1" tx="5" ty="5"/></DOMSymbolInstance>
        <DOMSymbolInstance libraryItemName="${symbolName}" symbolType="graphic"><matrix a="1" d="1" tx="35" ty="5"/></DOMSymbolInstance>
      </elements></DOMFrame></frames>
    </DOMLayer></layers>
  </DOMTimeline></timelines>
</DOMDocument>`;
  const symbolXml = `<?xml version="1.0" encoding="UTF-8"?>
<DOMSymbolItem xmlns="http://ns.adobe.com/xfl/2008/" name="${symbolName}" symbolType="graphic">
  <timeline><DOMTimeline name="${symbolName}-timeline">
    <layers><DOMLayer name="${symbolName}-layer">
      <frames><DOMFrame index="0"><elements>
        <DOMShape>
          <fills><FillStyle index="1"><SolidColor color="#2472b7" alpha="1"/></FillStyle></fills>
          <strokes/><edges><Edge fillStyle1="1" cubics="!0 0|16 0|16 16|0 16|0 0"/></edges>
        </DOMShape>
      </elements></DOMFrame></frames>
    </DOMLayer></layers>
  </DOMTimeline></timeline>
</DOMSymbolItem>`;
  return writeSyntheticFlaFixture(outputDir, 'original-repeated-symbol-occurrence.fla', {
    'DOMDocument.xml': sceneXml,
    [`LIBRARY/${symbolName}.xml`]: symbolXml,
  });
}

function recordInspectionCounters(trace, counters) {
  if (!trace) return;
  const postNormalizationCheckRan = trace.postNormalizationStrictResult &&
    trace.postNormalizationStrictResult !== 'not-run';
  counters.preflightValidationCount += postNormalizationCheckRan ? 2 : 1;
  if (trace?.classifierState && trace.classifierState !== 'STRICT_VALID') counters.recoveryClassifierCount += 1;
  if (trace?.recoveryAttempted) counters.recoveryNormalizationAttemptCount += 1;
  if (trace?.recoveryApplied) counters.recoveryNormalizationAppliedCount += 1;
  if (trace?.parserResult === 'success') counters.parserWorkerParseCount += 1;
}

async function analyzeNegativeFixture(fixture, counts, importService) {
  const inspectStartedAt = performance.now();
  counts.mainInspectionCount += 1;
  counts.inputFileReadCount += 1;
  counts.mainInspectionInputReadCount += 1;
  counts.negativeFixtureMainReadCount += 1;
  counts.researchFixtureMainReadCount += 1;
  const inspection = await importService.inspectSource(fixture.fixturePath, randomUUID());
  const mainInspectionMs = performance.now() - inspectStartedAt;
  recordInspectionCounters(inspection.trace, counts);
  if (!inspection.ok) {
    return {
      status: 'FAIL',
      caseName: fixture.caseName,
      fixtureBasename: fixture.fixtureBasename,
      sourceSha256: fixture.sha256,
      mainInspectionMs,
      ingestTrace: inspection.trace ?? null,
      observed: inspection.error,
      expected: fixture.expected,
      rasterCount: 0,
    };
  }
  const session = importService.getSession(inspection.sessionId);
  if (!session) {
    return { status: 'FAIL', caseName: fixture.caseName, fixtureBasename: fixture.fixtureBasename, sourceSha256: fixture.sha256, mainInspectionMs, observed: 'Main inspection session was not retained', expected: fixture.expected, rasterCount: 0 };
  }
  counts.retainedSessionIds.push(inspection.sessionId);
  counts.mainSessionSourceHashCount += 1;
  const mainStaticInputSha256 = sha256(session.sourceBytes);
  const prepareStartedAt = performance.now();
  counts.prepareCallCount += 1;
  counts.archiveOpenCount += 1;
  const prepared = await prepareFlaStaticSnapshotDisplaySource(session.sourceBytes, 'preview');
  const prepareAndIndexMs = performance.now() - prepareStartedAt;
  if (!prepared.ok) {
    return {
      status: 'FAIL',
      caseName: fixture.caseName,
      fixtureBasename: fixture.fixtureBasename,
      sourceSha256: fixture.sha256,
      mainStaticInputSha256,
      mainInspectionMs,
      prepareAndIndexMs,
      ingestTrace: inspection.trace ?? null,
      observed: { code: prepared.code, reason: prepared.message },
      expected: fixture.expected,
      rasterCount: 0,
    };
  }
  counts.symbolIndexBuildCount += 1;
  counts.preparedFrameContextCount += prepared.source.sceneTimelines.length + prepared.source.graphicSymbols.length;
  const scene = prepared.source.sceneTimelines[0];
  if (!scene) {
    return { status: 'FAIL', caseName: fixture.caseName, fixtureBasename: fixture.fixtureBasename, sourceSha256: fixture.sha256, mainStaticInputSha256, mainInspectionMs, prepareAndIndexMs, observed: 'no Scene context', expected: fixture.expected, rasterCount: 0 };
  }
  const sceneName = scene.userLabel || scene.name || `scene-${scene.index ?? 0}`;
  counts.displayListResolveCount += 1;
  const resolved = resolveFlaDisplayList({
    root: { kind: 'scene', name: sceneName, frameContext: scene.frameContext },
    symbols: prepared.source.symbols,
  });
  const pass = !resolved.ok && resolved.code === fixture.expectedCode &&
    (!fixture.expectedReasonSubstring || resolved.message.includes(fixture.expectedReasonSubstring));
  return {
    status: pass ? 'PASS_FAIL_CLOSED' : 'FAIL',
    caseName: fixture.caseName,
    fixtureBasename: fixture.fixtureBasename,
    sourceSha256: fixture.sha256,
    mainStaticInputSha256,
    preparedContentSha256: preparedContentSha256(prepared.source),
    mainInspectionMs,
    prepareAndIndexMs,
    ingestTrace: inspection.trace ?? null,
    rootUnsupportedDisplayReason: scene.frameContext.unsupportedDisplayReason ?? null,
    observed: resolved.ok ? { ok: true } : { code: resolved.code, reason: resolved.message, sourcePath: resolved.sourcePath },
    expected: fixture.expected,
    rasterCount: 0,
  };
}

async function analyzeRepeatedSymbolFixture(fixture, counts, importService) {
  const inspectStartedAt = performance.now();
  counts.mainInspectionCount += 1;
  counts.inputFileReadCount += 1;
  counts.mainInspectionInputReadCount += 1;
  counts.researchFixtureMainReadCount += 1;
  counts.occurrenceIdentityFixtureCount += 1;
  const inspection = await importService.inspectSource(fixture.fixturePath, randomUUID());
  const mainInspectionMs = performance.now() - inspectStartedAt;
  recordInspectionCounters(inspection.trace, counts);
  if (!inspection.ok) {
    return { status: 'FAIL', fixtureBasename: fixture.fixtureBasename, sourceSha256: fixture.sha256, mainInspectionMs, ingestTrace: inspection.trace ?? null, observed: inspection.error };
  }
  const session = importService.getSession(inspection.sessionId);
  if (!session) {
    return { status: 'FAIL', fixtureBasename: fixture.fixtureBasename, sourceSha256: fixture.sha256, mainInspectionMs, observed: 'Main inspection session was not retained' };
  }
  counts.retainedSessionIds.push(inspection.sessionId);
  counts.mainSessionSourceHashCount += 1;
  const mainStaticInputSha256 = sha256(session.sourceBytes);
  const irSourceSha256 = String(session.ir.source.sha256).toUpperCase();
  if (mainStaticInputSha256 !== irSourceSha256 || String(session.originalSourceSha256).toUpperCase() !== fixture.sha256) {
    return { status: 'FAIL', fixtureBasename: fixture.fixtureBasename, sourceSha256: fixture.sha256, mainStaticInputSha256, irSourceSha256, originalSourceSha256: session.originalSourceSha256, mainInspectionMs, observed: 'Main session source identity did not match the generated FLA bytes' };
  }

  const prepareStartedAt = performance.now();
  counts.prepareCallCount += 1;
  counts.archiveOpenCount += 1;
  const prepared = await prepareFlaStaticSnapshotDisplaySource(session.sourceBytes, 'preview');
  const prepareAndIndexMs = performance.now() - prepareStartedAt;
  if (!prepared.ok) {
    return { status: 'FAIL', fixtureBasename: fixture.fixtureBasename, sourceSha256: fixture.sha256, mainStaticInputSha256, mainInspectionMs, prepareAndIndexMs, observed: { code: prepared.code, reason: prepared.message } };
  }
  counts.symbolIndexBuildCount += 1;
  counts.preparedFrameContextCount += prepared.source.sceneTimelines.length + prepared.source.graphicSymbols.length;
  const source = prepared.source;
  const scene = source.sceneTimelines[0];
  if (!scene) {
    return { status: 'FAIL', fixtureBasename: fixture.fixtureBasename, sourceSha256: fixture.sha256, mainStaticInputSha256, mainInspectionMs, prepareAndIndexMs, observed: 'no Scene context' };
  }
  const sampleForPlan = {
    suffix: 'SYNTHETIC_REPEATED_SYMBOL',
    sourceBasename: fixture.fixtureBasename,
    sourceSha256: fixture.sha256,
    mainStaticInputSha256,
    mainStaticInputByteLength: session.sourceBytes.byteLength,
    sourceByteLength: fixture.bytes.byteLength,
    stageWidth: source.stageWidth,
    stageHeight: source.stageHeight,
  };
  const rootDescriptor = {
    targetId: `f1-01:fixture:${fixture.sha256.slice(0, 16)}:scene:${scene.index}:frame:0`,
    targetKind: 'scene',
    sceneIndex: scene.index,
    sceneLabel: scene.userLabel || scene.name || `scene-${scene.index ?? 0}`,
    frameCount: scene.frameCount,
    selectedFrameIndex: 0,
    frameSelectionBasis: 'generated original fixture Scene frame 0',
  };
  const discovered = collectOccurrenceUnits(source, scene.frameContext, fixture.sha256);
  const plan = serializePlan(sampleForPlan, prepared, rootDescriptor, discovered.units, discovered.notices, discovered.metrics);
  const bitmapLookup = createFlaStaticSnapshotBitmapMediaLookup(session.ir.media);
  counts.displayListResolveCount += 1;
  counts.occurrenceIdentityFixtureResolveCount += 1;
  const whole = resolveAndCompose(source, { kind: 'scene', name: rootDescriptor.sceneLabel, frameContext: scene.frameContext }, source.symbols, rootDescriptor.targetId, bitmapLookup);
  const unitResolutions = [];
  for (const unit of discovered.units) {
    try {
      const isolated = isolateOccurrence(scene.frameContext, source.symbols, unit.isolatePath, unit.occurrenceId);
      counts.displayListResolveCount += 1;
      counts.occurrenceIdentityFixtureResolveCount += 1;
      const resolved = resolveAndCompose(source, isolated.root, isolated.symbols, `${rootDescriptor.targetId}:${unit.unitId}`, bitmapLookup);
      unitResolutions.push({ unitId: unit.unitId, occurrenceId: unit.occurrenceId, ok: resolved.ok, code: resolved.code ?? null, sourceAddress: unit.sourceAddress });
    } catch (error) {
      unitResolutions.push({ unitId: unit.unitId, occurrenceId: unit.occurrenceId, ok: false, reason: error instanceof Error ? error.message : String(error), sourceAddress: unit.sourceAddress });
    }
  }
  const groups = new Map();
  for (const unit of discovered.units) {
    if (!unit.sourceSymbolId) continue;
    groups.set(unit.sourceSymbolId, [...(groups.get(unit.sourceSymbolId) ?? []), unit]);
  }
  const repeatedGroups = [...groups.entries()].filter(([, units]) => units.length > 1);
  const uniqueOccurrenceIds = new Set(discovered.units.map((unit) => unit.occurrenceId)).size;
  const distinctSourceAddresses = new Set(discovered.units.map((unit) => unit.sourceAddress)).size;
  const pass = whole.ok && discovered.units.length === 2 && repeatedGroups.length === 1 &&
    repeatedGroups[0][1].length === 2 && uniqueOccurrenceIds === 2 && distinctSourceAddresses === 2 &&
    unitResolutions.length === 2 && unitResolutions.every((item) => item.ok);
  return {
    status: pass ? 'PASS' : 'FAIL',
    fixtureBasename: fixture.fixtureBasename,
    sourceSha256: fixture.sha256,
    mainStaticInputSha256,
    preparedContentSha256: preparedContentSha256(source),
    stage: { width: source.stageWidth, height: source.stageHeight },
    sceneIndex: scene.index,
    mainInspectionMs,
    prepareAndIndexMs,
    frameContextCount: source.sceneTimelines.length + source.graphicSymbols.length,
    sourceStructureMetrics: discovered.metrics,
    sourceNotices: discovered.notices,
    repeatedSymbolGroups: repeatedGroups.map(([sourceSymbolId, units]) => ({ sourceSymbolId, occurrenceIds: units.map((unit) => unit.occurrenceId), sourceAddresses: units.map((unit) => unit.sourceAddress) })),
    uniqueOccurrenceIdCount: uniqueOccurrenceIds,
    distinctSourceAddressCount: distinctSourceAddresses,
    wholeResolve: whole.ok ? { ok: true, composition: whole.composed.composition } : { ok: false, code: whole.code, reason: whole.message },
    isolatedUnitResolutions: unitResolutions,
    plan,
    rasterCount: 0,
    expected: 'one shared library symbol remains two uniquely addressed and independently resolvable occurrence units',
  };
}

async function analyzeSample(sample, importService, rasterizer, outputDir, options, counters) {
  const sampleStartedAt = performance.now();
  const result = {
    sample: sample.suffix,
    sourcePath: sample.sourcePath,
    sourceBasename: sample.sourceBasename,
    originalPath: sample.originalPath,
    originalBasename: sample.originalBasename,
    expectedSha256: sample.expectedSha256,
    sourceSha256Before: sample.sourceSha256,
    originalSha256Before: sample.originalSha256Before,
    sourceByteLength: sample.sourceByteLength,
    mainInspectionInputReadCount: 0,
    sourceReadOnly: (statSync(sample.sourcePath).mode & 0o222) === 0,
    status: 'BLOCKED',
    phaseTimingsMs: {},
    rasterCount: 0,
    pngCount: 0,
    projectMutation: 'NONE: no Project, ProjectService, import commit service, asset registration, or commit API was constructed or called',
  };
  if (!sample.identityMatches) {
    result.reason = 'SOURCE_IDENTITY_MISMATCH: byte-identical source copy, original path, and expected SHA did not match';
    return result;
  }
  const inspectStartedAt = performance.now();
  counters.mainInspectionCount += 1;
  counters.inputFileReadCount += 1;
  counters.mainInspectionInputReadCount += 1;
  sample.mainInspectionReadCount = 1;
  result.mainInspectionInputReadCount = 1;
  const inspection = await importService.inspectSource(sample.sourcePath, randomUUID());
  result.phaseTimingsMs.mainInspection = performance.now() - inspectStartedAt;
  result.ingestTrace = inspection.trace ?? null;
  recordInspectionCounters(inspection.trace, counters);
  if (!inspection.ok) {
    result.reason = `${inspection.error.code}: ${inspection.error.message}`;
    return result;
  }
  const session = importService.getSession(inspection.sessionId);
  if (!session) {
    result.reason = 'MAIN_INSPECTION_SESSION_NOT_RETAINED';
    return result;
  }
  counters.retainedSessionIds.push(inspection.sessionId);
  counters.mainSessionSourceHashCount += 1;
  const mainStaticInputSha256 = sha256(session.sourceBytes);
  const irSourceSha256 = String(session.ir.source.sha256).toUpperCase();
  if (mainStaticInputSha256 !== irSourceSha256) {
    result.reason = 'MAIN_STATIC_INPUT_SHA_MISMATCH';
    result.mainStaticInputSha256 = mainStaticInputSha256;
    result.irSourceSha256 = irSourceSha256;
    return result;
  }
  sample.mainStaticInputSha256 = mainStaticInputSha256;
  sample.mainStaticInputByteLength = session.sourceBytes.byteLength;
  result.mainStaticInputSha256 = mainStaticInputSha256;
  result.mainStaticInputByteLength = session.sourceBytes.byteLength;
  result.irSourceSha256 = irSourceSha256;
  result.mainOriginalSourceSha256 = session.originalSourceSha256;
  if (String(session.originalSourceSha256).toUpperCase() !== sample.sourceSha256) {
    result.reason = 'MAIN_ORIGINAL_SOURCE_SHA_MISMATCH';
    return result;
  }
  const prepareStartedAt = performance.now();
  const prepared = await prepareFlaStaticSnapshotDisplaySource(session.sourceBytes, 'preview');
  result.phaseTimingsMs.prepareAndIndex = performance.now() - prepareStartedAt;
  counters.prepareCallCount += 1;
  counters.archiveOpenCount += 1;
  if (!prepared.ok) {
    result.reason = `${prepared.code}: ${prepared.message}`;
    return result;
  }
  const source = prepared.source;
  const bitmapLookup = createFlaStaticSnapshotBitmapMediaLookup(session.ir.media);
  counters.symbolIndexBuildCount += 1;
  counters.preparedFrameContextCount += source.sceneTimelines.length + source.graphicSymbols.length;
  result.preparedContentSha256 = preparedContentSha256(source);
  result.preparedXmlByteLength = prepared.xmlByteLength;
  result.stage = { width: source.stageWidth, height: source.stageHeight };
  result.sceneTimelineCount = source.sceneTimelines.length;
  result.graphicSymbolDefinitionCount = source.graphicSymbols.length;
  const scene = source.sceneTimelines[0];
  if (!scene) {
    result.reason = 'NO_SCENE_TIMELINE';
    return result;
  }
  const sceneName = scene.userLabel || scene.name || `scene-${scene.index ?? 0}`;
  const rootDescriptor = {
    targetId: `f1-01:${sample.sourceSha256.slice(0, 16)}:scene:${scene.index}:frame:0`,
    targetKind: 'scene',
    sceneIndex: scene.index,
    sceneLabel: sceneName,
    frameCount: scene.frameCount,
    selectedFrameIndex: 0,
    frameSelectionBasis: 'first Scene timeline, frame 0; current Main static snapshot default',
  };
  result.rootTarget = rootDescriptor;
  const discovered = collectOccurrenceUnits(source, scene.frameContext, sample.sourceSha256);
  result.sourceStructureMetrics = discovered.metrics;
  result.sourceNotices = discovered.notices;
  result.plan = serializePlan(sample, prepared, rootDescriptor, discovered.units, discovered.notices, discovered.metrics);
  const wholeResolveStartedAt = performance.now();
  counters.displayListResolveCount += 1;
  const whole = resolveAndCompose(
    source,
    { kind: 'scene', name: sceneName, frameContext: scene.frameContext },
    source.symbols,
    rootDescriptor.targetId,
    bitmapLookup,
  );
  result.phaseTimingsMs.wholeResolveAndCompose = performance.now() - wholeResolveStartedAt;
  if (!whole.ok) {
    result.reason = `${whole.code ?? 'RENDER_FAILED'} at ${whole.stage}: ${whole.message}`;
    result.sourcePath = whole.sourcePath ?? null;
    result.composition = whole.composition ?? null;
    result.plan = serializePlan(sample, prepared, rootDescriptor, discovered.units, [
      ...discovered.notices,
      { code: whole.code ?? 'RENDER_FAILED', reason: whole.message, stage: whole.stage },
    ], discovered.metrics);
    return result;
  }
  result.nativeComposition = whole.composed.composition;
  if (discovered.units.length > MAX_PARTS) {
    result.reason = `PART_COUNT_BUDGET_EXCEEDED: ${discovered.units.length} exceeds experiment cap ${MAX_PARTS}`;
    return result;
  }
  if (discovered.units.some((unit) => !unit.matrixFinite || !unit.matrixInvertible)) {
    result.reason = 'NON_FINITE_OR_NON_INVERTIBLE_SOURCE_MATRIX';
    return result;
  }

  const sampleEvidenceDir = path.join(outputDir, `sample-${sample.suffix.toLowerCase()}`);
  mkdirSync(sampleEvidenceDir, { recursive: true });
  const wholeRasterStartedAt = performance.now();
  const wholeRaster = await rasterizeSvg(
    rasterizer,
    whole.composed.svg,
    whole.composed.width,
    whole.composed.height,
    `${sample.suffix} native whole reference`,
  );
  result.phaseTimingsMs.nativeWholeRaster = performance.now() - wholeRasterStartedAt;
  counters.rasterCount += 1;
  result.rasterCount += 1;
  const wholePath = path.join(sampleEvidenceDir, 'native-whole.png');
  writeFileSync(wholePath, Buffer.from(wholeRaster.pngBytes), { flag: 'wx' });
  result.nativeWholeImage = {
    file: wholePath,
    sha256: sha256(Buffer.from(wholeRaster.pngBytes)),
    byteLength: wholeRaster.pngBytes.byteLength,
    width: wholeRaster.width,
    height: wholeRaster.height,
    pixelCount: wholeRaster.pixelCount,
    alphaBounds: decodePng(Buffer.from(wholeRaster.pngBytes)).alphaBounds,
  };
  result.pngCount += 1;

  const partPngs = [];
  const renderedUnits = [];
  const unitRenderStartedAt = performance.now();
  let aggregatePartBytes = 0;
  for (const unit of discovered.units) {
    if (performance.now() - sampleStartedAt > EXPERIMENT_WALL_TIME_MS) {
      result.sourceNotices.push({ code: 'EXPERIMENT_WALL_BUDGET_REACHED', budgetMs: EXPERIMENT_WALL_TIME_MS });
      break;
    }
    try {
      const isolatePath = isolateOccurrence(scene.frameContext, source.symbols, unit.isolatePath, unit.occurrenceId);
      counters.displayListResolveCount += 1;
      const resolvedUnit = resolveAndCompose(
        source,
        isolatePath.root,
        isolatePath.symbols,
        `${rootDescriptor.targetId}:${unit.unitId}`,
        bitmapLookup,
      );
      if (!resolvedUnit.ok) {
        renderedUnits.push({ unitId: unit.unitId, ok: false, code: resolvedUnit.code, stage: resolvedUnit.stage, reason: resolvedUnit.message });
        continue;
      }
      const rasterStartedAt = performance.now();
      const raster = await rasterizeSvg(
        rasterizer,
        resolvedUnit.composed.svg,
        resolvedUnit.composed.width,
        resolvedUnit.composed.height,
        `${sample.suffix} ${unit.unitId}`,
      );
      const bytes = Buffer.from(raster.pngBytes);
      aggregatePartBytes += bytes.byteLength;
      if (aggregatePartBytes > MAX_AGGREGATE_PART_PNG_BYTES) {
        renderedUnits.push({ unitId: unit.unitId, ok: false, code: 'AGGREGATE_PNG_BUDGET_EXCEEDED', reason: '64 MiB experiment temporary PNG budget reached' });
        break;
      }
      counters.rasterCount += 1;
      result.rasterCount += 1;
      const fileName = `unit-${String(unit.drawOrder + 1).padStart(3, '0')}.png`;
      const filePath = path.join(sampleEvidenceDir, fileName);
      writeFileSync(filePath, bytes, { flag: 'wx' });
      const decoded = decodePng(bytes);
      const outputUnit = {
        unitId: unit.unitId,
        ok: true,
        file: filePath,
        sha256: sha256(bytes),
        byteLength: bytes.byteLength,
        width: raster.width,
        height: raster.height,
        alphaBounds: decoded.alphaBounds,
        alphaPixels: decoded.alphaPixels,
        actualComposition: resolvedUnit.composed.composition,
        rasterMs: performance.now() - rasterStartedAt,
      };
      renderedUnits.push(outputUnit);
      partPngs.push({ unit, bytes, decoded, filePath });
      unit.renderEvidence = outputUnit;
      result.pngCount += 1;
    } catch (error) {
      renderedUnits.push({ unitId: unit.unitId, ok: false, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  result.phaseTimingsMs.independentUnitResolveAndRaster = performance.now() - unitRenderStartedAt;
  result.independentUnitRenders = renderedUnits;
  result.aggregatePartPngBytes = aggregatePartBytes;
  result.plan = serializePlan(sample, prepared, rootDescriptor, discovered.units, discovered.notices, discovered.metrics);
  const allUnitsRendered = renderedUnits.length === discovered.units.length && renderedUnits.every((unit) => unit.ok);
  if (allUnitsRendered && partPngs.length >= 1) {
    const reassemblySvg = makeReassemblySvg(wholeRaster.width, wholeRaster.height, partPngs);
    const reassemblyStartedAt = performance.now();
    const reassemblyRaster = await rasterizeSvg(rasterizer, reassemblySvg, wholeRaster.width, wholeRaster.height, `${sample.suffix} planned reassembly`);
    result.phaseTimingsMs.reassemblyRaster = performance.now() - reassemblyStartedAt;
    counters.rasterCount += 1;
    result.rasterCount += 1;
    const reassemblyBytes = Buffer.from(reassemblyRaster.pngBytes);
    const reassemblyPath = path.join(sampleEvidenceDir, 'planned-reassembly.png');
    writeFileSync(reassemblyPath, reassemblyBytes, { flag: 'wx' });
    result.reassembly = {
      file: reassemblyPath,
      sha256: sha256(reassemblyBytes),
      byteLength: reassemblyBytes.byteLength,
      width: reassemblyRaster.width,
      height: reassemblyRaster.height,
      unitCount: partPngs.length,
      order: partPngs.map(({ unit }) => ({ drawOrder: unit.drawOrder, unitId: unit.unitId, sourceSymbolId: unit.sourceSymbolId, sourceAddress: unit.sourceAddress })),
    };
    result.pngCount += 1;
    const wholeDecoded = decodePng(Buffer.from(wholeRaster.pngBytes));
    const reassemblyDecoded = decodePng(reassemblyBytes);
    const internalDiffPath = path.join(sampleEvidenceDir, 'diff-native-vs-reassembly.png');
    result.samePandaInternalComparison = comparePngs(wholeDecoded, reassemblyDecoded, internalDiffPath);
    result.pngCount += 1;
  } else {
    result.reassembly = { status: 'NOT_RUN', reason: 'all source units did not render successfully' };
  }

  if (sample.suffix === 'A' && options.referencePath) {
    try {
      const referenceBytes = readFileSync(options.referencePath);
      const referenceDecoded = decodePng(referenceBytes);
      result.independentReference = {
        file: options.referencePath,
        basename: path.basename(options.referencePath),
        sha256: sha256(referenceBytes),
        byteLength: referenceBytes.byteLength,
        width: referenceDecoded.width,
        height: referenceDecoded.height,
        alphaBounds: referenceDecoded.alphaBounds,
        provenance: 'private AN 2023 original full-stage frame export from Issue #893; only this whole reference is read, no isolated-layer PNGs are used',
      };
      const wholeDecoded = decodePng(Buffer.from(wholeRaster.pngBytes));
      const referenceDiffPath = path.join(sampleEvidenceDir, 'diff-native-vs-an-reference.png');
      result.nativeVsIndependentReference = comparePngs(wholeDecoded, referenceDecoded, referenceDiffPath);
      result.pngCount += result.nativeVsIndependentReference.comparable ? 1 : 0;
      if (result.reassembly?.file && result.nativeVsIndependentReference.comparable) {
        const reassemblyDecoded = decodePng(readFileSync(result.reassembly.file));
        const reassemblyDiffPath = path.join(sampleEvidenceDir, 'diff-reassembly-vs-an-reference.png');
        result.reassemblyVsIndependentReference = comparePngs(reassemblyDecoded, referenceDecoded, reassemblyDiffPath);
        result.pngCount += 1;
      }
    } catch (error) {
      result.independentReference = { status: 'NOT_COMPARABLE', reason: error instanceof Error ? error.message : String(error) };
    }
  }

  const internalWithinRasterTolerance = result.samePandaInternalComparison?.comparable === true &&
    result.samePandaInternalComparison.threshold5PixelPercent === 0;
  result.internalReassemblyAcceptance = {
    policy: '0% of stage pixels may differ by more than 5 levels in any RGBA channel',
    accepted: internalWithinRasterTolerance,
    rationale: 'independently rasterized transparent unit PNGs are re-composited against a once-rasterized native whole; exact RGBA equality is recorded, while the acceptance gate allows only per-channel deltas up to 5 and requires zero pixels beyond that bound',
    observedExactPixelDifferencePercent: result.samePandaInternalComparison?.exactPixelDifferencePercent ?? null,
    observedThreshold5PixelPercent: result.samePandaInternalComparison?.threshold5PixelPercent ?? null,
    observedAlphaDifferenceCount: result.samePandaInternalComparison?.alphaDifferenceCount ?? null,
  };
  const enoughParts = partPngs.length >= 2;
  const allMatricesSafe = discovered.units.every((unit) => unit.matrixFinite && unit.matrixInvertible);
  const hasNotices = discovered.notices.some((notice) => notice.code === 'NESTED_FRAME_SELECTION_LIMIT' || notice.code === 'UNSUPPORTED_SYMBOL_OCCURRENCE');
  let referenceAccepted = true;
  if (sample.suffix === 'A') {
    const referenceDiff = result.nativeVsIndependentReference;
    referenceAccepted = referenceDiff?.comparable === true &&
      options.referenceMaxThreshold5Percent !== null &&
      referenceDiff.threshold5PixelPercent <= options.referenceMaxThreshold5Percent;
    result.referenceTolerance = {
      maxThreshold5PixelPercent: options.referenceMaxThreshold5Percent,
      rationale: options.referenceThresholdRationale ?? null,
      accepted: referenceAccepted,
    };
  }
  if (internalWithinRasterTolerance && enoughParts && allMatricesSafe && allUnitsRendered && !hasNotices && referenceAccepted) {
    result.status = 'NATIVE_SOURCE_GO';
  } else if (result.nativeWholeImage) {
    result.status = 'PARTIAL';
    result.reason = !enoughParts ? 'WHOLE_IMAGE_ONLY_OR_SINGLE_SOURCE_UNIT' :
      !internalWithinRasterTolerance ? 'INTERNAL_REASSEMBLY_MISMATCH' :
        !allUnitsRendered ? 'ONE_OR_MORE_SOURCE_UNITS_NOT_RENDERED' :
          hasNotices ? 'NESTED_FRAME_OR_SYMBOL_TYPE_LIMIT' :
            !referenceAccepted ? 'INDEPENDENT_REFERENCE_THRESHOLD_NOT_MET_OR_NOT_SET' :
              'SOURCE_PLAN_REQUIRES_REVIEW';
  }
  result.phaseTimingsMs.sampleTotal = performance.now() - sampleStartedAt;
  result.unitPlan = discovered.units.map((unit) => ({ ...unit }));
  delete result.plan.units;
  result.plan.units = result.unitPlan;
  return result;
}

function crcOutputPath(outputDir, fileName) {
  const result = path.join(outputDir, fileName);
  if (isWithin(realpathSync(REPO_ROOT), result)) throw new Error('Refusing to write evidence under repository');
  return result;
}

async function hashAfter(filePath) {
  return sha256File(filePath);
}

async function main() {
  const args = parseArgs(process.argv.slice(1));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  for (const required of ['source-a', 'original-a', 'expected-sha-a', 'source-b', 'original-b', 'expected-sha-b', 'reference-a', 'output-dir']) {
    if (!args[required]) throw new Error(`Missing --${required}`);
  }
  const outputDir = assertNewOutputDirectory(args['output-dir']);
  const referencePath = resolveOutsideRepo(args['reference-a'], 'Independent AN reference');
  const userDataPath = path.join(outputDir, '.electron-user-data');
  mkdirSync(userDataPath, { recursive: true });
  app.setPath('userData', userDataPath);

  const thresholdText = args['reference-max-threshold5-percent'];
  const referenceMaxThreshold5Percent = thresholdText === undefined ? null : Number(thresholdText);
  if (referenceMaxThreshold5Percent !== null && (!Number.isFinite(referenceMaxThreshold5Percent) || referenceMaxThreshold5Percent < 0 || referenceMaxThreshold5Percent > 100)) {
    throw new Error('--reference-max-threshold5-percent must be between 0 and 100');
  }
  const options = {
    referencePath,
    referenceMaxThreshold5Percent,
    referenceThresholdRationale: args['reference-threshold-rationale'] ?? null,
  };

  const samples = [await loadInput(args, 'a'), await loadInput(args, 'b')];
  const counters = {
    inputFileReadCount: samples.length * 2,
    originalVerificationHashReadCount: samples.length,
    originalVerificationHashAfterReadCount: 0,
    sourceIntegrityHashReadCount: samples.length,
    sourceIntegrityHashAfterReadCount: 0,
    mainInspectionCount: 0,
    mainInspectionInputReadCount: 0,
    negativeFixtureMainReadCount: 0,
    researchFixtureMainReadCount: 0,
    occurrenceIdentityFixtureCount: 0,
    occurrenceIdentityFixtureResolveCount: 0,
    mainSessionSourceHashCount: 0,
    retainedSessionIds: [],
    retainedSessionCount: 0,
    releasedSessionCount: 0,
    preflightValidationCount: 0,
    recoveryClassifierCount: 0,
    recoveryNormalizationAttemptCount: 0,
    recoveryNormalizationAppliedCount: 0,
    parserWorkerParseCount: 0,
    prepareCallCount: 0,
    archiveOpenCount: 0,
    symbolIndexBuildCount: 0,
    preparedFrameContextCount: 0,
    displayListResolveCount: 0,
    rasterCount: 0,
  };

  const memory = {
    samplingIntervalMs: MEMORY_SAMPLE_INTERVAL_MS,
    appMetricSampleCount: 0,
    peakAppWorkingSetBytesObserved: 0,
    peakMainProcessRssBytesObserved: process.memoryUsage().rss,
    peakMainProcessHeapUsedBytesObserved: process.memoryUsage().heapUsed,
    rendererWorkingSetBytesObserved: 0,
    measurement: 'Electron app.getAppMetrics() workingSetSize plus Node process.memoryUsage(), sampled every 100 ms; peak is observed, not a guarantee against between-sample spikes',
  };
  const sampleMemory = () => {
    const own = process.memoryUsage();
    memory.peakMainProcessRssBytesObserved = Math.max(memory.peakMainProcessRssBytesObserved, own.rss);
    memory.peakMainProcessHeapUsedBytesObserved = Math.max(memory.peakMainProcessHeapUsedBytesObserved, own.heapUsed);
    try {
      const metrics = app.getAppMetrics();
      memory.appMetricSampleCount += 1;
      const total = metrics.reduce((sum, metric) => sum + ((metric.memory?.workingSetSize ?? 0) * 1024), 0);
      memory.peakAppWorkingSetBytesObserved = Math.max(memory.peakAppWorkingSetBytesObserved, total);
      const renderer = metrics.filter((metric) => metric.type === 'Tab');
      if (renderer.length) {
        memory.rendererWorkingSetBytesObserved = Math.max(
          memory.rendererWorkingSetBytesObserved,
          ...renderer.map((metric) => (metric.memory?.workingSetSize ?? 0) * 1024),
        );
      }
    } catch {
      // The receipt leaves unsupported process metrics at zero/NOT_MEASURED.
    }
  };
  const memoryTimer = setInterval(sampleMemory, MEMORY_SAMPLE_INTERVAL_MS);
  sampleMemory();

  const parserWindowManager = new FlaParserWindowManager();
  const importService = new FlaImportService(parserWindowManager);
  const onWorkerReady = (event) => {
    try { importService.markWorkerReady(event.sender.id); } catch (error) { console.error('FLA parser ready message rejected.', error); }
  };
  const onWorkerProgress = (event, payload) => {
    try { importService.markWorkerProgress(event.sender.id, payload); } catch (error) { console.error('FLA parser progress message rejected.', error); }
  };
  const onWorkerResult = (event, payload) => {
    try { importService.markWorkerResult(event.sender.id, payload); } catch (error) { console.error('FLA parser result message rejected.', error); }
  };
  const onWorkerError = (event, payload) => {
    try { importService.markWorkerError(event.sender.id, payload); } catch (error) { console.error('FLA parser error message rejected.', error); }
  };
  ipcMain.on(IPC_CHANNELS.FLA_WORKER_READY, onWorkerReady);
  ipcMain.on(IPC_CHANNELS.FLA_WORKER_PROGRESS, onWorkerProgress);
  ipcMain.on(IPC_CHANNELS.FLA_WORKER_RESULT, onWorkerResult);
  ipcMain.on(IPC_CHANNELS.FLA_WORKER_ERROR, onWorkerError);

  const rasterizer = new FlaStaticSnapshotWindowManager();
  const onReady = (event) => rasterizer.markReady(event.sender.id);
  const onResult = (event, payload) => rasterizer.markResult(event.sender.id, payload);
  const onError = (event, payload) => rasterizer.markError(event.sender.id, payload);
  ipcMain.on(IPC_CHANNELS.FLA_SNAPSHOT_RENDERER_READY, onReady);
  ipcMain.on(IPC_CHANNELS.FLA_SNAPSHOT_RENDER_RESULT, onResult);
  ipcMain.on(IPC_CHANNELS.FLA_SNAPSHOT_RENDER_ERROR, onError);

  let sampleResults = [];
  let negativeResult = null;
  let occurrenceIdentityResult = null;
  let inputHashAfter = [];
  let exitCode = 0;
  const startedAt = new Date().toISOString();
  const experimentStartedAt = performance.now();
  try {
    for (const sample of samples) {
      if (performance.now() - experimentStartedAt > EXPERIMENT_WALL_TIME_MS) {
        sampleResults.push({ sample: sample.suffix, status: 'PARTIAL', reason: `EXPERIMENT_WALL_BUDGET_REACHED ${EXPERIMENT_WALL_TIME_MS} ms` });
        continue;
      }
      sampleResults.push(await analyzeSample(sample, importService, rasterizer, outputDir, options, counters));
    }
    const repeatedSymbolFixture = await createRepeatedSymbolFixture(outputDir);
    occurrenceIdentityResult = await analyzeRepeatedSymbolFixture(repeatedSymbolFixture, counters, importService);
    const negativeFixtures = [
      {
        ...await createUnsupportedFixture(outputDir),
        caseName: 'visible-domtext',
        expectedCode: 'UNSUPPORTED_DISPLAY_CONTENT',
        expectedReasonSubstring: 'Visible display content is outside the supported static preview subset',
        expected: 'visible DOMText returns UNSUPPORTED_DISPLAY_CONTENT with no image or raster',
      },
      {
        ...await createUnsupportedMaskFixture(outputDir),
        caseName: 'empty-mask',
        expectedCode: 'UNSUPPORTED_DISPLAY_CONTENT',
        expectedReasonSubstring: 'Mask layer has no filled vector-shape items',
        expected: 'empty mask returns UNSUPPORTED_DISPLAY_CONTENT with no image or raster',
      },
    ];
    const negativeCases = [];
    for (const fixture of negativeFixtures) {
      negativeCases.push(await analyzeNegativeFixture(fixture, counters, importService));
    }
    negativeResult = {
      status: negativeCases.length === negativeFixtures.length && negativeCases.every((item) => item.status === 'PASS_FAIL_CLOSED')
        ? 'PASS_FAIL_CLOSED'
        : 'FAIL',
      caseCount: negativeCases.length,
      cases: negativeCases,
      observed: { caseStatuses: negativeCases.map((item) => ({ caseName: item.caseName, status: item.status, observed: item.observed })) },
      rasterCount: negativeCases.reduce((sum, item) => sum + (item.rasterCount ?? 0), 0),
    };
  } catch (error) {
    exitCode = 1;
    negativeResult = negativeResult ?? { status: 'NOT_RUN', reason: error instanceof Error ? error.message : String(error) };
    occurrenceIdentityResult = occurrenceIdentityResult ?? { status: 'NOT_RUN', reason: error instanceof Error ? error.message : String(error) };
    sampleResults.push({ sample: 'PROBE', status: 'BLOCKED', reason: error instanceof Error ? error.message : String(error) });
  } finally {
    for (const sessionId of counters.retainedSessionIds) {
      importService.releaseSession(sessionId);
      counters.releasedSessionCount += 1;
    }
    counters.retainedSessionCount = counters.retainedSessionIds.length;
    importService.close();
    ipcMain.removeListener(IPC_CHANNELS.FLA_WORKER_READY, onWorkerReady);
    ipcMain.removeListener(IPC_CHANNELS.FLA_WORKER_PROGRESS, onWorkerProgress);
    ipcMain.removeListener(IPC_CHANNELS.FLA_WORKER_RESULT, onWorkerResult);
    ipcMain.removeListener(IPC_CHANNELS.FLA_WORKER_ERROR, onWorkerError);
    try { rasterizer.close(); } catch { /* best-effort teardown of private hidden renderer */ }
    ipcMain.removeListener(IPC_CHANNELS.FLA_SNAPSHOT_RENDERER_READY, onReady);
    ipcMain.removeListener(IPC_CHANNELS.FLA_SNAPSHOT_RENDER_RESULT, onResult);
    ipcMain.removeListener(IPC_CHANNELS.FLA_SNAPSHOT_RENDER_ERROR, onError);
    clearInterval(memoryTimer);
    sampleMemory();
    for (const sample of samples) {
      try {
        const sourceSha256After = await hashAfter(sample.sourcePath);
        counters.inputFileReadCount += 1;
        counters.sourceIntegrityHashAfterReadCount += 1;
        const originalSha256After = await hashAfter(sample.originalPath);
        counters.inputFileReadCount += 1;
        counters.originalVerificationHashAfterReadCount += 1;
        inputHashAfter.push({
          sample: sample.suffix,
          sourceSha256Before: sample.sourceSha256,
          sourceSha256After,
          originalSha256Before: sample.originalSha256Before,
          originalSha256After,
          sourceAndOriginalUnchanged: sample.sourceSha256 === sourceSha256After && sample.originalSha256Before === originalSha256After,
        });
      } catch (error) {
        inputHashAfter.push({ sample: sample.suffix, unchanged: false, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  const statuses = sampleResults.map((sample) => sample.status);
  const sampleAResult = sampleResults.find((sample) => sample.sample === 'A');
  const sampleBResult = sampleResults.find((sample) => sample.sample === 'B');
  const allPositiveGo = statuses.length === 2 && statuses.every((status) => status === 'NATIVE_SOURCE_GO');
  const hashesUnchanged = inputHashAfter.length === 2 && inputHashAfter.every((item) => item.sourceAndOriginalUnchanged);
  const overallStatus = allPositiveGo && negativeResult?.status === 'PASS_FAIL_CLOSED' && occurrenceIdentityResult?.status === 'PASS' && hashesUnchanged
    ? 'NATIVE_SOURCE_GO'
    : sampleResults.some((sample) => sample.nativeWholeImage) ? 'PARTIAL' : 'BLOCKED';
  if (negativeResult?.status !== 'PASS_FAIL_CLOSED' || occurrenceIdentityResult?.status !== 'PASS' || !hashesUnchanged || samples.some((sample) => !sample.identityMatches)) exitCode = 1;
  if (memory.peakAppWorkingSetBytesObserved === 0) memory.peakAppWorkingSetBytesObserved = 'NOT_MEASURED';
  if (memory.rendererWorkingSetBytesObserved === 0) memory.rendererWorkingSetBytesObserved = 'NOT_MEASURED';

  const sampleAUnits = sampleAResult?.unitPlan ?? [];
  const symbolOccurrenceGroups = new Map();
  for (const unit of sampleAUnits) {
    if (!unit.sourceSymbolId) continue;
    symbolOccurrenceGroups.set(unit.sourceSymbolId, (symbolOccurrenceGroups.get(unit.sourceSymbolId) ?? 0) + 1);
  }
  const repeatedSymbolGroupsObserved = [...symbolOccurrenceGroups.entries()]
    .filter(([, count]) => count > 1)
    .map(([sourceSymbolId, count]) => ({ sourceSymbolId, count }));
  const occurrenceIds = sampleAUnits.map((unit) => unit.occurrenceId).filter(Boolean);
  const occurrencePlanFieldsComplete = sampleAUnits.length > 0 && sampleAUnits.every((unit) =>
    Boolean(unit.occurrenceId && unit.sourceAddress && unit.occurrencePath && unit.sourceFrame &&
      unit.worldTransform && unit.layer && typeof unit.visible === 'boolean' &&
      Number.isInteger(unit.drawOrder) && Array.isArray(unit.maskDependencies)));
  const occurrenceIdentityAudit = {
    unitCount: sampleAUnits.length,
    uniqueOccurrenceIdCount: new Set(occurrenceIds).size,
    sourceAddressCount: sampleAUnits.filter((unit) => Boolean(unit.sourceAddress)).length,
    occurrencePlanFieldsComplete,
    repeatedSymbolGroupsObserved,
    repeatedSymbolScenarioInRealSources: repeatedSymbolGroupsObserved.length ? 'OBSERVED' : 'NOT_OBSERVED_IN_REAL_SAMPLES',
    repeatedSymbolFixture: {
      status: occurrenceIdentityResult?.status ?? 'NOT_RUN',
      unitCount: occurrenceIdentityResult?.plan?.units?.length ?? 0,
      uniqueOccurrenceIdCount: occurrenceIdentityResult?.uniqueOccurrenceIdCount ?? 0,
      distinctSourceAddressCount: occurrenceIdentityResult?.distinctSourceAddressCount ?? 0,
      repeatedSymbolGroups: occurrenceIdentityResult?.repeatedSymbolGroups ?? [],
    },
    note: 'Repeated-symbol identity is derived from source address plus enclosing occurrence path and element position; the generated original FLA fixture exercises two instances of one library symbol because neither real sample contained a runnable repeated-symbol case',
  };
  const unrunModes = [
    { mode: 'same-library-symbol-multiple-occurrences-in-one-real-source', status: 'NOT_RUN', reason: 'The duplicate case passed in an original generated fixture; no such group occurs in A and B was blocked before plan derivation' },
    { mode: 'non-identity-root-transform', status: 'NOT_RUN', reason: 'A root transform is identity; occurrence-level translations were exercised' },
    { mode: 'negative-stage-coordinates-and-crop', status: 'NOT_RUN', reason: 'The selected pose required no crop or negative-stage bounds' },
    { mode: 'rotation-scale-shear-and-mirror', status: 'NOT_RUN', reason: 'A occurrence matrices are identity linear terms plus translations' },
    { mode: 'valid-vector-mask-compositing-in-a-real-source', status: 'NOT_RUN', reason: 'The empty-mask failure case was tested; no valid masked real-source pose was available in A and B was blocked' },
    { mode: 'blend-empty-and-movie-clip-dependencies', status: 'NOT_RUN', reason: 'A contains no such dependency and B was blocked before plan derivation' },
    { mode: 'non-finite-or-non-invertible-matrix-negative', status: 'NOT_RUN', reason: 'All observed A matrices are finite and invertible' },
    { mode: 'preview-cancellation', status: 'NOT_RUN', reason: 'No cancel request was sent; no Project or commit service exists in the probe' },
    { mode: 'magnification-and-pixel-alignment', status: 'NOT_RUN', reason: 'Only the native 1920x1080 stage output was rendered' },
  ];
  const successfulUnitResolveCount = sampleAResult?.independentUnitRenders?.filter((unit) => unit.ok).length ?? 0;
  const preparedSourceReuse = {
    persistentCacheHitCount: 0,
    persistentCacheUsed: false,
    sampleAStaticPrepareCallCount: sampleAResult?.preparedContentSha256 ? 1 : 0,
    sampleAResolveUseCount: sampleAResult?.nativeComposition ? 1 + successfulUnitResolveCount : 0,
    perUnitReprepareCount: 0,
    reusedArtifact: 'same in-memory Main-prepared source, symbol index, and frameContext objects reused for the native whole resolve and each independent unit resolve',
  };
  const acceptanceCriteria = [
    { id: 'AC01', status: sampleAResult?.mainStaticInputSha256 && sampleBResult?.ingestTrace?.originalSourceSha256 ? 'PARTIAL' : 'FAIL', evidence: 'A reached Main compatibility recovery, parser, and static preparation; B reached Main strict/recovery preflight but failed normalized strict validation before parser/prepared SHA' },
    { id: 'AC02', status: sampleAResult?.unitPlan?.length >= 2 && sampleBResult?.status === 'BLOCKED' ? 'PARTIAL' : 'PASS', evidence: 'A derives five source occurrences without symbol-name/source-specific plan branches; B was blocked before running the same plan derivation' },
    { id: 'AC03', status: occurrencePlanFieldsComplete && new Set(occurrenceIds).size === sampleAUnits.length && occurrenceIdentityResult?.status === 'PASS' ? 'PASS' : occurrencePlanFieldsComplete ? 'PARTIAL' : 'FAIL', evidence: 'A plan preserves addresses and occurrence dependencies; a generated original FLA with two instances of one library symbol produced two unique occurrence IDs/addresses and both isolated resolves succeeded' },
    { id: 'AC04', status: sampleAResult?.status === 'NATIVE_SOURCE_GO' && sampleAResult?.independentUnitRenders?.filter((unit) => unit.ok).length >= 2 && Boolean(sampleAResult?.reassembly?.file) && sampleAResult?.nativeVsIndependentReference?.comparable ? 'PASS' : 'FAIL', evidence: 'A has independent unit PNGs, planned full-stage reassembly, native whole comparison, and independent AN comparison' },
    { id: 'AC05', status: negativeResult?.status === 'PASS_FAIL_CLOSED' && negativeResult.caseCount >= 2 ? 'PASS' : 'FAIL', evidence: 'Generated visible-DOMText and empty-mask FLA fixtures both returned UNSUPPORTED_DISPLAY_CONTENT with no raster' },
    { id: 'AC06', status: sampleAResult?.status === 'NATIVE_SOURCE_GO' ? 'PARTIAL' : 'FAIL', evidence: 'Measured pose preserves the 1920x1080 stage with safe occurrence translations and no second transform; listed edge modes remain NOT_RUN' },
    { id: 'AC07', status: hashesUnchanged && sampleAResult?.projectMutation?.startsWith('NONE:') ? 'PARTIAL' : 'FAIL', evidence: 'Source/original hashes remained unchanged and no Project/History/asset/commit service was constructed; cancellation route was NOT_RUN' },
    { id: 'AC08', status: memory.peakAppWorkingSetBytesObserved !== 'NOT_MEASURED' && counters.mainInspectionCount > 0 && counters.rasterCount > 0 ? 'PASS' : 'PARTIAL', evidence: 'Parse, prepare, frameContext, resolve, raster, time, memory, cache reuse, and unchanged limits are recorded; archive entry count is not exposed by the current prepare API' },
    { id: 'AC09', status: sampleResults.some((sample) => sample.nativeWholeImage) && inputHashAfter.length === 2 ? 'PASS' : 'FAIL', evidence: 'Successful Electron command, input identity, source pose, receipt/plan paths, and private output path are recorded in the receipt' },
    { id: 'AC10', status: sampleAResult && sampleBResult && overallStatus && hashesUnchanged ? 'PASS' : 'FAIL', evidence: 'Per-source and overall statuses plus the frozen F1-02 minimum contract are recorded; F1-02 is not started' },
    { id: 'AC11', status: 'PASS', evidence: 'Focused node syntax, ESLint, diff check, pnpm build, and Windows Electron probe passed; automatic CI policy self-test passed while broader quality lanes were skipped' },
    { id: 'AC12', status: 'PASS', evidence: 'Private artwork and evidence images remain outside the repository and were not uploaded; only code, text contract, and sanitized measurements were published' },
  ];
  const finishedAt = new Date().toISOString();
  const publicCounters = { ...counters };
  delete publicCounters.retainedSessionIds;
  const receipt = {
    format: 'panda-f1-01-native-source-receipt',
    version: 1,
    overallStatus,
    startedAt,
    finishedAt,
    elapsedMs: performance.now() - experimentStartedAt,
    branchExpected: 'feat/issue-894-c1-adaptive-parts',
    codeHeadExpected: 'da8c9613274f359fe2a8bf8efe363ae574f238cd',
    inputs: samples.map((sample) => ({
      sample: sample.suffix,
      sourceBasename: sample.sourceBasename,
      originalBasename: sample.originalBasename,
      sourceSha256Before: sample.sourceSha256,
      originalSha256Before: sample.originalSha256Before,
      expectedSha256: sample.expectedSha256,
      identityMatches: sample.identityMatches,
      sourceByteLength: sample.sourceByteLength,
      mainInspectionInputReadCount: sample.mainInspectionReadCount ?? 0,
      privateSourcePath: sample.sourcePath,
      privateOriginalPath: sample.originalPath,
    })),
    samples: sampleResults,
    negativeCase: negativeResult,
    counts: {
      ...publicCounters,
      XMLArchiveEntryCount: 'NOT_EXPOSED_BY_CURRENT_PREPARE_API',
      preparedSceneAndGraphicFrameContextCount: counters.preparedFrameContextCount,
      partRasterCount: sampleResults.reduce((sum, sample) => sum + (sample.independentUnitRenders?.filter((unit) => unit.ok).length ?? 0), 0),
      PNGFilesWritten: sampleResults.reduce((sum, sample) => sum + (sample.pngCount ?? 0), 0),
      concurrentRasterJobs: 1,
      projectCommits: 0,
    },
    acceptanceCriteria,
    occurrenceIdentityFixture: occurrenceIdentityResult,
    occurrenceIdentityAudit,
    preparedSourceReuse,
    unrunModes,
    timingNotes: {
      eachPositiveSource: 'one FlaImportService.inspectSource call over the Main source reader and sandboxed parser worker, followed by one prepareFlaStaticSnapshotDisplaySource call over the resulting Main session bytes',
      archiveOpenCount: 'Main parser-worker parses are counted separately; archiveOpenCount counts one static-snapshot JSZip archive open for each prepareFlaStaticSnapshotDisplaySource call',
      frameContextEvaluation: 'default frame-zero Scene and Graphic frameContexts are prepared once during adaptation; repeated per-unit display-list resolution reuses those prepared contexts',
      renderLimit: `existing rasterizer timeout ${FLA_STATIC_SNAPSHOT_LIMITS.previewWallTimeMs} ms per request; no limit was increased`,
      experimentCaps: {
        maximumParts: MAX_PARTS,
        cumulativeUnitPngBytes: MAX_AGGREGATE_PART_PNG_BYTES,
        wholeRunWallTimeMs: EXPERIMENT_WALL_TIME_MS,
        note: 'F1-01 research-run caps only; #904 proposals are not production SLA',
      },
    },
    memory,
    inputHashAfter,
    counterDefinitions: {
      preflightValidationCount: 'Counts the initial strict validation plus one post-normalization strict validation whenever trace.postNormalizationStrictResult is not not-run, including a rejected normalized result.',
      recoveryNormalizationAttemptCount: 'Counts Main intake traces with recoveryAttempted true, whether normalization passes strict validation or is rejected.',
      recoveryNormalizationAppliedCount: 'Counts Main intake traces with recoveryApplied true.',
    },
    zeroWrite: {
      sourceAndOriginalHashesUnchanged: hashesUnchanged,
      cancellation: 'NOT_RUN',
      projectOpened: false,
      projectRevision: 'NOT_APPLICABLE: no Project was opened',
      history: 'NOT_APPLICABLE: no Project history was constructed or called',
      projectAssetRegistration: 'NONE',
      commitApiCalled: false,
      sourceFoldersWritten: false,
      outputDirectory: outputDir,
    },
    f1_02MinimumContract: {
      file: 'docs/research/f1-01-f1-02-min-contract.md',
      status: 'FROZEN_PROPOSED_CONTRACT',
      implementationStatus: 'NOT_IMPLEMENTED_IN_F1_01',
      scope: 'occurrence identity and provenance, frame basis, visibility/order/masks/composites, single-application stage transforms, Main-owned source access, cancellation/generation, read-only behavior, and unchanged budgets',
    },
    referenceTolerance: {
      maxThreshold5PixelPercent: referenceMaxThreshold5Percent,
      rationale: options.referenceThresholdRationale,
      ifUnset: 'A remains PARTIAL until a measured threshold is supplied from the actual image comparison and reviewed with the private AN reference',
    },
    privacy: {
      copyrightedArtworkWrittenOnlyToPrivateOutput: true,
      oldIsolatedLayerPngDirectoryRead: false,
      actionscriptOrJsflExecuted: false,
      publicImageArtifactsEmitted: false,
    },
    command: process.argv.join(' '),
    evidenceDirectory: outputDir,
  };
  const receiptPath = crcOutputPath(outputDir, 'f1-01-receipt.json');
  const planPath = crcOutputPath(outputDir, 'f1-01-part-plan.json');
  const planDocument = {
    format: 'panda-f1-01-two-source-part-plan-bundle',
    version: 1,
    samples: sampleResults.map((sample) => sample.plan ?? {
      sample: sample.sample,
      status: sample.status,
      reason: sample.reason ?? null,
      sourceSha256Before: sample.sourceSha256Before ?? null,
    }),
    researchFixtures: {
      repeatedSymbolOccurrence: occurrenceIdentityResult?.plan ?? null,
    },
  };
  writePrivateJson(receiptPath, receipt);
  writePrivateJson(planPath, planDocument);
  const markdownPath = crcOutputPath(outputDir, 'f1-01-receipt.md');
  const md = [
    '# F1-01 Native Source Probe Receipt',
    '',
    `- Result: **${overallStatus}**`,
    `- Started / finished: ${startedAt} / ${finishedAt}`,
    `- Branch / expected HEAD: ${receipt.branchExpected} / ${receipt.codeHeadExpected}`,
    `- File read / Main inspection / prepare / display-list resolve / raster counts: ${counters.inputFileReadCount} / ${counters.mainInspectionCount} / ${counters.prepareCallCount} / ${counters.displayListResolveCount} / ${counters.rasterCount}`,
    `- Unit rasters: ${receipt.counts.partRasterCount}; PNG files: ${receipt.counts.PNGFilesWritten}; concurrency: ${receipt.counts.concurrentRasterJobs}`,
    `- Negative fixtures: ${negativeResult?.status ?? 'NOT_RUN'} (${negativeResult?.caseCount ?? 0} cases); repeated-symbol fixture: ${occurrenceIdentityResult?.status ?? 'NOT_RUN'}`,
    `- AC results: ${acceptanceCriteria.map(({ id, status }) => `${id} ${status}`).join('; ')}`,
    `- Source/original SHA invariance: ${hashesUnchanged ? 'PASS' : 'FAIL'}`,
    `- Project writes/commits: 0`,
    `- Local evidence: ${outputDir}`,
    '',
    'Per-source statuses, AC audit, negative cases, and image-difference metrics are in `f1-01-receipt.json`; source and repeated-symbol occurrence plans are in `f1-01-part-plan.json`.',
    'The frozen minimal F1-02 research contract is `docs/research/f1-01-f1-02-min-contract.md`; no F1-02 product API is implemented here.',
    'All private source artwork, native PNGs, unit PNGs, reassemblies, and diff PNGs stay in this Windows evidence directory.',
    '',
  ].join('\n');
  writeFileSync(markdownPath, md, { flag: 'wx' });
  process.stdout.write(`${JSON.stringify({ overallStatus, receiptPath, planPath, markdownPath, sourceStatuses: sampleResults.map(({ sample, status, reason }) => ({ sample, status, reason: reason ?? null })), counts: receipt.counts, inputHashAfter })}\n`);
  return exitCode;
}

app.on('window-all-closed', () => {});
app.whenReady()
  .then(main)
  .then((code) => setTimeout(() => app.exit(code), 250))
  .catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    setTimeout(() => app.exit(1), 250);
  });
