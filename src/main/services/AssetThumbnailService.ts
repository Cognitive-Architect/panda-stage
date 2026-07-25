import { readFile } from 'node:fs/promises';
import {
  ProjectSchema,
  type Project,
} from '../../domain';
import {
  AssetThumbnailReadRequestSchema,
  type AssetThumbnailReadRequest,
  type AssetThumbnailReadResponse,
} from '../../shared/asset-thumbnail-api';
import { CacheService } from './CacheService';
import { validatePngThumbnail } from './PngThumbnailValidator';

const MAX_THUMBNAIL_BYTES = 6_000_000;

export interface AssetThumbnailServiceOptions {
  getCurrentProjectSnapshot: (
    projectRoot: string,
  ) => { project: Project } | null;
  cache?: CacheService;
}

export class AssetThumbnailService {
  private readonly getCurrentProjectSnapshot: (
    projectRoot: string,
  ) => { project: Project } | null;
  private readonly cache: CacheService;

  constructor(options: AssetThumbnailServiceOptions) {
    this.getCurrentProjectSnapshot =
      options.getCurrentProjectSnapshot;
    this.cache = options.cache ?? new CacheService();
  }

  async read(
    rawRequest: AssetThumbnailReadRequest,
  ): Promise<AssetThumbnailReadResponse> {
    let request: AssetThumbnailReadRequest;
    try {
      request = AssetThumbnailReadRequestSchema.parse(rawRequest);
    } catch {
      return this.failure(
        'ASSET_THUMBNAIL_INVALID_REQUEST',
        rawRequest.assetId,
        '缩略图请求格式无效。',
      );
    }
    const snapshot = this.getCurrentProjectSnapshot(
      request.projectRoot,
    );
    if (!snapshot) {
      return this.failure(
        'ASSET_THUMBNAIL_PROJECT_NOT_TRACKED',
        request.assetId,
        '当前项目尚未在 Main Process 中打开。',
      );
    }
    const project = ProjectSchema.parse(snapshot.project);
    const asset = project.assets.find(
      (candidate) => candidate.id === request.assetId,
    );
    if (!asset) {
      return this.failure(
        'ASSET_THUMBNAIL_ASSET_NOT_FOUND',
        request.assetId,
        '当前项目中找不到该素材。',
      );
    }
    if (asset.sha256 !== request.sha256) {
      return this.failure(
        'ASSET_THUMBNAIL_HASH_MISMATCH',
        request.assetId,
        '素材内容已经变化，请重新生成缩略图。',
      );
    }
    if (asset.kind !== 'image') {
      return { ok: true, status: 'missing', assetId: request.assetId };
    }
    const cacheKey = this.cache.thumbnailKey(request.sha256);
    try {
      if (!(await this.cache.hasThumbnail(request.projectRoot, cacheKey))) {
        return { ok: true, status: 'missing', assetId: request.assetId };
      }
      const bytes = await readFile(
        this.cache.thumbnailPath(request.projectRoot, cacheKey),
      );
      if (
        bytes.length > MAX_THUMBNAIL_BYTES ||
        !validatePngThumbnail(bytes)
      ) {
        return {
          ok: true,
          status: 'missing',
          assetId: request.assetId,
        };
      }
      return {
        ok: true,
        status: 'ready',
        assetId: request.assetId,
        dataUrl: `data:image/png;base64,${bytes.toString('base64')}`,
      };
    } catch (error) {
      return this.failure(
        'ASSET_THUMBNAIL_READ_FAILED',
        request.assetId,
        `无法读取缩略图：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private failure(
    code:
      | 'ASSET_THUMBNAIL_INVALID_REQUEST'
      | 'ASSET_THUMBNAIL_PROJECT_NOT_TRACKED'
      | 'ASSET_THUMBNAIL_ASSET_NOT_FOUND'
      | 'ASSET_THUMBNAIL_HASH_MISMATCH'
      | 'ASSET_THUMBNAIL_READ_FAILED',
    assetId: string,
    message: string,
  ): AssetThumbnailReadResponse {
    return {
      ok: false,
      error: {
        code,
        message: message.slice(0, 1_000),
        assetId: assetId.slice(0, 200),
      },
    };
  }
}
