import { inflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const MAX_THUMBNAIL_EDGE = 256;

const COLOR_CHANNELS = new Map([
  [0, 1],
  [2, 3],
  [3, 1],
  [4, 2],
  [6, 4],
]);
const VALID_BIT_DEPTHS = new Map<number, readonly number[]>([
  [0, [1, 2, 4, 8, 16]],
  [2, [8, 16]],
  [3, [1, 2, 4, 8]],
  [4, [8, 16]],
  [6, [8, 16]],
]);
const ADAM7_PASSES = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const;

export interface ValidatedPngThumbnail {
  width: number;
  height: number;
}

export interface PngValidationOptions {
  maxWidth?: number;
  maxHeight?: number;
  maxPixels?: number;
  maxEncodedBytes?: number;
}

interface PngHeader {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  interlace: number;
}

export function validatePngThumbnail(
  bytes: Buffer,
): ValidatedPngThumbnail | null {
  return validatePngEncodedImage(bytes, {
    maxWidth: MAX_THUMBNAIL_EDGE,
    maxHeight: MAX_THUMBNAIL_EDGE,
    maxPixels: MAX_THUMBNAIL_EDGE * MAX_THUMBNAIL_EDGE,
  });
}

/**
 * Validates a Panda-owned PNG payload, including chunk CRCs and decompressed
 * scanline filters.  The thumbnail reader keeps its historical 256px limit;
 * FLA Slice 3 uses this same validator with the production image budget.
 */
export function validatePngEncodedImage(
  bytes: Buffer,
  options: PngValidationOptions = {},
): ValidatedPngThumbnail | null {
  try {
    const maxWidth = options.maxWidth ?? MAX_THUMBNAIL_EDGE;
    const maxHeight = options.maxHeight ?? MAX_THUMBNAIL_EDGE;
    const maxPixels = options.maxPixels ?? maxWidth * maxHeight;
    if (
      !Number.isInteger(maxWidth) ||
      !Number.isInteger(maxHeight) ||
      !Number.isInteger(maxPixels) ||
      maxWidth < 1 ||
      maxHeight < 1 ||
      maxPixels < 1 ||
      (options.maxEncodedBytes !== undefined &&
        bytes.length > options.maxEncodedBytes)
    ) {
      return null;
    }
    if (
      bytes.length < PNG_SIGNATURE.length ||
      !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
    ) {
      return null;
    }

    let offset = PNG_SIGNATURE.length;
    let header: PngHeader | null = null;
    let paletteSeen = false;
    let imageDataStarted = false;
    let imageDataEnded = false;
    let endSeen = false;
    const imageData: Buffer[] = [];

    while (offset < bytes.length) {
      if (endSeen || offset + 12 > bytes.length) return null;
      const length = bytes.readUInt32BE(offset);
      const typeStart = offset + 4;
      const dataStart = typeStart + 4;
      const dataEnd = dataStart + length;
      const chunkEnd = dataEnd + 4;
      if (
        length > bytes.length ||
        dataEnd < dataStart ||
        chunkEnd > bytes.length
      ) {
        return null;
      }

      const typeBytes = bytes.subarray(typeStart, dataStart);
      const type = typeBytes.toString('ascii');
      if (!/^[A-Za-z]{4}$/u.test(type)) return null;
      const data = bytes.subarray(dataStart, dataEnd);
      const expectedCrc = bytes.readUInt32BE(dataEnd);
      if (crc32(Buffer.concat([typeBytes, data])) !== expectedCrc) {
        return null;
      }

      if (!header) {
        if (type !== 'IHDR' || length !== 13) return null;
        header = parseHeader(data, maxWidth, maxHeight, maxPixels);
        if (!header) return null;
      } else if (type === 'IHDR') {
        return null;
      } else if (type === 'PLTE') {
        if (imageDataStarted || length === 0 || length % 3 !== 0) {
          return null;
        }
        paletteSeen = true;
      } else if (type === 'IDAT') {
        if (imageDataEnded || length === 0) return null;
        imageDataStarted = true;
        imageData.push(data);
      } else if (type === 'IEND') {
        if (length !== 0 || !imageDataStarted) return null;
        endSeen = true;
      } else if (imageDataStarted) {
        if ((typeBytes[0]! & 0x20) === 0) return null;
        imageDataEnded = true;
      } else if ((typeBytes[0]! & 0x20) === 0) {
        return null;
      }

      offset = chunkEnd;
    }

    if (
      !header ||
      !endSeen ||
      offset !== bytes.length ||
      (header.colorType === 3 && !paletteSeen)
    ) {
      return null;
    }

    const scanlines = scanlineLayout(header);
    if (!scanlines) return null;
    const inflated = inflateSync(Buffer.concat(imageData), {
      maxOutputLength: scanlines.totalBytes,
    });
    if (inflated.length !== scanlines.totalBytes) return null;
    for (const row of scanlines.rows) {
      if ((inflated[row.offset] ?? 5) > 4) return null;
    }
    return { width: header.width, height: header.height };
  } catch {
    return null;
  }
}

function parseHeader(
  data: Buffer,
  maxWidth: number,
  maxHeight: number,
  maxPixels: number,
): PngHeader | null {
  const width = data.readUInt32BE(0);
  const height = data.readUInt32BE(4);
  const bitDepth = data[8] ?? 0;
  const colorType = data[9] ?? -1;
  const compression = data[10] ?? -1;
  const filter = data[11] ?? -1;
  const interlace = data[12] ?? -1;
  if (
    width < 1 ||
    height < 1 ||
    width > maxWidth ||
    height > maxHeight ||
    width * height > maxPixels ||
    compression !== 0 ||
    filter !== 0 ||
    (interlace !== 0 && interlace !== 1) ||
    !VALID_BIT_DEPTHS.get(colorType)?.includes(bitDepth)
  ) {
    return null;
  }
  return { width, height, bitDepth, colorType, interlace };
}

function scanlineLayout(
  header: PngHeader,
): {
  totalBytes: number;
  rows: { offset: number }[];
} | null {
  const channels = COLOR_CHANNELS.get(header.colorType);
  if (!channels) return null;
  const bitsPerPixel = channels * header.bitDepth;
  const passes =
    header.interlace === 0
      ? ([[0, 0, 1, 1]] as const)
      : ADAM7_PASSES;
  const rows: { offset: number }[] = [];
  let totalBytes = 0;
  for (const [startX, startY, stepX, stepY] of passes) {
    const passWidth = passSize(header.width, startX, stepX);
    const passHeight = passSize(header.height, startY, stepY);
    if (passWidth === 0 || passHeight === 0) continue;
    const rowBytes = 1 + Math.ceil((passWidth * bitsPerPixel) / 8);
    for (let row = 0; row < passHeight; row += 1) {
      rows.push({ offset: totalBytes });
      totalBytes += rowBytes;
    }
  }
  return totalBytes > 0 ? { totalBytes, rows } : null;
}

function passSize(
  fullSize: number,
  start: number,
  step: number,
): number {
  return fullSize <= start
    ? 0
    : Math.ceil((fullSize - start) / step);
}

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
