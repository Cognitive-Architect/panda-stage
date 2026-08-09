import { realpath } from 'node:fs/promises';
import path from 'node:path';
import {
  ProjectSchema,
  type Asset,
  type Project,
} from '../../domain';
import {
  AssetMetadataRequestSchema,
  type AssetMetadataOperationErrorCode,
  type AssetMetadataRequest,
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
export const ASSET_METADATA_TIMEOUT_MS = 20_000 as const;
const MEDIA_ABORT_DRAIN_MS = 500;

export interface AudioMetadataProbe {
  probeAudioFile(
    audioPath: string,
    signal?: AbortSignal,
  ): Promise<AudioProbeResult>;
}

export interface AssetMetadataRevisionSnapshot {
  project: Project;
  revision: number;
}

export interface AssetMetadataServiceOptions {
  projectService: ProjectService;
  getCurrentProjectSnapshot: (
    projectRoot: string,
  ) => AssetMetadataRevisionSnapshot | null;
  thumbnailService: ThumbnailService;
  audioProbe: AudioMetadataProbe;
  hashService?: HashService;
  inspectionService?: MediaInspectionService;
  now?: () => Date;
  maxImagePixels?: number;
  timeoutMs?: number;
}

export interface AssetMetadataOperation {
  project: Project;
  baseRevision: number;
  savedRevision: number;
  result: AssetMetadataResult;
}

export interface AssetMetadataRefreshOptions {
  signal?: AbortSignal;
}

interface AssetMetadataErrorDetails extends ErrorOptions {
  relativePath?: string;
  currentProject?: Project;
  currentRevision?: number;
}

export class AssetMetadataServiceError extends Error {
  readonly relativePath: string | undefined;
  readonly currentProject: Project | undefined;
  readonly currentRevision: number | undefined;

  constructor(
    readonly code: AssetMetadataOperationErrorCode,
    readonly projectRoot: string,
    readonly assetId: string,
    message: string,
    details: AssetMetadataErrorDetails = {},
  ) {
    super(message, { cause: details.cause });
    this.name = 'AssetMetadataServiceError';
    this.relativePath = details.relativePath;
    this.currentProject = details.currentProject;
    this.currentRevision = details.currentRevision;
  }
}

class AssetMetadataItemError extends Error {
  readonly sha256: string | undefined;

  constructor(
    readonly code: AssetMetadataResultErrorCode,
    message: string,
    details: ErrorOptions & { sha256?: string } = {},
  ) {
    super(message, details);
    this.name = 'AssetMetadataItemError';
    this.sha256 = details.sha256;
  }
}

type ProcessedAsset = {
  asset: Asset;
  thumbnail: ThumbnailDescriptor | null;
  warnings: AssetMetadataWarning[];
};

export class AssetMetadataService {
  private readonly projectService: ProjectService;
  private readonly getCurrentProjectSnapshot: (
    projectRoot: string,
  ) => AssetMetadataRevisionSnapshot | null;
  private readonly thumbnailService: ThumbnailService;
  private readonly audioProbe: AudioMetadataProbe;
  private readonly hashService: HashService;
  private readonly inspectionService: MediaInspectionService;
  private readonly now: () => Date;
  private readonly maxImagePixels: number;
  private readonly timeoutMs: number;

  constructor(options: AssetMetadataServiceOptions) {
    this.projectService = options.projectService;
    this.getCurrentProjectSnapshot =
      options.getCurrentProjectSnapshot;
    this.thumbnailService = options.thumbnailService;
    this.audioProbe = options.audioProbe;
    this.hashService = options.hashService ?? new HashService();
    this.inspectionService =
      options.inspectionService ?? new MediaInspectionService();
    this.now = options.now ?? (() => new Date());
    this.maxImagePixels =
      options.maxImagePixels ?? MAX_IMAGE_PIXELS;
    this.timeoutMs = options.timeoutMs ?? ASSET_METADATA_TIMEOUT_MS;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new Error('Asset metadata timeout must be positive.');
    }
  }

  async refresh(
    rawRequest: AssetMetadataRequest,
    options: AssetMetadataRefreshOptions = {},
  ): Promise<AssetMetadataOperation> {
    let request: AssetMetadataRequest;
    try {
      request = AssetMetadataRequestSchema.parse(rawRequest);
    } catch (error) {
      throw new AssetMetadataServiceError(
        'ASSET_METADATA_INVALID_REQUEST',
        rawRequest.projectRoot,
        rawRequest.assetId,
        'Asset metadata request is invalid.',
        { cause: error },
      );
    }

    try {
      const initial = await this.projectService.transact(
        request.projectRoot,
        async (transaction) => {
          this.assertDiskIdentity(
            transaction.existingDocument.project,
            request,
          );
          const current = this.assertCurrentRevision(request);
          const asset = current.project.assets.find(
            (candidate) => candidate.id === request.assetId,
          );
          if (!asset) {
            throw new AssetMetadataServiceError(
              'ASSET_METADATA_ASSET_NOT_FOUND',
              transaction.projectRoot,
              request.assetId,
              `Project does not contain asset ${request.assetId}.`,
            );
          }
          return {
            projectRoot: transaction.projectRoot,
            asset: structuredClone(asset),
            assetPath: await this.resolveAssetPath(
              transaction.projectRoot,
              asset,
            ),
          };
        },
      );

      const processed = await this.processWithDeadline(
        request,
        initial.projectRoot,
        initial.assetPath,
        initial.asset,
        options.signal,
      );

      return await this.projectService.transact(
        initial.projectRoot,
        async (transaction) => {
          if (options.signal?.aborted) {
            throw new AssetMetadataServiceError(
              'ASSET_METADATA_CANCELLED',
              request.projectRoot,
              request.assetId,
              'Asset metadata processing was cancelled before commit.',
            );
          }
          this.assertDiskIdentity(
            transaction.existingDocument.project,
            request,
          );
          const current = this.assertCurrentRevision(request);
          const assetIndex = current.project.assets.findIndex(
            (asset) => asset.id === request.assetId,
          );
          if (assetIndex < 0) {
            throw this.staleError(
              request,
              current,
              'The asset was removed while metadata was processing.',
            );
          }
          const nextAsset =
            processed instanceof AssetMetadataItemError
              ? {
                  ...current.project.assets[assetIndex]!,
                  ...(processed.sha256
                    ? { sha256: processed.sha256 }
                    : {}),
                  metadata: {
                    status: 'error' as const,
                    code: processed.code,
                    message: processed.message,
                  },
                }
              : processed.asset;
          const nextProject = this.replaceAsset(
            current.project,
            assetIndex,
            nextAsset,
          );
          const savedRevision = request.baseRevision + 1;
          const saved = await transaction.save(
            nextProject,
            savedRevision,
          );
          return {
            project: saved.project,
            baseRevision: request.baseRevision,
            savedRevision,
            result:
              processed instanceof AssetMetadataItemError
                ? {
                    status: 'error' as const,
                    asset: saved.project.assets[assetIndex]!,
                    error: {
                      code: processed.code,
                      message: processed.message,
                    },
                  }
                : {
                    status: 'ready' as const,
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
          error.code === 'PROJECT_FILE_NOT_FOUND' ||
          error.code === 'INVALID_PROJECT_ROOT')
      ) {
        throw new AssetMetadataServiceError(
          'ASSET_METADATA_PROJECT_NOT_FOUND',
          request.projectRoot,
          request.assetId,
          `Cannot open the project at ${request.projectRoot}.`,
          { cause: error },
        );
      }
      throw new AssetMetadataServiceError(
        'ASSET_METADATA_OPERATION_FAILED',
        request.projectRoot,
        request.assetId,
        `Cannot process asset metadata: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  private async processWithDeadline(
    request: AssetMetadataRequest,
    projectRoot: string,
    assetPath: string,
    asset: Asset,
    externalSignal?: AbortSignal,
  ): Promise<ProcessedAsset | AssetMetadataItemError> {
    const controller = new AbortController();
    let terminal: 'timeout' | 'cancelled' | null = null;
    let rejectAbort!: () => void;
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectAbort = () => reject(new Error('Asset metadata aborted.'));
    });
    const abort = (reason: 'timeout' | 'cancelled') => {
      if (terminal) return;
      terminal = reason;
      controller.abort();
      rejectAbort();
    };
    const cancel = () => abort('cancelled');
    externalSignal?.addEventListener('abort', cancel, { once: true });
    if (externalSignal?.aborted) cancel();
    const timer = setTimeout(() => abort('timeout'), this.timeoutMs);

    const media = this.processAsset(
      projectRoot,
      assetPath,
      asset,
      controller.signal,
    ).catch((error: unknown) => {
      if (terminal) throw error;
      return this.normalizeItemError(asset, error);
    });
    void media.catch(() => undefined);
    try {
      return await Promise.race([media, aborted]);
    } catch (error) {
      if (terminal === 'timeout') {
        await drainAfterAbort(media);
        throw new AssetMetadataServiceError(
          'ASSET_METADATA_TIMEOUT',
          request.projectRoot,
          request.assetId,
          `Asset metadata processing exceeded ${this.timeoutMs} ms.`,
          { cause: error },
        );
      }
      if (terminal === 'cancelled') {
        await drainAfterAbort(media);
        throw new AssetMetadataServiceError(
          'ASSET_METADATA_CANCELLED',
          request.projectRoot,
          request.assetId,
          'Asset metadata processing was cancelled.',
          { cause: error },
        );
      }
      return this.normalizeItemError(asset, error);
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', cancel);
    }
  }

  private assertDiskIdentity(
    diskProject: Project,
    request: AssetMetadataRequest,
  ): void {
    if (diskProject.id !== request.project.id) {
      throw new AssetMetadataServiceError(
        'ASSET_METADATA_PROJECT_MISMATCH',
        request.projectRoot,
        request.assetId,
        'The project on disk has a different identity.',
      );
    }
  }

  private currentSnapshot(
    request: AssetMetadataRequest,
  ): AssetMetadataRevisionSnapshot {
    const snapshot = this.getCurrentProjectSnapshot(
      request.projectRoot,
    );
    if (!snapshot) {
      throw new AssetMetadataServiceError(
        'ASSET_METADATA_STALE_REVISION',
        request.projectRoot,
        request.assetId,
        'Main has no active project snapshot. Reopen the project and retry.',
      );
    }
    return {
      project: ProjectSchema.parse(snapshot.project),
      revision: snapshot.revision,
    };
  }

  private assertCurrentRevision(
    request: AssetMetadataRequest,
  ): AssetMetadataRevisionSnapshot {
    const current = this.currentSnapshot(request);
    if (current.project.id !== request.project.id) {
      throw new AssetMetadataServiceError(
        'ASSET_METADATA_PROJECT_MISMATCH',
        request.projectRoot,
        request.assetId,
        'Main tracks a different project identity.',
      );
    }
    if (
      current.revision !== request.baseRevision ||
      !projectsEqual(current.project, request.project)
    ) {
      throw this.staleError(
        request,
        current,
        `Revision ${request.baseRevision} is stale; Main is at revision ${current.revision}.`,
      );
    }
    return current;
  }

  private staleError(
    request: AssetMetadataRequest,
    current: AssetMetadataRevisionSnapshot,
    message: string,
  ): AssetMetadataServiceError {
    return new AssetMetadataServiceError(
      'ASSET_METADATA_STALE_REVISION',
      request.projectRoot,
      request.assetId,
      message,
      {
        currentProject: current.project,
        currentRevision: current.revision,
      },
    );
  }

  private async processAsset(
    projectRoot: string,
    assetPath: string,
    asset: Asset,
    signal: AbortSignal,
  ): Promise<ProcessedAsset> {
    let sha256: string;
    try {
      sha256 = (await this.hashService.hashFile(assetPath, signal)).hex;
    } catch (error) {
      if (signal.aborted) throw error;
      throw new AssetMetadataItemError(
        'ASSET_METADATA_FILE_UNREADABLE',
        `Cannot read asset "${asset.name}" (${asset.relativePath}).`,
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
        if (signal.aborted) throw error;
        throw new AssetMetadataItemError(
          'ASSET_METADATA_INVALID_IMAGE',
          `Image "${asset.name}" (${asset.relativePath}) is invalid.`,
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
          `Image "${asset.name}" has no valid dimensions.`,
          { sha256 },
        );
      }

      const warnings: AssetMetadataWarning[] = [];
      let thumbnail: ThumbnailDescriptor | null = null;
      if (inspected.width * inspected.height > this.maxImagePixels) {
        warnings.push({
          code: 'ASSET_IMAGE_TOO_LARGE',
          message: `Image "${asset.name}" is ${inspected.width}x${inspected.height}; thumbnail decoding was skipped.`,
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
              signal,
            });
        } catch (error) {
          if (signal.aborted) throw error;
          if (
            (error instanceof ThumbnailGenerationError &&
              error.kind === 'invalid-image') ||
            error instanceof MediaInspectionError
          ) {
            throw new AssetMetadataItemError(
              'ASSET_METADATA_INVALID_IMAGE',
              `Image "${asset.name}" could not be decoded.`,
              { cause: error, sha256 },
            );
          }
          warnings.push({
            code: 'ASSET_THUMBNAIL_CACHE_UNAVAILABLE',
            message: `Thumbnail cache is unavailable for "${asset.name}".`,
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
          await this.audioProbe.probeAudioFile(assetPath, signal)
        ).durationSeconds;
      } catch (error) {
        if (signal.aborted) throw error;
        throw new AssetMetadataItemError(
          'ASSET_METADATA_INVALID_AUDIO',
          `Audio "${asset.name}" (${asset.relativePath}) is invalid.`,
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
          `Audio "${asset.name}" has no valid duration.`,
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
      `Asset "${unsupportedAsset.name}" has an unsupported media kind.`,
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
          `Metadata processing failed for "${asset.name}" (${asset.relativePath}).`,
          { cause: error },
        );
  }

  private async resolveAssetPath(
    projectRoot: string,
    asset: Asset,
  ): Promise<string> {
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
        `Asset "${asset.name}" does not point inside assets/.`,
      );
    }
    let realAssetsRoot: string;
    try {
      realAssetsRoot = await realpath(assetsRoot);
    } catch (error) {
      if (isMissingPathError(error)) {
        throw this.sourceMissingError(projectRoot, asset, error);
      }
      throw new AssetMetadataServiceError(
        'ASSET_METADATA_OPERATION_FAILED',
        projectRoot,
        asset.id,
        `Cannot resolve the asset directory for ${asset.relativePath}.`,
        { cause: error, relativePath: asset.relativePath },
      );
    }
    let realAssetPath: string;
    try {
      realAssetPath = await realpath(assetPath);
    } catch (error) {
      if (isMissingPathError(error)) {
        throw this.sourceMissingError(projectRoot, asset, error);
      }
      throw new AssetMetadataServiceError(
        'ASSET_METADATA_OPERATION_FAILED',
        projectRoot,
        asset.id,
        `Cannot resolve asset source ${asset.relativePath}.`,
        { cause: error, relativePath: asset.relativePath },
      );
    }
    if (!this.isInsideDirectory(realAssetsRoot, realAssetPath)) {
      throw new AssetMetadataServiceError(
        'ASSET_METADATA_OPERATION_FAILED',
        projectRoot,
        asset.id,
        `Asset "${asset.name}" does not resolve inside assets/.`,
        { relativePath: asset.relativePath },
      );
    }
    return realAssetPath;
  }

  private sourceMissingError(
    projectRoot: string,
    asset: Asset,
    cause: unknown,
  ): AssetMetadataServiceError {
    return new AssetMetadataServiceError(
      'ASSET_METADATA_SOURCE_MISSING',
      projectRoot,
      asset.id,
      `源文件缺失，无法重建缩略图：${asset.relativePath}`,
      { cause, relativePath: asset.relativePath },
    );
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

function isMissingPathError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

function projectsEqual(left: Project, right: Project): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function drainAfterAbort(media: Promise<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    media.then(
      () => undefined,
      () => undefined,
    ),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, MEDIA_ABORT_DRAIN_MS);
    }),
  ]);
  if (timer) clearTimeout(timer);
}
