import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Group, Rect, Circle, Line } from 'react-konva';
import type Konva from 'konva';
import { CHARACTER_PART_MIN_SCALE, CHARACTER_PART_MAX_SCALE, visualPartRenderTransform, type LayerVisualPart, type CharacterMotionValues } from '../../../domain';
import type { CharacterMotionGesture } from './characterMotionGesture';

export interface CharacterMotionCanvas {
  selectedPartId: string;
  contextKey: string;
  enabled: boolean;
  pivot(partId: string): { x: number; y: number };
  select(partId: string): void;
  begin(partId: string): CharacterMotionGesture;
  error(message: string): void;
}
type Kind = 'move' | 'rotate' | 'scale';
type Event = Konva.KonvaEventObject<MouseEvent | TouchEvent>;

/** #979 pointer-angle accumulation and local draft/one-commit gesture, source agnostic. */
export function CharacterMotionPart({ part, motion, owner, children }: {
  part: LayerVisualPart; motion: CharacterMotionCanvas; owner: React.RefObject<Konva.Group | null>; children: ReactNode;
}) {
  const partId = part.source.kind === 'adaptive-part' || part.source.kind === 'adaptive-part-fla-graphic' ? part.source.characterPartId : '';
  const selected = partId === motion.selectedPartId;
  const pivot = motion.pivot(partId);
  const [draft, setDraft] = useState({ dx: 0, dy: 0, rotation: 0, factor: 1 });
  const pointerDown = useRef<{ x: number; y: number } | null>(null);
  const capturePointer = (event: Event) => { event.cancelBubble = true; pointerDown.current = owner.current?.getRelativePointerPosition() ?? null; };
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
    const pointer = pointerDown.current ?? owner.current?.getRelativePointerPosition();
    if (!motion.enabled || !pointer) { event.target.stopDrag(); return; }
    try {
      gesture.current = { kind, session: motion.begin(partId), node: event.target, start: event.target.position(), pointer,
        angle: Math.atan2(pointer.y - pivot.y, pointer.x - pivot.x), rotation: 0,
        radius: Math.max(1, Math.hypot(pointer.x - pivot.x, pointer.y - pivot.y)), key: motion.contextKey, changes: {} };
    } catch (error) { event.target.stopDrag(); motion.error(error instanceof Error ? error.message : '无法编辑部件。'); }
  };
  const move = (event: Event) => {
    event.cancelBubble = true;
    const g = gesture.current, pointer = owner.current?.getRelativePointerPosition();
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
      const factor = Math.max(CHARACTER_PART_MIN_SCALE / Math.min(values['transform.scaleX'], values['transform.scaleY']), Math.min(CHARACTER_PART_MAX_SCALE / Math.max(values['transform.scaleX'], values['transform.scaleY']), ratio));
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
  const handles = (kind: Kind, x: number, y: number, fill: string) => <Circle
    name={`character-motion-${kind}`} key={kind} x={x} y={y} radius={9} fill={fill} stroke="#173d26" strokeWidth={2}
    draggable={motion.enabled} onMouseDown={capturePointer} onTouchStart={capturePointer} onDragStart={e => begin(kind, e)} onDragMove={move} onDragEnd={finish}
  />;
  return <>
    <Group x={pivot.x + draft.dx} y={pivot.y + draft.dy} offsetX={pivot.x} offsetY={pivot.y} rotation={draft.rotation} scaleX={draft.factor} scaleY={draft.factor}>
      <Group name="character-motion-part" draggable={selected && motion.enabled}
        onMouseDown={capturePointer} onTouchStart={capturePointer}
        onClick={e => { e.cancelBubble = true; motion.select(partId); }} onTap={e => { e.cancelBubble = true; motion.select(partId); }}
        onDragStart={e => begin('move', e)} onDragMove={move} onDragEnd={finish}>
        {children}
        <Rect {...visualPartRenderTransform(part)} width={part.localRect.width} height={part.localRect.height}
          fill="rgba(131,211,154,0.001)" stroke={selected ? '#83d39a' : undefined} strokeWidth={2} strokeScaleEnabled={false} />
      </Group>
    </Group>
    {selected ? <>
      <Line points={[pivot.x, pivot.y - 70, pivot.x, pivot.y, pivot.x + 70, pivot.y]} stroke="#83d39a" listening={false} />
      {handles('move', pivot.x, pivot.y, '#83d39a')}
      {handles('rotate', pivot.x, pivot.y - 70, '#dcecff')}
      {handles('scale', pivot.x + 70, pivot.y, '#fff0cc')}
    </> : null}
  </>;
}
