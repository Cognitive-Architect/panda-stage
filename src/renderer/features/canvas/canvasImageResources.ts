import type { AssetCanvasImageReadResponse } from '../../../shared/asset-canvas-image-api';

export interface CanvasImageAssetSource {
  id: string;
  sha256?: string;
}

/** Runtime identity for one decoded version of one Canvas asset. */
export function canvasImageResourceKey(
  assetId: string,
  sourceKey: string,
): string {
  return `${assetId}\u0000${sourceKey}`;
}

export interface CanvasImageState {
  images: ReadonlyMap<string, HTMLImageElement>;
  sourceKeys: ReadonlyMap<string, string>;
  /** All decoded current and explicitly retained continuity resources. */
  imagesByResourceKey: ReadonlyMap<string, HTMLImageElement>;
  readyResourceKeys: ReadonlySet<string>;
  missing: ReadonlySet<string>;
}

export const EMPTY_CANVAS_IMAGE_STATE: CanvasImageState = {
  images: new Map(),
  sourceKeys: new Map(),
  imagesByResourceKey: new Map(),
  readyResourceKeys: new Set(),
  missing: new Set(),
};

interface CanvasImageResource {
  assetId: string;
  image: HTMLImageElement;
  objectUrl: string;
  sourceKey: string;
  loaded: boolean;
  disposed: boolean;
}

interface PendingCanvasImageResource {
  token: number;
  assetId: string;
  sourceKey: string;
  resource?: CanvasImageResource;
}

export interface CanvasImageResourceSessionOptions {
  readCanvasImage?: (request: {
    projectRoot: string;
    assetId: string;
    sha256: string;
  }) => Promise<AssetCanvasImageReadResponse>;
  createImage?: () => HTMLImageElement;
  createObjectUrl?: (blob: Blob) => string;
  revokeObjectUrl?: (url: string) => void;
}

export interface CanvasImageReconcileInput {
  contextKey: string | null;
  projectRoot: string | null;
  assets: readonly CanvasImageAssetSource[];
  /**
   * Runtime-only resources used by a previous complete visual. They remain
   * desired until the replacement visual commits; they are never Project data.
   */
  retainedAssets?: readonly CanvasImageAssetSource[];
}

function defaultReadCanvasImage(request: {
  projectRoot: string;
  assetId: string;
  sha256: string;
}): Promise<AssetCanvasImageReadResponse> {
  return window.pandaStage.assets.readCanvasImage(request);
}

/**
 * Owns decoded editor Canvas images across Project revisions. Reconciliation is
 * keyed by project context plus asset id/hash, so transform-only snapshots do
 * not restart image reads or decodes. A retained source is a second, explicit
 * runtime version in the same session rather than a second global image cache.
 */
export class CanvasImageResourceSession {
  private readonly readCanvasImage: NonNullable<
    CanvasImageResourceSessionOptions['readCanvasImage']
  >;
  private readonly createImage: () => HTMLImageElement;
  private readonly createObjectUrl: (blob: Blob) => string;
  private readonly revokeObjectUrl: (url: string) => void;
  private readonly resources = new Map<string, CanvasImageResource>();
  private readonly pending = new Map<string, PendingCanvasImageResource>();
  private readonly missing = new Set<string>();
  private desiredSources = new Map<string, CanvasImageAssetSource>();
  private currentSources = new Map<string, string | null>();
  private contextKey: string | null = null;
  private listener: ((state: CanvasImageState) => void) | null = null;
  private nextToken = 0;
  private disposed = false;

  constructor(options: CanvasImageResourceSessionOptions = {}) {
    this.readCanvasImage = options.readCanvasImage ?? defaultReadCanvasImage;
    this.createImage = options.createImage ?? (() => new window.Image());
    this.createObjectUrl =
      options.createObjectUrl ?? ((blob) => URL.createObjectURL(blob));
    this.revokeObjectUrl =
      options.revokeObjectUrl ?? ((url) => URL.revokeObjectURL(url));
  }

  reconcile(
    input: CanvasImageReconcileInput,
    listener: (state: CanvasImageState) => void,
  ): void {
    if (this.disposed) return;
    this.listener = listener;

    let stateChanged = false;
    if (input.contextKey !== this.contextKey) {
      this.releaseAll();
      this.contextKey = input.contextKey;
      stateChanged = true;
    }

    const currentSources = new Map<string, string | null>();
    for (const asset of input.assets) {
      currentSources.set(asset.id, asset.sha256 ?? null);
    }
    const desiredSources = new Map<string, CanvasImageAssetSource>();
    for (const asset of [
      ...input.assets,
      ...(input.retainedAssets ?? []),
    ]) {
      if (!asset.sha256) continue;
      desiredSources.set(
        canvasImageResourceKey(asset.id, asset.sha256),
        asset,
      );
    }
    const currentSourceChanged =
      this.currentSources.size !== currentSources.size ||
      [...currentSources].some(
        ([assetId, sourceKey]) =>
          this.currentSources.get(assetId) !== sourceKey,
      );
    this.currentSources = currentSources;
    this.desiredSources = desiredSources;

    for (const resourceKey of [
      ...new Set([
        ...this.resources.keys(),
        ...this.pending.keys(),
      ]),
    ]) {
      if (desiredSources.has(resourceKey)) continue;
      const resource = this.resources.get(resourceKey);
      // Preserve a loaded previous source while its replacement is pending;
      // the current image snapshot has historically exposed this safe visual.
      // Explicit continuity sources are already in desiredSources and remain
      // available even after a hard failure.
      const currentSourceKey = resource
        ? this.currentSources.get(resource.assetId)
        : undefined;
      const currentResource =
        resource && currentSourceKey
          ? this.resources.get(
              canvasImageResourceKey(resource.assetId, currentSourceKey),
            )
          : undefined;
      const replacementPending = Boolean(
        resource?.loaded &&
          currentSourceKey &&
          currentSourceKey !== resource.sourceKey &&
          !this.missing.has(resource.assetId) &&
          !currentResource?.loaded,
      );
      if (
        resource?.loaded &&
        replacementPending
      ) {
        continue;
      }
      stateChanged = this.cancelPending(resourceKey) || stateChanged;
      stateChanged = this.releaseActive(resourceKey) || stateChanged;
    }
    for (const assetId of [...this.missing]) {
      if (currentSources.has(assetId)) continue;
      this.missing.delete(assetId);
      stateChanged = true;
    }

    for (const asset of input.assets) {
      const sourceKey = asset.sha256;
      if (!sourceKey || !input.contextKey || !input.projectRoot) {
        if (!this.missing.has(asset.id)) {
          this.missing.add(asset.id);
          stateChanged = true;
        }
        continue;
      }

      stateChanged =
        this.ensureResource(input.projectRoot, asset.id, sourceKey) ||
        stateChanged;
      stateChanged = this.missing.delete(asset.id) || stateChanged;
    }

    if (input.contextKey && input.projectRoot) {
      for (const asset of input.retainedAssets ?? []) {
        if (!asset.sha256) continue;
        stateChanged =
          this.ensureResource(input.projectRoot, asset.id, asset.sha256) ||
          stateChanged;
      }
    }

    stateChanged = currentSourceChanged || stateChanged;
    if (stateChanged) this.emit();
  }

  getSnapshot(): CanvasImageState {
    const images = new Map<string, HTMLImageElement>();
    const sourceKeys = new Map<string, string>();
    const imagesByResourceKey = new Map<string, HTMLImageElement>();
    const readyResourceKeys = new Set<string>();
    for (const [resourceKey, resource] of this.resources) {
      if (!resource.loaded || resource.disposed) continue;
      imagesByResourceKey.set(resourceKey, resource.image);
      readyResourceKeys.add(resourceKey);
      if (
        this.currentSources.get(resource.assetId) === resource.sourceKey ||
        !images.has(resource.assetId)
      ) {
        images.set(resource.assetId, resource.image);
        sourceKeys.set(resource.assetId, resource.sourceKey);
      }
    }
    return {
      images,
      sourceKeys,
      imagesByResourceKey,
      readyResourceKeys,
      missing: new Set(
        [...this.missing].filter((assetId) =>
          this.currentSources.has(assetId),
        ),
      ),
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.listener = null;
    this.desiredSources.clear();
    this.releaseAll();
  }

  private ensureResource(
    projectRoot: string,
    assetId: string,
    sourceKey: string,
  ): boolean {
    const resourceKey = canvasImageResourceKey(assetId, sourceKey);
    const active = this.resources.get(resourceKey);
    if (active && !active.disposed) return false;
    const pending = this.pending.get(resourceKey);
    if (pending?.sourceKey === sourceKey) return false;
    this.cancelPending(resourceKey);
    const token = ++this.nextToken;
    this.pending.set(resourceKey, { token, assetId, sourceKey });

    void Promise.resolve()
      .then(() =>
        this.readCanvasImage({
          projectRoot,
          assetId,
          sha256: sourceKey,
        }),
      )
      .then((response) => {
        if (!this.isCurrent(resourceKey, assetId, sourceKey, token)) return;
        if (!response.ok || response.status !== 'ready') {
          this.failCurrentLoad(resourceKey, assetId, sourceKey, token);
          return;
        }

        let objectUrl: string;
        try {
          objectUrl = this.createObjectUrl(
            new Blob([response.bytes], { type: response.mimeType }),
          );
        } catch {
          this.failCurrentLoad(resourceKey, assetId, sourceKey, token);
          return;
        }
        if (!this.isCurrent(resourceKey, assetId, sourceKey, token)) {
          this.revokeObjectUrl(objectUrl);
          return;
        }

        let image: HTMLImageElement;
        try {
          image = this.createImage();
        } catch {
          this.revokeObjectUrl(objectUrl);
          this.failCurrentLoad(resourceKey, assetId, sourceKey, token);
          return;
        }
        const resource: CanvasImageResource = {
          assetId,
          image,
          objectUrl,
          sourceKey,
          loaded: false,
          disposed: false,
        };
        const pending = this.pending.get(resourceKey);
        if (!pending || pending.token !== token) {
          this.disposeResource(resource);
          return;
        }
        pending.resource = resource;

        image.onload = () => {
          resource.loaded = true;
          if (!this.isCurrent(resourceKey, assetId, sourceKey, token)) {
            this.disposeResource(resource);
            return;
          }
          image.onload = null;
          image.onerror = null;
          this.pending.delete(resourceKey);
          this.resources.set(resourceKey, resource);
          this.releaseSupersededResources(assetId, sourceKey);
          if (this.currentSources.get(assetId) === sourceKey) {
            this.missing.delete(assetId);
          }
          this.emit();
        };
        image.onerror = () => {
          if (!this.isCurrent(resourceKey, assetId, sourceKey, token)) {
            this.disposeResource(resource);
            return;
          }
          this.pending.delete(resourceKey);
          this.disposeResource(resource);
          this.releaseActive(resourceKey);
          if (this.currentSources.get(assetId) === sourceKey) {
            this.releaseSupersededResources(assetId, sourceKey);
            this.missing.add(assetId);
          }
          this.emit();
        };
        image.src = objectUrl;
      })
      .catch(() => {
        this.failCurrentLoad(resourceKey, assetId, sourceKey, token);
      });
    return true;
  }

  private failCurrentLoad(
    resourceKey: string,
    assetId: string,
    sourceKey: string,
    token: number,
  ): void {
    if (!this.isCurrent(resourceKey, assetId, sourceKey, token)) return;
    const pending = this.pending.get(resourceKey);
    this.pending.delete(resourceKey);
    if (pending?.resource) this.disposeResource(pending.resource);
    this.releaseActive(resourceKey);
    if (this.currentSources.get(assetId) === sourceKey) {
      this.releaseSupersededResources(assetId, sourceKey);
      this.missing.add(assetId);
    }
    this.emit();
  }

  private isCurrent(
    resourceKey: string,
    assetId: string,
    sourceKey: string,
    token: number,
  ): boolean {
    if (
      this.disposed ||
      this.desiredSources.get(resourceKey)?.id !== assetId ||
      this.desiredSources.get(resourceKey)?.sha256 !== sourceKey
    ) {
      return false;
    }
    const pending = this.pending.get(resourceKey);
    return pending?.token === token && pending.sourceKey === sourceKey;
  }

  private cancelPending(resourceKey: string): boolean {
    const pending = this.pending.get(resourceKey);
    if (!pending) return false;
    this.pending.delete(resourceKey);
    if (pending.resource) this.disposeResource(pending.resource);
    return true;
  }

  private releaseActive(resourceKey: string): boolean {
    const resource = this.resources.get(resourceKey);
    if (!resource) return false;
    this.resources.delete(resourceKey);
    this.disposeResource(resource);
    return true;
  }

  private releaseSupersededResources(
    assetId: string,
    currentSourceKey: string,
  ): void {
    for (const [resourceKey, resource] of this.resources) {
      if (
        resource.assetId !== assetId ||
        resource.sourceKey === currentSourceKey ||
        this.desiredSources.has(resourceKey)
      ) {
        continue;
      }
      this.releaseActive(resourceKey);
    }
  }

  private releaseAll(): void {
    for (const resourceKey of [...this.pending.keys()]) {
      this.cancelPending(resourceKey);
    }
    for (const resourceKey of [...this.resources.keys()]) {
      this.releaseActive(resourceKey);
    }
    this.missing.clear();
  }

  private disposeResource(resource: CanvasImageResource): void {
    if (resource.disposed) return;
    resource.disposed = true;
    resource.image.onload = null;
    resource.image.onerror = null;
    if (!resource.loaded) resource.image.src = '';
    this.revokeObjectUrl(resource.objectUrl);
  }

  private emit(): void {
    this.listener?.(this.getSnapshot());
  }
}
