import {
  buildEditorStageRenderModel,
  resolveLayerImageAsset,
  type Project,
  type Shot,
} from '../../../domain';

export const SHOT_THUMBNAIL_MAX_EDGE = 256;
export const SHOT_THUMBNAIL_MAX_CONCURRENT_RENDERS = 1;

export type ShotThumbnailResult =
  | {
      status: 'empty';
      fingerprint: string;
    }
  | {
      status: 'ready';
      dataUrl: string;
      fingerprint: string;
    }
  | {
      status: 'missing' | 'error';
      fingerprint: string;
      message: string;
    };

export interface ShotThumbnailRequest {
  projectRoot: string;
  project: Project;
  shot: Shot;
}

/**
 * The thumbnail key intentionally excludes shot name, duration, dialogue,
 * subtitle, and audio fields. Only inputs that change the base composition
 * participate, so unrelated editor revisions do not rebuild every thumbnail.
 */
export function shotThumbnailFingerprint(
  project: Project,
  shot: Shot,
): string {
  return JSON.stringify({
    version: 1,
    project: {
      id: project.id,
      width: project.width,
      height: project.height,
    },
    shot: {
      id: shot.id,
      backgroundLayerId: shot.backgroundLayerId,
      layers: shot.layers.map((layer) => {
        const asset = resolveLayerImageAsset(project, layer);
        return {
          id: layer.id,
          source: layer.source,
          asset: asset
            ? {
                id: asset.id,
                sha256: asset.sha256 ?? null,
                relativePath: asset.relativePath,
                width: asset.width,
                height: asset.height,
              }
            : null,
          x: layer.x,
          y: layer.y,
          scaleX: layer.scaleX,
          scaleY: layer.scaleY,
          flipX: layer.flipX,
          rotationDeg: layer.rotationDeg,
          opacity: layer.opacity,
          visible: layer.visible,
          zIndex: layer.zIndex,
        };
      }),
    },
  });
}

class ShotThumbnailSourceError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ShotThumbnailSourceError';
  }
}

type ThumbnailQueueJob = {
  run: () => Promise<void>;
};

const thumbnailQueue: ThumbnailQueueJob[] = [];
let activeThumbnailRenders = 0;

function drainThumbnailQueue(): void {
  while (
    activeThumbnailRenders < SHOT_THUMBNAIL_MAX_CONCURRENT_RENDERS &&
    thumbnailQueue.length > 0
  ) {
    const job = thumbnailQueue.shift()!;
    activeThumbnailRenders += 1;
    void job.run().then(
      () => {
        activeThumbnailRenders -= 1;
        drainThumbnailQueue();
      },
      () => {
        activeThumbnailRenders -= 1;
        drainThumbnailQueue();
      },
    );
  }
}

function enqueueThumbnailRender<T>(work: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    thumbnailQueue.push({
      run: async () => {
        try {
          resolve(await work());
        } catch (error) {
          reject(error);
        }
      },
    });
    drainThumbnailQueue();
  });
}

const readyThumbnails = new Map<string, string>();
const inFlightThumbnails = new Map<string, Promise<ShotThumbnailResult>>();
const readyAssetDataUrls = new Map<string, string>();
const inFlightAssetDataUrls = new Map<string, Promise<string>>();

function scopedKey(projectRoot: string, value: string): string {
  return `${projectRoot}\u0000${value}`;
}

function safeMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/gu, ' ').trim().slice(0, 300) || fallback;
}

async function readAssetThumbnail(
  projectRoot: string,
  asset: {
    id: string;
    name: string;
    sha256?: string;
  },
): Promise<string> {
  const key = scopedKey(
    projectRoot,
    `${asset.id}\u0000${asset.sha256 ?? ''}`,
  );
  const cached = readyAssetDataUrls.get(key);
  if (cached) return cached;
  const existing = inFlightAssetDataUrls.get(key);
  if (existing) return existing;

  const request = (async () => {
    if (typeof window === 'undefined' || !window.pandaStage?.assets) {
      throw new Error('Panda Stage asset thumbnail API is unavailable.');
    }
    const response = await window.pandaStage.assets.readThumbnail({
      projectRoot,
      assetId: asset.id,
      sha256: asset.sha256,
    });
    if (response.ok && response.status === 'ready') return response.dataUrl;
    const message = response.ok
      ? `Asset thumbnail is unavailable for “${asset.name}”.`
      : response.error.message;
    throw new ShotThumbnailSourceError(message);
  })();
  const shared = request.then(
    (dataUrl) => {
      readyAssetDataUrls.set(key, dataUrl);
      inFlightAssetDataUrls.delete(key);
      return dataUrl;
    },
    (error: unknown) => {
      inFlightAssetDataUrls.delete(key);
      throw error;
    },
  );
  inFlightAssetDataUrls.set(key, shared);
  return shared;
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    if (typeof window === 'undefined' || typeof window.Image !== 'function') {
      reject(new Error('Browser image loading is unavailable.'));
      return;
    }
    const image = new window.Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Asset thumbnail image failed to load.'));
    image.src = dataUrl;
  });
}

export async function createShotThumbnailDataUrl(
  input: ShotThumbnailRequest,
): Promise<string> {
  let model;
  try {
    model = buildEditorStageRenderModel(input.project, input.shot);
  } catch (error) {
    throw new ShotThumbnailSourceError(
      safeMessage(error, 'Shot visual source is unavailable.'),
      { cause: error },
    );
  }
  if (model.layers.length === 0) {
    throw new ShotThumbnailSourceError('Shot has no visual layers.');
  }

  const assets = [
    ...new Map(model.layers.map(({ asset }) => [asset.id, asset])).values(),
  ];
  const imageEntries = await Promise.all(
    assets.map(async (asset) => {
      try {
        const dataUrl = await readAssetThumbnail(input.projectRoot, asset);
        return [asset.id, await loadImage(dataUrl)] as const;
      } catch (error) {
        throw new ShotThumbnailSourceError(
          safeMessage(
            error,
            `Unable to load the thumbnail for “${asset.name}”.`,
          ),
          { cause: error },
        );
      }
    }),
  );

  if (typeof document === 'undefined') {
    throw new Error('Shot thumbnail canvas is unavailable.');
  }
  const canvas = document.createElement('canvas');
  const scale = Math.min(
    SHOT_THUMBNAIL_MAX_EDGE / model.width,
    SHOT_THUMBNAIL_MAX_EDGE / model.height,
  );
  canvas.width = Math.max(1, Math.round(model.width * scale));
  canvas.height = Math.max(1, Math.round(model.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Shot thumbnail canvas context is unavailable.');

  context.fillStyle = '#111914';
  context.fillRect(0, 0, canvas.width, canvas.height);
  const images = new Map(imageEntries);
  for (const { render, asset } of model.layers) {
    if (!render.visible) continue;
    const image = images.get(asset.id);
    if (!image) {
      throw new ShotThumbnailSourceError(
        `Unable to resolve the thumbnail for “${asset.name}”.`,
      );
    }
    context.save();
    context.translate(render.x * scale, render.y * scale);
    context.rotate((render.rotationDeg * Math.PI) / 180);
    context.globalAlpha = render.opacity;
    context.scale(render.scaleX * scale, render.scaleY * scale);
    context.drawImage(
      image,
      -render.offsetX,
      -render.offsetY,
      render.width,
      render.height,
    );
    context.restore();
  }
  return canvas.toDataURL('image/png');
}

export function requestShotThumbnail(
  input: ShotThumbnailRequest,
): Promise<ShotThumbnailResult> {
  const fingerprint = shotThumbnailFingerprint(input.project, input.shot);
  if (input.shot.layers.length === 0) {
    return Promise.resolve({ status: 'empty', fingerprint });
  }

  const key = scopedKey(input.projectRoot, fingerprint);
  const cached = readyThumbnails.get(key);
  if (cached) {
    return Promise.resolve({ status: 'ready', dataUrl: cached, fingerprint });
  }
  const existing = inFlightThumbnails.get(key);
  if (existing) return existing;

  const request = enqueueThumbnailRender(() =>
    createShotThumbnailDataUrl(input),
  ).then(
    (dataUrl): ShotThumbnailResult => {
      readyThumbnails.set(key, dataUrl);
      inFlightThumbnails.delete(key);
      return { status: 'ready', dataUrl, fingerprint };
    },
    (error: unknown): ShotThumbnailResult => {
      inFlightThumbnails.delete(key);
      return {
        status: error instanceof ShotThumbnailSourceError ? 'missing' : 'error',
        fingerprint,
        message: safeMessage(error, 'Shot thumbnail generation failed.'),
      };
    },
  );
  inFlightThumbnails.set(key, request);
  return request;
}

