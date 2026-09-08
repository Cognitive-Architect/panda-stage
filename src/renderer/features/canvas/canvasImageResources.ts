import type { AssetCanvasImageReadResponse } from '../../../shared/asset-canvas-image-api';

export interface CanvasImageAssetSource {
  id: string;
  sha256?: string;
}

export interface CanvasImageState {
  images: ReadonlyMap<string, HTMLImageElement>;
  sourceKeys: ReadonlyMap<string, string>;
  missing: ReadonlySet<string>;
}

export const EMPTY_CANVAS_IMAGE_STATE: CanvasImageState = {
  images: new Map(),
  sourceKeys: new Map(),
  missing: new Set(),
};

interface CanvasImageResource {
  image: HTMLImageElement;
  objectUrl: string;
  sourceKey: string;
  loaded: boolean;
  disposed: boolean;
}

interface PendingCanvasImageResource {
  token: number;
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
 * not restart image reads or decodes.
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
  private desiredSources = new Map<string, string | null>();
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

    const desiredSources = new Map<string, string | null>();
    for (const asset of input.assets) {
      desiredSources.set(asset.id, asset.sha256 ?? null);
    }
    this.desiredSources = desiredSources;

    for (const assetId of [
      ...new Set([
        ...this.resources.keys(),
        ...this.pending.keys(),
        ...this.missing,
      ]),
    ]) {
      if (desiredSources.has(assetId)) continue;
      stateChanged = this.cancelPending(assetId) || stateChanged;
      stateChanged = this.releaseActive(assetId) || stateChanged;
      stateChanged = this.missing.delete(assetId) || stateChanged;
    }

    for (const [assetId, sourceKey] of desiredSources) {
      if (!sourceKey || !input.contextKey || !input.projectRoot) {
        stateChanged = this.cancelPending(assetId) || stateChanged;
        stateChanged = this.releaseActive(assetId) || stateChanged;
        if (!this.missing.has(assetId)) {
          this.missing.add(assetId);
          stateChanged = true;
        }
        continue;
      }

      const active = this.resources.get(assetId);
      if (active?.sourceKey === sourceKey) {
        stateChanged = this.cancelPending(assetId) || stateChanged;
        stateChanged = this.missing.delete(assetId) || stateChanged;
        continue;
      }

      const pending = this.pending.get(assetId);
      if (pending?.sourceKey === sourceKey) {
        stateChanged = this.missing.delete(assetId) || stateChanged;
        continue;
      }

      stateChanged = this.cancelPending(assetId) || stateChanged;
      stateChanged = this.missing.delete(assetId) || stateChanged;
      this.startLoad(input.projectRoot, assetId, sourceKey);
    }

    if (stateChanged) this.emit();
  }

  getSnapshot(): CanvasImageState {
    const images = new Map<string, HTMLImageElement>();
    const sourceKeys = new Map<string, string>();
    for (const [assetId, resource] of this.resources) {
      if (!this.desiredSources.has(assetId)) continue;
      images.set(assetId, resource.image);
      sourceKeys.set(assetId, resource.sourceKey);
    }
    return {
      images,
      sourceKeys,
      missing: new Set(
        [...this.missing].filter((assetId) =>
          this.desiredSources.has(assetId),
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

  private startLoad(
    projectRoot: string,
    assetId: string,
    sourceKey: string,
  ): void {
    const token = ++this.nextToken;
    this.pending.set(assetId, { token, sourceKey });

    void Promise.resolve()
      .then(() =>
        this.readCanvasImage({
          projectRoot,
          assetId,
          sha256: sourceKey,
        }),
      )
      .then((response) => {
        if (!this.isCurrent(assetId, sourceKey, token)) return;
        if (!response.ok || response.status !== 'ready') {
          this.failCurrentLoad(assetId, sourceKey, token);
          return;
        }

        let objectUrl: string;
        try {
          objectUrl = this.createObjectUrl(
            new Blob([response.bytes], { type: response.mimeType }),
          );
        } catch {
          this.failCurrentLoad(assetId, sourceKey, token);
          return;
        }
        if (!this.isCurrent(assetId, sourceKey, token)) {
          this.revokeObjectUrl(objectUrl);
          return;
        }

        let image: HTMLImageElement;
        try {
          image = this.createImage();
        } catch {
          this.revokeObjectUrl(objectUrl);
          this.failCurrentLoad(assetId, sourceKey, token);
          return;
        }
        const resource: CanvasImageResource = {
          image,
          objectUrl,
          sourceKey,
          loaded: false,
          disposed: false,
        };
        const pending = this.pending.get(assetId);
        if (!pending || pending.token !== token) {
          this.disposeResource(resource);
          return;
        }
        pending.resource = resource;

        image.onload = () => {
          resource.loaded = true;
          if (!this.isCurrent(assetId, sourceKey, token)) {
            this.disposeResource(resource);
            return;
          }
          image.onload = null;
          image.onerror = null;
          this.pending.delete(assetId);
          const previous = this.resources.get(assetId);
          this.resources.set(assetId, resource);
          this.missing.delete(assetId);
          this.emit();
          if (previous && previous !== resource) {
            this.disposeResource(previous);
          }
        };
        image.onerror = () => {
          if (!this.isCurrent(assetId, sourceKey, token)) {
            this.disposeResource(resource);
            return;
          }
          this.pending.delete(assetId);
          this.disposeResource(resource);
          this.releaseActive(assetId);
          this.missing.add(assetId);
          this.emit();
        };
        image.src = objectUrl;
      })
      .catch(() => {
        this.failCurrentLoad(assetId, sourceKey, token);
      });
  }

  private failCurrentLoad(
    assetId: string,
    sourceKey: string,
    token: number,
  ): void {
    if (!this.isCurrent(assetId, sourceKey, token)) return;
    const pending = this.pending.get(assetId);
    this.pending.delete(assetId);
    if (pending?.resource) this.disposeResource(pending.resource);
    this.releaseActive(assetId);
    this.missing.add(assetId);
    this.emit();
  }

  private isCurrent(
    assetId: string,
    sourceKey: string,
    token: number,
  ): boolean {
    if (this.disposed || this.desiredSources.get(assetId) !== sourceKey) {
      return false;
    }
    const pending = this.pending.get(assetId);
    return pending?.token === token && pending.sourceKey === sourceKey;
  }

  private cancelPending(assetId: string): boolean {
    const pending = this.pending.get(assetId);
    if (!pending) return false;
    this.pending.delete(assetId);
    if (pending.resource) this.disposeResource(pending.resource);
    return true;
  }

  private releaseActive(assetId: string): boolean {
    const resource = this.resources.get(assetId);
    if (!resource) return false;
    this.resources.delete(assetId);
    this.disposeResource(resource);
    return true;
  }

  private releaseAll(): void {
    for (const assetId of [...this.pending.keys()]) {
      this.cancelPending(assetId);
    }
    for (const assetId of [...this.resources.keys()]) {
      this.releaseActive(assetId);
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
