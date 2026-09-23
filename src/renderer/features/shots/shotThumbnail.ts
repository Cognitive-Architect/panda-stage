import {
  buildEditorStageRenderModel,
  resolveImageAsset,
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

export interface ShotThumbnailRequestIdentity {
  projectRoot: string;
  fingerprint: string;
}

export function isShotThumbnailRequestCurrent(
  current: ShotThumbnailRequestIdentity | null,
  completed: ShotThumbnailRequestIdentity,
): boolean {
  return (
    current?.projectRoot === completed.projectRoot &&
    current.fingerprint === completed.fingerprint
  );
}

function assetContentFingerprint(project: Project, assetId: string) {
  const asset = resolveImageAsset(project, assetId);
  if (!asset) return { id: assetId, missing: true };
  return {
    id: asset.id,
    sha256: asset.sha256 ?? null,
    // Assets without a content hash cannot safely reuse a path-independent key.
    ...(asset.sha256 ? {} : { relativePath: asset.relativePath }),
  };
}

function unresolvedFingerprint(project: Project, shot: Shot): string {
  return JSON.stringify({
    version: 2,
    state: 'unresolved-visual',
    stage: { width: project.width, height: project.height },
    backgroundLayerId: shot.backgroundLayerId,
    layers: shot.layers.map((layer) => {
      const characterSource =
        layer.source.kind === 'character' ? layer.source : null;
      const character = characterSource
        ? project.characters.find(
            (candidate) => candidate.id === characterSource.characterId,
          )
        : undefined;
      const expression = characterSource
        ? character?.expressions.find(
            (candidate) => candidate.id === characterSource.expressionId,
          ) ??
          character?.expressions.find(
            (candidate) => candidate.id === character.defaultExpressionId,
          )
        : undefined;
      const assetIds =
        layer.source.kind === 'asset'
          ? [layer.source.assetId]
          : character?.mode === 'composite'
            ? [character.bodyAssetId, expression?.assetId].filter(
                (assetId): assetId is string => Boolean(assetId),
              )
            : expression?.assetId
              ? [expression.assetId]
              : [];
      return {
        kind:
          character?.mode === 'composite'
            ? 'composite-character'
            : character
              ? 'single-image-character'
              : layer.source.kind === 'asset'
                ? 'ordinary-image'
                : 'unresolved-character',
        assets: assetIds.map((assetId) =>
          assetContentFingerprint(project, assetId),
        ),
        facePlacement:
          character?.mode === 'composite' ? character.facePlacement : null,
        owner: {
          anchor: layer.anchor,
          x: layer.x,
          y: layer.y,
          scaleX: layer.scaleX,
          scaleY: layer.scaleY,
          flipX: layer.flipX,
          rotationDeg: layer.rotationDeg,
          opacity: layer.opacity,
          visible: layer.visible,
          zIndex: layer.zIndex,
        },
      };
    }),
  });
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
  try {
    const model = buildEditorStageRenderModel(project, shot);
    return JSON.stringify({
      version: 2,
      stage: { width: model.width, height: model.height },
      backgroundLayerId: model.backgroundLayerId,
      layers: model.layers.map(({ render, visual }) => ({
        kind: visual.kind,
        background: render.isBackground,
        owner: visual.ownerTransform,
        facePlacement: visual.facePlacement,
        parts: visual.parts.map((part) => ({
          slot: part.slot,
          asset: assetContentFingerprint(project, part.assetId),
          localRect: part.localRect,
          drawOrder: part.drawOrder,
        })),
      })),
    });
  } catch {
    // Keep malformed or temporarily unresolvable project snapshots on the
    // existing placeholder path instead of letting fingerprinting crash React.
    return unresolvedFingerprint(project, shot);
  }
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

  const assetsById = new Map(
    model.layers.flatMap(({ visual }) =>
      visual.parts.map((part) => {
        const asset = resolveImageAsset(input.project, part.assetId);
        if (!asset) {
          throw new ShotThumbnailSourceError(
            `Unable to resolve the thumbnail asset for visual part “${part.partId}”.`,
          );
        }
        return [asset.id, asset] as const;
      }),
    ),
  );
  for (const { visual } of model.layers) {
    if (
      visual.parts.length === 0 ||
      (visual.kind === 'composite-character' && visual.parts.length !== 2)
    ) {
      throw new ShotThumbnailSourceError(
        'Shot visual is incomplete; refusing to render a partial Character.',
      );
    }
  }
  const assets = [...assetsById.values()];
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

  const compositeCanvas = model.layers.some(
    ({ visual }) => visual.kind === 'composite-character',
  )
    ? document.createElement('canvas')
    : null;
  if (compositeCanvas) {
    compositeCanvas.width = canvas.width;
    compositeCanvas.height = canvas.height;
  }
  const compositeContext = compositeCanvas?.getContext('2d') ?? null;
  if (compositeCanvas && !compositeContext) {
    throw new Error('Shot thumbnail composite canvas context is unavailable.');
  }

  context.fillStyle = '#111914';
  context.fillRect(0, 0, canvas.width, canvas.height);
  const images = new Map(imageEntries);
  for (const { render, visual } of model.layers) {
    if (!render.visible) continue;
    const drawOwnerParts = (
      target: CanvasRenderingContext2D,
      opacity: number,
    ) => {
      target.save();
      target.translate(render.x * scale, render.y * scale);
      target.rotate((render.rotationDeg * Math.PI) / 180);
      target.globalAlpha = opacity;
      target.scale(render.scaleX * scale, render.scaleY * scale);
      for (const part of [...visual.parts].sort(
        (left, right) => left.drawOrder - right.drawOrder,
      )) {
        const image = images.get(part.assetId);
        if (!image) {
          throw new ShotThumbnailSourceError(
            `Unable to resolve the thumbnail for visual part “${part.partId}”.`,
          );
        }
        const { x, y, width, height } = part.localRect;
        target.drawImage(image, x, y, width, height);
      }
      target.restore();
    };

    if (visual.kind !== 'composite-character') {
      drawOwnerParts(context, render.opacity);
      continue;
    }

    const target = compositeContext!;
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.clearRect(0, 0, canvas.width, canvas.height);
    drawOwnerParts(target, 1);
    context.save();
    context.globalAlpha = render.opacity;
    context.drawImage(compositeCanvas!, 0, 0);
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

