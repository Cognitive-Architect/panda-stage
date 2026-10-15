import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AnimationImportIR } from '../../src/shared/fla-import-api';
import type { FlaRenderableTargetCatalogEntry } from '../../src/shared/fla-static-snapshot-api';
import {
  createFlaWorkbenchCandidates,
  snapshotCandidateId,
  type FlaWorkbenchCandidate,
} from '../../src/renderer/fla-import/fla-workbench-candidates';
import {
  describeFlaUnifiedCandidate,
  flaUnifiedCandidateSelectionKey,
  type FlaUnifiedImportItem,
} from '../../src/renderer/fla-import/fla-unified-import';
import {
  FLA_UNIFIED_BULK_CONFIRM_THRESHOLD,
  filterFlaUnifiedCandidates,
  newSelectableFlaUnifiedCandidates,
  reconcileFlaUnifiedSelection,
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

function target(
  suffix: string,
  userLabel: string,
  options: {
    kind?: FlaRenderableTargetCatalogEntry['target']['kind'];
    role?: FlaRenderableTargetCatalogEntry['catalogRole'];
    frameCount?: number;
  } = {},
): FlaRenderableTargetCatalogEntry {
  return {
    target: {
      renderTargetId: `fla-render-target-${suffix.padEnd(16, '0')}`,
      kind: options.kind ?? 'graphic-symbol',
      userLabel,
      sourceLibraryItemName: userLabel,
      sourceSymbolName: userLabel,
      sourceTimelineIndex: 0,
      frameCount: options.frameCount ?? 1,
      selectedFrameIndex: 0,
      compatibility: [],
    },
    ...(options.role ? { catalogRole: options.role } : {}),
    previewSupported: true,
    isBlank: false,
  };
}

function verifiedPreview(sha256: string) {
  return { status: 'supported' as const, sha256, previewUrl: `blob:${sha256}` };
}

function mixedCandidates(
  sequenceARequestId: string | null = 'sequence-a-request-1',
  sequenceBRequestId: string | null = 'sequence-b-request-1',
): FlaWorkbenchCandidate[] {
  const composition = target('composition-a', 'composition-a', { role: 'scene-referenced-graphic' });
  const sequenceA = target('sequence-a', 'sequence-a', { kind: 'timeline', role: 'scene', frameCount: 4 });
  const sequenceB = target('sequence-b', 'sequence-b', { kind: 'timeline', role: 'scene', frameCount: 4 });
  return createFlaWorkbenchCandidates({
    context,
    rasterMedia: [rasterMedia(90)],
    snapshotEntries: [composition],
    snapshotPreviews: { [snapshotCandidateId(composition)]: verifiedPreview('b'.repeat(64)) },
    sequenceEntries: [sequenceA, sequenceB],
    sequencePreviews: {
      ...(sequenceARequestId ? {
        [sequenceA.target.renderTargetId]: {
          status: 'verified' as const,
          sha256: 'c'.repeat(64),
          previewUrl: 'blob:sequence-a',
          requestId: sequenceARequestId,
          startFrameIndex: 0,
          endFrameIndex: 2,
        },
      } : {}),
      ...(sequenceBRequestId ? {
        [sequenceB.target.renderTargetId]: {
          status: 'verified' as const,
          sha256: 'd'.repeat(64),
          previewUrl: 'blob:sequence-b',
          requestId: sequenceBRequestId,
          startFrameIndex: 0,
          endFrameIndex: 2,
        },
      } : {}),
    },
  });
}

function checkedMap(candidatesToCheck: readonly FlaWorkbenchCandidate[]): Map<string, FlaUnifiedImportItem> {
  const items = candidatesToCheck.map(describeFlaUnifiedCandidate);
  return new Map(items.map((item) => [item.key, item]));
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

  it('preserves a checked sequence through preview-only focus, search, and selected-view return', () => {
    const all = mixedCandidates('sequence-a-request-1', null);
    const bitmap = all.find((candidate) => candidate.kind === 'raster')!;
    const composition = all.find((candidate) => candidate.kind === 'snapshot')!;
    const sequenceA = all.find((candidate) => candidate.kind === 'sequence' && candidate.selectable)!;
    const sequenceB = all.find((candidate) => candidate.kind === 'sequence' && !candidate.selectable)!;
    const checked = checkedMap([bitmap, composition, sequenceA]);
    const currentSelectableSequenceKeys = new Set(
      all.filter((candidate) => candidate.kind === 'sequence' && candidate.selectable)
        .map(flaUnifiedCandidateSelectionKey),
    );

    for (const focused of [sequenceB, sequenceA]) {
      expect(focused.kind).toBe('sequence');
      const visible = all.map((candidate) => ({
        ...candidate,
        checked: checked.has(flaUnifiedCandidateSelectionKey(candidate)),
      }));
      const reconciled = reconcileFlaUnifiedSelection(checked, 'sequence', currentSelectableSequenceKeys);
      expect(reconciled.has(flaUnifiedCandidateSelectionKey(sequenceA))).toBe(true);
      expect(reconciled.has(flaUnifiedCandidateSelectionKey(bitmap))).toBe(true);
      expect(reconciled.has(flaUnifiedCandidateSelectionKey(composition))).toBe(true);
      expect(filterFlaUnifiedCandidates(visible, 'sequence-b', false)).toHaveLength(1);
      const selectedView = filterFlaUnifiedCandidates(visible, 'sequence-b', true)
        .map((candidate) => candidate.identityKey);
      expect(selectedView).toHaveLength(3);
      expect(selectedView).toEqual(expect.arrayContaining([
        bitmap.identityKey,
        composition.identityKey,
        sequenceA.identityKey,
      ]));
    }

    const focusImplementation = readFileSync(
      'src/renderer/fla-import/FlaCompatibilityReviewSession.tsx',
      'utf8',
    );
    const focusStart = focusImplementation.indexOf('const focusUnifiedCandidate');
    const focusEnd = focusImplementation.indexOf('const selectCurrentResults', focusStart);
    expect(focusStart).toBeGreaterThanOrEqual(0);
    expect(focusImplementation.slice(focusStart, focusEnd)).not.toContain('setCheckedCandidates');

    const sequenceFocusImplementation = readFileSync(
      'src/renderer/fla-import/FlaFrameSequenceReview.tsx',
      'utf8',
    );
    const sequenceFocusStart = sequenceFocusImplementation.indexOf('if (!focusedCandidateIdentityKey) return;');
    const sequenceFocusEnd = sequenceFocusImplementation.indexOf('const sequenceCandidateById', sequenceFocusStart);
    const sequenceFocusEffect = sequenceFocusImplementation.slice(sequenceFocusStart, sequenceFocusEnd);
    expect(sequenceFocusStart).toBeGreaterThanOrEqual(0);
    expect(sequenceFocusEffect).not.toContain('flaFrameSequenceClient.cancel');
    expect(sequenceFocusEffect).not.toContain('setSuccess(null)');
  });

  it('invalidates sequence A when a new sequence request B replaces its authority, preserving unrelated checks', () => {
    const before = mixedCandidates('sequence-a-request-1', null);
    const bitmap = before.find((candidate) => candidate.kind === 'raster')!;
    const composition = before.find((candidate) => candidate.kind === 'snapshot')!;
    const sequenceA = before.find((candidate) => candidate.kind === 'sequence')!;
    const checked = checkedMap([bitmap, composition, sequenceA]);
    const afterGenerateB = mixedCandidates(null, 'sequence-b-request-2');
    const sequenceB = afterGenerateB.find((candidate) => candidate.kind === 'sequence')!;
    const reconciled = reconcileFlaUnifiedSelection(
      checked,
      'sequence',
      new Set([flaUnifiedCandidateSelectionKey(sequenceB)]),
    );

    expect(reconciled.has(flaUnifiedCandidateSelectionKey(sequenceA))).toBe(false);
    expect(reconciled.has(flaUnifiedCandidateSelectionKey(bitmap))).toBe(true);
    expect(reconciled.has(flaUnifiedCandidateSelectionKey(composition))).toBe(true);
  });

  it('drops only stale sequence checks when a request changes or a target disappears', () => {
    const before = mixedCandidates();
    const bitmap = before.find((candidate) => candidate.kind === 'raster')!;
    const composition = before.find((candidate) => candidate.kind === 'snapshot')!;
    const sequences = before.filter((candidate) => candidate.kind === 'sequence');
    const sequenceA = sequences[0]!;
    const sequenceB = sequences[1]!;
    const checked = checkedMap([bitmap, composition, sequenceA, sequenceB]);

    const afterRequestChange = mixedCandidates('sequence-a-request-2');
    const nextSequences = afterRequestChange.filter((candidate) => candidate.kind === 'sequence');
    const afterRequest = reconcileFlaUnifiedSelection(
      checked,
      'sequence',
      new Set(nextSequences.map(flaUnifiedCandidateSelectionKey)),
    );
    expect(afterRequest.has(flaUnifiedCandidateSelectionKey(sequenceA))).toBe(false);
    expect(afterRequest.has(flaUnifiedCandidateSelectionKey(sequenceB))).toBe(true);
    expect(afterRequest.has(flaUnifiedCandidateSelectionKey(bitmap))).toBe(true);
    expect(afterRequest.has(flaUnifiedCandidateSelectionKey(composition))).toBe(true);

    const currentSequenceA = nextSequences[0]!;
    const afterTargetChange = reconcileFlaUnifiedSelection(
      afterRequest,
      'sequence',
      new Set([flaUnifiedCandidateSelectionKey(currentSequenceA)]),
    );
    expect(afterTargetChange.has(flaUnifiedCandidateSelectionKey(sequenceB))).toBe(false);
    expect(afterTargetChange.has(flaUnifiedCandidateSelectionKey(currentSequenceA))).toBe(false);
    expect(afterTargetChange.has(flaUnifiedCandidateSelectionKey(bitmap))).toBe(true);
    expect(afterTargetChange.has(flaUnifiedCandidateSelectionKey(composition))).toBe(true);
  });
});
