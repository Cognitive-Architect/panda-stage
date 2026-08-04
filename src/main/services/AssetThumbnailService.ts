import { readFile } from 'node:fs/promises';
import path from 'node:path';
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
import type { ThumbnailService } from './ThumbnailService';

const MAX_THUMBNAIL_BYTES = 6_000_000;

export interface AssetThumbnailServiceOptions {
  getCurrentProjectSnapshot: (
    projectRoot: string,
  ) => { project: Project } | null;
  cache?: CacheService;
  thumbnailService?: Pick<ThumbnailService, 'ensureThumbnail'>;
}

export class AssetThumbnailService {
  private readonly getCurrentProjectSnapshot: (
    projectRoot: string,
  ) => { project: Project } | null;
  private readonly cache: CacheService;
  private readonly thumbnailService:
    | Pick<ThumbnailService, 'ensureThumbnail'>
    | null;

  constructor(options: AssetThumbnailServiceOptions) {
    this.getCurrentProjectSnapshot =
      options.getCurrentProjectSnapshot;
    this.cache = options.cache ?? new CacheService();
    this.thumbnailService = options.thumbnailService ?? null;
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
      let dataUrl = await this.readCachedThumbnail(
        request.projectRoot,
        cacheKey,
      );
      if (!dataUrl && this.thumbnailService) {
        await this.cache.removeThumbnail(request.projectRoot, cacheKey);
        const sourcePath = this.resolveAssetPath(
          request.projectRoot,
          asset.relativePath,
        );
        if (!sourcePath) {
          return this.failure(
            'ASSET_THUMBNAIL_READ_FAILED',
            request.assetId,
            `素材路径不在项目 assets 目录内：${asset.relativePath}`,
          );
        }
        await this.thumbnailService.ensureThumbnail({
          projectRoot: request.projectRoot,
          sourcePath,
          sha256: request.sha256,
          width: asset.width,
          height: asset.height,
        });
        dataUrl = await this.readCachedThumbnail(
          request.projectRoot,
          cacheKey,
        );
      }
      return dataUrl
        ? {
            ok: true,
            status: 'ready',
            assetId: request.assetId,
            dataUrl,
          }
        : { ok: true, status: 'missing', assetId: request.assetId };
    } catch (error) {
      return this.failure(
        'ASSET_THUMBNAIL_READ_FAILED',
        request.assetId,
        `无法读取缩略图：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async readCachedThumbnail(
    projectRoot: string,
    cacheKey: string,
  ): Promise<string | null> {
    if (!(await this.cache.hasThumbnail(projectRoot, cacheKey))) {
      return null;
    }
    const bytes = await readFile(
      this.cache.thumbnailPath(projectRoot, cacheKey),
    );
    if (
      bytes.length > MAX_THUMBNAIL_BYTES ||
      !validatePngThumbnail(bytes)
    ) {
      return null;
    }
    return `data:image/png;base64,${bytes.toString('base64')}`;
  }

  private resolveAssetPath(
    projectRoot: string,
    relativePath: string,
  ): string | null {
    const assetsRoot = path.resolve(projectRoot, 'assets');
    const assetPath = path.resolve(projectRoot, relativePath);
    const assetsPrefix = `${assetsRoot}${path.sep}`.toLowerCase();
    if (!assetPath.toLowerCase().startsWith(assetsPrefix)) {
      return null;
    }
    return assetPath;
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
