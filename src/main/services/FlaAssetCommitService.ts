import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  FlaInspectionIRSchema,
  FlaBitmapMediaIRSchema,
  type FlaInspectionIR,
  FLA_IMPORT_LIMITS,
  type AnimationImportIR,
} from '../../shared/fla-import-api';
import {
  FlaAssetCommitRequestSchema,
  type FlaAssetCommitErrorCode,
  type FlaAssetCommitRequest,
  type FlaAssetCommitResult,
} from '../../shared/fla-asset-commit-api';
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
  AssetImportFileSystemCleanupError,
  AssetImportFileSystemService,
} from './AssetImportFileSystemService';
import { FlaAssetCommitJournalService, type FlaAssetCommitJournal } from './FlaAssetCommitJournalService';
import { HashService } from './HashService';
import { validatePngEncodedImage } from './PngThumbnailValidator';
import { resolveProjectAssetPath } from './project-asset-path';
import { ProjectService, ProjectServiceError, type ProjectTransaction } from './ProjectService';

export interface FlaAssetCommitSession {
  sessionId: string;
  ir: FlaInspectionIR;
  loadMedia?: () => Promise<AnimationImportIR['media']>;
  hydrateMedia?: (mediaId: string) => Promise<AnimationImportIR['media'][number]>;
  /** SHA-256 of the exact source file before any in-memory recovery. */
  originalSourceSha256?: string;
  /**
   * Raw, process-owned FLA source bytes. Retained so V2-R1 static-snapshot
   * rendering can reuse the inspection session without re-reading the file
   * from disk (the renderer never receives these; only the Main-built SVG).
   * Optional for backward compatibility with V1/V1.5 commit callers that do
   * not need the bytes; R1's source lookup treats a missing value as "no
   * renderable source".
   */
  sourceBytes?: Uint8Array;
}

export interface FlaAssetCommitProjectSnapshot {
  project: Project;
  revision: number;
}

export interface FlaAssetCommitFaultInjector {
  beforeProjectSave?(
    project: Project,
  ): void | Promise<void>;
  afterConsistencyCheck?(
    project: Project,
  ): void | Promise<void>;
}

export interface FlaAssetCommitServiceOptions {
  projectService: ProjectService;
  getCurrentProjectSnapshot: (
    projectRoot: string,
  ) => FlaAssetCommitProjectSnapshot | null;
  getSession: (sessionId: string) => FlaAssetCommitSession | null;
  fileSystem?: AssetImportFileSystemService;
  journal?: FlaAssetCommitJournalService;
  hashService?: HashService;
  faults?: FlaAssetCommitFaultInjector;
  createId?: () => string;
  now?: () => Date;
}

export interface FlaAssetCommitOperation {
  project: Project;
  baseRevision: number;
  savedRevision: number;
  projectChanged: boolean;
  results: FlaAssetCommitResult[];
  summary: {
    selectedCount: number;
    importedCount: number;
    duplicateCount: number;
    renamedCount: number;
  };
}

interface CommitErrorDetails extends ErrorOptions {
  currentProject?: Project;
  currentRevision?: number;
  residualPaths?: readonly string[];
}

export class FlaAssetCommitServiceError extends Error {
  readonly currentProject?: Project;
  readonly currentRevision?: number;
  readonly residualPaths: readonly string[];

  constructor(
    readonly code: FlaAssetCommitErrorCode,
    readonly projectRoot: string,
    message: string,
    details: CommitErrorDetails = {},
  ) {
    super(message, { cause: details.cause });
    this.name = 'FlaAssetCommitServiceError';
    this.currentProject = details.currentProject;
    this.currentRevision = details.currentRevision;
    this.residualPaths = details.residualPaths ?? [];
  }
}

interface PlannedItem {
  media: AnimationImportIR['media'][number];
  bytes: Buffer;
  sha256: string;
  preferredFileName: string;
  targetFileName: string;
  asset: ImageAsset;
  duplicateOfAssetId: string | null;
  isNew: boolean;
  renamed: boolean;
}

interface PreparedCommit {
  operationId: string;
  baseProject: Project;
  baseRevision: number;
  items: PlannedItem[];
  newItems: PlannedItem[];
  journal: FlaAssetCommitJournal;
  nextProject: Project;
  savedRevision: number;
}

export class FlaAssetCommitService {
  private readonly projectService: ProjectService;
  private readonly getCurrentProjectSnapshot: (
    projectRoot: string,
  ) => FlaAssetCommitProjectSnapshot | null;
  private readonly getSession: (
    sessionId: string,
  ) => FlaAssetCommitSession | null;
  private readonly fileSystem: AssetImportFileSystemService;
  private readonly journal: FlaAssetCommitJournalService;
  private readonly hashService: HashService;
  private readonly faults: FlaAssetCommitFaultInjector;
  private readonly createId: () => string;
  private readonly now: () => Date;
  private readonly activeSessions = new Set<string>();

  constructor(options: FlaAssetCommitServiceOptions) {
    this.projectService = options.projectService;
    this.getCurrentProjectSnapshot = options.getCurrentProjectSnapshot;
    this.getSession = options.getSession;
    this.fileSystem =
      options.fileSystem ?? new AssetImportFileSystemService();
    this.journal = options.journal ?? new FlaAssetCommitJournalService();
    this.hashService = options.hashService ?? new HashService();
    this.faults = options.faults ?? {};
    this.createId = options.createId ?? randomUUID;
    this.now = options.now ?? (() => new Date());
  }

  async commit(rawRequest: unknown): Promise<FlaAssetCommitOperation> {
    let request: FlaAssetCommitRequest;
    try {
      request = FlaAssetCommitRequestSchema.parse(rawRequest);
    } catch (error) {
      throw new FlaAssetCommitServiceError(
        'INVALID_REQUEST',
        this.requestProjectRoot(rawRequest),
        'FLA Asset import request is invalid.',
        { cause: error },
      );
    }
    if (this.activeSessions.has(request.sessionId)) {
      throw new FlaAssetCommitServiceError(
        'COMMIT_BUSY',
        request.projectRoot,
        'This FLA import is already being committed.',
      );
    }
    this.activeSessions.add(request.sessionId);
    try {
      return await this.projectService.transact(
        request.projectRoot,
        async (transaction) => this.commitInTransaction(transaction, request),
      );
    } catch (error) {
      if (error instanceof FlaAssetCommitServiceError) throw error;
      const stale = this.currentSnapshot(request.projectRoot);
      if (
        error instanceof ProjectServiceError &&
        error.code === 'PROJECT_SAVE_STALE_REVISION'
      ) {
        throw new FlaAssetCommitServiceError(
          'STALE_PROJECT_REVISION',
          request.projectRoot,
          'The Project changed before the FLA import could be saved. Refresh and retry.',
          {
            cause: error,
            currentProject: stale?.project,
            currentRevision: stale?.revision,
          },
        );
      }
      throw new FlaAssetCommitServiceError(
        'ASSET_COMMIT_FAILED',
        request.projectRoot,
        'The selected FLA Assets could not be committed.',
        { cause: error },
      );
    } finally {
      this.activeSessions.delete(request.sessionId);
    }
  }

  async recoverProjectArtifacts(
    projectRoot: string,
    project: Project,
  ): Promise<void> {
    try {
      await this.journal.recover(projectRoot, ProjectSchema.parse(project));
    } catch (error) {
      throw new FlaAssetCommitServiceError(
        'JOURNAL_RECOVERY_FAILED',
        projectRoot,
        'An interrupted FLA Asset import could not be recovered safely.',
        { cause: error },
      );
    }
  }

  private async commitInTransaction(
    transaction: ProjectTransaction,
    request: FlaAssetCommitRequest,
  ): Promise<FlaAssetCommitOperation> {
    try {
      await this.journal.recover(
        transaction.projectRoot,
        transaction.existingDocument.project,
      );
    } catch (error) {
      throw new FlaAssetCommitServiceError(
        'JOURNAL_RECOVERY_FAILED',
        transaction.projectRoot,
        'An interrupted FLA Asset import could not be recovered safely.',
        { cause: error },
      );
    }

    const current = this.assertCurrentRevision(
      transaction.projectRoot,
      request.project,
      request.baseRevision,
    );
    if (transaction.existingDocument.project.id !== current.project.id) {
      throw new FlaAssetCommitServiceError(
        'STALE_PROJECT_REVISION',
        transaction.projectRoot,
        'The Project identity changed before the FLA import began.',
        {
          currentProject: current.project,
          currentRevision: current.revision,
        },
      );
    }

    const session = this.getSession(request.sessionId);
    if (!session) {
      throw new FlaAssetCommitServiceError(
        'SESSION_NOT_FOUND',
        transaction.projectRoot,
        'The FLA inspection session has expired. Inspect the source again.',
      );
    }
    const ir = FlaInspectionIRSchema.parse(session.ir);
    if (
      ir.source.basename !== request.source.basename ||
      ir.source.sha256 !== request.source.sha256
    ) {
      throw new FlaAssetCommitServiceError(
        'SOURCE_MISMATCH',
        transaction.projectRoot,
        'The selected FLA source no longer matches the inspection session.',
      );
    }

    const prepared = await this.prepareCommit(
      transaction.projectRoot,
      current.project,
      current.revision,
      request,
      ir,
      session.hydrateMedia,
    );
    if (prepared.newItems.length === 0) {
      return this.operation(prepared, current.project, current.revision, false);
    }

    let projectSaved = false;
    try {
      await this.journal.write(transaction.projectRoot, prepared.journal);
      for (const [index, item] of prepared.newItems.entries()) {
        const entry = prepared.journal.entries[index];
        if (!entry) throw new Error('FLA Asset journal entry is missing.');
        await this.fileSystem.writeFlaCommitTemporary(
          transaction.projectRoot,
          item.bytes,
          entry.temporaryFileName,
        );
      }
      await this.journal.write(transaction.projectRoot, {
        ...prepared.journal,
        phase: 'staged',
      });
      for (const [index] of prepared.newItems.entries()) {
        const entry = prepared.journal.entries[index];
        if (!entry) throw new Error('FLA Asset journal entry is missing.');
        await this.fileSystem.finalizeFlaCommitTemporary(
          transaction.projectRoot,
          entry.temporaryFileName,
          entry.targetFileName,
        );
      }
      await this.journal.write(transaction.projectRoot, {
        ...prepared.journal,
        phase: 'finalized',
      });
      this.assertCurrentRevision(
        transaction.projectRoot,
        prepared.baseProject,
        prepared.baseRevision,
      );
      await this.faults.beforeProjectSave?.(prepared.nextProject);
      const savedDocument = await transaction.save(
        prepared.nextProject,
        prepared.savedRevision,
        () => {
          this.assertCurrentRevision(
            transaction.projectRoot,
            prepared.baseProject,
            prepared.baseRevision,
          );
        },
      );
      projectSaved = true;
      await this.journal.write(transaction.projectRoot, {
        ...prepared.journal,
        phase: 'project-saved',
      });
      await this.verifyConsistency(
        transaction.projectRoot,
        savedDocument.project,
        prepared.newItems,
      );
      await this.faults.afterConsistencyCheck?.(savedDocument.project);
      await this.journal.clear(transaction.projectRoot);
      return this.operation(
        prepared,
        savedDocument.project,
        prepared.savedRevision,
        true,
      );
    } catch (error) {
      await this.rollbackAfterFailure(
        transaction,
        prepared,
        projectSaved,
        error,
      );
      throw this.normalizeCommitFailure(transaction.projectRoot, error);
    }
  }

  private async prepareCommit(
    projectRoot: string,
    baseProject: Project,
    baseRevision: number,
    request: FlaAssetCommitRequest,
    ir: FlaInspectionIR,
    hydrateMedia?: FlaAssetCommitSession['hydrateMedia'],
  ): Promise<PreparedCommit> {
    if (request.selectedMediaIds.length === 0) {
      throw new FlaAssetCommitServiceError(
        'NO_MEDIA_SELECTED',
        projectRoot,
        'Select at least one raster item before importing.',
      );
    }
    const mediaById = new Map(ir.media.map((media) => [media.id, media]));
    for (const mediaId of request.selectedMediaIds) {
      if (!mediaById.has(mediaId)) {
        throw new FlaAssetCommitServiceError(
          'INVALID_SELECTION',
          projectRoot,
          'The FLA selection contains an item that is not in the inspection session.',
        );
      }
    }
    const selectedMedia: AnimationImportIR['media'] = [];
    for (const mediaId of request.selectedMediaIds) {
      const media = hydrateMedia ? await hydrateMedia(mediaId) : mediaById.get(mediaId);
      const item = FlaBitmapMediaIRSchema.safeParse(media);
      if (!item.success || item.data.id !== mediaId) {
        throw new FlaAssetCommitServiceError(
          'ASSET_COMMIT_FAILED',
          projectRoot,
          'A selected FLA bitmap could not be decoded.',
        );
      }
      selectedMedia.push(item.data);
    }
    selectedMedia.sort(compareMedia);

    const candidatesByHash = indexImageAssetsByHash(baseProject.assets);
    const reusableByHash = new Map<string, ImageAsset>();
    const occupiedNames = new Set(
      baseProject.assets.map((asset) =>
        path.basename(asset.relativePath).toLowerCase(),
      ),
    );
    const items: PlannedItem[] = [];
    let selectedByteLength = 0;

    for (const media of selectedMedia) {
      const bytes = Buffer.from(media.payload.bytes);
      selectedByteLength += bytes.byteLength;
      if (
        bytes.byteLength > FLA_IMPORT_LIMITS.maxSingleEntryBytes ||
        selectedByteLength > FLA_IMPORT_LIMITS.maxTotalDecodedRgbaBytes
      ) {
        throw new FlaAssetCommitServiceError(
          'ASSET_COMMIT_FAILED',
          projectRoot,
          'The selected FLA image batch exceeds the bounded import budget.',
        );
      }
      const validatedPng = validatePngEncodedImage(bytes, {
        maxWidth: FLA_IMPORT_LIMITS.maxImageWidth,
        maxHeight: FLA_IMPORT_LIMITS.maxImageHeight,
        maxPixels: FLA_IMPORT_LIMITS.maxImagePixels,
        maxEncodedBytes: FLA_IMPORT_LIMITS.maxSingleEntryBytes,
      });
      if (
        !validatedPng ||
        validatedPng.width !== media.width ||
        validatedPng.height !== media.height ||
        validatedPng.width !== media.payload.width ||
        validatedPng.height !== media.payload.height
      ) {
        throw new FlaAssetCommitServiceError(
          'ASSET_COMMIT_FAILED',
          projectRoot,
          'One selected FLA raster payload is not a valid PNG owned by Panda Stage.',
        );
      }
      const sha256 = this.hashService.hashBytes(bytes).hex;
      const candidates = candidatesByHash.get(sha256);
      const duplicate = reusableByHash.get(sha256) ?? (candidates
        ? await this.findVerifiedDuplicate(projectRoot, sha256, candidates)
        : undefined);
      if (duplicate) {
        reusableByHash.set(sha256, duplicate);
        const targetFileName = path.basename(duplicate.relativePath);
        items.push({
          media,
          bytes,
          sha256,
          preferredFileName: targetFileName,
          targetFileName,
          asset: duplicate,
          duplicateOfAssetId: duplicate.id,
          isNew: false,
          renamed: false,
        });
        continue;
      }

      const preferredFileName = this.safePreferredFileName(media.name);
      let targetFileName: string;
      try {
        targetFileName = await allocateAssetTargetName(
          this.fileSystem,
          projectRoot,
          preferredFileName,
          sha256,
          occupiedNames,
        );
      } catch (error) {
        throw new FlaAssetCommitServiceError(
          'IMPORT_COLLISION',
          projectRoot,
          'A safe target name could not be allocated for the selected FLA Assets.',
          { cause: error },
        );
      }
      const asset = ImageAssetSchema.parse({
        id: this.createId(),
        name: assetDisplayName(media.name),
        relativePath: `assets/${targetFileName}`,
        mimeType: 'image/png',
        sha256,
        kind: 'image',
        width: validatedPng.width,
        height: validatedPng.height,
        usage: 'uncategorized',
        keywords: [],
      });
      const item: PlannedItem = {
        media,
        bytes,
        sha256,
        preferredFileName,
        targetFileName,
        asset,
        duplicateOfAssetId: null,
        isNew: true,
        renamed: targetFileName !== preferredFileName,
      };
      items.push(item);
      reusableByHash.set(sha256, asset);
      occupiedNames.add(targetFileName.toLowerCase());
    }

    const newItems = items.filter((item) => item.isNew);
    const operationId = this.createId();
    const journalEntries = newItems.map((item, index) => ({
      assetId: item.asset.id,
      sha256: item.sha256,
      temporaryFileName: `.fla-asset-commit.${operationId}-${String(index + 1).padStart(4, '0')}.tmp`,
      targetFileName: item.targetFileName,
    }));
    const journal: FlaAssetCommitJournal = {
      version: 1,
      operationId,
      projectId: baseProject.id,
      baseRevision,
      phase: 'planned',
      entries: journalEntries,
    };
    const nextProject = ProjectSchema.parse({
      ...baseProject,
      assets: [...baseProject.assets, ...newItems.map((item) => item.asset)],
      updatedAt: this.now().toISOString(),
    });
    return {
      operationId,
      baseProject,
      baseRevision,
      items,
      newItems,
      journal,
      nextProject,
      savedRevision: baseRevision + 1,
    };
  }

  private async verifyConsistency(
    projectRoot: string,
    project: Project,
    newItems: readonly PlannedItem[],
  ): Promise<void> {
    for (const item of newItems) {
      const savedAsset = project.assets.find(
        (asset) => asset.id === item.asset.id,
      );
      if (
        !savedAsset ||
        savedAsset.kind !== 'image' ||
        savedAsset.relativePath !== item.asset.relativePath ||
        savedAsset.sha256 !== item.sha256 ||
        !(await this.fileSystem.fileExists(
          path.resolve(projectRoot, savedAsset.relativePath),
        ))
      ) {
        throw new Error('Saved Project does not reference every FLA Asset file.');
      }
      const fileHash = await this.hashService.hashFile(
        path.resolve(projectRoot, savedAsset.relativePath),
      );
      if (fileHash.hex !== item.sha256) {
        throw new Error('A finalized FLA Asset file failed post-save verification.');
      }
    }
  }

  private async rollbackAfterFailure(
    transaction: ProjectTransaction,
    prepared: PreparedCommit,
    projectSaved: boolean,
    cause: unknown,
  ): Promise<void> {
    let rollbackCause = cause;
    if (projectSaved) {
      try {
        await transaction.save(prepared.baseProject, prepared.baseRevision);
      } catch (error) {
        rollbackCause = error;
        throw new FlaAssetCommitServiceError(
          'ROLLBACK_FAILED',
          transaction.projectRoot,
          'The FLA Asset commit failed and the Project could not be rolled back safely.',
          {
            cause: rollbackCause,
            residualPaths: prepared.journal.entries.map(
              (entry) => `assets/${entry.targetFileName}`,
            ),
          },
        );
      }
    }

    const residualPaths: string[] = [];
    for (const entry of prepared.journal.entries) {
      for (const [fileName, kind] of [
        [entry.targetFileName, 'target' as const],
        [entry.temporaryFileName, 'temporary' as const],
      ] as const) {
        try {
          await this.fileSystem.removeFlaCommitFile(
            transaction.projectRoot,
            fileName,
            kind,
          );
        } catch {
          residualPaths.push(`assets/${fileName}`);
        }
      }
    }
    if (residualPaths.length > 0) {
      throw new FlaAssetCommitServiceError(
        'ROLLBACK_FAILED',
        transaction.projectRoot,
        'The FLA Asset commit rolled back incompletely; recovery will retry cleanup.',
        {
          cause: rollbackCause,
          residualPaths,
        },
      );
    }
    try {
      await this.journal.clear(transaction.projectRoot);
    } catch (error) {
      throw new FlaAssetCommitServiceError(
        'ROLLBACK_FAILED',
        transaction.projectRoot,
        'The FLA Asset commit rolled back, but its recovery journal could not be cleared.',
        {
          cause: error,
          residualPaths: ['recovery/.fla-asset-commit-journal.json'],
        },
      );
    }
  }

  private normalizeCommitFailure(
    projectRoot: string,
    error: unknown,
  ): FlaAssetCommitServiceError {
    if (error instanceof FlaAssetCommitServiceError) return error;
    if (error instanceof AssetImportFileSystemCleanupError) {
      return new FlaAssetCommitServiceError(
        'ASSET_COMMIT_FAILED',
        projectRoot,
        'The FLA Asset commit could not complete safely.',
        { cause: error },
      );
    }
    const stale = this.currentSnapshot(projectRoot);
    if (error instanceof ProjectServiceError && error.code === 'PROJECT_SAVE_STALE_REVISION') {
      return new FlaAssetCommitServiceError(
        'STALE_PROJECT_REVISION',
        projectRoot,
        'The Project changed before the FLA import could be saved. Refresh and retry.',
        {
          cause: error,
          currentProject: stale?.project,
          currentRevision: stale?.revision,
        },
      );
    }
    return new FlaAssetCommitServiceError(
      'ASSET_COMMIT_FAILED',
      projectRoot,
      'The selected FLA Assets could not be committed.',
      { cause: error },
    );
  }

  private assertCurrentRevision(
    projectRoot: string,
    requestProject: Project,
    baseRevision: number,
  ): FlaAssetCommitProjectSnapshot {
    const current = this.currentSnapshot(projectRoot);
    if (
      !current ||
      current.project.id !== requestProject.id ||
      current.revision !== baseRevision ||
      JSON.stringify(current.project) !== JSON.stringify(requestProject)
    ) {
      throw new FlaAssetCommitServiceError(
        'STALE_PROJECT_REVISION',
        projectRoot,
        'The Project changed after the FLA selection was made. Refresh and retry.',
        {
          currentProject: current?.project,
          currentRevision: current?.revision,
        },
      );
    }
    return {
      project: ProjectSchema.parse(current.project),
      revision: current.revision,
    };
  }

  private currentSnapshot(
    projectRoot: string,
  ): FlaAssetCommitProjectSnapshot | null {
    const snapshot = this.getCurrentProjectSnapshot(projectRoot);
    if (!snapshot) return null;
    return {
      project: ProjectSchema.parse(snapshot.project),
      revision: snapshot.revision,
    };
  }

  private async findVerifiedDuplicate(
    projectRoot: string,
    sha256: string,
    candidates: readonly ImageAsset[],
  ): Promise<ImageAsset | undefined> {
    const checkedPaths = new Set<string>();
    for (const asset of candidates) {
      const assetPath = await resolveProjectAssetPath(projectRoot, asset.relativePath);
      if (!assetPath || checkedPaths.has(assetPath)) continue;
      checkedPaths.add(assetPath);
      try {
        if ((await this.hashService.hashFile(assetPath)).hex === sha256) return asset;
      } catch {
        // Continue to the next candidate if the file cannot be read.
      }
    }
    return undefined;
  }

  private safePreferredFileName(sourceName: string): string {
    return sanitizeAssetFileName(sourceName, '.png');
  }

  private operation(
    prepared: PreparedCommit,
    project: Project,
    savedRevision: number,
    projectChanged: boolean,
  ): FlaAssetCommitOperation {
    const results = prepared.items.map((item) => ({
      mediaId: item.media.id,
      sourceName: item.media.name,
      sourceFormat: item.media.sourceFormat,
      width: item.asset.width,
      height: item.asset.height,
      status: item.isNew ? ('imported' as const) : ('duplicate' as const),
      sha256: item.sha256,
      asset: item.asset,
      duplicateOfAssetId: item.duplicateOfAssetId,
      targetFileName: item.targetFileName,
      renamed: item.renamed,
      message: item.isNew
        ? `Imported ${item.media.name} as ${item.targetFileName}.`
        : `Reused existing Asset ${item.targetFileName}.`,
    } satisfies FlaAssetCommitResult));
    return {
      project,
      baseRevision: prepared.baseRevision,
      savedRevision,
      projectChanged,
      results,
      summary: {
        selectedCount: results.length,
        importedCount: results.filter((result) => result.status === 'imported').length,
        duplicateCount: results.filter((result) => result.status === 'duplicate').length,
        renamedCount: results.filter((result) => result.renamed).length,
      },
    };
  }

  private requestProjectRoot(rawRequest: unknown): string {
    if (
      typeof rawRequest === 'object' &&
      rawRequest !== null &&
      'projectRoot' in rawRequest &&
      typeof rawRequest.projectRoot === 'string'
    ) {
      return rawRequest.projectRoot.slice(0, 32_767);
    }
    return '(unknown project)';
  }
}

function indexImageAssetsByHash(assets: readonly Project['assets'][number][]): Map<string, ImageAsset[]> {
  const index = new Map<string, ImageAsset[]>();
  // Preserve the previous preference for the last matching asset in project order.
  for (let position = assets.length - 1; position >= 0; position -= 1) {
    const asset = assets[position];
    if (asset?.kind !== 'image' || !asset.sha256) continue;
    const candidates = index.get(asset.sha256);
    if (candidates) candidates.push(asset);
    else index.set(asset.sha256, [asset]);
  }
  return index;
}

function compareMedia(
  left: AnimationImportIR['media'][number],
  right: AnimationImportIR['media'][number],
): number {
  return `${left.name}\u001f${left.sourceReference}\u001f${left.id}`.localeCompare(
    `${right.name}\u001f${right.sourceReference}\u001f${right.id}`,
    'en-US',
  );
}
