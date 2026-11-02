import { createHash, randomUUID } from 'node:crypto';
import {
  lstat,
  open,
  realpath,
  stat,
  unlink,
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
  EXPORT_PREPARATION_WINDOWS_FORMAL_OUTPUT_MAX_PATH_CHARACTERS,
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
  FormalOutputPathTooLongError,
  isWithinWindowsFormalExportPathLimit,
} from './FileSystemService';
import {
  ExportPreparationFileStore,
  NodeExportPreparationFileStore,
  type ExportPreparationCleanupFailure,
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
  assertFormalOutputLocation?: (outputPath: string) => Promise<void>;
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
  completion: Promise<void>;
  settle(): void;
}

interface StoredCandidate {
  candidate: ExportPreparationCandidate;
  retryExpiresAt: number;
  expiryTimer?: ReturnType<typeof setTimeout>;
}

interface PendingCandidateCleanup {
  candidate: ExportPreparationCandidate;
  attempts: number;
  explicitRecoveryAttempts: number;
  lastError: string;
  retryTimer?: ReturnType<typeof setTimeout>;
  inFlight?: Promise<boolean>;
}

const EXPORT_RETRY_RETENTION_MS = 30 * 60 * 1_000;
const MAX_RETAINED_EXPORT_CANDIDATES = 2;
const MAX_CANDIDATE_CLEANUP_ATTEMPTS = 4;
const CANDIDATE_CLEANUP_RETRY_DELAYS_MS = [250, 1_000, 4_000] as const;

export type FrozenExportMedia =
  | {
      assetId: string;
      kind: 'image';
      mimeType: 'image/png' | 'image/jpeg';
      bytes: Uint8Array<ArrayBuffer>;
    }
  | {
      assetId: string;
      kind: 'audio';
      mimeType: 'audio/mpeg' | 'audio/wav';
      bytes: Uint8Array<ArrayBuffer>;
    };

export interface FrozenExportInput {
  candidate: ExportPreparationCandidate;
  media: FrozenExportMedia[];
}

class PreparationCancelledError extends Error {}

export class MainProjectAssetReader implements ExportPreparationMediaReader {
  async getByteLength(projectRoot: string, asset: Asset): Promise<number> {
    const sourcePath = await resolveProjectAssetPath(
      projectRoot,
      asset.relativePath,
      { preservePermissionErrors: true },
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
  private readonly pendingCandidateCleanups = new Map<
    string,
    PendingCandidateCleanup
  >();
  private readonly activeExportSnapshots = new Set<string>();
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
    await this.pruneExpiredCandidates();
    if (this.activeExportSnapshots.size > 0) {
      return {
        status: 'blocked',
        issue: {
          code: 'PREPARATION_BUSY',
          location: 'Export',
          problem: 'An export task is still active.',
          nextStep: 'Finish or cancel the current export before choosing another output.',
        },
      };
    }
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
    if (
      process.platform === 'win32' &&
      !isWithinWindowsFormalExportPathLimit(selectedPath)
    ) {
      return {
        status: 'blocked',
        issue: this.outputPathTooLongIssue(),
      };
    }

    try {
      const target = await captureTargetIdentity(selectedPath);
      if (target.identity !== null) {
        return { status: 'blocked', issue: this.outputExistsIssue() };
      }
      try {
        await this.options.assertFormalOutputLocation?.(target.canonicalPath);
      } catch (error) {
        return {
          status: 'blocked',
          issue:
            error instanceof FormalOutputPathTooLongError
              ? this.outputPathTooLongIssue()
              : isFilesystemPermissionError(error)
                ? this.outputLocationPermissionIssue()
              : this.outputLocationUnsupportedIssue(),
        };
      }
      const selectionId = randomUUID();
      const fileName = path.basename(target.canonicalPath);
      const selection: OutputSelection = {
        selectionId,
        projectRoot: path.resolve(request.projectRoot),
        projectId: request.projectId,
        openInstanceId: request.openInstanceId,
        targetPath: target.canonicalPath,
        fileName,
        overwriteApproved: false,
        targetIdentity: target.identity,
      };
      if (request.snapshotId) {
        const stored = this.candidates.get(request.snapshotId);
        if (!stored) {
          return {
            status: 'blocked',
            issue: this.unavailableSnapshotIssue(),
          };
        }
        const candidate = stored.candidate;
        if (
          candidate.projectRoot !== selection.projectRoot ||
          candidate.projectId !== selection.projectId ||
          candidate.openInstanceId !== selection.openInstanceId
        ) {
          return {
            status: 'blocked',
            issue: this.sessionChangedIssue(),
          };
        }
        if (await outputConflictsWithProject(selection, candidate.project)) {
          return {
            status: 'blocked',
            issue: this.outputChangedIssue(),
          };
        }
        stored.candidate = ExportPreparationCandidateSchema.parse({
          ...candidate,
          outputIntent: {
            selectionId,
            targetPath: selection.targetPath,
            fileName,
            overwriteApproved: false,
            targetIdentity: target.identity,
          },
        }) as ExportPreparationCandidate;
        stored.retryExpiresAt = this.now().getTime() + EXPORT_RETRY_RETENTION_MS;
        this.scheduleCandidateExpiry(request.snapshotId);
      } else {
        this.selection = selection;
      }
      return {
        status: 'selected',
        selectionId,
        fileName,
        overwriteApproved: false,
      };
    } catch (error) {
      return {
        status: 'blocked',
        issue: isFilesystemPermissionError(error)
          ? this.outputLocationPermissionIssue()
          : {
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
      this.activeExportSnapshots.size > 0 ||
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

    const pendingCleanupIdsBeforePrune = new Set(
      this.pendingCandidateCleanups.keys(),
    );
    await this.pruneExpiredCandidates();
    const hasSnapshotCapacity = await this.reserveCandidateSlot(
      pendingCleanupIdsBeforePrune,
    );
    if (!hasSnapshotCapacity) {
      return this.block(
        request.attemptId,
        [
          {
            code: 'PREPARATION_BUSY',
            location: '导出准备',
            problem: '旧导出临时文件还未清理，当前导出已安全停止。',
            nextStep:
              '请解除文件占用后重试导出；仍不能清理时，先解除占用再重启 Panda Stage。',
          },
        ],
        [...this.pendingCandidateCleanups.entries()]
          .map(([snapshotId, pending]) =>
            this.candidateCleanupDiagnostic(
              snapshotId,
              pending,
              pending.lastError || 'Cleanup remains pending.',
            ),
          )
          .join('\n'),
      );
    }
    const controller = new AbortController();
    const snapshotId = randomUUID();
    let settle!: () => void;
    const completion = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const active: ActivePreparation = {
      attemptId: request.attemptId,
      controller,
      snapshotId,
      completion,
      settle,
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
          issues.push(
            this.mediaUnavailableIssue(
              entry.usages[0] ?? '工程素材',
              error,
            ),
          );
        }
      }
      const budget = evaluateExportPreparationBudget(budgetEntries);
      const totalMediaBytes = budget.totalBytes;
      issues.push(...budget.issues);

      const overBudget = issues.some(
        (item) => item.code === 'PREPARATION_BUDGET_EXCEEDED',
      );
      const missingSize = media.some((entry) => !mediaSizes.has(entry.asset.id));
      if (overBudget || (missingSize && mediaSizes.size === 0)) {
        return this.block(request.attemptId, issues, diagnosticDetails.join('\n'));
      }

      await this.fileStore.create(snapshotId);
      snapshotDirectoryCreated = true;
      const mediaManifest: ExportPreparationMediaManifestEntry[] = [];
      for (const entry of media) {
        this.throwIfCancelled(active);
        const expectedSize = mediaSizes.get(entry.asset.id);
        if (expectedSize === undefined) continue;
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
          issues.push(
            this.mediaUnavailableIssue(
              entry.usages[0] ?? '工程素材',
              error,
            ),
          );
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
          issues.push(
            this.preparationFailedIssue(
              entry.usages[0] ?? '工程素材',
              error,
            ),
          );
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
      this.candidates.set(snapshotId, {
        candidate: structuredClone(candidate),
        retryExpiresAt: this.now().getTime() + EXPORT_RETRY_RETENTION_MS,
      });
      this.scheduleCandidateExpiry(snapshotId);
      await this.pruneCandidateLimit();
      return { status: 'PREPARATION_READY', candidate: structuredClone(candidate) };
    } catch (error) {
      if (error instanceof PreparationCancelledError) {
        return { status: 'CANCELLED', attemptId: request.attemptId };
      }
      diagnosticDetails.push(errorMessage(error));
      return this.block(
        request.attemptId,
        [this.preparationSetupFailedIssue(error)],
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
      active.settle();
    }
  }

  async cancelActivePreparationAndWait(): Promise<boolean> {
    const active = this.activePreparation;
    if (!active) return false;
    active.controller.abort();
    await active.completion;
    return true;
  }

  hasActivePreparation(): boolean {
    return this.activePreparation !== null;
  }

  async getSnapshotRetryStatus(
    snapshotId: string,
  ): Promise<{ available: boolean; expiresAt: number | null }> {
    await this.pruneExpiredCandidates();
    const stored = this.candidates.get(snapshotId);
    return stored
      ? { available: true, expiresAt: stored.retryExpiresAt }
      : { available: false, expiresAt: null };
  }

  cancel(attemptId: string): boolean {
    const active = this.activePreparation;
    if (!active || active.attemptId !== attemptId) return false;
    active.controller.abort();
    return true;
  }

  async acquireCandidateForExport(
    snapshotId: string,
    allowStaleRevision = false,
  ): Promise<FrozenExportInput> {
    await this.pruneExpiredCandidates();
    if (this.activeExportSnapshots.has(snapshotId)) {
      throw new Error('PREPARATION_BUSY');
    }
    const stored = this.candidates.get(snapshotId);
    if (!stored) throw new Error('EXPORT_SNAPSHOT_UNAVAILABLE');
    const candidate = structuredClone(stored.candidate);
    const current = this.currentProject(candidate.projectRoot);
    if (
      !current ||
      current.project.id !== candidate.projectId ||
      current.openInstanceId !== candidate.openInstanceId
    ) {
      await this.discard(undefined, snapshotId);
      throw new Error('PROJECT_SESSION_CHANGED');
    }
    if (
      !allowStaleRevision &&
      (current.revision !== candidate.revision ||
        current.dirty !== candidate.dirtyAtCapture ||
        !projectsEqual(current.project, candidate.project))
    ) {
      throw new Error('PROJECT_SNAPSHOT_CHANGED');
    }

    this.activeExportSnapshots.add(snapshotId);
    try {
      await this.assertOutputTargetUnchanged(snapshotId);
      if (!this.fileStore.readAsset && candidate.mediaManifest.length > 0) {
        throw new Error('FROZEN_MEDIA_UNAVAILABLE');
      }
      const media: FrozenExportMedia[] = [];
      for (const entry of candidate.mediaManifest) {
        let bytes: Uint8Array<ArrayBuffer> | undefined;
        try {
          bytes = await this.fileStore.readAsset?.(
            snapshotId,
            entry.contentHandleId,
            entry.mimeType,
          );
        } catch {
          throw new Error('FROZEN_MEDIA_UNAVAILABLE');
        }
        if (!bytes) throw new Error('FROZEN_MEDIA_UNAVAILABLE');
        const digest = createHash('sha256').update(bytes).digest('hex');
        const allowedMimeTypes: readonly string[] =
          entry.kind === 'image'
            ? ['image/png', 'image/jpeg']
            : ['audio/mpeg', 'audio/wav'];
        if (
          bytes.byteLength !== entry.byteLength ||
          digest !== entry.sha256 ||
          !allowedMimeTypes.includes(entry.mimeType)
        ) {
          throw new Error('FROZEN_MEDIA_CHANGED');
        }
        if (entry.kind === 'image') {
          media.push({
            assetId: entry.assetId,
            kind: 'image',
            mimeType: entry.mimeType as 'image/png' | 'image/jpeg',
            bytes,
          });
        } else {
          media.push({
            assetId: entry.assetId,
            kind: 'audio',
            mimeType: entry.mimeType as 'audio/mpeg' | 'audio/wav',
            bytes,
          });
        }
      }
      if (media.length !== candidate.mediaManifest.length) {
        throw new Error('FROZEN_MEDIA_UNAVAILABLE');
      }
      return { candidate, media };
    } catch (error) {
      this.activeExportSnapshots.delete(snapshotId);
      if (
        error instanceof Error &&
        /FROZEN_MEDIA_UNAVAILABLE|FROZEN_MEDIA_CHANGED/iu.test(error.message)
      ) {
        try {
          await this.discard(undefined, snapshotId);
        } catch (cleanupError) {
          this.recordDiagnostic(
            candidate.attemptId,
            'Invalid frozen snapshot cleanup failed: ' + errorMessage(cleanupError),
          );
        }
      }
      throw error;
    }
  }

  async assertOutputTargetUnchanged(snapshotId: string): Promise<void> {
    const stored = this.candidates.get(snapshotId);
    if (!stored) throw new Error('EXPORT_SNAPSHOT_UNAVAILABLE');
    const candidate = stored.candidate;
    const expected: OutputSelection = {
      selectionId: candidate.outputIntent.selectionId,
      projectRoot: candidate.projectRoot,
      projectId: candidate.projectId,
      openInstanceId: candidate.openInstanceId,
      targetPath: candidate.outputIntent.targetPath,
      fileName: candidate.outputIntent.fileName,
      overwriteApproved: candidate.outputIntent.overwriteApproved,
      targetIdentity: candidate.outputIntent.targetIdentity,
    };
    let current: CapturedTarget;
    try {
      current = await captureTargetIdentity(candidate.outputIntent.targetPath);
    } catch {
      throw new Error('OUTPUT_TARGET_CHANGED');
    }
    if (!sameTarget(expected, current)) throw new Error('OUTPUT_TARGET_CHANGED');
  }

  releaseCandidateExport(snapshotId: string): void {
    this.activeExportSnapshots.delete(snapshotId);
  }

  async retainCandidateForRetry(snapshotId: string): Promise<void> {
    this.activeExportSnapshots.delete(snapshotId);
    const stored = this.candidates.get(snapshotId);
    if (stored) {
      stored.retryExpiresAt = this.now().getTime() + EXPORT_RETRY_RETENTION_MS;
      this.scheduleCandidateExpiry(snapshotId);
    }
    await this.pruneCandidateLimit();
  }

  async finalizeCandidateExport(snapshotId: string): Promise<void> {
    this.releaseCandidateExport(snapshotId);
    const removed = await this.removeCandidate(snapshotId);
    if (!removed) {
      const pending = this.pendingCandidateCleanups.get(snapshotId);
      if (pending) {
        throw new Error(this.candidateCleanupDiagnostic(
          snapshotId,
          pending,
          pending.lastError || 'Cleanup remains pending.',
        ));
      }
    }
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
      if (this.activeExportSnapshots.has(snapshotId)) return false;
      const candidate = this.candidates.get(snapshotId);
      if (!candidate) return false;
      return this.removeCandidate(snapshotId);
    }
    return false;
  }

  async dispose(): Promise<void> {
    this.activePreparation?.controller.abort();
    this.selection = null;
    this.activeExportSnapshots.clear();
    for (const snapshotId of [...this.candidates.keys()]) {
      await this.removeCandidate(snapshotId);
    }
    await Promise.all(
      [...this.pendingCandidateCleanups.values()]
        .map((pending) => pending.inFlight)
        .filter((inFlight): inFlight is Promise<boolean> => Boolean(inFlight))
        .map((inFlight) => inFlight.catch(() => false)),
    );
    for (const pending of this.pendingCandidateCleanups.values()) {
      this.clearCandidateCleanupRetry(pending);
    }
    try {
      await this.fileStore.dispose();
    } catch (error) {
      for (const [snapshotId, pending] of this.pendingCandidateCleanups) {
        this.recordDiagnostic(
          pending.candidate.attemptId,
          this.candidateCleanupDiagnostic(
            snapshotId,
            pending,
            `Application shutdown cleanup failed: ${errorMessage(error)}`,
          ),
        );
      }
      throw error;
    } finally {
      for (const stored of this.candidates.values()) {
        this.clearCandidateExpiry(stored);
      }
      this.candidates.clear();
      this.pendingCandidateCleanups.clear();
    }
  }

  disposeSync(): ExportPreparationCleanupFailure[] {
    this.activePreparation?.controller.abort();
    this.selection = null;
    this.activeExportSnapshots.clear();
    const attemptsBySnapshot = new Map<string, string>();
    for (const [snapshotId, stored] of this.candidates) {
      attemptsBySnapshot.set(snapshotId, stored.candidate.attemptId);
      this.clearCandidateExpiry(stored);
    }
    this.candidates.clear();
    for (const [snapshotId, pending] of this.pendingCandidateCleanups) {
      attemptsBySnapshot.set(snapshotId, pending.candidate.attemptId);
      this.clearCandidateCleanupRetry(pending);
    }
    this.pendingCandidateCleanups.clear();
    const failures = this.fileStore.disposeSync?.() ?? [];
    for (const failure of failures) {
      const attemptId = attemptsBySnapshot.get(failure.snapshotId) ?? failure.snapshotId;
      this.recordDiagnostic(
        attemptId,
        `Application shutdown cleanup failed for owned snapshot ${failure.snapshotId} at ${failure.ownedPath}: ${failure.error}. Takeover action: release the process holding this path, then remove only this exact owned snapshot directory.`,
      );
    }
    return failures;
  }

  private currentProject(projectRoot: string): TrackedProjectSnapshot | null {
    try {
      return this.options.getCurrentProjectSnapshot(projectRoot);
    } catch {
      return null;
    }
  }

  private async pruneExpiredCandidates(): Promise<void> {
    const now = this.now().getTime();
    for (const [snapshotId, stored] of this.candidates) {
      if (
        stored.retryExpiresAt <= now &&
        !this.activeExportSnapshots.has(snapshotId)
      ) {
        await this.removeCandidate(snapshotId);
      }
    }
  }

  private scheduleCandidateExpiry(snapshotId: string): void {
    const stored = this.candidates.get(snapshotId);
    if (!stored) return;
    this.clearCandidateExpiry(stored);
    const delay = Math.max(1, stored.retryExpiresAt - this.now().getTime());
    stored.expiryTimer = setTimeout(() => {
      void this.expireCandidate(snapshotId);
    }, delay);
    stored.expiryTimer.unref?.();
  }

  private async expireCandidate(snapshotId: string): Promise<void> {
    const stored = this.candidates.get(snapshotId);
    if (!stored) return;
    if (this.activeExportSnapshots.has(snapshotId)) {
      stored.retryExpiresAt = this.now().getTime() + EXPORT_RETRY_RETENTION_MS;
      this.scheduleCandidateExpiry(snapshotId);
      return;
    }
    if (stored.retryExpiresAt > this.now().getTime()) {
      this.scheduleCandidateExpiry(snapshotId);
      return;
    }
    await this.removeCandidate(snapshotId);
  }

  private clearCandidateExpiry(stored: StoredCandidate | undefined): void {
    if (!stored?.expiryTimer) return;
    clearTimeout(stored.expiryTimer);
    stored.expiryTimer = undefined;
  }

  private async pruneCandidateLimit(): Promise<void> {
    const retained = [...this.candidates.entries()]
      .filter(([snapshotId]) => !this.activeExportSnapshots.has(snapshotId))
      .sort((left, right) => left[1].retryExpiresAt - right[1].retryExpiresAt);
    while (this.candidates.size > MAX_RETAINED_EXPORT_CANDIDATES && retained.length > 0) {
      const [snapshotId] = retained.shift()!;
      await this.removeCandidate(snapshotId);
    }
  }

  private async reserveCandidateSlot(
    pendingCleanupIdsToRecheck: ReadonlySet<string>,
  ): Promise<boolean> {
    await Promise.all(
      [...pendingCleanupIdsToRecheck].map(async (snapshotId) => {
        const pending = this.pendingCandidateCleanups.get(snapshotId);
        if (!pending) return;
        await this.attemptCandidateCleanup(snapshotId, pending, 'explicit');
      }),
    );
    if (this.pendingCandidateCleanups.size > 0) return false;
    while (
      this.candidates.size + this.pendingCandidateCleanups.size >=
      MAX_RETAINED_EXPORT_CANDIDATES
    ) {
      const oldest = [...this.candidates.entries()]
        .filter(([snapshotId]) => !this.activeExportSnapshots.has(snapshotId))
        .sort((left, right) => left[1].retryExpiresAt - right[1].retryExpiresAt)[0];
      if (!oldest) return false;
      const removed = await this.removeCandidate(oldest[0]);
      if (!removed) return false;
    }
    return true;
  }

  private async removeCandidate(snapshotId: string): Promise<boolean> {
    if (this.activeExportSnapshots.has(snapshotId)) return false;
    let pending = this.pendingCandidateCleanups.get(snapshotId);
    if (!pending) {
      const stored = this.candidates.get(snapshotId);
      if (!stored) return true;
      this.clearCandidateExpiry(stored);
      this.candidates.delete(snapshotId);
      pending = {
        candidate: structuredClone(stored.candidate),
        attempts: 0,
        explicitRecoveryAttempts: 0,
        lastError: '',
      };
      this.pendingCandidateCleanups.set(snapshotId, pending);
    }
    this.activeExportSnapshots.delete(snapshotId);
    return this.attemptCandidateCleanup(
      snapshotId,
      pending,
      pending.attempts >= MAX_CANDIDATE_CLEANUP_ATTEMPTS
        ? 'explicit'
        : 'automatic',
    );
  }

  private async attemptCandidateCleanup(
    snapshotId: string,
    pending: PendingCandidateCleanup,
    attemptKind: 'automatic' | 'explicit' = 'automatic',
  ): Promise<boolean> {
    if (this.pendingCandidateCleanups.get(snapshotId) !== pending) return true;
    if (pending.inFlight) return pending.inFlight;
    this.clearCandidateCleanupRetry(pending);
    const operation = (async (): Promise<boolean> => {
      if (
        attemptKind === 'explicit' &&
        pending.attempts >= MAX_CANDIDATE_CLEANUP_ATTEMPTS
      ) {
        pending.explicitRecoveryAttempts += 1;
      } else {
        pending.attempts += 1;
      }
      try {
        await this.fileStore.delete(snapshotId);
        this.pendingCandidateCleanups.delete(snapshotId);
        return true;
      } catch (error) {
        pending.lastError = errorMessage(error);
        const diagnostic = this.candidateCleanupDiagnostic(
          snapshotId,
          pending,
          pending.lastError,
        );
        this.recordDiagnostic(
          pending.candidate.attemptId,
          diagnostic,
        );
        console.error(diagnostic);
        this.scheduleCandidateCleanupRetry(snapshotId, pending);
        return false;
      }
    })();
    pending.inFlight = operation;
    try {
      return await operation;
    } finally {
      if (pending.inFlight === operation) pending.inFlight = undefined;
    }
  }

  private scheduleCandidateCleanupRetry(
    snapshotId: string,
    pending: PendingCandidateCleanup,
  ): void {
    if (pending.attempts >= MAX_CANDIDATE_CLEANUP_ATTEMPTS) return;
    const delay = CANDIDATE_CLEANUP_RETRY_DELAYS_MS[pending.attempts - 1];
    if (delay === undefined) return;
    pending.retryTimer = setTimeout(() => {
      pending.retryTimer = undefined;
      void this.attemptCandidateCleanup(snapshotId, pending);
    }, delay);
    pending.retryTimer.unref?.();
  }

  private clearCandidateCleanupRetry(
    pending: PendingCandidateCleanup | undefined,
  ): void {
    if (!pending?.retryTimer) return;
    clearTimeout(pending.retryTimer);
    pending.retryTimer = undefined;
  }

  private candidateCleanupDiagnostic(
    snapshotId: string,
    pending: PendingCandidateCleanup,
    error: string,
  ): string {
    const ownedPath = this.fileStore.getOwnedPath?.(snapshotId) ?? snapshotId;
    const exhausted = pending.attempts >= MAX_CANDIDATE_CLEANUP_ATTEMPTS;
    const retry = exhausted
      ? 'Retry budget exhausted.'
      : 'A bounded retry is scheduled.';
    const takeover = exhausted
      ? ' Takeover action: release the process holding this path, then remove only this exact owned snapshot directory.'
      : '';
    const recoveryAttempt = pending.explicitRecoveryAttempts > 0
      ? `; explicit recovery ${pending.explicitRecoveryAttempts}`
      : '';
    return `Export snapshot cleanup ${exhausted ? 'exhausted' : 'failed'} for snapshot ${snapshotId} at ${ownedPath} (attempt ${pending.attempts}/${MAX_CANDIDATE_CLEANUP_ATTEMPTS}${recoveryAttempt}): ${error}. ${retry}${takeover}`;
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

  private mediaUnavailableIssue(
    location: string,
    error?: unknown,
  ): ExportPreparationIssue {
    if (error !== undefined && isFilesystemPermissionError(error)) {
      return {
        code: 'REQUIRED_MEDIA_UNAVAILABLE',
        location,
        problem: '无法读取所需素材，素材文件或所在目录可能没有读取权限。',
        nextStep: '检查素材文件和上级目录的读取权限，或重新导入素材后再检查。',
      };
    }
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
      nextStep: '请选择一个尚未存在的新文件名后重试。',
    };
  }

  private outputExistsIssue(): ExportPreparationIssue {
    return {
      code: 'OUTPUT_TARGET_EXISTS',
      location: '输出位置',
      problem: '输出文件已存在，正式导出不会覆盖现有 MP4。',
      nextStep: '请选择一个尚未存在的新文件名，例如“第一集 (2).mp4”。',
    };
  }

  private outputLocationUnsupportedIssue(): ExportPreparationIssue {
    return {
      code: 'OUTPUT_LOCATION_UNSUPPORTED',
      location: '输出位置',
      problem: '正式 MP4 导出仅支持 Windows 本地 NTFS 文件夹。',
      nextStep: '请选择本机 NTFS 磁盘上的文件夹后重试。',
    };
  }

  private outputLocationPermissionIssue(): ExportPreparationIssue {
    return {
      code: 'OUTPUT_LOCATION_UNSUPPORTED',
      location: '输出位置',
      problem: '所选文件夹没有创建 MP4 文件所需的写入权限。',
      nextStep: '检查文件夹的写入权限，或选择当前账户可写的本地 NTFS 文件夹后重试。',
    };
  }

  private outputPathTooLongIssue(): ExportPreparationIssue {
    return {
      code: 'OUTPUT_LOCATION_UNSUPPORTED',
      location: '输出位置',
      problem:
        '正式 MP4 导出目标或同目录暂存路径超过 Windows ' +
        EXPORT_PREPARATION_WINDOWS_FORMAL_OUTPUT_MAX_PATH_CHARACTERS +
        ' 字符上限。',
      nextStep:
        '改选更浅的本机 NTFS 文件夹或缩短文件名，使目标和暂存路径都不超过 ' +
        EXPORT_PREPARATION_WINDOWS_FORMAL_OUTPUT_MAX_PATH_CHARACTERS +
        ' 个字符。',
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

  private preparationFailedIssue(
    location: string,
    error?: unknown,
  ): ExportPreparationIssue {
    if (error !== undefined && isFilesystemPermissionError(error)) {
      return {
        code: 'PREPARATION_FAILED',
        location,
        problem: '所需素材无法写入临时准备目录，目录权限可能受限。',
        nextStep: '检查系统临时目录的写入权限后重新检查；工程和已有输出未被修改。',
      };
    }
    return {
      code: 'PREPARATION_FAILED',
      location,
      problem: '素材副本无法安全写入临时准备目录。',
      nextStep: '检查可用磁盘空间后重新检查；工程和已有输出未被修改。',
    };
  }

  private preparationSetupFailedIssue(error: unknown): ExportPreparationIssue {
    if (isFilesystemPermissionError(error)) {
      return {
        code: 'PREPARATION_FAILED',
        location: '导出准备',
        problem: '无法创建临时导出准备目录，目录权限可能受限。',
        nextStep: '检查系统临时目录的写入权限后重新检查；工程和已有输出未被修改。',
      };
    }
    return {
      code: 'PREPARATION_FAILED',
      location: '导出准备',
      problem: '工程检查未能安全完成。',
      nextStep: '重新选择输出位置后重试；工程和已有输出未被修改。',
    };
  }

  private unavailableSnapshotIssue(): ExportPreparationIssue {
    return {
      code: 'PREPARATION_FAILED',
      location: '\u539f\u5185\u5bb9\u5feb\u7167',
      problem: '\u51bb\u7ed3\u7684\u5185\u5bb9\u4e0d\u518d\u53ef\u7528\u3002',
      nextStep: '\u8bf7\u9009\u62e9\u201c\u6309\u5f53\u524d\u5185\u5bb9\u91cd\u65b0\u5bfc\u51fa\u201d\uff0c\u521b\u5efa\u65b0\u7684\u5185\u5bb9\u5feb\u7167\u3002',
    };
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
  await assertOutputDirectoryWritable(parentDirectory);
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

async function assertOutputDirectoryWritable(
  outputDirectory: string,
): Promise<void> {
  const probePath = path.join(
    outputDirectory,
    `.panda-stage-permission-probe-${randomUUID()}.tmp`,
  );
  const probeHandle = await open(probePath, 'wx');
  try {
    await probeHandle.close();
  } finally {
    await unlink(probePath);
  }
}

function sameTarget(
  selection: OutputSelection,
  current: CapturedTarget,
): boolean {
  if (!samePath(selection.targetPath, current.canonicalPath)) return false;
  return sameTargetIdentity(selection.targetIdentity, current.identity);
}

function sameTargetIdentity(
  expected: ExportOutputTargetIdentity | null,
  current: ExportOutputTargetIdentity | null,
): boolean {
  if (expected === null || current === null) return expected === current;
  return (
    samePath(
      expected.canonicalPath,
      current.canonicalPath,
    ) &&
    expected.volumeId === current.volumeId &&
    expected.fileId === current.fileId &&
    expected.sizeBytes === current.sizeBytes &&
    expected.modifiedTimeNs === current.modifiedTimeNs &&
    expected.changedTimeNs === current.changedTimeNs
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

function isFilesystemPermissionError(error: unknown): boolean {
  const seen = new Set<object>();
  let current = error;
  while (typeof current === 'object' && current !== null && !seen.has(current)) {
    seen.add(current);
    const candidate = current as {
      code?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    if (
      typeof candidate.code === 'string' &&
      ['EACCES', 'EPERM', 'EROFS'].includes(candidate.code)
    ) {
      return true;
    }
    if (
      typeof candidate.message === 'string' &&
      /(EACCES|EPERM|EROFS|permission denied|access is denied)/iu.test(
        candidate.message,
      )
    ) {
      return true;
    }
    current = candidate.cause;
  }
  return (
    typeof current === 'string' &&
    /(EACCES|EPERM|EROFS|permission denied|access is denied)/iu.test(current)
  );
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
