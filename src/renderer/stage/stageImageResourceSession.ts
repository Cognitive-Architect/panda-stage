export interface StageImageLayerSource {
  id: string;
  assetId?: string;
  sourceUrl: string;
}

export type StageImageResourceFailureReason =
  | 'decode'
  | 'image-create'
  | 'source-assignment';

export interface StageImageResourceFailure {
  partId: string;
  assetId: string;
  sourceUrl: string;
  reason: StageImageResourceFailureReason;
  error: Error;
}

export interface StageImageResourceState {
  images: ReadonlyMap<string, HTMLImageElement>;
  sourceUrls: ReadonlyMap<string, string>;
  desiredSourceUrls: ReadonlyMap<string, string>;
  desiredSourceKey: string;
  ready: boolean;
  error: Error | null;
  failures: readonly StageImageResourceFailure[];
}

export interface StageFrameReadinessInput {
  hasModel: boolean;
  layerCount: number;
  error: Error | null;
  imageState: StageImageResourceState;
  sourceKey: string;
}

/**
 * A drawable committed fallback is deliberately not enough to announce the
 * current frame ready. Preview may keep drawing it, while Export must wait
 * for the exact desired source set before its onReady callback can capture.
 */
export function isStageFrameReady({
  hasModel,
  layerCount,
  error,
  imageState,
  sourceKey,
}: StageFrameReadinessInput): boolean {
  return (
    !error &&
    hasModel &&
    layerCount > 0 &&
    imageState.ready &&
    imageState.desiredSourceKey === sourceKey
  );
}

export const EMPTY_STAGE_IMAGE_RESOURCE_STATE: StageImageResourceState = {
  images: new Map(),
  sourceUrls: new Map(),
  desiredSourceUrls: new Map(),
  desiredSourceKey: '[]',
  ready: false,
  error: null,
  failures: [],
};

interface StageImageResource {
  image: HTMLImageElement;
  sourceUrl: string;
  loaded: boolean;
  disposed: boolean;
  decodedBytes: number;
}

interface PendingStageImageResource {
  token: number;
  sourceUrl: string;
  resource?: StageImageResource;
}

interface FailedStageImageResource {
  assetId: string;
  sourceUrl: string;
  reason: StageImageResourceFailureReason;
  error: Error;
}

export interface StageImageResourceSessionOptions {
  createImage?: () => HTMLImageElement;
}

/** Extra decoded replacements retained by one mounted Stage (active images are separate). */
export const MAX_RETAINED_STAGE_SOURCES = 64;
/** Estimated RGBA image bytes, not a process-wide or GPU memory limit. */
export const MAX_RETAINED_STAGE_BYTES = 64 * 1024 * 1024;

function estimateDecodedImageBytes(image: HTMLImageElement): number {
  const { naturalWidth: width, naturalHeight: height } = image;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return Number.POSITIVE_INFINITY;
  }

  const pixels = width * height;
  if (!Number.isSafeInteger(pixels) || pixels > Number.MAX_SAFE_INTEGER / 4) {
    return Number.POSITIVE_INFINITY;
  }
  return pixels * 4;
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
  private readonly retained = new Map<string, StageImageResource>();
  private readonly pending = new Map<string, PendingStageImageResource>();
  private readonly failed = new Map<string, FailedStageImageResource>();
  private retainedBytes = 0;
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
      const reused = this.takeRetained(layerId, sourceUrl);
      if (reused) {
        this.pending.set(layerId, {
          token: ++this.nextToken,
          sourceUrl,
          resource: reused,
        });
        continue;
      }
      const assetId = layers.find((layer) => layer.id === layerId)?.assetId ?? layerId;
      this.startLoad(layerId, sourceUrl, assetId);
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
      failures: this.currentFailures(),
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
    for (const resource of this.retained.values()) {
      this.disposeResource(resource);
    }
    this.retained.clear();
    this.retainedBytes = 0;
  }

  private startLoad(layerId: string, sourceUrl: string, assetId: string): void {
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
        assetId,
        'image-create',
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
      decodedBytes: Number.POSITIVE_INFINITY,
    };
    pending.resource = resource;

    image.onload = () => {
      if (!this.isCurrent(layerId, sourceUrl, pending.token)) {
        this.disposeResource(resource);
        return;
      }
      resource.loaded = true;
      resource.decodedBytes = estimateDecodedImageBytes(image);
      this.tryCommit();
      this.emit();
    };
    image.onerror = () => {
      this.failCurrentLoad(
        layerId,
        sourceUrl,
        pending.token,
        assetId,
        'decode',
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
        assetId,
        'source-assignment',
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
    assetId: string,
    reason: StageImageResourceFailureReason,
    error: Error,
  ): void {
    if (!this.isCurrent(layerId, sourceUrl, token)) return;
    const pending = this.pending.get(layerId);
    this.pending.delete(layerId);
    if (pending?.resource) this.disposeResource(pending.resource);
    this.failed.set(layerId, { assetId, sourceUrl, reason, error });
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
        this.retainResource(layerId, resource);
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

  private currentFailures(): StageImageResourceFailure[] {
    return [...this.failed.entries()].flatMap(([partId, failure]) =>
      this.desiredSources.get(partId) === failure.sourceUrl
        ? [{ partId, ...failure }]
        : [],
    );
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
    if (pending.resource) {
      if (pending.resource.loaded && !this.disposed) {
        this.retainResource(layerId, pending.resource);
      } else {
        this.disposeResource(pending.resource);
      }
    }
  }

  private retainedKey(layerId: string, sourceUrl: string): string {
    return `${layerId}\u0000${sourceUrl}`;
  }

  private takeRetained(layerId: string, sourceUrl: string): StageImageResource | null {
    const key = this.retainedKey(layerId, sourceUrl);
    const resource = this.retained.get(key) ?? null;
    if (resource) this.removeRetained(key);
    return resource;
  }

  private retainResource(layerId: string, resource: StageImageResource): void {
    if (
      this.disposed ||
      !resource.loaded ||
      !Number.isFinite(resource.decodedBytes) ||
      resource.decodedBytes < 0 ||
      resource.decodedBytes > MAX_RETAINED_STAGE_BYTES
    ) {
      this.disposeResource(resource);
      return;
    }
    resource.image.onload = null;
    resource.image.onerror = null;
    const key = this.retainedKey(layerId, resource.sourceUrl);
    const previous = this.retained.get(key);
    if (previous) {
      this.removeRetained(key);
      if (previous !== resource) this.disposeResource(previous);
    }

    while (
      this.retained.size + 1 > MAX_RETAINED_STAGE_SOURCES ||
      this.retainedBytes + resource.decodedBytes > MAX_RETAINED_STAGE_BYTES
    ) {
      if (!this.evictOldestRetained()) break;
    }

    if (
      this.retained.size + 1 > MAX_RETAINED_STAGE_SOURCES ||
      this.retainedBytes + resource.decodedBytes > MAX_RETAINED_STAGE_BYTES
    ) {
      this.disposeResource(resource);
      return;
    }

    this.retained.set(key, resource);
    this.retainedBytes += resource.decodedBytes;
  }

  private removeRetained(key: string): StageImageResource | null {
    const resource = this.retained.get(key);
    if (!resource) return null;
    this.retained.delete(key);
    this.retainedBytes -= resource.decodedBytes;
    return resource;
  }

  private evictOldestRetained(): boolean {
    const oldestKey = this.retained.keys().next().value;
    if (oldestKey === undefined) return false;
    const oldest = this.removeRetained(oldestKey);
    if (!oldest) return false;
    this.disposeResource(oldest);
    return true;
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
