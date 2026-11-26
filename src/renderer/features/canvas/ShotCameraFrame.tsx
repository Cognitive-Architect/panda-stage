import { useRef, useState } from 'react';
import type Konva from 'konva';
import { Circle, Group, Line, Rect } from 'react-konva';
import { PROJECT_HEIGHT, PROJECT_WIDTH, type Point } from '../../../domain';
import type { ManualCameraPose } from '../../../domain/models/shotCamera';

type Handle = 'move' | 'zoom' | 'rotate';
type Pointer = Konva.KonvaEventObject<PointerEvent>;

export function ShotCameraFrame({ pose, onCommit }: {
  pose: ManualCameraPose;
  onCommit: (pose: ManualCameraPose) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState<ManualCameraPose | null>(null);
  const drag = useRef<{
    handle: Handle; id: number; start: Point; origin: ManualCameraPose;
    current: ManualCameraPose; angle: number; turn: number;
  } | null>(null);
  const current = draft ?? pose;
  const radians = current.rotationDeg * Math.PI / 180;
  const halfWidth = PROJECT_WIDTH / 2 / current.zoom;
  const halfHeight = PROJECT_HEIGHT / 2 / current.zoom;
  function point(x: number, y: number): Point {
    return {
      x: Math.min(PROJECT_WIDTH - 21, Math.max(21, current.centerX + x * Math.cos(radians) - y * Math.sin(radians))),
      y: Math.min(PROJECT_HEIGHT - 21, Math.max(21, current.centerY + x * Math.sin(radians) + y * Math.cos(radians))),
    };
  }
  function angle(p: Point, base: ManualCameraPose): number {
    return Math.atan2(p.y - base.centerY, p.x - base.centerX);
  }
  function begin(event: Pointer, handle: Handle) {
    const start = event.target.getStage()?.getPointerPosition();
    if (!start || drag.current || event.evt.button !== 0) return;
    event.cancelBubble = true;
    const id = event.evt.pointerId;
    (event.target as Konva.Shape).setPointerCapture(id);
    (event.evt.target as Element | null)?.setPointerCapture?.(id);
    drag.current = { handle, id, start, origin: pose, current: pose, angle: angle(start, pose), turn: 0 };
  }
  function move(event: Pointer) {
    const active = drag.current;
    const target = event.target.getStage()?.getPointerPosition();
    if (!active || active.id !== event.evt.pointerId || !target) return;
    const { origin, start } = active;
    const delta = { x: target.x - start.x, y: target.y - start.y };
    let next = origin;
    if (active.handle === 'move') {
      next = { ...origin, centerX: origin.centerX + delta.x, centerY: origin.centerY + delta.y };
    } else if (active.handle === 'zoom') {
      const radius = Math.hypot(start.x - origin.centerX, start.y - origin.centerY);
      const distance = Math.hypot(target.x - origin.centerX, target.y - origin.centerY);
      const zoom = origin.zoom * (radius / Math.max(1, distance));
      if (zoom > 0) next = { ...origin, zoom };
    } else {
      const nextAngle = angle(target, origin);
      const change = nextAngle - active.angle;
      active.turn += Math.atan2(Math.sin(change), Math.cos(change));
      active.angle = nextAngle;
      next = { ...origin, rotationDeg: origin.rotationDeg + active.turn * 180 / Math.PI };
    }
    if (!Object.values(next).every(Number.isFinite)) return;
    active.current = next;
    setDraft(next);
  }
  function end(event: Pointer, commit: boolean) {
    const active = drag.current;
    if (!active || active.id !== event.evt.pointerId) return;
    drag.current = null;
    setDraft(null);
    if (commit && (['centerX', 'centerY', 'zoom', 'rotationDeg'] as const)
      .some((key) => Math.abs(active.current[key] - active.origin[key]) > 1e-6)) onCommit(active.current);
  }
  const zoomHandle = point(halfWidth * 0.82, -halfHeight * 0.76);
  const rotateHandle = point(0, -halfHeight * 0.86);
  return (
    <Group name="shot-camera-frame" onPointerMove={move} onPointerUp={(event) => end(event, true)}
      onPointerCancel={(event) => end(event, false)}>
      <Rect width={PROJECT_WIDTH} height={PROJECT_HEIGHT} fill="rgba(0,0,0,0.001)"
        onPointerDown={(event) => begin(event, 'move')} />
      <Group x={current.centerX} y={current.centerY} rotation={current.rotationDeg} listening={false}>
        <Rect x={-halfWidth} y={-halfHeight} width={halfWidth * 2} height={halfHeight * 2}
          stroke="#efad50" strokeWidth={4} />
        <Line points={[-14, 0, 14, 0]} stroke="#efad50" strokeWidth={3} />
        <Line points={[0, -14, 0, 14]} stroke="#efad50" strokeWidth={3} />
      </Group>
      <Rect name="shot-camera-zoom" x={zoomHandle.x - 15} y={zoomHandle.y - 15} width={30} height={30}
        stroke="#efad50" strokeWidth={4} fill="#25201b" onPointerDown={(event) => begin(event, 'zoom')} />
      <Circle name="shot-camera-rotate" {...rotateHandle} radius={15} stroke="#efad50" strokeWidth={4}
        fill="#25201b" onPointerDown={(event) => begin(event, 'rotate')} />
    </Group>
  );
}
