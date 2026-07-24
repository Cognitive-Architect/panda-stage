import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  AssetSchema,
  ProjectSchema,
  type Asset,
  type Project,
} from '../../domain';
import {
  AssetImportDroppedRequestSchema,
  type AssetImportDroppedRequest,
  type AssetImportResult,
} from '../../shared/asset-import-api';
import {
  AssetImportFileSystemCleanupError,
  AssetImportFileSystemService,
} from './AssetImportFileSystemService';
import { HashService } from './HashService';
import {
  MediaInspectionError,
  MediaInspectionService,
  type InspectedMedia,
} from './MediaInspectionService';
import { ProjectService } from './ProjectService';

export interface AssetImportRevisionSnapshot {
  project: Project;
  revision: number;
}

export interface RegisteredAssetFile {
  filePath: string;
  sourceName: string;
  sha256: string;
}

export interface AssetImportFaultInjector {
  afterFileRegistered?(
    file: RegisteredAssetFile,
  ): void | Promise<void>;
  beforeProjectBuild?(
    files: readonly RegisteredAssetFile[],
  ): void | Promise<void>;
}

export interface AssetImportServiceOptions {
  projectService: ProjectService;
  getCurrentProjectSnapshot: (
    projectRoot: string,
  ) => AssetImportRevisionSnapshot | null;
  fileSystem?: AssetImportFileSystemService;
  hashService?: HashService;
  inspectionService?: MediaInspectionService;
  faults?: AssetImportFaultInjector;
  createId?: () => string;
  now?: () => Date;
}

export interface AssetImportOperation {
  project: Project;
  baseRevision: number;
  savedRevision: number;
  projectChanged: boolean;
  results: AssetImportResult[];
}

interface AssetImportErrorDetails extends ErrorOptions {
  currentProject?: Project;
  currentRevision?: number;
  residualPaths?: readonly string[];
}

export class AssetImportServiceError extends Error {
  readonly currentProject?: Project;
  readonly currentRevision?: number;
  readonly residualPaths: readonly string[];

  constructor(
    readonly code:
      | 'ASSET_IMPORT_PROJECT_MISMATCH'
      | 'ASSET_IMPORT_PROJECT_INVALID'
      | 'ASSET_IMPORT_STALE_REVISION'
      | 'ASSET_IMPORT_ROLLBACK_FAILED'
      | 'ASSET_IMPORT_OPERATION_FAILED',
    readonly projectRoot: string,
    message: string,
    details: AssetImportErrorDetails = {},
  ) {
    super(message, { cause: details.cause });
    this.name = 'AssetImportServiceError';
    this.currentProject = details.currentProject;
    this.currentRevision = details.currentRevision;
    this.residualPaths = details.residualPaths ?? [];
  }
}

interface PendingFile extends RegisteredAssetFile {
  asset: Asset | null;
  resultIndex: number | null;
}

export class AssetImportService {
  private readonly projectService: ProjectService;
  private readonly getCurrentProjectSnapshot: (
    projectRoot: string,
  ) => AssetImportRevisionSnapshot | null;
  private readonly fileSystem: AssetImportFileSystemService;
  private readonly hashService: HashService;
  private readonly inspectionService: MediaInspectionService;
  private readonly faults: AssetImportFaultInjector;
  private readonly createId: () => string;
  private readonly now: () => Date;

  constructor(options: AssetImportServiceOptions) {
    this.projectService = options.projectService;
    this.getCurrentProjectSnapshot =
      options.getCurrentProjectSnapshot;
    this.fileSystem =
      options.fileSystem ?? new AssetImportFileSystemService();
    this.hashService = options.hashService ?? new HashService();
    this.inspectionService =
      options.inspectionService ?? new MediaInspectionService();
    this.faults = options.faults ?? {};
    this.createId = options.createId ?? randomUUID;
    this.now = options.now ?? (() => new Date());
  }

  async importCandidates(
    rawRequest: AssetImportDroppedRequest,
  ): Promise<AssetImportOperation> {
    let request: AssetImportDroppedRequest;
    try {
      request = AssetImportDroppedRequestSchema.parse(rawRequest);
    } catch (error) {
      throw new AssetImportServiceError(
        'ASSET_IMPORT_PROJECT_INVALID',
        rawRequest.projectRoot,
        `Asset import request is invalid for ${rawRequest.projectRoot}.`,
        { cause: error },
      );
    }

    try {
      return await this.projectService.transact(
        request.projectRoot,
        async (transaction) => {
          const pendingFiles: PendingFile[] = [];
          try {
            const requestProject = ProjectSchema.parse(request.project);
            const diskProject = transaction.existingDocument.project;
            if (diskProject.id !== requestProject.id) {
              throw new AssetImportServiceError(
                'ASSET_IMPORT_PROJECT_MISMATCH',
                transaction.projectRoot,
                `Cannot import assets: project identity at ${transaction.projectRoot} does not match the open project.`,
              );
            }

            const current = this.assertCurrentRevision(
              transaction.projectRoot,
              requestProject,
              request.baseRevision,
            );

            const baseProject = current.project;
            const hashToAsset = await this.hashExistingAssets(
              transaction.projectRoot,
              baseProject.assets,
            );
            const occupiedNames = new Set(
              baseProject.assets.map((asset) =>
                path.basename(asset.relativePath).toLowerCase(),
              ),
            );
            const results: AssetImportResult[] = [];

            for (const candidate of request.candidates) {
              const sourceName = this.sourceName(candidate.sourcePath);
              let inspected: InspectedMedia;
              try {
                inspected = await this.inspectionService.inspect(
                  candidate.sourcePath,
                  candidate.declaredMimeType,
                );
              } catch (error) {
                results.push(this.inspectionFailure(sourceName, error));
                continue;
              }

              let sha256: string;
              try {
                sha256 = (
                  await this.hashService.hashFile(candidate.sourcePath)
                ).hex;
              } catch {
                results.push({
                  sourceName,
                  status: 'failed',
                  sha256: null,
                  asset: null,
                  duplicateOfAssetId: null,
                  code: 'ASSET_IMPORT_SOURCE_UNREADABLE',
                  message: `无法读取“${sourceName}”进行 SHA-256 校验。`,
                });
                continue;
              }

              const duplicate = hashToAsset.get(sha256);
              if (duplicate) {
                results.push({
                  sourceName,
                  status: 'duplicate',
                  sha256,
                  asset: duplicate,
                  duplicateOfAssetId: duplicate.id,
                  code: null,
                  message: `“${sourceName}”与已有素材“${duplicate.name}”内容相同，已复用原记录。`,
                });
                continue;
              }

              const preferredName = sanitizeAssetFileName(
                sourceName,
                inspected.extension,
              );
              const targetFileName = await this.availableTargetName(
                transaction.projectRoot,
                preferredName,
                sha256,
                occupiedNames,
              );
              let targetPath: string;
              try {
                targetPath =
                  await this.fileSystem.copyIntoAssetsAtomically(
                    transaction.projectRoot,
                    candidate.sourcePath,
                    targetFileName,
                  );
              } catch (error) {
                if (error instanceof AssetImportFileSystemCleanupError) {
                  throw new AssetImportServiceError(
                    'ASSET_IMPORT_ROLLBACK_FAILED',
                    transaction.projectRoot,
                    `Asset copy cleanup is incomplete. Manually remove the residual files: ${error.residualPaths.join(', ')}`,
                    {
                      cause: error,
                      residualPaths: error.residualPaths,
                    },
                  );
                }
                results.push({
                  sourceName,
                  status: 'failed',
                  sha256,
                  asset: null,
                  duplicateOfAssetId: null,
                  code: 'ASSET_IMPORT_COPY_FAILED',
                  message: `无法把“${sourceName}”安全复制到项目 assets 目录。`,
                });
                continue;
              }

              const pending: PendingFile = {
                filePath: targetPath,
                sourceName,
                sha256,
                asset: null,
                resultIndex: null,
              };
              pendingFiles.push(pending);

              let copiedMedia: InspectedMedia;
              try {
                await this.faults.afterFileRegistered?.(pending);
                copiedMedia = await this.inspectionService.inspect(
                  targetPath,
                  inspected.mimeType,
                );
                const copiedHash =
                  await this.hashService.hashFile(targetPath);
                if (copiedHash.hex !== sha256) {
                  throw new Error(
                    'Source content changed while the import copy was in progress.',
                  );
                }
              } catch {
                await this.fileSystem.rollbackImportedFile(targetPath);
                removePendingFile(pendingFiles, targetPath);
                results.push({
                  sourceName,
                  status: 'failed',
                  sha256,
                  asset: null,
                  duplicateOfAssetId: null,
                  code: 'ASSET_IMPORT_COPY_FAILED',
                  message: `“${sourceName}”复制后的内容校验失败，未写入项目。`,
                });
                continue;
              }

              const asset = this.createAsset(
                copiedMedia,
                sourceName,
                targetFileName,
              );
              const resultIndex = results.length;
              results.push({
                sourceName,
                status: 'imported',
                sha256,
                asset,
                duplicateOfAssetId: null,
                code: null,
                message: `已导入“${sourceName}”。`,
              });
              pending.asset = asset;
              pending.resultIndex = resultIndex;
              hashToAsset.set(sha256, asset);
              occupiedNames.add(targetFileName.toLowerCase());
            }

            this.assertCurrentRevision(
              transaction.projectRoot,
              baseProject,
              request.baseRevision,
            );
            if (pendingFiles.length === 0) {
              return {
                project: baseProject,
                baseRevision: request.baseRevision,
                savedRevision: request.baseRevision,
                projectChanged: false,
                results,
              };
            }

            await this.faults.beforeProjectBuild?.(pendingFiles);
            const importedAssets = pendingFiles.map(({ asset }) => {
              if (!asset) {
                throw new Error(
                  'A copied asset reached project construction without a model record.',
                );
              }
              return asset;
            });
            const nextProject = ProjectSchema.parse({
              ...baseProject,
              assets: [...baseProject.assets, ...importedAssets],
              updatedAt: this.now().toISOString(),
            });
            const savedRevision = request.baseRevision + 1;
            this.assertCurrentRevision(
              transaction.projectRoot,
              baseProject,
              request.baseRevision,
            );
            try {
              const savedDocument = await transaction.save(
                nextProject,
                savedRevision,
              );
              pendingFiles.length = 0;
              return {
                project: savedDocument.project,
                baseRevision: request.baseRevision,
                savedRevision,
                projectChanged: true,
                results,
              };
            } catch (error) {
              await this.rollbackPendingFiles(
                transaction.projectRoot,
                pendingFiles,
                error,
              );
              for (const pending of pendingFiles) {
                if (pending.resultIndex === null) continue;
                results[pending.resultIndex] = {
                  sourceName: pending.sourceName,
                  status: 'failed',
                  sha256: pending.sha256,
                  asset: null,
                  duplicateOfAssetId: null,
                  code: 'ASSET_IMPORT_SAVE_FAILED',
                  message:
                    '素材已回滚：项目保存失败，project.json 和 Asset 列表保持不变。',
                };
              }
              pendingFiles.length = 0;
              return {
                project: baseProject,
                baseRevision: request.baseRevision,
                savedRevision: request.baseRevision,
                projectChanged: false,
                results,
              };
            }
          } catch (error) {
            if (
              error instanceof AssetImportServiceError &&
              error.code === 'ASSET_IMPORT_ROLLBACK_FAILED'
            ) {
              throw error;
            }
            if (pendingFiles.length > 0) {
              await this.rollbackPendingFiles(
                transaction.projectRoot,
                pendingFiles,
                error,
              );
            }
            throw error;
          }
        },
      );
    } catch (error) {
      if (error instanceof AssetImportServiceError) throw error;
      throw new AssetImportServiceError(
        'ASSET_IMPORT_OPERATION_FAILED',
        request.projectRoot,
        `Asset import failed for ${request.projectRoot}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  private currentRevisionSnapshot(
    projectRoot: string,
  ): AssetImportRevisionSnapshot {
    const snapshot = this.getCurrentProjectSnapshot(projectRoot);
    if (!snapshot) {
      throw new AssetImportServiceError(
        'ASSET_IMPORT_STALE_REVISION',
        projectRoot,
        `Main has no active revision for ${projectRoot}. Reopen the project and retry the import.`,
      );
    }
    const project = ProjectSchema.parse(snapshot.project);
    if (!Number.isInteger(snapshot.revision) || snapshot.revision < 0) {
      throw new AssetImportServiceError(
        'ASSET_IMPORT_PROJECT_INVALID',
        projectRoot,
        `Main has an invalid project revision for ${projectRoot}.`,
      );
    }
    return { project, revision: snapshot.revision };
  }

  private assertCurrentRevision(
    projectRoot: string,
    requestProject: Project,
    baseRevision: number,
  ): AssetImportRevisionSnapshot {
    const current = this.currentRevisionSnapshot(projectRoot);
    if (current.project.id !== requestProject.id) {
      throw new AssetImportServiceError(
        'ASSET_IMPORT_PROJECT_MISMATCH',
        projectRoot,
        `Cannot import assets: Main tracks a different project identity at ${projectRoot}.`,
      );
    }
    if (
      baseRevision !== current.revision ||
      !projectsEqual(requestProject, current.project)
    ) {
      throw new AssetImportServiceError(
        'ASSET_IMPORT_STALE_REVISION',
        projectRoot,
        `Asset import revision ${baseRevision} is stale; Main currently has revision ${current.revision}. Refresh the project snapshot and retry.`,
        {
          currentProject: current.project,
          currentRevision: current.revision,
        },
      );
    }
    return current;
  }

  private async hashExistingAssets(
    projectRoot: string,
    assets: Asset[],
  ): Promise<Map<string, Asset>> {
    const hashToAsset = new Map<string, Asset>();
    for (const asset of assets) {
      const assetPath = path.resolve(projectRoot, asset.relativePath);
      const assetsRoot = `${path.resolve(projectRoot, 'assets')}${path.sep}`;
      if (
        assetPath !== path.resolve(projectRoot, 'assets') &&
        !assetPath.toLowerCase().startsWith(assetsRoot.toLowerCase())
      ) {
        continue;
      }
      try {
        hashToAsset.set(
          (await this.hashService.hashFile(assetPath)).hex,
          asset,
        );
      } catch {
        // A broken existing reference must not be treated as a duplicate.
      }
    }
    return hashToAsset;
  }

  private async availableTargetName(
    projectRoot: string,
    preferredName: string,
    sha256: string,
    occupiedNames: Set<string>,
  ): Promise<string> {
    if (
      !occupiedNames.has(preferredName.toLowerCase()) &&
      !(await this.fileSystem.fileExists(
        this.fileSystem.assetPath(projectRoot, preferredName),
      ))
    ) {
      return preferredName;
    }
    const extension = path.extname(preferredName);
    const stem = path.basename(preferredName, extension);
    const hashSuffix = sha256.slice(0, 8);
    for (let counter = 1; counter <= 10_000; counter += 1) {
      const suffix =
        counter === 1 ? hashSuffix : `${hashSuffix}-${counter}`;
      const candidate = `${stem}-${suffix}${extension}`;
      if (
        !occupiedNames.has(candidate.toLowerCase()) &&
        !(await this.fileSystem.fileExists(
          this.fileSystem.assetPath(projectRoot, candidate),
        ))
      ) {
        return candidate;
      }
    }
    throw new Error(`Could not allocate a safe target for ${preferredName}.`);
  }

  private createAsset(
    inspected: InspectedMedia,
    sourceName: string,
    targetFileName: string,
  ): Asset {
    const base = {
      id: this.createId(),
      name: assetDisplayName(sourceName),
      relativePath: `assets/${targetFileName}`,
      mimeType: inspected.mimeType,
    };
    return AssetSchema.parse(
      inspected.kind === 'image'
        ? {
            ...base,
            kind: 'image',
            width: inspected.width,
            height: inspected.height,
          }
        : {
            ...base,
            kind: 'audio',
          },
    );
  }

  private inspectionFailure(
    sourceName: string,
    error: unknown,
  ): AssetImportResult {
    const normalized =
      error instanceof MediaInspectionError
        ? error
        : new MediaInspectionError(
            'ASSET_IMPORT_INVALID_CONTENT',
            `无法验证“${sourceName}”的真实媒体内容。`,
            { cause: error },
          );
    return {
      sourceName,
      status: 'rejected',
      sha256: null,
      asset: null,
      duplicateOfAssetId: null,
      code: normalized.code,
      message: normalized.message,
    };
  }

  private async rollbackPendingFiles(
    projectRoot: string,
    pendingFiles: readonly PendingFile[],
    cause: unknown,
  ): Promise<void> {
    const failures: Array<{ path: string; error: unknown }> = [];
    for (const pending of pendingFiles) {
      try {
        await this.fileSystem.rollbackImportedFile(pending.filePath);
      } catch (error) {
        failures.push({ path: pending.filePath, error });
      }
    }
    if (failures.length > 0) {
      const residualPaths = failures.map(({ path: filePath }) => filePath);
      throw new AssetImportServiceError(
        'ASSET_IMPORT_ROLLBACK_FAILED',
        projectRoot,
        `Asset import rollback failed; manual cleanup is required for: ${residualPaths.join(', ')}`,
        {
          cause,
          residualPaths,
        },
      );
    }
  }

  private sourceName(sourcePath: string): string {
    return safeUtf16Slice(
      path.basename(sourcePath).trim() || 'unnamed asset',
      260,
    );
  }
}

export function assetDisplayName(sourceName: string): string {
  const sourceExtension = path.extname(sourceName);
  const normalized = path
    .basename(sourceName, sourceExtension)
    .normalize('NFC')
    .replace(/\p{Cc}/gu, '_')
    .trim();
  return safeUtf16Slice(normalized || 'Imported asset', 200);
}

export function sanitizeAssetFileName(
  sourceName: string,
  extension: InspectedMedia['extension'],
): string {
  const sourceExtension = path.extname(sourceName);
  const rawStem = path.basename(sourceName, sourceExtension);
  const normalizedStem =
    rawStem
      .normalize('NFC')
      .replace(/[\p{Cc}<>:"/\\|?*]/gu, '_')
      .replace(/\s+/gu, ' ')
      .replace(/[. ]+$/gu, '')
      .trim() || 'asset';
  const safeStem = safeUtf16Slice(normalizedStem, 120);
  const stem = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu.test(
    safeStem,
  )
    ? `_${safeStem}`
    : safeStem;
  return `${stem}${extension}`;
}

function projectsEqual(left: Project, right: Project): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function removePendingFile(
  pendingFiles: PendingFile[],
  filePath: string,
): void {
  const index = pendingFiles.findIndex(
    (pending) => pending.filePath === filePath,
  );
  if (index >= 0) pendingFiles.splice(index, 1);
}

function safeUtf16Slice(value: string, maximumLength: number): string {
  let result = value.slice(0, maximumLength);
  const lastCodeUnit = result.charCodeAt(result.length - 1);
  if (lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff) {
    result = result.slice(0, -1);
  }
  return result;
}
