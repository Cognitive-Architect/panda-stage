import { deflateSync, inflateSync } from 'node:zlib';
import {
  SPRITE_SHEET_MAX_DIMENSION,
  SPRITE_SHEET_MAX_PIXELS,
} from '../../shared/export-types';

export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface TrimmedSpriteFrame {
  empty: boolean;
  sourceWidth: number;
  sourceHeight: number;
  trimX: number;
  trimY: number;
  width: number;
  height: number;
  trimmed: boolean;
  data: Uint8Array;
}

export interface SpriteSheetPackOptions {
  trim: boolean;
  scale: number;
  padding: number;
  extrusion: number;
  anchor: { x: number; y: number };
  maxDimension?: number;
  maxPixels?: number;
}

export interface PackedSpriteFrame {
  index: number;
  name: string;
  timeMs: number;
  durationMs: number;
  page: number;
  empty: boolean;
  frame: { x: number; y: number; w: number; h: number };
  spriteSourceSize: { x: number; y: number; w: number; h: number };
  sourceSize: { w: number; h: number };
  anchor: { x: number; y: number };
  trimmed: boolean;
  rotated: false;
}

export interface FlushedAtlasPage {
  pageIndex: number;
  width: number;
  height: number;
  frames: PackedSpriteFrame[];
  pngBytes: Uint8Array;
}

export interface PixiFrameData {
  frame: { x: number; y: number; w: number; h: number };
  rotated: false;
  trimmed: boolean;
  spriteSourceSize: { x: number; y: number; w: number; h: number };
  sourceSize: { w: number; h: number };
  anchor: { x: number; y: number };
}

export interface PixiSpritesheetData {
  frames: Record<string, PixiFrameData>;
  animations?: Record<string, string[]>;
  meta: {
    app: string;
    version: string;
    format: 'RGBA8888';
    image: string;
    size: { w: number; h: number };
    scale: string;
    related_multi_packs?: string[];
  };
}

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + payload.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, payload.length, false);
  out[4] = type.charCodeAt(0);
  out[5] = type.charCodeAt(1);
  out[6] = type.charCodeAt(2);
  out[7] = type.charCodeAt(3);
  out.set(payload, 8);
  const crc = crc32(out.subarray(4, 8 + payload.length));
  view.setUint32(8 + payload.length, crc, false);
  return out;
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export function decodeRgbaPng(bytes: Uint8Array): RgbaImage {
  if (bytes.length < 33) {
    throw new Error('PNG data is too short.');
  }
  for (let i = 0; i < 8; i += 1) {
    if (bytes[i] !== PNG_SIGNATURE[i]) {
      throw new Error('Invalid PNG signature.');
    }
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idatChunks: Uint8Array[] = [];

  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset, false);
    const type = String.fromCharCode(
      bytes[offset + 4]!,
      bytes[offset + 5]!,
      bytes[offset + 6]!,
      bytes[offset + 7]!,
    );
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) {
      throw new Error('Truncated PNG chunk.');
    }
    if (type === 'IHDR') {
      if (length !== 13) throw new Error('Invalid PNG IHDR length.');
      width = view.getUint32(dataStart, false);
      height = view.getUint32(dataStart + 4, false);
      bitDepth = bytes[dataStart + 8]!;
      colorType = bytes[dataStart + 9]!;
      interlace = bytes[dataStart + 12]!;
    } else if (type === 'IDAT') {
      idatChunks.push(bytes.subarray(dataStart, dataEnd));
    } else if (type === 'IEND') {
      break;
    }
    offset = dataEnd + 4;
  }

  if (width <= 0 || height <= 0) {
    throw new Error('PNG missing valid IHDR dimensions.');
  }
  if (bitDepth !== 8 || interlace !== 0) {
    throw new Error(`Unsupported PNG format (bitDepth=${bitDepth}, interlace=${interlace}).`);
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 0 ? 1 : 0;
  if (channels === 0) {
    throw new Error(`Unsupported PNG colorType=${colorType}.`);
  }

  const totalIdat = idatChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const compressed = new Uint8Array(totalIdat);
  let writePos = 0;
  for (const chunk of idatChunks) {
    compressed.set(chunk, writePos);
    writePos += chunk.length;
  }

  const inflated = inflateSync(compressed);
  const stride = width * channels;
  const expectedLength = height * (stride + 1);
  if (inflated.length < expectedLength) {
    throw new Error('Decompressed PNG scanline data is truncated.');
  }

  const raw = new Uint8Array(height * stride);
  for (let y = 0; y < height; y += 1) {
    const filterType = inflated[y * (stride + 1)]!;
    const srcRow = y * (stride + 1) + 1;
    const dstRow = y * stride;
    if (filterType === 0) {
      raw.set(inflated.subarray(srcRow, srcRow + stride), dstRow);
      continue;
    }
    const prevRow = (y - 1) * stride;
    for (let x = 0; x < stride; x += 1) {
      const value = inflated[srcRow + x]!;
      const left = x >= channels ? raw[dstRow + x - channels]! : 0;
      const up = y > 0 ? raw[prevRow + x]! : 0;
      const upLeft = y > 0 && x >= channels ? raw[prevRow + x - channels]! : 0;
      let decoded: number;
      switch (filterType) {
        case 0:
          decoded = value;
          break;
        case 1:
          decoded = (value + left) & 0xff;
          break;
        case 2:
          decoded = (value + up) & 0xff;
          break;
        case 3:
          decoded = (value + ((left + up) >>> 1)) & 0xff;
          break;
        case 4:
          decoded = (value + paethPredictor(left, up, upLeft)) & 0xff;
          break;
        default:
          throw new Error(`Unsupported PNG filter type ${filterType}.`);
      }
      raw[dstRow + x] = decoded;
    }
  }

  if (channels === 4) {
    return { width, height, data: raw };
  }

  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const out = i * 4;
    if (channels === 3) {
      rgba[out] = raw[i * 3]!;
      rgba[out + 1] = raw[i * 3 + 1]!;
      rgba[out + 2] = raw[i * 3 + 2]!;
      rgba[out + 3] = 255;
    } else if (channels === 2) {
      const gray = raw[i * 2]!;
      rgba[out] = gray;
      rgba[out + 1] = gray;
      rgba[out + 2] = gray;
      rgba[out + 3] = raw[i * 2 + 1]!;
    } else {
      const gray = raw[i]!;
      rgba[out] = gray;
      rgba[out + 1] = gray;
      rgba[out + 2] = gray;
      rgba[out + 3] = 255;
    }
  }
  return { width, height, data: rgba };
}

export function encodeRgbaPng(image: RgbaImage): Uint8Array {
  const { width, height, data } = image;
  if (width <= 0 || height <= 0 || data.length !== width * height * 4) {
    throw new Error('Invalid RGBA image buffer for PNG encoding.');
  }
  const stride = width * 4;
  const raw = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // Filter type 0 (None)
    raw.set(data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const compressed = deflateSync(raw, { level: 3 });

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const ihdrChunk = makeChunk('IHDR', ihdr);
  const idatChunk = makeChunk('IDAT', compressed);
  const iendChunk = makeChunk('IEND', new Uint8Array(0));

  const out = new Uint8Array(
    PNG_SIGNATURE.length + ihdrChunk.length + idatChunk.length + iendChunk.length,
  );
  let pos = 0;
  out.set(PNG_SIGNATURE, pos);
  pos += PNG_SIGNATURE.length;
  out.set(ihdrChunk, pos);
  pos += ihdrChunk.length;
  out.set(idatChunk, pos);
  pos += idatChunk.length;
  out.set(iendChunk, pos);
  return out;
}

/**
 * Downscales an RGBA image in premultiplied-alpha space using exact area averaging,
 * preserving semi-transparent edge colors without dark-halo bleeding.
 */
export function scaleRgbaImage(image: RgbaImage, scale: number): RgbaImage {
  if (!Number.isFinite(scale) || scale <= 0 || scale > 1) {
    throw new Error(`Invalid sprite sheet output scale: ${scale}.`);
  }
  if (scale === 1) return image;

  const srcW = image.width;
  const srcH = image.height;
  const dstW = Math.max(1, Math.round(srcW * scale));
  const dstH = Math.max(1, Math.round(srcH * scale));
  if (dstW === srcW && dstH === srcH) return image;

  const dst = new Uint8Array(dstW * dstH * 4);
  const scaleX = srcW / dstW;
  const scaleY = srcH / dstH;
  const src = image.data;

  for (let dy = 0; dy < dstH; dy += 1) {
    const sy0 = dy * scaleY;
    const sy1 = (dy + 1) * scaleY;
    const iy0 = Math.floor(sy0);
    const iy1 = Math.min(srcH - 1, Math.ceil(sy1) - 1);

    for (let dx = 0; dx < dstW; dx += 1) {
      const sx0 = dx * scaleX;
      const sx1 = (dx + 1) * scaleX;
      const ix0 = Math.floor(sx0);
      const ix1 = Math.min(srcW - 1, Math.ceil(sx1) - 1);

      let weightSum = 0;
      let aSum = 0;
      let rPremul = 0;
      let gPremul = 0;
      let bPremul = 0;

      for (let sy = iy0; sy <= iy1; sy += 1) {
        const wy = Math.min(sy + 1, sy1) - Math.max(sy, sy0);
        if (wy <= 0) continue;
        const rowOffset = sy * srcW * 4;
        for (let sx = ix0; sx <= ix1; sx += 1) {
          const wx = Math.min(sx + 1, sx1) - Math.max(sx, sx0);
          if (wx <= 0) continue;
          const w = wx * wy;
          const p = rowOffset + sx * 4;
          const a = src[p + 3]! / 255;
          weightSum += w;
          aSum += w * a;
          rPremul += w * src[p]! * a;
          gPremul += w * src[p + 1]! * a;
          bPremul += w * src[p + 2]! * a;
        }
      }

      const outIdx = (dy * dstW + dx) * 4;
      if (weightSum > 0 && aSum > 0) {
        const finalAlpha = Math.min(255, Math.max(0, Math.round((aSum / weightSum) * 255)));
        if (finalAlpha > 0) {
          dst[outIdx] = Math.min(255, Math.max(0, Math.round(rPremul / aSum)));
          dst[outIdx + 1] = Math.min(255, Math.max(0, Math.round(gPremul / aSum)));
          dst[outIdx + 2] = Math.min(255, Math.max(0, Math.round(bPremul / aSum)));
          dst[outIdx + 3] = finalAlpha;
        }
      }
    }
  }

  return { width: dstW, height: dstH, data: dst };
}

/**
 * Finds the tight non-zero alpha bounding box (preserving semi-transparent pixels with alpha > 0).
 * Fully transparent frames return a 1x1 transparent tile marker.
 */
export function trimRgbaImage(image: RgbaImage, trimEnabled: boolean): TrimmedSpriteFrame {
  const { width, height, data } = image;
  if (!trimEnabled) {
    return {
      empty: false,
      sourceWidth: width,
      sourceHeight: height,
      trimX: 0,
      trimY: 0,
      width,
      height,
      trimmed: false,
      data,
    };
  }

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      if (data[rowOffset + x * 4 + 3]! > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    return {
      empty: true,
      sourceWidth: width,
      sourceHeight: height,
      trimX: 0,
      trimY: 0,
      width: 1,
      height: 1,
      trimmed: true,
      data: new Uint8Array(4),
    };
  }

  const trimW = maxX - minX + 1;
  const trimH = maxY - minY + 1;
  const trimmed = trimXOrSizeChanged(minX, minY, trimW, trimH, width, height);
  if (!trimmed) {
    return {
      empty: false,
      sourceWidth: width,
      sourceHeight: height,
      trimX: 0,
      trimY: 0,
      width,
      height,
      trimmed: false,
      data,
    };
  }

  const cropped = new Uint8Array(trimW * trimH * 4);
  for (let y = 0; y < trimH; y += 1) {
    const srcStart = ((minY + y) * width + minX) * 4;
    cropped.set(data.subarray(srcStart, srcStart + trimW * 4), y * trimW * 4);
  }
  return {
    empty: false,
    sourceWidth: width,
    sourceHeight: height,
    trimX: minX,
    trimY: minY,
    width: trimW,
    height: trimH,
    trimmed: true,
    data: cropped,
  };
}

function trimXOrSizeChanged(
  trimX: number,
  trimY: number,
  trimW: number,
  trimH: number,
  sourceW: number,
  sourceH: number,
): boolean {
  return trimX !== 0 || trimY !== 0 || trimW !== sourceW || trimH !== sourceH;
}

function blitSpriteWithExtrusion(
  pageData: Uint8Array,
  pageWidth: number,
  spriteData: Uint8Array,
  spriteW: number,
  spriteH: number,
  destX: number,
  destY: number,
  extrusion: number,
): void {
  // Blit main sprite pixels.
  for (let y = 0; y < spriteH; y += 1) {
    const srcStart = y * spriteW * 4;
    const dstStart = ((destY + y) * pageWidth + destX) * 4;
    pageData.set(spriteData.subarray(srcStart, srcStart + spriteW * 4), dstStart);
  }

  if (extrusion <= 0) return;

  // Extrude top & bottom rows.
  for (let e = 1; e <= extrusion; e += 1) {
    const topDst = ((destY - e) * pageWidth + destX) * 4;
    const topSrc = (destY * pageWidth + destX) * 4;
    pageData.copyWithin(topDst, topSrc, topSrc + spriteW * 4);

    const botDst = ((destY + spriteH - 1 + e) * pageWidth + destX) * 4;
    const botSrc = ((destY + spriteH - 1) * pageWidth + destX) * 4;
    pageData.copyWithin(botDst, botSrc, botSrc + spriteW * 4);
  }

  // Extrude left & right columns (including extruded top/bottom rows so corners are also filled).
  const fullTop = destY - extrusion;
  const fullBottom = destY + spriteH - 1 + extrusion;
  for (let y = fullTop; y <= fullBottom; y += 1) {
    const leftSrc = (y * pageWidth + destX) * 4;
    const rightSrc = (y * pageWidth + destX + spriteW - 1) * 4;
    for (let e = 1; e <= extrusion; e += 1) {
      const leftDst = (y * pageWidth + destX - e) * 4;
      pageData[leftDst] = pageData[leftSrc]!;
      pageData[leftDst + 1] = pageData[leftSrc + 1]!;
      pageData[leftDst + 2] = pageData[leftSrc + 2]!;
      pageData[leftDst + 3] = pageData[leftSrc + 3]!;

      const rightDst = (y * pageWidth + destX + spriteW - 1 + e) * 4;
      pageData[rightDst] = pageData[rightSrc]!;
      pageData[rightDst + 1] = pageData[rightSrc + 1]!;
      pageData[rightDst + 2] = pageData[rightSrc + 2]!;
      pageData[rightDst + 3] = pageData[rightSrc + 3]!;
    }
  }
}

interface PendingPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
  data: Uint8Array;
}

/**
 * Streaming shelf-based multi-page sprite sheet packer.
 * Holds at most one active page in memory; flushes completed pages immediately when full.
 */
export class StreamingSpriteSheetPacker {
  private readonly maxDimension: number;
  private readonly maxPixels: number;
  private readonly padding: number;
  private readonly extrusion: number;
  private readonly anchor: { x: number; y: number };

  private pageIndex = 0;
  private pageWidth = 0;
  private pageHeight = 0;
  private shelfY = 0;
  private shelfHeight = 0;
  private shelfNextX = 0;
  private placements: PendingPlacement[] = [];
  private pageFrames: PackedSpriteFrame[] = [];
  private sharedEmptyRect: { x: number; y: number; w: number; h: number } | null = null;

  constructor(options: SpriteSheetPackOptions) {
    this.maxDimension = options.maxDimension ?? SPRITE_SHEET_MAX_DIMENSION;
    this.maxPixels = options.maxPixels ?? SPRITE_SHEET_MAX_PIXELS;
    this.padding = options.padding;
    this.extrusion = options.extrusion;
    this.anchor = { ...options.anchor };
    this.resetPageState();
  }

  private resetPageState(): void {
    this.pageWidth = 0;
    this.pageHeight = 0;
    this.shelfY = this.padding;
    this.shelfHeight = 0;
    this.shelfNextX = this.padding;
    this.placements = [];
    this.pageFrames = [];
    this.sharedEmptyRect = null;
  }

  private tryPlaceSlot(spriteW: number, spriteH: number): { x: number; y: number } | null {
    const slotW = spriteW + 2 * this.extrusion;
    const slotH = spriteH + 2 * this.extrusion;

    // 1. Try current shelf.
    const sameShelfX = this.shelfNextX;
    const sameShelfWidth = Math.max(this.pageWidth, sameShelfX + slotW + this.padding);
    const sameShelfHeight = Math.max(
      this.pageHeight,
      this.shelfY + Math.max(this.shelfHeight, slotH) + this.padding,
    );
    if (
      sameShelfWidth <= this.maxDimension &&
      sameShelfHeight <= this.maxDimension &&
      sameShelfWidth * sameShelfHeight <= this.maxPixels
    ) {
      this.pageWidth = sameShelfWidth;
      this.pageHeight = sameShelfHeight;
      this.shelfHeight = Math.max(this.shelfHeight, slotH);
      this.shelfNextX = sameShelfX + slotW + this.padding;
      return { x: sameShelfX + this.extrusion, y: this.shelfY + this.extrusion };
    }

    // 2. Try starting a new shelf below the current shelf (if current shelf is non-empty).
    if (this.shelfHeight > 0) {
      const nextShelfY = this.shelfY + this.shelfHeight + this.padding;
      const newShelfX = this.padding;
      const newWidth = Math.max(this.pageWidth, newShelfX + slotW + this.padding);
      const newHeight = Math.max(this.pageHeight, nextShelfY + slotH + this.padding);
      if (
        newWidth <= this.maxDimension &&
        newHeight <= this.maxDimension &&
        newWidth * newHeight <= this.maxPixels
      ) {
        this.pageWidth = newWidth;
        this.pageHeight = newHeight;
        this.shelfY = nextShelfY;
        this.shelfHeight = slotH;
        this.shelfNextX = newShelfX + slotW + this.padding;
        return { x: newShelfX + this.extrusion, y: nextShelfY + this.extrusion };
      }
    }

    return null;
  }

  /**
   * Adds one trimmed frame. If the current page is full, flushes and returns that completed
   * page before placing the new frame onto the next page.
   */
  addFrame(
    meta: { index: number; name: string; timeMs: number; durationMs: number },
    trimmed: TrimmedSpriteFrame,
  ): FlushedAtlasPage | null {
    // Empty transparent frames reuse the shared 1x1 transparent tile on the current page.
    if (trimmed.empty && this.sharedEmptyRect) {
      this.pageFrames.push({
        index: meta.index,
        name: meta.name,
        timeMs: meta.timeMs,
        durationMs: meta.durationMs,
        page: this.pageIndex,
        empty: true,
        frame: { ...this.sharedEmptyRect },
        spriteSourceSize: { x: 0, y: 0, w: 1, h: 1 },
        sourceSize: { w: trimmed.sourceWidth, h: trimmed.sourceHeight },
        anchor: { ...this.anchor },
        trimmed: true,
        rotated: false,
      });
      return null;
    }

    let flushed: FlushedAtlasPage | null = null;
    let position = this.tryPlaceSlot(trimmed.width, trimmed.height);
    if (!position) {
      if (this.pageFrames.length === 0) {
        throw new Error('单帧尺寸加上留白与边缘扩展后超出单页精灵图容量限制。');
      }
      flushed = this.flushCurrentPage();
      position = this.tryPlaceSlot(trimmed.width, trimmed.height);
      if (!position) {
        throw new Error('单帧尺寸加上留白与边缘扩展后超出单页精灵图容量限制。');
      }
    }

    this.placements.push({
      x: position.x,
      y: position.y,
      width: trimmed.width,
      height: trimmed.height,
      data: trimmed.data,
    });

    const rect = { x: position.x, y: position.y, w: trimmed.width, h: trimmed.height };
    if (trimmed.empty) {
      this.sharedEmptyRect = rect;
    }

    this.pageFrames.push({
      index: meta.index,
      name: meta.name,
      timeMs: meta.timeMs,
      durationMs: meta.durationMs,
      page: this.pageIndex,
      empty: trimmed.empty,
      frame: rect,
      spriteSourceSize: {
        x: trimmed.trimX,
        y: trimmed.trimY,
        w: trimmed.width,
        h: trimmed.height,
      },
      sourceSize: { w: trimmed.sourceWidth, h: trimmed.sourceHeight },
      anchor: { ...this.anchor },
      trimmed: trimmed.trimmed,
      rotated: false,
    });

    return flushed;
  }

  flushCurrentPage(): FlushedAtlasPage | null {
    if (this.pageFrames.length === 0) return null;

    const width = Math.max(1, this.pageWidth);
    const height = Math.max(1, this.pageHeight);
    const pageData = new Uint8Array(width * height * 4);

    for (const placement of this.placements) {
      blitSpriteWithExtrusion(
        pageData,
        width,
        placement.data,
        placement.width,
        placement.height,
        placement.x,
        placement.y,
        this.extrusion,
      );
    }

    const pngBytes = encodeRgbaPng({ width, height, data: pageData });
    const flushed: FlushedAtlasPage = {
      pageIndex: this.pageIndex,
      width,
      height,
      frames: this.pageFrames,
      pngBytes,
    };

    this.pageIndex += 1;
    this.resetPageState();
    return flushed;
  }
}

export function formatPixiPageJsonName(pageIndex: number, pageCount: number): string {
  if (pageCount <= 1) return 'sprite-sheet.json';
  return `sprite-sheet-${String(pageIndex).padStart(3, '0')}.json`;
}

export function buildPixiPageManifest(args: {
  pageIndex: number;
  pageCount: number;
  imageName: string;
  width: number;
  height: number;
  pageFrames: readonly PackedSpriteFrame[];
  allFrameNames: readonly string[];
  animationName: string;
}): PixiSpritesheetData {
  const frames: Record<string, PixiFrameData> = {};
  for (const entry of args.pageFrames) {
    frames[entry.name] = {
      frame: { ...entry.frame },
      rotated: false,
      trimmed: entry.trimmed,
      spriteSourceSize: { ...entry.spriteSourceSize },
      sourceSize: { ...entry.sourceSize },
      anchor: { ...entry.anchor },
    };
  }

  const relatedMultiPacks =
    args.pageIndex === 0 && args.pageCount > 1
      ? Array.from({ length: args.pageCount - 1 }, (_, idx) =>
          formatPixiPageJsonName(idx + 1, args.pageCount),
        )
      : undefined;

  return {
    frames,
    ...(args.pageIndex === 0
      ? { animations: { [args.animationName]: [...args.allFrameNames] } }
      : {}),
    meta: {
      app: 'Panda Stage',
      version: '1.0',
      format: 'RGBA8888',
      image: args.imageName,
      size: { w: args.width, h: args.height },
      scale: '1',
      ...(relatedMultiPacks ? { related_multi_packs: relatedMultiPacks } : {}),
    },
  };
}
