import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

export interface FileHash {
  algorithm: 'sha256';
  hex: string;
  bytes: number;
}

export class HashService {
  async hashFile(filePath: string): Promise<FileHash> {
    const hash = createHash('sha256');
    let bytes = 0;
    for await (const chunk of createReadStream(filePath)) {
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
