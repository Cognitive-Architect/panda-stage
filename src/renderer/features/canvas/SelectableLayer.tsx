import Konva from 'konva';
import {
  Group,
  Image as KonvaImage,
  Rect,
} from 'react-konva';
import {
  clampLayerPosition,
  type Layer,
  type LayerTransformInput,
  type LayerVisualParts,
} from '../../../domain';
import type { StageLayerRenderInstruction } from '../../../shared/stage/layer-render-contract';
import type {
  PositionAuthoringCommitResult,
  PositionAuthoringSessionHandle,
} from '../../stores/positionAuthoringSessionStore';
import { canvasImageResourceKey } from './canvasImageResources';

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
  onPositionAuthoringCommit?: (result: PositionAuthoringCommitResult) => void;
  onError: (message: string) => void;
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
  onPositionAuthoringCommit = () => undefined,
  onError,
}: SelectableLayerProps): React.JSX.Element {
  const canSelect = true;
  const positionAuthoringEnabled = positionAuthoringSession !== null;
  const canMove =
    (directEditingEnabled || positionAuthoringEnabled) && !layer.locked;
  const canTransform = canMove;

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
  const compositeVisual = visual?.kind === 'composite-character';
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
    // complete Body+Face group first so the logical Character opacity is
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
      width={part.localRect.width}
      x={part.localRect.x}
      y={part.localRect.y}
    />
  );
  const orderedPartImages = resolvedPartImages.sort(
    (left, right) => left.part.drawOrder - right.part.drawOrder,
  );
  const renderedParts = completeVisualReady
    ? orderedPartImages.length === 1
      ? renderPart(orderedPartImages[0]!)
      : orderedPartImages.map(renderPart)
    : null;

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
      onClick={(event) =>
        stopAndSelect(event, layer.id, onSelect)
      }
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
        if (positionAuthoringSession || !directEditingEnabled) {
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
        {compositeVisual ? (
          <Group
            listening={canSelect}
            name="selectable-canvas-visual"
            ref={cacheCompositeVisual}
          >
            {renderedParts}
          </Group>
        ) : (
          renderedParts
        )}
        {compositeVisual && completeVisualReady
          ? orderedPartImages.map(({ part }) => (
              <Rect
                fill="#000000"
                height={part.localRect.height}
                key={`${part.partId}:hit`}
                listening={canSelect}
                name="composite-visual-hit-area"
                opacity={0}
                onClick={(event) =>
                  stopAndSelect(event, layer.id, onSelect)
                }
                onTap={(event) =>
                  stopAndSelect(event, layer.id, onSelect)
                }
                width={part.localRect.width}
                x={part.localRect.x}
                y={part.localRect.y}
              />
            ))
          : null}
        {selected && completeVisualReady ? (
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
