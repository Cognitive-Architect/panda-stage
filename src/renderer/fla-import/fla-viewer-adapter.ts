import { FLAParser } from './parser-core/fla-parser';
import type {
  BitmapInstance,
  BitmapItem,
  DisplayElement,
  FLADocument,
  Matrix,
} from './parser-core/types';
import {
  FLA_IMPORT_LIMITS,
  FLA_PARSER_COMMIT,
  FLA_PARSER_ENTRYPOINT,
  FLA_PARSER_PACKAGE,
  type AnimationImportIR,
  type FlaCompatibilityStatus,
  type FlaImportErrorCode,
} from '../../shared/fla-import-api';
import { deriveStructureSummary } from './derive-fla-structure-summary';

/**
 * The sole adapter boundary for lifeart/fla-viewer.
 *
 * No caller receives FLADocument, BitmapItem, HTMLImageElement, Blob, canvas,
 * object URLs, JSZip values, or any other parser/browser object.  Every value
 * leaving this module is a Panda-owned AnimationImportIR.
 */

export interface FlaAdapterInput {
  basename: string;
  byteLength: number;
  sha256: string;
  bytes: Uint8Array;
  containsActionScript: boolean;
}

export type FlaProgressCallback = (message: string) => void;

export class FlaAdapterError extends Error {
  readonly code: FlaImportErrorCode;

  constructor(code: FlaImportErrorCode, message: string) {
    super(message);
    this.name = 'FlaAdapterError';
    this.code = code;
  }
}

function fail(code: FlaImportErrorCode, message: string): never {
  throw new FlaAdapterError(code, message);
}

function ensureNotCancelled(isCancelled: () => boolean): void {
  if (isCancelled()) {
    fail('USER_CANCELLED', 'FLA inspection was cancelled');
  }
}

function normalizeReference(value: string): string {
  const normalized = value.trim().replaceAll('\\', '/');
  const segments = normalized.split('/');
  if (
    !normalized ||
    normalized.includes('\0') ||
    normalized.startsWith('/') ||
    normalized.startsWith('//') ||
    /^[A-Za-z]:/u.test(normalized) ||
    segments.some((segment) => segment === '..' || segment === '.')
  ) {
    fail('MALFORMED_XFL', 'FLA contains an empty or unsafe media reference');
  }
  return normalized;
}

function referenceKeys(value: string): string[] {
  const normalized = normalizeReference(value);
  const lower = normalized.normalize('NFKC').toLocaleLowerCase('en-US');
  const filename = lower.slice(lower.lastIndexOf('/') + 1);
  return filename === lower ? [lower] : [lower, filename];
}

function stableHash(parts: readonly string[]): string {
  const input = parts.join('\u001f');
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    first ^= code;
    first = Math.imul(first, 0x01000193);
    second ^= code + index;
    second = Math.imul(second, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(36)}-${(second >>> 0).toString(36)}`;
}

function stableId(prefix: string, parts: readonly string[]): string {
  return `${prefix}-${stableHash(parts)}`;
}

function matrix(value: Matrix): {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
} {
  return {
    a: Number.isFinite(value.a) ? value.a : 1,
    b: Number.isFinite(value.b) ? value.b : 0,
    c: Number.isFinite(value.c) ? value.c : 0,
    d: Number.isFinite(value.d) ? value.d : 1,
    tx: Number.isFinite(value.tx) ? value.tx : 0,
    ty: Number.isFinite(value.ty) ? value.ty : 0,
  };
}

function sourceFormat(item: BitmapItem): 'png' | 'jpeg' | 'jpg' | 'unknown' {
  const references = [item.href, item.name, item.sourceExternalFilepath ?? ''];
  for (const reference of references) {
    const extension = reference
      .trim()
      .toLocaleLowerCase('en-US')
      .match(/\.([a-z0-9]+)(?:[?#].*)?$/u)?.[1];
    if (extension === 'png') return 'png';
    if (extension === 'jpeg') return 'jpeg';
    if (extension === 'jpg') return 'jpg';
  }
  return 'unknown';
}

function uniqueBitmapItems(document: FLADocument): BitmapItem[] {
  const unique = new Set<BitmapItem>();
  for (const item of document.bitmaps.values()) unique.add(item);
  return [...unique].sort((left, right) => {
    const leftKey = `${left.name}\u001f${left.href}`;
    const rightKey = `${right.name}\u001f${right.href}`;
    return leftKey.localeCompare(rightKey, 'en-US');
  });
}

function mediaKeyMap(items: readonly BitmapItem[]): Map<string, BitmapItem> {
  const result = new Map<string, BitmapItem>();
  for (const item of items) {
    for (const value of [item.name, item.href, item.bitmapDataHRef ?? '']) {
      if (!value) continue;
      for (const key of referenceKeys(value)) {
        if (!result.has(key)) result.set(key, item);
      }
    }
  }
  return result;
}

function resolveBitmap(
  keyMap: Map<string, BitmapItem>,
  libraryItemName: string,
): BitmapItem | undefined {
  for (const key of referenceKeys(libraryItemName)) {
    const value = keyMap.get(key);
    if (value) return value;
  }
  return undefined;
}

function imageBytesFromDataUrl(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) fail('MEDIA_DECODE_FAILED', 'PNG encoding returned an invalid data URL');
  try {
    const binary = globalThis.atob(dataUrl.slice(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch (error) {
    fail('MEDIA_DECODE_FAILED', `PNG encoding failed: ${String(error)}`);
  }
}

function encodeImage(item: BitmapItem): {
  width: number;
  height: number;
  bytes: Uint8Array;
  alpha: {
    kind: 'opaque' | 'transparent' | 'mixed' | 'unknown';
    zeroAlphaPixels: number;
    partialAlphaPixels: number;
  };
} {
  const image = item.imageData;
  if (!image) {
    fail('MEDIA_DECODE_FAILED', `Bitmap could not be decoded: ${item.name}`);
  }

  const width = Math.round(item.width || image.naturalWidth || image.width);
  const height = Math.round(item.height || image.naturalHeight || image.height);
  const pixels = width * height;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > FLA_IMPORT_LIMITS.maxImageWidth ||
    height > FLA_IMPORT_LIMITS.maxImageHeight ||
    pixels > FLA_IMPORT_LIMITS.maxImagePixels
  ) {
    fail('MEDIA_LIMIT_EXCEEDED', `Bitmap dimensions exceed the limit: ${item.name}`);
  }

  const canvas = globalThis.document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) fail('MEDIA_DECODE_FAILED', `Canvas decode context unavailable: ${item.name}`);

  try {
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const rgba = context.getImageData(0, 0, width, height).data;
    let zeroAlphaPixels = 0;
    let partialAlphaPixels = 0;
    for (let offset = 3; offset < rgba.length; offset += 4) {
      const alpha = rgba[offset] ?? 0;
      if (alpha === 0) zeroAlphaPixels += 1;
      else if (alpha < 255) partialAlphaPixels += 1;
    }
    const kind =
      zeroAlphaPixels === 0 && partialAlphaPixels === 0
        ? 'opaque'
        : zeroAlphaPixels === pixels
          ? 'transparent'
          : 'mixed';
    return {
      width,
      height,
      bytes: imageBytesFromDataUrl(canvas.toDataURL('image/png')),
      alpha: { kind, zeroAlphaPixels, partialAlphaPixels },
    };
  } catch (error) {
    fail('MEDIA_DECODE_FAILED', `Bitmap could not be encoded as PNG: ${item.name} (${String(error)})`);
  } finally {
    canvas.width = 1;
    canvas.height = 1;
  }
}

function addCompatibility(
  compatibility: AnimationImportIR['compatibility'],
  feature: string,
  status: FlaCompatibilityStatus,
  reason: string,
): void {
  if (!compatibility.some((entry) => entry.feature === feature && entry.status === status)) {
    compatibility.push({ feature, status, reason });
  }
}

function unsupportedElement(
  element: Exclude<DisplayElement, BitmapInstance>,
): { feature: string; reason: string } {
  switch (element.type) {
    case 'symbol':
      return { feature: 'symbol-instance', reason: 'Symbol/MovieClip semantics are not imported by raster-only FLA V1' };
    case 'shape':
      return { feature: 'vector-shape', reason: 'Vector shape semantics are outside the raster-only FLA V1 boundary' };
    case 'video':
      return { feature: 'video', reason: 'Video media is outside the Slice 1 bitmap contract' };
    case 'text':
      return { feature: 'text', reason: 'Editable text semantics are outside the Slice 1 IR' };
  }
}

export async function adaptFlaDocument(
  source: FlaAdapterInput,
  onProgress: FlaProgressCallback,
  isCancelled: () => boolean,
): Promise<AnimationImportIR> {
  const parser = new FLAParser();
  let document: FLADocument;
  try {
    const fileBytes = new ArrayBuffer(source.bytes.byteLength);
    new Uint8Array(fileBytes).set(source.bytes);
    document = await parser.parse(
      new File([fileBytes], source.basename, { type: 'application/octet-stream' }),
      onProgress,
      isCancelled,
    );
  } catch (error) {
    if (error instanceof FlaAdapterError) throw error;
    if (isCancelled()) fail('USER_CANCELLED', 'FLA inspection was cancelled');
    throw error;
  }
  ensureNotCancelled(isCancelled);

  const bitmapItems = uniqueBitmapItems(document);
  if (bitmapItems.length > FLA_IMPORT_LIMITS.maxMediaCount) {
    fail('MEDIA_LIMIT_EXCEEDED', 'Bitmap media count exceeds the limit');
  }
  const keyMap = mediaKeyMap(bitmapItems);
  const mediaByItem = new Map<BitmapItem, AnimationImportIR['media'][number]>();
  let totalPixels = 0;
  let totalRgbaBytes = 0;
  const media: AnimationImportIR['media'] = [];

  for (let index = 0; index < bitmapItems.length; index += 1) {
    ensureNotCancelled(isCancelled);
    const item = bitmapItems[index];
    if (!item) fail('MALFORMED_XFL', 'FLA bitmap list changed during adaptation');
    onProgress(`Encoding bitmap ${index + 1}/${bitmapItems.length}`);
    const encoded = encodeImage(item);
    totalPixels += encoded.width * encoded.height;
    totalRgbaBytes += encoded.width * encoded.height * 4;
    if (totalPixels > FLA_IMPORT_LIMITS.maxTotalDecodedPixels || totalRgbaBytes > FLA_IMPORT_LIMITS.maxTotalDecodedRgbaBytes) {
      fail('MEDIA_LIMIT_EXCEEDED', 'Total decoded bitmap pixels exceed the limit');
    }
    const irMedia: AnimationImportIR['media'][number] = {
      id: stableId('fla-media', [item.name, item.href, item.bitmapDataHRef ?? '', String(encoded.width), String(encoded.height)]),
      name: normalizeReference(item.name),
      sourceReference: normalizeReference(item.href),
      bitmapDataReference: item.bitmapDataHRef ? normalizeReference(item.bitmapDataHRef) : null,
      sourceFormat: sourceFormat(item),
      width: encoded.width,
      height: encoded.height,
      payload: {
        mimeType: 'image/png',
        width: encoded.width,
        height: encoded.height,
        bytes: encoded.bytes,
        alpha: encoded.alpha,
      },
    };
    media.push(irMedia);
    mediaByItem.set(item, irMedia);
  }

  const compatibility: AnimationImportIR['compatibility'] = [];
  addCompatibility(compatibility, 'bitmap-media', 'exact', 'Bitmap media is emitted as Panda-owned bounded PNG bytes');
  addCompatibility(compatibility, 'timeline-frame-placement', 'degraded', 'Bitmap placements are inspection-only; V1 does not import timeline semantics');
  if (source.containsActionScript) {
    addCompatibility(compatibility, 'actionscript', 'unsupported', 'ActionScript was detected but is never executed by the parser worker');
  } else {
    addCompatibility(compatibility, 'actionscript', 'not-present', 'No ActionScript was detected in the inspected source');
  }

  const hasSymbols = document.symbols.size > 0;
  const hasTweens = document.timelines.some((timeline) =>
    timeline.layers.some((layer) =>
      layer.frames.some((frame) =>
        frame.tweenType === 'motion' ||
        frame.tweenType === 'shape' ||
        (frame.tweens?.length ?? 0) > 0 ||
        frame.morphShape !== undefined,
      ),
    ),
  );
  if (hasSymbols) {
    addCompatibility(compatibility, 'symbol-movieclip-semantics', 'unsupported', 'Symbol/MovieClip semantics are present but are not imported by raster-only FLA V1');
  } else {
    addCompatibility(compatibility, 'symbol-movieclip-semantics', 'not-present', 'No Symbol/MovieClip library items were detected');
  }
  if (hasTweens) {
    addCompatibility(compatibility, 'basic-tweens', 'unsupported', 'Tween semantics are present but are not imported by raster-only FLA V1');
  } else {
    addCompatibility(compatibility, 'basic-tweens', 'not-present', 'No basic tween semantics were detected');
  }

  const timelines: AnimationImportIR['timelines'] = [];
  const referencedItems = new Set<BitmapItem>();
  let placedInstanceCount = 0;
  let instanceOrdinal = 0;

  for (let timelineIndex = 0; timelineIndex < document.timelines.length; timelineIndex += 1) {
    ensureNotCancelled(isCancelled);
    const timeline = document.timelines[timelineIndex];
    if (!timeline) fail('MALFORMED_XFL', 'FLA timeline list changed during adaptation');
    const timelineIR: AnimationImportIR['timelines'][number] = {
      id: stableId('fla-timeline', [String(timelineIndex), timeline.name]),
      name: timeline.name,
      totalFrames: Math.max(0, timeline.totalFrames),
      layers: [],
    };

    for (let layerIndex = 0; layerIndex < timeline.layers.length; layerIndex += 1) {
      const layer = timeline.layers[layerIndex];
      if (!layer) fail('MALFORMED_XFL', 'FLA layer list changed during adaptation');
      const layerIR: AnimationImportIR['timelines'][number]['layers'][number] = {
        id: stableId('fla-layer', [String(timelineIndex), String(layerIndex), layer.name]),
        name: layer.name,
        sourceLayerIndex: layerIndex,
        visible: layer.visible,
        locked: layer.locked,
        frames: [],
      };
      let frameStart = 0;
      for (const frame of layer.frames) {
        ensureNotCancelled(isCancelled);
        const frameIR: AnimationImportIR['timelines'][number]['layers'][number]['frames'][number] = {
          id: stableId('fla-frame', [String(timelineIndex), String(layerIndex), String(frame.index), String(frameStart)]),
          sourceFrameIndex: Math.max(0, frame.index),
          startFrame: Math.max(0, frame.index || frameStart),
          duration: Math.max(1, frame.duration),
          instances: [],
        };
        for (const element of frame.elements) {
          if (element.type !== 'bitmap') {
            const unsupported = unsupportedElement(element);
            addCompatibility(compatibility, unsupported.feature, 'unsupported', unsupported.reason);
            continue;
          }
          placedInstanceCount += 1;
          const item = resolveBitmap(keyMap, element.libraryItemName);
          const irMedia = item ? mediaByItem.get(item) : undefined;
          if (!item || !irMedia) {
            addCompatibility(compatibility, 'unresolved-bitmap-reference', 'unknown', `Bitmap reference was not found: ${element.libraryItemName}`);
            continue;
          }
          referencedItems.add(item);
          frameIR.instances.push({
            id: stableId('fla-instance', [String(timelineIndex), String(layerIndex), String(frame.index), String(instanceOrdinal), element.libraryItemName]),
            mediaId: irMedia.id,
            sourceLibraryItemName: normalizeReference(element.libraryItemName),
            matrix: matrix(element.matrix),
          });
          instanceOrdinal += 1;
        }
        layerIR.frames.push(frameIR);
        frameStart = Math.max(frameStart, frame.index + frame.duration);
      }
      timelineIR.layers.push(layerIR);
    }
    timelines.push(timelineIR);
  }

  for (const feature of ['vector-shape', 'video', 'text'] as const) {
    if (!compatibility.some((entry) => entry.feature === feature)) {
      addCompatibility(compatibility, feature, 'not-present', `No ${feature} content was detected`);
    }
  }

  return {
    source: {
      format: 'fla',
      basename: source.basename,
      byteLength: source.byteLength,
      sha256: source.sha256,
      parser: {
        package: FLA_PARSER_PACKAGE,
        entrypoint: FLA_PARSER_ENTRYPOINT,
        commit: FLA_PARSER_COMMIT,
      },
    },
    document: {
      width: document.width,
      height: document.height,
      frameRate: document.frameRate,
      backgroundColor: document.backgroundColor,
    },
    media,
    timelines,
    compatibility,
    summary: {
      placedInstanceCount,
      libraryOnlyMediaCount: media.length - referencedItems.size,
    },
    structure: deriveStructureSummary(document),
  };
}
