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
 *    commit service atomically owns ImageAsset and optional animation
 *    persistence for the selected sequence.
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
  AnimationDefinitionSchema,
  ImageAssetSchema,
  ProjectSchema,
  type AnimationDefinition,
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

export interface FlaFrameSequenceAnimationContext {
  source: { basename: string; sha256: string };
  /** Raw-file identity; the request source SHA remains the recovered bytes' identity. */
  originalSourceSha256?: string;
  sourceFps: number;
  documentCanvas: { width: number; height: number };
  target: {
    renderTargetId: string;
    kind: 'scene' | 'timeline' | 'graphic-symbol' | 'unknown';
    userLabel: string;
    frameCount: number;
  };
}

export interface FlaFrameSequenceCommitServiceOptions {
  projectService: ProjectService;
  getCurrentProjectSnapshot: (projectRoot: string) => FlaFrameSequenceProjectSnapshot | null;
  getAnimationContext: (
    sessionId: string,
    renderTargetId: string,
  ) => Promise<FlaFrameSequenceAnimationContext | null>;
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
  private readonly getAnimationContext: FlaFrameSequenceCommitServiceOptions['getAnimationContext'];
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
    this.getAnimationContext = options.getAnimationContext;
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
    const expectedFrameCount =
      request.range.endFrameIndex - request.range.startFrameIndex + 1;
    if (confirmed.length !== expectedFrameCount) {
      return this.failure('STALE_SEQUENCE', transaction.projectRoot, 'The confirmed sequence frame count does not match its source range.');
    }
    let animationContext: FlaFrameSequenceAnimationContext | null;
    try {
      animationContext = await this.getAnimationContext(
        request.sessionId,
        request.range.renderTargetId,
      );
    } catch {
      animationContext = null;
    }
    if (
      !animationContext ||
      animationContext.source.basename !== request.source.basename ||
      animationContext.source.sha256 !== request.source.sha256 ||
      animationContext.target.renderTargetId !== request.range.renderTargetId ||
      !Number.isFinite(animationContext.sourceFps) ||
      animationContext.sourceFps < 0 ||
      !Number.isFinite(animationContext.documentCanvas.width) ||
      animationContext.documentCanvas.width <= 0 ||
      !Number.isFinite(animationContext.documentCanvas.height) ||
      animationContext.documentCanvas.height <= 0
    ) {
      return this.failure('SOURCE_MISMATCH', transaction.projectRoot, 'The FLA source or selected target is no longer available. Reopen the source and render the sequence again.');
    }
    if (request.range.endFrameIndex >= animationContext.target.frameCount) {
      return this.failure('RANGE_OUT_OF_BOUNDS', transaction.projectRoot, 'The selected source frame range is outside the current render target.');
    }
    if (request.importAsAnimation && animationContext.target.kind === 'unknown') {
      return this.failure('TARGET_UNSUPPORTED', transaction.projectRoot, 'The selected FLA target has no supported animation render type.');
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
        frame.byteLength !== reqByteLength ||
        frame.sequenceOrdinal !== i ||
        frame.frameIndex !== request.range.startFrameIndex + i ||
        request.sequence.targetRenderTargetIdEachFrame[i] !== request.range.renderTargetId
      ) {
        return this.failure('STALE_SEQUENCE', transaction.projectRoot, `Frame ${i} echoed metadata does not match the confirmed sequence.`);
      }
    }

    const animationGeometry = request.importAsAnimation
      ? buildAnimationGeometry(confirmed)
      : null;
    if (
      request.importAsAnimation &&
      (animationContext.sourceFps <= 0 || animationContext.sourceFps > 1_000)
    ) {
      return this.failure('SOURCE_MISMATCH', transaction.projectRoot, 'The source FLA does not provide a verified supported frame rate; import it as regular images instead.');
    }
    if (request.importAsAnimation && !animationGeometry) {
      return this.failure('TARGET_UNSUPPORTED', transaction.projectRoot, 'The renderer did not provide a trusted source viewport for every frame, so this target cannot be imported as a stable animation.');
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
    const fileSystemOps: Array<{
      temporaryFileName: string;
      targetFileName: string;
      targetCreated: boolean;
    }> = [];
    const items: FlaFrameSequenceCommitItem[] = [];
    let nextProject: Project = current.project;
    let importedCount = 0;
    let duplicateCount = 0;
    let renamedCount = 0;
    let netNewImageAssetCount = 0;

    let projectSaved = false;
    try {
    for (let i = 0; i < confirmed.length; i++) {
      const frame = confirmed[i];
      if (!frame) {
        return this.failure('ASSET_COMMIT_FAILED', transaction.projectRoot, `Frame ${i} is missing from the confirmed sequence.`);
      }
      const existing = nextProject.assets.find(
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
        throw new FlaFrameSequenceCommitServiceError(
          'IMPORT_COLLISION',
          transaction.projectRoot,
          'A safe target name could not be allocated for one of the sequence frames.',
          { cause: error },
        );
      }
      const renamed = targetFileName !== preferredFileName;
      if (renamed) renamedCount += 1;

      const temporaryFileName = `.fla-sequence-commit.${operationId}.frame-${frame.sequenceOrdinal}.tmp`;
      const fileSystemOp = {
        temporaryFileName,
        targetFileName,
        targetCreated: false,
      };
      fileSystemOps.push(fileSystemOp);
      try {
        await this.fileSystem.writeFlaCommitTemporary(transaction.projectRoot, frame.pngBytes, temporaryFileName);
        await this.fileSystem.finalizeFlaCommitTemporary(
          transaction.projectRoot,
          temporaryFileName,
          targetFileName,
        );
        fileSystemOp.targetCreated = true;
      } catch (error) {
        // If finalization linked the target and then failed while cleaning
        // its temporary file or reporting completion, only roll back the
        // target when the temporary is gone and its bytes match this frame.
        try {
          const temporaryExists = await this.fileSystem.fileExists(
            path.resolve(transaction.projectRoot, 'assets', temporaryFileName),
          );
          const targetExists = await this.fileSystem.fileExists(
            path.resolve(transaction.projectRoot, 'assets', targetFileName),
          );
          if (!temporaryExists && targetExists) {
            const targetHash = await this.hashService.hashFile(
              path.resolve(transaction.projectRoot, 'assets', targetFileName),
            );
            fileSystemOp.targetCreated = targetHash.hex === frame.sha256;
          }
        } catch {
          // The main rollback still removes the unique temporary name; an
          // unverified target is left untouched and reported for review.
        }
        throw new FlaFrameSequenceCommitServiceError(
          'ASSET_COMMIT_FAILED',
          transaction.projectRoot,
          `Frame ${frame.frameIndex} could not be written to disk.`,
          { cause: error },
        );
      }

      const asset = ImageAssetSchema.parse({
        id: this.createId(),
        name: assetDisplayName(sourceStem) + ` frame${String(frame.frameIndex).padStart(4, '0')}`,
        relativePath: `assets/${targetFileName}`,
        mimeType: 'image/png',
        sha256: frame.sha256,
        kind: 'image',
        width: frame.width,
        height: frame.height,
        usage: 'uncategorized',
        keywords: [],
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

    let animation: AnimationDefinition | null = null;
    if (request.importAsAnimation && animationGeometry) {
      const frameDurationMs = 1_000 / animationContext.sourceFps;
      animation = AnimationDefinitionSchema.parse({
        id: this.createId(),
        name: uniqueAnimationName(
          current.project,
          request.animationName ??
            assetDisplayName(stripFlaExtension(request.source.basename)),
        ),
        source: {
          basename: animationContext.source.basename,
          sha256:
            animationContext.originalSourceSha256 ??
            animationContext.source.sha256,
          renderTargetId: animationContext.target.renderTargetId,
          targetKind: animationContext.target.kind,
          targetName: animationContext.target.userLabel,
          startFrameIndex: request.range.startFrameIndex,
          endFrameIndex: request.range.endFrameIndex,
          sourceFps: animationContext.sourceFps,
          documentCanvas: animationContext.documentCanvas,
          canvas: animationGeometry.canvas,
          anchor: animationGeometry.anchor,
        },
        durationMs: confirmed.length * frameDurationMs,
        frames: items.map((item, ordinal) => ({
          ordinal,
          sourceFrameIndex: item.frameIndex,
          assetId: item.assetId,
          sha256: item.sha256,
          sourceViewport: animationGeometry.frames[ordinal]!.sourceViewport,
          offset: animationGeometry.frames[ordinal]!.offset,
          startMs: ordinal * frameDurationMs,
          durationMs: frameDurationMs,
          createdBySequenceImport: item.status === 'imported',
        })),
      });
      nextProject = ProjectSchema.parse({
        ...nextProject,
        animations: [...nextProject.animations, animation],
        updatedAt: this.now().toISOString(),
      });
    }
    // An all-duplicate PNG animation still changes the formal Project by
    // adding a definition. Regular image imports only change it for new PNGs.
    const projectChanged = request.importAsAnimation || netNewImageAssetCount > 0;
      await this.faults.beforeProjectSave?.(nextProject);
      const savedDocument = await transaction.save(nextProject, current.revision + 1, () => {
        this.assertCurrentRevision(transaction.projectRoot, current.project, current.revision);
      });
      projectSaved = true;
      // Post-save verification covers imported and reused images. A missing
      // or corrupt duplicate must not leave a valid-looking animation item.
      const checkedAssetIds = new Set<string>();
      for (const item of items) {
        if (checkedAssetIds.has(item.assetId)) continue;
        checkedAssetIds.add(item.assetId);
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
      if (animation && !savedDocument.project.animations.some((candidate) => candidate.id === animation.id)) {
        throw new Error('Saved Project does not contain the imported animation definition.');
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
      return this.failure(
        error instanceof FlaFrameSequenceCommitServiceError
          ? error.code
          : 'ASSET_COMMIT_FAILED',
        transaction.projectRoot,
        error instanceof FlaFrameSequenceCommitServiceError
          ? error.message
          : 'The sequence could not be committed.',
        { cause: error },
      );
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
    fileSystemOps: ReadonlyArray<{
      temporaryFileName: string;
      targetFileName: string;
      targetCreated: boolean;
    }>,
    originalProject: Project,
    projectSaved: boolean,
    baseRevision: number,
  ): Promise<void> {
    if (projectSaved) {
      try {
        await transaction.save(originalProject, baseRevision);
      } catch (error) {
        const residual = fileSystemOps.flatMap((op) => [
          ...(op.targetCreated ? [`assets/${op.targetFileName}`] : []),
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
      if (op.targetCreated) cleanupTargets.push([op.targetFileName, 'target']);
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

function uniqueAnimationName(project: Project, requestedName: string): string {
  const base = requestedName.trim().slice(0, 200) || 'Animation';
  const names = new Set(
    project.animations.map((animation) => animation.name.toLocaleLowerCase()),
  );
  if (!names.has(base.toLocaleLowerCase())) return base;
  for (let suffixIndex = 2; suffixIndex <= 10_000; suffixIndex += 1) {
    const suffix = ` (${suffixIndex})`;
    const candidate = `${base.slice(0, 200 - suffix.length)}${suffix}`;
    if (!names.has(candidate.toLocaleLowerCase())) return candidate;
  }
  throw new Error('Unable to allocate a unique animation name.');
}

function buildAnimationGeometry(
  confirmed: readonly ConfirmedSequenceFrame[],
): {
  canvas: { width: number; height: number };
  anchor: { x: number; y: number };
  frames: Array<{
    sourceViewport: { x: number; y: number; width: number; height: number };
    offset: { x: number; y: number };
  }>;
} | null {
  const validViewports: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
  }> = [];
  for (const frame of confirmed) {
    const viewport = frame.sourceViewport;
    if (
      !viewport ||
      !Number.isFinite(viewport.x) ||
      !Number.isFinite(viewport.y) ||
      !Number.isFinite(viewport.width) ||
      viewport.width <= 0 ||
      !Number.isFinite(viewport.height) ||
      viewport.height <= 0
    ) {
      return null;
    }
    validViewports.push(viewport);
  }
  if (validViewports.length === 0) return null;
  const anchor = {
    x: Math.min(...validViewports.map((viewport) => viewport.x)),
    y: Math.min(...validViewports.map((viewport) => viewport.y)),
  };
  const right = Math.max(
    ...validViewports.map((viewport) => viewport.x + viewport.width),
  );
  const bottom = Math.max(
    ...validViewports.map((viewport) => viewport.y + viewport.height),
  );
  const canvas = { width: right - anchor.x, height: bottom - anchor.y };
  if (
    !Number.isFinite(canvas.width) ||
    canvas.width <= 0 ||
    !Number.isFinite(canvas.height) ||
    canvas.height <= 0
  ) {
    return null;
  }
  return {
    canvas,
    anchor,
    frames: validViewports.map((sourceViewport) => ({
      sourceViewport,
      offset: {
        x: sourceViewport.x - anchor.x,
        y: sourceViewport.y - anchor.y,
      },
    })),
  };
}
