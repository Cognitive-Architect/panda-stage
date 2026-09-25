import { useEffect, useLayoutEffect, useState } from 'react';
import type { Project } from '../../domain';
import type { AssetCanvasImageReadResponse } from '../../shared/asset-canvas-image-api';
import type { StageAssetUrlMap } from '../../shared/stage/render-model';

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
  promise: Promise<void>;
  status: 'loading' | 'ready' | 'error';
  url?: string;
}

interface NormalizedImageScope {
  requiredAssetIds: string[];
  fallbackAssetIds: string[];
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
  return {
    requiredAssetIds,
    fallbackAssetIds,
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
 * The retained scope is deliberately local: the current shot, the next shot,
 * and (only while the current shot is still loading) the previous valid frame.
 */
export class ProductPreviewImageSession {
  private readonly readCanvasImage: NonNullable<
    ProductPreviewImageSessionOptions['readCanvasImage']
  >;
  private readonly createObjectUrl: (blob: Blob) => string;
  private readonly revokeObjectUrl: (url: string) => void;
  private readonly entries = new Map<string, PreviewImageEntry>();
  private disposed = false;

  constructor(options: ProductPreviewImageSessionOptions = {}) {
    this.readCanvasImage = options.readCanvasImage ?? defaultReadCanvasImage;
    this.createObjectUrl =
      options.createObjectUrl ?? ((blob) => URL.createObjectURL(blob));
    this.revokeObjectUrl =
      options.revokeObjectUrl ?? ((url) => URL.revokeObjectURL(url));
  }

  private ensureEntry(
    projectRoot: string,
    descriptor: PreviewImageDescriptor,
  ): PreviewImageEntry {
    const existing = this.entries.get(descriptor.key);
    if (existing) return existing;

    const entry: PreviewImageEntry = {
      status: 'loading',
      promise: Promise.resolve(),
    };
    this.entries.set(descriptor.key, entry);
    entry.promise = this.readCanvasImage({
      projectRoot,
      assetId: descriptor.assetId,
      sha256: descriptor.sha256,
    })
      .then((response) => {
        if (
          this.disposed ||
          this.entries.get(descriptor.key) !== entry ||
          !response.ok ||
          response.status !== 'ready'
        ) {
          if (
            !this.disposed &&
            this.entries.get(descriptor.key) === entry
          ) {
            entry.status = 'error';
          }
          return;
        }

        const objectUrl = this.createObjectUrl(
          new Blob([response.bytes], { type: response.mimeType }),
        );
        if (
          this.disposed ||
          this.entries.get(descriptor.key) !== entry
        ) {
          this.revokeObjectUrl(objectUrl);
          return;
        }
        entry.status = 'ready';
        entry.url = objectUrl;
      })
      .catch(() => {
        if (!this.disposed && this.entries.get(descriptor.key) === entry) {
          entry.status = 'error';
        }
      });
    return entry;
  }

  private prune(retainedKeys: ReadonlySet<string>): void {
    for (const [key, entry] of this.entries) {
      if (retainedKeys.has(key)) continue;
      this.entries.delete(key);
      if (entry.url) this.revokeObjectUrl(entry.url);
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
    this.prune(
      new Set(
        [...allScopeAssetIds(active), ...allScopeAssetIds(next)]
          .map((assetId) => {
            const asset = project.assets.find(
              (candidate) => candidate.id === assetId,
            );
            return asset?.kind === 'image' && asset.sha256
              ? `${projectRoot}\u0000${asset.id}\u0000${asset.sha256}`
              : null;
          })
          .filter((key): key is string => key !== null),
      ),
    );
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
      if (!entry || entry.status === 'loading') return 'loading' as const;
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
  ): Promise<ProductPreviewAssetLoadState | null> {
    if (this.disposed) return null;
    const active = normalizeScope(activeScope);
    const next = normalizeScope(nextScope);

    for (const assetId of allScopeAssetIds(active)) {
      const descriptor = describeImages(projectRoot, project, [assetId])
        .descriptors[0];
      if (descriptor) this.ensureEntry(projectRoot, descriptor);
    }
    const requiredEntries = active.requiredAssetIds
      .map((assetId) =>
        describeImages(projectRoot, project, [assetId]).descriptors[0],
      )
      .filter(
        (descriptor): descriptor is PreviewImageDescriptor => Boolean(descriptor),
      )
      .map((descriptor) => this.ensureEntry(projectRoot, descriptor));
    for (const assetId of allScopeAssetIds(next)) {
      const descriptor = describeImages(projectRoot, project, [assetId]).descriptors[0];
      if (descriptor) this.ensureEntry(projectRoot, descriptor);
    }

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
        .map((descriptor) => this.ensureEntry(projectRoot, descriptor));
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
    this.disposed = true;
    this.prune(new Set());
  }
}

/** Loads current images and boundedly prepares the next shot's full originals. */
export function useProductPreviewImages(
  projectRoot: string,
  project: Project,
  scope: ProductPreviewImageScopeInput,
  nextAssetIds: ProductPreviewImageScopeInput = [],
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
      .prepare(projectRoot, project, scope, nextAssetIds)
      .then((nextState) => {
        if (active && nextState) setRevision((current) => current + 1);
      });
    return () => {
      active = false;
    };
  }, [assetKey, nextAssetKey, project, projectRoot, session]);

  const state =
    session?.snapshot(projectRoot, project, scope) ??
    INITIAL_PRODUCT_PREVIEW_ASSET_STATE;

  useLayoutEffect(() => {
    if (!session || state.status === 'loading') return;
    session.commitScope(projectRoot, project, scope, nextAssetIds);
  }, [assetKey, nextAssetKey, project, projectRoot, session, state.status]);

  return state;
}
