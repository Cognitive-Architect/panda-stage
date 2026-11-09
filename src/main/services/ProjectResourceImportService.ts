import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import {
  ImageAssetSchema,
  ProjectSchema,
  type Character,
  type ImageAsset,
  type Project,
  type VoiceProfile,
} from '../../domain';
import {
  ProjectResourceImportApplyRequestSchema,
  ProjectResourceImportChooseRequestSchema,
  ProjectResourceImportChooseResponseSchema,
  type ProjectResourceImportApplyRequest,
  type ProjectResourceImportChooseRequest,
  type ProjectResourceImportChooseResponse,
  type ProjectResourceImportOption,
  type ProjectResourceImportSelection,
} from '../../shared/project-resource-import-api';
import {
  allocateAssetTargetName,
  sanitizeAssetFileName,
} from './AssetImportService';
import {
  AssetImportFileSystemCleanupError,
  AssetImportFileSystemService,
} from './AssetImportFileSystemService';
import { HashService } from './HashService';
import { MediaInspectionService } from './MediaInspectionService';
import { PathService } from './PathService';
import { ProjectService } from './ProjectService';
import { resolveProjectAssetPath } from './project-asset-path';

const MAX_IMPORT_ASSETS = 100;
const MAX_SELECTIONS = 100;
const MAX_ACTIVE_SELECTIONS = 16;
const SELECTION_TTL_MS = 15 * 60 * 1_000;

export interface ProjectResourceImportSnapshot {
  project: Project;
  revision: number;
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
  project: Project;
  baseRevision: number;
  savedRevision: number;
  sourceProjectName: string;
  importedAssets: ImageAsset[];
  importedCharacters: Character[];
  importedVoiceProfiles: VoiceProfile[];
}

interface SelectionSession {
  sourceToken: string;
  createdAt: number;
  targetRoot: string;
  targetProject: Project;
  targetRevision: number;
  sourceRoot: string;
  sourceProject: Project;
  sourceProjectName: string;
  options: ProjectResourceImportOption[];
}

interface PlannedImage {
  sourceAsset: ImageAsset;
  sourcePath: string;
  sha256: string;
  extension: '.png' | '.jpg' | '.jpeg';
  fileName: string;
  targetId: string;
}

interface PreparedImport {
  project: Project;
  assets: ImageAsset[];
  characters: Character[];
  voiceProfiles: VoiceProfile[];
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
    readonly code:
      | 'PROJECT_RESOURCE_SOURCE_INVALID'
      | 'PROJECT_RESOURCE_SOURCE_EQUALS_TARGET'
      | 'PROJECT_RESOURCE_SELECTION_STALE'
      | 'PROJECT_RESOURCE_SELECTION_UNSUPPORTED'
      | 'PROJECT_RESOURCE_TARGET_STALE'
      | 'PROJECT_RESOURCE_ROLLBACK_FAILED'
      | 'PROJECT_RESOURCE_OPERATION_FAILED',
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
    );
    let sourceProject: Project;
    try {
      sourceProject = (await this.projectService.openReadOnly(sourceRoot)).project;
    } catch (error) {
      throw this.error(
        'PROJECT_RESOURCE_SOURCE_INVALID',
        targetRoot,
        '无法读取所选项目或其资源引用不完整。',
        { cause: error },
      );
    }

    const options = this.buildOptions(sourceProject);
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
    const sourceAssets = collectSelectedAssets(
      session.sourceProject,
      selected,
      targetRoot,
    );
    if (sourceAssets.length > MAX_IMPORT_ASSETS) {
      throw this.error(
        'PROJECT_RESOURCE_SELECTION_UNSUPPORTED',
        targetRoot,
        `本批角色共引用 ${sourceAssets.length} 张图片，超过单次导入上限 ${MAX_IMPORT_ASSETS} 张。`,
      );
    }

    const preflight = await this.preflightSourceAssets(
      session.sourceRoot,
      sourceAssets,
      targetRoot,
    );
    const copiedPaths: string[] = [];

    try {
      const operation = await this.projectService.transact(targetRoot, async (transaction) => {
        const current = this.assertTargetSnapshot(
          targetRoot,
          request.project,
          request.baseRevision,
        );
        if (transaction.existingDocument.project.id !== current.project.id) {
          throw this.error(
            'PROJECT_RESOURCE_TARGET_STALE',
            targetRoot,
            '目标项目身份已变化，导入已取消。',
          );
        }

        const prepared = await this.prepareImport(
          current.project,
          session.sourceProject,
          selected,
          preflight,
          transaction.projectRoot,
          targetRoot,
        );
        for (const image of preflight) {
          const targetPath = await this.fileSystem.copyIntoAssetsAtomically(
            transaction.projectRoot,
            image.sourcePath,
            image.fileName,
          );
          copiedPaths.push(targetPath);
          const copiedHash = await this.hashService.hashFile(targetPath);
          if (copiedHash.hex !== image.sha256) {
            throw this.error(
              'PROJECT_RESOURCE_SOURCE_INVALID',
              targetRoot,
              `“${image.sourceAsset.name}”复制时内容发生变化，导入已取消。`,
            );
          }
        }

        const savedRevision = request.baseRevision + 1;
        const document = await transaction.save(
          prepared.project,
          savedRevision,
          () => {
            this.assertTargetSnapshot(
              targetRoot,
              request.project,
              request.baseRevision,
            );
          },
        );
        copiedPaths.length = 0;
        return {
          project: document.project,
          baseRevision: request.baseRevision,
          savedRevision,
          sourceProjectName: session.sourceProjectName,
          importedAssets: prepared.assets,
          importedCharacters: prepared.characters,
          importedVoiceProfiles: prepared.voiceProfiles,
        };
      });
      this.selections.delete(request.sourceToken);
      return operation;
    } catch (error) {
      if (error instanceof AssetImportFileSystemCleanupError) {
        throw this.error(
          'PROJECT_RESOURCE_ROLLBACK_FAILED',
          targetRoot,
          '复制文件清理未完成，请手动检查目标项目中的残留文件。',
          { cause: error, residualPaths: error.residualPaths },
        );
      }
      if (copiedPaths.length > 0) {
        const failures: string[] = [];
        for (const copiedPath of copiedPaths.reverse()) {
          try {
            await this.fileSystem.rollbackImportedFile(copiedPath);
          } catch {
            failures.push(copiedPath);
          }
        }
        if (failures.length > 0) {
          throw this.error(
            'PROJECT_RESOURCE_ROLLBACK_FAILED',
            targetRoot,
            '导入失败且部分新文件未能清理，请手动检查目标项目中的残留文件。',
            { cause: error, residualPaths: failures },
          );
        }
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

  private buildOptions(project: Project): ProjectResourceImportOption[] {
    const options: ProjectResourceImportOption[] = [];
    for (const character of project.characters) {
      const imageIds = characterImageAssetIds(character);
      const imageAssets = imageIds.map((id) =>
        project.assets.find((asset) => asset.id === id),
      );
      const voiceProfile = project.voiceProfiles.find(
        (profile) =>
          profile.id === character.defaultVoiceProfileId &&
          profile.characterId === character.id,
      );
      let reason: string | undefined;
      if (!voiceProfile) {
        reason = '缺少角色默认配音档案';
      } else if (
        imageAssets.some((asset) => !asset || asset.kind !== 'image')
      ) {
        reason = '角色引用的图片素材缺失或类型不匹配';
      } else if (imageIds.length > MAX_IMPORT_ASSETS) {
        reason = `图片依赖超过单次导入上限 ${MAX_IMPORT_ASSETS} 张`;
      }
      options.push({
        id: character.id,
        kind: 'character',
        name: character.name,
        mode: character.mode,
        dependencyCount: new Set(imageIds).size,
        supported: reason === undefined,
        ...(reason ? { reason } : {}),
      });
    }
    for (const asset of project.assets) {
      if (
        asset.kind !== 'image' ||
        (asset.usage !== 'background' && asset.usage !== 'prop')
      ) {
        continue;
      }
      options.push({
        id: asset.id,
        kind: 'image',
        name: asset.name,
        usage: asset.usage,
        dependencyCount: 1,
        supported: true,
      });
    }
    return options;
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
    const selected: ProjectResourceImportSelection[] = [];
    const unsupported: string[] = [];
    for (const selection of selections) {
      const option = optionByKey.get(resourceKey(selection));
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
    assets: readonly ImageAsset[],
    targetRoot: string,
  ): Promise<PlannedImage[]> {
    const planned: PlannedImage[] = [];
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
          `“${sourceAsset.name}”文件缺失，或资源路径越出了来源项目的 assets 目录。`,
        );
      }

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
          `“${sourceAsset.name}”不是可用的受支持图片。`,
          { cause: error },
        );
      }
      if (
        media.kind !== 'image' ||
        media.width !== sourceAsset.width ||
        media.height !== sourceAsset.height ||
        media.mimeType !== sourceAsset.mimeType ||
        (sourceAsset.sha256 && sourceAsset.sha256 !== sha256)
      ) {
        throw this.error(
          'PROJECT_RESOURCE_SOURCE_INVALID',
          targetRoot,
          `“${sourceAsset.name}”的文件内容与项目记录不一致。`,
        );
      }
      planned.push({
        sourceAsset,
        sourcePath,
        sha256,
        extension: media.extension as '.png' | '.jpg' | '.jpeg',
        fileName: '',
        targetId: '',
      });
    }
    return planned;
  }

  private async prepareImport(
    targetProject: Project,
    sourceProject: Project,
    selections: readonly ProjectResourceImportSelection[],
    preflight: PlannedImage[],
    transactionRoot: string,
    reportedTargetRoot: string,
  ): Promise<PreparedImport> {
    const sourceAssetIds = new Set(preflight.map(({ sourceAsset }) => sourceAsset.id));
    const usedIds = new Set([
      ...collectProjectUuidValues(targetProject),
      ...collectProjectUuidValues(sourceProject),
    ]);
    const allocateId = (): string => this.createUniqueId(usedIds);
    const assetIdMap = new Map<string, string>();
    const importedAssets: ImageAsset[] = [];
    const occupiedFileNames = new Set(
      targetProject.assets.map((asset) =>
        path.basename(asset.relativePath).toLocaleLowerCase('en-US'),
      ),
    );

    for (const image of preflight) {
      if (!sourceAssetIds.has(image.sourceAsset.id)) continue;
      const targetId = allocateId();
      const preferredName = sanitizeAssetFileName(
        path.basename(image.sourceAsset.relativePath),
        image.extension,
      );
      const targetFileName = await allocateAssetTargetName(
        this.fileSystem,
        transactionRoot,
        preferredName,
        image.sha256,
        occupiedFileNames,
      );
      occupiedFileNames.add(targetFileName.toLocaleLowerCase('en-US'));
      image.fileName = targetFileName;
      image.targetId = targetId;
      assetIdMap.set(image.sourceAsset.id, targetId);
      importedAssets.push(
        ImageAssetSchema.parse({
          ...image.sourceAsset,
          id: targetId,
          relativePath: `assets/${targetFileName}`,
          sha256: image.sha256,
        }),
      );
    }

    const occupiedCharacterNames = new Set(
      targetProject.characters.map((character) =>
        normalizeName(character.name),
      ),
    );
    const importedCharacters: Character[] = [];
    const importedVoiceProfiles: VoiceProfile[] = [];
    for (const selection of selections) {
      if (selection.kind !== 'character') continue;
      const sourceCharacter = sourceProject.characters.find(
        (candidate) => candidate.id === selection.id,
      );
      if (!sourceCharacter) {
        throw this.error(
          'PROJECT_RESOURCE_SELECTION_STALE',
          reportedTargetRoot,
          '所选角色已不存在，请重新选择来源项目。',
        );
      }
      const sourceVoiceProfile = sourceProject.voiceProfiles.find(
        (profile) =>
          profile.id === sourceCharacter.defaultVoiceProfileId &&
          profile.characterId === sourceCharacter.id,
      );
      if (!sourceVoiceProfile) {
        throw this.error(
          'PROJECT_RESOURCE_SELECTION_UNSUPPORTED',
          reportedTargetRoot,
          `角色“${sourceCharacter.name}”缺少默认配音档案。`,
        );
      }
      const characterId = allocateId();
      const voiceProfileId = allocateId();
      const characterName = uniqueCharacterName(
        sourceCharacter.name,
        occupiedCharacterNames,
      );
      const remapAsset = (sourceId: string): string => {
        const targetId = assetIdMap.get(sourceId);
        if (!targetId) {
          throw this.error(
            'PROJECT_RESOURCE_SELECTION_UNSUPPORTED',
            reportedTargetRoot,
            `角色“${sourceCharacter.name}”的图片依赖未能闭合。`,
          );
        }
        return targetId;
      };
      const character = remapCharacter(
        sourceCharacter,
        characterId,
        voiceProfileId,
        characterName,
        remapAsset,
        allocateId,
      );
      const voiceProfile: VoiceProfile = {
        ...sourceVoiceProfile,
        id: voiceProfileId,
        characterId,
      };
      importedCharacters.push(character);
      importedVoiceProfiles.push(voiceProfile);
    }

    for (const selection of selections) {
      if (selection.kind !== 'image') continue;
      if (!assetIdMap.has(selection.id)) {
        throw this.error(
          'PROJECT_RESOURCE_SELECTION_UNSUPPORTED',
          reportedTargetRoot,
          '所选图片不在可导入的依赖范围内。',
        );
      }
    }

    const project = ProjectSchema.parse({
      ...targetProject,
      assets: [...targetProject.assets, ...importedAssets],
      characters: [...targetProject.characters, ...importedCharacters],
      voiceProfiles: [
        ...targetProject.voiceProfiles,
        ...importedVoiceProfiles,
      ],
      updatedAt: this.now().toISOString(),
    });
    return {
      project,
      assets: importedAssets,
      characters: importedCharacters,
      voiceProfiles: importedVoiceProfiles,
    };
  }

  private assertTargetSnapshot(
    projectRoot: string,
    requestProject: Project,
    baseRevision: number,
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
    if (
      snapshot.revision !== baseRevision ||
      currentProject.id !== requestProject.id ||
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
    return { project: currentProject, revision: snapshot.revision };
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
    code: ProjectResourceImportServiceError['code'],
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

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function characterImageAssetIds(character: Character): string[] {
  if (character.mode === 'adaptive-parts') {
    return uniqueStrings(character.parts.map((part) => part.assetId));
  }
  return uniqueStrings([
    character.baseAssetId,
    ...character.expressions.map((expression) => expression.assetId),
    ...(character.mouthOpenAssetId ? [character.mouthOpenAssetId] : []),
    ...(character.mode === 'composite'
      ? [
          character.bodyAssetId,
          ...(character.head ? [character.head.assetId] : []),
        ]
      : []),
  ]);
}

function collectSelectedAssets(
  sourceProject: Project,
  selections: readonly ProjectResourceImportSelection[],
  targetRoot: string,
): ImageAsset[] {
  const ids = new Set<string>();
  for (const selection of selections) {
    if (selection.kind === 'image') {
      ids.add(selection.id);
      continue;
    }
    const character = sourceProject.characters.find(
      (candidate) => candidate.id === selection.id,
    );
    if (!character) {
      throw new ProjectResourceImportServiceError(
        'PROJECT_RESOURCE_SELECTION_STALE',
        targetRoot,
        '所选角色已不存在，请重新选择来源项目。',
      );
    }
    for (const id of characterImageAssetIds(character)) ids.add(id);
  }
  const assets: ImageAsset[] = [];
  for (const id of ids) {
    const asset = sourceProject.assets.find((candidate) => candidate.id === id);
    if (!asset || asset.kind !== 'image') {
      throw new ProjectResourceImportServiceError(
        'PROJECT_RESOURCE_SELECTION_UNSUPPORTED',
        targetRoot,
        '所选资源引用了缺失或不受支持的图片。',
      );
    }
    assets.push(asset);
  }
  return assets;
}

function remapCharacter(
  character: Character,
  id: string,
  defaultVoiceProfileId: string,
  name: string,
  remapAsset: (sourceId: string) => string,
  allocateId: () => string,
): Character {
  if (character.mode === 'adaptive-parts') {
    return {
      ...character,
      id,
      name,
      defaultVoiceProfileId,
      parts: character.parts.map((part) => ({
        ...part,
        partId: allocateId(),
        assetId: remapAsset(part.assetId),
      })),
    };
  }
  const expressionIdMap = new Map<string, string>();
  const expressions = character.expressions.map((expression) => {
    const expressionId = allocateId();
    expressionIdMap.set(expression.id, expressionId);
    return {
      ...expression,
      id: expressionId,
      assetId: remapAsset(expression.assetId),
    };
  });
  const defaultExpressionId = expressionIdMap.get(
    character.defaultExpressionId,
  );
  if (!defaultExpressionId) {
    throw new Error('The source Character has no default expression.');
  }
  const common = {
    id,
    name,
    defaultVoiceProfileId,
    baseAssetId: remapAsset(character.baseAssetId),
    expressions,
    defaultExpressionId,
    ...(character.mouthOpenAssetId
      ? { mouthOpenAssetId: remapAsset(character.mouthOpenAssetId) }
      : {}),
  };
  if (character.mode === 'composite') {
    return {
      ...character,
      ...common,
      bodyAssetId: remapAsset(character.bodyAssetId),
      ...(character.head
        ? { head: { ...character.head, assetId: remapAsset(character.head.assetId) } }
        : {}),
    };
  }
  return { ...character, ...common };
}

function resourceKey(resource: { kind: string; id: string }): string {
  return `${resource.kind}:${resource.id}`;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function normalizeName(name: string): string {
  return name.trim().toLocaleLowerCase('en-US');
}

function uniqueCharacterName(
  rawName: string,
  occupiedNames: Set<string>,
): string {
  const name = rawName.trim();
  if (!occupiedNames.has(normalizeName(name))) {
    occupiedNames.add(normalizeName(name));
    return name;
  }
  for (let suffix = 2; suffix <= 10_000; suffix += 1) {
    const marker = ` (${suffix})`;
    const candidate = `${Array.from(name).slice(0, 200 - marker.length).join('').trimEnd()}${marker}`;
    const key = normalizeName(candidate);
    if (occupiedNames.has(key)) continue;
    occupiedNames.add(key);
    return candidate;
  }
  throw new Error(`Could not allocate a unique name for ${name}.`);
}

function collectProjectUuidValues(project: Project): Set<string> {
  const ids = new Set<string>();
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      if (UUID_PATTERN.test(value)) ids.add(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value && typeof value === 'object') {
      Object.values(value as Record<string, unknown>).forEach(visit);
    }
  };
  visit(project);
  return ids;
}

function projectsEqual(left: Project, right: Project): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
