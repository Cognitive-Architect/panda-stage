import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  access,
  lstat,
  realpath,
  stat,
} from 'node:fs/promises';
import path from 'node:path';
import {
  ProjectSchema,
  type Asset,
  type Project,
} from '../../domain';
import {
  collectExportPreparationMedia,
  evaluateExportPreparationBudget,
  evaluateExportPreparationSupport,
} from '../../domain/export-preparation';
import {
  EXPORT_PREPARATION_MAX_ASSETS,
  EXPORT_PREPARATION_RENDER_SETTINGS,
  EXPORT_PREPARATION_SUPPORT_PROFILE,
  ExportPreparationCandidateSchema,
  ExportPreparationRequestSchema,
  type ExportOutputTargetIdentity,
  type ExportPreparationCandidate,
  type ExportPreparationIssue,
  type ExportPreparationMediaManifestEntry,
  type ExportPreparationRequest,
  type ExportPreparationResponse,
  type ExportPreparationSelectOutputRequest,
  type ExportPreparationSelectOutputResponse,
} from '../../shared/export-preparation-types';
import {
  AssetCanvasImageService,
} from './AssetCanvasImageService';
import {
  AssetPreviewAudioService,
} from './AssetPreviewAudioService';
import {
  ExportPreparationFileStore,
  NodeExportPreparationFileStore,
} from './ExportPreparationFileStore';
import { resolveProjectAssetPath } from './project-asset-path';

export interface TrackedProjectSnapshot {
  project: Project;
  revision: number;
  dirty: boolean;
  openInstanceId: number | null;
}

export interface ExportPreparationMediaReader {
  getByteLength(projectRoot: string, asset: Asset): Promise<number>;
  read(
    projectRoot: string,
    project: Project,
    asset: Asset,
  ): Promise<{ bytes: Uint8Array; mimeType: string }>;
}

export interface ExportPreparationServiceOptions {
  getCurrentProjectSnapshot: (
    projectRoot: string,
  ) => TrackedProjectSnapshot | null;
  fileStore?: ExportPreparationFileStore;
  mediaReader?: ExportPreparationMediaReader;
  now?: () => Date;
}

interface OutputSelection {
  selectionId: string;
  projectRoot: string;
  projectId: string;
  openInstanceId: number;
  targetPath: string;
  fileName: string;
  overwriteApproved: boolean;
  targetIdentity: ExportOutputTargetIdentity | null;
}

interface ActivePreparation {
  attemptId: string;
  controller: AbortController;
  snapshotId: string;
}

interface StoredCandidate {
  candidate: ExportPreparationCandidate;
}

class PreparationCancelledError extends Error {}

export class MainProjectAssetReader implements ExportPreparationMediaReader {
  async getByteLength(projectRoot: string, asset: Asset): Promise<number> {
    const sourcePath = await resolveProjectAssetPath(
      projectRoot,
      asset.relativePath,
    );
    if (!sourcePath) throw new Error('The project asset source is unavailable.');
    const details = await stat(sourcePath, { bigint: true });
    if (!details.isFile() || details.size <= 0n) {
      throw new Error('The project asset is not a non-empty file.');
    }
    if (details.size > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error('The project asset size cannot be represented safely.');
    }
    return Number(details.size);
  }

  async read(
    projectRoot: string,
    project: Project,
    asset: Asset,
  ): Promise<{ bytes: Uint8Array; mimeType: string }> {
    if (asset.kind === 'image') {
      const reader = new AssetCanvasImageService({
        getCurrentProjectSnapshot: (root) =>
          root === projectRoot ? { project } : null,
      });
      const result = await reader.read({
        projectRoot,
        assetId: asset.id,
        sha256: asset.sha256,
      });
      if (!result.ok) throw new Error(result.error.message);
      return { bytes: result.bytes, mimeType: result.mimeType };
    }

    const reader = new AssetPreviewAudioService({
      getCurrentProjectSnapshot: (root) =>
        root === projectRoot ? { project } : null,
    });
    const result = await reader.read({
      projectRoot,
      assetId: asset.id,
      sha256: asset.sha256,
    });
    if (!result.ok) throw new Error(result.error.message);
    return { bytes: result.bytes, mimeType: result.mimeType };
  }
}

export class ExportPreparationService {
  private readonly fileStore: ExportPreparationFileStore;
  private readonly mediaReader: ExportPreparationMediaReader;
  private readonly now: () => Date;
  private selection: OutputSelection | null = null;
  private activePreparation: ActivePreparation | null = null;
  private readonly candidates = new Map<string, StoredCandidate>();
  private readonly usedAttemptIds = new Set<string>();
  private readonly diagnostics = new Map<string, string[]>();

  constructor(private readonly options: ExportPreparationServiceOptions) {
    this.fileStore =
      options.fileStore ?? new NodeExportPreparationFileStore();
    this.mediaReader = options.mediaReader ?? new MainProjectAssetReader();
    this.now = options.now ?? (() => new Date());
  }

  async selectOutput(
    request: ExportPreparationSelectOutputRequest,
    selectedPath: string | null,
  ): Promise<ExportPreparationSelectOutputResponse> {
    if (this.activePreparation) {
      return {
        status: 'blocked',
        issue: {
          code: 'PREPARATION_BUSY',
          location: '导出准备',
          problem: '已有一次工程检查正在进行。',
          nextStep: '等待当前检查结束后再选择输出位置。',
        },
      };
    }
    this.selection = null;
    if (selectedPath === null) return { status: 'cancelled' };

    const current = this.currentProject(request.projectRoot);
    if (
      !current ||
      current.project.id !== request.projectId ||
      current.openInstanceId !== request.openInstanceId
    ) {
      return {
        status: 'blocked',
        issue: this.sessionChangedIssue(),
      };
    }

    try {
      const target = await captureTargetIdentity(selectedPath);
      await this.releaseAllCandidates();
      const selectionId = randomUUID();
      const fileName = path.basename(target.canonicalPath);
      this.selection = {
        selectionId,
        projectRoot: path.resolve(request.projectRoot),
        projectId: request.projectId,
        openInstanceId: request.openInstanceId,
        targetPath: target.canonicalPath,
        fileName,
        overwriteApproved: target.identity !== null,
        targetIdentity: target.identity,
      };
      return {
        status: 'selected',
        selectionId,
        fileName,
        overwriteApproved: target.identity !== null,
      };
    } catch (error) {
      return {
        status: 'blocked',
        issue: {
          code: 'OUTPUT_TARGET_CHANGED',
          location: '输出位置',
          problem: safeTargetProblem(error),
          nextStep: '选择一个可写的 .mp4 输出位置后重试。',
        },
      };
    }
  }

  async prepare(
    rawRequest: unknown,
  ): Promise<ExportPreparationResponse> {
    const request = ExportPreparationRequestSchema.parse(
      rawRequest,
    ) as ExportPreparationRequest;
    if (
      this.activePreparation ||
      this.usedAttemptIds.has(request.attemptId)
    ) {
      return this.block(
        request.attemptId,
        [
          {
            code: 'PREPARATION_BUSY',
            location: '导出准备',
            problem: '这次检查已开始，或另一次检查仍在进行。',
            nextStep: '等待当前检查结束，再重新选择输出位置。',
          },
        ],
        'duplicate or overlapping preparation request',
      );
    }

    const selection = this.selection;
    this.selection = null;
    if (!selection || selection.selectionId !== request.selectionId) {
      return this.block(
        request.attemptId,
        [
          {
            code: 'INVALID_PROJECT',
            location: '输出位置',
            problem: '输出位置已取消、已使用或已失效。',
            nextStep: '重新选择输出位置后检查工程。',
          },
        ],
        'output selection was missing or already consumed',
      );
    }
    this.usedAttemptIds.add(request.attemptId);
    this.trimUsedAttemptIds();

    if (
      selection.projectRoot !== path.resolve(request.projectRoot) ||
      selection.projectId !== request.projectId ||
      selection.openInstanceId !== request.openInstanceId
    ) {
      return this.block(
        request.attemptId,
        [this.sessionChangedIssue()],
        'output selection and renderer project identity differed',
      );
    }

    const tracked = this.currentProject(request.projectRoot);
    if (
      !tracked ||
      tracked.project.id !== request.projectId ||
      tracked.openInstanceId !== request.openInstanceId
    ) {
      return this.block(
        request.attemptId,
        [this.sessionChangedIssue()],
        'the requested project is no longer tracked by Main',
      );
    }

    const projectResult = ProjectSchema.safeParse(request.project);
    if (!projectResult.success) {
      const issues = projectResult.error.issues.slice(0, 200).map((item) => ({
        code: 'INVALID_PROJECT' as const,
        location: projectLocation(request.project, item.path),
        problem: '工程引用或时间范围无效。',
        nextStep: '检查指出的镜头或对象，修正后重新检查。',
      }));
      return this.block(
        request.attemptId,
        issues.length > 0
          ? issues
          : [
              {
                code: 'INVALID_PROJECT',
                location: '工程',
                problem: '工程数据无法通过当前工程校验。',
                nextStep: '修正工程数据后重新检查。',
              },
            ],
        projectResult.error.message,
      );
    }
    const project = projectResult.data;
    if (project.id !== request.projectId) {
      return this.block(
        request.attemptId,
        [
          {
            code: 'INVALID_PROJECT',
            location: '工程',
            problem: '当前工程身份与输出位置选择时不一致。',
            nextStep: '重新打开工程并选择输出位置。',
          },
        ],
        'project id changed after output selection',
      );
    }
    if (
      tracked.revision !== request.revision ||
      tracked.dirty !== request.dirty ||
      !projectsEqual(tracked.project, project)
    ) {
      return this.block(
        request.attemptId,
        [this.projectChangedIssue()],
        'renderer snapshot did not match Main current revision and Project',
      );
    }

    const controller = new AbortController();
    const snapshotId = randomUUID();
    const active: ActivePreparation = {
      attemptId: request.attemptId,
      controller,
      snapshotId,
    };
    this.activePreparation = active;
    const diagnosticDetails: string[] = [];
    let snapshotDirectoryCreated = false;

    try {
      const issues = evaluateExportPreparationSupport(project, request.cameraMode);
      const media = collectExportPreparationMedia(project);
      const mediaSizes = new Map<string, number>();
      const budgetEntries: Array<{ byteLength: number; location: string }> = [];

      const targetAtStart = await captureTargetIdentity(selection.targetPath);
      if (!sameTarget(selection, targetAtStart)) {
        issues.push(this.outputChangedIssue());
        return this.block(request.attemptId, issues, 'target changed before preflight');
      }
      if (await outputConflictsWithProject(selection, project)) {
        issues.push({
          code: 'OUTPUT_TARGET_CHANGED',
          location: '输出位置',
          problem: '输出位置指向工程文件或工程素材。',
          nextStep: '选择工程目录之外的 .mp4 输出位置。',
        });
        return this.block(request.attemptId, issues, 'output target aliases a project file');
      }

      if (media.length > EXPORT_PREPARATION_MAX_ASSETS) {
        issues.push({
          code: 'PREPARATION_BUDGET_EXCEEDED',
          location: '工程素材',
          problem:
            '本次准备需要检查的素材数量超过 ' +
            EXPORT_PREPARATION_MAX_ASSETS +
            ' 项上限。',
          nextStep: '减少本次实际使用的素材数量后重新检查。',
        });
        return this.block(
          request.attemptId,
          issues,
          'required media count exceeded the preparation budget',
        );
      }

      for (const entry of media) {
        this.throwIfCancelled(active);
        try {
          const byteLength = await this.mediaReader.getByteLength(
            request.projectRoot,
            entry.asset,
          );
          mediaSizes.set(entry.asset.id, byteLength);
          budgetEntries.push({
            byteLength,
            location: entry.usages[0] ?? '工程素材',
          });
        } catch (error) {
          diagnosticDetails.push(
            'Size inspection for asset ' +
              entry.asset.id +
              ': ' +
              errorMessage(error),
          );
          issues.push(this.mediaUnavailableIssue(entry.usages[0] ?? '工程素材'));
        }
      }
      const budget = evaluateExportPreparationBudget(budgetEntries);
      const totalMediaBytes = budget.totalBytes;
      issues.push(...budget.issues);

      const overBudget = issues.some(
        (item) => item.code === 'PREPARATION_BUDGET_EXCEEDED',
      );
      const missingSize = media.some((entry) => !mediaSizes.has(entry.asset.id));
      if (overBudget || missingSize) {
        return this.block(request.attemptId, issues, diagnosticDetails.join('\n'));
      }

      await this.fileStore.create(snapshotId);
      snapshotDirectoryCreated = true;
      const mediaManifest: ExportPreparationMediaManifestEntry[] = [];
      for (const entry of media) {
        this.throwIfCancelled(active);
        const expectedSize = mediaSizes.get(entry.asset.id)!;
        let loaded: { bytes: Uint8Array; mimeType: string };
        let digest = '';
        try {
          loaded = await this.mediaReader.read(
            request.projectRoot,
            project,
            entry.asset,
          );
          this.throwIfCancelled(active);
          digest = createHash('sha256')
            .update(loaded.bytes)
            .digest('hex');
          if (
            loaded.bytes.byteLength !== expectedSize ||
            digest !== entry.asset.sha256 ||
            loaded.mimeType !== entry.asset.mimeType
          ) {
            throw new Error(
              'Media bytes, MIME type, or content hash changed during preparation.',
            );
          }
        } catch (error) {
          diagnosticDetails.push(
            'Content validation for asset ' +
              entry.asset.id +
              ': ' +
              errorMessage(error),
          );
          issues.push(this.mediaUnavailableIssue(entry.usages[0] ?? '工程素材'));
          continue;
        }

        const contentHandleId = randomUUID();
        let contentRelativePath: string;
        try {
          contentRelativePath = await this.fileStore.writeAsset(
            snapshotId,
            contentHandleId,
            loaded.mimeType,
            loaded.bytes,
          );
        } catch (error) {
          diagnosticDetails.push(
            'Temporary copy for asset ' +
              entry.asset.id +
              ': ' +
              errorMessage(error),
          );
          issues.push(this.preparationFailedIssue(entry.usages[0] ?? '工程素材'));
          continue;
        }
        mediaManifest.push({
          assetId: entry.asset.id,
          kind: entry.asset.kind,
          sourceRelativePath: entry.asset.relativePath,
          contentHandleId,
          contentRelativePath,
          mimeType: loaded.mimeType as ExportPreparationMediaManifestEntry['mimeType'],
          sha256: digest,
          byteLength: loaded.bytes.byteLength,
          usages: entry.usages.slice(0, 200),
        });
      }

      this.throwIfCancelled(active);
      const targetAtEnd = await captureTargetIdentity(selection.targetPath);
      if (!sameTarget(selection, targetAtEnd)) {
        issues.push(this.outputChangedIssue());
      }
      const currentAtEnd = this.currentProject(request.projectRoot);
      if (
        !currentAtEnd ||
        currentAtEnd.project.id !== request.projectId ||
        currentAtEnd.openInstanceId !== request.openInstanceId
      ) {
        issues.push(this.sessionChangedIssue());
        diagnosticDetails.push(
          'The Main tracked Project open instance changed during preparation.',
        );
      } else if (
        currentAtEnd.revision !== request.revision ||
        currentAtEnd.dirty !== request.dirty ||
        !projectsEqual(currentAtEnd.project, project)
      ) {
        issues.push(this.projectChangedIssue());
      }

      if (issues.length > 0) {
        await this.fileStore.delete(snapshotId);
        snapshotDirectoryCreated = false;
        return this.block(
          request.attemptId,
          issues,
          diagnosticDetails.join('\n'),
        );
      }

      const candidate = ExportPreparationCandidateSchema.parse({
        version: 1,
        snapshotId,
        jobId: randomUUID(),
        attemptId: request.attemptId,
        projectId: project.id,
        projectName: project.name,
        projectRoot: path.resolve(request.projectRoot),
        openInstanceId: request.openInstanceId,
        revision: request.revision,
        dirtyAtCapture: request.dirty,
        capturedAt: this.now().toISOString(),
        project,
        renderSettings: EXPORT_PREPARATION_RENDER_SETTINGS,
        cameraMode: request.cameraMode,
        supportProfileVersion: EXPORT_PREPARATION_SUPPORT_PROFILE.version,
        supportProfile: EXPORT_PREPARATION_SUPPORT_PROFILE,
        outputIntent: {
          selectionId: selection.selectionId,
          targetPath: selection.targetPath,
          fileName: selection.fileName,
          overwriteApproved: selection.overwriteApproved,
          targetIdentity: selection.targetIdentity,
        },
        mediaManifest,
        totalMediaBytes,
      }) as ExportPreparationCandidate;
      this.candidates.set(snapshotId, { candidate: structuredClone(candidate) });
      return { status: 'PREPARATION_READY', candidate: structuredClone(candidate) };
    } catch (error) {
      if (error instanceof PreparationCancelledError) {
        return { status: 'CANCELLED', attemptId: request.attemptId };
      }
      diagnosticDetails.push(errorMessage(error));
      return this.block(
        request.attemptId,
        [
          {
            code: 'PREPARATION_FAILED',
            location: '导出准备',
            problem: '工程检查未能安全完成。',
            nextStep: '重新选择输出位置后重试；工程和已有输出未被修改。',
          },
        ],
        diagnosticDetails.join('\n'),
      );
    } finally {
      if (snapshotDirectoryCreated) {
        const retained = this.candidates.has(snapshotId);
        if (!retained) {
          try {
            await this.fileStore.delete(snapshotId);
          } catch (error) {
            this.recordDiagnostic(
              request.attemptId,
              'Temporary preparation cleanup failed: ' + errorMessage(error),
            );
          }
        }
      }
      if (this.activePreparation === active) this.activePreparation = null;
    }
  }

  cancel(attemptId: string): boolean {
    const active = this.activePreparation;
    if (!active || active.attemptId !== attemptId) return false;
    active.controller.abort();
    return true;
  }

  getDiagnostics(diagnosticId: string): string[] {
    return [...(this.diagnostics.get(diagnosticId) ?? [])];
  }

  async discard(selectionId?: string, snapshotId?: string): Promise<boolean> {
    if (selectionId && this.selection?.selectionId === selectionId) {
      this.selection = null;
      return true;
    }
    if (snapshotId) {
      const candidate = this.candidates.get(snapshotId);
      if (!candidate) return false;
      await this.fileStore.delete(snapshotId);
      this.candidates.delete(snapshotId);
      return true;
    }
    return false;
  }

  async dispose(): Promise<void> {
    this.activePreparation?.controller.abort();
    this.selection = null;
    this.candidates.clear();
    await this.fileStore.dispose();
  }

  disposeSync(): void {
    this.activePreparation?.controller.abort();
    this.selection = null;
    this.candidates.clear();
    this.fileStore.disposeSync?.();
  }

  private currentProject(projectRoot: string): TrackedProjectSnapshot | null {
    try {
      return this.options.getCurrentProjectSnapshot(projectRoot);
    } catch {
      return null;
    }
  }

  private block(
    attemptId: string,
    issues: ExportPreparationIssue[],
    diagnostic: string,
  ): ExportPreparationResponse {
    const diagnosticId = randomUUID();
    this.diagnostics.set(diagnosticId, [diagnostic].filter(Boolean));
    return {
      status: 'BLOCK',
      attemptId,
      diagnosticId,
      issues: issues.slice(0, 200),
    };
  }

  private recordDiagnostic(attemptId: string, detail: string): void {
    this.diagnostics.set(attemptId, [
      ...(this.diagnostics.get(attemptId) ?? []),
      detail,
    ]);
  }

  private trimUsedAttemptIds(): void {
    while (this.usedAttemptIds.size > 1_024) {
      const oldest = this.usedAttemptIds.values().next().value as
        | string
        | undefined;
      if (!oldest) return;
      this.usedAttemptIds.delete(oldest);
    }
  }

  private throwIfCancelled(active: ActivePreparation): void {
    if (active.controller.signal.aborted) {
      throw new PreparationCancelledError('Preparation was cancelled.');
    }
  }

  private mediaUnavailableIssue(location: string): ExportPreparationIssue {
    return {
      code: 'REQUIRED_MEDIA_UNAVAILABLE',
      location,
      problem: '所需素材缺失、损坏，或内容与工程记录不一致。',
      nextStep: '重新导入这个素材，或修复工程中的资源引用后再检查。',
    };
  }

  private outputChangedIssue(): ExportPreparationIssue {
    return {
      code: 'OUTPUT_TARGET_CHANGED',
      location: '输出位置',
      problem: '选择输出位置后，目标文件已出现、消失或发生变化。',
      nextStep: '重新选择输出位置，并再次确认是否覆盖。',
    };
  }

  private sessionChangedIssue(): ExportPreparationIssue {
    return {
      code: 'PROJECT_SESSION_CHANGED',
      location: '当前工程',
      problem: '输出位置选择后，当前工程已关闭或切换。',
      nextStep: '打开目标工程并重新选择输出位置。',
    };
  }

  private projectChangedIssue(): ExportPreparationIssue {
    return {
      code: 'PROJECT_SESSION_CHANGED',
      location: '当前工程',
      problem: '选择输出位置后，工程内容或保存版本已变化。',
      nextStep: '重新选择输出位置，并检查当前工程版本。',
    };
  }

  private preparationFailedIssue(location: string): ExportPreparationIssue {
    return {
      code: 'PREPARATION_FAILED',
      location,
      problem: '素材副本无法安全写入临时准备目录。',
      nextStep: '检查可用磁盘空间后重新检查；工程和已有输出未被修改。',
    };
  }

  private async releaseAllCandidates(): Promise<void> {
    for (const snapshotId of this.candidates.keys()) {
      await this.fileStore.delete(snapshotId);
    }
    this.candidates.clear();
  }
}

function projectsEqual(left: Project, right: Project): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

interface CapturedTarget {
  canonicalPath: string;
  identity: ExportOutputTargetIdentity | null;
}

async function captureTargetIdentity(
  rawTargetPath: string,
): Promise<CapturedTarget> {
  if (rawTargetPath.length > 32_767) {
    throw new Error('The selected output path exceeds the supported length.');
  }
  const absoluteTargetPath = path.resolve(rawTargetPath);
  if (path.extname(absoluteTargetPath).toLocaleLowerCase() !== '.mp4') {
    throw new Error('The selected output must use the .mp4 extension.');
  }
  const parentDirectory = await realpath(path.dirname(absoluteTargetPath));
  await access(parentDirectory, constants.W_OK);
  const canonicalPath = path.join(parentDirectory, path.basename(absoluteTargetPath));
  let linkDetails;
  try {
    linkDetails = await lstat(canonicalPath, { bigint: true });
  } catch (error) {
    if (isMissingFile(error)) return { canonicalPath, identity: null };
    throw error;
  }
  if (!linkDetails.isFile() || linkDetails.isSymbolicLink()) {
    throw new Error('The selected output target is not a regular file.');
  }
  const realTargetPath = await realpath(canonicalPath);
  if (!samePath(realTargetPath, canonicalPath)) {
    throw new Error('The selected output target changed while being inspected.');
  }
  const details = await stat(realTargetPath, { bigint: true });
  if (!details.isFile()) {
    throw new Error('The selected output target is not a regular file.');
  }
  return {
    canonicalPath: realTargetPath,
    identity: {
      canonicalPath: realTargetPath,
      volumeId: details.dev.toString(16),
      fileId: details.ino.toString(16),
      sizeBytes: details.size.toString(),
      modifiedTimeNs: details.mtimeNs.toString(),
      changedTimeNs: details.ctimeNs.toString(),
    },
  };
}

function sameTarget(
  selection: OutputSelection,
  current: CapturedTarget,
): boolean {
  if (!samePath(selection.targetPath, current.canonicalPath)) return false;
  if (selection.targetIdentity === null || current.identity === null) {
    return selection.targetIdentity === current.identity;
  }
  return (
    samePath(
      selection.targetIdentity.canonicalPath,
      current.identity.canonicalPath,
    ) &&
    selection.targetIdentity.volumeId === current.identity.volumeId &&
    selection.targetIdentity.fileId === current.identity.fileId &&
    selection.targetIdentity.sizeBytes === current.identity.sizeBytes &&
    selection.targetIdentity.modifiedTimeNs ===
      current.identity.modifiedTimeNs &&
    selection.targetIdentity.changedTimeNs === current.identity.changedTimeNs
  );
}

async function outputConflictsWithProject(
  selection: OutputSelection,
  project: Project,
): Promise<boolean> {
  const projectRoot = await realpath(selection.projectRoot).catch(() =>
    path.resolve(selection.projectRoot),
  );
  const projectFile = path.resolve(projectRoot, 'project.json');
  if (samePath(projectFile, selection.targetPath)) return true;
  for (const asset of project.assets) {
    const declaredPath = path.resolve(projectRoot, asset.relativePath);
    if (samePath(declaredPath, selection.targetPath)) return true;
    const sourcePath = await resolveProjectAssetPath(
      projectRoot,
      asset.relativePath,
    );
    if (sourcePath && samePath(sourcePath, selection.targetPath)) return true;
  }
  return false;
}

function projectLocation(rawProject: unknown, rawPath: PropertyKey[]): string {
  const pathParts = rawPath.filter(
    (part): part is string | number =>
      typeof part === 'string' || typeof part === 'number',
  );
  const shotIndex = pathParts.findIndex((part) => part === 'shots') + 1;
  const shot = shotIndex > 0 ? recordAt(rawProject, pathParts.slice(0, shotIndex + 1)) : null;
  const shotName = stringField(shot, 'name');
  if (shotName) {
    const layerIndex = pathParts.findIndex((part) => part === 'layers') + 1;
    const layer = layerIndex > 0 ? recordAt(rawProject, pathParts.slice(0, layerIndex + 1)) : null;
    const layerName = stringField(layer, 'name');
    if (layerName) return '镜头“' + shotName + '”的对象“' + layerName + '”';
    const audioIndex = pathParts.findIndex((part) => part === 'audioClips') + 1;
    const audio = audioIndex > 0 ? recordAt(rawProject, pathParts.slice(0, audioIndex + 1)) : null;
    const audioName = stringField(audio, 'name');
    if (audioName) return '镜头“' + shotName + '”的音频片段“' + audioName + '”';
    return '镜头“' + shotName + '”';
  }
  const characterIndex = pathParts.findIndex((part) => part === 'characters') + 1;
  const character = characterIndex > 0 ? recordAt(rawProject, pathParts.slice(0, characterIndex + 1)) : null;
  const characterName = stringField(character, 'name');
  if (characterName) return '角色“' + characterName + '”';
  const assetIndex = pathParts.findIndex((part) => part === 'assets') + 1;
  const asset = assetIndex > 0 ? recordAt(rawProject, pathParts.slice(0, assetIndex + 1)) : null;
  const assetName = stringField(asset, 'name');
  return assetName ? '素材“' + assetName + '”' : '工程';
}

function recordAt(value: unknown, indexes: readonly (string | number)[]): Record<string, unknown> | null {
  let current: unknown = value;
  for (const index of indexes) {
    if (typeof index === 'number' && Array.isArray(current)) {
      current = current[index];
    } else if (
      typeof index === 'string' &&
      typeof current === 'object' &&
      current !== null
    ) {
      current = (current as Record<string, unknown>)[index];
    } else {
      return null;
    }
  }
  return typeof current === 'object' && current !== null
    ? (current as Record<string, unknown>)
    : null;
}

function stringField(
  value: Record<string, unknown> | null,
  field: string,
): string | null {
  const result = value?.[field];
  return typeof result === 'string' ? result.slice(0, 160) : null;
}

function safeTargetProblem(error: unknown): string {
  const message = errorMessage(error);
  if (message.includes('.mp4')) {
    return '输出文件必须是 .mp4，且目标目录需要可写。';
  }
  return '无法确认所选输出文件的安全身份。';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLocaleLowerCase() ===
        normalizedRight.toLocaleLowerCase()
    : normalizedLeft === normalizedRight;
}
