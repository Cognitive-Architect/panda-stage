import { useEffect, useRef } from 'react';
import Konva from 'konva';
import { Transformer } from 'react-konva';
import {
  LAYER_MAX_SCALE,
  LAYER_MIN_SCALE,
} from '../../../domain';

export interface TransformerBox {
  width: number;
  height: number;
}

export interface TransformerOverlayState {
  selected: boolean;
  isBackground: boolean;
  locked: boolean;
  imageReady: boolean;
}

export function isTransformerOverlayVisible({
  selected,
  isBackground,
  locked,
  imageReady,
}: TransformerOverlayState): boolean {
  return selected && !isBackground && !locked && imageReady;
}

export function isTransformerBoxAllowed(
  oldBox: TransformerBox,
  newBox: TransformerBox,
  currentScale: number,
): boolean {
  if (
    !Number.isFinite(oldBox.width) ||
    !Number.isFinite(oldBox.height) ||
    !Number.isFinite(newBox.width) ||
    !Number.isFinite(newBox.height) ||
    !Number.isFinite(currentScale) ||
    oldBox.width === 0 ||
    oldBox.height === 0 ||
    newBox.width === 0 ||
    newBox.height === 0
  ) {
    return false;
  }
  const widthScale =
    Math.abs(newBox.width / oldBox.width) * Math.abs(currentScale);
  const heightScale =
    Math.abs(newBox.height / oldBox.height) * Math.abs(currentScale);
  return (
    widthScale >= LAYER_MIN_SCALE &&
    widthScale <= LAYER_MAX_SCALE &&
    heightScale >= LAYER_MIN_SCALE &&
    heightScale <= LAYER_MAX_SCALE
  );
}

export interface LayerTransformerProps {
  nodeRef: React.RefObject<Konva.Group | null>;
  selected: boolean;
  locked: boolean;
  scale: number;
}

export function LayerTransformer({
  nodeRef,
  selected,
  locked,
  scale,
}: LayerTransformerProps): React.JSX.Element | null {
  const transformerRef = useRef<Konva.Transformer>(null);

  useEffect(() => {
    const transformer = transformerRef.current;
    const node = nodeRef.current;
    if (!transformer) return;
    transformer.nodes(selected && !locked && node ? [node] : []);
    transformer.getLayer()?.batchDraw();
  }, [locked, nodeRef, selected]);

  if (!selected || locked) return null;
  return (
    <Transformer
      anchorFill="#e8fff0"
      anchorSize={18}
      anchorStroke="#235739"
      borderStroke="#83d39a"
      borderStrokeWidth={3}
      boundBoxFunc={(oldBox, newBox) =>
        isTransformerBoxAllowed(oldBox, newBox, scale)
          ? newBox
          : oldBox
      }
      enabledAnchors={[
        'top-left',
        'top-right',
        'bottom-left',
        'bottom-right',
      ]}
      flipEnabled={false}
      keepRatio
      name="layer-transformer"
      ref={transformerRef}
      rotateAnchorOffset={42}
      rotateEnabled
    />
  );
}
