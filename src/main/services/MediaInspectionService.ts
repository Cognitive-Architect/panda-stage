import { open, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  declaredMimeTypeForAssetPath,
  type AssetImportResultCode,
} from '../../shared/asset-import-api';

export type SupportedMediaKind = 'image' | 'audio';

export interface InspectedMedia {
  extension: '.png' | '.jpg' | '.jpeg' | '.mp3' | '.wav';
  mimeType: 'image/png' | 'image/jpeg' | 'audio/mpeg' | 'audio/wav';
  kind: SupportedMediaKind;
  width?: number;
  height?: number;
}

interface MediaDefinition {
  extension: InspectedMedia['extension'];
  mimeType: InspectedMedia['mimeType'];
  acceptedDeclaredMimeTypes: readonly string[];
  kind: SupportedMediaKind;
}

const DEFINITIONS: Readonly<Record<string, MediaDefinition>> = {
  '.png': {
    extension: '.png',
    mimeType: 'image/png',
    acceptedDeclaredMimeTypes: ['image/png'],
    kind: 'image',
  },
  '.jpg': {
    extension: '.jpg',
    mimeType: 'image/jpeg',
    acceptedDeclaredMimeTypes: ['image/jpeg', 'image/jpg'],
    kind: 'image',
  },
  '.jpeg': {
    extension: '.jpeg',
    mimeType: 'image/jpeg',
    acceptedDeclaredMimeTypes: ['image/jpeg', 'image/jpg'],
    kind: 'image',
  },
  '.mp3': {
    extension: '.mp3',
    mimeType: 'audio/mpeg',
    acceptedDeclaredMimeTypes: ['audio/mpeg', 'audio/mp3'],
    kind: 'audio',
  },
  '.wav': {
    extension: '.wav',
    mimeType: 'audio/wav',
    acceptedDeclaredMimeTypes: [
      'audio/wav',
      'audio/wave',
      'audio/x-wav',
    ],
    kind: 'audio',
  },
};

export class MediaInspectionError extends Error {
  constructor(
    readonly code: Extract<
      AssetImportResultCode,
      | 'ASSET_IMPORT_UNSUPPORTED_TYPE'
      | 'ASSET_IMPORT_DECLARED_TYPE_MISMATCH'
      | 'ASSET_IMPORT_INVALID_CONTENT'
      | 'ASSET_IMPORT_SOURCE_UNREADABLE'
    >,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'MediaInspectionError';
  }
}

export function declaredMimeTypeForPath(filePath: string): string | null {
  return declaredMimeTypeForAssetPath(filePath);
}

export class MediaInspectionService {
  async inspect(
    sourcePath: string,
    declaredMimeType: string,
  ): Promise<InspectedMedia> {
    const extension = path.extname(sourcePath).toLowerCase();
    const definition = DEFINITIONS[extension];
    if (!definition) {
      throw new MediaInspectionError(
        'ASSET_IMPORT_UNSUPPORTED_TYPE',
        `Unsupported asset type "${extension || '(none)'}". Choose PNG, JPG, MP3, or WAV.`,
      );
    }
    const normalizedDeclaredMimeType = declaredMimeType.trim().toLowerCase();
    if (
      !definition.acceptedDeclaredMimeTypes.includes(
        normalizedDeclaredMimeType,
      )
    ) {
      throw new MediaInspectionError(
        'ASSET_IMPORT_DECLARED_TYPE_MISMATCH',
        `Declared media type "${declaredMimeType}" does not match ${extension}.`,
      );
    }

    let size: number;
    try {
      const sourceStats = await stat(sourcePath);
      if (!sourceStats.isFile() || sourceStats.size === 0) {
        throw new Error('Source is not a non-empty regular file.');
      }
      size = sourceStats.size;
    } catch (error) {
      throw new MediaInspectionError(
        'ASSET_IMPORT_SOURCE_UNREADABLE',
        `Cannot read source asset: ${sourcePath}.`,
        { cause: error },
      );
    }

    try {
      if (extension === '.png') {
        return {
          ...definition,
          ...(await this.inspectPng(sourcePath)),
        };
      }
      if (extension === '.jpg' || extension === '.jpeg') {
        return {
          ...definition,
          ...(await this.inspectJpeg(sourcePath, size)),
        };
      }
      if (extension === '.wav') {
        await this.inspectWav(sourcePath, size);
      } else {
        await this.inspectMp3(sourcePath, size);
      }
      return definition;
    } catch (error) {
      if (error instanceof MediaInspectionError) throw error;
      throw new MediaInspectionError(
        'ASSET_IMPORT_INVALID_CONTENT',
        `The contents of ${path.basename(sourcePath)} are not a valid ${extension.slice(1).toUpperCase()} file.`,
        { cause: error },
      );
    }
  }

  private async inspectPng(
    sourcePath: string,
  ): Promise<{ width: number; height: number }> {
    const buffer = await this.readRange(sourcePath, 0, 24);
    const signature = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    if (
      buffer.length < 24 ||
      !buffer.subarray(0, 8).equals(signature) ||
      buffer.readUInt32BE(8) !== 13 ||
      buffer.toString('ascii', 12, 16) !== 'IHDR'
    ) {
      throw new Error('Invalid PNG signature or IHDR.');
    }
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    if (width === 0 || height === 0) {
      throw new Error('PNG dimensions must be positive.');
    }
    return { width, height };
  }

  private async inspectJpeg(
    sourcePath: string,
    size: number,
  ): Promise<{ width: number; height: number }> {
    const buffer = await this.readRange(
      sourcePath,
      0,
      Math.min(size, 1024 * 1024),
    );
    if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
      throw new Error('Invalid JPEG start marker.');
    }

    let offset = 2;
    while (offset + 4 <= buffer.length) {
      while (offset < buffer.length && buffer[offset] !== 0xff) offset += 1;
      while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
      const marker = buffer[offset];
      offset += 1;
      if (marker === undefined) break;
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > buffer.length) break;
      const segmentLength = buffer.readUInt16BE(offset);
      if (segmentLength < 2 || offset + segmentLength > buffer.length) break;
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb,
          0xcd, 0xce, 0xcf,
        ].includes(marker)
      ) {
        if (segmentLength < 7) break;
        const height = buffer.readUInt16BE(offset + 3);
        const width = buffer.readUInt16BE(offset + 5);
        if (width === 0 || height === 0) break;
        return { width, height };
      }
      offset += segmentLength;
    }
    throw new Error('JPEG SOF marker was not found in the inspected header.');
  }

  private async inspectWav(sourcePath: string, size: number): Promise<void> {
    const buffer = await this.readRange(
      sourcePath,
      0,
      Math.min(size, 1024 * 1024),
    );
    if (
      buffer.length < 12 ||
      buffer.toString('ascii', 0, 4) !== 'RIFF' ||
      buffer.toString('ascii', 8, 12) !== 'WAVE'
    ) {
      throw new Error('Invalid RIFF/WAVE signature.');
    }
    let offset = 12;
    let hasFormat = false;
    let hasData = false;
    while (offset + 8 <= buffer.length) {
      const chunkId = buffer.toString('ascii', offset, offset + 4);
      const chunkSize = buffer.readUInt32LE(offset + 4);
      const dataStart = offset + 8;
      if (dataStart + chunkSize > size) {
        throw new Error('WAV chunk exceeds the source file.');
      }
      if (chunkId === 'fmt ' && chunkSize >= 16) hasFormat = true;
      if (chunkId === 'data' && chunkSize > 0) hasData = true;
      offset = dataStart + chunkSize + (chunkSize % 2);
      if (hasFormat && hasData) return;
    }
    throw new Error('WAV requires readable fmt and data chunks.');
  }

  private async inspectMp3(sourcePath: string, size: number): Promise<void> {
    const initial = await this.readRange(sourcePath, 0, Math.min(size, 10));
    let audioOffset = 0;
    if (initial.toString('ascii', 0, 3) === 'ID3') {
      if (initial.length < 10) throw new Error('Truncated ID3 header.');
      const bytes = initial.subarray(6, 10);
      if ([...bytes].some((value) => value > 0x7f)) {
        throw new Error('Invalid ID3 synchsafe size.');
      }
      audioOffset =
        10 +
        ((bytes[0] ?? 0) << 21) +
        ((bytes[1] ?? 0) << 14) +
        ((bytes[2] ?? 0) << 7) +
        (bytes[3] ?? 0);
    }
    if (audioOffset >= size) throw new Error('MP3 has no audio frames.');
    const frameBytes = await this.readRange(
      sourcePath,
      audioOffset,
      Math.min(65_536, size - audioOffset),
    );
    for (let index = 0; index + 3 < frameBytes.length; index += 1) {
      const first = frameBytes[index] ?? 0;
      const second = frameBytes[index + 1] ?? 0;
      const third = frameBytes[index + 2] ?? 0;
      const sync = first === 0xff && (second & 0xe0) === 0xe0;
      const versionValid = ((second >> 3) & 0x03) !== 0x01;
      const layerValid = ((second >> 1) & 0x03) !== 0;
      const bitrateIndex = (third >> 4) & 0x0f;
      const sampleRateIndex = (third >> 2) & 0x03;
      if (
        sync &&
        versionValid &&
        layerValid &&
        bitrateIndex !== 0 &&
        bitrateIndex !== 0x0f &&
        sampleRateIndex !== 0x03
      ) {
        return;
      }
    }
    throw new Error('MP3 frame header was not found.');
  }

  private async readRange(
    sourcePath: string,
    position: number,
    length: number,
  ): Promise<Buffer> {
    const handle = await open(sourcePath, 'r');
    try {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(
        buffer,
        0,
        length,
        position,
      );
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }
}
