import crypto from 'node:crypto';
import {
  FlaPartPlanSchema,
  FlaPartPreviewCancelRequestSchema,
  FlaPartPreviewCancelResponseSchema,
  FlaPartPreviewRequestSchema,
  FlaPartPreviewResponseSchema,
  FlaPartPreviewUnitSchema,
  FLA_PART_PREVIEW_LIMITS,
  type FlaPartPlan,
  type FlaPartPreviewCancelRequest,
  type FlaPartPreviewCancelResponse,
  type FlaPartPreviewErrorCode,
  type FlaPartPreviewRequest,
  type FlaPartPreviewResponse,
  type FlaPartPreviewUnit,
} from '../../shared/fla-part-preview-api';
import {
  FLA_STATIC_SNAPSHOT_LIMITS,
  type FlaRenderTarget,
} from '../../shared/fla-static-snapshot-api';
import { isR05SafeGraphicSource } from '../../shared/fla-character-import-safe-graphic-targets';
import type {
  FlaDisplayListElement,
  FlaDisplayListFrameContext,
  FlaDisplayListLayer,
  FlaDisplayListMatrix,
  FlaGraphicSymbolDefinition,
} from './fla-display-list-resolver';
import { FLA_DISPLAY_LIST_IDENTITY_MATRIX, resolveFlaDisplayList } from './fla-display-list-resolver';
import type {
  FlaStaticSnapshotDisplaySource,
  FlaStaticSnapshotDisplaySourceExecution,
} from './fla-static-snapshot-display-list-adapter';
import {
  buildSvgForResolvedDisplayList,
  stableRenderTargetId,
} from './fla-static-snapshot-svg-builder';
import {
  createFlaStaticSnapshotBitmapMediaLookup,
} from './fla-static-snapshot-media-resolver';
import type {
  FlaStaticSnapshotRasterizeOutput,
  FlaStaticSnapshotRasterizer,
  FlaStaticSnapshotSource,
  FlaStaticSnapshotRenderSession,
} from './fla-static-snapshot-render-session';
import { FlaImportService } from './FlaImportService';
import { validatePngEncodedImage } from './PngThumbnailValidator';

interface FlaPartPreviewPng {
  width: number;
  height: number;
  pixelCount: number;
  sha256: string;
  byteLength: number;
  bytes: Uint8Array;
}

interface FlaPartPreviewPart {
  readonly unitId: string;
  readonly occurrenceId: string;
  readonly drawOrder: number;
  readonly image: FlaPartPreviewPng;
}

type MaskDependency = FlaPartPreviewUnit['maskDependencies'][number];

interface SourcePathEntry {
  readonly contextPath: string;
  readonly layerIndex: number;
  readonly elementIndex: number;
  readonly layer: FlaDisplayListLayer;
  readonly element: FlaDisplayListElement;
  readonly maskDependencies: readonly MaskDependency[];
}

interface PartCandidate {
  readonly unit: FlaPartPreviewUnit;
  readonly isolatePath: readonly SourcePathEntry[];
}

interface CandidateCollection {
  readonly candidates: readonly PartCandidate[];
  readonly fallbackReason: string | null;
}

interface ActivePartPreview {
  readonly request: FlaPartPreviewRequest;
  readonly startedAt: number;
  readonly sourceBytes: Uint8Array;
  readonly normalizedSha256: string;
  readonly settledPromise: Promise<FlaPartPreviewResponse>;
  readonly resolve: (response: FlaPartPreviewResponse) => void;
  wallTimer: NodeJS.Timeout;
  currentRasterRequestId: string | null;
  cancelled: boolean;
  settled: boolean;
  cancelCode: 'RENDER_CANCELLED' | 'RENDER_TIMEOUT' | null;
}

interface NativeRenderFacts {
  readonly source: FlaStaticSnapshotDisplaySource;
  readonly targetKind: 'scene' | 'graphic-symbol';
  readonly targetName: string;
  readonly sceneIndex: number | null;
  readonly sourceLibraryItemName: string | null;
  readonly targetFrameCount: number;
  readonly rootTransform: FlaDisplayListMatrix;
  readonly userLabel: string;
  readonly selectedFrameIndex: number;
  readonly frameContext: FlaDisplayListFrameContext;
  readonly resolvedNodeCount: number;
  readonly svg: string;
  readonly width: number;
  readonly height: number;
  readonly pixelCount: number;
}

function firstFrameValue(value: string | undefined): number | null {
  if (value === undefined) return 0;
  const normalized = value.trim();
  if (!/^(0|[1-9]\d*)$/u.test(normalized)) return null;
  const frameIndex = Number(normalized);
  return Number.isSafeInteger(frameIndex) ? frameIndex : null;
}

function isVisibleFrameZeroSceneGraphicReference(
  source: FlaStaticSnapshotDisplaySource,
  sourceLibraryItemName: string,
): boolean {
  const scene = source.sceneTimelines[0];
  if (!scene) return false;
  const containsReference = (elements: readonly FlaDisplayListElement[]): boolean => elements.some((element) => {
    if (element.visible === false) return false;
    if (element.kind === 'symbol') {
      return element.symbolType === 'graphic' &&
        element.libraryItemName === sourceLibraryItemName &&
        firstFrameValue(element.firstFrame) === 0;
    }
    return element.kind === 'group' && containsReference(element.elements);
  });
  return scene.frameContext.layers.some((layer) => layer.visible && containsReference(layer.elements));
}

function multiply(parent: FlaDisplayListMatrix, local: FlaDisplayListMatrix): FlaDisplayListMatrix {
  return {
    a: parent.a * local.a + parent.c * local.b,
    b: parent.b * local.a + parent.d * local.b,
    c: parent.a * local.c + parent.c * local.d,
    d: parent.b * local.c + parent.d * local.d,
    tx: parent.a * local.tx + parent.c * local.ty + parent.tx,
    ty: parent.b * local.tx + parent.d * local.ty + parent.ty,
  };
}

function applyRootTransformToFrameContext(
  frameContext: FlaDisplayListFrameContext,
  rootTransform: FlaDisplayListMatrix,
): FlaDisplayListFrameContext {
  return {
    ...frameContext,
    layers: frameContext.layers.map((layer) => ({
      ...layer,
      elements: layer.elements.map((element) => ({
        ...element,
        localTransform: multiply(rootTransform, element.localTransform ?? FLA_DISPLAY_LIST_IDENTITY_MATRIX),
      })),
    })),
  };
}

function matrixFacts(matrix: FlaDisplayListMatrix): {
  finite: boolean;
  determinant: number;
  invertible: boolean;
} {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  const finite = [matrix.a, matrix.b, matrix.c, matrix.d, matrix.tx, matrix.ty]
    .every(Number.isFinite);
  return {
    finite,
    determinant,
    invertible: finite && Number.isFinite(determinant) && Math.abs(determinant) > 1e-12,
  };
}

function contextMaskDependencies(
  frameContext: FlaDisplayListFrameContext,
  contextPath: string,
): MaskDependency[] {
  return frameContext.layers.flatMap((layer, layerIndex) => {
    if (!layer.maskLayerId && !layer.maskedBy) return [];
    return [{
      contextPath,
      layerIndex,
      layerName: layer.name,
      maskLayerId: layer.maskLayerId ?? null,
      maskedBy: layer.maskedBy ?? null,
      visible: layer.visible,
    }];
  });
}

function adapterIdentity(element: FlaDisplayListElement): string | null {
  if (element.kind === 'shape') return element.shapeId;
  if (element.kind === 'group') return element.groupId;
  if (element.kind === 'symbol' || element.kind === 'bitmap') return element.libraryItemName;
  return null;
}

function pathFingerprint(path: readonly SourcePathEntry[]): string {
  return JSON.stringify(path.map((entry) => ({
    contextPath: entry.contextPath,
    sourceAddress: entry.element.sourceAddress ?? null,
    layerIndex: entry.layerIndex,
    elementIndex: entry.elementIndex,
    kind: entry.element.kind,
    adapterIdentity: adapterIdentity(entry.element),
    frameIndex: entry.element.sourceParentFrameIndex ?? null,
    frameSpanStart: entry.element.sourceParentFrameSpanStart ?? null,
  })));
}

function makeCandidateCollection(
  source: FlaStaticSnapshotDisplaySource,
  rootFrameContext: FlaDisplayListFrameContext,
  sourceRawSha256: string,
  target: FlaRenderTarget,
  rootTransform: FlaDisplayListMatrix = FLA_DISPLAY_LIST_IDENTITY_MATRIX,
): CandidateCollection {
  const candidates: PartCandidate[] = [];
  const descriptorsByName = new Map<string, FlaStaticSnapshotDisplaySource['graphicSymbols'][number] | null>();
  for (const descriptor of source.graphicSymbols) {
    descriptorsByName.set(
      descriptor.sourceLibraryItemName,
      descriptorsByName.has(descriptor.sourceLibraryItemName) ? null : descriptor,
    );
  }
  let fallbackReason: string | null = null;
  let visited = 0;

  const append = (
    element: FlaDisplayListElement,
    path: readonly SourcePathEntry[],
    worldTransform: FlaDisplayListMatrix,
    contextPath: string,
    layer: FlaDisplayListLayer,
    layerIndex: number,
    descriptor: FlaStaticSnapshotDisplaySource['graphicSymbols'][number] | null,
    compositeReason: string | null,
  ): void => {
    if (fallbackReason) return;
    if (candidates.length >= FLA_PART_PREVIEW_LIMITS.maxParts) {
      fallbackReason = `Visible source contains more than ${FLA_PART_PREVIEW_LIMITS.maxParts} independently bounded parts.`;
      return;
    }
    const sourceAddress = element.sourceAddress ?? null;
    if (!sourceAddress || path.some((entry) => !entry.element.sourceAddress)) {
      fallbackReason = 'At least one visible part has no source-grounded XFL address.';
      return;
    }
    const facts = matrixFacts(worldTransform);
    if (!facts.finite || !facts.invertible) {
      fallbackReason = facts.finite
        ? 'At least one visible part has a non-invertible world transform.'
        : 'At least one visible part has a non-finite world transform.';
      return;
    }
    const occurrenceHash = crypto.createHash('sha256')
      .update(sourceRawSha256)
      .update('\u0000')
      .update(target.renderTargetId)
      .update('\u0000')
      .update(String(target.selectedFrameIndex ?? 0))
      .update('\u0000')
      .update(pathFingerprint(path))
      .digest('hex')
      .slice(0, 32);
    const occurrencePath = path.map((entry) => {
      const item = entry.element;
      return {
        contextPath: entry.contextPath,
        layerIndex: entry.layerIndex,
        elementIndex: entry.elementIndex,
        sourceAddress: item.sourceAddress ?? null,
        sourceSymbolId: item.kind === 'symbol' ? item.libraryItemName : null,
        parentFrameIndex: item.sourceParentFrameIndex ?? null,
        parentFrameSpanStart: item.sourceParentFrameSpanStart ?? null,
        parentSpanTweenType: item.sourceParentSpanTweenType ?? null,
        playbackMode: item.kind === 'symbol' ? item.playbackMode ?? null : null,
        firstFrame: item.kind === 'symbol' ? item.firstFrame ?? null : null,
        lastFrame: item.kind === 'symbol' ? item.lastFrame ?? null : null,
      };
    });
    const masks = path.flatMap((entry) => entry.maskDependencies);
    if (occurrencePath.length > FLA_PART_PREVIEW_LIMITS.maxOccurrenceDepth || masks.length > 64) {
      fallbackReason = 'Part source provenance exceeds its bounded path or mask dependency budget.';
      return;
    }
    const effectiveChildFrame = element.kind === 'symbol' ? 0 : null;
    let unit: FlaPartPreviewUnit;
    try {
      unit = FlaPartPreviewUnitSchema.parse({
      unitId: `part-${String(candidates.length + 1).padStart(3, '0')}-${occurrenceHash}`,
      occurrenceId: `occ-${occurrenceHash}`,
      sourceKind: element.kind === 'symbol'
        ? 'graphic-symbol-occurrence'
        : `${element.kind}-occurrence`,
      sourceSymbolId: element.kind === 'symbol' ? element.libraryItemName : null,
      sourceAddress,
      adapterIdentity: adapterIdentity(element),
      sourceContextPath: contextPath,
      occurrencePath,
      sourceDefinitionFrameCount: descriptor?.frameCount ?? null,
      selectedEffectiveChildFrameIndex: effectiveChildFrame,
      selectedEffectiveChildFrameBasis: element.kind === 'symbol'
        ? 'Main prepared Graphic definition frameContext (frame zero); nested frame selection is not applied by the static resolver'
        : null,
      localTransform: element.localTransform ?? FLA_DISPLAY_LIST_IDENTITY_MATRIX,
      worldTransform,
      determinant: facts.determinant,
      visible: true,
      layer: {
        name: layer.name,
        sourceLayerIndex: layerIndex,
        visible: true,
        maskLayerId: layer.maskLayerId ?? null,
        maskedBy: layer.maskedBy ?? null,
      },
      drawOrder: candidates.length,
      composite: Boolean(compositeReason),
      compositeReason,
      maskDependencies: masks,
      sourceFrame: {
        parentFrameIndex: element.sourceParentFrameIndex ?? null,
        parentFrameSpanStart: element.sourceParentFrameSpanStart ?? null,
        parentSpanTweenType: element.sourceParentSpanTweenType ?? null,
        playbackMode: element.kind === 'symbol' ? element.playbackMode ?? null : null,
        firstFrame: element.kind === 'symbol' ? element.firstFrame ?? null : null,
        lastFrame: element.kind === 'symbol' ? element.lastFrame ?? null : null,
        effectiveChildFrameIndex: effectiveChildFrame,
      },
      stageMapping: {
        coordinateSpace: target.kind === 'scene'
          ? 'root-scene-stage-pixels'
          : 'root-graphic-local-pixels',
        stageOrigin: { x: 0, y: 0 },
        crop: null,
        outputScale: 1,
        transformApplication: 'resolved-once-in-main; reassembly-uses-stage-identity',
      },
      traceability: 'source-address-and-parent-chain',
      untraceableReason: null,
      }) as FlaPartPreviewUnit;
    } catch {
      fallbackReason = 'Part source provenance exceeds a bounded Main plan field.';
      return;
    }
    candidates.push({ unit, isolatePath: path });
  };

  const walk = (
    frameContext: FlaDisplayListFrameContext,
    contextPath: string,
    parentWorld: FlaDisplayListMatrix,
    prefixPath: readonly SourcePathEntry[],
    symbolStack: readonly string[],
  ): void => {
    if (fallbackReason) return;
    if (prefixPath.length >= FLA_PART_PREVIEW_LIMITS.maxOccurrenceDepth) {
      fallbackReason = `Source occurrence nesting exceeds ${FLA_PART_PREVIEW_LIMITS.maxOccurrenceDepth}.`;
      return;
    }
    for (let layerIndex = 0; layerIndex < frameContext.layers.length; layerIndex += 1) {
      const layer = frameContext.layers[layerIndex];
      if (!layer || !layer.visible) continue;
      const masks = contextMaskDependencies(frameContext, contextPath);
      for (let elementIndex = 0; elementIndex < layer.elements.length; elementIndex += 1) {
        if (fallbackReason) return;
        visited += 1;
        if (visited > 100_000) {
          fallbackReason = 'Source occurrence traversal exceeded its bounded node budget.';
          return;
        }
        const element = layer.elements[elementIndex];
        if (!element || element.visible === false) continue;
        const localTransform = element.localTransform ?? FLA_DISPLAY_LIST_IDENTITY_MATRIX;
        const worldTransform = multiply(parentWorld, localTransform);
        const entry: SourcePathEntry = {
          contextPath,
          layerIndex,
          elementIndex,
          layer,
          element,
          maskDependencies: masks,
        };
        const path = [...prefixPath, entry];
        if (element.kind !== 'symbol') {
          append(
            element,
            path,
            worldTransform,
            contextPath,
            layer,
            layerIndex,
            null,
            element.kind === 'group'
              ? 'Group is retained atomically to preserve its authored membership.'
              : null,
          );
          continue;
        }
        const definitionKey = element.frameSelectionKey ?? element.libraryItemName;
        const definition = source.symbols.get(definitionKey);
        const descriptor = descriptorsByName.get(element.libraryItemName) ?? null;
        if (!definition || definition.kind !== 'graphic' || element.symbolType !== 'graphic') {
          append(
            element,
            path,
            worldTransform,
            contextPath,
            layer,
            layerIndex,
            descriptor,
            !definition ? 'Graphic definition is unavailable; retained as one closed occurrence.' :
              `Unsupported symbol type ${element.symbolType}; retained as one closed occurrence.`,
          );
          continue;
        }
        if (symbolStack.includes(element.libraryItemName)) {
          append(
            element,
            path,
            worldTransform,
            contextPath,
            layer,
            layerIndex,
            descriptor,
            'Symbol cycle is retained as one closed occurrence.',
          );
          continue;
        }
        const visibleChildren = definition.frameContext.layers.flatMap((childLayer) =>
          childLayer?.visible
            ? childLayer.elements.filter((child) => child && child.visible !== false)
            : [],
        );
        const childSymbols = visibleChildren.filter((child) => child.kind === 'symbol');
        const childOtherContent = visibleChildren.filter((child) => child.kind !== 'symbol');
        const definitionMasks = contextMaskDependencies(
          definition.frameContext,
          `graphic:${definition.libraryItemName}`,
        );
        const canDescend = childSymbols.length > 0 && childOtherContent.length === 0 &&
          definitionMasks.length === 0 && !definition.frameContext.unsupportedDisplayReason;
        if (canDescend) {
          walk(
            definition.frameContext,
            `graphic:${definition.libraryItemName}`,
            worldTransform,
            path,
            [...symbolStack, element.libraryItemName],
          );
          continue;
        }
        const reasons: string[] = [];
        if (childSymbols.length > 0 && childOtherContent.length > 0) {
          reasons.push('nested Graphic occurrences are interleaved with vector, bitmap, or group content');
        }
        if (definitionMasks.length > 0) reasons.push('symbol definition owns mask dependencies');
        if (definition.frameContext.unsupportedDisplayReason) {
          reasons.push(definition.frameContext.unsupportedDisplayReason);
        }
        if (childSymbols.length === 0 && childOtherContent.length === 0) {
          reasons.push('blank Graphic definition retained as a closed occurrence');
        }
        append(
          element,
          path,
          worldTransform,
          contextPath,
          layer,
          layerIndex,
          descriptor,
          reasons.length ? reasons.join('; ') : null,
        );
      }
    }
  };

  const rootContextPath = target.kind === 'graphic-symbol'
    ? `graphic:${target.sourceLibraryItemName ?? '(unset)'}`
    : `scene:${target.sourceTimelineIndex ?? 0}`;
  walk(rootFrameContext, rootContextPath, rootTransform, [], []);
  return { candidates, fallbackReason };
}

function pruneFrameContext(
  frameContext: FlaDisplayListFrameContext,
  selected: SourcePathEntry,
  selectedElement: FlaDisplayListElement,
): FlaDisplayListFrameContext {
  return {
    ...frameContext,
    layers: frameContext.layers.map((layer, index) => {
      if (!layer) return layer;
      if (index === selected.layerIndex) return { ...layer, elements: [selectedElement] };
      return layer.maskLayerId ? layer : { ...layer, elements: [] };
    }),
  };
}

function isolateOccurrence(
  rootFrameContext: FlaDisplayListFrameContext,
  sourceSymbols: ReadonlyMap<string, FlaGraphicSymbolDefinition>,
  path: readonly SourcePathEntry[],
  occurrenceId: string,
): { frameContext: FlaDisplayListFrameContext; symbols: ReadonlyMap<string, FlaGraphicSymbolDefinition> } {
  if (path.length === 0) throw new Error('Part occurrence path is empty');
  const symbols = new Map(sourceSymbols);
  let overlayIndex = 0;
  const isolate = (
    frameContext: FlaDisplayListFrameContext,
    pathIndex: number,
  ): FlaDisplayListFrameContext => {
    const pathItem = path[pathIndex];
    if (!pathItem) throw new Error('Part occurrence path is incomplete');
    const layer = frameContext.layers[pathItem.layerIndex];
    const element = layer?.elements[pathItem.elementIndex];
    if (!layer || !element || element.kind !== pathItem.element.kind ||
        (element.sourceAddress ?? null) !== (pathItem.element.sourceAddress ?? null) ||
        adapterIdentity(element) !== adapterIdentity(pathItem.element)) {
      throw new Error(`Part source identity changed at ${pathItem.contextPath}`);
    }
    if (pathIndex === path.length - 1) {
      return pruneFrameContext(frameContext, pathItem, element);
    }
    if (element.kind !== 'symbol' || element.symbolType !== 'graphic') {
      throw new Error('Only source-addressed Graphic ancestors may be traversed');
    }
    const sourceKey = element.frameSelectionKey ?? element.libraryItemName;
    const definition = symbols.get(sourceKey);
    if (!definition || definition.kind !== 'graphic' ||
        definition.libraryItemName !== element.libraryItemName) {
      throw new Error(`Graphic definition identity changed for ${element.libraryItemName}`);
    }
    const isolatedChild = isolate(definition.frameContext, pathIndex + 1);
    const overlayKey = `f1-02:${occurrenceId}:${overlayIndex++}`;
    symbols.set(overlayKey, { ...definition, frameContext: isolatedChild });
    return pruneFrameContext(frameContext, pathItem, { ...element, frameSelectionKey: overlayKey });
  };
  return { frameContext: isolate(rootFrameContext, 0), symbols };
}

function toSnapshotSource(
  session: ReturnType<FlaImportService['getSession']>,
): FlaStaticSnapshotSource | null {
  if (!session?.sourceBytes) return null;
  const { basename, sha256 } = session.ir.source;
  if (!basename || !sha256) return null;
  return {
    bytes: session.sourceBytes,
    basename,
    sha256: sha256.toLowerCase(),
    originalSourceSha256: session.originalSourceSha256?.toLowerCase() ?? sha256.toLowerCase(),
    media: session.ir.media,
  };
}

function digestPng(bytes: Uint8Array): string {
  return crypto.createHash('sha256').update(Buffer.from(bytes)).digest('hex');
}

export interface FlaPartPreviewServiceOptions {
  readonly flaImportService: FlaImportService;
  readonly renderSession: FlaStaticSnapshotRenderSession;
  readonly rasterizer: FlaStaticSnapshotRasterizer;
  readonly now?: () => Date;
  readonly wallTimeMs?: number;
}

export interface FlaPreparedPartBatchPart {
  readonly unitId: string;
  readonly occurrenceId: string;
  readonly drawOrder: number;
  readonly stageMapping: FlaPartPreviewUnit['stageMapping'];
  readonly image: FlaPreparedPartBatchImage;
}

export interface FlaPreparedPartBatchImage {
  readonly width: number;
  readonly height: number;
  readonly pixelCount: number;
  readonly sha256: string;
  readonly byteLength: number;
  readonly bytes: Uint8Array;
}

export interface FlaPreparedPartBatch {
  readonly plan: FlaPartPlan;
  readonly identity: {
    readonly planId: string;
    readonly sessionId: string;
    readonly requestId: string;
    readonly generation: number;
    readonly rawSourceSha256: string;
    readonly normalizedSourceSha256: string;
    readonly poseIdentity: string;
    readonly target: {
      readonly renderTargetId: string;
      readonly kind: 'scene' | 'graphic-symbol';
      readonly sceneIndex: number | null;
      readonly sourceLibraryItemName: string | null;
      readonly selectedFrameIndex: number;
    };
  };
  readonly parts: readonly FlaPreparedPartBatchPart[];
  readonly partPngBytes: number;
}

function partPlanTargetIdentity(target: FlaPartPlan['target']): FlaPreparedPartBatch['identity']['target'] {
  return {
    renderTargetId: target.renderTargetId,
    kind: target.kind,
    sceneIndex: target.sceneIndex,
    sourceLibraryItemName: target.sourceLibraryItemName,
    selectedFrameIndex: target.selectedFrameIndex,
  };
}

export interface FlaPreparedPartBatchMetadata {
  readonly plan: FlaPartPlan;
  readonly identity: FlaPreparedPartBatch['identity'];
  readonly parts: readonly (Omit<FlaPreparedPartBatchPart, 'image'> & {
    readonly image: Omit<FlaPreparedPartBatchImage, 'bytes'>;
  })[];
  readonly partPngBytes: number;
}

export function flaPreparedPartBatchMetadata(
  batch: FlaPreparedPartBatch,
): FlaPreparedPartBatchMetadata {
  return {
    plan: structuredClone(batch.plan),
    identity: structuredClone(batch.identity),
    parts: batch.parts.map((part) => ({
      unitId: part.unitId,
      occurrenceId: part.occurrenceId,
      drawOrder: part.drawOrder,
      stageMapping: structuredClone(part.stageMapping),
      image: {
        width: part.image.width,
        height: part.image.height,
        pixelCount: part.image.pixelCount,
        sha256: part.image.sha256,
        byteLength: part.image.byteLength,
      },
    })),
    partPngBytes: batch.partPngBytes,
  };
}

interface HeldPartPreviewResult {
  readonly plan: FlaPartPlan;
  readonly parts: readonly FlaPartPreviewPart[] | null;
  readonly partPngBytes: number;
}

export class FlaPartPreviewService {
  private readonly flaImportService: FlaImportService;
  private readonly renderSession: FlaStaticSnapshotRenderSession;
  private readonly rasterizer: FlaStaticSnapshotRasterizer;
  private readonly now: () => Date;
  private readonly wallTimeMs: number;
  private readonly latestGenerationBySession = new Map<string, number>();
  private active: ActivePartPreview | null = null;
  private heldResult: HeldPartPreviewResult | null = null;
  private expiryTimer: NodeJS.Timeout | null = null;
  private closed = false;

  constructor(options: FlaPartPreviewServiceOptions) {
    this.flaImportService = options.flaImportService;
    this.renderSession = options.renderSession;
    this.rasterizer = options.rasterizer;
    this.now = options.now ?? (() => new Date());
    this.wallTimeMs = options.wallTimeMs ?? FLA_PART_PREVIEW_LIMITS.maxBatchWallTimeMs;
  }

  async preview(rawRequest: unknown): Promise<FlaPartPreviewResponse> {
    let request: FlaPartPreviewRequest;
    try {
      request = FlaPartPreviewRequestSchema.parse(rawRequest);
    } catch {
      return this.failure('INVALID_REQUEST', 'Invalid F1-02 part preview request');
    }
    if (this.closed) return this.failure('RENDER_FAILED', 'Part preview service is closed', request);
    const previousGeneration = this.latestGenerationBySession.get(request.sessionId) ?? 0;
    if (request.generation <= previousGeneration) {
      return this.failure('STALE_GENERATION', 'A newer preview generation already exists for this session', request);
    }
    this.latestGenerationBySession.set(request.sessionId, request.generation);
    if (this.active) {
      this.cancelActive(this.active, 'RENDER_CANCELLED', 'Superseded by a newer Part preview request');
    }
    this.clearHeldResult();

    const inspection = this.flaImportService.getSession(request.sessionId);
    const staticSource = toSnapshotSource(inspection);
    if (!inspection || !staticSource) {
      return this.failure('SESSION_NOT_FOUND', 'The FLA inspection session is unavailable', request);
    }
    let resolve!: (response: FlaPartPreviewResponse) => void;
    const settledPromise = new Promise<FlaPartPreviewResponse>((complete) => { resolve = complete; });
    const active: ActivePartPreview = {
      request,
      startedAt: Date.now(),
      sourceBytes: staticSource.bytes,
      normalizedSha256: staticSource.sha256,
      settledPromise,
      resolve,
      wallTimer: undefined as unknown as NodeJS.Timeout,
      currentRasterRequestId: null,
      cancelled: false,
      settled: false,
      cancelCode: null,
    };
    this.active = active;
    active.wallTimer = setTimeout(() => {
      this.cancelActive(active, 'RENDER_TIMEOUT', 'Part preview exceeded its bounded batch wall time');
    }, this.wallTimeMs);
    void this.runPreview(active, staticSource)
      .then((response) => this.settle(active, response))
      .catch((error: unknown) => {
        if (active.settled) return;
        if (this.heldResult?.plan.requestId === active.request.requestId) this.clearHeldResult();
        const code = active.cancelCode ?? 'RENDER_FAILED';
        this.settle(active, this.failure(code, error instanceof Error ? error.message : String(error), request));
      });
    return settledPromise;
  }

  cancel(rawRequest: unknown): FlaPartPreviewCancelResponse {
    let request: FlaPartPreviewCancelRequest;
    try {
      request = FlaPartPreviewCancelRequestSchema.parse(rawRequest);
    } catch {
      return FlaPartPreviewCancelResponseSchema.parse({ accepted: false });
    }
    const active = this.active;
    const matches = Boolean(active &&
      (!request.requestId || active.request.requestId === request.requestId) &&
      (!request.sessionId || active.request.sessionId === request.sessionId) &&
      (request.generation === undefined || active.request.generation === request.generation));
    if (matches && active) {
      this.cancelActive(active, 'RENDER_CANCELLED', 'Part preview was cancelled');
      if (this.heldResult?.plan.requestId === active.request.requestId) this.clearHeldResult();
      return FlaPartPreviewCancelResponseSchema.parse({
        accepted: true,
        cancelledRequestId: active.request.requestId,
      });
    }
    const held = this.getValidHeldResult();
    if (held &&
        (!request.requestId || held.plan.requestId === request.requestId) &&
        (!request.sessionId || held.plan.sessionId === request.sessionId) &&
        (request.generation === undefined || held.plan.generation === request.generation)) {
      this.clearHeldResult();
      return FlaPartPreviewCancelResponseSchema.parse({
        accepted: true,
        cancelledRequestId: held.plan.requestId,
      });
    }
    return FlaPartPreviewCancelResponseSchema.parse({ accepted: false });
  }

  invalidateSession(sessionId: string): void {
    if (this.active?.request.sessionId === sessionId) {
      this.cancelActive(this.active, 'RENDER_CANCELLED', 'FLA inspection session was released');
    }
    if (this.heldResult?.plan.sessionId === sessionId) this.clearHeldResult();
    this.latestGenerationBySession.delete(sessionId);
  }

  invalidateAll(): void {
    if (this.active) this.cancelActive(this.active, 'RENDER_CANCELLED', 'Preview context changed');
    this.clearHeldResult();
    this.latestGenerationBySession.clear();
  }

  /** Main-only future F1-03 read path; no IPC route exposes this in F1-02. */
  getPlan(planId: string, sessionId?: string, generation?: number): FlaPartPlan | null {
    const held = this.getValidHeldResult();
    if (!held || held.plan.planId !== planId ||
        (sessionId && held.plan.sessionId !== sessionId) ||
        (generation !== undefined && held.plan.generation !== generation)) return null;
    return structuredClone(held.plan);
  }

  /** Main-only, read-only handoff for the exact Parts emitted with a held plan. */
  getPreparedBatch(planId: string, sessionId: string, generation: number): FlaPreparedPartBatch | null {
    const held = this.getValidHeldResult();
    if (!held || held.plan.planId !== planId || held.plan.sessionId !== sessionId ||
        held.plan.generation !== generation || held.plan.capability !== 'EDITABLE_PARTS_READY' || !held.parts) {
      return null;
    }
    const plan = structuredClone(held.plan);
    const parts = held.parts.map((part) => ({
      unitId: part.unitId,
      occurrenceId: part.occurrenceId,
      drawOrder: part.drawOrder,
      stageMapping: structuredClone(plan.units[part.drawOrder]!.stageMapping),
      image: {
        width: part.image.width,
        height: part.image.height,
        pixelCount: part.image.pixelCount,
        sha256: part.image.sha256,
        byteLength: part.image.byteLength,
        bytes: Uint8Array.from(part.image.bytes),
      },
    }));
    return {
      plan,
      identity: {
        planId: plan.planId,
        sessionId: plan.sessionId,
        requestId: plan.requestId,
        generation: plan.generation,
        rawSourceSha256: plan.source.rawSha256,
        normalizedSourceSha256: plan.source.normalizedSha256,
        poseIdentity: plan.poseIdentity,
        target: partPlanTargetIdentity(plan.target),
      },
      parts,
      partPngBytes: held.partPngBytes,
    };
  }

  /** Main-only validity recheck that never clones or returns the retained PNG bytes. */
  getPreparedBatchMetadata(
    planId: string,
    sessionId: string,
    generation: number,
  ): FlaPreparedPartBatchMetadata | null {
    const held = this.getValidHeldResult();
    if (!held || held.plan.planId !== planId || held.plan.sessionId !== sessionId ||
        held.plan.generation !== generation || held.plan.capability !== 'EDITABLE_PARTS_READY' || !held.parts) {
      return null;
    }
    const plan = structuredClone(held.plan);
    return {
      plan,
      identity: {
        planId: plan.planId,
        sessionId: plan.sessionId,
        requestId: plan.requestId,
        generation: plan.generation,
        rawSourceSha256: plan.source.rawSha256,
        normalizedSourceSha256: plan.source.normalizedSha256,
        poseIdentity: plan.poseIdentity,
        target: partPlanTargetIdentity(plan.target),
      },
      parts: held.parts.map((part) => ({
        unitId: part.unitId,
        occurrenceId: part.occurrenceId,
        drawOrder: part.drawOrder,
        stageMapping: structuredClone(plan.units[part.drawOrder]!.stageMapping),
        image: {
          width: part.image.width,
          height: part.image.height,
          pixelCount: part.image.pixelCount,
          sha256: part.image.sha256,
          byteLength: part.image.byteLength,
        },
      })),
      partPngBytes: held.partPngBytes,
    };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.active) this.cancelActive(this.active, 'RENDER_CANCELLED', 'Part preview service closed');
    this.clearHeldResult();
    this.latestGenerationBySession.clear();
  }

  private async runPreview(
    active: ActivePartPreview,
    sourceIdentity: FlaStaticSnapshotSource,
  ): Promise<FlaPartPreviewResponse> {
    let displayListResolveCount = 0;
    let rasterCount = 0;
    const startedAt = active.startedAt;
    const execution: FlaStaticSnapshotDisplaySourceExecution = {
      shouldContinue: () => this.isCurrent(active),
      yieldToEventLoop: () => new Promise<void>((resolve) => setImmediate(resolve)),
    };
    const prepared = await this.renderSession.prepareDisplaySourceForPartPreview(
      active.request.sessionId,
      execution,
    );
    if (!prepared.ok) {
      return this.failure(
        active.cancelCode ?? (prepared.code === 'SESSION_NOT_FOUND' ? 'SESSION_NOT_FOUND' : 'UNSUPPORTED_SOURCE'),
        prepared.message,
        active.request,
      );
    }
    const sourcePreparationCountForRequest: 0 | 1 = prepared.cacheHit ? 0 : 1;
    if (!this.ensureCurrentAndWithinBudget(active)) {
      return this.failure(active.cancelCode ?? 'RENDER_CANCELLED', 'Preview is stale or cancelled', active.request);
    }

    const selectedFrameIndex = active.request.target.selectedFrameIndex;
    const sceneMatch = prepared.source.sceneTimelines.find((scene) =>
      stableRenderTargetId(
        sourceIdentity.bytes,
        `scene\u0000timeline\u0000${scene.index}`,
      ) === active.request.target.renderTargetId,
    );
    let targetKind: 'scene' | 'graphic-symbol';
    let targetName: string;
    let sceneIndex: number | null;
    let sourceLibraryItemName: string | null;
    let userLabel: string;
    let frameCount: number;
    let target: FlaRenderTarget;
    let frameResult: ReturnType<FlaStaticSnapshotDisplaySource['buildSceneFrameContext']>;
    if (sceneMatch) {
      targetKind = 'scene';
      targetName = sceneMatch.name;
      sceneIndex = sceneMatch.index;
      sourceLibraryItemName = null;
      userLabel = sceneMatch.name.trim() || 'Main scene';
      frameCount = Math.min(100_000, sceneMatch.frameCount);
      if (selectedFrameIndex >= frameCount) {
        return this.failure('TARGET_NOT_FOUND', 'The selected Scene frame is outside the source frame range', active.request);
      }
      if (selectedFrameIndex === 0) prepared.source.resetFrameBuildState();
      frameResult = selectedFrameIndex === 0
        ? { ok: true as const, value: sceneMatch.frameContext }
        : prepared.source.buildSceneFrameContext(
            sceneMatch.xml,
            selectedFrameIndex,
            `scene:${sceneMatch.index}`,
          );
      target = {
        renderTargetId: active.request.target.renderTargetId,
        kind: 'scene',
        userLabel,
        sourceTimelineIndex: sceneMatch.index,
        frameCount,
        selectedFrameIndex,
        compatibility: ['degraded'],
      };
    } else {
      const graphicMatch = prepared.source.graphicSymbols.find((symbol) =>
        stableRenderTargetId(
          sourceIdentity.bytes,
          `graphic-symbol\u0000${symbol.sourceLibraryItemName}\u0000${symbol.userLabel}`,
        ) === active.request.target.renderTargetId,
      );
      if (!graphicMatch ||
          !isR05SafeGraphicSource(
            sourceIdentity.originalSourceSha256 ?? sourceIdentity.sha256,
            graphicMatch.sourceLibraryItemName,
            selectedFrameIndex,
          ) ||
          !isVisibleFrameZeroSceneGraphicReference(prepared.source, graphicMatch.sourceLibraryItemName)) {
        return this.failure(
          'TARGET_NOT_FOUND',
          'The requested Graphic root is not an approved complete character target in this FLA session',
          active.request,
        );
      }
      targetKind = 'graphic-symbol';
      targetName = graphicMatch.sourceLibraryItemName;
      sceneIndex = null;
      sourceLibraryItemName = graphicMatch.sourceLibraryItemName;
      userLabel = graphicMatch.userLabel;
      frameCount = Math.min(100_000, Math.max(1, graphicMatch.frameCount));
      if (selectedFrameIndex >= frameCount) {
        return this.failure('TARGET_NOT_FOUND', 'The selected Graphic frame is outside the source frame range', active.request);
      }
      prepared.source.resetFrameBuildState();
      frameResult = selectedFrameIndex === 0
        ? { ok: true as const, value: graphicMatch.frameContext }
        : prepared.source.buildGraphicFrameContext(
            graphicMatch.timelineXml,
            graphicMatch.frameSpanIndex,
            selectedFrameIndex,
            `graphic:${graphicMatch.sourceLibraryItemName}`,
          );
      target = {
        renderTargetId: active.request.target.renderTargetId,
        kind: 'graphic-symbol',
        userLabel,
        sourceLibraryItemName: graphicMatch.sourceLibraryItemName,
        frameCount,
        selectedFrameIndex,
        compatibility: ['degraded'],
      };
    }
    if (!frameResult.ok) {
      return this.failure('UNSUPPORTED_SOURCE', frameResult.message, active.request);
    }
    const frameContext = frameResult.value;
    if (frameContext.unsupportedDisplayReason) {
      return this.failure('UNSUPPORTED_SOURCE', frameContext.unsupportedDisplayReason, active.request);
    }
    if (!this.ensureCurrentAndWithinBudget(active)) {
      return this.failure(active.cancelCode ?? 'RENDER_CANCELLED', 'Preview is stale or cancelled', active.request);
    }

    const nativeResolved = resolveFlaDisplayList({
      root: targetKind === 'scene'
        ? { kind: 'scene', name: targetName, frameContext }
        : { kind: 'graphic', name: targetName, frameContext },
      symbols: prepared.source.symbols,
    });
    displayListResolveCount += 1;
    if (!nativeResolved.ok) {
      return this.failure(
        nativeResolved.code === 'MAX_RESOLVED_NODES_EXCEEDED' ||
            nativeResolved.code === 'MAX_RECURSION_DEPTH_EXCEEDED'
          ? 'BUDGET_EXCEEDED'
          : 'UNSUPPORTED_SOURCE',
        nativeResolved.message,
        active.request,
      );
    }
    const mediaLookup = createFlaStaticSnapshotBitmapMediaLookup(sourceIdentity.media ?? []);
    const nativeComposition = buildSvgForResolvedDisplayList({
      displayList: nativeResolved.displayList,
      renderTargetId: active.request.target.renderTargetId,
      stageWidth: prepared.source.stageWidth,
      stageHeight: prepared.source.stageHeight,
      shapeBlocks: prepared.source.shapeBlocks,
      resolveBitmapMedia: mediaLookup,
    });
    if (!nativeComposition.ok) {
      return this.failure(
        nativeComposition.code === 'BUDGET_EXCEEDED' ? 'BUDGET_EXCEEDED' : 'UNSUPPORTED_SOURCE',
        nativeComposition.message,
        active.request,
      );
    }
    const framing = nativeComposition.composition.framing;
    if (targetKind === 'graphic-symbol' && framing.mode !== 'content') {
      return this.failure('RENDER_FAILED', 'Graphic root preview did not produce a content viewport', active.request);
    }
    const rootTransform: FlaDisplayListMatrix = targetKind === 'graphic-symbol'
      ? {
        a: nativeComposition.width / framing.viewBox.width,
        b: 0,
        c: 0,
        d: nativeComposition.height / framing.viewBox.height,
        tx: -framing.viewBox.x * nativeComposition.width / framing.viewBox.width,
        ty: -framing.viewBox.y * nativeComposition.height / framing.viewBox.height,
      }
      : FLA_DISPLAY_LIST_IDENTITY_MATRIX;
    if (![rootTransform.a, rootTransform.b, rootTransform.c, rootTransform.d, rootTransform.tx, rootTransform.ty]
      .every(Number.isFinite)) {
      return this.failure('RENDER_FAILED', 'Graphic root viewport transform is not finite', active.request);
    }
    const nativeFacts: NativeRenderFacts = {
      source: prepared.source,
      targetKind,
      targetName,
      sceneIndex,
      sourceLibraryItemName,
      targetFrameCount: frameCount,
      rootTransform,
      userLabel,
      selectedFrameIndex,
      frameContext,
      resolvedNodeCount: nativeResolved.displayList.resolvedNodeCount,
      svg: nativeComposition.svg,
      width: nativeComposition.width,
      height: nativeComposition.height,
      pixelCount: nativeComposition.pixelCount,
    };
    let nativePreview: FlaPartPreviewPng;
    try {
      rasterCount += 1;
      nativePreview = await this.rasterize(active, nativeFacts.svg, nativeFacts.width, nativeFacts.height, nativeFacts.pixelCount);
    } catch (error) {
      return this.failure(
        active.cancelCode ?? (Date.now() - startedAt >= this.wallTimeMs ? 'RENDER_TIMEOUT' : 'RENDER_FAILED'),
        error instanceof Error ? error.message : String(error),
        active.request,
      );
    }
    if (!this.ensureCurrentAndWithinBudget(active)) {
      return this.failure(active.cancelCode ?? 'RENDER_CANCELLED', 'Preview is stale or cancelled', active.request);
    }

    const collection = makeCandidateCollection(
      prepared.source,
      frameContext,
      (sourceIdentity.originalSourceSha256 ?? sourceIdentity.sha256).toLowerCase(),
      target,
      rootTransform,
    );
    if (collection.fallbackReason) {
      return this.wholeImageOnly(active, sourceIdentity, nativeFacts, nativePreview, collection.fallbackReason, {
        sourcePreparationCountForRequest,
        displayListResolveCount,
        rasterCount,
        elapsedMs: Date.now() - startedAt,
      });
    }
    if (collection.candidates.length < 2) {
      return this.wholeImageOnly(
        active,
        sourceIdentity,
        nativeFacts,
        nativePreview,
        'Fewer than two independently addressable visible source parts were found.',
        { sourcePreparationCountForRequest, displayListResolveCount, rasterCount, elapsedMs: Date.now() - startedAt },
      );
    }

    const partPreviews: FlaPartPreviewPart[] = [];
    let partPngBytes = 0;
    for (const candidate of collection.candidates) {
      if (!this.ensureCurrentAndWithinBudget(active)) {
        return this.failure(active.cancelCode ?? 'RENDER_CANCELLED', 'Preview is stale or cancelled', active.request);
      }
      try {
        const isolated = isolateOccurrence(
          frameContext,
          prepared.source.symbols,
          candidate.isolatePath,
          candidate.unit.occurrenceId,
        );
        const isolatedFrameContext = nativeFacts.targetKind === 'graphic-symbol'
          ? applyRootTransformToFrameContext(isolated.frameContext, nativeFacts.rootTransform)
          : isolated.frameContext;
        const resolved = resolveFlaDisplayList({
          root: { kind: 'scene', name: 'F1-02 isolated source occurrence', frameContext: isolatedFrameContext },
          symbols: isolated.symbols,
        });
        displayListResolveCount += 1;
        if (!resolved.ok) {
          return this.wholeImageOnly(
            active,
            sourceIdentity,
            nativeFacts,
            nativePreview,
            `A source occurrence could not be isolated safely: ${resolved.message}`,
            { sourcePreparationCountForRequest, displayListResolveCount, rasterCount, elapsedMs: Date.now() - startedAt },
          );
        }
        const composition = buildSvgForResolvedDisplayList({
          displayList: resolved.displayList,
          renderTargetId: `${active.request.target.renderTargetId}-${candidate.unit.unitId}`,
          stageWidth: nativeFacts.targetKind === 'scene' ? prepared.source.stageWidth : nativeFacts.width,
          stageHeight: nativeFacts.targetKind === 'scene' ? prepared.source.stageHeight : nativeFacts.height,
          shapeBlocks: prepared.source.shapeBlocks,
          resolveBitmapMedia: mediaLookup,
        });
        if (!composition.ok) {
          return this.wholeImageOnly(
            active,
            sourceIdentity,
            nativeFacts,
            nativePreview,
            `A source occurrence could not be composed safely: ${composition.message}`,
            { sourcePreparationCountForRequest, displayListResolveCount, rasterCount, elapsedMs: Date.now() - startedAt },
          );
        }
        rasterCount += 1;
        const image = await this.rasterize(active, composition.svg, composition.width, composition.height, composition.pixelCount);
        partPngBytes += image.byteLength;
        if (partPngBytes > FLA_PART_PREVIEW_LIMITS.maxCompositionInputBytes) {
          return this.wholeImageOnly(
            active,
            sourceIdentity,
            nativeFacts,
            nativePreview,
            'The independent PNGs exceed the bounded reassembly input budget.',
            { sourcePreparationCountForRequest, displayListResolveCount, rasterCount, elapsedMs: Date.now() - startedAt },
          );
        }
        if (nativePreview.byteLength + partPngBytes > FLA_PART_PREVIEW_LIMITS.maxTotalPngBytes) {
          return this.wholeImageOnly(
            active,
            sourceIdentity,
            nativeFacts,
            nativePreview,
            'The native preview and independent PNGs exceed the bounded batch output budget.',
            { sourcePreparationCountForRequest, displayListResolveCount, rasterCount, elapsedMs: Date.now() - startedAt },
          );
        }
        partPreviews.push({
          unitId: candidate.unit.unitId,
          occurrenceId: candidate.unit.occurrenceId,
          drawOrder: candidate.unit.drawOrder,
          image,
        });
      } catch (error) {
        if (active.cancelled || active.settled) {
          return this.failure(active.cancelCode ?? 'RENDER_CANCELLED', 'Preview was cancelled', active.request);
        }
        return this.wholeImageOnly(
          active,
          sourceIdentity,
          nativeFacts,
          nativePreview,
          `A source occurrence failed closed: ${error instanceof Error ? error.message : String(error)}`,
          { sourcePreparationCountForRequest, displayListResolveCount, rasterCount, elapsedMs: Date.now() - startedAt },
        );
      }
      await execution.yieldToEventLoop();
    }

    const reassemblySvg = this.makeReassemblySvg(partPreviews, nativeFacts.width, nativeFacts.height);
    if (Buffer.byteLength(reassemblySvg, 'utf8') > FLA_STATIC_SNAPSHOT_LIMITS.maxSnapshotBytes) {
      return this.wholeImageOnly(
        active,
        sourceIdentity,
        nativeFacts,
        nativePreview,
        'The source-part reassembly SVG exceeds the existing snapshot byte budget.',
        { sourcePreparationCountForRequest, displayListResolveCount, rasterCount, elapsedMs: Date.now() - startedAt },
      );
    }
    let reassembledPreview: FlaPartPreviewPng;
    try {
      rasterCount += 1;
      reassembledPreview = await this.rasterize(
        active,
        reassemblySvg,
        nativeFacts.width,
        nativeFacts.height,
        nativeFacts.pixelCount,
      );
    } catch (error) {
      if (active.cancelled || active.settled) {
        return this.failure(active.cancelCode ?? 'RENDER_CANCELLED', 'Preview was cancelled', active.request);
      }
      return this.wholeImageOnly(
        active,
        sourceIdentity,
        nativeFacts,
        nativePreview,
        `The emitted part PNGs could not be reassembled: ${error instanceof Error ? error.message : String(error)}`,
        { sourcePreparationCountForRequest, displayListResolveCount, rasterCount, elapsedMs: Date.now() - startedAt },
      );
    }
    const totalPngBytes = nativePreview.byteLength + partPngBytes + reassembledPreview.byteLength;
    if (totalPngBytes > FLA_PART_PREVIEW_LIMITS.maxTotalPngBytes) {
      return this.wholeImageOnly(
        active,
        sourceIdentity,
        nativeFacts,
        nativePreview,
        'The complete batch PNG output exceeds the bounded batch output budget.',
        { sourcePreparationCountForRequest, displayListResolveCount, rasterCount, elapsedMs: Date.now() - startedAt },
      );
    }
    if (!this.ensureCurrentAndWithinBudget(active)) {
      return this.failure(active.cancelCode ?? 'RENDER_CANCELLED', 'Preview is stale or cancelled', active.request);
    }

    const units = collection.candidates.map((candidate) => candidate.unit);
    const plan = this.createPlan(
      active,
      sourceIdentity,
      nativeFacts,
      'EDITABLE_PARTS_READY',
      null,
      units,
    );
    const response = FlaPartPreviewResponseSchema.parse({
      ok: true,
      status: 'PREVIEW_READY',
      capability: 'EDITABLE_PARTS_READY',
      requestId: active.request.requestId,
      sessionId: active.request.sessionId,
      generation: active.request.generation,
      planId: plan.planId,
      poseIdentity: plan.poseIdentity,
      target: {
        renderTargetId: plan.target.renderTargetId,
        userLabel: plan.target.userLabel,
        frameCount: plan.target.frameCount,
        selectedFrameIndex: plan.target.selectedFrameIndex,
      },
      stage: { width: plan.stage.width, height: plan.stage.height, pixelCount: plan.stage.pixelCount },
      nativePreview,
      partPreviews,
      reassembledPreview,
      metrics: {
        preparedSourceCacheHit: prepared.cacheHit ?? false,
        sourcePreparationCountForRequest,
        displayListResolveCount,
        rasterCount,
        unitCount: units.length,
        totalPngBytes,
        elapsedMs: Math.min(this.wallTimeMs, Date.now() - startedAt),
      },
    });
    if (!response.ok || response.capability !== 'EDITABLE_PARTS_READY') {
      throw new Error('Editable Part preview response failed its validated capability check');
    }
    this.holdResult(plan, response.partPreviews);
    return response;
  }

  private makeReassemblySvg(
    previews: readonly { readonly image: FlaPartPreviewPng }[],
    width: number,
    height: number,
  ): string {
    const layers = previews.map(({ image }) => {
      const base64 = Buffer.from(image.bytes.buffer, image.bytes.byteOffset, image.bytes.byteLength).toString('base64');
      return `<image x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none" href="data:image/png;base64,${base64}"/>`;
    }).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${layers}</svg>`;
  }

  private async rasterize(
    active: ActivePartPreview,
    svg: string,
    width: number,
    height: number,
    pixelCount: number,
  ): Promise<FlaPartPreviewPng> {
    if (!this.ensureCurrentAndWithinBudget(active)) {
      throw new Error(active.cancelCode === 'RENDER_TIMEOUT' ? 'Batch wall time exceeded' : 'Preview was cancelled');
    }
    const requestId = crypto.randomUUID();
    active.currentRasterRequestId = requestId;
    let raster: FlaStaticSnapshotRasterizeOutput;
    try {
      raster = await this.rasterizer.rasterize({ requestId, svg, width, height, pixelCount });
    } finally {
      if (active.currentRasterRequestId === requestId) active.currentRasterRequestId = null;
    }
    if (!this.ensureCurrentAndWithinBudget(active)) {
      throw new Error(active.cancelCode === 'RENDER_TIMEOUT' ? 'Batch wall time exceeded' : 'Preview was cancelled');
    }
    if (raster.width !== width || raster.height !== height || raster.pixelCount !== pixelCount ||
        raster.pngBytes.byteLength <= 0 || raster.pngBytes.byteLength > FLA_STATIC_SNAPSHOT_LIMITS.maxSnapshotBytes) {
      throw new Error('Sandbox rasterizer returned out-of-budget dimensions or bytes');
    }
    const dimensions = validatePngEncodedImage(Buffer.from(raster.pngBytes), {
      maxWidth: FLA_STATIC_SNAPSHOT_LIMITS.maxOutputWidth,
      maxHeight: FLA_STATIC_SNAPSHOT_LIMITS.maxOutputHeight,
      maxPixels: FLA_STATIC_SNAPSHOT_LIMITS.maxOutputPixels,
      maxEncodedBytes: FLA_STATIC_SNAPSHOT_LIMITS.maxSnapshotBytes,
    });
    if (!dimensions || dimensions.width !== width || dimensions.height !== height) {
      throw new Error('Sandbox rasterizer returned an invalid PNG');
    }
    return this.pngRecord(raster.pngBytes, width, height, pixelCount);
  }

  private pngRecord(bytes: Uint8Array, width: number, height: number, pixelCount: number): FlaPartPreviewPng {
    return {
      width,
      height,
      pixelCount,
      sha256: digestPng(bytes),
      byteLength: bytes.byteLength,
      bytes,
    };
  }

  private wholeImageOnly(
    active: ActivePartPreview,
    source: FlaStaticSnapshotSource,
    native: NativeRenderFacts,
    nativePreview: FlaPartPreviewPng,
    reason: string,
    partialMetrics: {
      sourcePreparationCountForRequest: 0 | 1;
      displayListResolveCount: number;
      rasterCount: number;
      elapsedMs: number;
    },
  ): FlaPartPreviewResponse {
    const safeReason = reason.trim().slice(0, 1_000) || 'Part isolation is not supported for this Scene.';
    const plan = this.createPlan(active, source, native, 'WHOLE_IMAGE_ONLY', safeReason, []);
    const response = FlaPartPreviewResponseSchema.parse({
      ok: true,
      status: 'PREVIEW_READY',
      capability: 'WHOLE_IMAGE_ONLY',
      reason: safeReason,
      requestId: active.request.requestId,
      sessionId: active.request.sessionId,
      generation: active.request.generation,
      planId: plan.planId,
      poseIdentity: plan.poseIdentity,
      target: {
        renderTargetId: plan.target.renderTargetId,
        userLabel: plan.target.userLabel,
        frameCount: plan.target.frameCount,
        selectedFrameIndex: plan.target.selectedFrameIndex,
      },
      stage: { width: plan.stage.width, height: plan.stage.height, pixelCount: plan.stage.pixelCount },
      nativePreview,
      partPreviews: [],
      reassembledPreview: null,
      metrics: {
        preparedSourceCacheHit: partialMetrics.sourcePreparationCountForRequest === 0,
        sourcePreparationCountForRequest: partialMetrics.sourcePreparationCountForRequest,
        displayListResolveCount: partialMetrics.displayListResolveCount,
        rasterCount: partialMetrics.rasterCount,
        unitCount: 0,
        totalPngBytes: nativePreview.byteLength,
        elapsedMs: Math.min(this.wallTimeMs, partialMetrics.elapsedMs),
      },
    });
    if (!response.ok || response.capability !== 'WHOLE_IMAGE_ONLY') {
      throw new Error('Whole-image preview response failed its validated capability check');
    }
    this.holdResult(plan, null);
    return response;
  }

  private createPlan(
    active: ActivePartPreview,
    source: FlaStaticSnapshotSource,
    native: NativeRenderFacts,
    capability: 'EDITABLE_PARTS_READY' | 'WHOLE_IMAGE_ONLY',
    capabilityReason: string | null,
    units: readonly FlaPartPreviewUnit[],
  ): FlaPartPlan {
    const poseIdentity = crypto.createHash('sha256').update(JSON.stringify({
      rawSha256: (source.originalSourceSha256 ?? source.sha256).toLowerCase(),
      normalizedSha256: source.sha256.toLowerCase(),
      target: active.request.target.renderTargetId,
      frame: active.request.target.selectedFrameIndex,
      stage: { width: native.width, height: native.height },
      units: units.map((unit) => ({
        occurrenceId: unit.occurrenceId,
        localTransform: unit.localTransform,
        worldTransform: unit.worldTransform,
        selectedEffectiveChildFrameIndex: unit.selectedEffectiveChildFrameIndex,
      })),
    }), 'utf8').digest('hex');
    return FlaPartPlanSchema.parse({
      format: 'panda-fla-part-plan',
      version: 1,
      planId: crypto.randomUUID(),
      sessionId: active.request.sessionId,
      requestId: active.request.requestId,
      generation: active.request.generation,
      expiresAt: new Date(this.now().getTime() + FLA_PART_PREVIEW_LIMITS.planLifetimeMs).toISOString(),
      source: {
        basename: source.basename,
        rawSha256: (source.originalSourceSha256 ?? source.sha256).toLowerCase(),
        normalizedSha256: source.sha256.toLowerCase(),
      },
      target: {
        renderTargetId: active.request.target.renderTargetId,
        kind: native.targetKind,
        userLabel: native.userLabel,
        sceneIndex: native.sceneIndex,
        sourceLibraryItemName: native.sourceLibraryItemName,
        frameCount: native.targetFrameCount,
        selectedFrameIndex: native.selectedFrameIndex,
        frameSelectionBasis: native.targetKind === 'scene'
          ? 'authored Scene frame selected through Main prepared source'
          : 'approved Graphic root frame selected through Main prepared source',
      },
      poseIdentity,
      stage: {
        width: native.width,
        height: native.height,
        pixelCount: native.pixelCount,
        coordinateSpace: native.targetKind === 'scene'
          ? 'root-scene-stage-pixels'
          : 'root-graphic-local-pixels',
      },
      capability,
      capabilityReason,
      units,
    });
  }

  private holdResult(plan: FlaPartPlan, partPreviews: readonly FlaPartPreviewPart[] | null): void {
    let parts: readonly FlaPartPreviewPart[] | null = null;
    let partPngBytes = 0;
    if (plan.capability === 'EDITABLE_PARTS_READY') {
      if (!partPreviews || partPreviews.length < 2 ||
          partPreviews.length > FLA_PART_PREVIEW_LIMITS.maxParts ||
          partPreviews.length !== plan.units.length) {
        throw new Error('Editable Part preview cannot hold an incomplete PNG batch');
      }
      const copiedParts = partPreviews.map((part, index) => {
        const unit = plan.units[index];
        const image = part.image;
        if (!unit || unit.unitId !== part.unitId || unit.occurrenceId !== part.occurrenceId ||
            unit.drawOrder !== index || part.drawOrder !== index ||
            image.width !== plan.stage.width || image.height !== plan.stage.height ||
            image.pixelCount !== plan.stage.pixelCount || image.byteLength !== image.bytes.byteLength ||
            image.byteLength <= 0 || digestPng(image.bytes) !== image.sha256) {
          throw new Error('Editable Part preview PNG does not match its PartPlan unit');
        }
        partPngBytes += image.byteLength;
        if (partPngBytes > FLA_PART_PREVIEW_LIMITS.maxCompositionInputBytes ||
            partPngBytes > FLA_PART_PREVIEW_LIMITS.maxTotalPngBytes) {
          throw new Error('Editable Part preview PNGs exceed the retained batch byte budget');
        }
        return Object.freeze({
          unitId: part.unitId,
          occurrenceId: part.occurrenceId,
          drawOrder: part.drawOrder,
          image: Object.freeze({
            width: image.width,
            height: image.height,
            pixelCount: image.pixelCount,
            sha256: image.sha256,
            byteLength: image.byteLength,
            bytes: Uint8Array.from(image.bytes),
          }),
        });
      });
      parts = Object.freeze(copiedParts);
    } else if (partPreviews !== null) {
      throw new Error('Whole-image fallback cannot retain an editable Part PNG batch');
    }

    const heldResult: HeldPartPreviewResult = Object.freeze({
      plan: structuredClone(plan),
      parts,
      partPngBytes,
    });
    this.clearHeldResult();
    this.heldResult = heldResult;
    const planId = heldResult.plan.planId;
    this.expiryTimer = setTimeout(() => {
      if (this.heldResult?.plan.planId === planId) this.clearHeldResult();
    }, FLA_PART_PREVIEW_LIMITS.planLifetimeMs);
  }

  private getValidHeldResult(): HeldPartPreviewResult | null {
    const held = this.heldResult;
    if (!held) return null;
    if (Date.parse(held.plan.expiresAt) <= this.now().getTime()) {
      this.clearHeldResult();
      return null;
    }
    const source = toSnapshotSource(this.flaImportService.getSession(held.plan.sessionId));
    if (!source || source.sha256.toLowerCase() !== held.plan.source.normalizedSha256 ||
        (source.originalSourceSha256 ?? source.sha256).toLowerCase() !== held.plan.source.rawSha256) {
      this.clearHeldResult();
      return null;
    }
    return held;
  }

  private clearHeldResult(): void {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
    this.heldResult = null;
  }

  private failure(
    code: FlaPartPreviewErrorCode,
    message: string,
    request?: FlaPartPreviewRequest,
  ): FlaPartPreviewResponse {
    const boundedMessage = message.trim().slice(0, 1_000) || 'FLA part preview failed';
    const cancelled = code === 'RENDER_CANCELLED' || code === 'RENDER_TIMEOUT';
    const unsupported = code === 'UNSUPPORTED_SOURCE' || code === 'TARGET_NOT_FOUND';
    return FlaPartPreviewResponseSchema.parse({
      ok: false,
      status: cancelled ? 'CANCELLED' : 'ERROR',
      ...(unsupported ? { capability: 'UNSUPPORTED' } : {}),
      ...(request ? {
        requestId: request.requestId,
        sessionId: request.sessionId,
        generation: request.generation,
      } : {}),
      error: { code, message: boundedMessage },
    });
  }

  private isCurrent(active: ActivePartPreview): boolean {
    if (this.closed || active.cancelled || active.settled || this.active !== active) return false;
    const session = this.flaImportService.getSession(active.request.sessionId);
    return session?.sourceBytes === active.sourceBytes &&
      session.ir.source.sha256.toLowerCase() === active.normalizedSha256;
  }

  private ensureCurrentAndWithinBudget(active: ActivePartPreview): boolean {
    if (!this.isCurrent(active)) return false;
    if (Date.now() - active.startedAt < this.wallTimeMs) return true;
    this.cancelActive(active, 'RENDER_TIMEOUT', 'Part preview exceeded its bounded batch wall time');
    return false;
  }

  private cancelActive(
    active: ActivePartPreview,
    code: 'RENDER_CANCELLED' | 'RENDER_TIMEOUT',
    message: string,
  ): void {
    if (active.settled) return;
    active.cancelled = true;
    active.cancelCode = code;
    if (active.currentRasterRequestId) this.rasterizer.cancel(active.currentRasterRequestId);
    this.settle(active, this.failure(code, message, active.request));
  }

  private settle(active: ActivePartPreview, response: FlaPartPreviewResponse): void {
    if (active.settled) return;
    active.settled = true;
    clearTimeout(active.wallTimer);
    if (this.active === active) this.active = null;
    active.resolve(response);
  }
}
