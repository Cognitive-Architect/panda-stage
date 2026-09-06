import { useEffect, useState } from 'react';
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

function defaultReadCanvasImage(request: {
  projectRoot: string;
  assetId: string;
  sha256: string;
}): Promise<AssetCanvasImageReadResponse> {
  return window.pandaStage.assets.readCanvasImage(request);
}

/** Owns bounded-original image URLs for one mounted Preview dependency set. */
export class ProductPreviewImageSession {
  private readonly readCanvasImage: NonNullable<
    ProductPreviewImageSessionOptions['readCanvasImage']
  >;
  private readonly createObjectUrl: (blob: Blob) => string;
  private readonly revokeObjectUrl: (url: string) => void;
  private readonly objectUrls = new Set<string>();
  private disposed = false;

  constructor(options: ProductPreviewImageSessionOptions = {}) {
    this.readCanvasImage = options.readCanvasImage ?? defaultReadCanvasImage;
    this.createObjectUrl =
      options.createObjectUrl ?? ((blob) => URL.createObjectURL(blob));
    this.revokeObjectUrl =
      options.revokeObjectUrl ?? ((url) => URL.revokeObjectURL(url));
  }

  async load(
    projectRoot: string,
    project: Project,
    assetIds: readonly string[],
  ): Promise<ProductPreviewAssetLoadState | null> {
    if (this.disposed) return null;
    if (assetIds.length === 0) {
      return { status: 'ready', urls: {}, missingCount: 0 };
    }

    const entries = await Promise.all(
      assetIds.map(async (assetId) => {
        const asset = project.assets.find(
          (candidate) => candidate.id === assetId,
        );
        if (!asset || asset.kind !== 'image' || !asset.sha256) {
          return [assetId, undefined] as const;
        }
        try {
          const response = await this.readCanvasImage({
            projectRoot,
            assetId,
            sha256: asset.sha256,
          });
          if (
            this.disposed ||
            !response.ok ||
            response.status !== 'ready'
          ) {
            return [assetId, undefined] as const;
          }
          const objectUrl = this.createObjectUrl(
            new Blob([response.bytes], { type: response.mimeType }),
          );
          if (this.disposed) {
            this.revokeObjectUrl(objectUrl);
            return [assetId, undefined] as const;
          }
          this.objectUrls.add(objectUrl);
          return [assetId, objectUrl] as const;
        } catch {
          return [assetId, undefined] as const;
        }
      }),
    );
    if (this.disposed) return null;

    const urls: Record<string, string | undefined> = {};
    let missingCount = 0;
    for (const [assetId, objectUrl] of entries) {
      if (objectUrl) {
        urls[assetId] = objectUrl;
      } else {
        missingCount += 1;
      }
    }
    return {
      status: missingCount > 0 ? 'error' : 'ready',
      urls,
      missingCount,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const objectUrl of this.objectUrls) {
      this.revokeObjectUrl(objectUrl);
    }
    this.objectUrls.clear();
  }
}

/** Loads full-quality Preview images without changing the editor Canvas path. */
export function useProductPreviewImages(
  projectRoot: string,
  project: Project,
  assetIds: readonly string[],
): ProductPreviewAssetLoadState {
  const [state, setState] = useState<ProductPreviewAssetLoadState>(
    INITIAL_PRODUCT_PREVIEW_ASSET_STATE,
  );
  const assetKey = assetIds
    .map((assetId) => {
      const asset = project.assets.find((candidate) => candidate.id === assetId);
      return `${assetId}:${asset?.sha256 ?? 'missing'}`;
    })
    .sort()
    .join('|');

  useEffect(() => {
    const session = new ProductPreviewImageSession();
    setState(INITIAL_PRODUCT_PREVIEW_ASSET_STATE);
    void session.load(projectRoot, project, assetIds).then((nextState) => {
      if (nextState) setState(nextState);
    });
    return () => session.dispose();
  }, [assetIds, assetKey, project, projectRoot]);

  return state;
}
