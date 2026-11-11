import Konva from 'konva';
import { useEffect, useState } from 'react';
import {
  Group,
  Image as KonvaImage,
  Rect,
} from 'react-konva';
import {
  clampLayerPosition,
  type Layer,
  type LayerTransformInput,
  visualPartRenderTransform,
  visualHeadGroupRenderTransform,
  type LayerVisualParts,
} from '../../../domain';
import type { StageLayerRenderInstruction } from '../../../shared/stage/layer-render-contract';
import type {
  PositionAuthoringCommitResult,
  PositionAuthoringSessionHandle,
} from '../../stores/positionAuthoringSessionStore';
import { canvasImageResourceKey } from './canvasImageResources';
import type { FlaGraphicGroupEditPreview } from '../../../shared/fla-graphic-instance-api';
import {
  localizeAbsoluteLeafMatrix,
  type AffineMatrix2D,
} from '../../../shared/affine-matrix';

interface Point {
  readonly x: number;
  readonly y: number;
}

export interface SelectableLayerProps {
  /** Compatibility primary image for ordinary/legacy callers. */
  image?: HTMLImageElement;
  /** The complete visual resolved by the domain visual-parts contract. */
  visual?: LayerVisualParts;
  /** Decoded images keyed by the runtime visual-part asset id. */
  images?: ReadonlyMap<string, HTMLImageElement>;
  /** Decoded images keyed by asset id plus source version. */
  imagesByResourceKey?: ReadonlyMap<string, HTMLImageElement>;
  /** Source versions captured by a retained complete visual. */
  visualSourceKeys?: ReadonlyMap<string, string>;
  layer: Layer;
  nodeRef: React.RefObject<Konva.Group | null>;
  render: StageLayerRenderInstruction;
  selected: boolean;
  directEditingEnabled?: boolean;
  onSelect: (layerId: string) => void;
  onCommitPosition: (
    layerId: string,
    position: { x: number; y: number },
  ) => void;
  onCommitTransform: (
    layerId: string,
    transform: LayerTransformInput,
  ) => void;
  /** A scoped Position-only capability; never writes Project data directly. */
  positionAuthoringSession?: PositionAuthoringSessionHandle | null;
  /** The visual-only Shake offset that must not be baked into Position. */
  positionAuthoringShakeOffset?: Point | null;
  flaGroupEditPreview?: FlaGraphicGroupEditPreview | null;
  flaGroupEditDraftMatrices?: Readonly<Record<string, AffineMatrix2D>>;
  flaGroupEditScope?: boolean;
  flaGroupEditSelectedChildAddress?: string | null;
  flaGroupEditParentNodeRef?: React.RefObject<Konva.Group | null>;
  onFlaGroupEditEnter?: () => void;
  onFlaGroupEditChildSelect?: (sourceAddress: string) => void;
  onFlaGroupEditChildTransform?: (sourceAddress: string, matrix: AffineMatrix2D) => void;
  onPositionAuthoringCommit?: (result: PositionAuthoringCommitResult) => void;
  onError: (message: string) => void;
}

interface SvgArtworkImageProps {
  readonly svg: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly listening?: boolean;
  readonly name: string;
}

function SvgArtworkImage({
  svg,
  x,
  y,
  width,
  height,
  listening = false,
  name,
}: SvgArtworkImageProps): React.JSX.Element | null {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    setImage(null);
    if (typeof Image === 'undefined' || typeof URL.createObjectURL !== 'function') return undefined;
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const nextImage = new Image();
    nextImage.onload = () => setImage(nextImage);
    nextImage.onerror = () => setImage(null);
    nextImage.src = url;
    return () => {
      nextImage.onload = null;
      nextImage.onerror = null;
      URL.revokeObjectURL(url);
    };
  }, [svg]);
  if (!image) return null;
  return (
    <KonvaImage
      height={height}
      image={image}
      listening={listening}
      name={name}
      width={width}
      x={x}
      y={y}
    />
  );
}

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

function matrixFromKonvaTransform(matrix: number[]): AffineMatrix2D {
  return {
    a: matrix[0] ?? 1,
    b: matrix[1] ?? 0,
    c: matrix[2] ?? 0,
    d: matrix[3] ?? 1,
    tx: matrix[4] ?? 0,
    ty: matrix[5] ?? 0,
  };
}

function stopAndSelect(
  event: Konva.KonvaEventObject<MouseEvent | TouchEvent>,
  layerId: string,
  onSelect: (layerId: string) => void,
): void {
  event.cancelBubble = true;
  onSelect(layerId);
}

export function SelectableLayer({
  image,
  images,
  imagesByResourceKey,
  layer,
  nodeRef,
  render,
  selected,
  visual,
  visualSourceKeys,
  directEditingEnabled = true,
  onSelect,
  onCommitPosition,
  onCommitTransform,
  positionAuthoringSession = null,
  positionAuthoringShakeOffset = null,
  flaGroupEditPreview = null,
  flaGroupEditDraftMatrices = {},
  flaGroupEditScope = false,
  flaGroupEditSelectedChildAddress = null,
  flaGroupEditParentNodeRef,
  onFlaGroupEditEnter = () => undefined,
  onFlaGroupEditChildSelect = () => undefined,
  onFlaGroupEditChildTransform = () => undefined,
  onPositionAuthoringCommit = () => undefined,
  onError,
}: SelectableLayerProps): React.JSX.Element {
  const canSelect = true;
  const positionAuthoringEnabled = positionAuthoringSession !== null;
  const canMove =
    (directEditingEnabled || positionAuthoringEnabled) && !layer.locked;
  const canTransform = canMove && !flaGroupEditScope;

  const legacyBounds = {
    x: -render.offsetX,
    y: -render.offsetY,
    width: render.width,
    height: render.height,
  };
  const visualParts = visual?.parts ?? [
    {
      partId: `${layer.id}:single`,
      ownerLayerId: layer.id,
      slot: 'single' as const,
      source: { kind: 'asset' as const, assetId: render.assetId },
      assetId: render.assetId,
      localRect: legacyBounds,
      rotationDeg: 0,
      flipX: false,
      drawOrder: 0,
      ownerZIndex: render.zIndex,
    },
  ];
  const visualBounds = visual?.combinedLocalBounds ?? legacyBounds;
  const firstPart = visualParts[0];
  const imageForPart = (
    part: (typeof visualParts)[number],
  ): HTMLImageElement | undefined =>
    (visualSourceKeys
      ? imagesByResourceKey?.get(
          visualSourceKeys.get(part.assetId)
            ? canvasImageResourceKey(
                part.assetId,
                visualSourceKeys.get(part.assetId)!,
              )
            : '',
        )
      : undefined) ??
    images?.get(part.assetId) ??
    (part === firstPart && part.assetId === render.assetId ? image : undefined);
  const resolvedPartImages = visualParts.map((part) => ({
    part,
    image: imageForPart(part),
  }));
  const completeVisualReady = resolvedPartImages.every(
    ({ image: partImage }) => Boolean(partImage),
  );
  const compositeVisual =
    visual?.kind === 'composite-character' ||
    visual?.kind === 'adaptive-parts-character';
  const animationVisual = visual?.parts.some(
    (part) => part.source.kind === 'animation-frame',
  ) ?? false;
  const headGroup = visual?.headGroup ?? null;
  const headPartIds = new Set(headGroup?.partIds ?? []);
  const cacheCompositeVisual = (visualNode: Konva.Group | null): void => {
    if (!visualNode) return;
    visualNode.clearCache();
    if (
      !compositeVisual ||
      !completeVisualReady ||
      visualBounds.width <= 0 ||
      visualBounds.height <= 0
    ) return;
    // Konva applies a Group opacity while drawing each child. Cache the
    // complete Body+Head+Face group first so the logical Character opacity is
    // applied once to the flattened overlap, while the outer root remains
    // the only transform/interaction owner.
    visualNode.cache({
      height: visualBounds.height,
      width: visualBounds.width,
      x: visualBounds.x,
      y: visualBounds.y,
    });
    visualNode.getLayer()?.batchDraw();
  };
  const renderPart = ({
    part,
    image: partImage,
  }: (typeof resolvedPartImages)[number]): React.JSX.Element => (
    <KonvaImage
      height={part.localRect.height}
      image={partImage}
      key={part.partId}
      listening={canSelect}
      onClick={(event) => stopAndSelect(event, layer.id, onSelect)}
      onTap={(event) => stopAndSelect(event, layer.id, onSelect)}
      {...visualPartRenderTransform(part)}
      width={part.localRect.width}
    />
  );
  const renderHitArea = ({
    part,
  }: (typeof resolvedPartImages)[number]): React.JSX.Element => (
    <Rect
      fill="#000000"
      height={part.localRect.height}
      key={`${part.partId}:hit`}
      listening={canSelect}
      name="composite-visual-hit-area"
      opacity={0}
      onClick={(event) => stopAndSelect(event, layer.id, onSelect)}
      onTap={(event) => stopAndSelect(event, layer.id, onSelect)}
      {...visualPartRenderTransform(part)}
      width={part.localRect.width}
    />
  );
  const orderedPartImages = resolvedPartImages.sort(
    (left, right) => left.part.drawOrder - right.part.drawOrder,
  );
  const visiblePartImages = orderedPartImages.filter(
    ({ part }) => part.visible !== false,
  );
  const renderedParts = completeVisualReady
    ? headGroup
      ? (
          <>
            {visiblePartImages
              .filter(({ part }) => !headPartIds.has(part.partId))
              .map(renderPart)}
            <Group
              key={headGroup.id}
              listening={canSelect}
              name="selectable-canvas-head-group"
              {...visualHeadGroupRenderTransform(headGroup)}
            >
              {visiblePartImages
                .filter(({ part }) => headPartIds.has(part.partId))
                .map(renderPart)}
            </Group>
          </>
        )
      : visiblePartImages.length === 1
        ? renderPart(visiblePartImages[0]!)
        : visiblePartImages.map(renderPart)
    : null;
  const renderedHitAreas =
    compositeVisual && completeVisualReady
      ? headGroup
        ? (
            <>
            {visiblePartImages
                .filter(({ part }) => !headPartIds.has(part.partId))
                .map(renderHitArea)}
              <Group
                listening={canSelect}
                name="selectable-canvas-head-hit-group"
                {...visualHeadGroupRenderTransform(headGroup)}
              >
                {visiblePartImages
                  .filter(({ part }) => headPartIds.has(part.partId))
                  .map(renderHitArea)}
              </Group>
            </>
          )
        : visiblePartImages.map(renderHitArea)
      : null;

  const groupEditTransform = flaGroupEditPreview
    ? matrixTransformProps(flaGroupEditPreview.group.canvasTransform)
    : null;
  const renderedGroupEditPreview = flaGroupEditPreview && groupEditTransform ? (
    <Group listening name="fla-group-edit-preview">
      {flaGroupEditPreview.background ? (
        <SvgArtworkImage
          height={flaGroupEditPreview.background.artwork.viewBox.height}
          name="fla-group-edit-background"
          svg={flaGroupEditPreview.background.artwork.svg}
          width={flaGroupEditPreview.background.artwork.viewBox.width}
          x={flaGroupEditPreview.background.position.x}
          y={flaGroupEditPreview.background.position.y}
        />
      ) : null}
      <Rect
        fill="#000000"
        height={flaGroupEditPreview.frameCanvas.height}
        listening={canSelect}
        name="fla-group-edit-parent-hit-area"
        opacity={0}
        onClick={(event) => stopAndSelect(event, layer.id, onSelect)}
        onTap={(event) => stopAndSelect(event, layer.id, onSelect)}
        width={flaGroupEditPreview.frameCanvas.width}
        x={-flaGroupEditPreview.frameCanvas.width / 2}
        y={-flaGroupEditPreview.frameCanvas.height / 2}
      />
      <Group
        {...groupEditTransform}
        listening={flaGroupEditScope}
        name="fla-group-edit-parent"
        opacity={flaGroupEditPreview.group.opacity ?? 1}
        ref={flaGroupEditParentNodeRef}
      >
        {flaGroupEditPreview.children.map((child) => {
          const childMatrix = flaGroupEditDraftMatrices[child.sourceAddress] ?? child.localTransform;
          const childTransform = matrixTransformProps(childMatrix);
          if (!childTransform) return null;
          return (
            <Group
              {...childTransform}
              draggable={flaGroupEditScope && !layer.locked}
              key={child.sourceAddress}
              listening={flaGroupEditScope}
              name={`fla-group-edit-child-${child.kind}`}
              onClick={(event) => {
                event.cancelBubble = true;
                onFlaGroupEditChildSelect(child.sourceAddress);
              }}
              onTap={(event) => {
                event.cancelBubble = true;
                onFlaGroupEditChildSelect(child.sourceAddress);
              }}
              onDragStart={(event) => {
                event.cancelBubble = true;
                onFlaGroupEditChildSelect(child.sourceAddress);
              }}
              onDragEnd={(event) => {
                event.cancelBubble = true;
                const parentKonvaMatrix = flaGroupEditParentNodeRef?.current
                  ?.getAbsoluteTransform().getMatrix();
                if (!parentKonvaMatrix) {
                  event.target.setAttrs(childTransform);
                  onError('Group 變換不可用，子圖層位置已還原。');
                  return;
                }
                const childAbsoluteMatrix = event.target.getAbsoluteTransform().getMatrix();
                const localized = localizeAbsoluteLeafMatrix(
                  matrixFromKonvaTransform(parentKonvaMatrix),
                  matrixFromKonvaTransform(childAbsoluteMatrix),
                );
                if (!localized.ok) {
                  event.target.setAttrs(childTransform);
                  onError(localized.message);
                  return;
                }
                onFlaGroupEditChildTransform(child.sourceAddress, localized.value);
              }}
            >
              <Rect
                fill="#000000"
                height={child.artwork.viewBox.height}
                listening={flaGroupEditScope}
                name="fla-group-edit-child-hit-area"
                opacity={0}
                width={child.artwork.viewBox.width}
                x={child.artwork.viewBox.x}
                y={child.artwork.viewBox.y}
              />
              <SvgArtworkImage
                height={child.artwork.viewBox.height}
                listening={flaGroupEditScope}
                name={`fla-group-edit-art-${child.sourceAddress}`}
                svg={child.artwork.svg}
                width={child.artwork.viewBox.width}
                x={child.artwork.viewBox.x}
                y={child.artwork.viewBox.y}
              />
              {flaGroupEditScope && flaGroupEditSelectedChildAddress === child.sourceAddress ? (
                <Rect
                  height={child.artwork.viewBox.height}
                  listening={false}
                  name="fla-group-edit-child-selection"
                  stroke="#83d39a"
                  strokeWidth={2}
                  width={child.artwork.viewBox.width}
                  x={child.artwork.viewBox.x}
                  y={child.artwork.viewBox.y}
                />
              ) : null}
            </Group>
          );
        })}
      </Group>
      {flaGroupEditPreview.foreground ? (
        <SvgArtworkImage
          height={flaGroupEditPreview.foreground.artwork.viewBox.height}
          name="fla-group-edit-foreground"
          svg={flaGroupEditPreview.foreground.artwork.svg}
          width={flaGroupEditPreview.foreground.artwork.viewBox.width}
          x={flaGroupEditPreview.foreground.position.x}
          y={flaGroupEditPreview.foreground.position.y}
        />
      ) : null}
    </Group>
  ) : null;

  const clampNode = (node: Konva.Node): void => {
    const position = clampLayerPosition({
      x: node.x(),
      y: node.y(),
    });
    node.position(position);
  };

  const mainPositionFromVisual = (node: Konva.Node): Point => ({
    x: node.x() - (positionAuthoringShakeOffset?.x ?? 0),
    y: node.y() - (positionAuthoringShakeOffset?.y ?? 0),
  });

  const clampPositionAuthoringNode = (node: Konva.Node): void => {
    const mainPosition = clampLayerPosition(mainPositionFromVisual(node));
    node.position({
      x: mainPosition.x + (positionAuthoringShakeOffset?.x ?? 0),
      y: mainPosition.y + (positionAuthoringShakeOffset?.y ?? 0),
    });
  };

  const resetNode = (node: Konva.Node): void => {
    node.position({ x: render.x, y: render.y });
    node.scale({ x: render.scaleX, y: render.scaleY });
    node.rotation(render.rotationDeg);
  };

  return (
    <Group
      draggable={canTransform}
      id={`canvas-layer-${layer.id}`}
      listening={canSelect}
      name="selectable-canvas-layer"
      onDragStart={(event) => {
        if (layer.source.kind !== 'animation') return;
        event.cancelBubble = true;
        onSelect(layer.id);
      }}
      onClick={(event) =>
        stopAndSelect(event, layer.id, onSelect)
      }
      onDblClick={(event) => {
        if (!flaGroupEditPreview || !selected || flaGroupEditScope) return;
        event.cancelBubble = true;
        onFlaGroupEditEnter();
      }}
      onDragEnd={(event) => {
        if (positionAuthoringSession) {
          clampPositionAuthoringNode(event.target);
          const result = positionAuthoringSession.commit(
            mainPositionFromVisual(event.target),
          );
          if (result.status === 'rejected' || result.status === 'stale') {
            resetNode(event.target);
            onError(result.error.message);
          } else {
            onPositionAuthoringCommit(result);
          }
          return;
        }
        if (!directEditingEnabled) {
          resetNode(event.target);
          return;
        }
        clampNode(event.target);
        try {
          onCommitPosition(layer.id, {
            x: event.target.x(),
            y: event.target.y(),
          });
        } catch (error) {
          event.target.position({ x: render.x, y: render.y });
          onError(
            error instanceof Error
              ? error.message
              : '图层位置提交失败。',
          );
        }
      }}
      onDragMove={(event) => {
        if (positionAuthoringSession) {
          clampPositionAuthoringNode(event.target);
        } else {
          clampNode(event.target);
        }
        if (!positionAuthoringSession) return;
        const result = positionAuthoringSession.setDraft({
          ...mainPositionFromVisual(event.target),
        });
        if (!result.ok) {
          resetNode(event.target);
          onError(result.error.message);
        }
      }}
      onTap={(event) =>
        stopAndSelect(event, layer.id, onSelect)
      }
      opacity={render.opacity}
      onTransformEnd={(event) => {
        const node = event.target as Konva.Group;
        if (positionAuthoringSession || !directEditingEnabled || flaGroupEditScope) {
          resetNode(node);
          return;
        }
        const scale = Math.abs(node.scaleX());
        node.scaleX(layer.flipX ? -scale : scale);
        node.scaleY(scale);
        try {
          onCommitTransform(layer.id, {
            x: node.x(),
            y: node.y(),
            scale,
            rotationDeg: node.rotation(),
            opacity: layer.opacity,
            flipX: layer.flipX,
          });
        } catch (error) {
          resetNode(node);
          onError(
            error instanceof Error
              ? error.message
              : '图层变换提交失败。',
          );
        }
      }}
      ref={nodeRef}
      rotation={render.rotationDeg}
      scaleX={render.scaleX}
      scaleY={render.scaleY}
      visible={render.visible}
      x={render.x}
      y={render.y}
      >
        {renderedGroupEditPreview ?? (compositeVisual ? (
          <Group
            listening={canSelect}
            name="selectable-canvas-visual"
            ref={cacheCompositeVisual}
          >
            {renderedParts}
          </Group>
        ) : (
          renderedParts
        ))}
        {!flaGroupEditPreview ? renderedHitAreas : null}
        {!flaGroupEditPreview && animationVisual ? (
          <Rect
            fill="#000000"
            height={visualBounds.height}
            listening={canSelect}
            name="selectable-animation-canvas-hit-area"
            opacity={0}
            onClick={(event) => stopAndSelect(event, layer.id, onSelect)}
            onTap={(event) => stopAndSelect(event, layer.id, onSelect)}
            width={visualBounds.width}
            x={visualBounds.x}
            y={visualBounds.y}
          />
        ) : null}
        {selected && completeVisualReady && !flaGroupEditScope ? (
          <Rect
          dash={layer.locked ? [18, 12] : undefined}
          height={visualBounds.height}
          listening={false}
          stroke={layer.locked ? '#ffd166' : '#83d39a'}
          strokeWidth={4}
          width={visualBounds.width}
          x={visualBounds.x}
          y={visualBounds.y}
          />
        ) : null}
    </Group>
  );
}
