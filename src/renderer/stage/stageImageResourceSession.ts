export interface StageImageLayerSource {
  id: string;
  assetId?: string;
  projectId?: string;
  sha256?: string;
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
  optionalFailures: readonly StageOptionalImageResourceFailure[];
}

export interface StageOptionalImageResourceFailure {
  assetId: string;
  sourceUrl: string;
  reason: StageImageResourceFailureReason;
  error: Error;
}

export interface StageImageResourceSessionDiagnostics {
  imageCreations: number;
  cacheHits: number;
  prewarmQueuePeak: number;
  prewarmInFlightPeak: number;
  prewarmQueuedCount: number;
  prewarmInFlightCount: number;
  optionalFailureCount: number;
  retainedEntries: number;
  retainedBytes: number;
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
  optionalFailures: [],
};

interface StageImageResource {
  image: HTMLImageElement;
  resourceKey: string;
  sourceUrl: string;
  loaded: boolean;
  disposed: boolean;
  decodedBytes: number;
}

interface PendingStageImageResource {
  resourceKey: string;
  sourceUrl: string;
  assetId: string;
  resource?: StageImageResource;
}

interface FailedStageImageResource {
  resourceKey: string;
  assetId: string;
  sourceUrl: string;
  reason: StageImageResourceFailureReason;
  error: Error;
}

interface QueuedStageImageResource {
  source: StageImageLayerSource & { resourceKey: string };
  sequence: number;
}

export interface StageImageResourceSessionOptions {
  createImage?: () => HTMLImageElement;
}

/** Extra decoded replacements retained by one mounted Stage (active images are separate). */
export const MAX_RETAINED_STAGE_SOURCES = 64;
/** Estimated RGBA image bytes, not a process-wide or GPU memory limit. */
export const MAX_RETAINED_STAGE_BYTES = 64 * 1024 * 1024;
/** Speculative decodes stay small; exact current resources are handled separately. */
export const MAX_QUEUED_STAGE_PREWARM_SOURCES = 64;
export const MAX_IN_FLIGHT_STAGE_PREWARM_DECODES = 2;

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

const TRUSTED_SHA256 = /^[a-f0-9]{64}$/u;

/**
 * A Stage-local cache identity. Missing or invalid content versions stay
 * part-scoped, so an unverified URL can never alias another layer's image.
 */
export function buildStageImageResourceKey(
  layer: StageImageLayerSource,
): string {
  if (
    layer.projectId &&
    layer.assetId &&
    layer.sha256 &&
    TRUSTED_SHA256.test(layer.sha256)
  ) {
    return JSON.stringify([
      'asset',
      layer.projectId,
      layer.assetId,
      layer.sha256,
      layer.sourceUrl,
    ]);
  }
  return JSON.stringify([
    'part',
    layer.projectId ?? null,
    layer.id,
    layer.assetId ?? null,
    layer.sourceUrl,
  ]);
}

export function buildStageImageSourceKey(
  layers: readonly StageImageLayerSource[],
): string {
  const sources = new Map(
    layers.map((layer) => [layer.id, buildStageImageResourceKey(layer)] as const),
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
  private readonly inFlight = new Map<string, StageImageResource>();
  private readonly failed = new Map<string, FailedStageImageResource>();
  private readonly optionalFailed = new Map<string, FailedStageImageResource>();
  private readonly prewarmQueue = new Map<string, QueuedStageImageResource>();
  private readonly prewarmInFlight = new Set<string>();
  private desiredPrewarmKeys = new Set<string>();
  private desiredPrewarmSources = new Map<
    string,
    StageImageLayerSource & { resourceKey: string }
  >();
  private retainedBytes = 0;
  private nextPrewarmSequence = 0;
  private imageCreations = 0;
  private cacheHits = 0;
  private prewarmQueuePeak = 0;
  private prewarmInFlightPeak = 0;
  private pumpingPrewarmQueue = false;
  private desiredSources = new Map<string, StageImageLayerSource & { resourceKey: string }>();
  private desiredSourceKey = '[]';
  private listener: ((state: StageImageResourceState) => void) | null = null;
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
      layers.map((layer) => [
        layer.id,
        { ...layer, resourceKey: buildStageImageResourceKey(layer) },
      ] as const),
    );
    const desiredResourceKeys = new Map(
      [...desiredSources].map(([partId, source]) => [partId, source.resourceKey]),
    );
    const currentResourceKeys = new Map(
      [...this.desiredSources].map(([partId, source]) => [partId, source.resourceKey]),
    );
    const nextSourceKey = sourceKey(desiredResourceKeys);
    const desiredChanged = !mapsEqual(currentResourceKeys, desiredResourceKeys);
    this.desiredSources = desiredSources;
    this.desiredSourceKey = nextSourceKey;

    for (const [layerId, failure] of this.failed) {
      if (desiredSources.get(layerId)?.resourceKey !== failure.resourceKey) {
        this.failed.delete(layerId);
      }
    }

    for (const [layerId, pending] of this.pending) {
      if (desiredSources.get(layerId)?.resourceKey === pending.resourceKey) continue;
      this.pending.delete(layerId);
    }

    for (const [layerId, source] of desiredSources) {
      const active = this.resources.get(layerId);
      if (active?.resourceKey === source.resourceKey && !active.disposed) {
        this.pending.delete(layerId);
        this.failed.delete(layerId);
        continue;
      }

      const pending = this.pending.get(layerId);
      if (pending?.resourceKey === source.resourceKey) continue;

      const failure = this.failed.get(layerId);
      if (failure?.resourceKey === source.resourceKey) continue;

      this.pending.delete(layerId);
      this.failed.delete(layerId);
      this.optionalFailed.delete(source.resourceKey);
      this.prewarmQueue.delete(source.resourceKey);
      const reused =
        this.findActiveResource(source.resourceKey) ??
        this.findPendingResource(source.resourceKey) ??
        this.inFlight.get(source.resourceKey) ??
        this.takeRetained(source.resourceKey);
      if (reused) {
        this.cacheHits += 1;
        this.prewarmInFlight.delete(source.resourceKey);
        this.pending.set(layerId, {
          resourceKey: source.resourceKey,
          sourceUrl: source.sourceUrl,
          assetId: source.assetId ?? layerId,
          resource: reused,
        });
        continue;
      }
      this.startLoad(source);
    }

    for (const [resourceKey] of this.prewarmQueue) {
      if (this.isDesiredResource(resourceKey)) {
        this.prewarmQueue.delete(resourceKey);
      }
    }
    this.cleanupOrphanedResources();
    this.pumpPrewarmQueue();

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
      desiredSourceUrls: new Map(
        [...this.desiredSources].map(([partId, source]) => [partId, source.sourceUrl]),
      ),
      desiredSourceKey: this.desiredSourceKey,
      ready: this.isDesiredFrameReady(),
      error: this.currentError(),
      failures: this.currentFailures(),
      optionalFailures: [...this.optionalFailed.entries()].flatMap(
        ([resourceKey, failure]) =>
          this.desiredPrewarmKeys.has(resourceKey)
            ? [{
                assetId: failure.assetId,
                sourceUrl: failure.sourceUrl,
                reason: failure.reason,
                error: failure.error,
              }]
            : [],
      ),
    };
  }

  getDiagnostics(): StageImageResourceSessionDiagnostics {
    return {
      imageCreations: this.imageCreations,
      cacheHits: this.cacheHits,
      prewarmQueuePeak: this.prewarmQueuePeak,
      prewarmInFlightPeak: this.prewarmInFlightPeak,
      prewarmQueuedCount: this.prewarmQueue.size,
      prewarmInFlightCount: this.prewarmInFlight.size,
      optionalFailureCount: this.optionalFailed.size,
      retainedEntries: this.retained.size,
      retainedBytes: this.retainedBytes,
    };
  }

  /**
   * Decode upcoming sources into this Stage session's bounded retained pool.
   * A later required part with the same source identity adopts the decoded
   * resource instead of creating another HTMLImageElement.
   */
  prewarm(sources: readonly StageImageLayerSource[]): void {
    if (this.disposed) return;

    const nextSources = new Map<
      string,
      StageImageLayerSource & { resourceKey: string }
    >();
    for (const source of sources) {
      const resourceKey = buildStageImageResourceKey(source);
      if (nextSources.has(resourceKey)) continue;
      nextSources.set(resourceKey, { ...source, resourceKey });
    }
    this.desiredPrewarmSources = nextSources;
    this.desiredPrewarmKeys = new Set(nextSources.keys());

    for (const resourceKey of this.optionalFailed.keys()) {
      if (!this.desiredPrewarmKeys.has(resourceKey)) {
        this.optionalFailed.delete(resourceKey);
      }
    }
    for (const [resourceKey] of this.prewarmQueue) {
      if (!this.desiredPrewarmKeys.has(resourceKey) || this.isDesiredResource(resourceKey)) {
        this.prewarmQueue.delete(resourceKey);
      }
    }

    for (const [resourceKey, source] of nextSources) {
      if (this.isDesiredResource(resourceKey) || this.optionalFailed.has(resourceKey)) {
        continue;
      }
      if (
        this.findActiveResource(resourceKey) ||
        this.findPendingResource(resourceKey) ||
        this.inFlight.has(resourceKey) ||
        this.retained.has(resourceKey)
      ) {
        this.cacheHits += 1;
        continue;
      }
      if (this.prewarmQueue.has(resourceKey)) continue;
      if (this.prewarmQueue.size >= MAX_QUEUED_STAGE_PREWARM_SOURCES) continue;
      this.prewarmQueue.set(resourceKey, {
        source,
        sequence: ++this.nextPrewarmSequence,
      });
      this.prewarmQueuePeak = Math.max(
        this.prewarmQueuePeak,
        this.prewarmQueue.size,
      );
    }

    this.cleanupOrphanedResources();
    this.pumpPrewarmQueue();
    this.emit();
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
    this.optionalFailed.clear();
    this.prewarmQueue.clear();
    this.prewarmInFlight.clear();
    this.desiredPrewarmKeys.clear();
    this.desiredPrewarmSources.clear();
    const ownedResources = new Set<StageImageResource>([
      ...this.resources.values(),
      ...[...this.pending.values()].flatMap((pending) =>
        pending.resource ? [pending.resource] : [],
      ),
      ...this.inFlight.values(),
      ...this.retained.values(),
    ]);
    this.resources.clear();
    this.pending.clear();
    this.inFlight.clear();
    this.retained.clear();
    this.retainedBytes = 0;
    for (const resource of ownedResources) {
      this.disposeResource(resource);
    }
  }

  private startLoad(source: StageImageLayerSource & { resourceKey: string }): void {
    let image: HTMLImageElement;
    try {
      image = this.createImage();
    } catch (error) {
      this.failResource(
        source.resourceKey,
        'image-create',
        error instanceof Error
          ? error
          : new Error('Stage image could not be created.'),
      );
      return;
    }

    const resource: StageImageResource = {
      image,
      resourceKey: source.resourceKey,
      sourceUrl: source.sourceUrl,
      loaded: false,
      disposed: false,
      decodedBytes: Number.POSITIVE_INFINITY,
    };
    this.inFlight.set(source.resourceKey, resource);
    this.imageCreations += 1;
    for (const [partId, desired] of this.desiredSources) {
      if (desired.resourceKey === source.resourceKey) {
        this.pending.set(partId, {
          resourceKey: source.resourceKey,
          sourceUrl: desired.sourceUrl,
          assetId: desired.assetId ?? partId,
          resource,
        });
      }
    }

    image.onload = () => {
      if (this.disposed || this.inFlight.get(source.resourceKey) !== resource) return;
      resource.loaded = true;
      resource.decodedBytes = estimateDecodedImageBytes(image);
      image.onload = null;
      image.onerror = null;
      this.inFlight.delete(source.resourceKey);
      this.prewarmInFlight.delete(source.resourceKey);
      if (this.hasPendingResource(resource)) {
        this.tryCommit();
      } else if (this.desiredPrewarmKeys.has(source.resourceKey)) {
        this.retainResource(resource);
      } else {
        this.disposeResource(resource);
      }
      this.pumpPrewarmQueue();
      this.emit();
    };
    image.onerror = () => {
      this.failResource(
        source.resourceKey,
        'decode',
        new Error(`Stage image failed to load: ${source.sourceUrl}`),
      );
    };

    try {
      image.src = source.sourceUrl;
    } catch (error) {
      this.failResource(
        source.resourceKey,
        'source-assignment',
        error instanceof Error
          ? error
          : new Error(`Stage image failed to load: ${source.sourceUrl}`),
      );
    }
  }

  private failResource(
    resourceKey: string,
    reason: StageImageResourceFailureReason,
    error: Error,
  ): void {
    const resource = this.inFlight.get(resourceKey);
    this.inFlight.delete(resourceKey);
    this.prewarmInFlight.delete(resourceKey);
    this.prewarmQueue.delete(resourceKey);
    let hasDesiredPart = false;
    for (const [partId, source] of this.desiredSources) {
      if (source.resourceKey !== resourceKey) continue;
      hasDesiredPart = true;
      this.pending.delete(partId);
      this.failed.set(partId, {
        resourceKey,
        assetId: source.assetId ?? partId,
        sourceUrl: source.sourceUrl,
        reason,
        error,
      });
    }
    if (!hasDesiredPart) {
      const source = this.desiredPrewarmSources.get(resourceKey);
      if (source) {
        this.optionalFailed.set(resourceKey, {
          resourceKey,
          assetId: source.assetId ?? source.id,
          sourceUrl: source.sourceUrl,
          reason,
          error,
        });
      }
    }
    if (resource) this.disposeResource(resource);
    this.pumpPrewarmQueue();
    this.emit();
  }

  private tryCommit(): void {
    const nextResources = new Map<string, StageImageResource>();
    for (const [layerId, source] of this.desiredSources) {
      const active = this.resources.get(layerId);
      if (active?.resourceKey === source.resourceKey && !active.disposed) {
        nextResources.set(layerId, active);
        continue;
      }

      const pending = this.pending.get(layerId);
      if (
        !pending ||
        pending.resourceKey !== source.resourceKey ||
        !pending.resource?.loaded
      ) {
        return;
      }
      nextResources.set(layerId, pending.resource);
    }

    const nextUniqueResources = new Set(nextResources.values());
    for (const resource of new Set(this.resources.values())) {
      if (!nextUniqueResources.has(resource)) this.retainResource(resource);
    }

    this.pending.clear();

    this.resources.clear();
    for (const [layerId, resource] of nextResources) {
      this.resources.set(layerId, resource);
    }
    this.failed.clear();
    this.cleanupOrphanedResources();
  }

  private isDesiredFrameReady(): boolean {
    for (const [layerId, source] of this.desiredSources) {
      if (this.resources.get(layerId)?.resourceKey !== source.resourceKey) return false;
    }
    return true;
  }

  private currentError(): Error | null {
    for (const [layerId, failure] of this.failed) {
      if (this.desiredSources.get(layerId)?.resourceKey === failure.resourceKey) {
        return failure.error;
      }
    }
    return null;
  }

  private currentFailures(): StageImageResourceFailure[] {
    return [...this.failed.entries()].flatMap(([partId, failure]) =>
      this.desiredSources.get(partId)?.resourceKey === failure.resourceKey
        ? [{
            partId,
            assetId: failure.assetId,
            sourceUrl: failure.sourceUrl,
            reason: failure.reason,
            error: failure.error,
          }]
        : [],
    );
  }

  private findActiveResource(resourceKey: string): StageImageResource | null {
    for (const resource of this.resources.values()) {
      if (resource.resourceKey === resourceKey && !resource.disposed) return resource;
    }
    return null;
  }

  private isDesiredResource(resourceKey: string): boolean {
    return [...this.desiredSources.values()].some(
      (source) => source.resourceKey === resourceKey,
    );
  }

  private hasPendingResource(resource: StageImageResource): boolean {
    return [...this.pending.values()].some(
      (pending) => pending.resource === resource,
    );
  }

  private findPendingResource(resourceKey: string): StageImageResource | null {
    for (const pending of this.pending.values()) {
      if (pending.resourceKey === resourceKey && pending.resource && !pending.resource.disposed) {
        return pending.resource;
      }
    }
    return null;
  }

  private takeRetained(resourceKey: string): StageImageResource | null {
    return this.removeRetained(resourceKey);
  }

  private pumpPrewarmQueue(): void {
    if (this.disposed || this.pumpingPrewarmQueue) return;
    this.pumpingPrewarmQueue = true;
    try {
      while (
        !this.disposed &&
        this.prewarmInFlight.size < MAX_IN_FLIGHT_STAGE_PREWARM_DECODES
      ) {
        const next = [...this.prewarmQueue.entries()].sort(
          ([, left], [, right]) => left.sequence - right.sequence,
        )[0];
        if (!next) return;
        const [resourceKey, queued] = next;
        this.prewarmQueue.delete(resourceKey);
        if (
          !this.desiredPrewarmKeys.has(resourceKey) ||
          this.isDesiredResource(resourceKey) ||
          this.optionalFailed.has(resourceKey)
        ) {
          continue;
        }
        if (
          this.findActiveResource(resourceKey) ||
          this.findPendingResource(resourceKey) ||
          this.inFlight.has(resourceKey) ||
          this.retained.has(resourceKey)
        ) {
          this.cacheHits += 1;
          continue;
        }
        this.prewarmInFlight.add(resourceKey);
        this.prewarmInFlightPeak = Math.max(
          this.prewarmInFlightPeak,
          this.prewarmInFlight.size,
        );
        this.startLoad(queued.source);
      }
    } finally {
      this.pumpingPrewarmQueue = false;
    }
  }

  private retainResource(resource: StageImageResource): void {
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
    const key = resource.resourceKey;
    const previous = this.retained.get(key);
    if (previous) {
      if (previous === resource) return;
      this.removeRetained(key);
      this.disposeResource(previous);
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

  private cleanupOrphanedResources(): void {
    for (const [resourceKey, resource] of this.inFlight) {
      const activeReference = [...this.resources.values()].includes(resource);
      const pendingReference = [...this.pending.values()].some(
        (pending) => pending.resource === resource,
      );
      if (
        activeReference ||
        pendingReference ||
        this.desiredPrewarmKeys.has(resourceKey)
      ) continue;

      this.inFlight.delete(resourceKey);
      this.prewarmInFlight.delete(resourceKey);
      if (resource.loaded) this.retainResource(resource);
      else this.disposeResource(resource);
    }
  }

  private emit(): void {
    this.listener?.(this.getSnapshot());
  }
}
