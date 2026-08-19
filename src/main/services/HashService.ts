import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

export interface FileHash {
  algorithm: 'sha256';
  hex: string;
  bytes: number;
}

export class HashService {
  hashBytes(bytes: Uint8Array): FileHash {
    const buffer = Buffer.from(bytes);
    return {
      algorithm: 'sha256',
      hex: createHash('sha256').update(buffer).digest('hex'),
      bytes: buffer.byteLength,
    };
  }

  async hashFile(
    filePath: string,
    signal?: AbortSignal,
  ): Promise<FileHash> {
    const hash = createHash('sha256');
    let bytes = 0;
    for await (const chunk of createReadStream(filePath, { signal })) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      hash.update(buffer);
      bytes += buffer.length;
    }
    return {
      algorithm: 'sha256',
      hex: hash.digest('hex'),
      bytes,
    };
  }
}
