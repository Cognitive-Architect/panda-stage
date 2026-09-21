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
} from '../../../domain';
import type { StageLayerRenderInstruction } from '../../../shared/stage/layer-render-contract';
import type {
  PositionAuthoringCommitResult,
  PositionAuthoringSessionHandle,
} from '../../stores/positionAuthoringSessionStore';

interface Point {
  readonly x: number;
  readonly y: number;
}

export interface SelectableLayerProps {
  image: HTMLImageElement;
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
  layer,
  nodeRef,
  render,
  selected,
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
        <KonvaImage
        height={render.height}
        image={image}
        listening={canSelect}
        offsetX={render.offsetX}
        offsetY={render.offsetY}
        width={render.width}
        />
        {selected ? (
          <Rect
          dash={layer.locked ? [18, 12] : undefined}
          height={render.height}
          listening={false}
          offsetX={render.offsetX}
          offsetY={render.offsetY}
          stroke={layer.locked ? '#ffd166' : '#83d39a'}
          strokeWidth={4}
          width={render.width}
          />
        ) : null}
    </Group>
  );
}
