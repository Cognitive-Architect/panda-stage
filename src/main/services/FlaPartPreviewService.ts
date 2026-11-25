import crypto from 'node:crypto';
import {
  FLA_GRAPHIC_MAX_FRAMES,
  type FlaGraphicAuthorPoseNode,
  type FlaGraphicAuthorPoseReference,
  type FlaGraphicStructure,
  type FlaGraphicStructureNode,
} from '../../domain';
import {
  captureFlaGraphicStructureFrames,
  hasScreenSpaceInstanceFilter,
  type IsolatedFilteredLayerCaptureResult,
  type IsolatedSubtreeCaptureResult,
  type SubtreeBounds,
} from './flaGraphicStructureCapture';
import {
  FlaPartPlanSchema,
  FlaPartPreviewCancelRequestSchema,
  FlaPartPreviewCancelResponseSchema,
  FlaPartPreviewRequestSchema,
  FlaPartPreviewResponseSchema,
  FlaPartPreviewUnitSchema,
  FLA_PART_PREVIEW_LIMITS,
  FLA_NO_IMPORTABLE_GRAPHIC,
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
import {
  invertAffineMatrix,
  multiplyAffineMatrices,
  type AffineMatrix2D,
} from '../../shared/affine-matrix';
import type { FlaGraphicGroupEditPreview } from '../../shared/fla-graphic-instance-api';
import { isR05SafeGraphicSource } from '../../shared/fla-character-import-safe-graphic-targets';
import {
  FLA_STATIC_TEXT_LIMITS,
  hasUnresolvedFlaStaticTextPlaceholder,
  type FlaStaticTextDescriptor,
  type FlaStaticTextGraphicFraming,
  type FlaStaticTextRenderItem,
} from '../../shared/fla-static-text';
import type {
  FlaDisplayListElement,
  FlaDisplayListFrameContext,
  FlaDisplayListLayer,
  FlaDisplayListMatrix,
  FlaResolvedClipPath,
  FlaResolvedDisplayLayer,
  FlaResolvedDisplayList,
  FlaResolvedDisplayNode,
  FlaResolvedGroupNode,
  FlaGraphicSymbolDefinition,
} from './fla-display-list-resolver';
import {
  DEFAULT_FLA_DISPLAY_LIST_RESOLVER_LIMITS,
  FLA_DISPLAY_LIST_IDENTITY_MATRIX,
  resolveFlaDisplayList,
} from './fla-display-list-resolver';
import {
  prepareFlaNestedGraphicFrameSelections,
  resolveFlaGraphicFirstFrame,
  resolveFlaGraphicPlaybackMode,
  type FlaNestedGraphicFrameSelection,
} from './fla-nested-graphic-frame-selector';
import type {
  FlaStaticSnapshotDisplaySource,
  FlaStaticSnapshotDisplaySourceExecution,
} from './fla-static-snapshot-display-list-adapter';
import {
  buildSvgForResolvedDisplayList,
  buildSvgForRenderTarget,
  extractFlaGraphicMaskPathData,
  readFlaSourceFrameLabel,
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
import { FlaStaticSnapshotRasterizerError } from './fla-static-snapshot-render-session';
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
  readonly sourceKind: FlaPartPreviewUnit['sourceKind'];
  readonly sourceSymbolId: string | null;
  readonly sourceAddress: string | null;
  readonly adapterIdentity: string | null;
  readonly sourceDefinitionFrameCount: number | null;
  readonly layerName: string;
  readonly drawOrder: number;
  readonly graphicInstanceImportable?: boolean;
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
  if (element.kind === 'text') return element.textId;
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
  sourceSymbols: ReadonlyMap<string, FlaGraphicSymbolDefinition>,
  selectionsBySourceAddress: ReadonlyMap<string, FlaNestedGraphicFrameSelection>,
  sourceRawSha256: string,
  target: FlaRenderTarget,
  rootTransform: FlaDisplayListMatrix,
  graphicInstances: boolean,
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
    const selectedFrame = element.kind === 'symbol'
      ? selectionsBySourceAddress.get(element.sourceAddress ?? '')
      : null;
    if (element.kind === 'symbol' && !selectedFrame) {
      fallbackReason = 'Nested Graphic occurrence has no source-addressed frame selection.';
      return;
    }
    const effectiveChildFrame = element.kind === 'symbol' ? selectedFrame!.selectedChildFrameIndex : null;
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
        ? `Nested Graphic selector: ${selectedFrame!.selectionRule}`
        : null,
      localTransform: element.localTransform ?? FLA_DISPLAY_LIST_IDENTITY_MATRIX,
      worldTransform,
      ...(graphicInstances && element.kind === 'symbol' &&
        (element.alphaMultiplier !== undefined || element.rgbTransform) ? {
          instanceColor: {
            ...(element.alphaMultiplier !== undefined ? { opacity: element.alphaMultiplier } : {}),
            ...(element.rgbTransform ? { rgbTransform: element.rgbTransform } : {}),
          },
        } : {}),
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
    if (!graphicInstances || canImportGraphicInstance(unit)) candidates.push({ unit, isolatePath: path });
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
      // Complete Graphic candidates are direct Scene occurrences. A relationship
      // on their own layer can affect isolation; sibling layers cannot.
      if (graphicInstances && (layer.maskLayerId || layer.maskedBy)) continue;
      const masks = graphicInstances ? [] : contextMaskDependencies(frameContext, contextPath);
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
          if (graphicInstances) continue;
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
        const definition = sourceSymbols.get(definitionKey);
        const descriptor = descriptorsByName.get(element.libraryItemName) ?? null;
        const hasOccurrenceEffects =
          Boolean(element.instanceFilters?.some((filter) => filter.enabled)) ||
          Boolean(element.blendMode);
        if (graphicInstances) {
          // The shared definition cannot carry filters authored on this occurrence.
          if (hasOccurrenceEffects) continue;
          if (descriptor && element.sourceAddress && definition?.kind === 'graphic' && element.symbolType === 'graphic' &&
              matrixFacts(worldTransform).invertible &&
              definition.frameContext.layers.some((childLayer) => childLayer?.visible &&
                childLayer.elements.some((child) => child && child.visible !== false))) {
            append(element, path, worldTransform, contextPath, layer, layerIndex, descriptor, null);
          }
          continue;
        }
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
        const canDescend = !hasOccurrenceEffects && childSymbols.length > 0 && childOtherContent.length === 0 &&
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
        if (hasOccurrenceEffects) reasons.push('Instance effects require a single composited Part.');
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
  graphicInstance: boolean,
): FlaDisplayListFrameContext {
  if (graphicInstance) {
    // Drop both ends of every unrelated Scene mask relationship.
    return { ...frameContext, layers: [{ ...selected.layer, elements: [selectedElement] }] };
  }
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
  graphicInstance: boolean,
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
      return pruneFrameContext(frameContext, pathItem, element, graphicInstance);
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
    return pruneFrameContext(frameContext, pathItem, { ...element, frameSelectionKey: overlayKey }, graphicInstance);
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
    loadMedia: session.loadMedia,
  };
}

function digestPng(bytes: Uint8Array): string {
  return crypto.createHash('sha256').update(Buffer.from(bytes)).digest('hex');
}

interface FlaResolvedGroupEditCandidate {
  readonly group: FlaResolvedGroupNode;
  readonly layer: FlaResolvedDisplayLayer;
}

function collectTopLevelGroupEditCandidates(
  displayList: FlaResolvedDisplayList,
): FlaResolvedGroupEditCandidate[] {
  const candidates: FlaResolvedGroupEditCandidate[] = [];
  for (const layer of displayList.layers) {
    for (const node of layer.children) {
      if (node.kind === 'group' && !node.symbolLibraryItemName) {
        candidates.push({ group: node, layer });
      }
    }
  }
  return candidates;
}

function isSafeGroupEditCandidate(
  candidate: FlaResolvedGroupEditCandidate,
): boolean {
  const { group, layer } = candidate;
  return !layer.frameFilter &&
    Boolean(group.sourceAddress) &&
    !group.rgbTransform &&
    !group.blendMode &&
    (group.opacity === undefined || group.opacity === 1) &&
    group.children.length >= 1 &&
    group.children.length <= 2 &&
    group.children.every((child) => child.kind !== 'group' &&
      Boolean(child.sourceAddress) &&
      !child.clipPaths?.length);
}

function splitResolvedDisplayListAtGroup(
  displayList: FlaResolvedDisplayList,
  target: FlaResolvedGroupNode,
): {
  readonly backgroundLayers: readonly FlaResolvedDisplayLayer[];
  readonly foregroundLayers: readonly FlaResolvedDisplayLayer[];
} | null {
  const backgroundLayers: FlaResolvedDisplayLayer[] = [];
  const foregroundLayers: FlaResolvedDisplayLayer[] = [];
  let targetSeen = false;

  for (const layer of displayList.layers) {
    const backgroundChildren: FlaResolvedDisplayNode[] = [];
    const foregroundChildren: FlaResolvedDisplayNode[] = [];
    for (const node of layer.children) {
      if (node === target) {
        if (targetSeen) return null;
        targetSeen = true;
        continue;
      }
      (targetSeen ? foregroundChildren : backgroundChildren).push(node);
    }
    if (backgroundChildren.length > 0) {
      backgroundLayers.push({ ...layer, children: backgroundChildren });
    }
    if (foregroundChildren.length > 0) {
      foregroundLayers.push({ ...layer, children: foregroundChildren });
    }
  }

  return targetSeen ? { backgroundLayers, foregroundLayers } : null;
}

function countResolvedDisplayNodes(nodes: readonly FlaResolvedDisplayNode[]): number {
  return nodes.reduce((total, node) => total + 1 + (node.kind === 'group'
    ? countResolvedDisplayNodes(node.children)
    : 0), 0);
}

function isFiniteAffineMatrix(matrix: AffineMatrix2D): boolean {
  return [matrix.a, matrix.b, matrix.c, matrix.d, matrix.tx, matrix.ty].every(Number.isFinite);
}

function localizeResolvedClipPaths(
  clipPaths: readonly FlaResolvedClipPath[] | undefined,
  invWorld: AffineMatrix2D,
  stripCount: number,
): readonly FlaResolvedClipPath[] | undefined | null {
  if (!clipPaths || clipPaths.length <= stripCount) return undefined;
  const localized: FlaResolvedClipPath[] = [];
  for (const clipPath of clipPaths.slice(stripCount)) {
    const shapes: FlaResolvedClipPath['shapes'][number][] = [];
    for (const shape of clipPath.shapes) {
      const worldTransform = multiplyAffineMatrices(invWorld, shape.worldTransform);
      if (!isFiniteAffineMatrix(worldTransform)) return null;
      const nestedClips = shape.clipPaths?.length
        ? localizeResolvedClipPaths(shape.clipPaths, invWorld, 0)
        : undefined;
      if (nestedClips === null) return null;
      shapes.push({
        ...shape,
        worldTransform,
        ...(nestedClips?.length ? { clipPaths: nestedClips } : { clipPaths: undefined }),
      });
    }
    localized.push({ ...clipPath, shapes });
  }
  return localized;
}

function localizeResolvedSubtreeNode(
  node: FlaResolvedDisplayNode,
  invWorld: AffineMatrix2D,
  stripExternalClipCount: number,
): FlaResolvedDisplayNode | null {
  const worldTransform = multiplyAffineMatrices(invWorld, node.worldTransform);
  if (!isFiniteAffineMatrix(worldTransform)) return null;
  if (node.kind === 'group') {
    const children: FlaResolvedDisplayNode[] = [];
    for (const child of node.children) {
      const localizedChild = localizeResolvedSubtreeNode(child, invWorld, stripExternalClipCount);
      if (!localizedChild) return null;
      children.push(localizedChild);
    }
    const instanceFilterClips = localizeResolvedClipPaths(
      node.instanceFilterClips,
      invWorld,
      stripExternalClipCount,
    );
    if (instanceFilterClips === null) return null;
    const inheritedClipPaths = localizeResolvedClipPaths(
      node.inheritedClipPaths,
      invWorld,
      stripExternalClipCount,
    );
    if (inheritedClipPaths === null) return null;
    return {
      ...node,
      worldTransform,
      ...(instanceFilterClips?.length ? { instanceFilterClips } : { instanceFilterClips: undefined }),
      ...(inheritedClipPaths?.length ? { inheritedClipPaths } : { inheritedClipPaths: undefined }),
      children,
    };
  }
  const clipPaths = localizeResolvedClipPaths(node.clipPaths, invWorld, stripExternalClipCount);
  if (clipPaths === null) return null;
  return {
    ...node,
    worldTransform,
    ...(clipPaths?.length ? { clipPaths } : { clipPaths: undefined }),
  };
}

function isolatedEffectTransform(node: FlaResolvedDisplayNode): AffineMatrix2D | undefined {
  // Filter primitives in the full SVG operate on already-transformed ink.
  // Retain those axes when isolating effects and only move the artwork origin.
  return hasScreenSpaceInstanceFilter(node)
    ? { ...FLA_DISPLAY_LIST_IDENTITY_MATRIX, tx: node.worldTransform.tx, ty: node.worldTransform.ty }
    : undefined;
}

function buildIsolatedDisplayListForNode(
  node: FlaResolvedDisplayNode,
  sourceName: string,
  artworkTransform: AffineMatrix2D | undefined,
): FlaResolvedDisplayList | null {
  const invWorld = invertAffineMatrix(artworkTransform ?? node.worldTransform);
  const artworkNodeTransform = artworkTransform && invWorld
    ? multiplyAffineMatrices(invWorld, node.worldTransform)
    : FLA_DISPLAY_LIST_IDENTITY_MATRIX;
  if (node.kind === 'text') {
    return {
      kind: 'graphic',
      sourceName,
      frameIndex: 0,
      resolvedNodeCount: 1,
      layers: [{
        name: 'text',
        children: [{
          ...node,
          localTransform: FLA_DISPLAY_LIST_IDENTITY_MATRIX,
          worldTransform: artworkNodeTransform,
          clipPaths: undefined,
        }],
      }],
    };
  }
  if (node.kind === 'group') {
    if (!invWorld) return null;
    const externalClipCount = (node.instanceFilterClips ?? node.inheritedClipPaths)?.length ?? 0;
    const children: FlaResolvedDisplayNode[] = [];
    for (const child of node.children) {
      const localizedChild = localizeResolvedSubtreeNode(child, invWorld, externalClipCount);
      if (!localizedChild) return null;
      children.push(localizedChild);
    }
    const isolatedGroup: FlaResolvedGroupNode = {
      ...node,
      localTransform: FLA_DISPLAY_LIST_IDENTITY_MATRIX,
      worldTransform: artworkNodeTransform,
      instanceFilterClips: undefined,
      inheritedClipPaths: undefined,
      // Runtime compositing applies the subtree's outer blend mode against the
      // live stage backdrop; baking mix-blend-mode into an isolated transparent
      // SVG would have no backdrop and lose the blend effect.
      blendMode: undefined,
      children,
    };
    return {
      kind: 'graphic',
      sourceName,
      frameIndex: 0,
      resolvedNodeCount: countResolvedDisplayNodes([isolatedGroup]),
      layers: [{ name: 'subtree', children: [isolatedGroup] }],
    };
  }
  return null;
}

function hasAnyClipPathsInNodes(nodes: readonly FlaResolvedDisplayNode[]): boolean {
  for (const node of nodes) {
    if (node.kind === 'group') {
      if (node.instanceFilterClips?.length || node.inheritedClipPaths?.length) return true;
      if (hasAnyClipPathsInNodes(node.children)) return true;
    } else if (node.clipPaths?.length) {
      return true;
    }
  }
  return false;
}

function buildGroupEditArtwork(
  displayList: FlaResolvedDisplayList,
  shapeBlocks: ReadonlyMap<string, string>,
  resolveBitmapMedia: ReturnType<typeof createFlaStaticSnapshotBitmapMediaLookup>,
  renderTargetId: string,
  stageWidth: number,
  stageHeight: number,
): FlaGraphicGroupEditPreview['children'][number]['artwork'] | null {
  const rendered = buildSvgForResolvedDisplayList({
    displayList,
    renderTargetId,
    stageWidth,
    stageHeight,
    shapeBlocks,
    resolveBitmapMedia,
  });
  if (!rendered.ok || Buffer.byteLength(rendered.svg, 'utf8') > 2_000_000) return null;
  return {
    svg: rendered.svg,
    viewBox: rendered.composition.framing.viewBox,
  };
}

function buildGroupEditPreview(input: {
  displayList: FlaResolvedDisplayList;
  sourceBytes: Uint8Array;
  sourceSha256: string;
  outerOccurrenceId: string;
  outerSourceAddress: string;
  graphicSymbolName: string;
  frameOrigin: { readonly x: number; readonly y: number };
  frameCanvas: { readonly width: number; readonly height: number };
  shapeBlocks: ReadonlyMap<string, string>;
  resolveBitmapMedia: ReturnType<typeof createFlaStaticSnapshotBitmapMediaLookup>;
  stageWidth: number;
  stageHeight: number;
  renderTargetId: string;
}): FlaGraphicGroupEditPreview | undefined {
  const candidate = collectTopLevelGroupEditCandidates(input.displayList)
    .filter(isSafeGroupEditCandidate)
    .at(-1);
  if (!candidate) return undefined;
  const { group } = candidate;
  const groupSourceAddress = group.sourceAddress;
  if (!groupSourceAddress) return undefined;
  const split = splitResolvedDisplayListAtGroup(input.displayList, group);
  if (!split) return undefined;

  const children: FlaGraphicGroupEditPreview['children'][number][] = [];
  let previewBytes = 0;
  for (const child of group.children) {
    if (child.kind === 'group' || child.kind === 'text') return undefined;
    const sourceIdentity = child.kind === 'shape' ? child.shapeId : child.libraryItemName;
    const localArtNode: FlaResolvedDisplayNode = {
      ...child,
      localTransform: FLA_DISPLAY_LIST_IDENTITY_MATRIX,
      worldTransform: FLA_DISPLAY_LIST_IDENTITY_MATRIX,
    };
    const childDisplayList: FlaResolvedDisplayList = {
      ...input.displayList,
      resolvedNodeCount: 1,
      layers: [{ name: `group-child-${children.length}`, children: [localArtNode] }],
    };
    const artwork = buildGroupEditArtwork(
      childDisplayList,
      input.shapeBlocks,
      input.resolveBitmapMedia,
      stableRenderTargetId(input.sourceBytes, `${input.renderTargetId}\u0000${child.sourceAddress}`),
      input.stageWidth,
      input.stageHeight,
    );
    if (!artwork) return undefined;
    previewBytes += Buffer.byteLength(artwork.svg, 'utf8');
    if (previewBytes > 2_000_000) return undefined;
    children.push({
      sourceAddress: child.sourceAddress!,
      parentGroupSourceAddress: groupSourceAddress,
      kind: child.kind,
      sourceIdentity,
      localTransform: child.localTransform,
      worldTransform: child.worldTransform,
      artwork,
    });
  }

  const buildSegment = (
    layers: readonly FlaResolvedDisplayLayer[],
    renderTargetSuffix: 'background' | 'foreground',
  ): FlaGraphicGroupEditPreview['background'] | undefined => {
    const resolvedNodeCount = layers.reduce(
      (total, layer) => total + countResolvedDisplayNodes(layer.children),
      0,
    );
    if (resolvedNodeCount === 0) return null;
    const artwork = buildGroupEditArtwork({
      ...input.displayList,
      resolvedNodeCount: Math.max(1, resolvedNodeCount),
      layers,
    }, input.shapeBlocks, input.resolveBitmapMedia,
    `${input.renderTargetId}:group-${renderTargetSuffix}`,
    input.stageWidth, input.stageHeight);
    if (!artwork) return undefined;
    previewBytes += Buffer.byteLength(artwork.svg, 'utf8');
    if (previewBytes > 2_000_000) return undefined;
    return {
      artwork,
      position: {
        x: artwork.viewBox.x - input.frameOrigin.x - input.frameCanvas.width / 2,
        y: artwork.viewBox.y - input.frameOrigin.y - input.frameCanvas.height / 2,
      },
    };
  };

  const background = buildSegment(split.backgroundLayers, 'background');
  if (background === undefined) return undefined;
  const foreground = buildSegment(split.foregroundLayers, 'foreground');
  if (foreground === undefined) return undefined;

  const canvasOriginTransform: AffineMatrix2D = {
    ...FLA_DISPLAY_LIST_IDENTITY_MATRIX,
    tx: -input.frameOrigin.x - input.frameCanvas.width / 2,
    ty: -input.frameOrigin.y - input.frameCanvas.height / 2,
  };
  return {
    version: 1,
    source: {
      sha256: input.sourceSha256,
      outerOccurrenceId: input.outerOccurrenceId,
      outerSourceAddress: input.outerSourceAddress,
      graphicSymbolName: input.graphicSymbolName,
    },
    frameIndex: 0,
    frameOrigin: input.frameOrigin,
    frameCanvas: input.frameCanvas,
    group: {
      groupId: group.groupId,
      sourceAddress: groupSourceAddress,
      worldTransform: group.worldTransform,
      canvasTransform: multiplyAffineMatrices(canvasOriginTransform, group.worldTransform),
    },
    background,
    foreground,
    children,
  };
}

/**
 * Persisted Animation Layers can play from firstFrame through the Definition's
 * final frame, but cannot represent an earlier or wrapped terminal frame.
 * Single-frame playback uses only firstFrame, and fla-viewer treats omitted
 * and negative lastFrame values as unbounded.
 */
export function isGraphicPlaybackRangeRepresentable(
  lastFrame: string | null,
  frameCount: number,
  playbackMode: string | null,
): boolean {
  if (!Number.isSafeInteger(frameCount) || frameCount <= 0) return false;
  if (lastFrame === null) return true;
  const raw = lastFrame.trim();
  if (!/^-?\d+$/u.test(raw)) return false;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) return false;
  if (parsed < 0) return true;
  if (parsed >= frameCount) return false;
  return resolveFlaGraphicPlaybackMode(playbackMode) === 'single frame' ||
    parsed === frameCount - 1;
}

function canImportGraphicInstance(unit: FlaPartPreviewUnit): boolean {
  const mode = resolveFlaGraphicPlaybackMode(unit.sourceFrame.playbackMode);
  const firstFrame = resolveFlaGraphicFirstFrame(unit.sourceFrame.firstFrame);
  const frameCount = unit.sourceDefinitionFrameCount;
  return unit.sourceKind === 'graphic-symbol-occurrence' &&
    unit.sourceSymbolId !== null &&
    unit.sourceAddress !== null &&
    unit.adapterIdentity !== null &&
    unit.traceability === 'source-address-and-parent-chain' &&
    frameCount !== null &&
    frameCount > 0 &&
    frameCount <= FLA_GRAPHIC_MAX_FRAMES &&
    isGraphicPlaybackRangeRepresentable(unit.sourceFrame.lastFrame, frameCount, unit.sourceFrame.playbackMode) &&
    unit.maskDependencies.length === 0 &&
    (mode === 'loop' || mode === 'play once' || mode === 'single frame') &&
    firstFrame !== null &&
    firstFrame < frameCount;
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

export interface FlaGraphicInstancePlanIdentity {
  readonly sessionId: string;
  readonly planId: string;
  readonly generation: number;
  readonly poseIdentity: string;
  readonly unitId: string;
}

export interface FlaGraphicDefinitionFrameBatch {
  readonly sourceFrameLabels?: readonly { sourceFrameIndex: number; text: string }[];
  readonly plan: FlaPartPlan;
  readonly unit: FlaPartPreviewUnit;
  readonly source: {
    readonly basename: string;
    readonly rawSha256: string;
    readonly normalizedSha256: string;
  };
  readonly target: {
    readonly renderTargetId: string;
    readonly name: string;
    readonly frameCount: number;
    readonly sourceFps: number;
    readonly stageWidth: number;
    readonly stageHeight: number;
    readonly documentWidth: number;
    readonly documentHeight: number;
  };
  readonly frames: readonly {
    readonly ordinal: number;
    readonly sourceFrameIndex: number;
    readonly svg: string;
    readonly sha256: string;
    readonly byteLength: number;
    readonly width: number;
    readonly height: number;
    readonly sourceViewport: {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    };
  }[];
  readonly groupEditPreview?: FlaGraphicGroupEditPreview;
  /** Static text requires finalized frames instead of the authored object tree. */
  readonly requiresFullFrame?: true;
  /** Source-backed authored object tree captured before SVG baking (E1). */
  readonly structure?: FlaGraphicStructure;
  /** Decoded bitmap media items referenced by the structure, ready for project commit/reuse. */
  readonly bitmaps?: readonly FlaGraphicBatchBitmap[];
  /** Main-only isolated SVG artwork, bound to opaque Shape nodes at commit. */
  readonly fallbacks?: readonly FlaGraphicBatchFallback[];
  /** Bounded same-FLA author pose references (sibling Graphics / Scene frames). */
  readonly authorPoseReferences?: readonly FlaGraphicAuthorPoseReference[];
}

export interface FlaGraphicBatchFallback {
  readonly sourceRef: string;
  readonly svg: string;
  readonly sha256: string;
  readonly byteLength: number;
  readonly width: number;
  readonly height: number;
}

export interface FlaGraphicBatchBitmap {
  readonly libraryItemName: string;
  readonly width: number;
  readonly height: number;
  readonly pngBytes: Uint8Array;
  readonly sha256: string;
}

export type FlaGraphicDefinitionFrameBatchResult =
  | { readonly ok: true; readonly batch: FlaGraphicDefinitionFrameBatch }
  | {
    readonly ok: false;
    readonly code: 'STALE_PLAN' | 'UNSUPPORTED_SOURCE' | 'RENDER_FAILED' | 'RENDER_TIMEOUT';
    readonly message: string;
  };

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

const MAX_CAPTURED_STRUCTURE_FRAMES = 16;
const MAX_AUTHOR_POSE_SIBLING_SYMBOLS = 32;
const MAX_AUTHOR_POSE_SCENE_FRAMES = 8;
const MAX_AUTHOR_POSE_NODES_PER_REF = 2_000;
const MAX_AUTHOR_POSE_REFS = 8;

function collectDisplayListProvenanceTokens(
  displayList: FlaResolvedDisplayList,
): Set<string> {
  const tokens = new Set<string>();
  const walk = (nodes: readonly FlaResolvedDisplayNode[]): void => {
    for (const node of nodes) {
      if (node.kind === 'shape') {
        tokens.add(`opaque:shape:${node.shapeId}`);
      } else if (node.kind === 'text') {
        tokens.add(`opaque:text:${node.textId}`);
      } else if (node.kind === 'bitmap') {
        tokens.add(`bitmap:${node.libraryItemName}`);
      } else if (node.opaque) {
        if (node.opaque.sourceRef) {
          tokens.add(`opaque:${node.opaque.kind}:${node.opaque.sourceRef}`);
        }
      } else if (node.symbolLibraryItemName) {
        tokens.add(`symbol:${node.symbolLibraryItemName}`);
      } else {
        walk(node.children);
      }
    }
  };
  for (const layer of displayList.layers) walk(layer.children);
  return tokens;
}

function collectDisplayNodeDescendantTokens(
  node: FlaResolvedDisplayNode,
): { readonly tokens: readonly string[]; readonly hasSourceless: boolean } {
  if (node.kind === 'bitmap') {
    return { tokens: [`bitmap:${node.libraryItemName}`], hasSourceless: false };
  }
  if (node.kind === 'shape') {
    return { tokens: [`opaque:shape:${node.shapeId}`], hasSourceless: false };
  }
  if (node.kind === 'text') {
    return { tokens: [`opaque:text:${node.textId}`], hasSourceless: false };
  }
  if (node.opaque) {
    return node.opaque.sourceRef
      ? { tokens: [`opaque:${node.opaque.kind}:${node.opaque.sourceRef}`], hasSourceless: false }
      : { tokens: [], hasSourceless: true };
  }
  if (node.symbolLibraryItemName) {
    return { tokens: [`symbol:${node.symbolLibraryItemName}`], hasSourceless: false };
  }
  const tokens: string[] = [];
  let hasSourceless = false;
  for (const child of node.children) {
    const childResult = collectDisplayNodeDescendantTokens(child);
    tokens.push(...childResult.tokens);
    if (childResult.hasSourceless) hasSourceless = true;
  }
  return { tokens: tokens.sort(), hasSourceless };
}

function extractAuthorPoseNodesFromDisplayList(
  displayList: FlaResolvedDisplayList,
  skipSelfSymbolRef?: string,
): { readonly nodes: FlaGraphicAuthorPoseNode[]; readonly matchedTokens: Set<string> } {
  const nodes: FlaGraphicAuthorPoseNode[] = [];
  const matchedTokens = new Set<string>();
  let drawOrderRank = 0;

  const visit = (
    items: readonly FlaResolvedDisplayNode[],
    ancestorSymbolChain: readonly string[],
  ): void => {
    for (const item of items) {
      if (nodes.length >= MAX_AUTHOR_POSE_NODES_PER_REF) break;
      const currentRank = drawOrderRank;
      drawOrderRank += 1;

      if (item.kind === 'shape') {
        matchedTokens.add(`opaque:shape:${item.shapeId}`);
        nodes.push({
          kind: 'opaque',
          opaqueKind: 'shape',
          ...(item.sourceAddress ? { sourceAddress: item.sourceAddress } : {}),
          sourceRef: item.shapeId,
          ancestorSymbolChain,
          authoredWorldTransform: { ...item.worldTransform },
          drawOrderRank: currentRank,
        });
        continue;
      }
      if (item.kind === 'text') {
        matchedTokens.add(`opaque:text:${item.textId}`);
        nodes.push({
          kind: 'opaque',
          opaqueKind: 'text',
          ...(item.sourceAddress ? { sourceAddress: item.sourceAddress } : {}),
          sourceRef: item.textId,
          ancestorSymbolChain,
          authoredWorldTransform: { ...item.worldTransform },
          drawOrderRank: currentRank,
        });
        continue;
      }
      if (item.kind === 'bitmap') {
        matchedTokens.add(`bitmap:${item.libraryItemName}`);
        nodes.push({
          kind: 'bitmap',
          ...(item.sourceAddress ? { sourceAddress: item.sourceAddress } : {}),
          bitmapRef: item.libraryItemName,
          ancestorSymbolChain,
          authoredWorldTransform: { ...item.worldTransform },
          drawOrderRank: currentRank,
        });
        continue;
      }
      if (item.opaque) {
        if (item.opaque.sourceRef) {
          matchedTokens.add(`opaque:${item.opaque.kind}:${item.opaque.sourceRef}`);
        }
        nodes.push({
          kind: 'opaque',
          opaqueKind: item.opaque.kind,
          ...(item.sourceAddress ? { sourceAddress: item.sourceAddress } : {}),
          ...(item.opaque.sourceRef ? { sourceRef: item.opaque.sourceRef } : {}),
          ancestorSymbolChain,
          authoredWorldTransform: { ...item.worldTransform },
          drawOrderRank: currentRank,
        });
        continue;
      }
      if (item.symbolLibraryItemName) {
        if (skipSelfSymbolRef && item.symbolLibraryItemName === skipSelfSymbolRef) {
          // Do not mistake an unmodified placed instance of the target scattered
          // symbol in Scene for an independent assembled pose.
          continue;
        }
        matchedTokens.add(`symbol:${item.symbolLibraryItemName}`);
        const nestedDefId = item.symbolInstance?.frameSelectionKey
          ? `${item.symbolLibraryItemName}::${item.symbolInstance.frameSelectionKey}`
          : item.symbolLibraryItemName;
        nodes.push({
          kind: 'symbol',
          ...(item.sourceAddress ? { sourceAddress: item.sourceAddress } : {}),
          symbolRef: item.symbolLibraryItemName,
          nestedDefinitionId: nestedDefId,
          ancestorSymbolChain,
          authoredWorldTransform: { ...item.worldTransform },
          drawOrderRank: currentRank,
        });
        if (item.children.length > 0) {
          visit(item.children, [...ancestorSymbolChain, `symbol:${item.symbolLibraryItemName}`]);
        }
        continue;
      }
      const provenance = collectDisplayNodeDescendantTokens(item);
      nodes.push({
        kind: 'group',
        ...(item.sourceAddress ? { sourceAddress: item.sourceAddress } : {}),
        groupId: item.groupId,
        ...(!provenance.hasSourceless && provenance.tokens.length > 0
          ? { descendantProvenance: provenance.tokens }
          : {}),
        ancestorSymbolChain,
        authoredWorldTransform: { ...item.worldTransform },
        drawOrderRank: currentRank,
      });
      if (item.children.length > 0) {
        visit(item.children, ancestorSymbolChain);
      }
    }
  };

  for (const layer of displayList.layers) {
    visit(layer.children, []);
  }
  return { nodes, matchedTokens };
}

function collectBoundedAuthorPoseReferencesFromSource(input: {
  readonly source: FlaStaticSnapshotDisplaySource;
  readonly targetDescriptor: FlaStaticSnapshotDisplaySource['graphicSymbols'][number];
  readonly targetDisplayList: FlaResolvedDisplayList;
  readonly shouldContinue: () => boolean;
}): FlaGraphicAuthorPoseReference[] {
  const targetSymbolName = input.targetDescriptor.sourceLibraryItemName;
  const targetTokens = collectDisplayListProvenanceTokens(input.targetDisplayList);
  if (targetTokens.size < 2) return [];

  const scored: Array<{ readonly overlap: number; readonly reference: FlaGraphicAuthorPoseReference }> = [];
  const considerDisplayList = (
    displayList: FlaResolvedDisplayList,
    origin: FlaGraphicAuthorPoseReference['origin'],
    sourceLabel: string,
    extra: { readonly referenceFrameOrdinal?: number; readonly referenceSymbolRef?: string },
  ): void => {
    const extracted = extractAuthorPoseNodesFromDisplayList(
      displayList,
      origin === 'scene-frame' ? targetSymbolName : undefined,
    );
    if (extracted.nodes.length < 2) return;
    let overlap = 0;
    for (const token of targetTokens) {
      if (extracted.matchedTokens.has(token)) overlap += 1;
    }
    if (overlap < 2) return;
    scored.push({
      overlap,
      reference: {
        origin,
        sourceLabel,
        ...(extra.referenceFrameOrdinal !== undefined ? { referenceFrameOrdinal: extra.referenceFrameOrdinal } : {}),
        ...(extra.referenceSymbolRef ? { referenceSymbolRef: extra.referenceSymbolRef } : {}),
        nodes: extracted.nodes,
      },
    });
  };

  if (input.targetDescriptor.frameCount > 1 && input.targetDescriptor.frameSpanIndex) {
    const maxTargetFrames = Math.min(
      input.targetDescriptor.frameCount,
      MAX_CAPTURED_STRUCTURE_FRAMES,
    );
    for (let ordinal = 1; ordinal < maxTargetFrames; ordinal += 1) {
      if (!input.shouldContinue()) break;
      const frameContextResult = input.source.buildGraphicFrameContext(
        input.targetDescriptor.timelineXml,
        input.targetDescriptor.frameSpanIndex,
        ordinal,
        `graphic:${targetSymbolName}`,
      );
      if (!frameContextResult.ok) break;
      const resolvedExtra = resolveFlaDisplayList({
        root: {
          kind: 'graphic',
          name: targetSymbolName,
          frameContext: frameContextResult.value,
        },
        symbols: input.source.symbols,
      }, { tolerant: true });
      if (!resolvedExtra.ok) break;
      considerDisplayList(
        resolvedExtra.displayList,
        'definition-frame',
        `${input.targetDescriptor.userLabel || targetSymbolName} 第 ${ordinal + 1} 帧`,
        {
          referenceFrameOrdinal: ordinal,
          referenceSymbolRef: targetSymbolName,
        },
      );
    }
  }

  let siblingChecks = 0;
  for (const candidate of input.source.graphicSymbols) {
    if (siblingChecks >= MAX_AUTHOR_POSE_SIBLING_SYMBOLS || !input.shouldContinue()) break;
    if (candidate.sourceLibraryItemName === targetSymbolName) continue;
    siblingChecks += 1;
    input.source.resetFrameBuildState();
    const resolved = resolveFlaDisplayList({
      root: {
        kind: 'graphic',
        name: candidate.sourceLibraryItemName,
        frameContext: candidate.frameContext,
      },
      symbols: input.source.symbols,
    }, { tolerant: true });
    if (resolved.ok) {
      considerDisplayList(
        resolved.displayList,
        'sibling-graphic',
        candidate.userLabel || candidate.sourceLibraryItemName,
        {
          referenceFrameOrdinal: 0,
          referenceSymbolRef: candidate.sourceLibraryItemName,
        },
      );
    }
  }

  const scene0 = input.source.sceneTimelines[0];
  if (scene0 && input.shouldContinue()) {
    const maxSceneFrames = Math.min(scene0.frameCount, MAX_AUTHOR_POSE_SCENE_FRAMES);
    for (let frameIdx = 0; frameIdx < maxSceneFrames; frameIdx += 1) {
      if (!input.shouldContinue()) break;
      const frameContextResult =
        frameIdx === 0
          ? { ok: true as const, value: scene0.frameContext }
          : input.source.buildSceneFrameContext(scene0.xml, frameIdx, `scene:${scene0.index}`);
      if (!frameContextResult.ok) break;
      const resolvedScene = resolveFlaDisplayList({
        root: {
          kind: 'scene',
          name: scene0.name,
          frameContext: frameContextResult.value,
        },
        symbols: input.source.symbols,
      }, { tolerant: true });
      if (resolvedScene.ok) {
        considerDisplayList(
          resolvedScene.displayList,
          'scene-frame',
          `${scene0.name} 第 ${frameIdx + 1} 帧`,
          { referenceFrameOrdinal: frameIdx },
        );
      }
    }
  }

  scored.sort((left, right) => right.overlap - left.overlap);
  return scored.slice(0, MAX_AUTHOR_POSE_REFS).map((entry) => entry.reference);
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

  /**
   * Build the trusted vector frames for one source-addressed Graphic instance.
   * The preview plan remains the authority for the selected Scene0/F1
   * occurrence; child Graphic contents are flattened into SVG frame assets.
   */
  async buildGraphicDefinitionFrameBatch(
    identity: FlaGraphicInstancePlanIdentity,
  ): Promise<FlaGraphicDefinitionFrameBatchResult> {
    const held = this.getValidHeldResult();
    if (
      !held ||
      held.plan.planId !== identity.planId ||
      held.plan.sessionId !== identity.sessionId ||
      held.plan.generation !== identity.generation ||
      held.plan.poseIdentity !== identity.poseIdentity ||
      (held.plan.capability !== 'GRAPHIC_INSTANCES_READY' && held.plan.capability !== 'EDITABLE_PARTS_READY')
    ) {
      return { ok: false, code: 'STALE_PLAN', message: 'The FLA Part plan expired or changed. Preview the source again.' };
    }
    const plan = held.plan;
    if (
      plan.target.kind !== 'scene' ||
      plan.target.sceneIndex !== 0 ||
      plan.target.selectedFrameIndex !== 0
    ) {
      return { ok: false, code: 'UNSUPPORTED_SOURCE', message: 'Only Scene 0, frame 1 instances are supported for this import.' };
    }
    const unit = plan.units.find((candidate) => candidate.unitId === identity.unitId);
    if (!unit || !canImportGraphicInstance(unit)) {
      return { ok: false, code: 'UNSUPPORTED_SOURCE', message: 'This object has no safe source-addressed Graphic instance import path.' };
    }
    const session = this.flaImportService.getSession(identity.sessionId);
    const source = toSnapshotSource(session);
    if (!session || !source) {
      return { ok: false, code: 'STALE_PLAN', message: 'The FLA inspection session expired. Inspect the source again.' };
    }
    const startedAt = Date.now();
    const execution: FlaStaticSnapshotDisplaySourceExecution = {
      shouldContinue: () => {
        const current = this.getValidHeldResult();
        return !this.closed &&
          Date.now() - startedAt < FLA_PART_PREVIEW_LIMITS.maxBatchWallTimeMs &&
          current?.plan.planId === plan.planId &&
          this.flaImportService.getSession(identity.sessionId)?.sourceBytes === source.bytes;
      },
      yieldToEventLoop: () => new Promise<void>((resolve) => setImmediate(resolve)),
    };
    const prepared = await this.renderSession.prepareDisplaySourceForPartPreview(identity.sessionId, execution);
    if (!prepared.ok) {
      return {
        ok: false,
        code: prepared.code === 'BUDGET_EXCEEDED' ? 'RENDER_TIMEOUT' : 'STALE_PLAN',
        message: prepared.message,
      };
    }
    if (!execution.shouldContinue()) {
      return { ok: false, code: 'RENDER_TIMEOUT', message: 'Graphic frame rendering exceeded its bounded time.' };
    }
    const sourceName = unit.sourceSymbolId!;
    const descriptors = prepared.source.graphicSymbols.filter(
      (candidate) => candidate.sourceLibraryItemName === sourceName,
    );
    const descriptor = descriptors.length === 1 ? descriptors[0] : null;
    const frameCount = descriptor?.frameCount ?? 0;
    const sourceFps = session.ir.document.frameRate;
    if (
      !descriptor ||
      frameCount !== unit.sourceDefinitionFrameCount ||
      frameCount > FLA_GRAPHIC_MAX_FRAMES ||
      !Number.isFinite(sourceFps) ||
      sourceFps <= 0 ||
      sourceFps > 1_000
    ) {
      return { ok: false, code: 'UNSUPPORTED_SOURCE', message: 'The Graphic Definition frame count or source frame rate is not verified.' };
    }
    const renderTargetId = stableRenderTargetId(
      source.bytes,
      `graphic-symbol\u0000${descriptor.sourceLibraryItemName}\u0000${descriptor.userLabel}`,
    );
    const media = source.loadMedia ? await source.loadMedia() : source.media;
    const mediaLookup = createFlaStaticSnapshotBitmapMediaLookup(media ?? []);
    const frames: FlaGraphicDefinitionFrameBatch['frames'][number][] = [];
    const labels = new Map<number, string>();
    for (const layer of descriptor.frameSpanIndex?.layers ?? []) {
      for (const span of layer.spans) {
        const label = readFlaSourceFrameLabel(span.sourceFrame.attributes);
        if (label?.type === 'name' && !labels.has(span.index)) labels.set(span.index, label.text);
      }
    }
    let totalBytes = 0;
    let requiresFullFrame = false;
    let anyFrameHasPartialFidelityFeatures = false;
    for (let ordinal = 0; ordinal < frameCount; ordinal += 1) {
      if (!execution.shouldContinue()) {
        const timedOut = Date.now() - startedAt >= FLA_PART_PREVIEW_LIMITS.maxBatchWallTimeMs;
        return {
          ok: false,
          code: timedOut ? 'RENDER_TIMEOUT' : 'STALE_PLAN',
          message: timedOut ? 'Graphic frame rendering exceeded its bounded time.' : 'The FLA Part plan changed during frame rendering.',
        };
      }
      const target: FlaRenderTarget = {
        renderTargetId,
        kind: 'graphic-symbol',
        userLabel: descriptor.userLabel,
        sourceLibraryItemName: descriptor.sourceLibraryItemName,
        frameCount,
        selectedFrameIndex: ordinal,
        compatibility: ['degraded'],
      };
      const rendered = await buildSvgForRenderTarget(
        source.bytes,
        target,
        mediaLookup,
        prepared.source,
      );
      if (!rendered.ok) {
        return { ok: false, code: 'RENDER_FAILED', message: `Graphic frame ${ordinal} could not be rendered: ${rendered.message}`.slice(0, 1_000) };
      }
      let finalSvg = rendered.svg;
      let finalWidth = rendered.width;
      let finalHeight = rendered.height;
      let viewport = rendered.composition.framing.viewBox;
      if (rendered.hasInstanceFilters || rendered.hasPerChannelColorTransform || rendered.staticTexts?.length) {
        anyFrameHasPartialFidelityFeatures = true;
      }
      if (rendered.staticTexts?.length) {
        let resolvedRaster: FlaStaticSnapshotRasterizeOutput;
        try {
          resolvedRaster = await this.rasterizer.rasterize({
            requestId: crypto.randomUUID(),
            svg: rendered.svg,
            width: rendered.width,
            height: rendered.height,
            pixelCount: rendered.pixelCount,
            staticTexts: rendered.staticTexts,
            ...(rendered.graphicFraming ? { graphicFraming: rendered.graphicFraming } : {}),
            returnResolvedSvg: true,
          });
        } catch (error) {
          return {
            ok: false,
            code: 'RENDER_FAILED',
            message: `Graphic frame ${ordinal} static text rasterization failed: ${error instanceof Error ? error.message : String(error)}`.slice(0, 1_000),
          };
        }
        if (!resolvedRaster.resolvedSvg || hasUnresolvedFlaStaticTextPlaceholder(resolvedRaster.resolvedSvg)) {
          return {
            ok: false,
            code: 'RENDER_FAILED',
            message: `Graphic frame ${ordinal} static text could not be resolved into a finalized asset. Use PNG snapshot or frame-sequence import instead.`,
          };
        }
        finalSvg = resolvedRaster.resolvedSvg;
        finalWidth = resolvedRaster.width;
        finalHeight = resolvedRaster.height;
        if (resolvedRaster.sourceViewport) {
          viewport = resolvedRaster.sourceViewport;
        }
      }
      const svgBytes = Buffer.from(finalSvg, 'utf8');
      totalBytes += svgBytes.byteLength;
      if (
        svgBytes.byteLength <= 0 ||
        totalBytes > FLA_STATIC_SNAPSHOT_LIMITS.maxSnapshotBytes ||
        !Number.isSafeInteger(finalWidth) ||
        !Number.isSafeInteger(finalHeight) ||
        finalWidth <= 0 ||
        finalHeight <= 0 ||
        !Number.isFinite(viewport.x) ||
        !Number.isFinite(viewport.y) ||
        !Number.isFinite(viewport.width) ||
        viewport.width <= 0 ||
        !Number.isFinite(viewport.height) ||
        viewport.height <= 0
      ) {
        return { ok: false, code: 'RENDER_FAILED', message: `Graphic frame ${ordinal} exceeded the bounded SVG asset dimensions or bytes.` };
      }
      frames.push({
        ordinal,
        sourceFrameIndex: ordinal,
        svg: finalSvg,
        sha256: crypto.createHash('sha256').update(svgBytes).digest('hex'),
        byteLength: svgBytes.byteLength,
        width: finalWidth,
        height: finalHeight,
        sourceViewport: { ...viewport },
      });
      await execution.yieldToEventLoop();
    }
    let groupEditPreview: FlaGraphicGroupEditPreview | undefined;
    const firstFrame = frames[0];
    let structure: FlaGraphicStructure | undefined;
    let authorPoseReferences: FlaGraphicAuthorPoseReference[] = [];
    const isolatedFallbacks = new Map<string, FlaGraphicBatchFallback>();
    // S02-A / S02-B: Capture structure with isolated subtree fallbacks for static
    // and dynamic text, instance filters, per-channel color transforms, and layer
    // filters so healthy sibling parts remain editable across source time. Fall
    // back cleanly to requiresFullFrame when any complex subtree cannot be safely
    // isolated.
    if (firstFrame && unit.sourceAddress) {
      const resolveFrameForStructure = (ordinal: number): {
        readonly displayList: FlaResolvedDisplayList;
        readonly shapeBlocks: ReadonlyMap<string, string>;
        readonly staticTextBlocks: ReadonlyMap<string, FlaStaticTextDescriptor>;
      } | null => {
        if (ordinal === 0) {
          prepared.source.resetFrameBuildState();
        }
        const frameContextResult = ordinal === 0
          ? { ok: true as const, value: descriptor.frameContext }
          : prepared.source.buildGraphicFrameContext(
              descriptor.timelineXml,
              descriptor.frameSpanIndex,
              ordinal,
              `graphic:${descriptor.sourceLibraryItemName}`,
            );
        if (!frameContextResult.ok) return null;
        const frameShapeBlocks = new Map(prepared.source.shapeBlocks);
        const frameStaticTextBlocks = new Map<string, FlaStaticTextDescriptor>(
          prepared.source.staticTextBlocks ?? [],
        );
        const shapeBlockLimit = DEFAULT_FLA_DISPLAY_LIST_RESOLVER_LIMITS.maxResolvedNodeCount;
        let blockBudgetExceeded = false;
        const captureBlocks = (elements: readonly FlaDisplayListElement[]): string | null => {
          for (const element of elements) {
            if (element.visible === false) continue;
            if (element.kind === 'shape') {
              if (frameShapeBlocks.has(element.shapeId)) continue;
              const xml = prepared.source.shapeBlocks.get(element.shapeId);
              if (xml === undefined) return `Missing shape block: ${element.shapeId}`;
              if (frameShapeBlocks.size >= shapeBlockLimit) {
                blockBudgetExceeded = true;
                return 'Nested shape block budget exceeded';
              }
              frameShapeBlocks.set(element.shapeId, xml);
            } else if (element.kind === 'text') {
              if (frameStaticTextBlocks.has(element.textId)) continue;
              const textDesc = prepared.source.staticTextBlocks?.get(element.textId);
              if (textDesc === undefined) return `Missing text block: ${element.textId}`;
              if (frameStaticTextBlocks.size >= FLA_STATIC_TEXT_LIMITS.maxTextNodesPerComposition * 4) {
                blockBudgetExceeded = true;
                return 'Nested text block budget exceeded';
              }
              frameStaticTextBlocks.set(element.textId, textDesc);
            } else if (element.kind === 'group') {
              const nestedError = captureBlocks(element.elements);
              if (nestedError) return nestedError;
            }
          }
          return null;
        };
        const selectionSource: FlaStaticSnapshotDisplaySource = {
          ...prepared.source,
          buildGraphicFrameContext: (timelineXml, frameSpanIndex, frameIndex, scope) => {
            const ctx = prepared.source.buildGraphicFrameContext(
              timelineXml,
              frameSpanIndex,
              frameIndex,
              scope,
            );
            if (!ctx.ok) return ctx;
            for (const layer of ctx.value.layers) {
              if (!layer.visible && !layer.maskLayerId) continue;
              const captureError = captureBlocks(layer.elements);
              if (captureError) {
                return {
                  ok: false,
                  code: blockBudgetExceeded ? 'BUDGET_EXCEEDED' : 'RENDER_FAILED',
                  message: captureError,
                };
              }
            }
            return ctx;
          },
        };
        const root = {
          kind: 'graphic' as const,
          name: descriptor.sourceLibraryItemName,
          frameContext: frameContextResult.value,
        };
        const nested = prepareFlaNestedGraphicFrameSelections(selectionSource, root);
        if (blockBudgetExceeded) return null;
        const resolved = nested.ok
          ? resolveFlaDisplayList(nested.resolverInput, { tolerant: true })
          : ordinal === 0 && !anyFrameHasPartialFidelityFeatures
            ? resolveFlaDisplayList({ root, symbols: prepared.source.symbols }, { tolerant: true })
            : null;
        if (!resolved || !resolved.ok) return null;
        return {
          displayList: resolved.displayList,
          shapeBlocks: frameShapeBlocks,
          staticTextBlocks: frameStaticTextBlocks,
        };
      };

      const frame0Resolved = resolveFrameForStructure(0);
      if (frame0Resolved) {
        const frame0HasFilteredLayer = frame0Resolved.displayList.layers.some((layer) => Boolean(layer.frameFilter));
        const shouldCaptureAllFrames =
          frameCount > 1 &&
          frameCount <= 256 &&
          (anyFrameHasPartialFidelityFeatures || frame0HasFilteredLayer);
        const capturedFrames: Array<{
          readonly ordinal: number;
          readonly displayList: FlaResolvedDisplayList;
          readonly shapeBlocks: ReadonlyMap<string, string>;
          readonly staticTextBlocks: ReadonlyMap<string, FlaStaticTextDescriptor>;
        }> = [{ ordinal: 0, ...frame0Resolved }];
        let partialIsolationFailed = false;
        let hasFilteredLayer = frame0HasFilteredLayer;

        if (shouldCaptureAllFrames) {
          for (let ordinal = 1; ordinal < frameCount; ordinal += 1) {
            if (!execution.shouldContinue()) {
              partialIsolationFailed = true;
              break;
            }
            const resolvedFrame = resolveFrameForStructure(ordinal);
            if (!resolvedFrame) {
              partialIsolationFailed = true;
              break;
            }
            if (resolvedFrame.displayList.layers.some((layer) => Boolean(layer.frameFilter))) {
              hasFilteredLayer = true;
            }
            capturedFrames.push({ ordinal, ...resolvedFrame });
          }
        }

        const isolatedSubtreeByNode = new Map<FlaResolvedDisplayNode, IsolatedSubtreeCaptureResult>();
        const isolatedLayerByRef = new Map<FlaResolvedDisplayLayer, IsolatedFilteredLayerCaptureResult>();
        const shapeBlocksByNode = new Map<FlaResolvedDisplayNode, ReadonlyMap<string, string>>();
        const allShapeBlocks = new Map<string, string>();

        const renderAndRegisterIsolatedSubtree = async (
          displayList: FlaResolvedDisplayList,
          opaqueKind: 'text' | 'filter' | 'symbol',
          renderTargetKey: string,
          reason: string,
          frameShapeBlocks: ReadonlyMap<string, string>,
          frameStaticTextBlocks: ReadonlyMap<string, FlaStaticTextDescriptor>,
        ): Promise<IsolatedSubtreeCaptureResult | null> => {
          if (!execution.shouldContinue()) return null;
          const renderedSubtree = buildSvgForResolvedDisplayList({
            displayList,
            renderTargetId: stableRenderTargetId(source.bytes, renderTargetKey),
            stageWidth: prepared.source.stageWidth,
            stageHeight: prepared.source.stageHeight,
            shapeBlocks: frameShapeBlocks,
            staticTextBlocks: frameStaticTextBlocks,
            resolveBitmapMedia: mediaLookup,
          });
          if (!renderedSubtree.ok) return null;
          let finalSvg = renderedSubtree.svg;
          let finalWidth = renderedSubtree.width;
          let finalHeight = renderedSubtree.height;
          let viewBox = renderedSubtree.composition.framing.viewBox;
          if (renderedSubtree.staticTexts?.length) {
            let resolvedRaster: FlaStaticSnapshotRasterizeOutput;
            try {
              resolvedRaster = await this.rasterizer.rasterize({
                requestId: crypto.randomUUID(),
                svg: renderedSubtree.svg,
                width: renderedSubtree.width,
                height: renderedSubtree.height,
                pixelCount: renderedSubtree.pixelCount,
                staticTexts: renderedSubtree.staticTexts,
                ...(renderedSubtree.graphicFraming ? { graphicFraming: renderedSubtree.graphicFraming } : {}),
                returnResolvedSvg: true,
              });
            } catch {
              return null;
            }
            if (!resolvedRaster.resolvedSvg || hasUnresolvedFlaStaticTextPlaceholder(resolvedRaster.resolvedSvg)) {
              return null;
            }
            finalSvg = resolvedRaster.resolvedSvg;
            finalWidth = resolvedRaster.width;
            finalHeight = resolvedRaster.height;
            if (resolvedRaster.sourceViewport) {
              viewBox = resolvedRaster.sourceViewport;
            }
          }
          if (
            !Number.isSafeInteger(finalWidth) ||
            !Number.isSafeInteger(finalHeight) ||
            finalWidth <= 0 ||
            finalHeight <= 0 ||
            !Number.isFinite(viewBox.x) ||
            !Number.isFinite(viewBox.y) ||
            !Number.isFinite(viewBox.width) ||
            viewBox.width <= 0 ||
            !Number.isFinite(viewBox.height) ||
            viewBox.height <= 0
          ) {
            return null;
          }
          const bytes = Buffer.from(finalSvg, 'utf8');
          const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
          const sourceRef = `subtree:${opaqueKind}:${sha256.slice(0, 16)}`;
          if (!isolatedFallbacks.has(sourceRef)) {
            if (
              bytes.byteLength <= 0 ||
              bytes.byteLength > FLA_STATIC_SNAPSHOT_LIMITS.maxSnapshotBytes ||
              totalBytes + bytes.byteLength > FLA_STATIC_SNAPSHOT_LIMITS.maxSnapshotBytes
            ) {
              return null;
            }
            totalBytes += bytes.byteLength;
            isolatedFallbacks.set(sourceRef, {
              sourceRef,
              svg: finalSvg,
              sha256,
              byteLength: bytes.byteLength,
              width: finalWidth,
              height: finalHeight,
            });
          }
          return {
            scope: 'subtree',
            viewBox: { ...viewBox },
            sourceRef,
            reason,
          };
        };

        const isolateSubtreesInNodes = async (
          nodes: readonly FlaResolvedDisplayNode[],
          pathPrefix: string,
          frameShapeBlocks: ReadonlyMap<string, string>,
          frameStaticTextBlocks: ReadonlyMap<string, FlaStaticTextDescriptor>,
        ): Promise<void> => {
          for (let index = 0; index < nodes.length; index += 1) {
            if (partialIsolationFailed) return;
            const node = nodes[index]!;
            const nodeKey = `${pathPrefix}/${index}:${node.sourceAddress ?? node.kind}`;
            if (node.kind === 'shape') {
              shapeBlocksByNode.set(node, frameShapeBlocks);
              continue;
            }
            if (node.kind === 'text') {
              const textDescriptor = frameStaticTextBlocks.get(node.textId);
              if (!textDescriptor) {
                partialIsolationFailed = true;
                return;
              }
              const canonicalTextNode = { ...node, textId: 'isolated-text' };
              const artworkTransform = isolatedEffectTransform(node);
              const isolatedDisplayList = buildIsolatedDisplayListForNode(canonicalTextNode, 'text', artworkTransform);
              if (!isolatedDisplayList) {
                partialIsolationFailed = true;
                return;
              }
              const result = await renderAndRegisterIsolatedSubtree(
                isolatedDisplayList,
                'text',
                'isolated-subtree\u0000text',
                'Static text uses isolated subtree fallback',
                frameShapeBlocks,
                new Map([['isolated-text', textDescriptor]]),
              );
              if (!result) {
                partialIsolationFailed = true;
                return;
              }
              isolatedSubtreeByNode.set(node, { ...result, artworkTransform });
              continue;
            }
            if (node.kind === 'group' && !node.opaque) {
              const hasEnabledInstanceFilters = Boolean(node.instanceFilters?.some((filter) => filter.enabled));
              const hasPerChannelRgbTransform = node.rgbTransform?.channelOffsets !== undefined;
              if (hasEnabledInstanceFilters || hasPerChannelRgbTransform) {
                const opaqueKind = hasEnabledInstanceFilters ? 'filter' : 'symbol';
                const artworkTransform = isolatedEffectTransform(node);
                const isolatedDisplayList = buildIsolatedDisplayListForNode(
                  node,
                  opaqueKind,
                  artworkTransform,
                );
                if (!isolatedDisplayList) {
                  partialIsolationFailed = true;
                  return;
                }
                const result = await renderAndRegisterIsolatedSubtree(
                  isolatedDisplayList,
                  opaqueKind,
                  `isolated-subtree\u0000${opaqueKind}`,
                  hasEnabledInstanceFilters
                    ? 'Instance filter subtree uses isolated fallback'
                    : 'Per-channel color transform subtree uses isolated fallback',
                  frameShapeBlocks,
                  frameStaticTextBlocks,
                );
                if (!result) {
                  partialIsolationFailed = true;
                  return;
                }
                isolatedSubtreeByNode.set(node, { ...result, artworkTransform });
                continue;
              }
              await isolateSubtreesInNodes(
                node.children,
                nodeKey,
                frameShapeBlocks,
                frameStaticTextBlocks,
              );
            }
          }
        };

        for (const capturedFrame of capturedFrames) {
          if (partialIsolationFailed) break;
          for (const [shapeId, xml] of capturedFrame.shapeBlocks) {
            if (!allShapeBlocks.has(shapeId)) allShapeBlocks.set(shapeId, xml);
          }
          for (let layerIndex = 0; layerIndex < capturedFrame.displayList.layers.length; layerIndex += 1) {
            if (partialIsolationFailed) break;
            const resolvedLayer = capturedFrame.displayList.layers[layerIndex]!;
            if (resolvedLayer.frameFilter) {
              hasFilteredLayer = true;
              if (resolvedLayer.children.length === 0) continue;
              if (hasAnyClipPathsInNodes(resolvedLayer.children)) {
                partialIsolationFailed = true;
                break;
              }
              const layerDisplayList: FlaResolvedDisplayList = {
                kind: 'graphic',
                sourceName: 'layer-filter',
                frameIndex: 0,
                resolvedNodeCount: countResolvedDisplayNodes(resolvedLayer.children),
                layers: [resolvedLayer],
              };
              const result = await renderAndRegisterIsolatedSubtree(
                layerDisplayList,
                'filter',
                'isolated-subtree\u0000layer-filter',
                'Layer filter uses isolated subtree fallback',
                capturedFrame.shapeBlocks,
                capturedFrame.staticTextBlocks,
              );
              if (!result) {
                partialIsolationFailed = true;
                break;
              }
              isolatedLayerByRef.set(resolvedLayer, result);
              continue;
            }
            await isolateSubtreesInNodes(
              resolvedLayer.children,
              `frame[${capturedFrame.ordinal}]/layer[${layerIndex}]`,
              capturedFrame.shapeBlocks,
              capturedFrame.staticTextBlocks,
            );
          }
        }

        if (!partialIsolationFailed) {
          // E1: capture the authored tree from the resolved source, before SVG baking.
          // Compute tight subtree bounds for shapes; unsafe opaque nodes remain without fake fallback.
          const resolveSubtreeBounds = (node: FlaResolvedDisplayNode): SubtreeBounds | undefined => {
            if (node.kind === 'shape') {
              const nodeShapeBlocks = shapeBlocksByNode.get(node) ?? allShapeBlocks;
              const shapeBlock = nodeShapeBlocks.get(node.shapeId);
              if (!shapeBlock) return undefined;
              const shapeDisplayList: FlaResolvedDisplayList = {
                kind: 'graphic',
                sourceName: node.shapeId,
                frameIndex: 0,
                resolvedNodeCount: 1,
                layers: [{ name: 'shape', children: [node] }],
              };
              const rendered = buildSvgForResolvedDisplayList({
                displayList: shapeDisplayList,
                renderTargetId: stableRenderTargetId(
                  source.bytes,
                  `shape-crop\u0000${node.shapeId}\u0000${node.sourceAddress ?? ''}`,
                ),
                stageWidth: prepared.source.stageWidth,
                stageHeight: prepared.source.stageHeight,
                shapeBlocks: nodeShapeBlocks,
                resolveBitmapMedia: mediaLookup,
              });
              if (rendered.ok && rendered.composition.framing.viewBox) {
                const vb = rendered.composition.framing.viewBox;
                if (Number.isFinite(vb.x) && Number.isFinite(vb.y) && vb.width > 0 && vb.height > 0) {
                  return {
                    scope: 'frame-crop',
                    viewBox: { x: vb.x, y: vb.y, width: vb.width, height: vb.height },
                  };
                }
              }
            }
            return undefined;
          };

          const clipPathShapeIds = new Map<string, number>();
          const addClipPathShapeIds = (
            clipPaths: readonly FlaResolvedClipPath[] | undefined,
            frameIndex: number,
          ): void => {
            for (const clipPath of clipPaths ?? []) {
              for (const shape of clipPath.shapes) {
                if (!clipPathShapeIds.has(shape.shapeId)) {
                  clipPathShapeIds.set(shape.shapeId, frameIndex);
                }
              }
            }
          };
          const collectClipShapeIds = (
            nodes: readonly FlaResolvedDisplayNode[],
            frameIndex: number,
          ): void => {
            for (const node of nodes) {
              if (node.kind === 'group') {
                addClipPathShapeIds(node.instanceFilterClips, frameIndex);
                addClipPathShapeIds(node.inheritedClipPaths, frameIndex);
                collectClipShapeIds(node.children, frameIndex);
              } else {
                addClipPathShapeIds(node.clipPaths, frameIndex);
              }
            }
          };
          for (const capturedFrame of capturedFrames) {
            for (const resolvedLayer of capturedFrame.displayList.layers) {
              collectClipShapeIds(resolvedLayer.children, capturedFrame.displayList.frameIndex);
            }
          }
          const clipPathShapePathData = new Map<string, readonly string[]>();
          for (const [shapeId, clipFrameIndex] of clipPathShapeIds) {
            const shapeBlock = allShapeBlocks.get(shapeId);
            if (!shapeBlock) continue;
            const pathData = extractFlaGraphicMaskPathData({
              shapeBlock,
              shapeId,
              renderTargetId,
              frameIndex: clipFrameIndex,
            });
            if (pathData?.length) clipPathShapePathData.set(shapeId, pathData);
          }

          structure = captureFlaGraphicStructureFrames(
            capturedFrames.map((capturedFrame) => capturedFrame.displayList),
            {
              resolveSubtreeBounds,
              resolveIsolatedShape: (node) => {
                // Render this Shape alone in its own authored local space. Parent
                // masks remain in the structural evaluator, rather than baking
                // sibling occlusion or a world-space pose into the reusable part.
                const nodeShapeBlocks = shapeBlocksByNode.get(node) ?? allShapeBlocks;
                const rendered = buildSvgForResolvedDisplayList({
                  displayList: {
                    kind: 'graphic', sourceName: node.shapeId, frameIndex: 0, resolvedNodeCount: 1,
                    layers: [{ name: 'shape', children: [{ ...node,
                      localTransform: FLA_DISPLAY_LIST_IDENTITY_MATRIX,
                      worldTransform: FLA_DISPLAY_LIST_IDENTITY_MATRIX, clipPaths: undefined,
                    }] }],
                  },
                  renderTargetId: stableRenderTargetId(source.bytes, `isolated-shape\u0000${node.shapeId}`),
                  stageWidth: prepared.source.stageWidth, stageHeight: prepared.source.stageHeight,
                  shapeBlocks: nodeShapeBlocks, resolveBitmapMedia: mediaLookup,
                });
                if (!rendered.ok) return undefined;
                const bytes = Buffer.from(rendered.svg, 'utf8');
                if (!isolatedFallbacks.has(node.shapeId) &&
                    (bytes.byteLength > FLA_STATIC_SNAPSHOT_LIMITS.maxSnapshotBytes ||
                     totalBytes + bytes.byteLength > FLA_STATIC_SNAPSHOT_LIMITS.maxSnapshotBytes)) return undefined;
                if (!isolatedFallbacks.has(node.shapeId)) {
                  totalBytes += bytes.byteLength;
                  isolatedFallbacks.set(node.shapeId, { sourceRef: node.shapeId, svg: rendered.svg,
                    sha256: crypto.createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.byteLength,
                    width: rendered.width, height: rendered.height,
                  });
                }
                return { scope: 'subtree', viewBox: { ...rendered.composition.framing.viewBox } };
              },
              resolveIsolatedSubtree: (node) => isolatedSubtreeByNode.get(node),
              resolveIsolatedFilteredLayer: (layer) => isolatedLayerByRef.get(layer),
              sourceBasename: source.basename,
              clipPathShapePathData,
            },
          );
        }

        if ((anyFrameHasPartialFidelityFeatures || hasFilteredLayer) && (partialIsolationFailed || !structure)) {
          requiresFullFrame = true;
          structure = undefined;
          isolatedFallbacks.clear();
        } else if (structure) {
          authorPoseReferences = collectBoundedAuthorPoseReferencesFromSource({
            source: prepared.source,
            targetDescriptor: descriptor,
            targetDisplayList: frame0Resolved.displayList,
            shouldContinue: execution.shouldContinue,
          });
        }
      } else if (anyFrameHasPartialFidelityFeatures) {
        requiresFullFrame = true;
      }
      prepared.source.resetFrameBuildState();
      if (frameCount === 1 && !requiresFullFrame && !anyFrameHasPartialFidelityFeatures) {
        const resolvedForPreview = resolveFlaDisplayList({
          root: {
            kind: 'graphic',
            name: descriptor.sourceLibraryItemName,
            frameContext: descriptor.frameContext,
          },
          symbols: prepared.source.symbols,
        });
        if (resolvedForPreview.ok) {
          groupEditPreview = buildGroupEditPreview({
            displayList: resolvedForPreview.displayList,
            sourceBytes: source.bytes,
            sourceSha256: source.sha256,
            outerOccurrenceId: unit.occurrenceId,
            outerSourceAddress: unit.sourceAddress,
            graphicSymbolName: descriptor.sourceLibraryItemName,
            frameOrigin: { x: firstFrame.sourceViewport.x, y: firstFrame.sourceViewport.y },
            frameCanvas: { width: firstFrame.sourceViewport.width, height: firstFrame.sourceViewport.height },
            shapeBlocks: prepared.source.shapeBlocks,
            resolveBitmapMedia: mediaLookup,
            stageWidth: prepared.source.stageWidth,
            stageHeight: prepared.source.stageHeight,
            renderTargetId,
          });
        }
      }
    }
    const batchBitmaps: FlaGraphicBatchBitmap[] = [];
    if (structure) {
      const referencedBitmapNames = new Set<string>();
      const walk = (nodes: readonly FlaGraphicStructureNode[]): void => {
        for (const node of nodes) {
          if (node.type === 'bitmap') referencedBitmapNames.add(node.bitmapRef);
          else if (node.type === 'group') walk(node.children);
          else if (node.type === 'symbol' && node.children) walk(node.children);
        }
      };
      for (const def of Object.values(structure.symbolDefinitions ?? {})) {
        walk(def.children);
      }
      for (const frame of structure.frames) {
        for (const layer of frame.layers) {
          walk(layer.nodes);
        }
      }
      for (const name of referencedBitmapNames) {
        const lookup = mediaLookup(name);
        if (lookup.ok) {
          const bytes = lookup.media.pngBytes;
          if (!bytes) continue;
          const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
          batchBitmaps.push({
            libraryItemName: name,
            width: lookup.media.width,
            height: lookup.media.height,
            pngBytes: bytes,
            sha256,
          });
        }
      }
    }

    return {
      ok: true,
      batch: {
        plan: structuredClone(plan),
        unit: structuredClone(unit),
        source: {
          basename: source.basename,
          rawSha256: source.originalSourceSha256 ?? source.sha256,
          normalizedSha256: source.sha256,
        },
        target: {
          renderTargetId,
          name: descriptor.userLabel,
          frameCount,
          sourceFps,
          stageWidth: prepared.source.stageWidth,
          stageHeight: prepared.source.stageHeight,
          documentWidth: session.ir.document.width > 0 ? session.ir.document.width : prepared.source.stageWidth,
          documentHeight: session.ir.document.height > 0 ? session.ir.document.height : prepared.source.stageHeight,
        },
        frames,
        ...(labels.size ? { sourceFrameLabels: [...labels].map(([sourceFrameIndex, text]) => ({ sourceFrameIndex, text })) } : {}),
        ...(groupEditPreview ? { groupEditPreview } : {}),
        ...(requiresFullFrame ? { requiresFullFrame: true } : {}),
        ...(structure ? { structure } : {}),
        ...(batchBitmaps.length ? { bitmaps: batchBitmaps } : {}),
        ...(isolatedFallbacks.size ? { fallbacks: [...isolatedFallbacks.values()] } : {}),
        ...(authorPoseReferences.length ? { authorPoseReferences } : {}),
      },
    };
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
    if (active.request.purpose === 'graphic-instance' && (sceneMatch?.index !== 0 || selectedFrameIndex !== 0)) {
      return this.failure('TARGET_NOT_FOUND', 'Graphic instance import requires Scene 0, frame 1.', active.request);
    }
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
    const sceneFrameContext = frameResult.value;
    if (sceneFrameContext.unsupportedDisplayReason) {
      return this.failure('UNSUPPORTED_SOURCE', sceneFrameContext.unsupportedDisplayReason, active.request);
    }
    if (!this.ensureCurrentAndWithinBudget(active)) {
      return this.failure(active.cancelCode ?? 'RENDER_CANCELLED', 'Preview is stale or cancelled', active.request);
    }

    // Nested Graphic selection builds frame-specific Shape blocks through the
    // adapter's mutable frame map. Retain only the base blocks plus blocks
    // referenced by each selected child context, under the resolver node cap.
    const shapeBlocks = new Map(prepared.source.shapeBlocks);
    const staticTextBlocks = new Map<string, FlaStaticTextDescriptor>(prepared.source.staticTextBlocks ?? []);
    const shapeBlockLimit = DEFAULT_FLA_DISPLAY_LIST_RESOLVER_LIMITS.maxResolvedNodeCount;
    let shapeBlockBudgetExceeded = false;
    const captureShapeBlocks = (elements: readonly FlaDisplayListElement[]): string | null => {
      for (const element of elements) {
        if (element.visible === false) continue;
        if (element.kind === 'shape') {
          if (shapeBlocks.has(element.shapeId)) continue;
          const xml = prepared.source.shapeBlocks.get(element.shapeId);
          if (xml === undefined) return `Selected Graphic shape source not found: ${element.shapeId}`;
          if (shapeBlocks.size >= shapeBlockLimit) {
            shapeBlockBudgetExceeded = true;
            return `Nested Graphic shape-source blocks exceeded ${shapeBlockLimit}`;
          }
          shapeBlocks.set(element.shapeId, xml);
        } else if (element.kind === 'text') {
          if (staticTextBlocks.has(element.textId)) continue;
          const descriptor = prepared.source.staticTextBlocks?.get(element.textId);
          if (descriptor === undefined) return `Selected Graphic static text source not found: ${element.textId}`;
          if (staticTextBlocks.size >= FLA_STATIC_TEXT_LIMITS.maxTextNodesPerComposition * 4) {
            shapeBlockBudgetExceeded = true;
            return 'Nested Graphic static text blocks exceeded budget';
          }
          staticTextBlocks.set(element.textId, descriptor);
        } else if (element.kind === 'group') {
          const nestedError = captureShapeBlocks(element.elements);
          if (nestedError) return nestedError;
        }
      }
      return null;
    };
    const selectionSource: FlaStaticSnapshotDisplaySource = {
      ...prepared.source,
      buildGraphicFrameContext: (timelineXml, frameSpanIndex, frameIndex, scope) => {
        const frameContext = prepared.source.buildGraphicFrameContext(
          timelineXml,
          frameSpanIndex,
          frameIndex,
          scope,
        );
        if (!frameContext.ok) return frameContext;
        for (const layer of frameContext.value.layers) {
          if (!layer.visible) continue;
          const captureError = captureShapeBlocks(layer.elements);
          if (captureError) {
            return {
              ok: false,
              code: shapeBlockBudgetExceeded ? 'BUDGET_EXCEEDED' : 'RENDER_FAILED',
              message: captureError,
            };
          }
        }
        return frameContext;
      },
    };
    const nested = prepareFlaNestedGraphicFrameSelections(selectionSource, targetKind === 'scene'
      ? { kind: 'scene', name: targetName, frameContext: sceneFrameContext }
      : { kind: 'graphic', name: targetName, frameContext: sceneFrameContext });
    if (shapeBlockBudgetExceeded) {
      return this.failure(
        'BUDGET_EXCEEDED',
        `Nested Graphic shape-source blocks exceeded ${shapeBlockLimit}`,
        active.request,
      );
    }
    let frameContext = sceneFrameContext;
    let symbols = prepared.source.symbols;
    let selectionsBySourceAddress: ReadonlyMap<string, FlaNestedGraphicFrameSelection> = new Map();
    let selectionFallbackReason: string | null = null;
    if (!nested.ok && nested.code === 'UNSUPPORTED_TIMING' &&
        nested.message.includes('missing its source address or parent frame coordinates')) {
      // Preserve the existing whole-image-only route for untraceable sources.
      // No PartPlan or per-instance selection is emitted without stable source
      // identity; addressed, supported instances use the selector below.
      selectionFallbackReason = 'Nested Graphic frame selection requires source-addressed instances.';
    } else if (!nested.ok) {
      const code = nested.code === 'BUDGET_EXCEEDED' ? 'BUDGET_EXCEEDED' : 'UNSUPPORTED_SOURCE';
      const sourceAddress = nested.sourceAddress ? ` (${nested.sourceAddress})` : '';
      return this.failure(code, `${nested.code}: ${nested.message}${sourceAddress}`.slice(0, 1_000), active.request);
    } else {
      frameContext = nested.resolverInput.root.frameContext;
      symbols = nested.resolverInput.symbols;
      selectionsBySourceAddress = new Map(nested.selections.map((selection) => [selection.sourceAddress, selection]));
    }

    const nativeResolved = resolveFlaDisplayList({
      root: targetKind === 'scene'
        ? { kind: 'scene', name: targetName, frameContext }
        : { kind: 'graphic', name: targetName, frameContext },
      symbols,
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
    const media = sourceIdentity.loadMedia ? await sourceIdentity.loadMedia() : sourceIdentity.media;
    if (active.settled) return active.settledPromise;
    const mediaLookup = createFlaStaticSnapshotBitmapMediaLookup(media ?? []);
    const nativeComposition = buildSvgForResolvedDisplayList({
      displayList: nativeResolved.displayList,
      renderTargetId: active.request.target.renderTargetId,
      stageWidth: prepared.source.stageWidth,
      stageHeight: prepared.source.stageHeight,
      shapeBlocks,
      staticTextBlocks,
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
    let nativeFacts: NativeRenderFacts = {
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
      const nativeRaster = await this.rasterize(
        active,
        nativeFacts.svg,
        nativeFacts.width,
        nativeFacts.height,
        nativeFacts.pixelCount,
        nativeComposition.staticTexts,
        nativeComposition.graphicFraming,
      );
      nativePreview = nativeRaster.image;
      if (targetKind === 'graphic-symbol' && nativeRaster.sourceViewport) {
        const vb = nativeRaster.sourceViewport;
        nativeFacts = {
          ...nativeFacts,
          width: nativePreview.width,
          height: nativePreview.height,
          pixelCount: nativePreview.width * nativePreview.height,
          rootTransform: {
            a: nativePreview.width / vb.width,
            b: 0,
            c: 0,
            d: nativePreview.height / vb.height,
            tx: -vb.x * nativePreview.width / vb.width,
            ty: -vb.y * nativePreview.height / vb.height,
          },
        };
      }
    } catch (error) {
      const code = error instanceof FlaStaticSnapshotRasterizerError && error.code === 'BUDGET_EXCEEDED'
        ? 'BUDGET_EXCEEDED'
        : active.cancelCode ?? (Date.now() - startedAt >= this.wallTimeMs ? 'RENDER_TIMEOUT' : 'RENDER_FAILED');
      return this.failure(
        code,
        error instanceof Error ? error.message : String(error),
        active.request,
      );
    }
    if (!this.ensureCurrentAndWithinBudget(active)) {
      return this.failure(active.cancelCode ?? 'RENDER_CANCELLED', 'Preview is stale or cancelled', active.request);
    }

    const wholeImageReason = selectionFallbackReason ?? nativeComposition.maskWarning ?? nativeComposition.ikPoseWarning ?? nativeComposition.projectionWarning ??
      (frameContext.layers.some((layer) => layer.stageProjection)
        ? 'Native camera and depth are retained in the composed scene. Use a snapshot or frame sequence.'
        : undefined);
    if (wholeImageReason) {
      return this.wholeImageOnly(active, sourceIdentity, nativeFacts, nativePreview, wholeImageReason, {
        sourcePreparationCountForRequest,
        displayListResolveCount,
        rasterCount,
        elapsedMs: Date.now() - startedAt,
      });
    }

    const graphicInstances = active.request.purpose === 'graphic-instance';
    const collection = makeCandidateCollection(
      prepared.source,
      frameContext,
      symbols,
      selectionsBySourceAddress,
      (sourceIdentity.originalSourceSha256 ?? sourceIdentity.sha256).toLowerCase(),
      target,
      rootTransform,
      graphicInstances,
    );
    if (collection.fallbackReason) {
      return this.wholeImageOnly(active, sourceIdentity, nativeFacts, nativePreview, collection.fallbackReason, {
        sourcePreparationCountForRequest,
        displayListResolveCount,
        rasterCount,
        elapsedMs: Date.now() - startedAt,
      });
    }
    if (collection.candidates.length < (graphicInstances ? 1 : 2)) {
      return this.wholeImageOnly(
        active,
        sourceIdentity,
        nativeFacts,
        nativePreview,
        graphicInstances
          ? FLA_NO_IMPORTABLE_GRAPHIC
          : 'Fewer than two independently addressable visible source parts were found.',
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
          symbols,
          candidate.isolatePath,
          candidate.unit.occurrenceId,
          graphicInstances,
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
          shapeBlocks,
          staticTextBlocks,
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
        const { image } = await this.rasterize(
          active,
          composition.svg,
          composition.width,
          composition.height,
          composition.pixelCount,
          composition.staticTexts,
        );
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
          sourceKind: candidate.unit.sourceKind,
          sourceSymbolId: candidate.unit.sourceSymbolId,
          sourceAddress: candidate.unit.sourceAddress,
          adapterIdentity: candidate.unit.adapterIdentity,
          sourceDefinitionFrameCount: candidate.unit.sourceDefinitionFrameCount,
          layerName: candidate.unit.layer.name,
          drawOrder: candidate.unit.drawOrder,
          graphicInstanceImportable: canImportGraphicInstance(candidate.unit),
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

    const capability = graphicInstances ? 'GRAPHIC_INSTANCES_READY' : 'EDITABLE_PARTS_READY';
    let reassembledPreview: FlaPartPreviewPng | null = null;
    if (!graphicInstances) {
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
      try {
        rasterCount += 1;
        reassembledPreview = (await this.rasterize(
          active,
          reassemblySvg,
          nativeFacts.width,
          nativeFacts.height,
          nativeFacts.pixelCount,
        )).image;
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
    }
    const totalPngBytes = nativePreview.byteLength + partPngBytes + (reassembledPreview?.byteLength ?? 0);
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
      capability,
      null,
      units,
    );
    const response = FlaPartPreviewResponseSchema.parse({
      ok: true,
      status: 'PREVIEW_READY',
      capability,
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
    if (!response.ok || response.capability !== capability) {
      throw new Error('Preview response did not match its validated capability');
    }
    this.holdResult(plan, response.capability === 'EDITABLE_PARTS_READY' ? response.partPreviews : null);
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
    staticTexts?: readonly FlaStaticTextRenderItem[],
    graphicFraming?: FlaStaticTextGraphicFraming,
  ): Promise<{
    readonly image: FlaPartPreviewPng;
    readonly sourceViewport?: { x: number; y: number; width: number; height: number };
  }> {
    if (!this.ensureCurrentAndWithinBudget(active)) {
      throw new Error(active.cancelCode === 'RENDER_TIMEOUT' ? 'Batch wall time exceeded' : 'Preview was cancelled');
    }
    const requestId = crypto.randomUUID();
    active.currentRasterRequestId = requestId;
    let raster: FlaStaticSnapshotRasterizeOutput;
    try {
      raster = await this.rasterizer.rasterize({
        requestId,
        svg,
        width,
        height,
        pixelCount,
        ...(staticTexts?.length ? { staticTexts } : {}),
        ...(graphicFraming ? { graphicFraming } : {}),
      });
    } finally {
      if (active.currentRasterRequestId === requestId) active.currentRasterRequestId = null;
    }
    if (!this.ensureCurrentAndWithinBudget(active)) {
      throw new Error(active.cancelCode === 'RENDER_TIMEOUT' ? 'Batch wall time exceeded' : 'Preview was cancelled');
    }
    const allowMeasuredResize = Boolean(graphicFraming && staticTexts?.length);
    const dimensionsOk = allowMeasuredResize
      ? raster.width > 0 &&
        raster.height > 0 &&
        raster.width <= FLA_STATIC_SNAPSHOT_LIMITS.maxOutputWidth &&
        raster.height <= FLA_STATIC_SNAPSHOT_LIMITS.maxOutputHeight &&
        raster.pixelCount === raster.width * raster.height &&
        raster.pixelCount <= FLA_STATIC_SNAPSHOT_LIMITS.maxOutputPixels
      : raster.width === width && raster.height === height && raster.pixelCount === pixelCount;
    if (!dimensionsOk ||
        raster.pngBytes.byteLength <= 0 || raster.pngBytes.byteLength > FLA_STATIC_SNAPSHOT_LIMITS.maxSnapshotBytes) {
      throw new Error('Sandbox rasterizer returned out-of-budget dimensions or bytes');
    }
    const dimensions = validatePngEncodedImage(Buffer.from(raster.pngBytes), {
      maxWidth: FLA_STATIC_SNAPSHOT_LIMITS.maxOutputWidth,
      maxHeight: FLA_STATIC_SNAPSHOT_LIMITS.maxOutputHeight,
      maxPixels: FLA_STATIC_SNAPSHOT_LIMITS.maxOutputPixels,
      maxEncodedBytes: FLA_STATIC_SNAPSHOT_LIMITS.maxSnapshotBytes,
    });
    if (!dimensions || dimensions.width !== raster.width || dimensions.height !== raster.height) {
      throw new Error('Sandbox rasterizer returned an invalid PNG');
    }
    return {
      image: this.pngRecord(raster.pngBytes, raster.width, raster.height, raster.pixelCount),
      ...(raster.sourceViewport ? { sourceViewport: raster.sourceViewport } : {}),
    };
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
    capability: 'EDITABLE_PARTS_READY' | 'GRAPHIC_INSTANCES_READY' | 'WHOLE_IMAGE_ONLY',
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
            unit.sourceKind !== part.sourceKind || unit.sourceSymbolId !== part.sourceSymbolId ||
            unit.sourceAddress !== part.sourceAddress || unit.adapterIdentity !== part.adapterIdentity ||
            unit.sourceDefinitionFrameCount !== part.sourceDefinitionFrameCount || unit.layer.name !== part.layerName ||
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
          sourceKind: part.sourceKind,
          sourceSymbolId: part.sourceSymbolId,
          sourceAddress: part.sourceAddress,
          adapterIdentity: part.adapterIdentity,
          sourceDefinitionFrameCount: part.sourceDefinitionFrameCount,
          layerName: part.layerName,
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
