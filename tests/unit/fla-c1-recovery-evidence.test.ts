import { createRequire } from 'node:module';

import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  compensateKnownMismatch,
  inspectZipBoundary,
  KNOWN_RECOVERY_DELTA,
} = require('../../scripts/fla-c1-recovery-evidence.cjs') as {
  compensateKnownMismatch: (bytes: Uint8Array, boundary: Record<string, unknown>) => {
    applied: boolean;
    bytes?: Uint8Array;
    reason?: string;
  };
  inspectZipBoundary: (bytes: Uint8Array) => {
    eocdLocation: number | null;
    centralDirectoryDeclaredBytes: number | null;
    centralDirectoryActualBytes: number | null;
    centralDirectoryDeltaBytes: number | null;
    centralDirectoryRecordsComplete: boolean;
    cdEndsExactlyAtEocd: boolean;
    boundaryReason: string | null;
  };
  KNOWN_RECOVERY_DELTA: number;
};

async function makeZip(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('DOMDocument.xml', '<DOMDocument><timelines/></DOMDocument>');
  return zip.generateAsync({ type: 'uint8array' });
}

function patchDeclaredSize(bytes: Uint8Array, delta: number): Uint8Array {
  const copy = Buffer.from(bytes);
  let eocd = -1;
  for (let index = copy.length - 22; index >= 0; index -= 1) {
    if (copy.readUInt32LE(index) === 0x06054b50) {
      eocd = index;
      break;
    }
  }
  if (eocd < 0) throw new Error('test ZIP has no EOCD');
  copy.writeUInt32LE(copy.readUInt32LE(eocd + 12) + delta, eocd + 12);
  return copy;
}

describe('FLA V1.5-C1 research compensation boundary', () => {
  it('measures a clean central directory without proposing compensation', async () => {
    const bytes = await makeZip();
    const boundary = inspectZipBoundary(bytes);

    expect(boundary.centralDirectoryDeltaBytes).toBe(0);
    expect(boundary.centralDirectoryRecordsComplete).toBe(true);
    expect(boundary.cdEndsExactlyAtEocd).toBe(true);
    expect(compensateKnownMismatch(bytes, boundary).applied).toBe(false);
  });

  it('compensates only the measured +54-byte EOCD size on a copy', async () => {
    const original = await makeZip();
    const malformed = patchDeclaredSize(original, KNOWN_RECOVERY_DELTA);
    const boundary = inspectZipBoundary(malformed);
    const compensation = compensateKnownMismatch(malformed, boundary);

    expect(boundary.centralDirectoryDeltaBytes).toBe(54);
    expect(boundary.centralDirectoryRecordsComplete).toBe(true);
    expect(compensation.applied).toBe(true);
    expect(compensation.bytes).toBeDefined();
    expect(inspectZipBoundary(compensation.bytes!).centralDirectoryDeltaBytes).toBe(0);
    expect(Buffer.from(malformed).compare(Buffer.from(original))).not.toBe(0);
  });

  it('fails closed when the central-directory records do not reach EOCD', async () => {
    const original = await makeZip();
    const malformed = patchDeclaredSize(original, KNOWN_RECOVERY_DELTA);
    const boundary = inspectZipBoundary(malformed);
    const corrupted = Buffer.from(malformed);
    corrupted[boundary.centralDirectoryActualBytes === null ? 0 : (
      boundary.eocdLocation! - boundary.centralDirectoryActualBytes
    )] = 0;
    const corruptedBoundary = inspectZipBoundary(corrupted);
    const compensation = compensateKnownMismatch(corrupted, corruptedBoundary);

    expect(corruptedBoundary.centralDirectoryRecordsComplete).toBe(false);
    expect(compensation.applied).toBe(false);
  });
});
