import { randomUUID } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  buildImportedProjectCandidate,
  buildProjectResourceImportCatalog,
  buildProjectResourceImportPreview,
  collectProjectResourceClosure,
  collectProjectUuidValues,
  findProvablyReusableTargetAssets,
  ProjectSchema,
  type Asset,
  type Character,
  type PlannedAssetTransfer,
  type Project,
  type ProjectAnimationDefinition,
  type VoiceProfile,
} from '../../domain';
import {
  ProjectResourceImportApplyRequestSchema,
  ProjectResourceImportChooseRequestSchema,
  ProjectResourceImportChooseResponseSchema,
  ProjectResourceImportPreviewRequestSchema,
  ProjectResourceImportPreviewResponseSchema,
  type ProjectResourceImportApplyRequest,
  type ProjectResourceImportChooseRequest,
  type ProjectResourceImportChooseResponse,
  type ProjectResourceImportErrorCode,
  type ProjectResourceImportOption,
  type ProjectResourceImportPreviewRequest,
  type ProjectResourceImportPreviewResponse,
  type ProjectResourceImportSelection,
} from '../../shared/project-resource-import-api';
import {
  allocateAssetTargetName,
  sanitizeAssetFileName,
} from './AssetImportService';
import type { AssetFileExtension } from '../../shared/asset-name';
import {
  AssetImportFileSystemCleanupError,
  AssetImportFileSystemService,
} from './AssetImportFileSystemService';
import { HashService } from './HashService';
import { MediaInspectionService } from './MediaInspectionService';
import { PathService } from './PathService';
import { ProjectService } from './ProjectService';
import { resolveProjectAssetPath } from './project-asset-path';

const MAX_SELECTIONS = 100;
const MAX_ACTIVE_SELECTIONS = 16;
const SELECTION_TTL_MS = 15 * 60 * 1_000;
const MAX_SVG_BYTES = 20 * 1024 * 1024;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface ProjectResourceImportSnapshot {
  project: Project;
  revision: number;
  openInstanceId?: number | null;
}

export interface ProjectResourceImportServiceOptions {
  projectService: ProjectService;
  getCurrentProjectSnapshot: (
    projectRoot: string,
  ) => ProjectResourceImportSnapshot | null;
  fileSystem?: AssetImportFileSystemService;
  hashService?: HashService;
  inspectionService?: MediaInspectionService;
  pathService?: PathService;
  createId?: () => string;
  now?: () => Date;
}

export interface ProjectResourceImportOperation {
  projectRoot: string;
  projectId: string;
  openInstanceId?: number;
  project: Project;
  baseRevision: number;
  savedRevision: number;
  sourceProjectName: string;
  importedAssets: Asset[];
  reusedAssetIds: string[];
  importedAnimations: ProjectAnimationDefinition[];
  importedCharacters: Character[];
  importedVoiceProfiles: VoiceProfile[];
  nameConflicts: Array<{
    kind: 'character' | 'animation';
    sourceName: string;
    resolvedName: string;
  }>;
}

interface SelectionSession {
  sourceToken: string;
  createdAt: number;
  targetRoot: string;
  targetProject: Project;
  targetRevision: number;
  targetOpenInstanceId: number | null;
  sourceRoot: string;
  sourceProject: Project;
  sourceProjectName: string;
  options: ProjectResourceImportOption[];
}

interface PreflightSourceAsset {
  sourceAsset: Asset;
  sourcePath: string;
  sha256: string;
  extension: AssetFileExtension;
}

interface ServiceErrorDetails extends ErrorOptions {
  currentProject?: Project;
  currentRevision?: number;
  residualPaths?: readonly string[];
}

export class ProjectResourceImportServiceError extends Error {
  readonly currentProject?: Project;
  readonly currentRevision?: number;
  readonly residualPaths: readonly string[];

  constructor(
    readonly code: ProjectResourceImportErrorCode,
    readonly projectRoot: string,
    message: string,
    details: ServiceErrorDetails = {},
  ) {
    super(message, { cause: details.cause });
    this.name = 'ProjectResourceImportServiceError';
    this.currentProject = details.currentProject;
    this.currentRevision = details.currentRevision;
    this.residualPaths = details.residualPaths ?? [];
  }
}

export class ProjectResourceImportService {
  private readonly projectService: ProjectService;
  private readonly getCurrentProjectSnapshot: (
    projectRoot: string,
  ) => ProjectResourceImportSnapshot | null;
  private readonly fileSystem: AssetImportFileSystemService;
  private readonly hashService: HashService;
  private readonly inspectionService: MediaInspectionService;
  private readonly pathService: PathService;
  private readonly createId: () => string;
  private readonly now: () => Date;
  private readonly selections = new Map<string, SelectionSession>();

  constructor(options: ProjectResourceImportServiceOptions) {
    this.projectService = options.projectService;
    this.getCurrentProjectSnapshot = options.getCurrentProjectSnapshot;
    this.fileSystem = options.fileSystem ?? new AssetImportFileSystemService();
    this.hashService = options.hashService ?? new HashService();
    this.inspectionService =
      options.inspectionService ?? new MediaInspectionService();
    this.pathService = options.pathService ?? new PathService();
    this.createId = options.createId ?? randomUUID;
    this.now = options.now ?? (() => new Date());
  }

  async selectSourceProject(
    rawRequest: ProjectResourceImportChooseRequest,
    rawSourceRoot: string,
  ): Promise<ProjectResourceImportChooseResponse> {
    const request = ProjectResourceImportChooseRequestSchema.parse(rawRequest);
    const targetRoot = this.pathService.resolve(request.projectRoot);
    let sourceRoot: string;
    try {
      sourceRoot = this.pathService.resolve(rawSourceRoot);
      const [realTargetRoot, realSourceRoot] = await Promise.all([
        realpath(targetRoot),
        realpath(sourceRoot),
      ]);
      if (this.pathService.same(realTargetRoot, realSourceRoot)) {
        throw this.error(
          'PROJECT_RESOURCE_SOURCE_EQUALS_TARGET',
          targetRoot,
          '当前项目不能作为导入来源。',
        );
      }
    } catch (error) {
      if (error instanceof ProjectResourceImportServiceError) throw error;
      throw this.error(
        'PROJECT_RESOURCE_SOURCE_INVALID',
        targetRoot,
        '无法读取所选项目。请选择可用的 Panda Stage 项目文件夹。',
        { cause: error },
      );
    }

    const target = this.assertTargetSnapshot(
      targetRoot,
      request.project,
      request.baseRevision,
      request.openInstanceId,
    );

    let sourceProject: Project;
    try {
      sourceProject = (await this.projectService.openReadOnly(sourceRoot)).project;
    } catch (error) {
      throw this.error(
        'PROJECT_RESOURCE_SOURCE_INVALID',
        targetRoot,
        '无法读取所选项目，或项目版本/引用格式不受支持。',
        { cause: error },
      );
    }

    const options = buildProjectResourceImportCatalog(
      sourceProject,
      target.project,
    );
    this.pruneSelections();
    while (this.selections.size >= MAX_ACTIVE_SELECTIONS) {
      const oldest = this.selections.keys().next().value;
      if (!oldest) break;
      this.selections.delete(oldest);
    }
    const sourceToken = this.createUniqueId(new Set());
    const session: SelectionSession = {
      sourceToken,
      createdAt: this.now().getTime(),
      targetRoot,
      targetProject: target.project,
      targetRevision: target.revision,
      targetOpenInstanceId: request.openInstanceId ?? target.openInstanceId ?? null,
      sourceRoot,
      sourceProject,
      sourceProjectName: sourceProject.name,
      options,
    };
    this.selections.set(sourceToken, session);

    return ProjectResourceImportChooseResponseSchema.parse({
      ok: true,
      status: 'selected',
      sourceToken,
      sourceProjectName: session.sourceProjectName,
      items: options,
    });
  }

  /**
   * Read-only preview of selected items and their forward dependency closure.
   * Performs zero disk writes.
   */
  previewImport(
    rawRequest: ProjectResourceImportPreviewRequest,
  ): ProjectResourceImportPreviewResponse {
    const request = ProjectResourceImportPreviewRequestSchema.parse(rawRequest);
    const targetRoot = this.pathService.resolve(request.projectRoot);
    const session = this.getSelection(request.sourceToken);
    if (!session || !this.pathService.same(session.targetRoot, targetRoot)) {
      throw this.error(
        'PROJECT_RESOURCE_SELECTION_STALE',
        targetRoot,
        '来源选择已过期，请重新选择来源项目。',
      );
    }
    const target = this.assertTargetSnapshot(
      targetRoot,
      request.project,
      request.baseRevision,
      request.openInstanceId,
    );
    const plan = buildProjectResourceImportPreview(
      session.sourceProject,
      target.project,
      request.resources,
      request.reuseIdenticalAssets ?? false,
    );
    return ProjectResourceImportPreviewResponseSchema.parse({
      ok: true,
      ...plan,
    });
  }

  async importResources(
    rawRequest: ProjectResourceImportApplyRequest,
  ): Promise<ProjectResourceImportOperation> {
    const request = ProjectResourceImportApplyRequestSchema.parse(rawRequest);
    const targetRoot = this.pathService.resolve(request.projectRoot);
    const session = this.getSelection(request.sourceToken);
    if (!session || !this.pathService.same(session.targetRoot, targetRoot)) {
      throw this.error(
        'PROJECT_RESOURCE_SELECTION_STALE',
        targetRoot,
        '来源选择已过期，请重新选择来源项目。',
      );
    }
    if (
      request.baseRevision !== session.targetRevision ||
      request.project.id !== session.targetProject.id ||
      !projectsEqual(request.project, session.targetProject)
    ) {
      throw this.error(
        'PROJECT_RESOURCE_TARGET_STALE',
        targetRoot,
        '目标项目在选择来源后已发生变化，请重新开始导入。',
      );
    }

    this.assertTargetSnapshot(
      targetRoot,
      request.project,
      request.baseRevision,
      request.openInstanceId,
    );

    let latestSource: Project;
    try {
      latestSource = (await this.projectService.openReadOnly(session.sourceRoot))
        .project;
    } catch (error) {
      throw this.error(
        'PROJECT_RESOURCE_SOURCE_INVALID',
        targetRoot,
        '来源项目已不可用或内容无法读取，请重新选择来源项目。',
        { cause: error },
      );
    }
    if (!projectsEqual(latestSource, session.sourceProject)) {
      throw this.error(
        'PROJECT_RESOURCE_SELECTION_STALE',
        targetRoot,
        '来源项目在选择后已发生变化，请重新选择来源项目。',
      );
    }

    const selected = this.resolveSelection(session, request.resources);
    const closure = collectProjectResourceClosure(session.sourceProject, selected);
    if (closure.issues.length > 0) {
      throw this.error(
        'PROJECT_RESOURCE_SELECTION_UNSUPPORTED',
        targetRoot,
        closure.issues.slice(0, 6).join('；'),
      );
    }
    const preflight = await this.preflightSourceAssets(
      session.sourceRoot,
      closure.assets,
      targetRoot,
    );

    const copiedPaths: string[] = [];

    try {
      const operation = await this.projectService.transact(
        targetRoot,
        async (transaction) => {
          const current = this.assertTargetSnapshot(
            targetRoot,
            request.project,
            request.baseRevision,
            request.openInstanceId,
          );
          if (transaction.existingDocument.project.id !== current.project.id) {
            throw this.error(
              'PROJECT_RESOURCE_TARGET_STALE',
              targetRoot,
              '目标项目身份已变化，导入已取消。',
            );
          }

          const usedIds = new Set([
            ...collectProjectUuidValues(current.project),
            ...collectProjectUuidValues(session.sourceProject),
          ]);
          const occupiedFileNames = new Set(
            current.project.assets.map((asset) =>
              path.basename(asset.relativePath).toLocaleLowerCase('en-US'),
            ),
          );

          const plannedAssets: PlannedAssetTransfer[] = [];
          const filesToCopy: Array<{
            sourcePath: string;
            fileName: string;
            sha256: string;
            assetName: string;
          }> = [];

          for (const item of preflight) {
            let reusable: Asset | null = null;
            if (request.reuseIdenticalAssets) {
              const candidates = findProvablyReusableTargetAssets(
                current.project,
                item.sourceAsset,
                item.sha256,
              );
              for (const candidateAsset of candidates) {
                const verified = await this.verifyReusableTargetAsset(
                  transaction.projectRoot,
                  candidateAsset,
                  item.sha256,
                  item.sourceAsset,
                );
                if (verified) {
                  reusable = candidateAsset;
                  break;
                }
              }
            }

            if (reusable) {
              plannedAssets.push({
                sourceAsset: item.sourceAsset,
                targetId: reusable.id,
                reused: true,
                targetRelativePath: reusable.relativePath,
                sha256: item.sha256,
              });
              continue;
            }

            const targetId = this.createUniqueId(usedIds);
            const preferredName = sanitizeAssetFileName(
              path.basename(item.sourceAsset.relativePath),
              item.extension,
            );
            const targetFileName = await allocateAssetTargetName(
              this.fileSystem,
              transaction.projectRoot,
              preferredName,
              item.sha256,
              occupiedFileNames,
            );
            occupiedFileNames.add(targetFileName.toLocaleLowerCase('en-US'));
            plannedAssets.push({
              sourceAsset: item.sourceAsset,
              targetId,
              reused: false,
              targetRelativePath: `assets/${targetFileName}`,
              sha256: item.sha256,
            });
            filesToCopy.push({
              sourcePath: item.sourcePath,
              fileName: targetFileName,
              sha256: item.sha256,
              assetName: item.sourceAsset.name,
            });
          }

          // Validate candidate Project BEFORE copying any files so schema/reference
          // errors fail cleanly with zero filesystem writes.
          const candidate = buildImportedProjectCandidate({
            targetProject: current.project,
            sourceProject: session.sourceProject,
            closure,
            plannedAssets,
            createId: this.createId,
            updatedAtIso: this.now().toISOString(),
          });

          for (const file of filesToCopy) {
            const targetPath = await this.fileSystem.copyIntoAssetsAtomically(
              transaction.projectRoot,
              file.sourcePath,
              file.fileName,
            );
            copiedPaths.push(targetPath);
            const copiedHash = await this.hashService.hashFile(targetPath);
            if (copiedHash.hex !== file.sha256) {
              throw this.error(
                'PROJECT_RESOURCE_SOURCE_INVALID',
                targetRoot,
                `“${file.assetName}”复制时内容发生变化，请重新选择来源并预览导入。`,
              );
            }
          }

          const savedRevision = request.baseRevision + 1;
          const document = await transaction.save(
            candidate.project,
            savedRevision,
            () => {
              this.assertTargetSnapshot(
                targetRoot,
                request.project,
                request.baseRevision,
                request.openInstanceId,
              );
            },
          );
          copiedPaths.length = 0;

          return {
            projectRoot: targetRoot,
            projectId: document.project.id,
            ...(request.openInstanceId !== undefined
              ? { openInstanceId: request.openInstanceId }
              : {}),
            project: document.project,
            baseRevision: request.baseRevision,
            savedRevision,
            sourceProjectName: session.sourceProjectName,
            importedAssets: candidate.importedAssets,
            reusedAssetIds: candidate.reusedAssetIds,
            importedAnimations: candidate.importedAnimations,
            importedCharacters: candidate.importedCharacters,
            importedVoiceProfiles: candidate.importedVoiceProfiles,
            nameConflicts: candidate.nameConflicts,
          };
        },
      );
      this.selections.delete(request.sourceToken);
      return operation;
    } catch (error) {
      const residualPaths: string[] =
        error instanceof AssetImportFileSystemCleanupError
          ? [...error.residualPaths]
          : [];
      const seenResiduals = new Set(residualPaths);

      if (copiedPaths.length > 0) {
        for (const copiedPath of [...copiedPaths].reverse()) {
          try {
            await this.fileSystem.rollbackImportedFile(copiedPath);
          } catch {
            if (!seenResiduals.has(copiedPath)) {
              seenResiduals.add(copiedPath);
              residualPaths.push(copiedPath);
            }
          }
        }
        copiedPaths.length = 0;
      }

      if (residualPaths.length > 0) {
        throw this.error(
          'PROJECT_RESOURCE_ROLLBACK_FAILED',
          targetRoot,
          error instanceof AssetImportFileSystemCleanupError
            ? '复制文件清理未完成，请手动检查目标项目中的残留文件。'
            : '导入失败且部分新文件未能清理，请手动检查目标项目中的残留文件。',
          { cause: error, residualPaths },
        );
      }
      if (error instanceof ProjectResourceImportServiceError) throw error;
      throw this.error(
        'PROJECT_RESOURCE_OPERATION_FAILED',
        targetRoot,
        '跨项目导入失败，目标项目未发生更改。',
        { cause: error },
      );
    }
  }

  private resolveSelection(
    session: SelectionSession,
    selections: readonly ProjectResourceImportSelection[],
  ): ProjectResourceImportSelection[] {
    if (selections.length > MAX_SELECTIONS) {
      throw this.error(
        'PROJECT_RESOURCE_SELECTION_UNSUPPORTED',
        session.targetRoot,
        `一次最多选择 ${MAX_SELECTIONS} 项。`,
      );
    }
    const optionByKey = new Map(
      session.options.map((option) => [resourceKey(option), option]),
    );
    const seen = new Set<string>();
    const selected: ProjectResourceImportSelection[] = [];
    const unsupported: string[] = [];
    for (const selection of selections) {
      const key = resourceKey(selection);
      if (seen.has(key)) continue;
      seen.add(key);
      const option = optionByKey.get(key);
      if (!option) {
        unsupported.push('所选资源已不存在');
      } else if (!option.supported) {
        unsupported.push(`${option.name}：${option.reason ?? '无法导入'}`);
      } else {
        selected.push(selection);
      }
    }
    if (unsupported.length > 0) {
      throw this.error(
        'PROJECT_RESOURCE_SELECTION_UNSUPPORTED',
        session.targetRoot,
        unsupported.slice(0, 8).join('；'),
      );
    }
    return selected;
  }

  private async preflightSourceAssets(
    sourceRoot: string,
    assets: readonly Asset[],
    targetRoot: string,
  ): Promise<PreflightSourceAsset[]> {
    const planned: PreflightSourceAsset[] = [];
    for (const sourceAsset of assets) {
      const sourcePath = await resolveProjectAssetPath(
        sourceRoot,
        sourceAsset.relativePath,
        { preservePermissionErrors: true },
      ).catch((error: unknown) => {
        throw this.error(
          'PROJECT_RESOURCE_SOURCE_INVALID',
          targetRoot,
          `无法安全读取“${sourceAsset.name}”。`,
          { cause: error },
        );
      });
      if (!sourcePath) {
        throw this.error(
          'PROJECT_RESOURCE_SOURCE_INVALID',
          targetRoot,
          `“${sourceAsset.name}”文件缺失或路径不安全，请检查来源项目后重新预览导入。`,
        );
      }

      const normalizedMime = sourceAsset.mimeType.trim().toLowerCase();
      if (sourceAsset.kind === 'image' && normalizedMime === 'image/svg+xml') {
        const verified = await this.inspectSvgAsset(
          sourcePath,
          sourceAsset,
          targetRoot,
        );
        planned.push(verified);
        continue;
      }

      if (sourceAsset.kind === 'image' || sourceAsset.kind === 'audio') {
        let media;
        let sha256: string;
        try {
          media = await this.inspectionService.inspect(
            sourcePath,
            sourceAsset.mimeType,
          );
          sha256 = (await this.hashService.hashFile(sourcePath)).hex;
        } catch (error) {
          throw this.error(
            'PROJECT_RESOURCE_SOURCE_INVALID',
            targetRoot,
            `“${sourceAsset.name}”不是可用的受支持媒体文件。`,
            { cause: error },
          );
        }
        const dimensionsMismatch =
          sourceAsset.kind === 'image' &&
          (media.width !== sourceAsset.width ||
            media.height !== sourceAsset.height);
        if (
          media.kind !== sourceAsset.kind ||
          media.mimeType !== normalizedMime ||
          dimensionsMismatch ||
          (sourceAsset.sha256 && sourceAsset.sha256 !== sha256)
        ) {
          throw this.error(
            'PROJECT_RESOURCE_SOURCE_INVALID',
            targetRoot,
            `“${sourceAsset.name}”的文件内容与项目记录不一致，请检查来源项目后重新预览导入。`,
          );
        }
        planned.push({
          sourceAsset,
          sourcePath,
          sha256,
          extension: media.extension,
        });
        continue;
      }

      throw this.error(
        'PROJECT_RESOURCE_SELECTION_UNSUPPORTED',
        targetRoot,
        `“${sourceAsset.name}”的资源类型暂不支持跨项目导入。`,
      );
    }
    return planned;
  }

  /**
   * Verifies a JSON-indexed target asset candidate against the actual on-disk
   * file in `targetRoot/assets` before allowing reuse. Only inspects the
   * specific candidate file (no repo-wide hashing); missing, replaced, escaped,
   * or incompatible files return `false` so the caller safely falls back to
   * copying a fresh non-colliding file.
   */
  private async verifyReusableTargetAsset(
    targetRoot: string,
    candidate: Asset,
    expectedSourceSha256: string,
    sourceAsset: Asset,
  ): Promise<boolean> {
    let targetPath: string | null;
    try {
      targetPath = await resolveProjectAssetPath(
        targetRoot,
        candidate.relativePath,
        { preservePermissionErrors: true },
      );
    } catch {
      return false;
    }
    if (!targetPath) return false;

    const normalizedMime = candidate.mimeType.trim().toLowerCase();
    if (candidate.kind === 'image' && normalizedMime === 'image/svg+xml') {
      if (path.extname(targetPath).toLowerCase() !== '.svg') return false;
      try {
        const stats = await stat(targetPath);
        if (!stats.isFile() || stats.size === 0 || stats.size > MAX_SVG_BYTES) {
          return false;
        }
        const content = await readFile(targetPath, 'utf8');
        if (!/<svg[\s>]/iu.test(content)) return false;
        const actualSha256 = (await this.hashService.hashFile(targetPath)).hex;
        return actualSha256 === expectedSourceSha256;
      } catch {
        return false;
      }
    }

    if (candidate.kind === 'image' || candidate.kind === 'audio') {
      try {
        const media = await this.inspectionService.inspect(
          targetPath,
          candidate.mimeType,
        );
        const actualSha256 = (await this.hashService.hashFile(targetPath)).hex;
        if (actualSha256 !== expectedSourceSha256) return false;
        if (media.kind !== candidate.kind || media.mimeType !== normalizedMime) {
          return false;
        }
        if (
          candidate.kind === 'image' &&
          sourceAsset.kind === 'image' &&
          (media.width !== sourceAsset.width ||
            media.height !== sourceAsset.height ||
            media.width !== candidate.width ||
            media.height !== candidate.height)
        ) {
          return false;
        }
        return true;
      } catch {
        return false;
      }
    }

    return false;
  }

  private async inspectSvgAsset(
    sourcePath: string,
    sourceAsset: Asset,
    targetRoot: string,
  ): Promise<PreflightSourceAsset> {
    if (path.extname(sourcePath).toLowerCase() !== '.svg') {
      throw this.error(
        'PROJECT_RESOURCE_SOURCE_INVALID',
        targetRoot,
        `“${sourceAsset.name}”不是有效的 SVG 文件。`,
      );
    }
    let sha256: string;
    try {
      const stats = await stat(sourcePath);
      if (!stats.isFile() || stats.size === 0 || stats.size > MAX_SVG_BYTES) {
        throw new Error('SVG asset size is invalid.');
      }
      const content = await readFile(sourcePath, 'utf8');
      if (!/<svg[\s>]/iu.test(content)) {
        throw new Error('File does not contain an SVG root element.');
      }
      sha256 = (await this.hashService.hashFile(sourcePath)).hex;
    } catch (error) {
      throw this.error(
        'PROJECT_RESOURCE_SOURCE_INVALID',
        targetRoot,
        `“${sourceAsset.name}”不是可用的 SVG 矢量资源。`,
        { cause: error },
      );
    }
    if (sourceAsset.sha256 && sourceAsset.sha256 !== sha256) {
      throw this.error(
        'PROJECT_RESOURCE_SOURCE_INVALID',
        targetRoot,
        `“${sourceAsset.name}”的 SVG 内容与项目记录不一致，请检查来源项目后重新预览导入。`,
      );
    }
    return {
      sourceAsset,
      sourcePath,
      sha256,
      extension: '.svg',
    };
  }

  private assertTargetSnapshot(
    projectRoot: string,
    requestProject: Project,
    baseRevision: number,
    openInstanceId?: number,
  ): ProjectResourceImportSnapshot {
    const snapshot = this.getCurrentProjectSnapshot(projectRoot);
    if (!snapshot) {
      throw this.error(
        'PROJECT_RESOURCE_TARGET_STALE',
        projectRoot,
        '目标项目已关闭或切换，请重新打开后导入。',
      );
    }
    const currentProject = ProjectSchema.parse(snapshot.project);
    const openInstanceMismatch =
      openInstanceId !== undefined &&
      snapshot.openInstanceId !== undefined &&
      snapshot.openInstanceId !== null &&
      snapshot.openInstanceId !== openInstanceId;
    if (
      snapshot.revision !== baseRevision ||
      currentProject.id !== requestProject.id ||
      openInstanceMismatch ||
      !projectsEqual(currentProject, requestProject)
    ) {
      throw this.error(
        'PROJECT_RESOURCE_TARGET_STALE',
        projectRoot,
        '目标项目在选择导入期间已发生变化，请重新开始导入。',
        {
          currentProject,
          currentRevision: snapshot.revision,
        },
      );
    }
    return {
      project: currentProject,
      revision: snapshot.revision,
      openInstanceId: snapshot.openInstanceId,
    };
  }

  private getSelection(sourceToken: string): SelectionSession | null {
    this.pruneSelections();
    return this.selections.get(sourceToken) ?? null;
  }

  private pruneSelections(): void {
    const cutoff = this.now().getTime() - SELECTION_TTL_MS;
    for (const [token, session] of this.selections) {
      if (session.createdAt < cutoff) this.selections.delete(token);
    }
  }

  private createUniqueId(usedIds: Set<string>): string {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const id = this.createId();
      if (!UUID_PATTERN.test(id) || usedIds.has(id)) continue;
      usedIds.add(id);
      return id;
    }
    throw new Error('Could not allocate a unique Project resource identity.');
  }

  private error(
    code: ProjectResourceImportErrorCode,
    projectRoot: string,
    message: string,
    details: ServiceErrorDetails = {},
  ): ProjectResourceImportServiceError {
    return new ProjectResourceImportServiceError(
      code,
      projectRoot,
      message,
      details,
    );
  }
}

function resourceKey(resource: { kind: string; id: string }): string {
  return `${resource.kind}:${resource.id}`;
}

function projectsEqual(left: Project, right: Project): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
