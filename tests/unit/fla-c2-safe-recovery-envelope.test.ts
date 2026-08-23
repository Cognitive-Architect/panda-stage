import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  STATES,
  classifyForFlaRecovery,
  findEocdCandidates,
  normalizeRecoveryCandidate,
  sha256,
} = require('../../scripts/fla-c2-recovery-classifier.cjs') as {
  STATES: Record<string, string>;
  classifyForFlaRecovery: (bytes: Uint8Array) => {
    state: string;
    reasonCodes: string[];
    measured: {
      eocdOffset: number | null;
      declaredCentralDirectoryOffset: number | null;
      actualCentralDirectorySize: number | null;
      centralDirectoryDeltaBytes: number | null;
    };
  };
  findEocdCandidates: (bytes: Uint8Array) => Array<{ offset: number; endsAtInput: boolean }>;
  normalizeRecoveryCandidate: (bytes: Uint8Array, classification: { state: string; measured: Record<string, unknown> }) => {
    applied: boolean;
    bytes?: Uint8Array;
  };
  sha256: (bytes: Uint8Array) => string;
};
const { buildNegativeFixtures, locateLayout, makeBaseZip } = require('../../scripts/fla-c2-safe-recovery-envelope.cjs') as {
  buildNegativeFixtures: () => Promise<Array<{
    id: string;
    expectedState: string;
    bytes: Uint8Array;
  }>>;
  locateLayout: (bytes: Uint8Array) => {
    eocd: number;
    centralOffset: number;
    central: Array<{ localOffset: number; localEnd: number }>;
  };
  makeBaseZip: () => Promise<Uint8Array>;
};

function patchDeclaredSize(bytes: Uint8Array, delta: number): Uint8Array {
  const copy = Buffer.from(bytes);
  const exact = findEocdCandidates(copy).filter((candidate) => candidate.endsAtInput);
  if (exact.length !== 1) throw new Error('test ZIP has no unique EOCD');
  const eocd = exact[0]!.offset;
  const centralOffset = copy.readUInt32LE(eocd + 16);
  copy.writeUInt32LE(eocd - centralOffset + delta, eocd + 12);
  return copy;
}

describe('FLA V1.5-C2 structural recovery envelope', () => {
  it('keeps a clean archive STRICT_VALID and does not normalize it', async () => {
    const original = await makeBaseZip();
    const classification = classifyForFlaRecovery(original);

    expect(classification.state).toBe(STATES.STRICT_VALID);
    expect(classification.reasonCodes).toContain('STRICT_PATH_VALID');
    expect(normalizeRecoveryCandidate(original, classification).applied).toBe(false);
  });

  it('requires the full structure before accepting the observed +54 mismatch', async () => {
    const original = await makeBaseZip();
    const malformed = patchDeclaredSize(original, 54);
    const before = sha256(malformed);
    const classification = classifyForFlaRecovery(malformed);
    const normalized = normalizeRecoveryCandidate(malformed, classification);

    expect(classification.state).toBe(STATES.RECOVERY_CANDIDATE);
    expect(classification.measured.centralDirectoryDeltaBytes).toBe(54);
    expect(normalized.applied).toBe(true);
    expect(classifyForFlaRecovery(normalized.bytes!).state).toBe(STATES.STRICT_VALID);
    expect(sha256(malformed)).toBe(before);
  });

  it('allows only an exact byte-identical local-only duplicate', async () => {
    const original = await makeBaseZip();
    const layout = locateLayout(original);
    const duplicate = Buffer.from(original.slice(layout.central[1]!.localOffset, layout.central[1]!.localEnd));
    const inserted = Buffer.concat([original.slice(0, layout.centralOffset), duplicate, original.slice(layout.centralOffset)]);
    const exact = findEocdCandidates(inserted).filter((candidate) => candidate.endsAtInput);
    const copy = Buffer.from(inserted);
    const centralOffset = layout.centralOffset + duplicate.length;
    copy.writeUInt32LE(centralOffset, exact[0]!.offset + 16);
    copy.writeUInt32LE(exact[0]!.offset - centralOffset + 54, exact[0]!.offset + 12);

    const classification = classifyForFlaRecovery(copy);
    expect(classification.state).toBe(STATES.RECOVERY_CANDIDATE);
    expect(classification.reasonCodes).toContain('EXACT_DUPLICATE_LOCAL_RECORD_PROVEN');
  });

  it('rejects every generated unsafe or ambiguous fixture, including +54 look-alikes', async () => {
    const fixtures = await buildNegativeFixtures();
    expect(fixtures.length).toBeGreaterThanOrEqual(15);

    for (const fixture of fixtures) {
      const classification = classifyForFlaRecovery(fixture.bytes);
      expect(classification.state, fixture.id).not.toBe(STATES.RECOVERY_CANDIDATE);
      expect([STATES.REJECT, STATES.AMBIGUOUS], fixture.id).toContain(classification.state);
    }
  });
});
