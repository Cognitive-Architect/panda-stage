import type { AnimationImportIR } from '../../shared/fla-import-api';
import { FLA_FRAME_SEQUENCE_LIMITS } from '../../shared/fla-frame-sequence-api';
import type {
  FlaRenderableTargetCatalogEntry,
  FlaRenderableTargetCatalogRole,
  FlaRenderTarget,
} from '../../shared/fla-static-snapshot-api';

export type FlaWorkbenchCandidateKind = 'raster' | 'snapshot' | 'sequence';
export type FlaWorkbenchPreviewStatus =
  | 'verified'
  | 'checking'
  | 'unscanned'
  | 'unsupported'
  | 'blank'
  | 'error';

export interface FlaWorkbenchCandidateContext {
  sessionId: string;
  source: Pick<AnimationImportIR['source'], 'basename' | 'sha256'>;
}

export interface FlaWorkbenchCandidatePreviewInput {
  status: 'checking' | 'supported' | 'unsupported' | 'blank' | 'error';
  previewUrl?: string;
  sha256?: string;
  reason?: string;
}

export interface FlaWorkbenchSequencePreviewInput {
  status: 'checking' | 'unscanned' | 'verified' | 'unsupported' | 'blank' | 'error';
  previewUrl?: string;
  sha256?: string;
  reason?: string;
  requestId?: string;
  startFrameIndex?: number;
  endFrameIndex?: number;
}

interface FlaWorkbenchCandidateBase {
  /** Stable within the owning FLA session and compatible with its source API ID. */
  id: string;
  /** Source/session-bound identity; labels and preview hashes are never identity keys. */
  identityKey: string;
  kind: FlaWorkbenchCandidateKind;
  displayLabel: string;
  searchText: string;
  source: {
    sessionId: string;
    basename: string;
    sha256: string;
  };
  preview: {
    status: FlaWorkbenchPreviewStatus;
    verified: boolean;
    bindingKey: string;
    previewUrl?: string;
    sha256?: string;
    requestId?: string;
    startFrameIndex?: number;
    endFrameIndex?: number;
    reason?: string;
  };
  /** Capability known from the existing import/render contract. */
  supported: boolean;
  blank: boolean;
  /** True until this candidate has a verified preview bound to its operation identity. */
  unscanned: boolean;
  /** Only checked candidates can flow into a later import action. */
  selectable: boolean;
  focused: boolean;
  checked: boolean;
  dedupeGroupId?: string;
  catalogRole?: FlaRenderableTargetCatalogRole;
}

export type FlaWorkbenchCandidate =
  | (FlaWorkbenchCandidateBase & {
      kind: 'raster';
      provenance: {
        mediaId: string;
        sourceReference: string;
        bitmapDataReference: string | null;
      };
      operation: {
        kind: 'raster';
        sessionId: string;
        sourceSha256: string;
        mediaId: string;
      };
    })
  | (FlaWorkbenchCandidateBase & {
      kind: 'snapshot';
      provenance: {
        renderTargetId: string;
        targetKind: FlaRenderTarget['kind'];
        selectedFrameIndex: number;
        sourceLibraryItemName?: string;
        sourceTimelineIndex?: number;
        sourceSymbolName?: string;
      };
      operation: {
        kind: 'snapshot';
        sessionId: string;
        sourceSha256: string;
        target: FlaRenderTarget;
      };
    })
  | (FlaWorkbenchCandidateBase & {
      kind: 'sequence';
      provenance: {
        renderTargetId: string;
        targetKind: FlaRenderTarget['kind'];
        frameCount: number;
        sourceLibraryItemName?: string;
        sourceTimelineIndex?: number;
        sourceSymbolName?: string;
      };
      operation: {
        kind: 'sequence';
        sessionId: string;
        sourceSha256: string;
        target: FlaRenderTarget;
        range: { startFrameIndex: number; endFrameIndex: number } | null;
      };
    });

export interface FlaWorkbenchCandidateSelection {
  focusedCandidateId: string | null;
  checkedCandidateIds: ReadonlySet<string>;
}

export interface CreateFlaWorkbenchCandidatesInput {
  context: FlaWorkbenchCandidateContext;
  rasterMedia?: readonly AnimationImportIR['media'][number][];
  rasterThumbnailUrls?: Readonly<Record<string, string>>;
  snapshotEntries?: readonly FlaRenderableTargetCatalogEntry[];
  snapshotPreviews?: Readonly<Record<string, FlaWorkbenchCandidatePreviewInput>>;
  sequenceEntries?: readonly FlaRenderableTargetCatalogEntry[];
  sequencePreviews?: Readonly<Record<string, FlaWorkbenchSequencePreviewInput>>;
  selection?: FlaWorkbenchCandidateSelection;
}

export function createFlaWorkbenchCandidateSelection(
  focusedCandidateId: string | null = null,
  checkedCandidateIds: ReadonlySet<string> = new Set(),
): FlaWorkbenchCandidateSelection {
  return {
    focusedCandidateId,
    checkedCandidateIds: new Set(checkedCandidateIds),
  };
}

/**
 * Adapt the existing bitmap, static snapshot, and sequence contracts into
 * one read-only candidate model. This does not create a second import path:
 * each candidate keeps the identity required by its current operation.
 */
export function createFlaWorkbenchCandidates(
  input: CreateFlaWorkbenchCandidatesInput,
): FlaWorkbenchCandidate[] {
  const selection = input.selection ?? createFlaWorkbenchCandidateSelection();
  const candidates: FlaWorkbenchCandidate[] = [];

  for (const media of input.rasterMedia ?? []) {
    const id = media.id;
    const identityKey = stableIdentityKey([
      input.context.sessionId,
      input.context.source.sha256,
      'raster',
      media.id,
    ]);
    const previewUrl = input.rasterThumbnailUrls?.[media.id];
    const previewStatus: FlaWorkbenchPreviewStatus = previewUrl ? 'verified' : 'checking';
    const preview = candidatePreview({
      identityKey,
      status: previewStatus,
      sha256: undefined,
      previewUrl,
    });
    candidates.push({
      id,
      identityKey,
      kind: 'raster',
      displayLabel: readableFlaCandidateLabel(media.name),
      searchText: `${media.name} ${media.sourceReference} ${readableFlaCandidateLabel(media.name)}`.toLocaleLowerCase('en-US'),
      source: {
        sessionId: input.context.sessionId,
        basename: input.context.source.basename,
        sha256: input.context.source.sha256,
      },
      preview,
      supported: true,
      blank: false,
      unscanned: false,
      selectable: true,
      focused: selection.focusedCandidateId === id,
      checked: selection.checkedCandidateIds.has(id),
      provenance: {
        mediaId: media.id,
        sourceReference: media.sourceReference,
        bitmapDataReference: media.bitmapDataReference,
      },
      operation: {
        kind: 'raster',
        sessionId: input.context.sessionId,
        sourceSha256: input.context.source.sha256,
        mediaId: media.id,
      },
    });
  }

  for (const entry of input.snapshotEntries ?? []) {
    const frameIndex = entry.target.selectedFrameIndex ?? 0;
    const id = snapshotCandidateId(entry);
    const previewInput = input.snapshotPreviews?.[id];
    const state = resolveSnapshotPreviewState(entry, previewInput);
    const target = { ...entry.target, selectedFrameIndex: frameIndex };
    const identityKey = flaWorkbenchSnapshotIdentityKey(input.context, entry);
    const preview = candidatePreview({
      identityKey,
      status: state.status,
      sha256: state.sha256,
      previewUrl: state.previewUrl,
      reason: state.reason,
    });
    const supported = state.supported;
    const blank = state.status === 'blank';
    const unscanned = state.status === 'checking' || state.status === 'unscanned';
    const selectable = supported && preview.verified && !blank;
    candidates.push({
      id,
      identityKey,
      kind: 'snapshot',
      catalogRole: entry.catalogRole ?? (entry.target.kind === 'scene' ? 'scene' : 'graphic-state'),
      displayLabel: readableRenderTargetLabel(target, true),
      searchText: [
        target.userLabel,
        target.sourceLibraryItemName,
        target.sourceSymbolName,
        readableRenderTargetLabel(target, true),
      ].filter(Boolean).join(' ').toLocaleLowerCase('en-US'),
      source: {
        sessionId: input.context.sessionId,
        basename: input.context.source.basename,
        sha256: input.context.source.sha256,
      },
      preview,
      supported,
      blank,
      unscanned,
      selectable,
      focused: selection.focusedCandidateId === id,
      checked: selection.checkedCandidateIds.has(id) && selectable,
      dedupeGroupId: preview.verified && preview.sha256
        ? `snapshot:${candidatesCatalogRole(entry)}:${preview.sha256}`
        : undefined,
      provenance: {
        renderTargetId: target.renderTargetId,
        targetKind: target.kind,
        selectedFrameIndex: frameIndex,
        ...(target.sourceLibraryItemName ? { sourceLibraryItemName: target.sourceLibraryItemName } : {}),
        ...(target.sourceTimelineIndex !== undefined ? { sourceTimelineIndex: target.sourceTimelineIndex } : {}),
        ...(target.sourceSymbolName ? { sourceSymbolName: target.sourceSymbolName } : {}),
      },
      operation: {
        kind: 'snapshot',
        sessionId: input.context.sessionId,
        sourceSha256: input.context.source.sha256,
        target,
      },
    });
  }

  for (const entry of input.sequenceEntries ?? []) {
    const id = entry.target.renderTargetId;
    const previewInput = input.sequencePreviews?.[id];
    const state = resolveSequencePreviewState(entry, previewInput);
    const target = { ...entry.target, selectedFrameIndex: entry.target.selectedFrameIndex ?? 0 };
    const hasRange = isValidSequencePreviewRange(target.frameCount, previewInput);
    const range = state.status === 'verified' && hasRange
      ? {
          startFrameIndex: previewInput!.startFrameIndex!,
          endFrameIndex: previewInput!.endFrameIndex!,
        }
      : null;
    const identityKey = stableIdentityKey([
      input.context.sessionId,
      input.context.source.sha256,
      'sequence',
      target.renderTargetId,
    ]);
    const preview = candidatePreview({
      identityKey,
      status: state.status,
      sha256: state.sha256,
      previewUrl: state.previewUrl,
      reason: state.reason,
      requestId: previewInput?.requestId,
      startFrameIndex: range?.startFrameIndex,
      endFrameIndex: range?.endFrameIndex,
    });
    const supported = state.supported;
    const blank = state.status === 'blank';
    const unscanned = state.status === 'checking' || state.status === 'unscanned';
    const selectable = supported && preview.verified && Boolean(range) && Boolean(previewInput?.requestId) && !blank;
    candidates.push({
      id,
      identityKey,
      kind: 'sequence',
      catalogRole: entry.catalogRole ?? (entry.target.kind === 'scene' ? 'scene' : 'graphic-state'),
      displayLabel: readableRenderTargetLabel(target, false),
      searchText: [
        target.userLabel,
        target.sourceLibraryItemName,
        target.sourceSymbolName,
        readableRenderTargetLabel(target, false),
      ].filter(Boolean).join(' ').toLocaleLowerCase('en-US'),
      source: {
        sessionId: input.context.sessionId,
        basename: input.context.source.basename,
        sha256: input.context.source.sha256,
      },
      preview,
      supported,
      blank,
      unscanned,
      selectable,
      focused: selection.focusedCandidateId === id,
      checked: selection.checkedCandidateIds.has(id) && selectable,
      dedupeGroupId: preview.verified && preview.sha256
        ? `sequence:${candidatesCatalogRole(entry)}:${preview.sha256}`
        : undefined,
      provenance: {
        renderTargetId: target.renderTargetId,
        targetKind: target.kind,
        frameCount: target.frameCount,
        ...(target.sourceLibraryItemName ? { sourceLibraryItemName: target.sourceLibraryItemName } : {}),
        ...(target.sourceTimelineIndex !== undefined ? { sourceTimelineIndex: target.sourceTimelineIndex } : {}),
        ...(target.sourceSymbolName ? { sourceSymbolName: target.sourceSymbolName } : {}),
      },
      operation: {
        kind: 'sequence',
        sessionId: input.context.sessionId,
        sourceSha256: input.context.source.sha256,
        target,
        range,
      },
    });
  }

  return disambiguateCandidateLabels(sortFlaWorkbenchCandidates(candidates));
}

export function snapshotCandidateId(entry: FlaRenderableTargetCatalogEntry): string {
  return `${entry.target.renderTargetId}:${entry.target.selectedFrameIndex ?? 0}`;
}

export function flaWorkbenchSnapshotIdentityKey(
  context: FlaWorkbenchCandidateContext,
  entry: FlaRenderableTargetCatalogEntry,
): string {
  return stableIdentityKey([
    context.sessionId,
    context.source.sha256,
    'snapshot',
    entry.target.renderTargetId,
    (entry.target.selectedFrameIndex ?? 0).toString(),
  ]);
}

export function readableFlaCandidateLabel(value: string): string {
  const normalized = value.trim().replaceAll('\\', '/').replaceAll(/\/+$/gu, '');
  const leaf = normalized.slice(normalized.lastIndexOf('/') + 1).trim();
  return leaf || value.trim() || '未命名素材';
}

export function readableRenderTargetLabel(target: FlaRenderTarget, includeFrame: boolean): string {
  const label = readableFlaCandidateLabel(target.userLabel);
  if (!includeFrame || target.kind === 'scene') return label;
  return `${label} · 第 ${(target.selectedFrameIndex ?? 0) + 1} 帧`;
}

export function focusFlaWorkbenchCandidate(
  selection: FlaWorkbenchCandidateSelection,
  candidateId: string | null,
): FlaWorkbenchCandidateSelection {
  if (selection.focusedCandidateId === candidateId) return selection;
  return { ...selection, focusedCandidateId: candidateId };
}

export function toggleFlaWorkbenchCandidateChecked(
  selection: FlaWorkbenchCandidateSelection,
  candidate: FlaWorkbenchCandidate | undefined,
): FlaWorkbenchCandidateSelection {
  if (!candidate?.selectable) return selection;
  const next = new Set(selection.checkedCandidateIds);
  if (next.has(candidate.id)) next.delete(candidate.id);
  else next.add(candidate.id);
  return { ...selection, checkedCandidateIds: next };
}

export function checkFlaWorkbenchCandidates(
  selection: FlaWorkbenchCandidateSelection,
  candidates: readonly FlaWorkbenchCandidate[],
): FlaWorkbenchCandidateSelection {
  const next = new Set(selection.checkedCandidateIds);
  for (const candidate of candidates) {
    if (candidate.selectable) next.add(candidate.id);
  }
  return { ...selection, checkedCandidateIds: next };
}

export function clearFlaWorkbenchChecks(
  selection: FlaWorkbenchCandidateSelection,
): FlaWorkbenchCandidateSelection {
  if (selection.checkedCandidateIds.size === 0) return selection;
  return { ...selection, checkedCandidateIds: new Set() };
}

/**
 * Keep user checks across filtering, but drop a checked candidate if its
 * bound preview or support status becomes invalid.
 */
export function reconcileFlaWorkbenchChecks(
  selection: FlaWorkbenchCandidateSelection,
  candidates: readonly FlaWorkbenchCandidate[],
): FlaWorkbenchCandidateSelection {
  const selectableIds = new Set(candidates.filter((candidate) => candidate.selectable).map((candidate) => candidate.id));
  const next = new Set([...selection.checkedCandidateIds].filter((id) => selectableIds.has(id)));
  if (setsEqual(next, selection.checkedCandidateIds)) return selection;
  return { ...selection, checkedCandidateIds: next };
}

/** Focus follows candidate identity, never its dedupe group or preview URL. */
export function reconcileFlaWorkbenchFocus(
  visibleCandidates: readonly FlaWorkbenchCandidate[],
  currentCandidateId: string | null,
  allowUnscannedCandidates: boolean,
): string | null {
  if (currentCandidateId && visibleCandidates.some((candidate) => candidate.id === currentCandidateId)) {
    return currentCandidateId;
  }
  const firstVerified = visibleCandidates.find((candidate) =>
    candidate.supported && !candidate.blank && candidate.preview.verified,
  );
  if (firstVerified) return firstVerified.id;
  const firstParsedButPendingPreview = visibleCandidates.find((candidate) =>
    candidate.supported && !candidate.blank && !candidate.unscanned &&
    candidate.preview.status === 'checking',
  );
  if (firstParsedButPendingPreview) return firstParsedButPendingPreview.id;
  if (!allowUnscannedCandidates) return null;
  const firstUnscanned = visibleCandidates.find((candidate) =>
    candidate.supported && candidate.unscanned && !candidate.blank,
  );
  return firstUnscanned?.id ?? null;
}

export function sortFlaWorkbenchCandidates(
  candidates: readonly FlaWorkbenchCandidate[],
): FlaWorkbenchCandidate[] {
  const rank = (candidate: FlaWorkbenchCandidate): number => {
    // Keep the list position tied only to catalog identity and role. Preview
    // support changes as scanning progresses and must not move a candidate
    // underneath a user's pointer or keyboard focus.
    if (candidate.catalogRole === 'scene-referenced-graphic') return 0;
    if (candidate.catalogRole === 'scene') return 1;
    if (candidate.kind === 'sequence') return 2;
    if (candidate.kind === 'raster') return 3;
    if (candidate.catalogRole === 'graphic-state') return 4;
    return 5;
  };
  return candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort((left, right) => rank(left.candidate) - rank(right.candidate) || left.index - right.index)
    .map(({ candidate }) => candidate);
}

function resolveSnapshotPreviewState(
  entry: FlaRenderableTargetCatalogEntry,
  preview: FlaWorkbenchCandidatePreviewInput | undefined,
): {
  status: FlaWorkbenchPreviewStatus;
  supported: boolean;
  sha256?: string;
  previewUrl?: string;
  reason?: string;
} {
  if (entry.isBlank || preview?.status === 'blank') return { status: 'blank', supported: false };
  if (!entry.previewSupported || preview?.status === 'unsupported') {
    return {
      status: 'unsupported',
      supported: false,
      reason: preview?.reason ?? entry.unsupportedReason,
    };
  }
  if (preview?.status === 'error') {
    return { status: 'error', supported: false, reason: preview.reason };
  }
  if (preview?.status === 'supported' && preview.sha256 && preview.previewUrl) {
    return {
      status: 'verified',
      supported: true,
      sha256: preview.sha256,
      previewUrl: preview.previewUrl,
    };
  }
  return {
    status: 'checking',
    supported: true,
    ...(preview?.reason ? { reason: preview.reason } : {}),
  };
}

function resolveSequencePreviewState(
  entry: FlaRenderableTargetCatalogEntry,
  preview: FlaWorkbenchSequencePreviewInput | undefined,
): {
  status: FlaWorkbenchPreviewStatus;
  supported: boolean;
  sha256?: string;
  previewUrl?: string;
  reason?: string;
} {
  if (entry.isBlank || preview?.status === 'blank') return { status: 'blank', supported: false };
  if (!entry.previewSupported || preview?.status === 'unsupported') {
    return {
      status: 'unsupported',
      supported: false,
      reason: preview?.reason ?? entry.unsupportedReason,
    };
  }
  if (preview?.status === 'error') {
    return { status: 'error', supported: false, reason: preview.reason };
  }
  if (preview?.status === 'verified' && preview.sha256 && preview.previewUrl && preview.requestId) {
    if (!isValidSequencePreviewRange(entry.target.frameCount, preview)) {
      return {
        status: 'error',
        supported: false,
        reason: `帧序列范围必须在目标内且不超过 ${FLA_FRAME_SEQUENCE_LIMITS.MAX_SEQUENCE_FRAMES} 帧。`,
      };
    }
    return {
      status: 'verified',
      supported: true,
      sha256: preview.sha256,
      previewUrl: preview.previewUrl,
    };
  }
  return {
    status: preview?.status === 'checking' ? 'checking' : 'unscanned',
    supported: true,
    ...(preview?.reason ? { reason: preview.reason } : {}),
  };
}

function isValidSequencePreviewRange(
  frameCount: number,
  preview: FlaWorkbenchSequencePreviewInput | undefined,
): boolean {
  if (!preview || !Number.isInteger(preview.startFrameIndex) || !Number.isInteger(preview.endFrameIndex)) return false;
  const startFrameIndex = preview.startFrameIndex!;
  const endFrameIndex = preview.endFrameIndex!;
  return startFrameIndex >= 0 &&
    startFrameIndex <= endFrameIndex &&
    endFrameIndex < frameCount &&
    endFrameIndex - startFrameIndex + 1 <= FLA_FRAME_SEQUENCE_LIMITS.MAX_SEQUENCE_FRAMES;
}

function candidatePreview(input: {
  identityKey: string;
  status: FlaWorkbenchPreviewStatus;
  sha256?: string;
  previewUrl?: string;
  reason?: string;
  requestId?: string;
  startFrameIndex?: number;
  endFrameIndex?: number;
}): FlaWorkbenchCandidateBase['preview'] {
  const verified = input.status === 'verified';
  return {
    status: input.status,
    verified,
    bindingKey: stableIdentityKey([
      input.identityKey,
      input.status,
      input.sha256 ?? '',
      input.requestId ?? '',
      input.startFrameIndex?.toString() ?? '',
      input.endFrameIndex?.toString() ?? '',
    ]),
    ...(input.previewUrl ? { previewUrl: input.previewUrl } : {}),
    ...(input.sha256 ? { sha256: input.sha256 } : {}),
    ...(input.requestId ? { requestId: input.requestId } : {}),
    ...(input.startFrameIndex !== undefined ? { startFrameIndex: input.startFrameIndex } : {}),
    ...(input.endFrameIndex !== undefined ? { endFrameIndex: input.endFrameIndex } : {}),
    ...(input.reason ? { reason: input.reason } : {}),
  };
}

function disambiguateCandidateLabels(
  candidates: readonly FlaWorkbenchCandidate[],
): FlaWorkbenchCandidate[] {
  const counts = new Map<string, number>();
  for (const candidate of candidates) {
    const key = `${candidate.kind}:${candidate.displayLabel.toLocaleLowerCase('en-US')}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const positions = new Map<string, number>();
  return candidates.map((candidate) => {
    const key = `${candidate.kind}:${candidate.displayLabel.toLocaleLowerCase('en-US')}`;
    if ((counts.get(key) ?? 0) < 2) return candidate;
    const position = (positions.get(key) ?? 0) + 1;
    positions.set(key, position);
    return { ...candidate, displayLabel: `${candidate.displayLabel}（${position}）` };
  });
}

function candidatesCatalogRole(entry: FlaRenderableTargetCatalogEntry): FlaRenderableTargetCatalogRole {
  return entry.catalogRole ?? (entry.target.kind === 'scene' ? 'scene' : 'graphic-state');
}

function stableIdentityKey(parts: readonly string[]): string {
  return JSON.stringify(parts);
}

function setsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}
