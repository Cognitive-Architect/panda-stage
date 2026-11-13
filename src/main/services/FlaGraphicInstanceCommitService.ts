import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  FLA_GRAPHIC_MAX_FRAMES,
  PROJECT_HEIGHT,
  PROJECT_WIDTH,
  FlaGraphicDefinitionSchema,
  ImageAssetSchema,
  LayerService,
  ProjectSchema,
  pruneFlaGraphicInstanceTransformOverrides,
  type FlaGraphicDefinition,
  type FlaGraphicStructure,
  type FlaGraphicStructureNode,
  sameAuthoredStructure,
  type ImageAsset,
  type Project,
} from '../../domain';
import { FLA_IMPORT_LIMITS } from '../../shared/fla-import-api';
import {
  FlaGraphicInstanceCommitRequestSchema,
  FlaGraphicInstanceCommitResponseSchema,
  type FlaGraphicGroupEditPreview,
  type FlaGraphicInstanceCommitErrorCode,
  type FlaGraphicInstanceCommitRequest,
  type FlaGraphicInstanceCommitResponse,
} from '../../shared/fla-graphic-instance-api';
import {
  allocateAssetTargetName,
  assetDisplayName,
  sanitizeAssetFileName,
} from './AssetImportService';
import { isSafeGeneratedFlaSvg } from './AssetCanvasImageService';
import {
  AssetImportFileSystemService,
  AssetImportFileSystemCleanupError,
  type AssetCopyCleanupKind,
} from './AssetImportFileSystemService';
import { HashService } from './HashService';
import type { FlaGraphicDefinitionFrameBatch } from './FlaPartPreviewService';
import {
  FlaPartPreviewService,
  isGraphicPlaybackRangeRepresentable,
} from './FlaPartPreviewService';
import { ProjectService, ProjectServiceError, type ProjectTransaction } from './ProjectService';

export interface FlaGraphicInstanceProjectSnapshot {
  readonly project: Project;
  readonly revision: number;
  readonly openInstanceId?: number | null;
}

export interface FlaGraphicInstanceCommitServiceOptions {
  readonly projectService: ProjectService;
  readonly partPreviewService: FlaPartPreviewService;
  readonly getCurrentProjectSnapshot: (projectRoot: string) => FlaGraphicInstanceProjectSnapshot | null;
  readonly fileSystem?: AssetImportFileSystemService;
  readonly hashService?: HashService;
  readonly layerService?: LayerService;
  readonly createId?: () => string;
  readonly now?: () => Date;
}

interface PendingFrameFile {
  readonly temporaryFileName: string;
  readonly targetFileName: string;
  targetCreated: boolean;
}

function uniqueAnimationName(project: Project, baseName: string): string {
  const base = baseName.trim().slice(0, 92) || 'FLA Graphic';
  const existing = new Set(project.animations.map((animation) => animation.name.toLocaleLowerCase()));
  if (!existing.has(base.toLocaleLowerCase())) return base;
  for (let counter = 2; counter <= 10_000; counter += 1) {
    const suffix = ` (${counter})`;
    const candidate = `${base.slice(0, 100 - suffix.length)}${suffix}`;
    if (!existing.has(candidate.toLocaleLowerCase())) return candidate;
  }
  throw new Error('Unable to allocate a unique FLA Graphic Definition name.');
}

function bindFallbackAssetToStructure(
  structure: FlaGraphicStructure,
  frameAssetIds: readonly string[],
  isolatedAssets: ReadonlyMap<string, string> = new Map(),
): FlaGraphicStructure {
  const fallbackAssetId = frameAssetIds[0];
  if (!fallbackAssetId) return structure;
  const visitNodes = (nodes: readonly FlaGraphicStructureNode[], frameFallback: string): FlaGraphicStructureNode[] =>
    nodes.map((node) => {
      if (node.type === 'opaque') {
        // Only bind fallbackAssetId if the node has verified fallbackViewBox and fallbackScope!
        // Unsafe opaque nodes without bounds must remain without fallbackAssetId.
        const assetId = node.fallbackScope === 'subtree'
          ? isolatedAssets.get(node.sourceRef ?? '')
          : frameFallback;
        if (node.fallbackViewBox && node.fallbackScope && !node.fallbackAssetId && assetId) {
          return {
            ...node,
            fallbackAssetId: assetId,
          };
        }
        return node;
      }
      if (node.type === 'group') {
        return {
          ...node,
          children: visitNodes(node.children, frameFallback),
        };
      }
      if (node.type === 'symbol') {
        return node.children
          ? {
              ...node,
              children: visitNodes(node.children, frameFallback),
            }
          : node;
      }
      return node;
    });

  const symbolDefinitions = structure.symbolDefinitions
    ? Object.fromEntries(
        Object.entries(structure.symbolDefinitions).map(([defId, def]) => [
          defId,
          { ...def, children: visitNodes(def.children, fallbackAssetId) },
        ]),
      )
    : undefined;

  return {
    ...structure,
    ...(symbolDefinitions ? { symbolDefinitions } : {}),
    frames: structure.frames.map((frame, index) => {
      const frameFallback = frameAssetIds[index] ?? fallbackAssetId;
      return {
        ...frame,
        layers: frame.layers.map((layer) => ({
          ...layer,
          nodes: visitNodes(layer.nodes, frameFallback),
        })),
      };
    }),
  };
}

function bindBitmapAssetsToStructure(
  structure: FlaGraphicStructure,
  bitmapAssetMap: ReadonlyMap<string, string>,
  sourceBasename?: string,
): FlaGraphicStructure {
  const visitNodes = (nodes: readonly FlaGraphicStructureNode[]): FlaGraphicStructureNode[] =>
    nodes.map((node) => {
      if (node.type === 'bitmap') {
        const boundAssetId = bitmapAssetMap.get(node.bitmapRef);
        return {
          ...node,
          ...(boundAssetId ? { assetId: boundAssetId } : (node.assetId ? { assetId: node.assetId } : {})),
          ...(sourceBasename && !node.sourceBasename ? { sourceBasename } : {}),
        };
      }
      if (node.type === 'group') {
        return {
          ...node,
          children: visitNodes(node.children),
        };
      }
      if (node.type === 'symbol') {
        return node.children
          ? {
              ...node,
              children: visitNodes(node.children),
            }
          : node;
      }
      return node;
    });

  const symbolDefinitions = structure.symbolDefinitions
    ? Object.fromEntries(
        Object.entries(structure.symbolDefinitions).map(([defId, def]) => [
          defId,
          { ...def, children: visitNodes(def.children) },
        ]),
      )
    : undefined;

  return {
    ...structure,
    ...(symbolDefinitions ? { symbolDefinitions } : {}),
    frames: structure.frames.map((frame) => ({
      ...frame,
      layers: frame.layers.map((layer) => ({
        ...layer,
        nodes: visitNodes(layer.nodes),
      })),
    })),
  };
}

function buildGraphicDefinition(
  batch: FlaGraphicDefinitionFrameBatch,
  assetIds: readonly string[],
  id: string,
  name: string,
  bitmapAssetMap?: ReadonlyMap<string, string>,
  isolatedAssetMap?: ReadonlyMap<string, string>,
): FlaGraphicDefinition {
  const viewports = batch.frames.map((frame) => frame.sourceViewport);
  const anchor = {
    x: Math.min(...viewports.map((viewport) => viewport.x)),
    y: Math.min(...viewports.map((viewport) => viewport.y)),
  };
  const right = Math.max(...viewports.map((viewport) => viewport.x + viewport.width));
  const bottom = Math.max(...viewports.map((viewport) => viewport.y + viewport.height));
  const canvas = { width: right - anchor.x, height: bottom - anchor.y };
  const frameDurationMs = 1_000 / batch.target.sourceFps;
  let boundStructure = batch.structure
    ? bindFallbackAssetToStructure(batch.structure, assetIds, isolatedAssetMap)
    : undefined;
  if (boundStructure && bitmapAssetMap && bitmapAssetMap.size > 0) {
    boundStructure = bindBitmapAssetsToStructure(boundStructure, bitmapAssetMap, batch.source.basename);
  }
  return FlaGraphicDefinitionSchema.parse({
    id,
    name,
    kind: 'fla-graphic',
    source: {
      basename: path.basename(batch.source.basename),
      sha256: batch.source.rawSha256,
      renderTargetId: batch.target.renderTargetId,
      targetKind: 'graphic-symbol',
      targetName: batch.target.name,
      startFrameIndex: 0,
      endFrameIndex: batch.target.frameCount - 1,
      sourceFps: batch.target.sourceFps,
      canvas,
      anchor,
      documentCanvas: {
        width: batch.target.documentWidth,
        height: batch.target.documentHeight,
      },
    },
    durationMs: batch.target.frameCount * frameDurationMs,
    ...(boundStructure ? { structure: boundStructure } : {}),
    frames: batch.frames.map((frame, index) => ({
      ordinal: index,
      sourceFrameIndex: frame.sourceFrameIndex,
      assetId: assetIds[index]!,
      sha256: frame.sha256,
      sourceViewport: frame.sourceViewport,
      offset: {
        x: frame.sourceViewport.x - anchor.x,
        y: frame.sourceViewport.y - anchor.y,
      },
      startMs: index * frameDurationMs,
      durationMs: frameDurationMs,
      createdBySequenceImport: false,
    })),
  });
}

function instancePlayback(batch: FlaGraphicDefinitionFrameBatch): {
  firstFrameIndex: number;
  playback: { mode: 'once' | 'loop' | 'single-frame'; endBehavior: 'hold' };
} | null {
  const sourceFrame = batch.unit.sourceFrame;
  if (!isGraphicPlaybackRangeRepresentable(
    sourceFrame.lastFrame,
    batch.target.frameCount,
    sourceFrame.playbackMode,
  )) {
    return null;
  }
  const rawFirstFrame = sourceFrame.firstFrame;
  const firstFrameIndex = rawFirstFrame === null ? 0 : Number(rawFirstFrame);
  if (
    !Number.isSafeInteger(firstFrameIndex) ||
    firstFrameIndex < 0 ||
    firstFrameIndex >= batch.target.frameCount
  ) return null;
  const mode = sourceFrame.playbackMode?.trim().toLocaleLowerCase('en-US');
  if (mode === 'loop') return { firstFrameIndex, playback: { mode: 'loop', endBehavior: 'hold' } };
  if (mode === 'play once') return { firstFrameIndex, playback: { mode: 'once', endBehavior: 'hold' } };
  if (mode === 'single frame') return { firstFrameIndex, playback: { mode: 'single-frame', endBehavior: 'hold' } };
  return null;
}

function placementTransform(
  batch: FlaGraphicDefinitionFrameBatch,
  definition: FlaGraphicDefinition,
): {
  position: { x: number; y: number };
  transform: { scaleX: number; scaleY: number; rotationDeg: number; flipX: boolean };
} | null {
  const matrix = batch.unit.worldTransform;
  const scaleXSource = Math.hypot(matrix.a, matrix.b);
  const scaleYSource = Math.hypot(matrix.c, matrix.d);
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  const dot = matrix.a * matrix.c + matrix.b * matrix.d;
  const scaleProduct = scaleXSource * scaleYSource;
  if (
    ![scaleXSource, scaleYSource, determinant, dot, matrix.tx, matrix.ty].every(Number.isFinite) ||
    scaleXSource < 1e-8 ||
    scaleYSource < 1e-8 ||
    Math.abs(determinant) < 1e-12 ||
    Math.abs(dot) > Math.max(1e-8, scaleProduct * 1e-5)
  ) return null;
  const containScale = Math.min(
    PROJECT_WIDTH / batch.target.stageWidth,
    PROJECT_HEIGHT / batch.target.stageHeight,
  );
  if (!Number.isFinite(containScale) || containScale <= 0) return null;
  const localCenter = {
    x: definition.source.anchor.x + definition.source.canvas.width / 2,
    y: definition.source.anchor.y + definition.source.canvas.height / 2,
  };
  const stagePosition = {
    x: matrix.a * localCenter.x + matrix.c * localCenter.y + matrix.tx,
    y: matrix.b * localCenter.x + matrix.d * localCenter.y + matrix.ty,
  };
  const scaledStageWidth = batch.target.stageWidth * containScale;
  const scaledStageHeight = batch.target.stageHeight * containScale;
  const position = {
    x: (PROJECT_WIDTH - scaledStageWidth) / 2 + stagePosition.x * containScale,
    y: (PROJECT_HEIGHT - scaledStageHeight) / 2 + stagePosition.y * containScale,
  };
  const flipX = determinant < 0;
  const rotationDeg = Math.atan2(flipX ? -matrix.b : matrix.b, flipX ? -matrix.a : matrix.a) * 180 / Math.PI;
  const transform = {
    scaleX: scaleXSource * containScale,
    scaleY: scaleYSource * containScale,
    rotationDeg,
    flipX,
  };
  if (
    ![position.x, position.y, transform.scaleX, transform.scaleY, transform.rotationDeg].every(Number.isFinite) ||
    transform.scaleX < 0.05 || transform.scaleX > 20 ||
    transform.scaleY < 0.05 || transform.scaleY > 20
  ) return null;
  return { position, transform };
}

function sameStructure(left: unknown, right: unknown): boolean {
  return sameAuthoredStructure(
    left as FlaGraphicStructure | undefined,
    right as FlaGraphicStructure | undefined,
  );
}

/**
 * Reuse a Definition for the same source + frames. A Definition that lacks the
 * captured structure is upgraded in place; one with a different structure is
 * never merged, even when its pictures are identical.
 */
function existingDefinition(
  project: Project,
  batch: FlaGraphicDefinitionFrameBatch,
  shotId: string,
): { definition: FlaGraphicDefinition; upgrade: boolean } | null {
  const occurrence = project.shots.find((shot) => shot.id === shotId)?.layers.find((layer) =>
    layer.source.kind === 'animation' &&
    layer.source.flaOccurrence?.occurrenceId === batch.unit.occurrenceId &&
    layer.source.flaOccurrence.sourceAddress === batch.unit.sourceAddress,
  );
  const occurrenceDefinitionId = occurrence?.source.kind === 'animation' ? occurrence.source.animationId : undefined;
  const semanticCandidates = project.animations.filter((animation): animation is FlaGraphicDefinition =>
    'kind' in animation &&
    animation.kind === 'fla-graphic' &&
    animation.source.sha256 === batch.source.rawSha256 &&
    animation.source.targetKind === 'graphic-symbol' &&
    animation.source.targetName === batch.target.name &&
    animation.source.sourceFps === batch.target.sourceFps &&
    animation.frames.length === batch.frames.length &&
    animation.frames.every((frame, index) =>
      frame.sourceFrameIndex === batch.frames[index]?.sourceFrameIndex,
    ),
  );
  if (batch.structure) {
    const exactSemantic = semanticCandidates.find((match) =>
      Boolean(match.structure && sameStructure(match.structure, batch.structure)),
    );
    if (exactSemantic) return { definition: exactSemantic, upgrade: false };
    // The verified source identity/frame coordinates above own this upgrade.
    // SVG bytes are a rendering cache and can change between renderer versions.
    const upgradable = semanticCandidates.find((match) =>
      !match.structure && (!occurrenceDefinitionId || match.id === occurrenceDefinitionId),
    );
    if (upgradable) return { definition: { ...upgradable, structure: batch.structure }, upgrade: true };
    // Refresh only the selected source's verified Shape fallback metadata.
    // Preserve shared edits, timelines, node paths and every Layer override.
    if (batch.fallbacks?.length) {
      const isolated = new Map<string, Extract<FlaGraphicStructureNode, { type: 'opaque' }>>();
      const collect = (nodes: readonly FlaGraphicStructureNode[]): void => {
        for (const node of nodes) {
          if (node.type === 'opaque' && node.opaqueKind === 'shape' && node.fallbackScope === 'subtree' && node.sourceRef) {
            isolated.set(node.sourceRef, node);
          } else if (node.type === 'group' || node.type === 'symbol') {
            collect(node.children ?? []);
          }
        }
      };
      for (const frame of batch.structure.frames) for (const layer of frame.layers) collect(layer.nodes);
      for (const def of Object.values(batch.structure.symbolDefinitions ?? {})) collect(def.children);
      for (const match of semanticCandidates) {
        if (!match.structure || (occurrenceDefinitionId && match.id !== occurrenceDefinitionId)) continue;
        let changed = false;
        const refresh = (nodes: readonly FlaGraphicStructureNode[]): FlaGraphicStructureNode[] => nodes.map((node) => {
          if (node.type === 'opaque' && node.opaqueKind === 'shape' && node.fallbackScope === 'frame-crop') {
            const next = isolated.get(node.sourceRef ?? '');
            if (next && next.id === node.id && next.sourceAddress === node.sourceAddress) {
              const refreshed = { ...node, fallbackScope: next.fallbackScope, fallbackViewBox: next.fallbackViewBox };
              delete refreshed.fallbackAssetId;
              changed = true;
              return refreshed;
            }
          }
          if (node.type === 'group') return { ...node, children: refresh(node.children) };
          if (node.type === 'symbol' && node.children) return { ...node, children: refresh(node.children) };
          return node;
        });
        const structure: FlaGraphicStructure = {
          ...match.structure,
          frames: match.structure.frames.map((frame) => ({
            ...frame,
            layers: frame.layers.map((layer) => ({ ...layer, nodes: refresh(layer.nodes) })),
          })),
          ...(match.structure.symbolDefinitions ? {
            symbolDefinitions: Object.fromEntries(Object.entries(match.structure.symbolDefinitions).map(
              ([id, def]) => [id, { ...def, children: refresh(def.children) }],
            )),
          } : {}),
        };
        if (changed) return { definition: { ...match, structure }, upgrade: true };
      }
    }
    return null;
  }
  const legacyMatch = semanticCandidates.find((match) =>
    match.source.renderTargetId === batch.target.renderTargetId &&
    match.frames.every((frame, index) => frame.sha256 === batch.frames[index]?.sha256),
  );
  return legacyMatch ? { definition: legacyMatch, upgrade: false } : null;
}


export class FlaGraphicInstanceCommitService {
  private readonly projectService: ProjectService;
  private readonly partPreviewService: FlaPartPreviewService;
  private readonly getCurrentProjectSnapshot: FlaGraphicInstanceCommitServiceOptions['getCurrentProjectSnapshot'];
  private readonly fileSystem: AssetImportFileSystemService;
  private readonly hashService: HashService;
  private readonly layerService: LayerService;
  private readonly createId: () => string;
  private readonly now: () => Date;
  private readonly activeSessions = new Set<string>();

  constructor(options: FlaGraphicInstanceCommitServiceOptions) {
    this.projectService = options.projectService;
    this.partPreviewService = options.partPreviewService;
    this.getCurrentProjectSnapshot = options.getCurrentProjectSnapshot;
    this.fileSystem = options.fileSystem ?? new AssetImportFileSystemService();
    this.hashService = options.hashService ?? new HashService();
    this.layerService = options.layerService ?? new LayerService();
    this.createId = options.createId ?? randomUUID;
    this.now = options.now ?? (() => new Date());
  }

  async commit(rawRequest: unknown): Promise<FlaGraphicInstanceCommitResponse> {
    let request: FlaGraphicInstanceCommitRequest;
    try {
      request = FlaGraphicInstanceCommitRequestSchema.parse(rawRequest);
    } catch {
      return this.failure(
        'INVALID_REQUEST',
        '(unknown project)',
        'Invalid FLA Graphic instance import request.',
      );
    }
    if (this.activeSessions.has(request.plan.sessionId)) {
      return this.failure('COMMIT_BUSY', request.projectRoot, 'This FLA instance import is already being committed.', request);
    }
    this.activeSessions.add(request.plan.sessionId);
    try {
      const current = this.assertCurrentSnapshot(request);
      if (!current) {
        return this.failure(
          'PROJECT_NOT_TRACKED',
          request.projectRoot,
          'The project is no longer open in the Main Process.',
          request,
        );
      }
      const shot = current.project.shots.find((candidate) => candidate.id === request.shotId);
      if (!shot || request.startTimeMs > shot.durationMs) {
        return this.failure('SHOT_NOT_FOUND', request.projectRoot, 'The selected Shot is unavailable.', request);
      }
      const rendered = await this.partPreviewService.buildGraphicDefinitionFrameBatch({
        sessionId: request.plan.sessionId,
        planId: request.plan.planId,
        generation: request.plan.generation,
        poseIdentity: request.plan.poseIdentity,
        unitId: request.plan.unitId,
      });
      if (!rendered.ok) {
        return this.failure(
          rendered.code === 'STALE_PLAN'
            ? 'STALE_PLAN'
            : rendered.code === 'UNSUPPORTED_SOURCE'
              ? 'UNSUPPORTED_SOURCE'
              : 'FRAME_RENDER_FAILED',
          request.projectRoot,
          rendered.message,
          request,
        );
      }
      return await this.projectService.transact(
        request.projectRoot,
        async (transaction) => this.commitInTransaction(transaction, request, rendered.batch),
      );
    } catch (error) {
      if (error instanceof FlaGraphicInstanceCommitError) {
        return this.failure(error.code, request.projectRoot, error.message, request, {
          currentProject: error.currentProject,
          currentRevision: error.currentRevision,
          openInstanceId: error.openInstanceId,
        });
      }
      if (error instanceof ProjectServiceError && error.code === 'PROJECT_SAVE_STALE_REVISION') {
        const current = this.currentSnapshot(request.projectRoot);
        return this.failure('STALE_PROJECT_REVISION', request.projectRoot, 'The Project changed before the FLA instance could be saved.', request, {
          currentProject: current?.project,
          currentRevision: current?.revision,
          openInstanceId: current?.openInstanceId ?? undefined,
        });
      }
      return this.failure('ASSET_COMMIT_FAILED', request.projectRoot, 'The FLA Graphic instance could not be committed.', request);
    } finally {
      this.activeSessions.delete(request.plan.sessionId);
    }
  }

  private async commitInTransaction(
    transaction: ProjectTransaction,
    request: FlaGraphicInstanceCommitRequest,
    batch: FlaGraphicDefinitionFrameBatch,
  ): Promise<FlaGraphicInstanceCommitResponse> {
    const current = this.assertCurrentSnapshot(request);
    if (!current) {
      return this.failure('PROJECT_NOT_TRACKED', transaction.projectRoot, 'The project is no longer open in the Main Process.', request);
    }
    if (transaction.existingDocument.project.id !== current.project.id ||
        JSON.stringify(transaction.existingDocument.project) !== JSON.stringify(current.project)) {
      return this.failure('STALE_PROJECT_REVISION', transaction.projectRoot, 'The saved Project does not match the current editor snapshot. Refresh and retry.', request, {
        currentProject: current.project,
        currentRevision: current.revision,
        openInstanceId: current.openInstanceId ?? undefined,
      });
    }
    if (!batch.frames.length || batch.frames.length > FLA_GRAPHIC_MAX_FRAMES ||
        [...batch.frames, ...(batch.fallbacks ?? [])].some((frame) => {
          const bytes = Buffer.from(frame.svg, 'utf8');
          return bytes.byteLength !== frame.byteLength ||
            this.hashService.hashBytes(bytes).hex !== frame.sha256 ||
            !isSafeGeneratedFlaSvg(bytes, frame.width, frame.height) ||
            bytes.byteLength > FLA_IMPORT_LIMITS.maxSingleEntryBytes;
        })) {
      return this.failure('FRAME_RENDER_FAILED', transaction.projectRoot, 'A generated SVG frame failed content validation.', request);
    }
    const previousShot = current.project.shots.find((candidate) => candidate.id === request.shotId);
    if (!previousShot || request.startTimeMs > previousShot.durationMs) {
      return this.failure('SHOT_NOT_FOUND', transaction.projectRoot, 'The selected Shot is unavailable.', request);
    }
    const reusedMatch = existingDefinition(current.project, batch, request.shotId);
    const reused = reusedMatch?.definition ?? null;
    const upgradeStructure = reusedMatch?.upgrade ?? false;
    const pendingFiles: PendingFrameFile[] = [];
    let projectSaved = false;
    try {
      const definitionId = reused?.id ?? this.createId();
      const assets: ImageAsset[] = [];
      const bitmapAssetMap = new Map<string, string>();
      const isolatedAssetMap = new Map<string, string>();
      const newBitmapAssets: ImageAsset[] = [];
      const occupiedNames = new Set(
        current.project.assets.map((asset) => path.basename(asset.relativePath).toLowerCase()),
      );
      const sourceStem = path.basename(batch.source.basename).replace(/\.fla$/iu, '') || 'fla-graphic';

      const resources = [
        ...(batch.bitmaps ?? []).map((item) => ({
          ...item, key: item.libraryItemName, bytes: item.pngBytes,
          extension: '.png' as const, mimeType: 'image/png', map: bitmapAssetMap, label: 'bitmap',
        })),
        ...(batch.fallbacks ?? []).map((item) => ({
          ...item, key: item.sourceRef, bytes: Buffer.from(item.svg, 'utf8'),
          extension: '.svg' as const, mimeType: 'image/svg+xml', map: isolatedAssetMap, label: 'shape',
        })),
      ];
      if (resources.length > 0) {
        for (const item of resources) {
          const existingAsset = current.project.assets.find(
            (candidate) => candidate.kind === 'image' && candidate.sha256 === item.sha256,
          );
          if (existingAsset) {
            item.map.set(item.key, existingAsset.id);
            continue;
          }
          const alreadyCreated = newBitmapAssets.find((candidate) => candidate.sha256 === item.sha256);
          if (alreadyCreated) {
            item.map.set(item.key, alreadyCreated.id);
            continue;
          }

          const preferred = sanitizeAssetFileName(
            `${sourceStem}-${item.label}-${path.basename(item.key).replace(/[^a-zA-Z0-9_-]/gu, '_')}`.slice(0, 120),
            item.extension,
          );
          const targetFileName = await allocateAssetTargetName(
            this.fileSystem,
            transaction.projectRoot,
            preferred,
            item.sha256,
            occupiedNames,
          );
          occupiedNames.add(targetFileName.toLowerCase());
          const temporaryFileName = `.fla-graphic-commit-bitmap.${this.createId()}.tmp`;
          const operation: PendingFrameFile = { temporaryFileName, targetFileName, targetCreated: false };
          pendingFiles.push(operation);
          await this.fileSystem.writeFlaCommitTemporary(transaction.projectRoot, item.bytes, temporaryFileName);
          try {
            await this.fileSystem.finalizeFlaCommitTemporary(transaction.projectRoot, temporaryFileName, targetFileName);
          } catch (error) {
            const targetPath = this.fileSystem.assetPath(transaction.projectRoot, targetFileName);
            if (error instanceof AssetImportFileSystemCleanupError && error.residualPaths.includes(targetPath)) {
              operation.targetCreated = true;
            }
            throw error;
          }
          operation.targetCreated = true;
          const asset = ImageAssetSchema.parse({
            id: this.createId(),
            name: `${assetDisplayName(sourceStem)} ${path.basename(item.key)}`.slice(0, 100),
            relativePath: `assets/${targetFileName}`,
            mimeType: item.mimeType,
            sha256: item.sha256,
            kind: 'image',
            width: item.width,
            height: item.height,
            usage: 'uncategorized',
            keywords: [],
          });
          newBitmapAssets.push(asset);
          item.map.set(item.key, asset.id);
        }
      }
      assets.push(...newBitmapAssets);

      if (!reused) {
        for (const frame of batch.frames) {
          const preferred = sanitizeAssetFileName(
            `${sourceStem}-${batch.target.renderTargetId.slice(-12)}-frame${String(frame.ordinal).padStart(4, '0')}`.slice(0, 120),
            '.svg',
          );
          const targetFileName = await allocateAssetTargetName(
            this.fileSystem,
            transaction.projectRoot,
            preferred,
            frame.sha256,
            occupiedNames,
          );
          occupiedNames.add(targetFileName.toLowerCase());
          const temporaryFileName = `.fla-graphic-commit.${this.createId()}.tmp`;
          const operation: PendingFrameFile = { temporaryFileName, targetFileName, targetCreated: false };
          pendingFiles.push(operation);
          const bytes = Buffer.from(frame.svg, 'utf8');
          await this.fileSystem.writeFlaCommitTemporary(transaction.projectRoot, bytes, temporaryFileName);
          try {
            await this.fileSystem.finalizeFlaCommitTemporary(transaction.projectRoot, temporaryFileName, targetFileName);
          } catch (error) {
            const targetPath = this.fileSystem.assetPath(transaction.projectRoot, targetFileName);
            if (error instanceof AssetImportFileSystemCleanupError && error.residualPaths.includes(targetPath)) {
              operation.targetCreated = true;
            }
            throw error;
          }
          operation.targetCreated = true;
          const asset = ImageAssetSchema.parse({
            id: this.createId(),
            name: `${assetDisplayName(sourceStem)} ${batch.target.name} ${String(frame.ordinal + 1).padStart(3, '0')}`.slice(0, 100),
            relativePath: `assets/${targetFileName}`,
            mimeType: 'image/svg+xml',
            sha256: frame.sha256,
            kind: 'image',
            width: frame.width,
            height: frame.height,
            usage: 'uncategorized',
            keywords: [],
            flaGraphicFrame: { definitionId, ordinal: frame.ordinal },
          });
          assets.push(asset);
        }
      }
      let definition = reused ?? buildGraphicDefinition(
        batch,
        assets.filter((asset) => asset.flaGraphicFrame?.definitionId === definitionId).map((asset) => asset.id),
        definitionId,
        uniqueAnimationName(current.project, `${path.basename(batch.source.basename).replace(/\.fla$/iu, '')} ${batch.target.name}`),
        bitmapAssetMap,
        isolatedAssetMap,
      );
      if (reused && upgradeStructure && batch.structure) {
        const frameAssetIds = reused.frames.map((frame) => frame.assetId);
        let boundStructure = bindFallbackAssetToStructure(reused.structure ?? batch.structure, frameAssetIds, isolatedAssetMap);
        if (bitmapAssetMap.size > 0) {
          boundStructure = bindBitmapAssetsToStructure(boundStructure, bitmapAssetMap, batch.source.basename);
        }
        definition = { ...reused, structure: boundStructure };
      }
      const upgradedStructure =
        upgradeStructure &&
        'kind' in definition &&
        definition.kind === 'fla-graphic'
          ? definition.structure
          : undefined;
      const shots = upgradedStructure
        ? current.project.shots.map((shot) => {
              let changed = false;
              const layers = shot.layers.map((layer) => {
                if (
                  layer.source.kind !== 'animation' ||
                  layer.source.animationId !== definition.id ||
                  !layer.flaGraphicInstanceTransformOverrides
                ) {
                  return layer;
                }
                const overrides = pruneFlaGraphicInstanceTransformOverrides(
                  layer.flaGraphicInstanceTransformOverrides,
                  upgradedStructure,
                );
                if (overrides === layer.flaGraphicInstanceTransformOverrides) {
                  return layer;
                }
                changed = true;
                const layerWithoutOverrides = { ...layer };
                delete layerWithoutOverrides.flaGraphicInstanceTransformOverrides;
                return overrides
                  ? { ...layerWithoutOverrides, flaGraphicInstanceTransformOverrides: overrides }
                  : layerWithoutOverrides;
              });
              return changed ? { ...shot, layers } : shot;
          })
        : current.project.shots;
      const baseProject = ProjectSchema.parse({
        ...current.project,
        assets: [...current.project.assets, ...assets],
        animations: reused
          ? upgradeStructure
            ? current.project.animations.map((animation) => animation.id === definition.id ? definition : animation)
            : current.project.animations
          : [...current.project.animations, definition],
        shots,
        updatedAt: this.now().toISOString(),
      });
      const playback = instancePlayback(batch);
      const transform = placementTransform(batch, definition);
      if (!playback || !transform) {
        const residualPaths = await this.cleanupFiles(transaction.projectRoot, pendingFiles);
        return residualPaths.length
          ? this.failure('ROLLBACK_FAILED', transaction.projectRoot, 'The Graphic instance was rejected and staged files need recovery.', request)
          : this.failure('TRANSFORM_UNSUPPORTED', transaction.projectRoot, 'The Graphic instance transform or playback mode is outside the supported range.', request);
      }
      const existingLayer = previousShot.layers.find((layer) => {
        if (layer.source.kind !== 'animation') return false;
        const occurrence = layer.source.flaOccurrence;
        if (!occurrence) return false;
        const animationId = layer.source.animationId;
        const animation = current.project.animations.find((candidate) => candidate.id === animationId);
        return occurrence.occurrenceId === batch.unit.occurrenceId &&
          'kind' in (animation ?? {}) &&
          animation?.source.sha256 === batch.source.rawSha256 &&
          occurrence.sourceAddress === batch.unit.sourceAddress;
      });
      if (existingLayer && !upgradeStructure) {
        const residualPaths = await this.cleanupFiles(transaction.projectRoot, pendingFiles);
        if (residualPaths.length) {
          return this.failure('ROLLBACK_FAILED', transaction.projectRoot, 'The Graphic instance already exists, but staged files need recovery.', request);
        }
        return this.success(
          request,
          current.project,
          current.revision,
          current.revision,
          false,
          existingLayer.source.kind === 'animation' ? existingLayer.source.animationId : definition.id,
          existingLayer.id,
          batch.groupEditPreview,
        );
      }
      // An already-imported occurrence only needs a Project save when its
      // SVG-only Definition is being upgraded with the captured structure.
      const created = existingLayer
        ? { project: baseProject, layer: existingLayer }
        : this.layerService.createFromAnimation(baseProject, request.shotId, {
        animationId: definition.id,
        position: transform.position,
        startTimeMs: request.startTimeMs,
        firstFrameIndex: playback.firstFrameIndex,
        playback: playback.playback,
        transform: transform.transform,
        flaOccurrence: {
          occurrenceId: batch.unit.occurrenceId,
          sourceAddress: batch.unit.sourceAddress!,
          adapterIdentity: batch.unit.adapterIdentity!,
          drawOrder: batch.unit.drawOrder,
        },
      });
      const nextProject = ProjectSchema.parse({
        ...created.project,
        updatedAt: this.now().toISOString(),
      });
      const savedDocument = await transaction.save(nextProject, current.revision + 1, () => {
        const latest = this.assertCurrentSnapshot(request);
        if (!latest || latest.revision !== current.revision || latest.project.id !== current.project.id) {
          throw new ProjectServiceError('PROJECT_SAVE_STALE_REVISION', transaction.projectRoot, 'The Project changed while the Graphic instance was being saved.');
        }
      });
      projectSaved = true;
      for (const asset of assets) {
        const savedAsset = savedDocument.project.assets.find((candidate) => candidate.id === asset.id);
        if (!savedAsset || savedAsset.kind !== 'image' || savedAsset.sha256 !== asset.sha256 ||
            !(await this.fileSystem.fileExists(path.resolve(transaction.projectRoot, savedAsset.relativePath)))) {
          throw new Error('The saved Project does not reference every FLA Graphic frame asset.');
        }
        const hash = await this.hashService.hashFile(path.resolve(transaction.projectRoot, savedAsset.relativePath));
        if (hash.hex !== asset.sha256) throw new Error('An FLA Graphic frame failed post-save hash verification.');
      }
      return this.success(
        request,
        savedDocument.project,
        current.revision,
        current.revision + 1,
        true,
        definition.id,
        created.layer.id,
        batch.groupEditPreview,
      );
    } catch (error) {
      if (projectSaved) {
        try {
          await transaction.save(transaction.existingDocument.project, current.revision);
        } catch {
          return this.failure('ROLLBACK_FAILED', transaction.projectRoot, 'The FLA Graphic import failed and the Project could not be rolled back safely.', request, {
            currentProject: this.currentSnapshot(transaction.projectRoot)?.project,
            currentRevision: this.currentSnapshot(transaction.projectRoot)?.revision,
          });
        }
      }
      const residualPaths = await this.rollbackFiles(transaction.projectRoot, pendingFiles);
      return this.failure(
        residualPaths.length ? 'ROLLBACK_FAILED' : 'ASSET_COMMIT_FAILED',
        transaction.projectRoot,
        residualPaths.length
          ? 'The FLA Graphic import failed and left files that need recovery.'
          : error instanceof Error ? error.message.slice(0, 1_000) : 'The FLA Graphic import failed.',
        request,
      );
    }
  }

  private assertCurrentSnapshot(request: FlaGraphicInstanceCommitRequest): FlaGraphicInstanceProjectSnapshot | null {
    const current = this.currentSnapshot(request.projectRoot);
    if (!current) return null;
    if (
      current.project.id !== request.projectId ||
      current.revision !== request.baseRevision ||
      current.openInstanceId !== request.openInstanceId
    ) {
      throw new FlaGraphicInstanceCommitError(
        'STALE_PROJECT_REVISION',
        request.projectRoot,
        'The Project identity or revision changed before the FLA instance could be saved.',
        { currentProject: current.project, currentRevision: current.revision, openInstanceId: current.openInstanceId ?? undefined },
      );
    }
    return { ...current, project: ProjectSchema.parse(current.project) };
  }

  private currentSnapshot(projectRoot: string): FlaGraphicInstanceProjectSnapshot | null {
    const snapshot = this.getCurrentProjectSnapshot(projectRoot);
    return snapshot ? {
      project: ProjectSchema.parse(snapshot.project),
      revision: snapshot.revision,
      openInstanceId: snapshot.openInstanceId ?? null,
    } : null;
  }

  private success(
    request: FlaGraphicInstanceCommitRequest,
    project: Project,
    baseRevision: number,
    savedRevision: number,
    projectChanged: boolean,
    animationId: string,
    layerId: string,
    groupEditPreview?: FlaGraphicGroupEditPreview,
  ): FlaGraphicInstanceCommitResponse {
    return FlaGraphicInstanceCommitResponseSchema.parse({
      ok: true,
      status: 'completed',
      requestId: request.requestId,
      project,
      projectRoot: request.projectRoot,
      projectId: request.projectId,
      openInstanceId: request.openInstanceId,
      baseRevision,
      savedRevision,
      projectChanged,
      animationId,
      layerId,
      ...(groupEditPreview ? { groupEditPreview } : {}),
    });
  }

  private failure(
    code: FlaGraphicInstanceCommitErrorCode,
    projectRoot: string,
    message: string,
    request?: FlaGraphicInstanceCommitRequest,
    extra: {
      currentProject?: Project;
      currentRevision?: number;
      openInstanceId?: number;
    } = {},
  ): FlaGraphicInstanceCommitResponse {
    return FlaGraphicInstanceCommitResponseSchema.parse({
      ok: false,
      error: {
        code,
        message: message.trim().slice(0, 1_000) || 'The FLA Graphic instance could not be committed.',
        ...(request ? { requestId: request.requestId } : {}),
        projectRoot,
        ...(extra.currentProject ? { currentProject: extra.currentProject } : {}),
        ...(extra.currentRevision !== undefined ? { currentRevision: extra.currentRevision } : {}),
        ...(extra.openInstanceId !== undefined ? { openInstanceId: extra.openInstanceId } : {}),
      },
    });
  }

  private async cleanupFiles(projectRoot: string, files: readonly PendingFrameFile[]): Promise<string[]> {
    return this.rollbackFiles(projectRoot, files);
  }

  private async rollbackFiles(projectRoot: string, files: readonly PendingFrameFile[]): Promise<string[]> {
    const residual: string[] = [];
    for (const file of [...files].reverse()) {
      const targets: Array<[string, AssetCopyCleanupKind]> = [
        [file.temporaryFileName, 'temporary'],
        ...(file.targetCreated ? [[file.targetFileName, 'target'] as [string, AssetCopyCleanupKind]] : []),
      ];
      for (const [fileName, kind] of targets) {
        try {
          await this.fileSystem.removeFlaCommitFile(projectRoot, fileName, kind);
        } catch {
          residual.push(`assets/${fileName}`);
        }
      }
    }
    return residual;
  }
}

interface FlaGraphicInstanceCommitErrorOptions {
  readonly currentProject?: Project;
  readonly currentRevision?: number;
  readonly openInstanceId?: number;
}

class FlaGraphicInstanceCommitError extends Error {
  readonly currentProject?: Project;
  readonly currentRevision?: number;
  readonly openInstanceId?: number;

  constructor(
    readonly code: FlaGraphicInstanceCommitErrorCode,
    readonly projectRoot: string,
    message: string,
    details: FlaGraphicInstanceCommitErrorOptions = {},
  ) {
    super(message);
    this.name = 'FlaGraphicInstanceCommitError';
    this.currentProject = details.currentProject;
    this.currentRevision = details.currentRevision;
    this.openInstanceId = details.openInstanceId;
  }
}
