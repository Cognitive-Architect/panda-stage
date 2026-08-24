/**
 * V2-R2 Frame Sequence — commit path (R2-G / R2-D end-to-end).
 *
 * Issue #294 R2-G. Turns one confirmed, accepted frame sequence into
 * N ordinary Panda ImageAssets in a single atomic Project revision.
 * It does NOT reuse the V1/V1.5 fla-raster-commit path and it does
 * NOT reuse the R1 single-frame commit service internally; the R1
 * service is single-frame and its writeFlaCommitTemporary / save
 * pattern is one revision per frame, which would explode the
 * revision counter for a 24-frame sequence. R2 commit is a single
 * transaction, one revision + 1 for the whole batch.
 *
 * Reuses the existing asset persistence / dedup / rollback primitives
 * (AssetImportFileSystemService, HashService, allocateAssetTargetName,
 * validatePngEncodedImage, ImageAssetSchema, ProjectService) so
 * sequence imports behave identically to ordinary image imports
 * once written to disk.
 *
 * Guards (per R2-D / R2-G / R2-F):
 *  - STALE_SEQUENCE: the pinned confirmedSequenceRequestId must be
 *    the latest accepted sequence for the session; the per-frame
 *    sha256 / width / height / byteLength echoes in the request
 *    must all match the bytes held in the sequence acceptance
 *    store. Any mismatch rejects the commit before any file write
 *    so a stale UI result can never become a half-created Project.
 *  - STALE_PROJECT_REVISION: the request's project/revision must
 *    match the live Project state.
 *  - SOURCE_MISMATCH: the source identity (basename, sha256) must
 *    match the FLA source that produced the sequence.
 *  - COMMIT_BUSY: the same sessionId cannot run two commits
 *    concurrently.
 *  - IMPORT_COLLISION: a safe target name could not be allocated.
 *  - ASSET_COMMIT_FAILED: per-frame PNG validation failed, file
 *    write failed, post-save verification failed, or
 *    transaction.save threw.
 *  - ROLLBACK_FAILED: the commit failed and a clean rollback
 *    could not be performed.
 *  - no Project mutation occurs until the confirmed sequence is
 *    pinned; on any failure the live Project is unchanged.
 *
 * Security boundary unchanged from R1:
 *  - sandbox = true, contextIsolation = true, nodeIntegration = false
 *  - PNG bytes come from the R2-C sequence service which in turn
 *    receives them from the R1 single-frame rasterizer. The R2-G
 *    commit service is the single point of handoff to ImageAsset.
 *  - ActionScript is never executed.
 */

import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { FLA_IMPORT_LIMITS } from '../../shared/fla-import-api';
import {
  FlaFrameSequenceCommitRequestSchema,
  FlaFrameSequenceCommitResponseSchema,
  type FlaFrameSequenceCommitErrorCode,
  type FlaFrameSequenceCommitItem,
  type FlaFrameSequenceCommitRequest,
  type FlaFrameSequenceCommitResponse,
  type FlaFrameSequenceCommitResult,
} from '../../shared/fla-frame-sequence-api';
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
import {
  AssetImportFileSystemService,
  type AssetCopyCleanupKind,
} from './AssetImportFileSystemService';
import { HashService } from './HashService';
import { validatePngEncodedImage } from './PngThumbnailValidator';
import { ProjectService, ProjectServiceError, type ProjectTransaction } from './ProjectService';
import type {
  ConfirmedSequenceFrame,
} from './fla-frame-sequence-service';

// ---- Sequence store surface (R2-D plumbing, owned by
//      FlaFrameSequenceService) ----

export interface FlaFrameSequenceStore {
  /** R2-D: true only when requestId is the latest accepted sequence for sessionId. */
  isLatestAcceptedSequence(sessionId: string, requestId: string): boolean;
  /** R2-D: per-requestId confirmed frame bytes, or null if released / superseded. */
  getConfirmedSequence(requestId: string): ConfirmedSequenceFrame[] | null;
  /** R2-D: drop the per-requestId confirmed frame list. Called after a successful commit. */
  releaseSequence(requestId: string): void;
}

// ---- Project snapshot (mirror of R1) ----

export interface FlaFrameSequenceProjectSnapshot {
  project: Project;
  revision: number;
}

export interface FlaFrameSequenceCommitServiceOptions {
  projectService: ProjectService;
  getCurrentProjectSnapshot: (projectRoot: string) => FlaFrameSequenceProjectSnapshot | null;
  sequenceStore: FlaFrameSequenceStore;
  fileSystem?: AssetImportFileSystemService;
  hashService?: HashService;
  faults?: FlaFrameSequenceCommitFaultInjector;
  createId?: () => string;
  now?: () => Date;
}

export interface FlaFrameSequenceCommitFaultInjector {
  beforeProjectSave?(project: Project): void | Promise<void>;
}

export interface FlaFrameSequenceCommitOperation {
  project: Project;
  baseRevision: number;
  savedRevision: number;
  projectChanged: boolean;
  result: FlaFrameSequenceCommitResult;
}

interface CommitErrorDetails extends ErrorOptions {
  currentProject?: Project;
  currentRevision?: number;
  residualPaths?: readonly string[];
}

export class FlaFrameSequenceCommitServiceError extends Error {
  readonly currentProject?: Project;
  readonly currentRevision?: number;
  readonly residualPaths: readonly string[];

  constructor(
    readonly code: FlaFrameSequenceCommitErrorCode,
    readonly projectRoot: string,
    message: string,
    details: CommitErrorDetails = {},
  ) {
    super(message, { cause: details.cause });
    this.name = 'FlaFrameSequenceCommitServiceError';
    this.currentProject = details.currentProject;
    this.currentRevision = details.currentRevision;
    this.residualPaths = details.residualPaths ?? [];
  }
}

export class FlaFrameSequenceCommitService {
  private readonly projectService: ProjectService;
  private readonly getCurrentProjectSnapshot: (projectRoot: string) => FlaFrameSequenceProjectSnapshot | null;
  private readonly sequenceStore: FlaFrameSequenceStore;
  private readonly fileSystem: AssetImportFileSystemService;
  private readonly hashService: HashService;
  private readonly faults: FlaFrameSequenceCommitFaultInjector;
  private readonly createId: () => string;
  private readonly now: () => Date;
  private readonly activeSessions = new Set<string>();

  constructor(options: FlaFrameSequenceCommitServiceOptions) {
    this.projectService = options.projectService;
    this.getCurrentProjectSnapshot = options.getCurrentProjectSnapshot;
    this.sequenceStore = options.sequenceStore;
    this.fileSystem = options.fileSystem ?? new AssetImportFileSystemService();
    this.hashService = options.hashService ?? new HashService();
    this.faults = options.faults ?? {};
    this.createId = options.createId ?? randomUUID;
    this.now = options.now ?? (() => new Date());
  }

  async commit(rawRequest: unknown): Promise<FlaFrameSequenceCommitResponse> {
    let request: FlaFrameSequenceCommitRequest;
    try {
      request = FlaFrameSequenceCommitRequestSchema.parse(rawRequest);
    } catch (error) {
      return this.failure('INVALID_REQUEST', '(unknown project)', String(error));
    }
    if (this.activeSessions.has(request.sessionId)) {
      return this.failure('COMMIT_BUSY', request.projectRoot, 'This sequence import is already being committed.');
    }
    this.activeSessions.add(request.sessionId);
    try {
      return await this.projectService.transact(
        request.projectRoot,
        async (transaction) => this.commitInTransaction(transaction, request),
      );
    } catch (error) {
      if (error instanceof FlaFrameSequenceCommitServiceError) {
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
          'The Project changed before the sequence could be saved. Refresh and retry.',
          { cause: error, currentProject: stale?.project, currentRevision: stale?.revision },
        );
      }
      return this.failure('ASSET_COMMIT_FAILED', request.projectRoot, 'The sequence could not be committed.', { cause: error });
    } finally {
      this.activeSessions.delete(request.sessionId);
    }
  }

  private async commitInTransaction(
    transaction: ProjectTransaction,
    request: FlaFrameSequenceCommitRequest,
  ): Promise<FlaFrameSequenceCommitResponse> {
    // R2-D STALE_SEQUENCE guard: the pinned requestId must be the
    // latest accepted sequence for the session, and the per-frame
    // echoes in the request must match the bytes held in the
    // acceptance store. Both checks reject before any file write so
    // a stale UI result can never become a half-created Project.
    if (!this.sequenceStore.isLatestAcceptedSequence(request.sessionId, request.confirmedSequenceRequestId)) {
      return this.failure('STALE_SEQUENCE', transaction.projectRoot, 'The confirmed sequence is no longer the latest; re-render before importing.');
    }
    const confirmed = this.sequenceStore.getConfirmedSequence(request.confirmedSequenceRequestId);
    if (!confirmed) {
      return this.failure('STALE_SEQUENCE', transaction.projectRoot, 'The confirmed sequence has expired; re-render before importing.');
    }
    if (confirmed.length !== request.sequence.sha256EachFrame.length) {
      return this.failure('STALE_SEQUENCE', transaction.projectRoot, 'The confirmed sequence frame count does not match the commit request.');
    }
    for (let i = 0; i < confirmed.length; i++) {
      const frame = confirmed[i];
      const reqSha = request.sequence.sha256EachFrame[i];
      const reqWidth = request.sequence.widthEachFrame[i];
      const reqHeight = request.sequence.heightEachFrame[i];
      const reqByteLength = request.sequence.byteLengthEachFrame[i];
      if (
        !frame ||
        !reqSha ||
        !reqWidth ||
        !reqHeight ||
        !reqByteLength ||
        frame.sha256 !== reqSha ||
        frame.width !== reqWidth ||
        frame.height !== reqHeight ||
        frame.byteLength !== reqByteLength
      ) {
        return this.failure('STALE_SEQUENCE', transaction.projectRoot, `Frame ${i} echoed metadata does not match the confirmed sequence.`);
      }
    }

    const current = this.assertCurrentRevision(
      transaction.projectRoot,
      request.project,
      request.baseRevision,
    );

    // Per-frame PNG validation. R1 rasterizer output is already
    // bounded, but R2-G re-validates to ensure the bytes held in
    // the acceptance store are still a valid bounded PNG owned by
    // Panda Stage (R1-E invariant carries through).
    for (let i = 0; i < confirmed.length; i++) {
      const frame = confirmed[i];
      if (!frame) continue;
      const validated = validatePngEncodedImage(Buffer.from(frame.pngBytes), {
        maxWidth: FLA_IMPORT_LIMITS.maxImageWidth,
        maxHeight: FLA_IMPORT_LIMITS.maxImageHeight,
        maxPixels: FLA_IMPORT_LIMITS.maxImagePixels,
        maxEncodedBytes: FLA_IMPORT_LIMITS.maxSingleEntryBytes,
      });
      if (
        !validated ||
        validated.width !== frame.width ||
        validated.height !== frame.height
      ) {
        return this.failure(
          'ASSET_COMMIT_FAILED',
          transaction.projectRoot,
          `Frame ${i} is not a valid bounded PNG owned by Panda Stage.`,
        );
      }
    }

    // Per-frame dedup + atomic file write. Reused assets skip the
    // file write; new assets are written via writeFlaCommitTemporary
    // + finalizeFlaCommitTemporary so a failed batch never leaves
    // a half-written asset on disk.
    const operationId = this.createId();
    const fileSystemOps: Array<{ temporaryFileName: string; targetFileName: string }> = [];
    const items: FlaFrameSequenceCommitItem[] = [];
    let nextProject: Project = current.project;
    let importedCount = 0;
    let duplicateCount = 0;
    let renamedCount = 0;
    let netNewImageAssetCount = 0;

    for (let i = 0; i < confirmed.length; i++) {
      const frame = confirmed[i];
      if (!frame) {
        return this.failure('ASSET_COMMIT_FAILED', transaction.projectRoot, `Frame ${i} is missing from the confirmed sequence.`);
      }
      const existing = current.project.assets.find(
        (asset) => asset.kind === 'image' && asset.sha256 === frame.sha256,
      ) as ImageAsset | undefined;
      const sourceStem = stripFlaExtension(request.source.basename);

      if (existing) {
        duplicateCount += 1;
        items.push({
          frameIndex: frame.frameIndex,
          sequenceOrdinal: frame.sequenceOrdinal,
          assetId: existing.id,
          sourceName: assetDisplayName(sourceStem),
          width: frame.width,
          height: frame.height,
          sha256: frame.sha256,
          status: 'duplicate',
          asset: existing,
          duplicateOfAssetId: existing.id,
          targetFileName: path.basename(existing.relativePath),
          renamed: false,
          message: `Reused existing asset ${path.basename(existing.relativePath)} for frame ${frame.frameIndex}.`,
        });
        continue;
      }

      // New frame: write a temporary file, finalize (atomic rename
      // via hard-link), and prepare the new ImageAsset record.
      const baseName = `${sourceStem}-${request.range.renderTargetId}-frame${String(frame.frameIndex).padStart(4, '0')}`.slice(0, 120);
      const preferredFileName = sanitizeAssetFileName(baseName, '.png');
      let targetFileName: string;
      try {
        const occupiedNames = new Set(
          nextProject.assets.map((asset) => path.basename(asset.relativePath).toLowerCase()),
        );
        targetFileName = await allocateAssetTargetName(
          this.fileSystem,
          transaction.projectRoot,
          preferredFileName,
          frame.sha256,
          occupiedNames,
        );
      } catch (error) {
        return this.failure('IMPORT_COLLISION', transaction.projectRoot, 'A safe target name could not be allocated for one of the sequence frames.', { cause: error });
      }
      const renamed = targetFileName !== preferredFileName;
      if (renamed) renamedCount += 1;

      const temporaryFileName = `.fla-sequence-commit.${operationId}.frame-${frame.sequenceOrdinal}.tmp`;
      try {
        await this.fileSystem.writeFlaCommitTemporary(transaction.projectRoot, frame.pngBytes, temporaryFileName);
        await this.fileSystem.finalizeFlaCommitTemporary(
          transaction.projectRoot,
          temporaryFileName,
          targetFileName,
        );
      } catch (error) {
        return this.failure('ASSET_COMMIT_FAILED', transaction.projectRoot, `Frame ${frame.frameIndex} could not be written to disk.`, { cause: error });
      }
      fileSystemOps.push({ temporaryFileName, targetFileName });

      const asset = ImageAssetSchema.parse({
        id: this.createId(),
        name: assetDisplayName(sourceStem) + ` frame${String(frame.frameIndex).padStart(4, '0')}`,
        relativePath: `assets/${targetFileName}`,
        mimeType: 'image/png',
        sha256: frame.sha256,
        kind: 'image',
        width: frame.width,
        height: frame.height,
      });
      nextProject = ProjectSchema.parse({
        ...nextProject,
        assets: [...nextProject.assets, asset],
        updatedAt: this.now().toISOString(),
      });
      importedCount += 1;
      netNewImageAssetCount += 1;
      items.push({
        frameIndex: frame.frameIndex,
        sequenceOrdinal: frame.sequenceOrdinal,
        assetId: asset.id,
        sourceName: assetDisplayName(sourceStem),
        width: frame.width,
        height: frame.height,
        sha256: frame.sha256,
        status: 'imported',
        asset,
        duplicateOfAssetId: null,
        targetFileName,
        renamed,
        message: `Imported frame ${frame.frameIndex} as ${targetFileName}.`,
      });
    }

    const projectChanged = netNewImageAssetCount > 0;
    let projectSaved = false;
    try {
      await this.faults.beforeProjectSave?.(nextProject);
      // Even when projectChanged is false (all frames were duplicates),
      // we still call save so a single revision + 1 is recorded for
      // audit. The save is a no-op on the project.json contents but
      // bumps the revision counter.
      const savedDocument = await transaction.save(nextProject, current.revision + 1, () => {
        this.assertCurrentRevision(transaction.projectRoot, current.project, current.revision);
      });
      projectSaved = true;
      // Post-save verification for every newly-imported frame: the
      // saved Project must reference the file, and the file on disk
      // must hash back to the per-frame sha256.
      for (const item of items) {
        if (item.status !== 'imported') continue;
        const savedAsset = savedDocument.project.assets.find((a) => a.id === item.assetId);
        if (
          !savedAsset ||
          savedAsset.kind !== 'image' ||
          savedAsset.relativePath !== item.asset.relativePath ||
          savedAsset.sha256 !== item.sha256 ||
          !(await this.fileSystem.fileExists(path.resolve(transaction.projectRoot, savedAsset.relativePath)))
        ) {
          throw new Error(`Saved Project does not reference frame ${item.frameIndex}.`);
        }
        const fileHash = await this.hashService.hashFile(
          path.resolve(transaction.projectRoot, savedAsset.relativePath),
        );
        if (fileHash.hex !== item.sha256) {
          throw new Error(`Finalized frame ${item.frameIndex} failed post-save hash verification.`);
        }
      }
      this.sequenceStore.releaseSequence(request.confirmedSequenceRequestId);
      const result: FlaFrameSequenceCommitResult = {
        items,
        summary: {
          requestedFrameCount: confirmed.length,
          importedCount,
          duplicateCount,
          renamedCount,
          netNewImageAssetCount,
        },
      };
      return FlaFrameSequenceCommitResponseSchema.parse({
        ok: true,
        status: 'completed',
        project: savedDocument.project,
        baseRevision: current.revision,
        savedRevision: current.revision + 1,
        projectChanged,
        result,
      } satisfies FlaFrameSequenceCommitResponse);
    } catch (error) {
      await this.rollbackAfterFailure(transaction, fileSystemOps, current.project, projectSaved, current.revision);
      return this.failure('ASSET_COMMIT_FAILED', transaction.projectRoot, 'The sequence could not be committed.', { cause: error });
    }
  }

  private assertCurrentRevision(
    projectRoot: string,
    requestProject: Project,
    baseRevision: number,
  ): FlaFrameSequenceProjectSnapshot {
    const current = this.currentSnapshot(projectRoot);
    if (
      !current ||
      current.project.id !== requestProject.id ||
      current.revision !== baseRevision ||
      JSON.stringify(current.project) !== JSON.stringify(requestProject)
    ) {
      throw new FlaFrameSequenceCommitServiceError(
        'STALE_PROJECT_REVISION',
        projectRoot,
        'The Project changed after the sequence was rendered. Refresh and retry.',
        { currentProject: current?.project, currentRevision: current?.revision },
      );
    }
    return { project: ProjectSchema.parse(current.project), revision: current.revision };
  }

  private async rollbackAfterFailure(
    transaction: ProjectTransaction,
    fileSystemOps: ReadonlyArray<{ temporaryFileName: string; targetFileName: string }>,
    originalProject: Project,
    projectSaved: boolean,
    baseRevision: number,
  ): Promise<void> {
    if (projectSaved) {
      try {
        await transaction.save(originalProject, baseRevision);
      } catch (error) {
        const residual = fileSystemOps.flatMap((op) => [
          `assets/${op.targetFileName}`,
          op.temporaryFileName,
        ]);
        throw new FlaFrameSequenceCommitServiceError(
          'ROLLBACK_FAILED',
          transaction.projectRoot,
          'The sequence commit failed and the Project could not be rolled back safely.',
          { cause: error, residualPaths: residual },
        );
      }
    }
    const cleanupTargets: Array<[string, AssetCopyCleanupKind]> = [];
    for (const op of fileSystemOps) {
      cleanupTargets.push([op.targetFileName, 'target']);
      cleanupTargets.push([op.temporaryFileName, 'temporary']);
    }
    for (const [fileName, kind] of cleanupTargets) {
      try {
        await this.fileSystem.removeFlaCommitFile(transaction.projectRoot, fileName, kind);
      } catch {
        // best-effort cleanup; residual paths are reported in the
        // outer failure response if the commit ultimately fails.
      }
    }
  }

  private currentSnapshot(projectRoot: string): FlaFrameSequenceProjectSnapshot | null {
    const snapshot = this.getCurrentProjectSnapshot(projectRoot);
    if (!snapshot) return null;
    return {
      project: ProjectSchema.parse(snapshot.project),
      revision: snapshot.revision,
    };
  }

  private failure(
    code: FlaFrameSequenceCommitErrorCode,
    projectRoot: string,
    message: string,
    details: CommitErrorDetails = {},
  ): FlaFrameSequenceCommitResponse {
    const error = new FlaFrameSequenceCommitServiceError(code, projectRoot, message, details);
    return FlaFrameSequenceCommitResponseSchema.parse({
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

// ---- helpers ----

function stripFlaExtension(basename: string): string {
  // .fla files are the only accepted source for R2; strip the
  // .fla extension so the asset name reads naturally.
  return basename.replace(/\.fla$/iu, '');
}
