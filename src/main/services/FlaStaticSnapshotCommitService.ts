/**
 * V2-R1 Static Snapshot — commit path (R1-E).
 *
 * Issue #287 R1-E. Turns one confirmed, accepted snapshot preview into
 * exactly one ordinary Panda ImageAsset. It does NOT reuse the V1/V1.5
 * fla-raster-commit path; the R1 snapshot bytes come from the sandboxed
 * renderer, not from an inspected raster-media session, so a dedicated
 * contract (fla-static-snapshot-commit) keeps the two truthful and
 * distinguishable (R1-A boundary rule).
 *
 * Reuses the existing asset persistence / dedup / rollback primitives
 * (AssetImportFileSystemService, HashService, allocateAssetTargetName,
 * validatePngEncodedImage, ImageAssetSchema) so snapshot imports behave
 * identically to ordinary image imports.
 *
 * Guards (per R1-D / R1-E):
 *  - STALE_PREVIEW: the pinned confirmedPreviewRequestId must be the
 *    latest accepted preview for the session; otherwise a stale result
 *    cannot be committed.
 *  - STALE_PROJECT_REVISION: the request's project/revision must match.
 *  - SOURCE_MISMATCH: the confirmed preview's source identity must match.
 *  - no Project mutation occurs until the confirmed preview is pinned.
 */

import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { FLA_IMPORT_LIMITS } from '../../shared/fla-import-api';
import {
  FlaStaticSnapshotCommitRequestSchema,
  FlaStaticSnapshotCommitResponseSchema,
  type FlaStaticSnapshotCommitRequest,
  type FlaStaticSnapshotCommitErrorCode,
  type FlaStaticSnapshotCommitResponse,
  type FlaRenderTarget,
} from '../../shared/fla-static-snapshot-api';
import {
  ImageAssetSchema,
  ProjectSchema,
  type ImageAsset,
  type Project,
} from '../../domain';
import {
  assetDisplayName,
  allocateAssetTargetName,
  sanitizeAssetFileName,
} from './AssetImportService';
import { safeUtf16Slice } from '../../shared/asset-name';
import {
  AssetImportFileSystemService,
  type AssetCopyCleanupKind,
} from './AssetImportFileSystemService';
import { HashService } from './HashService';
import { validatePngEncodedImage } from './PngThumbnailValidator';
import { ProjectService, ProjectServiceError, type ProjectTransaction } from './ProjectService';
import type {
  FlaStaticSnapshotRenderSession,
} from './fla-static-snapshot-render-session';

export interface FlaStaticSnapshotProjectSnapshot {
  project: Project;
  revision: number;
}

export interface FlaStaticSnapshotCommitServiceOptions {
  projectService: ProjectService;
  getCurrentProjectSnapshot: (projectRoot: string) => FlaStaticSnapshotProjectSnapshot | null;
  previewStore: Pick<
    FlaStaticSnapshotRenderSession,
    'getConfirmedPreview' | 'releasePreview' | 'isLatestAcceptedPreview'
  >;
  fileSystem?: AssetImportFileSystemService;
  hashService?: HashService;
  faults?: FlaStaticSnapshotCommitFaultInjector;
  createId?: () => string;
  now?: () => Date;
}

export interface FlaStaticSnapshotCommitFaultInjector {
  beforeProjectSave?(project: Project): void | Promise<void>;
}

export interface FlaStaticSnapshotCommitOperation {
  project: Project;
  baseRevision: number;
  savedRevision: number;
  projectChanged: boolean;
  result: import('../../shared/fla-static-snapshot-api').FlaStaticSnapshotCommitResult;
}

interface CommitErrorDetails extends ErrorOptions {
  currentProject?: Project;
  currentRevision?: number;
  residualPaths?: readonly string[];
}

function snapshotTargetDisplayName(userLabel: string): string {
  const basename = userLabel.replaceAll('\\', '/').split('/').at(-1) ?? '';
  const normalized = basename
    .normalize('NFC')
    .replace(/\p{Cc}/gu, '_')
    .trim();
  return safeUtf16Slice(normalized || 'Imported asset', 200);
}

function isSameConfirmedTarget(
  confirmed: FlaRenderTarget,
  requested: FlaRenderTarget,
): boolean {
  return confirmed.renderTargetId === requested.renderTargetId &&
    confirmed.kind === requested.kind &&
    confirmed.userLabel === requested.userLabel &&
    confirmed.sourceLibraryItemName === requested.sourceLibraryItemName &&
    confirmed.sourceTimelineIndex === requested.sourceTimelineIndex &&
    confirmed.sourceSymbolName === requested.sourceSymbolName &&
    confirmed.frameCount === requested.frameCount &&
    (confirmed.selectedFrameIndex ?? 0) === (requested.selectedFrameIndex ?? 0) &&
    confirmed.compatibility.length === requested.compatibility.length &&
    confirmed.compatibility.every((status, index) => status === requested.compatibility[index]);
}

export class FlaStaticSnapshotCommitServiceError extends Error {
  readonly currentProject?: Project;
  readonly currentRevision?: number;
  readonly residualPaths: readonly string[];

  constructor(
    readonly code: FlaStaticSnapshotCommitErrorCode,
    readonly projectRoot: string,
    message: string,
    details: CommitErrorDetails = {},
  ) {
    super(message, { cause: details.cause });
    this.name = 'FlaStaticSnapshotCommitServiceError';
    this.currentProject = details.currentProject;
    this.currentRevision = details.currentRevision;
    this.residualPaths = details.residualPaths ?? [];
  }
}

export class FlaStaticSnapshotCommitService {
  private readonly projectService: ProjectService;
  private readonly getCurrentProjectSnapshot: (projectRoot: string) => FlaStaticSnapshotProjectSnapshot | null;
  private readonly previewStore: Pick<
    FlaStaticSnapshotRenderSession,
    'getConfirmedPreview' | 'releasePreview' | 'isLatestAcceptedPreview'
  >;
  private readonly fileSystem: AssetImportFileSystemService;
  private readonly hashService: HashService;
  private readonly faults: FlaStaticSnapshotCommitFaultInjector;
  private readonly createId: () => string;
  private readonly now: () => Date;
  private readonly activeSessions = new Set<string>();

  constructor(options: FlaStaticSnapshotCommitServiceOptions) {
    this.projectService = options.projectService;
    this.getCurrentProjectSnapshot = options.getCurrentProjectSnapshot;
    this.previewStore = options.previewStore;
    this.fileSystem = options.fileSystem ?? new AssetImportFileSystemService();
    this.hashService = options.hashService ?? new HashService();
    this.faults = options.faults ?? {};
    this.createId = options.createId ?? randomUUID;
    this.now = options.now ?? (() => new Date());
  }

  async commit(rawRequest: unknown): Promise<FlaStaticSnapshotCommitResponse> {
    let request: FlaStaticSnapshotCommitRequest;
    try {
      request = FlaStaticSnapshotCommitRequestSchema.parse(rawRequest);
    } catch (error) {
      return this.failure('INVALID_REQUEST', '(unknown project)', String(error));
    }
    if (this.activeSessions.has(request.sessionId)) {
      return this.failure('COMMIT_BUSY', request.projectRoot, 'This snapshot import is already being committed.');
    }
    this.activeSessions.add(request.sessionId);
    try {
      return await this.projectService.transact(
        request.projectRoot,
        async (transaction) => this.commitInTransaction(transaction, request),
      );
    } catch (error) {
      if (error instanceof FlaStaticSnapshotCommitServiceError) {
        return this.failure(error.code, error.projectRoot, error.message, {
          cause: error,
          currentProject: error.currentProject,
          currentRevision: error.currentRevision,
          residualPaths: error.residualPaths,
        });
      }
      const stale = this.currentSnapshot(request.projectRoot);
      if (error instanceof ProjectServiceError && error.code === 'PROJECT_SAVE_STALE_REVISION') {
        return this.failure(
          'STALE_PROJECT_REVISION',
          request.projectRoot,
          'The Project changed before the snapshot could be saved. Refresh and retry.',
          { cause: error, currentProject: stale?.project, currentRevision: stale?.revision },
        );
      }
      return this.failure('ASSET_COMMIT_FAILED', request.projectRoot, 'The snapshot could not be committed.', { cause: error });
    } finally {
      this.activeSessions.delete(request.sessionId);
    }
  }

  private async commitInTransaction(
    transaction: ProjectTransaction,
    request: FlaStaticSnapshotCommitRequest,
  ): Promise<FlaStaticSnapshotCommitResponse> {
    // R1-D stale-preview guard: only the latest accepted preview may commit.
    if (!this.previewStore.isLatestAcceptedPreview(request.sessionId, request.confirmedPreviewRequestId)) {
      return this.failure('STALE_PREVIEW', transaction.projectRoot, 'The confirmed preview is no longer the latest; re-preview before importing.');
    }
    const confirmed = this.previewStore.getConfirmedPreview(request.confirmedPreviewRequestId);
    if (!confirmed) {
      return this.failure('STALE_PREVIEW', transaction.projectRoot, 'The confirmed preview has expired; re-preview before importing.');
    }
    // Pinned preview metadata must match the confirmed bytes exactly.
    if (
      confirmed.sha256 !== request.preview.sha256 ||
      confirmed.width !== request.preview.width ||
      confirmed.height !== request.preview.height ||
      confirmed.byteLength !== request.preview.byteLength
    ) {
      return this.failure('STALE_PREVIEW', transaction.projectRoot, 'The confirmed preview metadata does not match the rendered snapshot.');
    }
    if (
      confirmed.source.basename !== request.source.basename ||
      confirmed.source.sha256 !== request.source.sha256
    ) {
      return this.failure('SOURCE_MISMATCH', transaction.projectRoot, 'The snapshot source no longer matches the inspection session.');
    }
    if (!isSameConfirmedTarget(confirmed.target, request.target)) {
      return this.failure(
        'STALE_PREVIEW',
        transaction.projectRoot,
        'The requested target or frame does not match the confirmed preview; re-preview the selected target before importing.',
      );
    }

    const current = this.assertCurrentRevision(
      transaction.projectRoot,
      request.project,
      request.baseRevision,
    );

    const bytes = confirmed.pngBytes;
    const validatedPng = validatePngEncodedImage(Buffer.from(bytes), {
      maxWidth: FLA_IMPORT_LIMITS.maxImageWidth,
      maxHeight: FLA_IMPORT_LIMITS.maxImageHeight,
      maxPixels: FLA_IMPORT_LIMITS.maxImagePixels,
      maxEncodedBytes: FLA_IMPORT_LIMITS.maxSingleEntryBytes,
    });
    if (
      !validatedPng ||
      validatedPng.width !== confirmed.width ||
      validatedPng.height !== confirmed.height
    ) {
      return this.failure('ASSET_COMMIT_FAILED', transaction.projectRoot, 'The rendered snapshot is not a valid bounded PNG owned by Panda Stage.');
    }

    const sha256 = this.hashService.hashBytes(Buffer.from(bytes)).hex;
    const occupiedNames = new Set(
      current.project.assets.map((asset) => path.basename(asset.relativePath).toLowerCase()),
    );
    const existing = current.project.assets.find(
      (asset) => asset.kind === 'image' && asset.sha256 === sha256,
    ) as ImageAsset | undefined;
    const isFirst = !existing;

    // The Windows FFmpeg thumbnail path cannot reopen non-ASCII input names;
    // keep the stored PNG path ASCII while preserving its display name below.
    const baseName = `fla-snapshot-${request.target.renderTargetId}-${sha256.slice(0, 12)}`.slice(0, 120);
    const preferredFileName = sanitizeAssetFileName(baseName, '.png');
    let targetFileName: string;
    let asset: ImageAsset;
    let duplicateOfAssetId: string | null = null;
    let renamed = false;
    if (existing) {
      targetFileName = path.basename(existing.relativePath);
      asset = existing;
      duplicateOfAssetId = existing.id;
    } else {
      try {
        targetFileName = await allocateAssetTargetName(
          this.fileSystem,
          transaction.projectRoot,
          preferredFileName,
          sha256,
          occupiedNames,
        );
      } catch (error) {
        return this.failure('IMPORT_COLLISION', transaction.projectRoot, 'A safe target name could not be allocated for the snapshot.', { cause: error });
      }
      renamed = targetFileName !== preferredFileName;
      asset = ImageAssetSchema.parse({
        id: this.createId(),
        name: safeUtf16Slice(
          assetDisplayName(request.source.basename) + ' · ' +
            snapshotTargetDisplayName(request.target.userLabel) + ' · 第 ' +
            String((request.target.selectedFrameIndex ?? 0) + 1) + ' 帧',
          200,
        ),
        relativePath: `assets/${targetFileName}`,
        mimeType: 'image/png',
        sha256,
        kind: 'image',
        width: validatedPng.width,
        height: validatedPng.height,
        usage: 'uncategorized',
        keywords: [],
        flaSnapshot: {
          sourceBasename: request.source.basename,
          sourceSha256:
            confirmed.source.originalSourceSha256 ?? request.source.sha256,
          targetName: request.target.userLabel,
          ...(request.target.sourceLibraryItemName
            ? { sourceLibraryItemName: request.target.sourceLibraryItemName }
            : {}),
          renderTargetId: request.target.renderTargetId,
          selectedFrameIndex: request.target.selectedFrameIndex ?? 0,
          previewSha256: sha256,
        },
      });
    }

    if (!isFirst) {
      this.previewStore.releasePreview(request.confirmedPreviewRequestId);
      return FlaStaticSnapshotCommitResponseSchema.parse({
        ok: true,
        status: 'completed',
        project: current.project,
        baseRevision: current.revision,
        savedRevision: current.revision,
        projectChanged: false,
        result: {
          assetId: asset.id,
          sourceName: request.target.userLabel,
          width: validatedPng.width,
          height: validatedPng.height,
          status: 'duplicate',
          sha256,
          asset,
          duplicateOfAssetId,
          targetFileName,
          renamed: false,
          message: 'Reused existing Asset ' + targetFileName + '.',
        },
      } satisfies FlaStaticSnapshotCommitResponse);
    }

    const operationId = this.createId();
    const temporaryFileName = `.fla-snapshot-commit.${operationId}.tmp`;
    const nextProject = ProjectSchema.parse({
      ...current.project,
      assets: [...current.project.assets, asset],
      updatedAt: this.now().toISOString(),
    });

    let projectSaved = false;
    try {
      await this.fileSystem.writeFlaCommitTemporary(transaction.projectRoot, bytes, temporaryFileName);
      await this.fileSystem.finalizeFlaCommitTemporary(
        transaction.projectRoot,
        temporaryFileName,
        targetFileName,
      );
      await this.faults.beforeProjectSave?.(nextProject);
      const savedDocument = await transaction.save(nextProject, current.revision + 1, () => {
        this.assertCurrentRevision(transaction.projectRoot, current.project, current.revision);
      });
      projectSaved = true;
      const savedAsset = savedDocument.project.assets.find((a) => a.id === asset.id);
      if (
        !savedAsset ||
        savedAsset.kind !== 'image' ||
        savedAsset.relativePath !== asset.relativePath ||
        savedAsset.sha256 !== sha256 ||
        !(await this.fileSystem.fileExists(path.resolve(transaction.projectRoot, savedAsset.relativePath)))
      ) {
        throw new Error('Saved Project does not reference the snapshot asset file.');
      }
      const fileHash = await this.hashService.hashFile(
        path.resolve(transaction.projectRoot, savedAsset.relativePath),
      );
      if (fileHash.hex !== sha256) {
        throw new Error('The finalized snapshot file failed post-save verification.');
      }
      this.previewStore.releasePreview(request.confirmedPreviewRequestId);
      return FlaStaticSnapshotCommitResponseSchema.parse({
        ok: true,
        status: 'completed',
        project: savedDocument.project,
        baseRevision: current.revision,
        savedRevision: current.revision + 1,
        projectChanged: true,
        result: {
          assetId: asset.id,
          sourceName: request.target.userLabel,
          width: validatedPng.width,
          height: validatedPng.height,
          status: 'imported',
          sha256,
          asset,
          duplicateOfAssetId,
          targetFileName,
          renamed,
          message: `Imported ${request.target.userLabel} as ${targetFileName}.`,
        },
      } satisfies FlaStaticSnapshotCommitResponse);
    } catch (error) {
      await this.rollbackAfterFailure(transaction, temporaryFileName, targetFileName, projectSaved, current.revision);
      return this.failure('ASSET_COMMIT_FAILED', transaction.projectRoot, 'The snapshot could not be committed.', { cause: error });
    }
  }

  private assertCurrentRevision(
    projectRoot: string,
    requestProject: Project,
    baseRevision: number,
  ): FlaStaticSnapshotProjectSnapshot {
    const current = this.currentSnapshot(projectRoot);
    if (
      !current ||
      current.project.id !== requestProject.id ||
      current.revision !== baseRevision ||
      JSON.stringify(current.project) !== JSON.stringify(requestProject)
    ) {
      throw new FlaStaticSnapshotCommitServiceError(
        'STALE_PROJECT_REVISION',
        projectRoot,
        'The Project changed after the snapshot preview was made. Refresh and retry.',
        { currentProject: current?.project, currentRevision: current?.revision },
      );
    }
    return { project: ProjectSchema.parse(current.project), revision: current.revision };
  }

  private async rollbackAfterFailure(
    transaction: ProjectTransaction,
    temporaryFileName: string,
    targetFileName: string,
    projectSaved: boolean,
    baseRevision: number,
  ): Promise<void> {
    if (projectSaved) {
      try {
        await transaction.save(transaction.existingDocument.project, baseRevision);
      } catch (error) {
        throw new FlaStaticSnapshotCommitServiceError(
          'ROLLBACK_FAILED',
          transaction.projectRoot,
          'The snapshot commit failed and the Project could not be rolled back safely.',
          { cause: error, residualPaths: [`assets/${targetFileName}`, `assets/${temporaryFileName}`] },
        );
      }
    }
    // finalizeFlaCommitTemporary hard-links the temporary to the target and
    // deletes the temporary, so when the save faults only the finalized target
    // file remains on disk. Remove both so a failed commit leaves no asset.
    const cleanupTargets: Array<[string, AssetCopyCleanupKind]> = [
      [targetFileName, 'target'],
      [temporaryFileName, 'temporary'],
    ];
    for (const [fileName, kind] of cleanupTargets) {
      try {
        await this.fileSystem.removeFlaCommitFile(transaction.projectRoot, fileName, kind);
      } catch {
        // best-effort cleanup; the caller reports residual paths if needed
      }
    }
  }

  private currentSnapshot(projectRoot: string): FlaStaticSnapshotProjectSnapshot | null {
    const snapshot = this.getCurrentProjectSnapshot(projectRoot);
    if (!snapshot) return null;
    return {
      project: ProjectSchema.parse(snapshot.project),
      revision: snapshot.revision,
    };
  }

  private failure(
    code: FlaStaticSnapshotCommitErrorCode,
    projectRoot: string,
    message: string,
    details: CommitErrorDetails = {},
  ): FlaStaticSnapshotCommitResponse {
    const error = new FlaStaticSnapshotCommitServiceError(code, projectRoot, message, details);
    return FlaStaticSnapshotCommitResponseSchema.parse({
      ok: false,
      error: {
        code: error.code,
        message: error.message.slice(0, 1_000),
        projectRoot: error.projectRoot,
        ...(error.currentProject ? { currentProject: error.currentProject } : {}),
        ...(error.currentRevision !== undefined ? { currentRevision: error.currentRevision } : {}),
        ...(error.residualPaths.length > 0 ? { residualPaths: error.residualPaths } : {}),
      },
    });
  }
}
