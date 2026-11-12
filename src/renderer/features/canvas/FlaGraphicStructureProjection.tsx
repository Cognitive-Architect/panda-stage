import Konva from 'konva';
import {
  Group,
  Image as KonvaImage,
  Rect,
} from 'react-konva';
import type {
  FlaGraphicDefinition,
  FlaGraphicStructureFrame,
  FlaGraphicStructureNode,
  ImageAsset,
} from '../../../domain';
import {
  invertAffineMatrix,
  localizeAbsoluteLeafMatrix,
  multiplyAffineMatrices,
  type AffineMatrix2D,
} from '../../../shared/affine-matrix';
import { flaGraphicNodePathKey, isFlaGraphicNodeEnterable } from './flaGraphicEditScope';

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
  readonly selectedNodePathKey: string | null;
  readonly draftMatrices: Readonly<Record<string, AffineMatrix2D>>;
  readonly layerLocked: boolean;
  readonly scopeParentNodeRef: React.RefObject<Konva.Group | null>;
  readonly selectedNodeRef: React.RefObject<Konva.Group | null>;
  readonly onSelect: (path: readonly string[]) => void;
  readonly onEnter: (path: readonly string[]) => void;
  readonly onTransform: (path: readonly string[], matrix: AffineMatrix2D) => void;
  readonly onError: (message: string) => void;
}

export function FlaGraphicStructureProjection({
  definition,
  frame,
  images,
  assets,
  scopePath,
  selectedNodePathKey,
  draftMatrices,
  layerLocked,
  scopeParentNodeRef,
  selectedNodeRef,
  onSelect,
  onEnter,
  onTransform,
  onError,
}: FlaGraphicStructureProjectionProps): React.JSX.Element {
  const animationFrame = definition.frames.find(
    (candidate) => candidate.ordinal === frame.ordinal,
  ) ?? definition.frames[0];
  const nodePathKey = (path: readonly string[]): string => flaGraphicNodePathKey(path);
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

  const baseNodeMatrix = (
    node: FlaGraphicStructureNode,
    parentBaseWorld: AffineMatrix2D,
  ): AffineMatrix2D | null => {
    if (node.type !== 'opaque' || node.fallbackScope !== 'frame-crop' || !node.fallbackViewBox) {
      return node.localTransform;
    }
    const inverse = invertAffineMatrix(parentBaseWorld);
    if (!inverse) return null;
    return multiplyAffineMatrices(inverse, {
      ...identityMatrix,
      tx: node.fallbackViewBox.x,
      ty: node.fallbackViewBox.y,
    });
  };

  const nodeContentBounds = (
    node: FlaGraphicStructureNode,
    parentBaseWorld: AffineMatrix2D,
    path: readonly string[],
  ): Bounds | null => {
    const key = nodePathKey(path);
    if (boundsCache.has(key)) return boundsCache.get(key) ?? null;
    let result: Bounds | null = null;
    if (node.type === 'bitmap') {
      const asset = node.assetId ? assets.get(node.assetId) : undefined;
      if (node.assetId && images.has(node.assetId) && asset) {
        result = { x: 0, y: 0, width: asset.width, height: asset.height };
      }
    } else if (node.type === 'opaque') {
      const assetId = node.fallbackAssetId;
      const image = assetId ? images.get(assetId) : undefined;
      const asset = assetId ? assets.get(assetId) : undefined;
      if (
        node.fallbackScope &&
        node.fallbackViewBox &&
        image &&
        asset &&
        fallbackCrop(node, image) &&
        baseNodeMatrix(node, parentBaseWorld)
      ) {
        result = {
          x: 0,
          y: 0,
          width: node.fallbackViewBox.width,
          height: node.fallbackViewBox.height,
        };
      }
    } else {
      const nodeBaseWorld = multiplyAffineMatrices(parentBaseWorld, node.localTransform);
      result = unionBounds(node.children.map((child) =>
        nodeBoundsInParent(child, nodeBaseWorld, [...path, child.id]),
      ));
    }
    boundsCache.set(key, result);
    return result;
  };

  const nodeBoundsInParent = (
    node: FlaGraphicStructureNode,
    parentBaseWorld: AffineMatrix2D,
    path: readonly string[],
  ): Bounds | null => {
    const key = nodePathKey(path);
    if (boundsCache.has(key)) {
      const content = boundsCache.get(key) ?? null;
      const matrix = baseNodeMatrix(node, parentBaseWorld);
      return content && matrix ? transformBounds(content, draftMatrices[key] ?? matrix) : null;
    }
    const content = nodeContentBounds(node, parentBaseWorld, path);
    const matrix = baseNodeMatrix(node, parentBaseWorld);
    const result = content && matrix
      ? transformBounds(content, draftMatrices[key] ?? matrix)
      : null;
    boundsCache.set(key, content);
    return result;
  };

  const renderNode = (
    node: FlaGraphicStructureNode,
    parentBaseWorld: AffineMatrix2D,
    parentPath: readonly string[],
    directScopePath: readonly string[],
    selectionAncestorPath: readonly string[] | null,
  ): React.JSX.Element | null => {
    const path = [...parentPath, node.id];
    const key = nodePathKey(path);
    const originalMatrix = baseNodeMatrix(node, parentBaseWorld);
    const matrix = originalMatrix ? (draftMatrices[key] ?? originalMatrix) : null;
    const transform = matrix ? matrixTransformProps(matrix) : null;
    const bounds = nodeContentBounds(node, parentBaseWorld, path);
    if (!transform) return null;
    const isDirectChild = equalPath(parentPath, directScopePath);
    const imageReady = Boolean(bounds);
    const selectable = isDirectChild && imageReady && !layerLocked;
    const transformable = selectable && node.type !== 'opaque';
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
        onError('元件层级变换不可用，Child 变换已还原。');
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
      onTransform(path, localized.value);
    };
    const handleDragEnd = (event: Konva.KonvaEventObject<DragEvent>): void => {
      event.cancelBubble = true;
      handleTransformEnd(event as Konva.KonvaEventObject<Event>);
    };
    const content = nodeContentBounds(node, parentBaseWorld, path);
    const nodeBaseWorld = node.type === 'opaque'
      ? parentBaseWorld
      : multiplyAffineMatrices(parentBaseWorld, node.localTransform);
    const wrapperRef = selected
      ? selectedNodeRef
      : equalPath(path, scopePath)
        ? scopeParentNodeRef
        : undefined;

    let visual: React.ReactNode = null;
    if (node.type === 'bitmap' && node.assetId) {
      const asset = assets.get(node.assetId);
      const image = images.get(node.assetId);
      if (asset && image) {
        visual = (
          <KonvaImage
            height={asset.height}
            image={image}
            listening={bubbleToSelectionAncestor}
            name={`fla-structure-bitmap-${node.id}`}
            width={asset.width}
          />
        );
      }
    } else if (node.type === 'opaque' && node.fallbackAssetId && node.fallbackViewBox) {
      const image = images.get(node.fallbackAssetId);
      const crop = image ? fallbackCrop(node, image) : null;
      if (image && crop) {
        visual = (
          <KonvaImage
            crop={crop}
            height={node.fallbackViewBox.height}
            image={image}
            listening={bubbleToSelectionAncestor}
            name={`fla-structure-opaque-fallback-${node.id}`}
            width={node.fallbackViewBox.width}
          />
        );
      }
    } else if (node.type === 'group' || node.type === 'symbol') {
      visual = node.children
        .slice()
        .sort((left, right) => left.drawOrder - right.drawOrder)
        .map((child) => renderNode(
          child,
          nodeBaseWorld,
          path,
          directScopePath,
          childSelectionAncestorPath,
        ));
    }

    const canEnter = selectable && isFlaGraphicNodeEnterable(node);
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
        onDragEnd={transformable ? handleDragEnd : undefined}
        onTransformEnd={transformable ? handleTransformEnd : undefined}
        opacity={node.type === 'symbol' ? node.opacity ?? 1 : 1}
        ref={wrapperRef}
      >
        {visual}
        {content && selectable && (node.type === 'bitmap' || node.type === 'opaque') ? (
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
  if (!rootTransform) return <Group name="fla-structure-projection" />;
  const roots = frame.layers.flatMap((layer) =>
    [...layer.nodes].sort((left, right) => left.drawOrder - right.drawOrder),
  );
  const rootBaseWorld = identityMatrix;
  return (
    <Group
      {...rootTransform}
      listening
      name="fla-structure-projection"
      ref={rootPath ? scopeParentNodeRef : undefined}
    >
      {roots.map((node) => renderNode(node, rootBaseWorld, [], scopePath, null))}
    </Group>
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
