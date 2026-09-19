import { useEffect, useLayoutEffect, useState } from 'react';
import type { Project } from '../../domain';
import type { AssetCanvasImageReadResponse } from '../../shared/asset-canvas-image-api';
import type { StageAssetUrlMap } from '../../shared/stage/render-model';

export type ProductPreviewAssetLoadStatus = 'loading' | 'ready' | 'error';

export interface ProductPreviewAssetLoadState {
  status: ProductPreviewAssetLoadStatus;
  urls: StageAssetUrlMap;
  missingCount: number;
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
    activeAssetIds: readonly string[],
    nextAssetIds: readonly string[] = [],
  ): void {
    if (this.disposed) return;
    const active = describeImages(projectRoot, project, activeAssetIds);
    const next = describeImages(projectRoot, project, nextAssetIds);
    this.prune(
      new Set(
        [...active.descriptors, ...next.descriptors].map(
          (descriptor) => descriptor.key,
        ),
      ),
    );
  }

  snapshot(
    projectRoot: string,
    project: Project,
    assetIds: readonly string[],
  ): ProductPreviewAssetLoadState {
    if (this.disposed) return INITIAL_PRODUCT_PREVIEW_ASSET_STATE;
    const { descriptors, invalidCount } = describeImages(
      projectRoot,
      project,
      assetIds,
    );
    const urls: Record<string, string | undefined> = {};
    let missingCount = invalidCount;
    let loading = false;

    for (const descriptor of descriptors) {
      const entry = this.entries.get(descriptor.key);
      if (!entry || entry.status === 'loading') {
        loading = true;
      } else if (entry.status === 'ready' && entry.url) {
        urls[descriptor.assetId] = entry.url;
      } else {
        missingCount += 1;
      }
    }

    return {
      status: loading ? 'loading' : missingCount > 0 ? 'error' : 'ready',
      urls,
      missingCount,
    };
  }

  async prepare(
    projectRoot: string,
    project: Project,
    activeAssetIds: readonly string[],
    nextAssetIds: readonly string[] = [],
  ): Promise<ProductPreviewAssetLoadState | null> {
    if (this.disposed) return null;
    const active = describeImages(projectRoot, project, activeAssetIds);
    const next = describeImages(projectRoot, project, nextAssetIds);

    const activeEntries = active.descriptors.map((descriptor) =>
      this.ensureEntry(projectRoot, descriptor),
    );
    for (const descriptor of next.descriptors) {
      this.ensureEntry(projectRoot, descriptor);
    }

    // Keep the prior shot's ready URLs alive while the new active shot loads.
    // The hook commits current + next after the ready render reaches the DOM.
    await Promise.all(activeEntries.map((entry) => entry.promise));
    if (this.disposed) return null;
    return this.snapshot(projectRoot, project, activeAssetIds);
  }

  async load(
    projectRoot: string,
    project: Project,
    assetIds: readonly string[],
  ): Promise<ProductPreviewAssetLoadState | null> {
    return this.prepare(projectRoot, project, assetIds);
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
  assetIds: readonly string[],
  nextAssetIds: readonly string[] = [],
): ProductPreviewAssetLoadState {
  const [session, setSession] = useState<ProductPreviewImageSession | null>(null);
  const [, setRevision] = useState(0);
  const assetKey = assetIds
    .map((assetId) => {
      const asset = project.assets.find((candidate) => candidate.id === assetId);
      return `${assetId}:${asset?.sha256 ?? 'missing'}`;
    })
    .sort()
    .join('|');
  const nextAssetKey = nextAssetIds
    .map((assetId) => {
      const asset = project.assets.find((candidate) => candidate.id === assetId);
      return `${assetId}:${asset?.sha256 ?? 'missing'}`;
    })
    .sort()
    .join('|');

  useEffect(() => {
    const nextSession = new ProductPreviewImageSession();
    setSession(nextSession);
    return () => nextSession.dispose();
  }, [projectRoot]);

  useEffect(() => {
    if (!session) return;
    let active = true;
    void session
      .prepare(projectRoot, project, assetIds, nextAssetIds)
      .then((nextState) => {
        if (active && nextState) setRevision((current) => current + 1);
      });
    return () => {
      active = false;
    };
  }, [assetIds, assetKey, nextAssetIds, nextAssetKey, project, projectRoot, session]);

  const state =
    session?.snapshot(projectRoot, project, assetIds) ??
    INITIAL_PRODUCT_PREVIEW_ASSET_STATE;

  useLayoutEffect(() => {
    if (!session || state.status === 'loading') return;
    session.commitScope(projectRoot, project, assetIds, nextAssetIds);
  }, [assetIds, assetKey, nextAssetIds, nextAssetKey, project, projectRoot, session, state.status]);

  return state;
}
