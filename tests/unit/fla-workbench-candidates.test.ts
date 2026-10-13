import { describe, expect, it } from 'vitest';
import type { AnimationImportIR } from '../../src/shared/fla-import-api';
import type { FlaRenderableTargetCatalogEntry } from '../../src/shared/fla-static-snapshot-api';
import {
  checkFlaWorkbenchCandidates,
  clearFlaWorkbenchChecks,
  createFlaWorkbenchCandidateSelection,
  createFlaWorkbenchCandidates,
  focusFlaWorkbenchCandidate,
  reconcileFlaWorkbenchChecks,
  reconcileFlaWorkbenchFocus,
  snapshotCandidateId,
  toggleFlaWorkbenchCandidateChecked,
} from '../../src/renderer/fla-import/fla-workbench-candidates';

const SESSION_A = '00000000-0000-4000-8000-000000000775';
const SESSION_B = '00000000-0000-4000-8000-000000000776';
const SOURCE_SHA = 'a'.repeat(64);

function context(sessionId = SESSION_A, sha256 = SOURCE_SHA) {
  return { sessionId, source: { basename: 'sample.fla', sha256 } };
}

function bitmap(index: number, name = `asset-${String(index).padStart(3, '0')}.png`): AnimationImportIR['media'][number] {
  const id = `fla-media-${String(index).padStart(8, '0')}`;
  return {
    id,
    name,
    sourceReference: `LIBRARY/${name}`,
    bitmapDataReference: `bin/${name}.dat`,
    sourceFormat: 'png',
    width: 320,
    height: 240,
    payload: {
      mimeType: 'image/png',
      width: 320,
      height: 240,
      bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      alpha: { kind: 'opaque', zeroAlphaPixels: 0, partialAlphaPixels: 0 },
    },
  };
}

function target(
  suffix: string,
  userLabel: string,
  options: {
    kind?: FlaRenderableTargetCatalogEntry['target']['kind'];
    role?: FlaRenderableTargetCatalogEntry['catalogRole'];
    frameCount?: number;
    selectedFrameIndex?: number;
    previewSupported?: boolean;
    isBlank?: boolean;
  } = {},
): FlaRenderableTargetCatalogEntry {
  const previewSupported = options.previewSupported ?? true;
  return {
    target: {
      renderTargetId: `fla-render-target-${suffix.padEnd(16, '0')}`,
      kind: options.kind ?? 'graphic-symbol',
      userLabel,
      sourceLibraryItemName: userLabel,
      sourceSymbolName: userLabel,
      sourceTimelineIndex: 0,
      frameCount: options.frameCount ?? 1,
      selectedFrameIndex: options.selectedFrameIndex ?? 0,
      compatibility: [],
    },
    ...(options.role ? { catalogRole: options.role } : {}),
    previewSupported,
    isBlank: options.isBlank ?? false,
    ...(!previewSupported ? { unsupportedReason: 'fixture is unsupported' } : {}),
  };
}

function verifiedPreview(sha256 = 'b'.repeat(64)) {
  return { status: 'supported' as const, sha256, previewUrl: `blob:${sha256}` };
}

describe('Issue #775 C01 unified FLA workbench candidates', () => {
  it('keeps a supported complete composition ahead of all 336 original bitmap candidates', () => {
    const bitmaps = Array.from({ length: 336 }, (_, index) => bitmap(index + 1));
    const composed = target('com809', '神女素材库/神女素材库809', {
      role: 'scene-referenced-graphic',
      frameCount: 3,
    });
    const sequence = target('sequence', '动作库/待检查动作', {
      kind: 'timeline',
      role: 'scene',
      frameCount: 36,
    });
    const candidates = createFlaWorkbenchCandidates({
      context: context(),
      rasterMedia: bitmaps,
      snapshotEntries: [composed],
      snapshotPreviews: { [snapshotCandidateId(composed)]: verifiedPreview() },
      sequenceEntries: [sequence],
    });

    expect(candidates).toHaveLength(338);
    expect(candidates.filter((candidate) => candidate.kind === 'raster')).toHaveLength(336);
    expect(candidates[0]).toMatchObject({
      kind: 'snapshot',
      displayLabel: '神女素材库809 · 第 1 帧',
      supported: true,
      preview: { status: 'verified', verified: true },
      selectable: true,
    });
    expect(candidates.slice(1).some((candidate) => candidate.kind === 'raster')).toBe(true);
    expect(new Set(candidates.map((candidate) => candidate.identityKey)).size).toBe(338);
    expect(candidates.every((candidate) => !candidate.checked)).toBe(true);
    expect(candidates.find((candidate) => candidate.kind === 'sequence')).toMatchObject({
      displayLabel: '待检查动作',
      supported: true,
      blank: false,
      unscanned: true,
      selectable: false,
      operation: { kind: 'sequence', range: null },
    });
  });

  it('keeps candidate and operation identity distinct from duplicate image hashes and labels', () => {
    const first = target('duplicate-a', '完整角色/上衣', { role: 'graphic-state' });
    const second = target('duplicate-b', '其他部位/上衣', { role: 'graphic-state' });
    const samePreview = verifiedPreview('c'.repeat(64));
    const candidates = createFlaWorkbenchCandidates({
      context: context(),
      snapshotEntries: [first, second],
      snapshotPreviews: {
        [snapshotCandidateId(first)]: samePreview,
        [snapshotCandidateId(second)]: samePreview,
      },
    });

    expect(candidates.map((candidate) => candidate.displayLabel)).toEqual([
      '上衣 · 第 1 帧（1）',
      '上衣 · 第 1 帧（2）',
    ]);
    expect(candidates[0]?.id).not.toBe(candidates[1]?.id);
    expect(candidates[0]?.identityKey).not.toBe(candidates[1]?.identityKey);
    expect(candidates[0]?.dedupeGroupId).toBe(candidates[1]?.dedupeGroupId);
    expect(candidates[0]?.operation.kind).toBe('snapshot');
    expect(candidates[1]?.operation.kind).toBe('snapshot');

    const nextSession = createFlaWorkbenchCandidates({
      context: context(SESSION_B),
      snapshotEntries: [first],
      snapshotPreviews: { [snapshotCandidateId(first)]: samePreview },
    })[0]!;
    expect(nextSession.id).toBe(candidates[0]?.id);
    expect(nextSession.identityKey).not.toBe(candidates[0]?.identityKey);
  });

  it('binds candidate identity to source content and verified previews to their image bytes', () => {
    const media = bitmap(12);
    const rasterA = createFlaWorkbenchCandidates({
      context: context(SESSION_A, SOURCE_SHA),
      rasterMedia: [media],
      rasterThumbnailUrls: { [media.id]: 'blob:raster-a' },
    })[0]!;
    const rasterB = createFlaWorkbenchCandidates({
      context: context(SESSION_A, 'f'.repeat(64)),
      rasterMedia: [media],
      rasterThumbnailUrls: { [media.id]: 'blob:raster-a' },
    })[0]!;

    expect(rasterB.id).toBe(rasterA.id);
    expect(rasterB.identityKey).not.toBe(rasterA.identityKey);
    expect(rasterB.preview.bindingKey).not.toBe(rasterA.preview.bindingKey);
    expect(rasterA.operation).toMatchObject({ sessionId: SESSION_A, sourceSha256: SOURCE_SHA });
    expect(rasterB.operation).toMatchObject({ sessionId: SESSION_A, sourceSha256: 'f'.repeat(64) });

    const entry = target('preview-binding', '素材', { role: 'graphic-state' });
    const snapshotA = createFlaWorkbenchCandidates({
      context: context(),
      snapshotEntries: [entry],
      snapshotPreviews: { [snapshotCandidateId(entry)]: verifiedPreview('b'.repeat(64)) },
    })[0]!;
    const snapshotB = createFlaWorkbenchCandidates({
      context: context(),
      snapshotEntries: [entry],
      snapshotPreviews: { [snapshotCandidateId(entry)]: verifiedPreview('c'.repeat(64)) },
    })[0]!;

    expect(snapshotB.identityKey).toBe(snapshotA.identityKey);
    expect(snapshotB.preview.bindingKey).not.toBe(snapshotA.preview.bindingKey);
    expect(snapshotB.operation).toEqual(snapshotA.operation);
  });

  it('reports raster preview creation separately from parsed bitmap support', () => {
    const media = bitmap(13);
    const [checking] = createFlaWorkbenchCandidates({
      context: context(),
      rasterMedia: [media],
    });
    const [verified] = createFlaWorkbenchCandidates({
      context: context(),
      rasterMedia: [media],
      rasterThumbnailUrls: { [media.id]: 'blob:verified-raster' },
    });

    expect(checking).toMatchObject({
      supported: true,
      blank: false,
      unscanned: false,
      selectable: true,
      preview: { status: 'checking', verified: false },
    });
    expect(verified).toMatchObject({
      supported: true,
      blank: false,
      selectable: true,
      preview: { status: 'verified', verified: true, previewUrl: 'blob:verified-raster' },
    });
    expect(verified?.preview.bindingKey).not.toBe(checking?.preview.bindingKey);
  });

  it('keeps supported, blank, unsupported, and unscanned candidates separate and fails closed for checks', () => {
    const supported = target('supported', '可预览素材');
    const pending = target('pending', '尚未检查素材');
    const blank = target('blank', '空白状态', { isBlank: true });
    const unsupported = target('unsupported', '暂不可预览素材', { previewSupported: false });
    const candidates = createFlaWorkbenchCandidates({
      context: context(),
      snapshotEntries: [supported, pending, blank, unsupported],
      snapshotPreviews: {
        [snapshotCandidateId(supported)]: verifiedPreview(),
      },
    });
    const [ready, checking, blankCandidate, unsupportedCandidate] = candidates;

    expect(ready).toMatchObject({ supported: true, blank: false, unscanned: false, selectable: true });
    expect(checking).toMatchObject({ supported: true, blank: false, unscanned: true, selectable: false, preview: { status: 'checking' } });
    expect(blankCandidate).toMatchObject({ supported: false, blank: true, unscanned: false, selectable: false, preview: { status: 'blank' } });
    expect(unsupportedCandidate).toMatchObject({ supported: false, blank: false, unscanned: false, selectable: false, preview: { status: 'unsupported' } });

    const initial = createFlaWorkbenchCandidateSelection();
    const checkedReady = toggleFlaWorkbenchCandidateChecked(initial, ready);
    expect(checkedReady.checkedCandidateIds).toEqual(new Set([ready!.id]));
    expect(toggleFlaWorkbenchCandidateChecked(checkedReady, checking)).toBe(checkedReady);
    expect(toggleFlaWorkbenchCandidateChecked(checkedReady, blankCandidate)).toBe(checkedReady);
    expect(toggleFlaWorkbenchCandidateChecked(checkedReady, unsupportedCandidate)).toBe(checkedReady);
    expect(reconcileFlaWorkbenchChecks(checkedReady, [
      { ...ready!, selectable: false }, checking!, blankCandidate!, unsupportedCandidate!,
    ]).checkedCandidateIds).toEqual(new Set());
  });

  it('keeps focus independent from checked state and reconciles only against visible candidate identity', () => {
    const media = [bitmap(1), bitmap(2)];
    const candidates = createFlaWorkbenchCandidates({ context: context(), rasterMedia: media });
    const first = candidates[0]!;
    const second = candidates[1]!;
    const checked = toggleFlaWorkbenchCandidateChecked(createFlaWorkbenchCandidateSelection(), first);
    const focused = focusFlaWorkbenchCandidate(checked, second.id);

    expect(checked.focusedCandidateId).toBeNull();
    expect(focused.focusedCandidateId).toBe(second.id);
    expect(focused.checkedCandidateIds).toEqual(new Set([first.id]));
    expect(reconcileFlaWorkbenchFocus([second], first.id, false)).toBe(second.id);
    expect(reconcileFlaWorkbenchFocus([], second.id, false)).toBeNull();
    expect(reconcileFlaWorkbenchFocus([second], null, true)).toBe(second.id);
    expect(checkFlaWorkbenchCandidates(clearFlaWorkbenchChecks(focused), [second]).checkedCandidateIds)
      .toEqual(new Set([second.id]));
  });

  it('binds a sequence selection to a verified, bounded frame range and request', () => {
    const sequence = target('long-action', '动作/挥剑', { kind: 'timeline', frameCount: 40 });
    const previewInput = {
      status: 'verified' as const,
      sha256: 'd'.repeat(64),
      previewUrl: 'blob:sequence-preview',
      requestId: '00000000-0000-4000-8000-000000000777',
      startFrameIndex: 4,
      endFrameIndex: 27,
    };
    const [candidate] = createFlaWorkbenchCandidates({
      context: context(),
      sequenceEntries: [sequence],
      sequencePreviews: { [sequence.target.renderTargetId]: previewInput },
    });

    expect(candidate).toMatchObject({
      kind: 'sequence',
      supported: true,
      unscanned: false,
      selectable: true,
      preview: {
        status: 'verified',
        requestId: previewInput.requestId,
        startFrameIndex: 4,
        endFrameIndex: 27,
      },
      operation: { kind: 'sequence', range: { startFrameIndex: 4, endFrameIndex: 27 } },
    });

    const overCap = createFlaWorkbenchCandidates({
      context: context(),
      sequenceEntries: [sequence],
      sequencePreviews: {
        [sequence.target.renderTargetId]: { ...previewInput, startFrameIndex: 0, endFrameIndex: 24 },
      },
    })[0]!;
    expect(overCap).toMatchObject({
      supported: false,
      selectable: false,
      preview: { status: 'error', verified: false },
      operation: { kind: 'sequence', range: null },
    });
    const differentRequest = createFlaWorkbenchCandidates({
      context: context(),
      sequenceEntries: [sequence],
      sequencePreviews: {
        [sequence.target.renderTargetId]: { ...previewInput, requestId: 'different-request' },
      },
    })[0]!;
    expect(differentRequest.identityKey).toBe(candidate?.identityKey);
    expect(differentRequest.preview.bindingKey).not.toBe(candidate?.preview.bindingKey);
  });
});
