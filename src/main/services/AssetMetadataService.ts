import path from 'node:path';
import {
  ProjectSchema,
  type Asset,
  type Project,
} from '../../domain';
import {
  type AssetMetadataOperationErrorCode,
  type AssetMetadataResult,
  type AssetMetadataResultErrorCode,
  type AssetMetadataWarning,
} from '../../shared/asset-metadata-api';
import type { AudioProbeResult } from '../../shared/ffmpeg-types';
import { HashService } from './HashService';
import {
  MediaInspectionError,
  MediaInspectionService,
} from './MediaInspectionService';
import {
  ProjectService,
  ProjectServiceError,
} from './ProjectService';
import {
  ThumbnailGenerationError,
  ThumbnailService,
  type ThumbnailDescriptor,
} from './ThumbnailService';

export const MAX_IMAGE_PIXELS = 40_000_000 as const;

export interface AudioMetadataProbe {
  probeAudioFile(
    audioPath: string,
    signal?: AbortSignal,
  ): Promise<AudioProbeResult>;
}

export interface AssetMetadataServiceOptions {
  projectService: ProjectService;
  thumbnailService: ThumbnailService;
  audioProbe: AudioMetadataProbe;
  hashService?: HashService;
  inspectionService?: MediaInspectionService;
  now?: () => Date;
  maxImagePixels?: number;
}

export interface AssetMetadataOperation {
  project: Project;
  result: AssetMetadataResult;
}

export class AssetMetadataServiceError extends Error {
  constructor(
    readonly code: AssetMetadataOperationErrorCode,
    readonly projectRoot: string,
    readonly assetId: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'AssetMetadataServiceError';
  }
}

class AssetMetadataItemError extends Error {
  constructor(
    readonly code: AssetMetadataResultErrorCode,
    message: string,
    details: ErrorOptions & { sha256?: string } = {},
  ) {
    super(message, details);
    this.name = 'AssetMetadataItemError';
    this.sha256 = details.sha256;
  }

  readonly sha256: string | undefined;
}

export class AssetMetadataService {
  private readonly projectService: ProjectService;
  private readonly thumbnailService: ThumbnailService;
  private readonly audioProbe: AudioMetadataProbe;
  private readonly hashService: HashService;
  private readonly inspectionService: MediaInspectionService;
  private readonly now: () => Date;
  private readonly maxImagePixels: number;

  constructor(options: AssetMetadataServiceOptions) {
    this.projectService = options.projectService;
    this.thumbnailService = options.thumbnailService;
    this.audioProbe = options.audioProbe;
    this.hashService = options.hashService ?? new HashService();
    this.inspectionService =
      options.inspectionService ?? new MediaInspectionService();
    this.now = options.now ?? (() => new Date());
    this.maxImagePixels =
      options.maxImagePixels ?? MAX_IMAGE_PIXELS;
  }

  async refresh(
    projectRoot: string,
    assetId: string,
  ): Promise<AssetMetadataOperation> {
    try {
      return await this.projectService.transact(
        projectRoot,
        async (transaction) => {
          const assetIndex =
            transaction.existingDocument.project.assets.findIndex(
              (asset) => asset.id === assetId,
            );
          if (assetIndex < 0) {
            throw new AssetMetadataServiceError(
              'ASSET_METADATA_ASSET_NOT_FOUND',
              transaction.projectRoot,
              assetId,
              `项目中找不到素材 ID“${assetId}”。`,
            );
          }
          const asset =
            transaction.existingDocument.project.assets[assetIndex]!;
          const assetPath = this.resolveAssetPath(
            transaction.projectRoot,
            asset,
          );

          let processed:
            | {
                asset: Asset;
                thumbnail: ThumbnailDescriptor | null;
                warnings: AssetMetadataWarning[];
              }
            | undefined;
          try {
            processed = await this.processAsset(
              transaction.projectRoot,
              assetPath,
              asset,
            );
          } catch (error) {
            const itemError = this.normalizeItemError(asset, error);
            const failedAsset = {
              ...asset,
              ...(itemError.sha256
                ? { sha256: itemError.sha256 }
                : {}),
              metadata: {
                status: 'error' as const,
                code: itemError.code,
                message: itemError.message,
              },
            };
            const failedProject = this.replaceAsset(
              transaction.existingDocument.project,
              assetIndex,
              failedAsset,
            );
            const saved = await transaction.save(failedProject);
            return {
              project: saved.project,
              result: {
                status: 'error',
                asset: saved.project.assets[assetIndex]!,
                error: {
                  code: itemError.code,
                  message: itemError.message,
                },
              },
            };
          }

          const nextProject = this.replaceAsset(
            transaction.existingDocument.project,
            assetIndex,
            processed.asset,
          );
          const saved = await transaction.save(nextProject);
          return {
            project: saved.project,
            result: {
              status: 'ready',
              asset: saved.project.assets[assetIndex]!,
              thumbnail: processed.thumbnail,
              warnings: processed.warnings,
            },
          };
        },
      );
    } catch (error) {
      if (error instanceof AssetMetadataServiceError) throw error;
      if (
        error instanceof ProjectServiceError &&
        (error.code === 'PROJECT_NOT_FOUND' ||
          error.code === 'INVALID_PROJECT_ROOT')
      ) {
        throw new AssetMetadataServiceError(
          'ASSET_METADATA_PROJECT_NOT_FOUND',
          projectRoot,
          assetId,
          `无法打开素材所属项目：${projectRoot}。`,
          { cause: error },
        );
      }
      throw new AssetMetadataServiceError(
        'ASSET_METADATA_OPERATION_FAILED',
        projectRoot,
        assetId,
        `无法处理素材元数据：${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  private async processAsset(
    projectRoot: string,
    assetPath: string,
    asset: Asset,
  ): Promise<{
    asset: Asset;
    thumbnail: ThumbnailDescriptor | null;
    warnings: AssetMetadataWarning[];
  }> {
    let sha256: string;
    try {
      sha256 = (await this.hashService.hashFile(assetPath)).hex;
    } catch (error) {
      throw new AssetMetadataItemError(
        'ASSET_METADATA_FILE_UNREADABLE',
        `无法读取项目内素材“${asset.name}”（${asset.relativePath}）。`,
        { cause: error },
      );
    }

    if (asset.kind === 'image') {
      let inspected;
      try {
        inspected = await this.inspectionService.inspect(
          assetPath,
          asset.mimeType,
        );
      } catch (error) {
        throw new AssetMetadataItemError(
          'ASSET_METADATA_INVALID_IMAGE',
          `图片素材“${asset.name}”（${asset.relativePath}）已损坏或无法解析。`,
          { cause: error, sha256 },
        );
      }
      if (
        inspected.kind !== 'image' ||
        inspected.width === undefined ||
        inspected.height === undefined
      ) {
        throw new AssetMetadataItemError(
          'ASSET_METADATA_INVALID_IMAGE',
          `图片素材“${asset.name}”（${asset.relativePath}）没有有效尺寸。`,
          { sha256 },
        );
      }

      const warnings: AssetMetadataWarning[] = [];
      let thumbnail: ThumbnailDescriptor | null = null;
      if (inspected.width * inspected.height > this.maxImagePixels) {
        warnings.push({
          code: 'ASSET_IMAGE_TOO_LARGE',
          message: `图片“${asset.name}”为 ${inspected.width}×${inspected.height}，超过安全解码阈值 ${this.maxImagePixels} 像素；已跳过缩略图以避免阻塞应用。`,
        });
      } else {
        try {
          thumbnail =
            await this.thumbnailService.ensureThumbnail({
              projectRoot,
              sourcePath: assetPath,
              sha256,
              width: inspected.width,
              height: inspected.height,
            });
        } catch (error) {
          if (
            (error instanceof ThumbnailGenerationError &&
              error.kind === 'invalid-image') ||
            error instanceof MediaInspectionError
          ) {
            throw new AssetMetadataItemError(
              'ASSET_METADATA_INVALID_IMAGE',
              `图片素材“${asset.name}”（${asset.relativePath}）无法完整解码。`,
              { cause: error, sha256 },
            );
          }
          warnings.push({
            code: 'ASSET_THUMBNAIL_CACHE_UNAVAILABLE',
            message: `图片“${asset.name}”的缩略图缓存写入失败；项目仍可打开，稍后可重建缓存。`,
          });
        }
      }

      return {
        asset: {
          ...asset,
          sha256,
          width: inspected.width,
          height: inspected.height,
          metadata: { status: 'ready', warnings },
        },
        thumbnail,
        warnings,
      };
    }

    if (asset.kind === 'audio') {
      let durationSeconds: number;
      try {
        durationSeconds = (
          await this.audioProbe.probeAudioFile(assetPath)
        ).durationSeconds;
      } catch (error) {
        throw new AssetMetadataItemError(
          'ASSET_METADATA_INVALID_AUDIO',
          `音频素材“${asset.name}”（${asset.relativePath}）已损坏或无法解析。`,
          { cause: error, sha256 },
        );
      }
      const durationMs = Math.round(durationSeconds * 1_000);
      if (
        !Number.isFinite(durationSeconds) ||
        !Number.isInteger(durationMs) ||
        durationMs <= 0
      ) {
        throw new AssetMetadataItemError(
          'ASSET_METADATA_INVALID_AUDIO',
          `音频素材“${asset.name}”（${asset.relativePath}）没有有效时长。`,
          { sha256 },
        );
      }
      return {
        asset: {
          ...asset,
          sha256,
          durationMs,
          metadata: { status: 'ready', warnings: [] },
        },
        thumbnail: null,
        warnings: [],
      };
    }

    const unsupportedAsset = asset as Asset;
    throw new AssetMetadataItemError(
      'ASSET_METADATA_UNSUPPORTED_KIND',
      `素材“${unsupportedAsset.name}”的媒体类型不受支持。`,
    );
  }

  private normalizeItemError(
    asset: Asset,
    error: unknown,
  ): AssetMetadataItemError {
    return error instanceof AssetMetadataItemError
      ? error
      : new AssetMetadataItemError(
          asset.kind === 'image'
            ? 'ASSET_METADATA_INVALID_IMAGE'
            : 'ASSET_METADATA_INVALID_AUDIO',
          `素材“${asset.name}”（${asset.relativePath}）的元数据处理失败。`,
          { cause: error },
        );
  }

  private resolveAssetPath(projectRoot: string, asset: Asset): string {
    const assetsRoot = path.resolve(projectRoot, 'assets');
    const assetPath = path.resolve(projectRoot, asset.relativePath);
    const relative = path.relative(assetsRoot, assetPath);
    if (
      !relative ||
      relative.startsWith(`..${path.sep}`) ||
      relative === '..' ||
      path.isAbsolute(relative)
    ) {
      throw new AssetMetadataItemError(
        'ASSET_METADATA_FILE_UNREADABLE',
        `素材“${asset.name}”没有指向项目 assets/ 内的安全副本。`,
      );
    }
    return assetPath;
  }

  private replaceAsset(
    project: Project,
    assetIndex: number,
    asset: Asset,
  ): Project {
    const assets = [...project.assets];
    assets[assetIndex] = asset;
    return ProjectSchema.parse({
      ...project,
      assets,
      updatedAt: this.now().toISOString(),
    });
  }
}
