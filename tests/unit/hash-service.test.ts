import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { HashService } from '../../src/main/services/HashService';

describe('HashService', () => {
  it('streams a file into a stable lowercase SHA-256 digest', async () => {
    const filePath = path.resolve(
      'tests/fixtures/assets/熊猫 声音.mp3',
    );
    const bytes = await readFile(filePath);
    const result = await new HashService().hashFile(filePath);

    expect(result).toEqual({
      algorithm: 'sha256',
      hex: createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.length,
    });
  });
});
