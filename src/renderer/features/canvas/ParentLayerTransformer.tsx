import { useEffect, useRef, useState } from 'react';
import type Konva from 'konva';
import { Circle, Group, Rect } from 'react-konva';
import type { LayerDisplayTransformPatch, Point } from '../../../domain';
import { LAYER_MAX_SCALE, LAYER_MIN_SCALE } from '../../../domain';
import type { StageLayerRenderInstruction } from '../../../shared/stage/layer-render-contract';
import type { VisualLocalRect } from '../../../domain';

/** Transform handles operate in the evaluated parent plane, keeping its affine shear intact. */
export function ParentLayerTransformer({ nodeRef, render, rootScale, bounds, onCommit, selectionAccent }: {
  nodeRef: React.RefObject<Konva.Group | null>;
  render: StageLayerRenderInstruction;
  rootScale: Pick<StageLayerRenderInstruction, 'scaleX' | 'scaleY'>;
  bounds: VisualLocalRect;
  selectionAccent?: string;
  onCommit: (patch: LayerDisplayTransformPatch) => void;
}): React.JSX.Element {
  const controls = useRef<Konva.Group>(null);
  const [draft, setDraft] = useState({ scale: 1, turn: 0 });
  const gesture = useRef<{
    pointer: number; mode: 'rotate' | 'scale'; start: Point;
    angle: number; turn: number; scale: number;
  } | null>(null);
  const local = () => controls.current?.getParent()?.getRelativePointerPosition();
  const bearing = (p: Point) => Math.atan2(p.y - render.y, p.x - render.x);
  const restore = () => {
    const node = nodeRef.current;
    node?.scale({ x: render.scaleX, y: render.scaleY });
    node?.rotation(render.rotationDeg);
  };
  useEffect(() => () => {
    if (!gesture.current) return;
    const node = nodeRef.current;
    node?.scale({ x: render.scaleX, y: render.scaleY });
    node?.rotation(render.rotationDeg);
  }, [nodeRef, render.rotationDeg, render.scaleX, render.scaleY]);
  const begin = (event: Konva.KonvaEventObject<PointerEvent>, mode: 'rotate' | 'scale') => {
    const start = local();
    if (!start || event.evt.button !== 0 || gesture.current) return;
    event.cancelBubble = true;
    const pointer = event.evt.pointerId;
    (event.target as Konva.Shape).setPointerCapture(pointer);
    (event.evt.target as Element | null)?.setPointerCapture?.(pointer);
    gesture.current = { pointer, mode, start, angle: bearing(start), scale: 1, turn: 0 };
  };
  const move = (event: Konva.KonvaEventObject<PointerEvent>) => {
    const active = gesture.current;
    const p = local();
    if (!active || !p || active.pointer !== event.evt.pointerId) return;
    if (active.mode === 'rotate') {
      const next = bearing(p);
      const delta = next - active.angle;
      active.angle = next;
      active.turn += Math.atan2(Math.sin(delta), Math.cos(delta)) * 180 / Math.PI;
    } else {
      const radius = Math.hypot(active.start.x - render.x, active.start.y - render.y);
      if (radius <= 0) return;
      const ratio = Math.hypot(p.x - render.x, p.y - render.y) / radius;
      const x = Math.abs(rootScale.scaleX);
      const y = Math.abs(rootScale.scaleY);
      active.scale = Math.max(LAYER_MIN_SCALE / Math.min(x, y), Math.min(LAYER_MAX_SCALE / Math.max(x, y), ratio));
    }
    nodeRef.current?.scale({ x: render.scaleX * active.scale, y: render.scaleY * active.scale });
    nodeRef.current?.rotation(render.rotationDeg + active.turn);
    setDraft({ scale: active.scale, turn: active.turn });
  };
  const end = (event: Konva.KonvaEventObject<PointerEvent>, commit: boolean) => {
    const active = gesture.current;
    if (active?.pointer !== event.evt.pointerId) return;
    gesture.current = null;
    restore();
    setDraft({ scale: 1, turn: 0 });
    if (!commit) return;
    if (active.mode === 'rotate' && Math.abs(active.turn) > 1e-6) {
      onCommit({ rotationDeg: render.rotationDeg + active.turn });
    } else if (active.mode === 'scale' && Math.abs(active.scale - 1) > 1e-6) {
      onCommit({ scaleX: Math.abs(render.scaleX) * active.scale, scaleY: Math.abs(render.scaleY) * active.scale });
    }
  };
  const width = Math.abs(render.scaleX) * bounds.width * draft.scale;
  const height = Math.abs(render.scaleY) * bounds.height * draft.scale;
  const left = Math.min(bounds.x * render.scaleX, (bounds.x + bounds.width) * render.scaleX) * draft.scale;
  const top = Math.min(bounds.y * render.scaleY, (bounds.y + bounds.height) * render.scaleY) * draft.scale;
  return (
    <Group ref={controls} x={render.x} y={render.y} rotation={render.rotationDeg + draft.turn}
      name="parent-layer-transformer" onPointerMove={move} onPointerUp={(event) => end(event, true)}
      onPointerCancel={(event) => end(event, false)}>
      <Rect x={left} y={top} width={width} height={height} stroke={selectionAccent ?? '#83d39a'} strokeWidth={3} listening={false} />
      <Rect name="parent-layer-scale" x={left + width - 12} y={top + height - 12} width={24} height={24} fill={selectionAccent ? '#e3e7ed' : '#e8fff0'}
        stroke={selectionAccent ?? '#235739'} strokeWidth={3} onPointerDown={(event) => begin(event, 'scale')} />
      <Circle name="parent-layer-rotate" x={left + width / 2} y={top - 42} radius={13} fill={selectionAccent ? '#e3e7ed' : '#e8fff0'}
        stroke={selectionAccent ?? '#235739'} strokeWidth={3} onPointerDown={(event) => begin(event, 'rotate')} />
    </Group>
  );
}
