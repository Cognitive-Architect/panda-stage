import { useEffect, useLayoutEffect, useState } from 'react';
import type { Project } from '../../domain';
import type { AssetCanvasImageReadResponse } from '../../shared/asset-canvas-image-api';
import type { StageAssetUrlMap } from '../../shared/stage/render-model';
import {
  getPreviewFrameTraceStatus,
  previewFrameDiagnosticsEnabled,
  recordPreviewFrameTrace,
  recordPreviewFrameTraceAt,
  type PreviewFrameTraceContext,
} from '../stage/previewDiagnostics';

export type ProductPreviewAssetLoadStatus =
  | 'loading'
  | 'ready'
  | 'degraded'
  | 'error';

export interface ProductPreviewImageFallbackRule {
  sourceAssetId: string;
  fallbackAssetId: string;
}

export interface ProductPreviewImageScope {
  /** Resources required by the exact current visual. */
  requiredAssetIds: readonly string[];
  /** Current Expression resources that can replace a failed Mouth. */
  fallbackAssetIds?: readonly string[];
  /** Upcoming animation frames; these outrank other optional candidates. */
  recentAnimationAssetIds?: readonly string[];
  /** Bounded warmup resources for other times/states. */
  candidateAssetIds?: readonly string[];
  mouthFallbacks?: readonly ProductPreviewImageFallbackRule[];
}

export type ProductPreviewImageScopeInput =
  | readonly string[]
  | ProductPreviewImageScope;

export interface ProductPreviewAssetLoadState {
  status: ProductPreviewAssetLoadStatus;
  urls: StageAssetUrlMap;
  missingCount: number;
  /** Failed active Mouth sources that are currently displayed via fallback. */
  degradedAssetIds?: readonly string[];
  /** Required current resources that have no contract-valid fallback. */
  fatalAssetIds?: readonly string[];
  /** Candidate failures retained as advisory state, never current-fatal alone. */
  optionalFailedAssetIds?: readonly string[];
}

export const INITIAL_PRODUCT_PREVIEW_ASSET_STATE: ProductPreviewAssetLoadState = {
  status: 'loading',
  urls: {},
  missingCount: 0,
};

/** Current requirements can use all three reads; optional work is limited to two. */
export const MAX_CONCURRENT_PREVIEW_IMAGE_READS = 3;
export const MAX_OPTIONAL_PREVIEW_IMAGE_READS = 2;
/** Keep a second next-shot byte read from occupying a current-frame read slot. */
export const MAX_NEXT_SHOT_PREVIEW_IMAGE_READS = 1;
/** Caps queued speculative work; exact current requirements are never dropped. */
export const MAX_QUEUED_OPTIONAL_PREVIEW_IMAGES = 64;
export const MAX_ACTIVE_PREVIEW_CANDIDATE_CACHE = 16;
export const MAX_NEXT_PREVIEW_IMAGE_CACHE = 8;
/** Idle optional originals are bounded by unique content entries and source bytes. */
export const MAX_RETAINED_PREVIEW_CANDIDATE_ENTRIES = 64;
export const MAX_RETAINED_PREVIEW_CANDIDATE_BYTES = 64 * 1024 * 1024;

export interface ProductPreviewImageSessionDiagnostics {
  readRequests: number;
  cacheHits: number;
  queuePeak: number;
  inFlightPeak: number;
  droppedOptionalQueueEntries: number;
  queuedOptionalCount: number;
  inFlightCount: number;
  optionalInFlightCount: number;
  readyCacheEntries: number;
  readyCacheBytes: number;
}

export interface ProductPreviewImageSessionOptions {
  readCanvasImage?: (request: {
    projectRoot: string;
    assetId: string;
    sha256: string;
  }) => Promise<AssetCanvasImageReadResponse>;
  createObjectUrl?: (blob: Blob) => string;
  revokeObjectUrl?: (url: string) => void;
}

interface PreviewImageDescriptor {
  assetId: string;
  key: string;
  sha256: string;
}

interface PreviewImageEntry {
  descriptor: PreviewImageDescriptor;
  projectRoot: string;
  promise: Promise<void>;
  resolve: () => void;
  status: 'queued' | 'loading' | 'ready' | 'error';
  failureKind: 'optional' | 'required' | null;
  requiredRetryAttempted: boolean;
  priority: PreviewImagePriority;
  sequence: number;
  lastUsed: number;
  startedAsOptional: boolean;
  discardResult: boolean;
  byteLength: number;
  traceRequests?: Array<{
    context: PreviewFrameTraceContext;
    requiredQueuedAtMs: number;
  }>;
  readStartedAtMs?: number;
  readReadyAtMs?: number;
  url?: string;
}

const MAX_TRACE_REQUESTS_PER_IMAGE = 8;

type PreviewImagePriority = 0 | 1 | 2 | 3;

interface NormalizedImageScope {
  requiredAssetIds: string[];
  fallbackAssetIds: string[];
  recentAnimationAssetIds: string[];
  candidateAssetIds: string[];
  mouthFallbacks: ProductPreviewImageFallbackRule[];
  structured: boolean;
}

function unique(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

function normalizeScope(
  scope: ProductPreviewImageScopeInput,
): NormalizedImageScope {
  if (Array.isArray(scope)) {
    return {
      requiredAssetIds: unique(scope),
      fallbackAssetIds: [],
      recentAnimationAssetIds: [],
      candidateAssetIds: [],
      mouthFallbacks: [],
      structured: false,
    };
  }
  const structuredScope = scope as ProductPreviewImageScope;
  const requiredAssetIds = unique(structuredScope.requiredAssetIds);
  const fallbackAssetIds = unique(structuredScope.fallbackAssetIds ?? []).filter(
    (assetId) => !requiredAssetIds.includes(assetId),
  );
  const candidateAssetIds = unique(structuredScope.candidateAssetIds ?? []).filter(
    (assetId) =>
      !requiredAssetIds.includes(assetId) && !fallbackAssetIds.includes(assetId),
  );
  const recentAnimationAssetIds = unique(
    structuredScope.recentAnimationAssetIds ?? [],
  ).filter(
    (assetId) =>
      candidateAssetIds.includes(assetId) &&
      !requiredAssetIds.includes(assetId) &&
      !fallbackAssetIds.includes(assetId),
  );
  return {
    requiredAssetIds,
    fallbackAssetIds,
    recentAnimationAssetIds,
    candidateAssetIds,
    mouthFallbacks: [...(structuredScope.mouthFallbacks ?? [])],
    structured: true,
  };
}

function allScopeAssetIds(scope: NormalizedImageScope): string[] {
  return unique([
    ...scope.requiredAssetIds,
    ...scope.fallbackAssetIds,
    ...scope.candidateAssetIds,
  ]);
}

function defaultReadCanvasImage(request: {
  projectRoot: string;
  assetId: string;
  sha256: string;
}): Promise<AssetCanvasImageReadResponse> {
  return window.pandaStage.assets.readCanvasImage(request);
}

function describeImages(
  projectRoot: string,
  project: Project,
  assetIds: readonly string[],
): { descriptors: PreviewImageDescriptor[]; invalidCount: number } {
  const descriptors: PreviewImageDescriptor[] = [];
  const seen = new Set<string>();
  let invalidCount = 0;

  for (const assetId of assetIds) {
    if (seen.has(assetId)) continue;
    seen.add(assetId);
    const asset = project.assets.find((candidate) => candidate.id === assetId);
    if (!asset || asset.kind !== 'image' || !asset.sha256) {
      invalidCount += 1;
      continue;
    }
    descriptors.push({
      assetId,
      key: `${projectRoot}\u0000${assetId}\u0000${asset.sha256}`,
      sha256: asset.sha256,
    });
  }

  return { descriptors, invalidCount };
}

/**
 * Owns the bounded-original URLs used by one mounted Preview.
 *
 * The retained scope is deliberately local: exact current resources, a small
 * recent candidate window, a few next-shot resources, and the previous exact
 * resources while a new frame is still loading.
 */
export class ProductPreviewImageSession {
  private readonly readCanvasImage: NonNullable<
    ProductPreviewImageSessionOptions['readCanvasImage']
  >;
  private readonly createObjectUrl: (blob: Blob) => string;
  private readonly revokeObjectUrl: (url: string) => void;
  private readonly entries = new Map<string, PreviewImageEntry>();
  private readonly inFlight = new Map<string, PreviewImageEntry>();
  private currentKeepKeys = new Set<string>();
  private committedKeepKeys = new Set<string>();
  private nextSequence = 0;
  private readRequests = 0;
  private cacheHits = 0;
  private queuePeak = 0;
  private inFlightPeak = 0;
  private droppedOptionalQueueEntries = 0;
  private disposed = false;
  private activeTraceContext: PreviewFrameTraceContext | null = null;

  constructor(options: ProductPreviewImageSessionOptions = {}) {
    this.readCanvasImage = options.readCanvasImage ?? defaultReadCanvasImage;
    this.createObjectUrl =
      options.createObjectUrl ?? ((blob) => URL.createObjectURL(blob));
    this.revokeObjectUrl =
      options.revokeObjectUrl ?? ((url) => URL.revokeObjectURL(url));
  }

  getDiagnostics(): ProductPreviewImageSessionDiagnostics {
    const optionalQueued = [...this.entries.values()].filter(
      (entry) => entry.status === 'queued' && entry.priority > 0,
    ).length;
    const readyEntries = [...this.entries.values()].filter(
      (entry) => entry.status === 'ready' && entry.url,
    );
    return {
      readRequests: this.readRequests,
      cacheHits: this.cacheHits,
      queuePeak: this.queuePeak,
      inFlightPeak: this.inFlightPeak,
      droppedOptionalQueueEntries: this.droppedOptionalQueueEntries,
      queuedOptionalCount: optionalQueued,
      inFlightCount: this.inFlight.size,
      optionalInFlightCount: [...this.inFlight.values()].filter(
        (entry) => entry.startedAsOptional,
      ).length,
      readyCacheEntries: readyEntries.length,
      readyCacheBytes: readyEntries.reduce(
        (total, entry) => total + entry.byteLength,
        0,
      ),
    };
  }

  private ensureEntry(
    projectRoot: string,
    descriptor: PreviewImageDescriptor,
    priority: PreviewImagePriority,
  ): PreviewImageEntry | null {
    const existing =
      this.entries.get(descriptor.key) ?? this.inFlight.get(descriptor.key);
    if (existing) {
      const retryOptionalFailureAsRequired =
        priority === 0 &&
        existing.status === 'error' &&
        existing.failureKind === 'optional' &&
        !existing.requiredRetryAttempted;
      this.entries.set(descriptor.key, existing);
      existing.descriptor = descriptor;
      existing.projectRoot = projectRoot;
      existing.priority = priority;
      existing.lastUsed = ++this.nextSequence;
      existing.discardResult = false;
      if (retryOptionalFailureAsRequired) {
        existing.requiredRetryAttempted = true;
        existing.failureKind = null;
        existing.status = 'queued';
        existing.startedAsOptional = false;
        existing.readStartedAtMs = undefined;
        existing.readReadyAtMs = undefined;
        existing.sequence = this.nextSequence;
        let resolve!: () => void;
        existing.promise = new Promise<void>((onResolve) => {
          resolve = onResolve;
        });
        existing.resolve = resolve;
      } else {
        this.cacheHits += 1;
      }
      this.enforceOptionalQueueLimit();
      this.updateQueuePeak();
      return existing;
    }

    if (priority > 0) {
      const optionalQueued = [...this.entries.values()].filter(
        (entry) => entry.status === 'queued' && entry.priority > 0,
      );
      if (optionalQueued.length >= MAX_QUEUED_OPTIONAL_PREVIEW_IMAGES) {
        const worst = optionalQueued.sort(
          (left, right) =>
            right.priority - left.priority || right.sequence - left.sequence,
        )[0];
        if (!worst || worst.priority <= priority) {
          this.droppedOptionalQueueEntries += 1;
          return null;
        }
        this.cancelQueuedEntry(worst, true);
      }
    }

    let resolve!: () => void;
    const promise = new Promise<void>((onResolve) => {
      resolve = onResolve;
    });
    const entry: PreviewImageEntry = {
      descriptor,
      projectRoot,
      promise,
      resolve,
      status: 'queued',
      failureKind: null,
      requiredRetryAttempted: false,
      priority,
      sequence: ++this.nextSequence,
      lastUsed: this.nextSequence,
      startedAsOptional: false,
      discardResult: false,
      byteLength: 0,
    };
    this.entries.set(descriptor.key, entry);
    this.updateQueuePeak();
    return entry;
  }

  private prune(retainedKeys: ReadonlySet<string>): void {
    for (const [key, entry] of this.entries) {
      if (retainedKeys.has(key)) {
        entry.discardResult = false;
        continue;
      }
      if (entry.status === 'loading' && !this.disposed) {
        entry.discardResult = true;
        continue;
      }
      this.entries.delete(key);
      if (entry.status === 'queued') entry.status = 'error';
      if (entry.url) this.revokeObjectUrl(entry.url);
      entry.url = undefined;
      entry.resolve();
    }
  }

  private cancelQueuedEntry(
    entry: PreviewImageEntry,
    countAsDropped: boolean,
  ): void {
    if (entry.status !== 'queued') return;
    for (const [key, candidate] of this.entries) {
      if (candidate !== entry) continue;
      this.entries.delete(key);
      break;
    }
    entry.status = 'error';
    entry.resolve();
    if (countAsDropped) this.droppedOptionalQueueEntries += 1;
  }

  private updateQueuePeak(): void {
    const queued = [...this.entries.values()].filter(
      (entry) => entry.status === 'queued' && entry.priority > 0,
    ).length;
    this.queuePeak = Math.max(this.queuePeak, queued);
  }

  private enforceOptionalQueueLimit(): void {
    const optionalQueued = [...this.entries.values()].filter(
      (entry) => entry.status === 'queued' && entry.priority > 0,
    );
    while (optionalQueued.length > MAX_QUEUED_OPTIONAL_PREVIEW_IMAGES) {
      const worst = optionalQueued.sort(
        (left, right) =>
          right.priority - left.priority || right.sequence - left.sequence,
      )[0];
      if (!worst) return;
      this.cancelQueuedEntry(worst, true);
      optionalQueued.splice(optionalQueued.indexOf(worst), 1);
    }
  }

  private isProtected(key: string): boolean {
    return this.currentKeepKeys.has(key) || this.committedKeepKeys.has(key);
  }

  private cancelStaleQueuedEntries(allowedKeys: ReadonlySet<string>): void {
    for (const [key, entry] of this.entries) {
      if (allowedKeys.has(key)) {
        entry.discardResult = false;
        continue;
      }
      if (entry.status === 'queued') {
        this.cancelQueuedEntry(entry, false);
      } else if (entry.status === 'loading' && !this.isProtected(key)) {
        entry.discardResult = true;
      } else if (entry.status === 'error' && !this.isProtected(key)) {
        this.entries.delete(key);
      }
    }
  }

  private pump(): void {
    if (this.disposed) return;
    while (this.inFlight.size < MAX_CONCURRENT_PREVIEW_IMAGE_READS) {
      const next = [...this.entries.values()]
        .filter((entry) => entry.status === 'queued')
        .sort(
          (left, right) =>
            left.priority - right.priority || left.sequence - right.sequence,
        )[0];
      if (!next) return;
      const optionalInFlight = [...this.inFlight.values()].filter(
        (entry) => entry.startedAsOptional,
      ).length;
      const nextShotInFlight = [...this.inFlight.values()].filter(
        (entry) => entry.startedAsOptional && entry.priority === 3,
      ).length;
      if (
        next.priority > 0 &&
        optionalInFlight >= MAX_OPTIONAL_PREVIEW_IMAGE_READS
      ) {
        return;
      }
      if (
        next.priority === 3 &&
        nextShotInFlight >= MAX_NEXT_SHOT_PREVIEW_IMAGE_READS
      ) {
        return;
      }
      this.startEntry(next.projectRoot, next.descriptor, next);
    }
  }

  private startEntry(
    projectRoot: string,
    descriptor: PreviewImageDescriptor,
    entry: PreviewImageEntry,
  ): void {
    entry.status = 'loading';
    entry.failureKind = null;
    const attemptStartedAsOptional = entry.priority > 0;
    entry.startedAsOptional = attemptStartedAsOptional;
    entry.discardResult = false;
    this.inFlight.set(descriptor.key, entry);
    this.inFlightPeak = Math.max(this.inFlightPeak, this.inFlight.size);

    const canApplyResult = (): boolean =>
      !this.disposed &&
      this.entries.get(descriptor.key) === entry &&
      (!entry.discardResult || this.isProtected(descriptor.key));
    const readImage = (): Promise<AssetCanvasImageReadResponse> => {
      this.readRequests += 1;
      if (entry.traceRequests?.length || previewFrameDiagnosticsEnabled()) {
        entry.readStartedAtMs = performance.now();
        this.recordByteReadStart(entry);
      }
      return Promise.resolve().then(() =>
        this.readCanvasImage({
          projectRoot,
          assetId: descriptor.assetId,
          sha256: descriptor.sha256,
        }),
      );
    };
    const failEntry = (): void => {
      if (this.disposed || this.entries.get(descriptor.key) !== entry) return;
      entry.status = 'error';
      entry.failureKind =
        entry.requiredRetryAttempted || !attemptStartedAsOptional
          ? 'required'
          : 'optional';
      for (const request of entry.traceRequests ?? []) {
        recordPreviewFrameTrace('byte-read-failed', request.context, {
          assetId: descriptor.assetId,
          priority: entry.priority,
          readStatus: 'FAILED',
          status: this.activeTraceContext?.traceId === request.context.traceId
            ? 'FAILED'
            : 'SUPERSEDED',
          cause: 'read-failed',
        });
      }
    };
    const isReadyResponse = (
      response: AssetCanvasImageReadResponse | null,
    ): response is Extract<AssetCanvasImageReadResponse, { status: 'ready' }> =>
      Boolean(response?.ok && response.status === 'ready');

    void (async () => {
      let response = await readImage().catch(() => null);
      if (!canApplyResult()) {
        this.recordByteReadDiscarded(entry, descriptor.assetId, 'stale-result');
        failEntry();
        return;
      }

      const shouldRetryAsRequired = (): boolean =>
        attemptStartedAsOptional &&
        entry.priority === 0 &&
        this.currentKeepKeys.has(descriptor.key) &&
        !entry.requiredRetryAttempted;

      if (!isReadyResponse(response) && shouldRetryAsRequired()) {
        entry.requiredRetryAttempted = true;
        entry.startedAsOptional = false;
        entry.failureKind = null;
        response = await readImage().catch(() => null);
        if (!canApplyResult()) {
          this.recordByteReadDiscarded(entry, descriptor.assetId, 'stale-retry-result');
          failEntry();
          return;
        }
      }

      if (!isReadyResponse(response)) {
        failEntry();
        return;
      }

      if (entry.traceRequests?.length || previewFrameDiagnosticsEnabled()) {
        entry.readReadyAtMs = performance.now();
        this.recordByteReadReady(entry, descriptor.assetId, response.byteLength);
      }

      const objectUrl = this.createObjectUrl(
        new Blob([response.bytes], { type: response.mimeType }),
      );
      if (!canApplyResult()) {
        this.revokeObjectUrl(objectUrl);
        this.recordByteReadDiscarded(entry, descriptor.assetId, 'stale-object-url');
        failEntry();
        return;
      }
      entry.status = 'ready';
      entry.failureKind = null;
      entry.url = objectUrl;
      entry.byteLength = Number.isFinite(response.byteLength)
        ? Math.max(0, response.byteLength)
        : response.bytes.byteLength;
      entry.lastUsed = ++this.nextSequence;
      this.enforceReadyCacheBudget();
    })()
      .catch(() => {
        failEntry();
      })
      .finally(() => {
        if (this.inFlight.get(descriptor.key) === entry) {
          this.inFlight.delete(descriptor.key);
        }
        if (entry.status === 'loading') {
          failEntry();
        }
        entry.resolve();
        if (
          entry.discardResult &&
          !this.isProtected(descriptor.key) &&
          this.entries.get(descriptor.key) === entry
        ) {
          this.entries.delete(descriptor.key);
          if (entry.url) this.revokeObjectUrl(entry.url);
          entry.url = undefined;
        }
        this.enforceReadyCacheBudget();
        this.pump();
      });
  }

  private enforceReadyCacheBudget(): void {
    const optionalEntries = [...this.entries.entries()]
      .filter(
        ([key, entry]) =>
          entry.status === 'ready' && entry.url && !this.isProtected(key),
      )
      .sort(([, left], [, right]) => left.lastUsed - right.lastUsed);
    let count = optionalEntries.length;
    let bytes = optionalEntries.reduce(
      (total, [, entry]) => total + entry.byteLength,
      0,
    );
    while (
      count > MAX_RETAINED_PREVIEW_CANDIDATE_ENTRIES ||
      bytes > MAX_RETAINED_PREVIEW_CANDIDATE_BYTES
    ) {
      const oldest = optionalEntries.shift();
      if (!oldest) return;
      const [key, entry] = oldest;
      if (this.entries.get(key) !== entry) continue;
      this.entries.delete(key);
      if (entry.url) this.revokeObjectUrl(entry.url);
      entry.url = undefined;
      entry.status = 'error';
      count -= 1;
      bytes -= entry.byteLength;
    }
  }

  commitScope(
    projectRoot: string,
    project: Project,
    activeScope: ProductPreviewImageScopeInput,
    nextScope: ProductPreviewImageScopeInput = [],
  ): void {
    if (this.disposed) return;
    const active = normalizeScope(activeScope);
    const next = normalizeScope(nextScope);
    const retainedAssetIds = unique([
      ...active.requiredAssetIds,
      ...active.fallbackAssetIds,
      ...active.candidateAssetIds.slice(0, MAX_ACTIVE_PREVIEW_CANDIDATE_CACHE),
      ...allScopeAssetIds(next).slice(0, MAX_NEXT_PREVIEW_IMAGE_CACHE),
    ]);
    const retainedKeys = new Set(
      describeImages(projectRoot, project, retainedAssetIds).descriptors.map(
        (descriptor) => descriptor.key,
      ),
    );
    const currentProtectedKeys = new Set(
      describeImages(
        projectRoot,
        project,
        unique([...active.requiredAssetIds, ...active.fallbackAssetIds]),
      ).descriptors.map((descriptor) => descriptor.key),
    );
    this.committedKeepKeys = currentProtectedKeys;
    this.currentKeepKeys = new Set(currentProtectedKeys);
    this.prune(retainedKeys);
    this.enforceReadyCacheBudget();
  }

  snapshot(
    projectRoot: string,
    project: Project,
    scopeInput: ProductPreviewImageScopeInput,
  ): ProductPreviewAssetLoadState {
    if (this.disposed) return INITIAL_PRODUCT_PREVIEW_ASSET_STATE;
    const scope = normalizeScope(scopeInput);
    const required = describeImages(projectRoot, project, scope.requiredAssetIds);
    const fallback = describeImages(projectRoot, project, scope.fallbackAssetIds);
    const candidates = describeImages(
      projectRoot,
      project,
      scope.candidateAssetIds,
    );
    const urls: Record<string, string | undefined> = {};
    const fatalAssetIds: string[] = [];
    const degradedAssetIds: string[] = [];
    const optionalFailedAssetIds: string[] = [];
    let loading = false;

    const readEntry = (descriptor: PreviewImageDescriptor | undefined) => {
      if (!descriptor) return 'missing' as const;
      const entry = this.entries.get(descriptor.key);
      if (!entry || entry.status === 'queued' || entry.status === 'loading') {
        return 'loading' as const;
      }
      if (entry.status === 'ready' && entry.url) {
        urls[descriptor.assetId] = entry.url;
        return 'ready' as const;
      }
      return 'error' as const;
    };

    const fallbackBySource = new Map<string, string[]>();
    for (const rule of scope.mouthFallbacks) {
      const fallbackIds = fallbackBySource.get(rule.sourceAssetId) ?? [];
      if (!fallbackIds.includes(rule.fallbackAssetId)) {
        fallbackIds.push(rule.fallbackAssetId);
      }
      fallbackBySource.set(rule.sourceAssetId, fallbackIds);
    }
    const requiredDescriptors = new Map(
      required.descriptors.map((descriptor) => [descriptor.assetId, descriptor]),
    );
    const fallbackDescriptors = new Map(
      fallback.descriptors.map((descriptor) => [descriptor.assetId, descriptor]),
    );
    for (const assetId of scope.requiredAssetIds) {
      const status = readEntry(requiredDescriptors.get(assetId));
      if (status === 'ready') continue;
      if (status === 'loading') {
        loading = true;
        continue;
      }

      const fallbackIds = fallbackBySource.get(assetId) ?? [];
      if (fallbackIds.length === 0) {
        fatalAssetIds.push(assetId);
        continue;
      }
      let fallbackLoading = false;
      let fallbackFailed = false;
      for (const fallbackId of fallbackIds) {
        const fallbackStatus = readEntry(fallbackDescriptors.get(fallbackId));
        if (fallbackStatus === 'loading') fallbackLoading = true;
        if (fallbackStatus === 'error' || fallbackStatus === 'missing') {
          fallbackFailed = true;
        }
      }
      if (fallbackLoading) {
        loading = true;
      } else if (fallbackFailed) {
        fatalAssetIds.push(assetId);
      } else {
        degradedAssetIds.push(assetId);
      }
    }

    for (const descriptor of [...fallback.descriptors, ...candidates.descriptors]) {
      const status = readEntry(descriptor);
      if (
        status === 'error' &&
        (scope.candidateAssetIds.includes(descriptor.assetId) ||
          !scope.fallbackAssetIds.includes(descriptor.assetId))
      ) {
        optionalFailedAssetIds.push(descriptor.assetId);
      }
    }

    const state: ProductPreviewAssetLoadState = {
      status:
        loading
          ? 'loading'
          : fatalAssetIds.length > 0
            ? 'error'
            : degradedAssetIds.length > 0
              ? 'degraded'
              : 'ready',
      urls,
      missingCount: fatalAssetIds.length + required.invalidCount,
    };
    if (scope.structured || degradedAssetIds.length > 0) {
      state.degradedAssetIds = degradedAssetIds;
      state.fatalAssetIds = fatalAssetIds;
      state.optionalFailedAssetIds = unique(optionalFailedAssetIds);
    }
    return state;
  }

  async prepare(
    projectRoot: string,
    project: Project,
    activeScope: ProductPreviewImageScopeInput,
    nextScope: ProductPreviewImageScopeInput = [],
    traceContext: PreviewFrameTraceContext | null = null,
  ): Promise<ProductPreviewAssetLoadState | null> {
    if (this.disposed) return null;
    this.activeTraceContext = traceContext;
    const active = normalizeScope(activeScope);
    const next = normalizeScope(nextScope);

    const required = describeImages(projectRoot, project, active.requiredAssetIds);
    const fallback = describeImages(projectRoot, project, active.fallbackAssetIds);
    const recent = describeImages(
      projectRoot,
      project,
      active.recentAnimationAssetIds,
    );
    const candidates = describeImages(
      projectRoot,
      project,
      active.candidateAssetIds,
    );
    const nextDescriptors = describeImages(
      projectRoot,
      project,
      allScopeAssetIds(next).slice(0, MAX_NEXT_PREVIEW_IMAGE_CACHE),
    );
    const allowedKeys = new Set(
      [
        ...required.descriptors,
        ...fallback.descriptors,
        ...recent.descriptors,
        ...candidates.descriptors,
        ...nextDescriptors.descriptors,
      ].map((descriptor) => descriptor.key),
    );
    this.currentKeepKeys = new Set(
      describeImages(
        projectRoot,
        project,
        unique([...active.requiredAssetIds, ...active.fallbackAssetIds]),
      ).descriptors.map((descriptor) => descriptor.key),
    );
    this.cancelStaleQueuedEntries(allowedKeys);

    const tasks = new Map<
      string,
      { descriptor: PreviewImageDescriptor; priority: PreviewImagePriority }
    >();
    const addTasks = (
      descriptors: readonly PreviewImageDescriptor[],
      priority: PreviewImagePriority,
    ): void => {
      for (const descriptor of descriptors) {
        const existing = tasks.get(descriptor.key);
        if (!existing || priority < existing.priority) {
          tasks.set(descriptor.key, { descriptor, priority });
        }
      }
    };
    addTasks(required.descriptors, 0);
    addTasks(recent.descriptors, 1);
    const recentIds = new Set(active.recentAnimationAssetIds);
    addTasks(
      candidates.descriptors.filter(
        (descriptor) => !recentIds.has(descriptor.assetId),
      ),
      2,
    );
    addTasks(nextDescriptors.descriptors, 3);
    const entriesByKey = new Map<string, PreviewImageEntry>();
    for (const { descriptor, priority } of tasks.values()) {
      const entry = this.ensureEntry(projectRoot, descriptor, priority);
      if (entry) entriesByKey.set(descriptor.key, entry);
    }
    const requiredEntries = required.descriptors
      .map((descriptor) => entriesByKey.get(descriptor.key))
      .filter((entry): entry is PreviewImageEntry => Boolean(entry));
    if (traceContext) {
      const targetDescriptor = required.descriptors.find(
        (descriptor) => descriptor.assetId === traceContext.targetAssetId,
      );
      const targetEntry = targetDescriptor
        ? entriesByKey.get(targetDescriptor.key)
        : undefined;
      if (targetEntry) {
        this.attachTraceRequest(targetEntry, traceContext);
        recordPreviewFrameTrace('required-queued', traceContext, {
          subsystem: 'preview-byte-read',
          assetId: targetDescriptor?.assetId ?? traceContext.targetAssetId,
          priority: targetEntry.priority,
          queueState: targetEntry.status,
        });
        if (targetEntry.readStartedAtMs !== undefined) {
          recordPreviewFrameTraceAt(
            'byte-read-start',
            traceContext,
            targetEntry.readStartedAtMs,
            {
              assetId: targetEntry.descriptor.assetId,
              priority: targetEntry.priority,
              startedAsOptional: targetEntry.startedAsOptional,
              requiredQueuedAt: this.traceQueuedAt(targetEntry, traceContext),
              observedAfterStart: true,
            },
          );
        }
        if (targetEntry.status === 'ready' && targetEntry.readReadyAtMs !== undefined) {
          this.recordByteReadReady(
            targetEntry,
            traceContext.targetAssetId,
            targetEntry.byteLength,
          );
        } else if (targetEntry.status === 'error') {
          recordPreviewFrameTrace('byte-read-failed', traceContext, {
            assetId: traceContext.targetAssetId,
            readStatus: 'FAILED',
            status: 'FAILED',
            cause: targetEntry.failureKind ?? 'read-failed',
          });
        }
      }
    }
    this.pump();

    // Keep the prior shot's ready URLs alive while the new active shot loads.
    // Candidate/fallback warmup is bounded, but only required current resources
    // block the exact current target. A failed candidate is retained as advisory
    // state rather than promoted to a current-frame failure.
    await Promise.all(requiredEntries.map((entry) => entry.promise));
    if (this.disposed) return null;
    let state = this.snapshot(projectRoot, project, activeScope);
    if (state.status === 'loading') {
      // A failed active Mouth is the one case where a fallback is part of the
      // current decision. Wait for that bounded fallback before classifying the
      // frame as degraded or fatal. Candidates never block exact readiness.
      const fallbackEntries = active.fallbackAssetIds
        .map((assetId) =>
          describeImages(projectRoot, project, [assetId]).descriptors[0],
        )
        .filter(
          (descriptor): descriptor is PreviewImageDescriptor => Boolean(descriptor),
        )
        .map((descriptor) => this.ensureEntry(projectRoot, descriptor, 0))
        .filter((entry): entry is PreviewImageEntry => Boolean(entry));
      this.pump();
      await Promise.all(fallbackEntries.map((entry) => entry.promise));
    }
    if (this.disposed) return null;
    state = this.snapshot(projectRoot, project, activeScope);
    return state;
  }

  async load(
    projectRoot: string,
    project: Project,
    scope: ProductPreviewImageScopeInput,
  ): Promise<ProductPreviewAssetLoadState | null> {
    return this.prepare(projectRoot, project, scope);
  }

  dispose(): void {
    if (this.disposed) return;
    if (this.activeTraceContext &&
        getPreviewFrameTraceStatus(this.activeTraceContext.traceId) === 'PENDING') {
      recordPreviewFrameTrace('trace-cancelled', this.activeTraceContext, {
        status: 'CANCELLED',
        cause: 'preview-image-session-disposed',
      });
    }
    this.disposed = true;
    this.currentKeepKeys.clear();
    this.committedKeepKeys.clear();
    this.prune(new Set());
  }

  private attachTraceRequest(
    entry: PreviewImageEntry,
    context: PreviewFrameTraceContext,
  ): void {
    entry.traceRequests ??= [];
    if (entry.traceRequests.some((request) => request.context.traceId === context.traceId)) {
      return;
    }
    entry.traceRequests.push({
      context,
      requiredQueuedAtMs: performance.now(),
    });
    if (entry.traceRequests.length > MAX_TRACE_REQUESTS_PER_IMAGE) {
      entry.traceRequests.shift();
    }
  }

  private traceQueuedAt(
    entry: PreviewImageEntry,
    context: PreviewFrameTraceContext,
  ): number | null {
    return entry.traceRequests?.find(
      (request) => request.context.traceId === context.traceId,
    )?.requiredQueuedAtMs ?? null;
  }

  private recordByteReadStart(entry: PreviewImageEntry): void {
    if (entry.readStartedAtMs === undefined) return;
    for (const request of entry.traceRequests ?? []) {
      recordPreviewFrameTraceAt(
        'byte-read-start',
        request.context,
        entry.readStartedAtMs,
        {
          assetId: entry.descriptor.assetId,
          priority: entry.priority,
          startedAsOptional: entry.startedAsOptional,
          requiredQueuedAt: request.requiredQueuedAtMs,
          queueWaitMs: Math.max(0, entry.readStartedAtMs - request.requiredQueuedAtMs),
        },
      );
    }
  }

  private recordByteReadReady(
    entry: PreviewImageEntry,
    assetId: string,
    byteLength: number,
  ): void {
    if (entry.readReadyAtMs === undefined) return;
    for (const request of entry.traceRequests ?? []) {
      recordPreviewFrameTraceAt(
        'byte-read-ready',
        request.context,
        entry.readReadyAtMs,
        {
          assetId,
          byteLength,
          priority: entry.priority,
          readMs: entry.readStartedAtMs === undefined
            ? null
            : entry.readReadyAtMs - entry.readStartedAtMs,
          status: this.activeTraceContext?.traceId === request.context.traceId
            ? 'PENDING'
            : 'SUPERSEDED',
        },
      );
    }
  }

  private recordByteReadDiscarded(
    entry: PreviewImageEntry,
    assetId: string,
    cause: string,
  ): void {
    for (const request of entry.traceRequests ?? []) {
      recordPreviewFrameTrace('byte-read-discarded', request.context, {
        assetId,
        readStatus: 'DISCARDED',
        status: this.activeTraceContext?.traceId === request.context.traceId
          ? 'CANCELLED'
          : 'SUPERSEDED',
        cause,
      });
    }
  }
}

/** Loads current images and boundedly prepares the next shot's full originals. */
export function useProductPreviewImages(
  projectRoot: string,
  project: Project,
  scope: ProductPreviewImageScopeInput,
  nextAssetIds: ProductPreviewImageScopeInput = [],
  traceContext: PreviewFrameTraceContext | null = null,
): ProductPreviewAssetLoadState {
  const [session, setSession] = useState<ProductPreviewImageSession | null>(null);
  const [, setRevision] = useState(0);
  const normalizedScope = normalizeScope(scope);
  const normalizedNextScope = normalizeScope(nextAssetIds);
  const scopeKey = (current: NormalizedImageScope): string =>
    JSON.stringify({
      required: current.requiredAssetIds
        .map((assetId) => {
          const asset = project.assets.find(
            (candidate) => candidate.id === assetId,
          );
          return `${assetId}:${asset?.sha256 ?? 'missing'}`;
        })
        .sort(),
      fallback: current.fallbackAssetIds
        .map((assetId) => {
          const asset = project.assets.find(
            (candidate) => candidate.id === assetId,
          );
          return `${assetId}:${asset?.sha256 ?? 'missing'}`;
        })
        .sort(),
      candidates: current.candidateAssetIds
        .map((assetId) => {
          const asset = project.assets.find(
            (candidate) => candidate.id === assetId,
          );
          return `${assetId}:${asset?.sha256 ?? 'missing'}`;
        })
        .sort(),
      recentAnimation: current.recentAnimationAssetIds.map((assetId) => {
        const asset = project.assets.find(
          (candidate) => candidate.id === assetId,
        );
        return `${assetId}:${asset?.sha256 ?? 'missing'}`;
      }),
      mouthFallbacks: current.mouthFallbacks
        .map((rule) => `${rule.sourceAssetId}->${rule.fallbackAssetId}`)
        .sort(),
    });
  const assetKey = scopeKey(normalizedScope);
  const nextAssetKey = scopeKey(normalizedNextScope);

  useEffect(() => {
    const nextSession = new ProductPreviewImageSession();
    setSession(nextSession);
    return () => nextSession.dispose();
  }, [projectRoot]);

  useEffect(() => {
    if (!session) return;
    let active = true;
    void session
      .prepare(projectRoot, project, scope, nextAssetIds, traceContext)
      .then((nextState) => {
        if (active && nextState) setRevision((current) => current + 1);
      });
    return () => {
      active = false;
    };
  }, [assetKey, nextAssetKey, project, projectRoot, session, traceContext?.traceId]);

  const state =
    session?.snapshot(projectRoot, project, scope) ??
    INITIAL_PRODUCT_PREVIEW_ASSET_STATE;

  useLayoutEffect(() => {
    if (!session || state.status === 'loading') return;
    session.commitScope(projectRoot, project, scope, nextAssetIds);
  }, [assetKey, nextAssetKey, project, projectRoot, session, state.status]);

  return state;
}
