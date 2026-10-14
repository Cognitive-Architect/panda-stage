import { describe, expect, it } from 'vitest';
import type { AnimationImportIR } from '../../src/shared/fla-import-api';
import {
  createFlaWorkbenchCandidates,
  type FlaWorkbenchCandidate,
} from '../../src/renderer/fla-import/fla-workbench-candidates';
import {
  FLA_UNIFIED_BULK_CONFIRM_THRESHOLD,
  filterFlaUnifiedCandidates,
  newSelectableFlaUnifiedCandidates,
  requiresFlaBulkSelectionConfirmation,
} from '../../src/renderer/fla-import/fla-unified-workbench-selection';

const context = {
  sessionId: '00000000-0000-4000-8000-000000000775',
  source: { basename: 'sample.fla', sha256: 'a'.repeat(64) },
};

function rasterMedia(index: number): AnimationImportIR['media'][number] {
  const name = `asset-${String(index).padStart(3, '0')}.png`;
  return {
    id: `media-${index}`,
    name,
    sourceReference: `LIBRARY/${name}`,
    bitmapDataReference: `bin/${name}`,
    sourceFormat: 'png',
    width: 16,
    height: 16,
    payload: {
      mimeType: 'image/png',
      width: 16,
      height: 16,
      bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      alpha: { kind: 'opaque', zeroAlphaPixels: 0, partialAlphaPixels: 0 },
    },
  };
}

function candidates(count: number): FlaWorkbenchCandidate[] {
  return createFlaWorkbenchCandidates({
    context,
    rasterMedia: Array.from({ length: count }, (_, index) => rasterMedia(index + 1)),
  });
}

describe('Issue #775 C03 unified candidate selection', () => {
  it('uses the owner-approved greater-than-50 confirmation boundary', () => {
    expect(FLA_UNIFIED_BULK_CONFIRM_THRESHOLD).toBe(50);
    expect(requiresFlaBulkSelectionConfirmation(0)).toBe(false);
    expect(requiresFlaBulkSelectionConfirmation(50)).toBe(false);
    expect(requiresFlaBulkSelectionConfirmation(51)).toBe(true);
  });

  it('counts every matching offscreen candidate and excludes checked, unsupported, and duplicate operations', () => {
    const all = candidates(51);
    const checked = { ...all[0]!, checked: true };
    const unsupported = { ...all[1]!, selectable: false };
    const remaining = all.slice(2);
    const result = newSelectableFlaUnifiedCandidates(
      [checked, unsupported, ...remaining, remaining[0]!],
      '',
    );

    expect(result).toHaveLength(49);
    expect(result).not.toContain(checked);
    expect(result).not.toContain(unsupported);
    expect(result.filter((candidate) => candidate.identityKey === remaining[0]!.identityKey)).toHaveLength(1);
  });

  it('search filters display candidates while selected view includes checked items from other queries', () => {
    const all = candidates(3);
    const selected = { ...all[2]!, checked: true };

    expect(filterFlaUnifiedCandidates([all[0]!, all[1]!, selected], 'asset-001', false))
      .toEqual([all[0]]);
    expect(filterFlaUnifiedCandidates([all[0]!, all[1]!, selected], 'asset-001', true))
      .toEqual([selected]);
  });
});
