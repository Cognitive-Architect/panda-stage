import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  CharacterService,
  CharacterServiceError,
  DEFAULT_CHARACTER_PART_STATIC_ADJUSTMENT,
  ImageAssetSchema,
  ProjectSchema,
  type CharacterPart,
  type CharacterPartTransform,
  type ImageAsset,
  type Project,
} from '../../domain';
import {
  FLA_PART_PREVIEW_LIMITS,
} from '../../shared/fla-part-preview-api';
import {
  FLA_STATIC_SNAPSHOT_LIMITS,
} from '../../shared/fla-static-snapshot-api';
import {
  FlaCharacterCreateRequestSchema,
  FlaCharacterCreateResultIdentitySchema,
  FlaCharacterCreateResultSchema,
  type FlaCharacterCreateErrorCode,
  type FlaCharacterCreateOutcome,
  type FlaCharacterCreateRequest,
  type FlaCharacterCreateResult,
  type FlaCharacterCreateStatusResponse,
} from '../../shared/fla-character-create-api';
import {
  assetDisplayName,
  allocateAssetTargetName,
} from './AssetImportService';
import {
  AssetImportFileSystemCleanupError,
  AssetImportFileSystemService,
} from './AssetImportFileSystemService';
import {
  FlaCharacterCreateJournalService,
  type FlaCharacterCreateJournal,
} from './FlaCharacterCreateJournalService';
import {
  FlaPartPreviewService,
  type FlaPreparedPartBatch,
  flaPreparedPartBatchMetadata,
} from './FlaPartPreviewService';
import { HashService } from './HashService';
import { validatePngEncodedImage } from './PngThumbnailValidator';
import { ProjectService, ProjectServiceError, type ProjectTransaction } from './ProjectService';

export interface FlaCharacterCreateProjectSnapshot {
  projectRoot: string;
  project: Project;
  revision: number;
  openInstanceId: number | null;
}

export interface FlaCharacterCreateFaultInjector {
  beforeAssetTemporaryWrite?(index: number): void | Promise<void>;
  beforeAssetFinalize?(index: number): void | Promise<void>;
  beforeProjectSave?(project: Project): void | Promise<void>;
  afterProjectSave?(project: Project): void | Promise<void>;
}

export interface FlaCharacterCreateServiceOptions {
  projectService: ProjectService;
  partPreviewService: FlaPartPreviewService;
  getCurrentProjectSnapshot: (projectRoot: string) => FlaCharacterCreateProjectSnapshot | null;
  fileSystem?: AssetImportFileSystemService;
  journal?: FlaCharacterCreateJournalService;
  hashService?: HashService;
  faults?: FlaCharacterCreateFaultInjector;
  createId?: () => string;
  now?: () => Date;
}

interface PlannedAsset {
  asset: ImageAsset;
  created: boolean;
  bytes: Buffer | null;
  targetFileName: string | null;
}

interface PlannedPart {
  occurrenceId: string;
  unitId: string;
  drawOrder: number;
  partId: string;
  asset: PlannedAsset;
  sourcePoseFrame: number;
  effectiveFrame: number;
}

interface ActiveOperation {
  fingerprint: string;
}

const IDENTITY: CharacterPartTransform = Object.freeze({
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  tx: 0,
  ty: 0,
});

export class FlaCharacterCreateService {
  private readonly projectService: ProjectService;
  private readonly partPreviewService: FlaPartPreviewService;
  private readonly getCurrentProjectSnapshot: FlaCharacterCreateServiceOptions['getCurrentProjectSnapshot'];
  private readonly fileSystem: AssetImportFileSystemService;
  private readonly journal: FlaCharacterCreateJournalService;
  private readonly hashService: HashService;
  private readonly faults: FlaCharacterCreateFaultInjector;
  private readonly createId: () => string;
  private readonly now: () => Date;
  private readonly activeOperations = new Map<string, ActiveOperation>();

  constructor(options: FlaCharacterCreateServiceOptions) {
    this.projectService = options.projectService;
    this.partPreviewService = options.partPreviewService;
    this.getCurrentProjectSnapshot = options.getCurrentProjectSnapshot;
    this.fileSystem = options.fileSystem ?? new AssetImportFileSystemService();
    this.journal = options.journal ?? new FlaCharacterCreateJournalService();
    this.hashService = options.hashService ?? new HashService();
    this.faults = options.faults ?? {};
    this.createId = options.createId ?? randomUUID;
    this.now = options.now ?? (() => new Date());
  }

  async commit(rawRequest: unknown): Promise<FlaCharacterCreateOutcome> {
    const request = FlaCharacterCreateRequestSchema.parse(rawRequest);
    const fingerprint = this.fingerprint(request);
    const known = this.activeOperations.get(request.operationId);
    if (known) {
      if (known.fingerprint !== fingerprint) {
        throw new FlaCharacterCreateServiceError('OPERATION_ID_CONFLICT', 'This operation ID was already used for a different FLA selection.');
      }
      throw new FlaCharacterCreateServiceError('OPERATION_IN_PROGRESS', 'This character creation operation is still running. Query its status before retrying.');
    }

    const persisted = await this.journal.read(request.projectRoot, request.operationId);
    if (persisted) {
      if (persisted.fingerprint !== fingerprint) {
        throw new FlaCharacterCreateServiceError('OPERATION_ID_CONFLICT', 'This operation ID was already used for a different FLA selection.');
      }
      const status = await this.getStatus({
        format: 'panda-fla-character-create-status',
        version: 1,
        operationId: request.operationId,
        projectRoot: request.projectRoot,
        projectId: request.projectId,
      });
      if (status.status === 'COMMITTED') return status.result;
      throw new FlaCharacterCreateServiceError('RECOVERY_REQUIRED', 'The saved outcome for this operation needs recovery. Query its status before retrying.');
    }
    const failed = await this.journal.readFailure(request.projectRoot, request.operationId);
    if (failed) {
      if (failed.fingerprint !== fingerprint) {
        throw new FlaCharacterCreateServiceError('OPERATION_ID_CONFLICT', 'This operation ID was already used for a different FLA selection.');
      }
      throw new FlaCharacterCreateServiceError(failed.error.code, failed.error.message);
    }

    const operation: ActiveOperation = { fingerprint };
    this.activeOperations.set(request.operationId, operation);
    try {
      return await this.projectService.transact(
        request.projectRoot,
        async (transaction) => this.commitInTransaction(transaction, request, fingerprint),
      );
    } catch (error) {
      const failure = this.normalizeFailure(error);
      if (failure.code !== 'RECOVERY_REQUIRED') {
        try {
          const existingJournal = await this.journal.read(request.projectRoot, request.operationId);
          if (!existingJournal && !(await this.journal.readFailure(request.projectRoot, request.operationId))) {
            await this.journal.writeFailure(request.projectRoot, {
              version: 1,
              operationId: request.operationId,
              fingerprint,
              projectId: request.projectId,
              baseRevision: request.baseRevision,
              openInstanceId: request.openInstanceId,
              error: { code: failure.code, message: failure.message },
            });
          }
        } catch {
          // The failed transaction has already removed its owned files; an unavailable receipt must not disguise that known outcome.
        }
      }
      throw failure;
    } finally {
      this.activeOperations.delete(request.operationId);
    }
  }

  async getStatus(rawRequest: unknown): Promise<FlaCharacterCreateStatusResponse> {
    const operationId = typeof rawRequest === 'object' && rawRequest !== null && 'operationId' in rawRequest
      ? String((rawRequest as { operationId: unknown }).operationId)
      : '';
    const active = this.activeOperations.get(operationId);
    if (active) {
      return { ok: true, status: 'IN_PROGRESS', operationId };
    }

    const parsed = rawRequest as { projectRoot?: unknown; projectId?: unknown };
    const projectRoot = typeof parsed.projectRoot === 'string' ? parsed.projectRoot : '';
    const projectId = typeof parsed.projectId === 'string' ? parsed.projectId : '';
    try {
      const status = await this.projectService.transact(projectRoot, async (transaction) => {
        const journal = await this.journal.read(transaction.projectRoot, operationId);
        if (!journal) {
          const failed = await this.journal.readFailure(transaction.projectRoot, operationId);
          if (!failed) return { ok: true as const, status: 'NOT_FOUND' as const, operationId };
          if (failed.projectId !== projectId || transaction.existingDocument.project.id !== projectId) {
            return { ok: true as const, status: 'RECOVERY_REQUIRED' as const, operationId, message: 'The failure receipt Project identity does not match the requested Project.' };
          }
          return { ok: true as const, status: 'FAILED' as const, operationId, error: failed.error };
        }
        if (journal.projectId !== projectId || transaction.existingDocument.project.id !== projectId) {
          return { ok: true as const, status: 'RECOVERY_REQUIRED' as const, operationId, message: 'The journal Project identity does not match the requested Project.' };
        }
        const exactProject = this.journal.matchesCommittedProject(journal, transaction.existingDocument.project);
        if (journal.phase !== 'committed' && !exactProject) {
          return { ok: true as const, status: 'RECOVERY_REQUIRED' as const, operationId, message: 'The persisted Project does not match the operation commit receipt.' };
        }
        if (journal.phase !== 'committed') {
          await this.journal.write(transaction.projectRoot, { ...journal, phase: 'committed' });
        }
        const result = exactProject
          ? this.journal.resultForProject(journal, transaction.existingDocument.project)
          : FlaCharacterCreateResultIdentitySchema.parse(journal.result);
        return this.statusForCommitted(result);
      });
      return status;
    } catch (error) {
      return {
        ok: false,
        status: 'ERROR',
        error: {
          code: error instanceof FlaCharacterCreateServiceError ? error.code : 'RECOVERY_REQUIRED',
          message: error instanceof Error ? error.message : 'The FLA character creation outcome could not be read.',
        },
      };
    }
  }

  async recoverProjectArtifacts(projectRoot: string, rawProject: Project): Promise<void> {
    const project = ProjectSchema.parse(rawProject);
    const journals = await this.journal.list(projectRoot);
    for (let journal of journals) {
      if (journal.projectId !== project.id) {
        throw new Error(`FLA character creation journal Project ID mismatch for ${journal.operationId}.`);
      }
      if (journal.phase === 'committed') continue;
      const exactProject = this.journal.matchesCommittedProject(journal, project);
      if (journal.phase === 'saving' && exactProject) {
        await this.journal.write(projectRoot, { ...journal, phase: 'committed' });
        continue;
      }
      const artifacts = this.projectContainsOperationArtifacts(journal, project);
      if (artifacts === 'partial' || (journal.phase === 'saving' && artifacts === 'complete')) {
        throw new Error(`FLA character creation recovery is ambiguous for ${journal.operationId}.`);
      }
      if (artifacts === 'complete') {
        throw new Error(`FLA character creation Project artifacts exist before the save phase for ${journal.operationId}.`);
      }
      await this.removeOwnedFiles(projectRoot, journal);
      await this.journal.clear(projectRoot, journal.operationId);
      journal = { ...journal, phase: 'planned' };
    }
  }

  private async commitInTransaction(
    transaction: ProjectTransaction,
    request: FlaCharacterCreateRequest,
    fingerprint: string,
  ): Promise<FlaCharacterCreateResult> {
    const base = this.assertCurrentSnapshot(request);
    if (transaction.existingDocument.project.id !== base.project.id) {
      throw new FlaCharacterCreateServiceError('STALE_PROJECT', 'The Project file and open editor no longer have the same identity.');
    }
    const batch = this.getConfirmedBatch(request);
    const confirmedBatchMetadata = flaPreparedPartBatchMetadata(batch);
    const planned = await this.prepareAssets(transaction.projectRoot, base.project, batch);
    const characterService = new CharacterService({ createId: this.createId, now: this.now });
    const withAssets = ProjectSchema.parse({
      ...base.project,
      assets: [
        ...base.project.assets,
        ...planned.createdAssets,
      ],
    });
    const parts = planned.parts.map((part) => this.toCharacterPart(part, batch));
    const nextProject = ProjectSchema.parse(characterService.createAdaptiveParts(
      withAssets,
      {
        name: request.name,
        sourceRootTransform: IDENTITY,
        defaultScale: 1,
        defaultFlipX: false,
        parts,
      },
    ));
    const character = nextProject.characters.find((item) => item.mode === 'adaptive-parts' && item.defaultVoiceProfileId === nextProject.voiceProfiles.at(-1)?.id);
    const voiceProfile = nextProject.voiceProfiles.at(-1);
    if (!character || character.mode !== 'adaptive-parts' || !voiceProfile || voiceProfile.characterId !== character.id) {
      throw new Error('CharacterService did not create one adaptive-parts Character and its default VoiceProfile.');
    }
    const assets = planned.parts.map((part) => ({
      occurrenceId: part.occurrenceId,
      partId: part.partId,
      assetId: part.asset.asset.id,
      sha256: part.asset.asset.sha256!,
      relativePath: part.asset.asset.relativePath,
      status: part.asset.created ? 'created' as const : 'reused' as const,
    }));
    const identity = {
      planId: batch.plan.planId,
      sessionId: batch.plan.sessionId,
      requestId: batch.plan.requestId,
      generation: batch.plan.generation,
      rawSourceSha256: batch.plan.source.rawSha256,
      normalizedSourceSha256: batch.plan.source.normalizedSha256,
      poseIdentity: batch.plan.poseIdentity,
      target: {
        renderTargetId: batch.plan.target.renderTargetId,
        sceneIndex: batch.plan.target.sceneIndex,
        selectedFrameIndex: batch.plan.target.selectedFrameIndex,
      },
    };
    const result = FlaCharacterCreateResultSchema.parse({
      operationId: request.operationId,
      projectRoot: transaction.projectRoot,
      projectId: base.project.id,
      openInstanceId: request.openInstanceId,
      baseRevision: base.revision,
      savedRevision: base.revision + 1,
      characterId: character.id,
      voiceProfileId: voiceProfile.id,
      project: nextProject,
      identity,
      assets,
      createdAssetCount: assets.filter((asset) => asset.status === 'created').length,
      reusedAssetCount: assets.filter((asset) => asset.status === 'reused').length,
    });
    const projectSha256 = this.journal.projectSha256(nextProject);
    const journalBase: FlaCharacterCreateJournal = {
      version: 1,
      operationId: request.operationId,
      fingerprint,
      projectId: base.project.id,
      baseRevision: base.revision,
      savedRevision: base.revision + 1,
      projectSha256,
      phase: 'planned',
      result: journalResultIdentity(result),
      files: planned.createdAssets.map((asset) => {
        const item = planned.parts.find((part) => part.asset.asset.id === asset.id);
        if (!item?.asset.targetFileName) throw new Error(`Created Part Asset ${asset.id} has no target file.`);
        return {
          assetId: asset.id,
          sha256: asset.sha256!,
          temporaryFileName: `.fla-character-create.${request.operationId}.${planned.createdAssets.indexOf(asset) + 1}.tmp`,
          targetFileName: item.asset.targetFileName,
        };
      }),
    };

    let projectSaveAttempted = false;
    await this.journal.write(transaction.projectRoot, journalBase);
    try {
      for (const [index, file] of journalBase.files.entries()) {
        await this.faults.beforeAssetTemporaryWrite?.(index);
        const part = planned.parts.find((candidate) => candidate.asset.asset.id === file.assetId);
        if (!part?.asset.bytes) throw new Error(`Created Part Asset ${file.assetId} has no held PNG bytes.`);
        await this.fileSystem.writeFlaCommitTemporary(transaction.projectRoot, part.asset.bytes, file.temporaryFileName);
      }
      await this.journal.write(transaction.projectRoot, { ...journalBase, phase: 'staged' });
      for (const [index, file] of journalBase.files.entries()) {
        await this.faults.beforeAssetFinalize?.(index);
        await this.fileSystem.finalizeFlaCommitTemporary(transaction.projectRoot, file.temporaryFileName, file.targetFileName);
      }
      await this.journal.write(transaction.projectRoot, { ...journalBase, phase: 'finalized' });
      this.assertCurrentSnapshot(request);
      await this.faults.beforeProjectSave?.(nextProject);
      await this.journal.write(transaction.projectRoot, { ...journalBase, phase: 'saving' });
      projectSaveAttempted = true;
      const saved = await transaction.save(nextProject, result.savedRevision, () => {
        this.assertCurrentSnapshot(request);
        const currentBatchMetadata = this.partPreviewService.getPreparedBatchMetadata(
          request.confirmation.planId,
          request.confirmation.sessionId,
          request.confirmation.generation,
        );
        if (!currentBatchMetadata || !isDeepStrictEqual(confirmedBatchMetadata, currentBatchMetadata)) {
          throw new FlaCharacterCreateServiceError('PLAN_EXPIRED', 'The confirmed FLA Part batch changed or expired before the Project could be saved. Preview the source again.');
        }
      });
      const savedResult = FlaCharacterCreateResultSchema.parse({ ...result, project: saved.project });
      await this.faults.afterProjectSave?.(saved.project);
      await this.journal.write(transaction.projectRoot, { ...journalBase, phase: 'committed' });
      return savedResult;
    } catch (error) {
      if (projectSaveAttempted) {
        const current = await this.readProjectDocument(transaction.projectRoot).catch(() => null);
        if (current && this.journal.projectSha256(current) === projectSha256) {
          const savedResult = FlaCharacterCreateResultSchema.parse({ ...result, project: current });
          await this.journal.write(transaction.projectRoot, { ...journalBase, phase: 'committed' }).catch(() => undefined);
          return savedResult;
        }
        if (current && this.projectContainsOperationArtifacts(journalBase, current) === 'none') {
          await this.removeOwnedFiles(transaction.projectRoot, journalBase).catch(() => undefined);
          await this.journal.clear(transaction.projectRoot, request.operationId).catch(() => undefined);
          throw this.normalizeFailure(error);
        }
        throw new FlaCharacterCreateServiceError('RECOVERY_REQUIRED', 'The Project save outcome is uncertain. Query the operation status before retrying.', { cause: error });
      }
      try {
        await this.removeOwnedFiles(transaction.projectRoot, journalBase);
        await this.journal.clear(transaction.projectRoot, request.operationId);
      } catch (cleanupError) {
        throw new FlaCharacterCreateServiceError('RECOVERY_REQUIRED', 'The failed character creation left journaled files that need recovery.', { cause: cleanupError });
      }
      throw this.normalizeFailure(error);
    }
  }

  private getConfirmedBatch(request: FlaCharacterCreateRequest): FlaPreparedPartBatch {
    const confirmation = request.confirmation;
    const plan = this.partPreviewService.getPlan(confirmation.planId, confirmation.sessionId, confirmation.generation);
    if (plan && plan.capability !== 'EDITABLE_PARTS_READY') {
      throw new FlaCharacterCreateServiceError('UNSUPPORTED_CAPABILITY', 'WHOLE_IMAGE_ONLY and unsupported FLA plans are not accepted by formal Character creation.');
    }
    const batch = this.partPreviewService.getPreparedBatch(confirmation.planId, confirmation.sessionId, confirmation.generation);
    if (!batch) throw new FlaCharacterCreateServiceError('PLAN_EXPIRED', 'The Main-held FLA Part batch expired or is no longer available. Preview the source again.');
    const { plan: heldPlan, identity } = batch;
    if (new Date(heldPlan.expiresAt).getTime() <= this.now().getTime() ||
        heldPlan.capability !== 'EDITABLE_PARTS_READY' ||
        identity.planId !== confirmation.planId ||
        identity.sessionId !== confirmation.sessionId ||
        identity.requestId !== confirmation.requestId ||
        identity.generation !== confirmation.generation ||
        identity.rawSourceSha256 !== heldPlan.source.rawSha256 ||
        identity.normalizedSourceSha256 !== heldPlan.source.normalizedSha256 ||
        identity.poseIdentity !== confirmation.poseIdentity ||
        identity.target.renderTargetId !== confirmation.target.renderTargetId ||
        identity.target.renderTargetId !== heldPlan.target.renderTargetId ||
        identity.target.sceneIndex !== heldPlan.target.sceneIndex ||
        identity.target.selectedFrameIndex !== confirmation.target.selectedFrameIndex ||
        identity.target.selectedFrameIndex !== heldPlan.target.selectedFrameIndex ||
        identity.rawSourceSha256 !== plan?.source.rawSha256 ||
        identity.normalizedSourceSha256 !== plan?.source.normalizedSha256 ||
        identity.poseIdentity !== plan?.poseIdentity ||
        identity.target.renderTargetId !== plan?.target.renderTargetId ||
        identity.target.sceneIndex !== plan?.target.sceneIndex ||
        identity.target.selectedFrameIndex !== plan?.target.selectedFrameIndex ||
        heldPlan.target.selectedFrameIndex !== confirmation.target.selectedFrameIndex) {
      throw new FlaCharacterCreateServiceError('PLAN_EXPIRED', 'The confirmed FLA Part plan identity no longer matches Main’s held batch.');
    }
    if (batch.parts.length < 2 || batch.parts.length !== heldPlan.units.length || batch.parts.length > FLA_PART_PREVIEW_LIMITS.maxParts) {
      throw new FlaCharacterCreateServiceError('COMMIT_FAILED', 'The Main-held Part batch is incomplete or outside its limit.');
    }
    let byteLength = 0;
    for (const [index, part] of batch.parts.entries()) {
      const unit = heldPlan.units[index];
      if (!unit || part.drawOrder !== index || unit.drawOrder !== index ||
          part.unitId !== unit.unitId || part.occurrenceId !== unit.occurrenceId ||
          JSON.stringify(part.stageMapping) !== JSON.stringify(unit.stageMapping) ||
          part.stageMapping.coordinateSpace !== 'root-scene-stage-pixels' ||
          part.stageMapping.crop !== null || part.stageMapping.outputScale !== 1 ||
          part.image.width !== heldPlan.stage.width || part.image.height !== heldPlan.stage.height ||
          part.image.pixelCount !== part.image.width * part.image.height ||
          part.image.byteLength !== part.image.bytes.byteLength) {
        throw new FlaCharacterCreateServiceError('COMMIT_FAILED', `Held Part ${index} does not match its plan mapping or stage dimensions.`);
      }
      byteLength += part.image.byteLength;
      const bytes = Buffer.from(part.image.bytes);
      const png = validatePngEncodedImage(bytes, {
        maxWidth: FLA_STATIC_SNAPSHOT_LIMITS.maxOutputWidth,
        maxHeight: FLA_STATIC_SNAPSHOT_LIMITS.maxOutputHeight,
        maxPixels: FLA_STATIC_SNAPSHOT_LIMITS.maxOutputPixels,
        maxEncodedBytes: FLA_STATIC_SNAPSHOT_LIMITS.maxSnapshotBytes,
      });
      if (!png || png.width !== part.image.width || png.height !== part.image.height ||
          this.hashService.hashBytes(bytes).hex !== part.image.sha256) {
        throw new FlaCharacterCreateServiceError('COMMIT_FAILED', `Held Part ${index} failed PNG or content-hash verification.`);
      }
    }
    if (byteLength !== batch.partPngBytes || byteLength > FLA_PART_PREVIEW_LIMITS.maxTotalPngBytes) {
      throw new FlaCharacterCreateServiceError('COMMIT_FAILED', 'Held Part PNG bytes exceed the recorded batch total.');
    }
    return batch;
  }

  private async prepareAssets(
    projectRoot: string,
    project: Project,
    batch: FlaPreparedPartBatch,
  ): Promise<{ parts: PlannedPart[]; createdAssets: ImageAsset[] }> {
    const hashToAsset = await this.hashExistingImageAssets(projectRoot, project.assets);
    const occupiedNames = new Set(project.assets.map((asset) => path.basename(asset.relativePath).toLowerCase()));
    const createdAssets: ImageAsset[] = [];
    const plans: PlannedPart[] = [];
    for (const part of batch.parts) {
      const unit = batch.plan.units[part.drawOrder];
      if (!unit) throw new Error(`Part plan unit ${part.drawOrder} is missing.`);
      const bytes = Buffer.from(part.image.bytes);
      const sha256 = this.hashService.hashBytes(bytes).hex;
      let asset = hashToAsset.get(sha256);
      let created = false;
      let targetFileName: string | null = null;
      let ownedBytes: Buffer | null = null;
      if (!asset) {
        const preferredFileName = `fla-part-${sha256.slice(0, 20)}.png`;
        targetFileName = await allocateAssetTargetName(
          this.fileSystem,
          projectRoot,
          preferredFileName,
          sha256,
          occupiedNames,
        );
        asset = ImageAssetSchema.parse({
          id: this.createId(),
          name: assetDisplayName(`Part ${part.drawOrder + 1}`),
          relativePath: `assets/${targetFileName}`,
          mimeType: 'image/png',
          sha256,
          kind: 'image',
          width: part.image.width,
          height: part.image.height,
          usage: 'character',
          keywords: [],
          metadata: { status: 'ready', warnings: [] },
        });
        hashToAsset.set(sha256, asset);
        createdAssets.push(asset);
        created = true;
        ownedBytes = bytes;
        occupiedNames.add(targetFileName.toLowerCase());
      }
      plans.push({
        occurrenceId: part.occurrenceId,
        unitId: part.unitId,
        drawOrder: part.drawOrder,
        partId: this.createId(),
        asset: { asset, created, bytes: ownedBytes, targetFileName },
        sourcePoseFrame: batch.plan.target.selectedFrameIndex,
        effectiveFrame: unit.sourceFrame.effectiveChildFrameIndex ?? batch.plan.target.selectedFrameIndex,
      });
    }
    return { parts: plans, createdAssets };
  }

  private toCharacterPart(part: PlannedPart, batch: FlaPreparedPartBatch): CharacterPart {
    return {
      partId: part.partId,
      assetId: part.asset.asset.id,
      source: {
        kind: 'source-instance',
        sourceId: `fla:${batch.plan.source.rawSha256}:${part.occurrenceId}`,
        sourcePoseFrame: part.sourcePoseFrame,
        effectiveFrame: part.effectiveFrame,
      },
      restTransform: { ...IDENTITY },
      sourceRestTransform: { ...IDENTITY },
      staticAdjustment: { ...DEFAULT_CHARACTER_PART_STATIC_ADJUSTMENT },
      imageMapping: {
        sourceWidth: batch.plan.stage.width,
        sourceHeight: batch.plan.stage.height,
        crop: { x: 0, y: 0, width: batch.plan.stage.width, height: batch.plan.stage.height },
        exportScale: 1,
      },
      drawOrder: part.drawOrder,
      visible: true,
      displayName: `Part ${part.drawOrder + 1}`,
    };
  }

  private assertCurrentSnapshot(request: FlaCharacterCreateRequest): { project: Project; revision: number } {
    const snapshot = this.getCurrentProjectSnapshot(request.projectRoot);
    if (!snapshot || !samePath(snapshot.projectRoot, request.projectRoot) ||
        snapshot.project.id !== request.projectId ||
        snapshot.revision !== request.baseRevision ||
        snapshot.openInstanceId !== request.openInstanceId) {
      throw new FlaCharacterCreateServiceError('STALE_PROJECT', 'The open Project identity or revision changed after confirmation.');
    }
    return { project: ProjectSchema.parse(snapshot.project), revision: snapshot.revision };
  }

  private async hashExistingImageAssets(projectRoot: string, assets: readonly Project['assets'][number][]): Promise<Map<string, ImageAsset>> {
    const hashToAsset = new Map<string, ImageAsset>();
    const assetsRoot = path.resolve(projectRoot, 'assets');
    for (const asset of assets) {
      if (asset.kind !== 'image') continue;
      const assetPath = path.resolve(projectRoot, asset.relativePath);
      const relative = path.relative(assetsRoot, assetPath);
      if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) continue;
      try {
        hashToAsset.set((await this.hashService.hashFile(assetPath)).hex, asset);
      } catch {
        // A missing or unreadable Project reference cannot prove a content duplicate.
      }
    }
    return hashToAsset;
  }

  private projectContainsOperationArtifacts(journal: FlaCharacterCreateJournal, project: Project): 'none' | 'complete' | 'partial' {
    const result = journal.result;
    const character = project.characters.find((candidate) => candidate.id === result.characterId);
    const voice = project.voiceProfiles.find((candidate) => candidate.id === result.voiceProfileId);
    const createdAssetIds = new Set(journal.files.map((file) => file.assetId));
    const hasCreatedAssets = project.assets.some((asset) => createdAssetIds.has(asset.id));
    if (!character && !voice && !hasCreatedAssets) return 'none';
    if (!character || character.mode !== 'adaptive-parts' || character.defaultVoiceProfileId !== result.voiceProfileId ||
        !voice || voice.characterId !== result.characterId ||
        result.assets.some((entry) => {
          const asset = project.assets.find((candidate) => candidate.id === entry.assetId);
          return !asset || asset.kind !== 'image' || asset.relativePath !== entry.relativePath || asset.sha256 !== entry.sha256 ||
            !character.parts.some((part) => part.partId === entry.partId && part.assetId === entry.assetId);
        })) return 'partial';
    return 'complete';
  }

  private async removeOwnedFiles(projectRoot: string, journal: FlaCharacterCreateJournal): Promise<void> {
    const failures: string[] = [];
    for (const entry of journal.files) {
      for (const [fileName, kind] of [
        [entry.targetFileName, 'target'],
        [entry.temporaryFileName, 'temporary'],
      ] as const) {
        try {
          await this.fileSystem.removeFlaCommitFile(projectRoot, fileName, kind);
        } catch {
          failures.push(`assets/${fileName}`);
        }
      }
    }
    if (failures.length) throw new AssetImportFileSystemCleanupError(failures);
  }

  private async readProjectDocument(projectRoot: string): Promise<Project> {
    return (await this.projectService.open(projectRoot)).project;
  }

  private fingerprint(request: FlaCharacterCreateRequest): string {
    const identity = {
      operationId: request.operationId,
      projectRoot: path.resolve(request.projectRoot).toLocaleLowerCase('en-US'),
      projectId: request.projectId,
      baseRevision: request.baseRevision,
      openInstanceId: request.openInstanceId,
      name: request.name,
      confirmation: request.confirmation,
    };
    return this.hashService.hashBytes(Buffer.from(JSON.stringify(identity), 'utf8')).hex;
  }

  private normalizeFailure(error: unknown): FlaCharacterCreateServiceError {
    if (error instanceof FlaCharacterCreateServiceError) return error;
    if (error instanceof Error && error.cause instanceof FlaCharacterCreateServiceError) return error.cause;
    if (error instanceof ProjectServiceError && error.code === 'PROJECT_SAVE_STALE_REVISION') {
      return new FlaCharacterCreateServiceError('STALE_PROJECT', 'The open Project changed before the character could be saved. Refresh and retry.', { cause: error });
    }
    if (error instanceof AssetImportFileSystemCleanupError) {
      return new FlaCharacterCreateServiceError('RECOVERY_REQUIRED', 'The failed character creation left files that require journal recovery.', { cause: error });
    }
    if ((error instanceof CharacterServiceError && error.code === 'DUPLICATE_CHARACTER_NAME') ||
        (error instanceof Error && /duplicate character name/iu.test(error.message))) {
      return new FlaCharacterCreateServiceError('DUPLICATE_CHARACTER_NAME', 'A Character with this name already exists.', { cause: error });
    }
    return new FlaCharacterCreateServiceError('COMMIT_FAILED', 'The held FLA Part batch could not be saved.', { cause: error });
  }

  private statusForCommitted(result: FlaCharacterCreateOutcome): FlaCharacterCreateStatusResponse {
    return { ok: true, status: 'COMMITTED', result };
  }
}

export class FlaCharacterCreateServiceError extends Error {
  constructor(
    readonly code: FlaCharacterCreateErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'FlaCharacterCreateServiceError';
  }
}

function samePath(left: string, right: string): boolean {
  return path.resolve(left).toLocaleLowerCase('en-US') === path.resolve(right).toLocaleLowerCase('en-US');
}

function journalResultIdentity(result: FlaCharacterCreateResult): FlaCharacterCreateJournal['result'] {
  return {
    operationId: result.operationId,
    projectRoot: result.projectRoot,
    projectId: result.projectId,
    openInstanceId: result.openInstanceId,
    baseRevision: result.baseRevision,
    savedRevision: result.savedRevision,
    characterId: result.characterId,
    voiceProfileId: result.voiceProfileId,
    identity: result.identity,
    assets: result.assets,
    createdAssetCount: result.createdAssetCount,
    reusedAssetCount: result.reusedAssetCount,
  };
}
