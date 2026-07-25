import path from 'node:path';
import {
  ProjectSchema,
  scanAssetReferences,
  type Asset,
  type AssetReference,
  type Project,
} from '../../domain';
import {
  AssetDeleteRequestSchema,
  type AssetDeleteErrorCode,
  type AssetDeleteRequest,
} from '../../shared/asset-delete-api';
import { CacheService } from './CacheService';
import {
  AssetDeleteFileSystemService,
  type StagedAssetDeleteFile,
} from './AssetDeleteFileSystemService';
import { AtomicWriteCommitRejectedError } from './ProjectFileSystemService';
import {
  ProjectService,
  ProjectServiceError,
} from './ProjectService';

export interface AssetDeleteRevisionSnapshot {
  project: Project;
  revision: number;
}

export interface AssetDeleteServiceOptions {
  projectService: ProjectService;
  getCurrentProjectSnapshot: (
    projectRoot: string,
  ) => AssetDeleteRevisionSnapshot | null;
  fileSystem?: AssetDeleteFileSystemService;
  cache?: CacheService;
  now?: () => Date;
  beforeCommitValidation?: () => void | Promise<void>;
}

export interface AssetDeleteOperation {
  project: Project;
  baseRevision: number;
  savedRevision: number;
  deletedAssetId: string;
  cleanupResidualPaths: string[];
}

interface AssetDeleteErrorDetails extends ErrorOptions {
  references?: AssetReference[];
  currentProject?: Project;
  currentRevision?: number;
  residualPaths?: string[];
}

export class AssetDeleteServiceError extends Error {
  readonly references: AssetReference[];
  readonly currentProject: Project | undefined;
  readonly currentRevision: number | undefined;
  readonly residualPaths: string[];

  constructor(
    readonly code: AssetDeleteErrorCode,
    readonly projectRoot: string,
    readonly assetId: string,
    message: string,
    details: AssetDeleteErrorDetails = {},
  ) {
    super(message, { cause: details.cause });
    this.name = 'AssetDeleteServiceError';
    this.references = details.references ?? [];
    this.currentProject = details.currentProject;
    this.currentRevision = details.currentRevision;
    this.residualPaths = details.residualPaths ?? [];
  }
}

export class AssetDeleteService {
  private readonly projectService: ProjectService;
  private readonly getCurrentProjectSnapshot: (
    projectRoot: string,
  ) => AssetDeleteRevisionSnapshot | null;
  private readonly fileSystem: AssetDeleteFileSystemService;
  private readonly cache: CacheService;
  private readonly now: () => Date;
  private readonly beforeCommitValidation:
    | (() => void | Promise<void>)
    | null;

  constructor(options: AssetDeleteServiceOptions) {
    this.projectService = options.projectService;
    this.getCurrentProjectSnapshot =
      options.getCurrentProjectSnapshot;
    this.fileSystem =
      options.fileSystem ?? new AssetDeleteFileSystemService();
    this.cache = options.cache ?? new CacheService();
    this.now = options.now ?? (() => new Date());
    this.beforeCommitValidation =
      options.beforeCommitValidation ?? null;
  }

  async deleteAsset(
    rawRequest: AssetDeleteRequest,
  ): Promise<AssetDeleteOperation> {
    let request: AssetDeleteRequest;
    try {
      request = AssetDeleteRequestSchema.parse(rawRequest);
    } catch (error) {
      throw new AssetDeleteServiceError(
        'ASSET_DELETE_INVALID_REQUEST',
        rawRequest.projectRoot,
        rawRequest.assetId,
        '素材删除请求格式无效。',
        { cause: error },
      );
    }

    try {
      return await this.projectService.transact(
        request.projectRoot,
        async (transaction) => {
          if (
            transaction.existingDocument.project.id !==
            request.project.id
          ) {
            throw new AssetDeleteServiceError(
              'ASSET_DELETE_PROJECT_MISMATCH',
              transaction.projectRoot,
              request.assetId,
              '磁盘上的项目与当前打开项目不是同一个项目。',
            );
          }
          const current = this.assertCurrentRevision(request);
          const asset = current.project.assets.find(
            (candidate) => candidate.id === request.assetId,
          );
          if (!asset) {
            throw new AssetDeleteServiceError(
              'ASSET_DELETE_ASSET_NOT_FOUND',
              transaction.projectRoot,
              request.assetId,
              '当前项目中找不到要删除的素材。',
            );
          }
          const references = scanAssetReferences(
            current.project,
            asset.id,
          );
          if (references.length > 0) {
            throw new AssetDeleteServiceError(
              'ASSET_DELETE_REFERENCED',
              transaction.projectRoot,
              asset.id,
              `素材“${asset.name}”仍被 ${references.length} 处内容使用，请先解除引用。`,
              { references },
            );
          }

          const staged: StagedAssetDeleteFile[] = [];
          try {
            const assetEntry = await this.fileSystem.stage(
              this.resolveAssetPath(transaction.projectRoot, asset),
              'asset',
              true,
            );
            if (assetEntry) staged.push(assetEntry);
            const thumbnailPath = this.thumbnailPath(
              transaction.projectRoot,
              asset,
            );
            if (thumbnailPath) {
              const thumbnailEntry = await this.fileSystem.stage(
                thumbnailPath,
                'thumbnail',
                false,
              );
              if (thumbnailEntry) staged.push(thumbnailEntry);
            }
          } catch (error) {
            const residualPaths =
              await this.fileSystem.rollback(staged);
            if (residualPaths.length > 0) {
              throw new AssetDeleteServiceError(
                'ASSET_DELETE_ROLLBACK_FAILED',
                transaction.projectRoot,
                asset.id,
                '删除准备失败，且部分素材文件未能恢复，请按残留路径手动恢复。',
                { cause: error, residualPaths },
              );
            }
            throw new AssetDeleteServiceError(
              'ASSET_DELETE_FAILED',
              transaction.projectRoot,
              asset.id,
              `无法删除素材“${asset.name}”，项目没有发生变化。`,
              { cause: error },
            );
          }

          try {
            await this.beforeCommitValidation?.();
            this.assertCommitSnapshot(request, asset.id);
          } catch (error) {
            const residualPaths =
              await this.fileSystem.rollback(staged);
            if (residualPaths.length > 0) {
              throw new AssetDeleteServiceError(
                'ASSET_DELETE_ROLLBACK_FAILED',
                transaction.projectRoot,
                asset.id,
                '删除提交校验失败，且部分素材文件未能恢复，请按残留路径手动恢复。',
                { cause: error, residualPaths },
              );
            }
            if (error instanceof AssetDeleteServiceError) {
              throw error;
            }
            throw new AssetDeleteServiceError(
              'ASSET_DELETE_FAILED',
              transaction.projectRoot,
              asset.id,
              `删除素材“${asset.name}”的提交校验失败，文件已恢复。`,
              { cause: error },
            );
          }

          const nextProject = ProjectSchema.parse({
            ...current.project,
            assets: current.project.assets.filter(
              (candidate) => candidate.id !== asset.id,
            ),
            updatedAt: this.now().toISOString(),
          });
          const savedRevision = request.baseRevision + 1;
          let saved;
          try {
            saved = await transaction.save(
              nextProject,
              savedRevision,
              () => this.assertCommitSnapshot(request, asset.id),
            );
          } catch (error) {
            const residualPaths =
              await this.fileSystem.rollback(staged);
            if (residualPaths.length > 0) {
              throw new AssetDeleteServiceError(
                'ASSET_DELETE_ROLLBACK_FAILED',
                transaction.projectRoot,
                asset.id,
                '项目保存失败，且部分素材文件未能恢复，请按残留路径手动恢复。',
                { cause: error, residualPaths },
              );
            }
            const commitError =
              error instanceof AtomicWriteCommitRejectedError
                ? error.cause
                : error;
            if (commitError instanceof AssetDeleteServiceError) {
              throw commitError;
            }
            throw new AssetDeleteServiceError(
              'ASSET_DELETE_FAILED',
              transaction.projectRoot,
              asset.id,
              `删除素材“${asset.name}”时无法保存项目，文件已恢复。`,
              { cause: error },
            );
          }

          const cleanupResidualPaths =
            await this.fileSystem.finalize(staged);
          return {
            project: saved.project,
            baseRevision: request.baseRevision,
            savedRevision,
            deletedAssetId: asset.id,
            cleanupResidualPaths,
          };
        },
      );
    } catch (error) {
      if (error instanceof AssetDeleteServiceError) throw error;
      if (
        error instanceof ProjectServiceError &&
        (error.code === 'PROJECT_NOT_FOUND' ||
          error.code === 'INVALID_PROJECT_ROOT')
      ) {
        throw new AssetDeleteServiceError(
          'ASSET_DELETE_PROJECT_NOT_FOUND',
          request.projectRoot,
          request.assetId,
          '无法打开素材所属项目。',
          { cause: error },
        );
      }
      throw new AssetDeleteServiceError(
        'ASSET_DELETE_FAILED',
        request.projectRoot,
        request.assetId,
        `素材删除失败：${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  private assertCurrentRevision(
    request: AssetDeleteRequest,
  ): AssetDeleteRevisionSnapshot {
    const snapshot = this.getCurrentProjectSnapshot(
      request.projectRoot,
    );
    if (!snapshot) {
      throw new AssetDeleteServiceError(
        'ASSET_DELETE_STALE_REVISION',
        request.projectRoot,
        request.assetId,
        'Main Process 没有当前项目快照，请重新打开项目后重试。',
      );
    }
    const project = ProjectSchema.parse(snapshot.project);
    if (project.id !== request.project.id) {
      throw new AssetDeleteServiceError(
        'ASSET_DELETE_PROJECT_MISMATCH',
        request.projectRoot,
        request.assetId,
        'Main Process 当前跟踪的是另一个项目。',
      );
    }
    if (
      snapshot.revision !== request.baseRevision ||
      JSON.stringify(project) !== JSON.stringify(request.project)
    ) {
      throw new AssetDeleteServiceError(
        'ASSET_DELETE_STALE_REVISION',
        request.projectRoot,
        request.assetId,
        `删除请求的修订 ${request.baseRevision} 已过期；当前修订为 ${snapshot.revision}。`,
        {
          currentProject: project,
          currentRevision: snapshot.revision,
        },
      );
    }
    return { project, revision: snapshot.revision };
  }

  private assertCommitSnapshot(
    request: AssetDeleteRequest,
    assetId: string,
  ): void {
    const snapshot = this.getCurrentProjectSnapshot(
      request.projectRoot,
    );
    if (!snapshot) {
      throw new AssetDeleteServiceError(
        'ASSET_DELETE_STALE_REVISION',
        request.projectRoot,
        assetId,
        '删除提交前 Main Process 已失去当前项目快照，文件已恢复，请重新打开项目后重试。',
      );
    }
    const project = ProjectSchema.parse(snapshot.project);
    const references = scanAssetReferences(project, assetId);
    if (
      project.id !== request.project.id ||
      snapshot.revision !== request.baseRevision ||
      JSON.stringify(project) !== JSON.stringify(request.project) ||
      references.length > 0
    ) {
      throw new AssetDeleteServiceError(
        'ASSET_DELETE_STALE_REVISION',
        request.projectRoot,
        assetId,
        `删除期间项目已从修订 ${request.baseRevision} 变化到修订 ${snapshot.revision}，文件已恢复，请刷新后重试。`,
        {
          currentProject: project,
          currentRevision: snapshot.revision,
          references,
        },
      );
    }
  }

  private resolveAssetPath(
    projectRoot: string,
    asset: Asset,
  ): string {
    const assetsRoot = path.resolve(projectRoot, 'assets');
    const assetPath = path.resolve(projectRoot, asset.relativePath);
    const relative = path.relative(assetsRoot, assetPath);
    if (
      !relative ||
      relative === '..' ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new AssetDeleteServiceError(
        'ASSET_DELETE_FAILED',
        projectRoot,
        asset.id,
        '素材路径没有安全地指向项目 assets/ 目录。',
      );
    }
    return assetPath;
  }

  private thumbnailPath(
    projectRoot: string,
    asset: Asset,
  ): string | null {
    return asset.sha256
      ? this.cache.thumbnailPath(
          projectRoot,
          this.cache.thumbnailKey(asset.sha256),
        )
      : null;
  }
}
