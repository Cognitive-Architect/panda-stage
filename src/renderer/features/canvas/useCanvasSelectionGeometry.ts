import { useLayoutEffect, useRef, useState } from 'react';
import type Konva from 'konva';
import { stageToScreen, type ViewportTransform } from '../../../domain';

export interface CanvasSelectionGeometry {
  target: string;
  bounds: { x: number; y: number; width: number; height: number };
  manipulating: boolean;
  rotationHandle?: { x: number; y: number };
}

export function useCanvasSelectionGeometry(
  target: string | null,
  nodeRef: React.RefObject<Konva.Group | null> | null,
  transform: ViewportTransform,
): CanvasSelectionGeometry | null {
  const [geometry, setGeometry] = useState<CanvasSelectionGeometry | null>(null);
  const manipulating = useRef<Konva.Group | null>(null);

  const measure = () => {
    const node = nodeRef?.current;
    const stage = node?.getStage();
    if (!target || !node || !stage || !node.isVisible() || transform.scale <= 0) {
      setGeometry(null);
      return;
    }
    const rect = node.getClientRect({ relativeTo: stage, skipStroke: true, skipShadow: true });
    const transformer = stage.findOne<Konva.Transformer>('.layer-transformer');
    const rotationNode = transformer?.nodes().includes(node)
      ? transformer.findOne('.rotater') : stage.findOne('.parent-layer-rotate');
    const rotationHandle = rotationNode ? stageToScreen(rotationNode.getAbsolutePosition(stage), transform) : undefined;
    const origin = stageToScreen(rect, transform);
    const bounds = { ...origin, width: rect.width * transform.scale, height: rect.height * transform.scale };
    const active = node.isDragging() || manipulating.current === node;
    setGeometry(previous => previous?.target === target && previous.manipulating === active &&
      previous.bounds.x === bounds.x && previous.bounds.y === bounds.y &&
      previous.bounds.width === bounds.width && previous.bounds.height === bounds.height &&
      previous.rotationHandle?.x === rotationHandle?.x && previous.rotationHandle?.y === rotationHandle?.y
      ? previous : { target, bounds, manipulating: active, rotationHandle });
  };

  // React commits evaluated node positions before measuring. Konva gestures
  // update the same nodes between React commits.
  useLayoutEffect(measure);
  useLayoutEffect(() => {
    const node = nodeRef?.current;
    if (!node || !target) return;
    const start = () => { manipulating.current = node; measure(); };
    const end = () => { manipulating.current = null; measure(); };
    node.on('dragstart.selectionGeometry transformstart.selectionGeometry canvasgesturestart.selectionGeometry', start);
    node.on('dragmove.selectionGeometry transform.selectionGeometry canvasgesturemove.selectionGeometry', measure);
    node.on('dragend.selectionGeometry transformend.selectionGeometry canvasgestureend.selectionGeometry', end);
    return () => { node.off('.selectionGeometry'); };
  });
  return geometry?.target === target ? geometry : null;
}
