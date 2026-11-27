import { readCanvasControlColor } from './canvasControlColors';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Group, Rect, Circle, Line } from 'react-konva';
import type Konva from 'konva';
import {
  CHARACTER_NODE_MOTION_CAPABILITIES,
  CHARACTER_PART_MAX_SCALE,
  CHARACTER_PART_MIN_SCALE,
  transformPointByVisualPart,
  visualPartRenderTransform,
  type CharacterMotionValues,
  type CharacterNodeTransformCapabilities,
  type LayerVisualPart,
} from '../../../domain';
import type { CharacterMotionGesture } from './characterMotionGesture';

export interface CharacterMotionCanvas {
  selectedPartId: string | null;
  selectedTargetId?: string | null;
  contextKey: string;
  enabled: boolean;
  pivot(partId: string): { x: number; y: number };
  scaleBounds?(targetId: string): { min: number; max: number };
  capabilities?(targetId: string): CharacterNodeTransformCapabilities;
  select(partId: string): void;
  begin(partId: string): CharacterMotionGesture;
  error(message: string): void;
}
type Kind = 'move' | 'rotate' | 'scale';
type Event = Konva.KonvaEventObject<MouseEvent | TouchEvent>;

const rotationCursor = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M18 8a7 7 0 1 0 1 7M18 3v6h-6" fill="none" stroke="white" stroke-width="4"/><path d="M18 8a7 7 0 1 0 1 7M18 3v6h-6" fill="none" stroke="#173d26" stroke-width="2"/></svg>')}") 12 12, crosshair`;

/** #979 pointer-angle accumulation and local draft/one-commit gesture, source agnostic. */
export function CharacterMotionPart({
  part,
  targetId,
  capabilities,
  interactionBounds,
  motion,
  owner,
  pointerOwner,
  children,
}: {
  part: LayerVisualPart;
  targetId?: string;
  capabilities?: CharacterNodeTransformCapabilities;
  interactionBounds: LayerVisualPart['localRect'] | null;
  motion: CharacterMotionCanvas;
  owner: React.RefObject<Konva.Group | null>;
  pointerOwner?: React.RefObject<Konva.Group | null>;
  children: ReactNode;
}) {
  const partId =
    targetId ??
    (part.source.kind === 'adaptive-part' || part.source.kind === 'adaptive-part-fla-graphic'
      ? part.source.characterPartId
      : '');
  const activeSelectedId =
    motion.selectedTargetId !== undefined ? motion.selectedTargetId : motion.selectedPartId;
  const selected = Boolean(interactionBounds && partId && partId === activeSelectedId);
  const caps = capabilities ?? motion.capabilities?.(partId) ?? CHARACTER_NODE_MOTION_CAPABILITIES;
  const pivot = motion.pivot(partId);
  const [draft, setDraft] = useState({ dx: 0, dy: 0, rotation: 0, factor: 1 });
  const pointerDown = useRef<{ x: number; y: number } | null>(null);
  const relativePointer = () =>
    (pointerOwner?.current ? pointerOwner.current : owner.current)?.getRelativePointerPosition() ?? null;
  const capturePointer = (event: Event) => { event.cancelBubble = true; pointerDown.current = relativePointer(); };
  const gesture = useRef<{
    kind: Kind; session: CharacterMotionGesture; node: Konva.Node; start: { x: number; y: number };
    pointer: { x: number; y: number }; angle: number; rotation: number; radius: number; key: string;
    changes: Partial<CharacterMotionValues>;
  } | null>(null);
  const cancel = () => {
    const g = gesture.current;
    // stopDrag may synchronously emit dragend. Release ownership first.
    gesture.current = null;
    pointerDown.current = null;
    if (g) { g.node.stopDrag(); g.node.position(g.start); g.node.getLayer()?.batchDraw(); }
    setDraft({ dx: 0, dy: 0, rotation: 0, factor: 1 });
  };
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && gesture.current) { event.preventDefault(); cancel(); } };
    window.addEventListener('keydown', escape);
    return () => { window.removeEventListener('keydown', escape); const g = gesture.current; gesture.current = null; if (g) { g.node.stopDrag(); g.node.position(g.start); } };
  }, [motion.contextKey]);
  const begin = (kind: Kind, event: Event) => {
    event.cancelBubble = true;
    const pointer = pointerDown.current ?? relativePointer();
    if (!motion.enabled || !pointer) { event.target.stopDrag(); return; }
    try {
      gesture.current = { kind, session: motion.begin(partId), node: event.target, start: event.target.position(), pointer,
        angle: Math.atan2(pointer.y - pivot.y, pointer.x - pivot.x), rotation: 0,
        radius: Math.max(1, Math.hypot(pointer.x - pivot.x, pointer.y - pivot.y)), key: motion.contextKey, changes: {} };
    } catch (error) { event.target.stopDrag(); motion.error(error instanceof Error ? error.message : '无法编辑部件。'); }
  };
  const move = (event: Event) => {
    event.cancelBubble = true;
    const g = gesture.current, pointer = relativePointer();
    if (!g || !pointer) return;
    if (g.key !== motion.contextKey || !motion.enabled) { cancel(); return; }
    // Konva moves the dragged handle/group itself; the preview wrapper owns
    // the visual delta, so do not apply that translation twice.
    g.node.position(g.start);
    const values = g.session.values;
    if (g.kind === 'move') {
      const dx = pointer.x - g.pointer.x, dy = pointer.y - g.pointer.y;
      g.changes = { 'transform.offsetX': values['transform.offsetX'] + dx, 'transform.offsetY': values['transform.offsetY'] + dy };
      setDraft({ dx, dy, rotation: 0, factor: 1 });
    } else if (g.kind === 'rotate') {
      const angle = Math.atan2(pointer.y - pivot.y, pointer.x - pivot.x);
      let delta = angle - g.angle;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      g.rotation += delta; g.angle = angle;
      const rotation = g.rotation * 180 / Math.PI;
      g.changes = { 'transform.rotationDeg': values['transform.rotationDeg'] + rotation };
      setDraft({ dx: 0, dy: 0, rotation, factor: 1 });
    } else {
      const ratio = Math.hypot(pointer.x - pivot.x, pointer.y - pivot.y) / g.radius;
      const bounds = motion.scaleBounds?.(partId);
      const minScale = bounds?.min ?? CHARACTER_PART_MIN_SCALE;
      const maxScale = bounds?.max ?? CHARACTER_PART_MAX_SCALE;
      const factor = Math.max(minScale / Math.min(values['transform.scaleX'], values['transform.scaleY']), Math.min(maxScale / Math.max(values['transform.scaleX'], values['transform.scaleY']), ratio));
      g.changes = { 'transform.scaleX': values['transform.scaleX'] * factor, 'transform.scaleY': values['transform.scaleY'] * factor };
      setDraft({ dx: 0, dy: 0, rotation: 0, factor });
    }
  };
  const finish = (event: Event) => {
    event.cancelBubble = true;
    move(event);
    const g = gesture.current;
    cancel();
    if (!g) return;
    try { g.session.commit(g.changes); } catch (error) { motion.error(error instanceof Error ? error.message : '部件编辑失败。'); }
  };
  const unit = 1 / Math.max(0.01, Math.abs(owner.current?.getAbsoluteScale?.().x ?? 1));
  const selectionStroke = selected ? readCanvasControlColor('action-primary') : undefined;
  const bounds = interactionBounds ?? { x: 0, y: 0, width: 0, height: 0 };
  const x = bounds.x + (part.imageTransform ? 0 : part.localRect.x);
  const y = bounds.y + (part.imageTransform ? 0 : part.localRect.y);
  const corners = [[x, y], [x + bounds.width, y], [x + bounds.width, y + bounds.height], [x, y + bounds.height]]
    .map(([x, y]) => transformPointByVisualPart({ x: x!, y: y! }, part));
  const top = { x: (corners[0]!.x + corners[1]!.x) / 2, y: (corners[0]!.y + corners[1]!.y) / 2 };
  const normal = { x: top.x - (corners[2]!.x + corners[3]!.x) / 2, y: top.y - (corners[2]!.y + corners[3]!.y) / 2 };
  const length = Math.hypot(normal.x, normal.y) || 1;
  const rotationHandle = { x: top.x + normal.x / length * 28 * unit, y: top.y + normal.y / length * 28 * unit };
  const cursor = (event: Event, value: string, title = '') => {
    const container = event.target.getStage()?.container();
    if (container) { container.style.cursor = value; container.title = title; }
  };
  const handleEvents = (kind: 'rotate' | 'scale', cursorValue: string) => ({
    draggable: motion.enabled, onMouseDown: capturePointer, onTouchStart: capturePointer,
    onDragStart: (event: Event) => begin(kind, event), onDragMove: move, onDragEnd: finish,
    onMouseEnter: (event: Event) => cursor(event, cursorValue, kind === 'rotate' ? '旋转' : '缩放'),
    onMouseLeave: (event: Event) => cursor(event, 'default'),
  });
  return <Group x={pivot.x + draft.dx} y={pivot.y + draft.dy} offsetX={pivot.x} offsetY={pivot.y} rotation={draft.rotation} scaleX={draft.factor} scaleY={draft.factor}>
      <Group id={`${part.ownerLayerId}:${partId}:body`} name="character-motion-part" draggable={selected && motion.enabled && caps.position}
        onMouseDown={capturePointer} onTouchStart={capturePointer}
        onMouseEnter={e => cursor(e, selected ? (caps.position ? 'move' : 'default') : 'pointer')} onMouseLeave={e => cursor(e, 'default')}
        onClick={e => { e.cancelBubble = true; motion.select(partId); }} onTap={e => { e.cancelBubble = true; motion.select(partId); }}
        onDragStart={e => begin('move', e)} onDragMove={move} onDragEnd={finish}>
        {children}
        {interactionBounds && <Group {...visualPartRenderTransform(part)}>
          <Rect name="character-motion-hit" {...interactionBounds} fill="transparent" />
        </Group>}
      </Group>
    {selected ? <>
      <Line name="character-motion-selection" points={corners.flatMap(p => [p.x, p.y])} closed stroke={selectionStroke} strokeWidth={unit} listening={false} />
      {caps.rotation ? (
        <Line points={[top.x, top.y, rotationHandle.x, rotationHandle.y]} stroke={selectionStroke} strokeWidth={unit} listening={false} />
      ) : null}
      {caps.uniformScale ? corners.map((point, index) => <Rect key={index} name={index === 0 ? 'character-motion-scale' : `character-motion-scale-${index}`}
        x={point.x} y={point.y} offsetX={5 * unit} offsetY={5 * unit} width={10 * unit} height={10 * unit}
        fill="#eef6f0" stroke={selectionStroke} strokeWidth={unit} hitStrokeWidth={16 * unit}
        {...handleEvents('scale', index % 2 ? 'nesw-resize' : 'nwse-resize')} />) : null}
      {caps.rotation ? (
        <Circle name="character-motion-rotate" {...rotationHandle} radius={6 * unit} fill="#eef6f0" stroke={selectionStroke} strokeWidth={unit} hitStrokeWidth={16 * unit}
          {...handleEvents('rotate', rotationCursor)} />
      ) : null}
      <Line name="character-motion-pivot" points={[pivot.x - 4 * unit, pivot.y, pivot.x + 4 * unit, pivot.y, pivot.x, pivot.y, pivot.x, pivot.y - 4 * unit, pivot.x, pivot.y + 4 * unit]}
        stroke={selectionStroke} strokeWidth={unit} opacity={0.55} listening={false} />
    </> : null}
  </Group>;
}
