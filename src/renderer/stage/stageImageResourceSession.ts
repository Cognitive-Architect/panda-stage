export interface StageImageLayerSource {
  id: string;
  sourceUrl: string;
}

export interface StageImageResourceState {
  images: ReadonlyMap<string, HTMLImageElement>;
  sourceUrls: ReadonlyMap<string, string>;
  desiredSourceUrls: ReadonlyMap<string, string>;
  desiredSourceKey: string;
  ready: boolean;
  error: Error | null;
}

export const EMPTY_STAGE_IMAGE_RESOURCE_STATE: StageImageResourceState = {
  images: new Map(),
  sourceUrls: new Map(),
  desiredSourceUrls: new Map(),
  desiredSourceKey: '[]',
  ready: false,
  error: null,
};

interface StageImageResource {
  image: HTMLImageElement;
  sourceUrl: string;
  loaded: boolean;
  disposed: boolean;
}

interface PendingStageImageResource {
  token: number;
  sourceUrl: string;
  resource?: StageImageResource;
}

interface FailedStageImageResource {
  sourceUrl: string;
  error: Error;
}

export interface StageImageResourceSessionOptions {
  createImage?: () => HTMLImageElement;
}

function sourceKey(sources: ReadonlyMap<string, string>): string {
  return JSON.stringify(
    [...sources.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
}

export function buildStageImageSourceKey(
  layers: readonly StageImageLayerSource[],
): string {
  const sources = new Map(
    layers.map((layer) => [layer.id, layer.sourceUrl] as const),
  );
  return sourceKey(sources);
}

function mapsEqual(
  left: ReadonlyMap<string, string>,
  right: ReadonlyMap<string, string>,
): boolean {
  if (left.size !== right.size) return false;
  for (const [id, sourceUrl] of left) {
    if (right.get(id) !== sourceUrl) return false;
  }
  return true;
}

/**
 * Owns decoded Stage images across evaluated-frame changes.
 *
 * A source replacement is prepared in `pending` while the last complete
 * resource set remains in `resources`. Pending resources become visible only
 * when every source in the current desired frame is decoded, which gives
 * StageRenderer an atomic frame boundary without introducing a global cache or
 * a second playback owner.
 */
export class StageImageResourceSession {
  private readonly createImage: () => HTMLImageElement;
  private readonly resources = new Map<string, StageImageResource>();
  private readonly pending = new Map<string, PendingStageImageResource>();
  private readonly failed = new Map<string, FailedStageImageResource>();
  private desiredSources = new Map<string, string>();
  private desiredSourceKey = '[]';
  private listener: ((state: StageImageResourceState) => void) | null = null;
  private nextToken = 0;
  private disposed = false;

  constructor(options: StageImageResourceSessionOptions = {}) {
    this.createImage = options.createImage ?? (() => new window.Image());
  }

  reconcile(
    layers: readonly StageImageLayerSource[],
    listener: (state: StageImageResourceState) => void,
  ): void {
    if (this.disposed) return;
    this.listener = listener;

    const desiredSources = new Map(
      layers.map((layer) => [layer.id, layer.sourceUrl] as const),
    );
    const nextSourceKey = sourceKey(desiredSources);
    const desiredChanged = !mapsEqual(this.desiredSources, desiredSources);
    this.desiredSources = desiredSources;
    this.desiredSourceKey = nextSourceKey;

    for (const [layerId, failure] of this.failed) {
      if (desiredSources.get(layerId) !== failure.sourceUrl) {
        this.failed.delete(layerId);
      }
    }

    for (const [layerId, pending] of this.pending) {
      if (desiredSources.get(layerId) === pending.sourceUrl) continue;
      this.cancelPending(layerId);
    }

    for (const [layerId, sourceUrl] of desiredSources) {
      const active = this.resources.get(layerId);
      if (active?.sourceUrl === sourceUrl) {
        this.cancelPending(layerId);
        this.failed.delete(layerId);
        continue;
      }

      const pending = this.pending.get(layerId);
      if (pending?.sourceUrl === sourceUrl) continue;

      const failure = this.failed.get(layerId);
      if (failure?.sourceUrl === sourceUrl) continue;

      this.cancelPending(layerId);
      this.failed.delete(layerId);
      this.startLoad(layerId, sourceUrl);
    }

    // A reconcile with only transform/time changes does not need another
    // decode, but it still publishes the current exact readiness state.
    if (desiredChanged) this.tryCommit();
    this.emit();
  }

  getSnapshot(): StageImageResourceState {
    const images = new Map<string, HTMLImageElement>();
    const sourceUrls = new Map<string, string>();
    for (const [layerId, resource] of this.resources) {
      images.set(layerId, resource.image);
      sourceUrls.set(layerId, resource.sourceUrl);
    }

    return {
      images,
      sourceUrls,
      desiredSourceUrls: new Map(this.desiredSources),
      desiredSourceKey: this.desiredSourceKey,
      ready: this.isDesiredFrameReady(),
      error: this.currentError(),
    };
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.listener = null;
    this.desiredSources.clear();
    this.failed.clear();
    for (const layerId of [...this.pending.keys()]) {
      this.cancelPending(layerId);
    }
    for (const [layerId, resource] of this.resources) {
      this.resources.delete(layerId);
      this.disposeResource(resource);
    }
  }

  private startLoad(layerId: string, sourceUrl: string): void {
    const pending: PendingStageImageResource = {
      token: ++this.nextToken,
      sourceUrl,
    };
    this.pending.set(layerId, pending);

    let image: HTMLImageElement;
    try {
      image = this.createImage();
    } catch (error) {
      this.failCurrentLoad(
        layerId,
        sourceUrl,
        pending.token,
        error instanceof Error
          ? error
          : new Error('Stage image could not be created.'),
      );
      return;
    }

    const resource: StageImageResource = {
      image,
      sourceUrl,
      loaded: false,
      disposed: false,
    };
    pending.resource = resource;

    image.onload = () => {
      if (!this.isCurrent(layerId, sourceUrl, pending.token)) {
        this.disposeResource(resource);
        return;
      }
      resource.loaded = true;
      this.tryCommit();
      this.emit();
    };
    image.onerror = () => {
      this.failCurrentLoad(
        layerId,
        sourceUrl,
        pending.token,
        new Error(`Stage image failed to load: ${sourceUrl}`),
      );
    };

    try {
      image.src = sourceUrl;
    } catch (error) {
      this.failCurrentLoad(
        layerId,
        sourceUrl,
        pending.token,
        error instanceof Error
          ? error
          : new Error(`Stage image failed to load: ${sourceUrl}`),
      );
    }
  }

  private failCurrentLoad(
    layerId: string,
    sourceUrl: string,
    token: number,
    error: Error,
  ): void {
    if (!this.isCurrent(layerId, sourceUrl, token)) return;
    const pending = this.pending.get(layerId);
    this.pending.delete(layerId);
    if (pending?.resource) this.disposeResource(pending.resource);
    this.failed.set(layerId, { sourceUrl, error });
    this.emit();
  }

  private tryCommit(): void {
    const nextResources = new Map<string, StageImageResource>();
    for (const [layerId, sourceUrl] of this.desiredSources) {
      const active = this.resources.get(layerId);
      if (active?.sourceUrl === sourceUrl) {
        nextResources.set(layerId, active);
        continue;
      }

      const pending = this.pending.get(layerId);
      if (
        !pending ||
        pending.sourceUrl !== sourceUrl ||
        !pending.resource?.loaded
      ) {
        return;
      }
      nextResources.set(layerId, pending.resource);
    }

    for (const [layerId, resource] of this.resources) {
      if (nextResources.get(layerId) !== resource) {
        this.disposeResource(resource);
      }
    }

    for (const [layerId, pending] of this.pending) {
      if (nextResources.get(layerId) === pending.resource) {
        this.pending.delete(layerId);
      } else {
        this.cancelPending(layerId);
      }
    }

    this.resources.clear();
    for (const [layerId, resource] of nextResources) {
      this.resources.set(layerId, resource);
    }
    this.failed.clear();
  }

  private isDesiredFrameReady(): boolean {
    for (const [layerId, sourceUrl] of this.desiredSources) {
      if (this.resources.get(layerId)?.sourceUrl !== sourceUrl) return false;
    }
    return true;
  }

  private currentError(): Error | null {
    for (const [layerId, failure] of this.failed) {
      if (this.desiredSources.get(layerId) === failure.sourceUrl) {
        return failure.error;
      }
    }
    return null;
  }

  private isCurrent(
    layerId: string,
    sourceUrl: string,
    token: number,
  ): boolean {
    if (this.disposed || this.desiredSources.get(layerId) !== sourceUrl) {
      return false;
    }
    const pending = this.pending.get(layerId);
    return pending?.token === token && pending.sourceUrl === sourceUrl;
  }

  private cancelPending(layerId: string): void {
    const pending = this.pending.get(layerId);
    if (!pending) return;
    this.pending.delete(layerId);
    if (pending.resource) this.disposeResource(pending.resource);
  }

  private disposeResource(resource: StageImageResource): void {
    if (resource.disposed) return;
    resource.disposed = true;
    resource.image.onload = null;
    resource.image.onerror = null;
    if (!resource.loaded) resource.image.src = '';
  }

  private emit(): void {
    this.listener?.(this.getSnapshot());
  }
}
