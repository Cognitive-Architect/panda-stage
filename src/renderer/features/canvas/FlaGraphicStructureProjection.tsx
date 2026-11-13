import Konva from 'konva';
import {
  Group,
  Image as KonvaImage,
  Rect,
} from 'react-konva';
import type {
  EvaluatedFlaGraphicNode,
  FlaGraphicDefinition,
  FlaGraphicStructureFrame,
  FlaGraphicStructureNode,
  FlaGraphicInstanceTransformOverrides,
  ImageAsset,
} from '../../../domain';
import {
  evaluateFlaGraphicVisual,
  resolveFlaGraphicInternalAuthoringState,
  updateFlaGraphicStructureAuthoredTransform,
  updateFlaGraphicTimelineKeyframeTransform,
  withFlaGraphicContainerTimeline,
} from '../../../domain';
import {
  localizeAbsoluteLeafMatrix,
  type AffineMatrix2D,
} from '../../../shared/affine-matrix';
import {
  flaGraphicNodePathKey,
  type FlaGraphicEditMode,
} from './flaGraphicEditScope';
import { renderFlaGraphicCanvas } from './flaGraphicCanvasRenderer';

interface Bounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const identityMatrix: AffineMatrix2D = {
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  tx: 0,
  ty: 0,
};

function matrixTransformProps(matrix: AffineMatrix2D): {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  skewX: number;
  skewY: number;
} | null {
  const decomposed = new Konva.Transform([
    matrix.a,
    matrix.b,
    matrix.c,
    matrix.d,
    matrix.tx,
    matrix.ty,
  ]).decompose();
  const values = [
    decomposed.x,
    decomposed.y,
    decomposed.rotation,
    decomposed.scaleX,
    decomposed.scaleY,
    decomposed.skewX,
    decomposed.skewY,
  ];
  if (!values.every(Number.isFinite)) return null;
  return {
    x: decomposed.x,
    y: decomposed.y,
    rotation: decomposed.rotation,
    scaleX: decomposed.scaleX,
    scaleY: decomposed.scaleY,
    skewX: decomposed.skewX,
    skewY: decomposed.skewY,
  };
}

function transformBounds(bounds: Bounds, matrix: AffineMatrix2D): Bounds {
  const points = [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x, y: bounds.y + bounds.height },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
  ].map((point) => ({
    x: matrix.a * point.x + matrix.c * point.y + matrix.tx,
    y: matrix.b * point.x + matrix.d * point.y + matrix.ty,
  }));
  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxX = Math.max(...points.map((point) => point.x));
  const maxY = Math.max(...points.map((point) => point.y));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function unionBounds(bounds: readonly (Bounds | null)[]): Bounds | null {
  const present = bounds.filter((item): item is Bounds => Boolean(item));
  if (present.length === 0) return null;
  const minX = Math.min(...present.map((item) => item.x));
  const minY = Math.min(...present.map((item) => item.y));
  const maxX = Math.max(...present.map((item) => item.x + item.width));
  const maxY = Math.max(...present.map((item) => item.y + item.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function equalPath(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((part, index) => part === right[index]);
}

export interface FlaGraphicStructureProjectionProps {
  readonly definition: FlaGraphicDefinition;
  readonly frame: FlaGraphicStructureFrame;
  readonly images: ReadonlyMap<string, HTMLImageElement>;
  readonly assets: ReadonlyMap<string, Pick<ImageAsset, 'width' | 'height'>>;
  readonly scopePath: readonly string[];
  readonly editMode?: FlaGraphicEditMode;
  readonly timelineAuthoringActive?: boolean;
  readonly internalTimeMs?: number;
  readonly selectedNodePathKey: string | null;
  readonly instanceTransformOverrides?: FlaGraphicInstanceTransformOverrides;
  /** Transient gesture preview matrices; committed values live on the Layer. */
  readonly draftMatrices: Readonly<Record<string, AffineMatrix2D>>;
  readonly layerLocked: boolean;
  readonly scopeParentNodeRef: React.RefObject<Konva.Group | null>;
  readonly selectedNodeRef: React.RefObject<Konva.Group | null>;
  readonly onSelect: (path: readonly string[]) => void;
  readonly onEnter: (path: readonly string[]) => void;
  readonly onTransformPreview: (path: readonly string[], matrix: AffineMatrix2D) => void;
  readonly onCommitTransform: (path: readonly string[], matrix: AffineMatrix2D) => void;
  readonly onError: (message: string) => void;
}

/**
 * Applies transient shared-definition gesture drafts onto a temporary copy of
 * `definition` without mutating Project or History, then evaluates in pure
 * `definition` mode so all normalized symbol occurrences fan out in real time.
 */
export function evaluateFlaGraphicProjectionVisual(input: {
  readonly definition: FlaGraphicDefinition;
  readonly frameOrdinal: number;
  readonly editMode: FlaGraphicEditMode;
  readonly timelineAuthoringActive?: boolean;
  readonly internalTimeMs?: number;
  readonly instanceTransformOverrides?: FlaGraphicInstanceTransformOverrides;
  readonly draftMatrices: Readonly<Record<string, AffineMatrix2D>>;
}) {
  const {
    definition,
    frameOrdinal,
    editMode,
    internalTimeMs,
    timelineAuthoringActive = internalTimeMs !== undefined,
    instanceTransformOverrides,
    draftMatrices,
  } = input;
  const draftEntries = Object.entries(draftMatrices);
  if (editMode === 'definition') {
    let previewDefinition = definition;
    if (draftEntries.length > 0 && definition.structure) {
      let nextStructure = definition.structure;
      for (const [pathKey, matrix] of draftEntries) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(pathKey);
        } catch {
          continue;
        }
        if (
          Array.isArray(parsed) &&
          parsed.every((part): part is string => typeof part === 'string')
        ) {
          if (timelineAuthoringActive) {
            const authoringState = resolveFlaGraphicInternalAuthoringState({
              structure: nextStructure,
              frameOrdinal,
              nodePath: parsed,
              internalTimeMs,
              timelineAuthoringActive: true,
            });
            if (
              authoringState.canEditTransform &&
              authoringState.target?.trackId &&
              internalTimeMs !== undefined
            ) {
              const nextTimeline = updateFlaGraphicTimelineKeyframeTransform(
                authoringState.target.timeline,
                authoringState.target.trackId,
                internalTimeMs,
                matrix,
              );
              nextStructure = withFlaGraphicContainerTimeline(
                nextStructure,
                authoringState.target,
                nextTimeline,
              );
            }
          } else {
            nextStructure = updateFlaGraphicStructureAuthoredTransform(
              nextStructure,
              frameOrdinal,
              parsed,
              matrix,
            );
          }
        }
      }
      if (nextStructure !== definition.structure) {
        previewDefinition = {
          ...definition,
          structure: nextStructure,
        };
      }
    }
    return evaluateFlaGraphicVisual({
      definition: previewDefinition,
      frameOrdinal,
      mode: 'definition',
      internalTimeMs,
    });
  }

  const evaluationOverrides = (() => {
    if (draftEntries.length === 0) return instanceTransformOverrides;
    const frameKey = String(frameOrdinal);
    return {
      ...(instanceTransformOverrides ?? {}),
      [frameKey]: {
        ...(instanceTransformOverrides?.[frameKey] ?? {}),
        ...draftMatrices,
      },
    } as FlaGraphicInstanceTransformOverrides;
  })();
  return evaluateFlaGraphicVisual({
    definition,
    frameOrdinal,
    mode: 'instance',
    instanceTransformOverrides: evaluationOverrides,
  });
}

export function FlaGraphicStructureProjection({
  definition,
  frame,
  images,
  assets,
  scopePath,
  editMode = 'instance',
  timelineAuthoringActive = false,
  internalTimeMs,
  selectedNodePathKey,
  instanceTransformOverrides,
  draftMatrices,
  layerLocked,
  scopeParentNodeRef,
  selectedNodeRef,
  onSelect,
  onEnter,
  onTransformPreview,
  onCommitTransform,
  onError,
}: FlaGraphicStructureProjectionProps): React.JSX.Element {
  const evaluatedVisual = evaluateFlaGraphicProjectionVisual({
    definition,
    frameOrdinal: frame.ordinal,
    editMode,
    timelineAuthoringActive,
    internalTimeMs,
    instanceTransformOverrides,
    draftMatrices,
  });
  const renderedCanvas = evaluatedVisual
    ? renderFlaGraphicCanvas(evaluatedVisual, images)
    : null;
  const animationFrame = definition.frames.find(
    (candidate) => candidate.ordinal === frame.ordinal,
  ) ?? definition.frames[0];
  const boundsCache = new Map<string, Bounds | null>();

  const fallbackCrop = (
    node: Extract<FlaGraphicStructureNode, { type: 'opaque' }>,
    image: HTMLImageElement,
  ): { x: number; y: number; width: number; height: number } | null => {
    if (!node.fallbackViewBox || !node.fallbackScope) return null;
    if (node.fallbackScope === 'subtree') {
      return { x: 0, y: 0, width: image.naturalWidth, height: image.naturalHeight };
    }
    if (!animationFrame || !node.fallbackAssetId) return null;
    const viewport = animationFrame.sourceViewport;
    if (viewport.width <= 0 || viewport.height <= 0) return null;
    const scaleX = image.naturalWidth / viewport.width;
    const scaleY = image.naturalHeight / viewport.height;
    const raw = {
      x: (node.fallbackViewBox.x - viewport.x) * scaleX,
      y: (node.fallbackViewBox.y - viewport.y) * scaleY,
      width: node.fallbackViewBox.width * scaleX,
      height: node.fallbackViewBox.height * scaleY,
    };
    const x = Math.max(0, raw.x);
    const y = Math.max(0, raw.y);
    const right = Math.min(image.naturalWidth, raw.x + raw.width);
    const bottom = Math.min(image.naturalHeight, raw.y + raw.height);
    if (right <= x || bottom <= y) return null;
    return { x, y, width: right - x, height: bottom - y };
  };

  const nodeContentBounds = (node: EvaluatedFlaGraphicNode): Bounds | null => {
    const key = flaGraphicNodePathKey(node.path);
    if (boundsCache.has(key)) return boundsCache.get(key) ?? null;
    if (!node.renderable) {
      boundsCache.set(key, null);
      return null;
    }
    const source = node.source;
    let result: Bounds | null = null;
    if (source.type === 'bitmap') {
      const asset = source.assetId ? assets.get(source.assetId) : undefined;
      if (source.assetId && images.has(source.assetId) && asset) {
        result = { x: 0, y: 0, width: asset.width, height: asset.height };
      }
    } else if (source.type === 'opaque') {
      const image = source.fallbackAssetId
        ? images.get(source.fallbackAssetId)
        : undefined;
      const asset = source.fallbackAssetId
        ? assets.get(source.fallbackAssetId)
        : undefined;
      if (
        source.fallbackScope &&
        source.fallbackViewBox &&
        image &&
        asset &&
        fallbackCrop(source, image)
      ) {
        result = {
          x: 0,
          y: 0,
          width: source.fallbackViewBox.width,
          height: source.fallbackViewBox.height,
        };
      }
    } else {
      result = unionBounds(node.children.map((child) => {
        const childBounds = nodeContentBounds(child);
        return childBounds
          ? transformBounds(childBounds, child.localTransform)
          : null;
      }));
    }
    boundsCache.set(key, result);
    return result;
  };

  const renderNode = (
    evaluatedNode: EvaluatedFlaGraphicNode,
    directScopePath: readonly string[],
    selectionAncestorPath: readonly string[] | null,
  ): React.JSX.Element | null => {
    const node = evaluatedNode.source;
    const path = evaluatedNode.path;
    const key = flaGraphicNodePathKey(path);
    const localMatrix = draftMatrices[key] ?? evaluatedNode.localTransform;
    const transform = matrixTransformProps(localMatrix);
    const content = nodeContentBounds(evaluatedNode);
    if (!transform) return null;
    const isDirectChild = equalPath(path.slice(0, -1), directScopePath);
    const imageReady = Boolean(content);
    const selectable = isDirectChild && imageReady && !layerLocked;
    const canEditNodeTransform =
      editMode === 'definition' && timelineAuthoringActive
        ? resolveFlaGraphicInternalAuthoringState({
            structure: definition.structure,
            frameOrdinal: frame.ordinal,
            nodePath: path,
            internalTimeMs,
            timelineAuthoringActive: true,
          }).canEditTransform
        : true;
    const transformable = selectable && node.type !== 'opaque' && canEditNodeTransform;
    const bubbleToSelectionAncestor =
      !isDirectChild && selectionAncestorPath !== null && !layerLocked;
    const listening = selectable || bubbleToSelectionAncestor;
    const selected = selectable && selectedNodePathKey === key;
    const childSelectionAncestorPath = selectable &&
        (node.type === 'group' || node.type === 'symbol')
      ? path
      : selectionAncestorPath;
    const setSelection = (event: Konva.KonvaEventObject<MouseEvent | TouchEvent>): void => {
      event.cancelBubble = true;
      onSelect(path);
    };
    const handleTransformEnd = (event: Konva.KonvaEventObject<Event>): void => {
      event.cancelBubble = true;
      if (!transformable) return;
      const parentKonvaMatrix = scopeParentNodeRef.current
        ?.getAbsoluteTransform()
        .getMatrix();
      if (!parentKonvaMatrix) {
        event.target.setAttrs(transform);
        onError('Graphic parent transform is unavailable; the gesture was reverted.');
        return;
      }
      const absolute = event.target.getAbsoluteTransform().getMatrix();
      const localized = localizeAbsoluteLeafMatrix(
        matrixFromKonva(parentKonvaMatrix),
        matrixFromKonva(absolute),
      );
      if (!localized.ok) {
        event.target.setAttrs(transform);
        onError(localized.message);
        return;
      }
      onCommitTransform(path, localized.value);
    };
    const handleTransformPreview = (event: Konva.KonvaEventObject<Event>): void => {
      event.cancelBubble = true;
      if (!transformable) return;
      const parentKonvaMatrix = scopeParentNodeRef.current
        ?.getAbsoluteTransform()
        .getMatrix();
      if (!parentKonvaMatrix) return;
      const absolute = event.target.getAbsoluteTransform().getMatrix();
      const localized = localizeAbsoluteLeafMatrix(
        matrixFromKonva(parentKonvaMatrix),
        matrixFromKonva(absolute),
      );
      if (localized.ok) onTransformPreview(path, localized.value);
    };
    const handleDragEnd = (event: Konva.KonvaEventObject<DragEvent>): void => {
      event.cancelBubble = true;
      handleTransformEnd(event as Konva.KonvaEventObject<Event>);
    };
    const children = evaluatedNode.children.map((child) =>
      renderNode(child, directScopePath, childSelectionAncestorPath),
    );
    const canEnter =
      selectable &&
      (node.type === 'group' || node.type === 'symbol') &&
      evaluatedNode.children.length > 0;
    const wrapperRef = selected
      ? selectedNodeRef
      : equalPath(path, scopePath)
        ? scopeParentNodeRef
        : undefined;

    return (
      <Group
        {...transform}
        draggable={transformable}
        key={key}
        listening={listening}
        name={`fla-structure-node-${node.id}`}
        onClick={selectable ? setSelection : undefined}
        onTap={selectable ? setSelection : undefined}
        onDblClick={canEnter ? (event) => {
          event.cancelBubble = true;
          onSelect(path);
          onEnter(path);
        } : undefined}
        onDragStart={transformable ? (event) => {
          event.cancelBubble = true;
          onSelect(path);
        } : undefined}
        onDragMove={transformable ? handleTransformPreview : undefined}
        onDragEnd={transformable ? handleDragEnd : undefined}
        onTransform={transformable ? handleTransformPreview : undefined}
        onTransformEnd={transformable ? handleTransformEnd : undefined}
        opacity={node.type === 'symbol' ? node.opacity ?? 1 : 1}
        ref={wrapperRef}
      >
        {content && selectable ? (
          <Rect
            fill="#000000"
            height={content.height}
            listening
            name={`fla-structure-hit-${node.id}`}
            opacity={0}
            onClick={setSelection}
            onTap={setSelection}
            width={content.width}
            x={content.x}
            y={content.y}
          />
        ) : null}
        {children}
        {content && selected ? (
          <Rect
            height={content.height}
            listening={false}
            name="fla-structure-selected-bounds"
            stroke="#83d39a"
            strokeWidth={2}
            width={content.width}
            x={content.x}
            y={content.y}
          />
        ) : null}
      </Group>
    );
  };

  const rootPath = scopePath.length === 0;
  const rootTransform = matrixTransformProps({
    ...identityMatrix,
    tx: -definition.source.anchor.x - definition.source.canvas.width / 2,
    ty: -definition.source.anchor.y - definition.source.canvas.height / 2,
  });
  if (!rootTransform || !evaluatedVisual) {
    return <Group name="fla-structure-projection" />;
  }
  const roots = evaluatedVisual.layers?.flatMap((layer) => layer.nodes) ?? [];
  return (
    <>
      {renderedCanvas ? (
        <KonvaImage
          {...renderedCanvas.rect}
          image={renderedCanvas.canvas}
          listening={false}
          name="fla-structure-shared-render"
        />
      ) : null}
      <Group
        {...rootTransform}
        listening
        name="fla-structure-projection"
        ref={rootPath ? scopeParentNodeRef : undefined}
      >
        {roots.map((node) => renderNode(node, scopePath, null))}
      </Group>
    </>
  );
}

function matrixFromKonva(matrix: number[]): AffineMatrix2D {
  return {
    a: matrix[0] ?? 1,
    b: matrix[1] ?? 0,
    c: matrix[2] ?? 0,
    d: matrix[3] ?? 1,
    tx: matrix[4] ?? 0,
    ty: matrix[5] ?? 0,
  };
}
