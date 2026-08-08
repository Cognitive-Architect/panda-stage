import { readFile, realpath } from 'node:fs/promises';
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
    rawRequest: unknown,
  ): Promise<AssetThumbnailReadResponse> {
    let request: AssetThumbnailReadRequest;
    try {
      request = AssetThumbnailReadRequestSchema.parse(rawRequest);
    } catch {
      return this.failure(
        'ASSET_THUMBNAIL_INVALID_REQUEST',
        this.requestAssetId(rawRequest),
        '缩略图请求格式无效。',
      );
    }

    let snapshot: { project: Project } | null;
    try {
      snapshot = this.getCurrentProjectSnapshot(request.projectRoot);
    } catch (error) {
      return this.failure(
        'ASSET_THUMBNAIL_READ_FAILED',
        request.assetId,
        `Unable to read the current project snapshot: ${this.errorText(error)}`,
      );
    }
    if (!snapshot) {
      return this.failure(
        'ASSET_THUMBNAIL_PROJECT_NOT_TRACKED',
        request.assetId,
        '当前项目尚未在 Main Process 中打开。',
      );
    }

    let project: Project;
    try {
      project = ProjectSchema.parse(snapshot.project);
    } catch (error) {
      return this.failure(
        'ASSET_THUMBNAIL_READ_FAILED',
        request.assetId,
        `The current project snapshot is invalid: ${this.errorText(error)}`,
      );
    }

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
        const sourcePath = await this.resolveAssetPath(
          request.projectRoot,
          asset.relativePath,
        );
        if (!sourcePath) {
          return this.failure(
            'ASSET_THUMBNAIL_READ_FAILED',
            request.assetId,
            `Asset source is missing or outside the project assets directory: ${asset.relativePath}`,
          );
        }
        await this.cache.removeThumbnail(request.projectRoot, cacheKey);
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
        `无法读取缩略图：${this.errorText(error)}`,
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

  private async resolveAssetPath(
    projectRoot: string,
    relativePath: string,
  ): Promise<string | null> {
    const assetsRoot = path.resolve(projectRoot, 'assets');
    const assetPath = path.resolve(projectRoot, relativePath);
    if (!this.isInsideDirectory(assetsRoot, assetPath)) return null;
    try {
      const [realAssetsRoot, realAssetPath] = await Promise.all([
        realpath(assetsRoot),
        realpath(assetPath),
      ]);
      return this.isInsideDirectory(realAssetsRoot, realAssetPath)
        ? realAssetPath
        : null;
    } catch {
      return null;
    }
  }

  private isInsideDirectory(directory: string, candidate: string): boolean {
    const relative = path.relative(directory, candidate);
    return (
      relative.length > 0 &&
      relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
    );
  }

  private requestAssetId(rawRequest: unknown): string {
    try {
      if (
        typeof rawRequest === 'object' &&
        rawRequest !== null &&
        'assetId' in rawRequest &&
        typeof rawRequest.assetId === 'string'
      ) {
        return rawRequest.assetId;
      }
    } catch {
      // Treat hostile accessors as an invalid request without exposing them.
    }
    return '(invalid)';
  }

  private errorText(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return (
      Array.from(message, (character) => {
        const code = character.charCodeAt(0);
        return code <= 0x1f || code === 0x7f ? ' ' : character;
      })
        .join('')
        .replace(/\s+/gu, ' ')
        .trim()
        .slice(0, 900) || 'Operation failed.'
    );
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
        message: this.errorText(message).slice(0, 1_000),
        assetId: this.errorText(assetId).slice(0, 200),
      },
    };
  }
}
