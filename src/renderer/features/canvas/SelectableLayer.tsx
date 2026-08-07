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

export interface SelectableLayerProps {
  image: HTMLImageElement;
  layer: Layer;
  nodeRef: React.RefObject<Konva.Group | null>;
  render: StageLayerRenderInstruction;
  selected: boolean;
  onSelect: (layerId: string) => void;
  onCommitPosition: (
    layerId: string,
    position: { x: number; y: number },
  ) => void;
  onCommitTransform: (
    layerId: string,
    transform: LayerTransformInput,
  ) => void;
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
  onSelect,
  onCommitPosition,
  onCommitTransform,
  onError,
}: SelectableLayerProps): React.JSX.Element {
  const canSelect = true;
  const canTransform = !layer.locked;

  const clampNode = (node: Konva.Node): void => {
    const position = clampLayerPosition({
      x: node.x(),
      y: node.y(),
    });
    node.position(position);
  };

  const resetNode = (node: Konva.Group): void => {
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
      onDragMove={(event) => clampNode(event.target)}
      onTap={(event) =>
        stopAndSelect(event, layer.id, onSelect)
      }
      opacity={render.opacity}
      onTransformEnd={(event) => {
        const node = event.target as Konva.Group;
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
