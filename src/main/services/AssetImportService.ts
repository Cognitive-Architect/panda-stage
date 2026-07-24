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
import { AssetImportFileSystemService } from './AssetImportFileSystemService';
import { HashService } from './HashService';
import {
  MediaInspectionError,
  MediaInspectionService,
  type InspectedMedia,
} from './MediaInspectionService';
import { ProjectService } from './ProjectService';

export interface AssetImportServiceOptions {
  projectService: ProjectService;
  fileSystem?: AssetImportFileSystemService;
  hashService?: HashService;
  inspectionService?: MediaInspectionService;
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

export class AssetImportServiceError extends Error {
  constructor(
    readonly code:
      | 'ASSET_IMPORT_PROJECT_MISMATCH'
      | 'ASSET_IMPORT_PROJECT_INVALID'
      | 'ASSET_IMPORT_OPERATION_FAILED',
    readonly projectRoot: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'AssetImportServiceError';
  }
}

interface ImportedFile {
  filePath: string;
  asset: Asset;
  resultIndex: number;
}

export class AssetImportService {
  private readonly projectService: ProjectService;
  private readonly fileSystem: AssetImportFileSystemService;
  private readonly hashService: HashService;
  private readonly inspectionService: MediaInspectionService;
  private readonly createId: () => string;
  private readonly now: () => Date;

  constructor(options: AssetImportServiceOptions) {
    this.projectService = options.projectService;
    this.fileSystem =
      options.fileSystem ?? new AssetImportFileSystemService();
    this.hashService = options.hashService ?? new HashService();
    this.inspectionService =
      options.inspectionService ?? new MediaInspectionService();
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
          const requestProject = ProjectSchema.parse(request.project);
          if (
            transaction.existingDocument.project.id !== requestProject.id
          ) {
            throw new AssetImportServiceError(
              'ASSET_IMPORT_PROJECT_MISMATCH',
              transaction.projectRoot,
              `Cannot import assets: project identity at ${transaction.projectRoot} does not match the open project.`,
            );
          }

          const hashToAsset = await this.hashExistingAssets(
            transaction.projectRoot,
            requestProject.assets,
          );
          const occupiedNames = new Set(
            requestProject.assets.map((asset) =>
              path.basename(asset.relativePath).toLowerCase(),
            ),
          );
          const results: AssetImportResult[] = [];
          const importedFiles: ImportedFile[] = [];

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
              targetPath = await this.fileSystem.copyIntoAssetsAtomically(
                transaction.projectRoot,
                candidate.sourcePath,
                targetFileName,
              );
            } catch {
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

            let copiedMedia: InspectedMedia;
            try {
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
            importedFiles.push({ filePath: targetPath, asset, resultIndex });
            hashToAsset.set(sha256, asset);
            occupiedNames.add(targetFileName.toLowerCase());
          }

          if (importedFiles.length === 0) {
            return {
              project: requestProject,
              baseRevision: request.baseRevision,
              savedRevision: request.baseRevision,
              projectChanged: false,
              results,
            };
          }

          const nextProject = ProjectSchema.parse({
            ...requestProject,
            assets: [
              ...requestProject.assets,
              ...importedFiles.map(({ asset }) => asset),
            ],
            updatedAt: this.now().toISOString(),
          });
          const savedRevision = request.baseRevision + 1;
          try {
            const savedDocument = await transaction.save(
              nextProject,
              savedRevision,
            );
            return {
              project: savedDocument.project,
              baseRevision: request.baseRevision,
              savedRevision,
              projectChanged: true,
              results,
            };
          } catch {
            await this.rollbackImportedFiles(importedFiles);
            for (const imported of importedFiles) {
              results[imported.resultIndex] = {
                sourceName:
                  results[imported.resultIndex]?.sourceName ??
                  path.basename(imported.filePath),
                status: 'failed',
                sha256: results[imported.resultIndex]?.sha256 ?? null,
                asset: null,
                duplicateOfAssetId: null,
                code: 'ASSET_IMPORT_SAVE_FAILED',
                message:
                  '素材已回滚：项目保存失败，project.json 和 Asset 列表保持不变。',
              };
            }
            return {
              project: requestProject,
              baseRevision: request.baseRevision,
              savedRevision: request.baseRevision,
              projectChanged: false,
              results,
            };
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
      const suffix = counter === 1 ? hashSuffix : `${hashSuffix}-${counter}`;
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
      name:
        path.basename(sourceName, path.extname(sourceName)).trim() ||
        'Imported asset',
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

  private async rollbackImportedFiles(
    importedFiles: ImportedFile[],
  ): Promise<void> {
    const failures: string[] = [];
    for (const imported of importedFiles) {
      try {
        await this.fileSystem.rollbackImportedFile(imported.filePath);
      } catch (error) {
        failures.push(
          `${imported.filePath}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    if (failures.length > 0) {
      throw new Error(
        `Asset import save failed and rollback was incomplete: ${failures.join('; ')}`,
      );
    }
  }

  private sourceName(sourcePath: string): string {
    return (path.basename(sourcePath).trim() || 'unnamed asset').slice(
      0,
      260,
    );
  }
}

export function sanitizeAssetFileName(
  sourceName: string,
  extension: InspectedMedia['extension'],
): string {
  const sourceExtension = path.extname(sourceName);
  const rawStem = path.basename(sourceName, sourceExtension);
  const stem =
    rawStem
      .normalize('NFC')
      .replace(/[\p{Cc}<>:"/\\|?*]/gu, '_')
      .replace(/\s+/gu, ' ')
      .replace(/[. ]+$/gu, '')
      .trim()
      .slice(0, 120) || 'asset';
  return `${stem}${extension}`;
}
