import { useRef, useState, type PointerEvent } from 'react';
import { PROJECT_HEIGHT, PROJECT_WIDTH } from '../../../domain';
import { canvasStagePointer } from './canvasStagePointer';
import type { CharacterArmAssembly } from './CharacterArmTool';
import './character-arm-assembly.css';

const PART_NAMES = ['上臂', '前臂', '手部'];
const JOINT_NAMES = ['肩', '肘', '腕', '末端'];
const KEYBOARD_OFFSET: Readonly<Record<string, Point>> = {
  ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 },
};

export function characterArmAssemblyPrompt({ chain, nextPoint }: CharacterArmAssembly): string {
  const missing = chain.segments.findIndex(({ partId }) => !partId);
  if (missing >= 0) return `选择${PART_NAMES[missing]}`;
  return nextPoint <= chain.segments.length ? `定位${JOINT_NAMES[nextPoint]}` : '拖动关节微调';
}

type Point = { x: number; y: number };

interface Gesture {
  pointerId: number;
  origin: Point;
  index?: number;
  offset: Point;
}

export function CharacterArmAssemblyOverlay({ assembly, scale, update }: {
  assembly: CharacterArmAssembly;
  scale: number;
  update: (next: CharacterArmAssembly) => void;
}): React.JSX.Element {
  const [dragPoint, setDragPoint] = useState<Point>();
  const gesture = useRef<Gesture | undefined>(undefined);
  const { chain, parts, nextPoint } = assembly;
  const complete = chain.segments.every(({ partId }) => parts.has(partId));
  const owners = [...chain.segments.map(({ partId }) => partId), chain.segments.at(-1)!.partId];
  const points = [...chain.segments.map(({ joint }) => joint), chain.tip].map((point, index) =>
    gesture.current?.index === index && dragPoint ? dragPoint : parts.get(owners[index]!)?.toStage(point));
  const pendingPoint = complete && nextPoint < points.length;

  function stagePoint(event: PointerEvent): Point | undefined {
    const stage = event.currentTarget.closest('[data-testid="project-canvas-stage"]');
    return stage ? canvasStagePointer(stage, event) : undefined;
  }

  function start(event: PointerEvent<HTMLElement>, index?: number): void {
    if (!event.isPrimary || event.button !== 0 || gesture.current) return;
    const origin = stagePoint(event);
    if (!origin) return;
    event.stopPropagation();
    event.preventDefault();
    const marker = index === undefined ? undefined : points[index];
    gesture.current = {
      pointerId: event.pointerId, origin, index,
      offset: marker ? { x: marker.x - origin.x, y: marker.y - origin.y } : { x: 0, y: 0 },
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function move(event: PointerEvent): void {
    const drag = gesture.current;
    if (!drag || drag.pointerId !== event.pointerId || drag.index === undefined) return;
    const point = stagePoint(event);
    if (point) setDragPoint({ x: point.x + drag.offset.x, y: point.y + drag.offset.y });
  }

  function finish(event: PointerEvent, accepted: boolean): void {
    const drag = gesture.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    gesture.current = undefined;
    setDragPoint(undefined);
    if (!accepted) return;
    const point = stagePoint(event);
    if (!point) return;
    const moved = Math.hypot(point.x - drag.origin.x, point.y - drag.origin.y) * scale > 5;
    if (drag.index === undefined ? moved : !moved && drag.index !== nextPoint) return;
    const index = drag.index ?? nextPoint;
    const stagePosition = moved ? { x: point.x + drag.offset.x, y: point.y + drag.offset.y } : point;
    setPoint(index, stagePosition, index === nextPoint);
  }

  function setPoint(index: number, stagePosition: Point, advance: boolean): void {
    const local = parts.get(owners[index]!)?.toPart(stagePosition);
    if (!local) return;
    update({
      ...assembly,
      chain: index === chain.segments.length ? { ...chain, tip: local } : {
        ...chain, segments: chain.segments.map((segment, i) => i === index ? { ...segment, joint: local } : segment),
      },
      nextPoint: advance ? nextPoint + 1 : nextPoint,
    });
  }

  return <div className="character-arm-assembly" data-testid="character-arm-assembly">
    {pendingPoint ? <div className="character-arm-placement" data-testid="character-arm-placement"
      onPointerDown={event => start(event)} onPointerUp={event => finish(event, true)}
      onPointerCancel={event => finish(event, false)} onLostPointerCapture={event => finish(event, false)} /> : null}
    <svg width={PROJECT_WIDTH} height={PROJECT_HEIGHT} aria-hidden="true">
      {points.slice(1).map((point, index) => {
        const previous = points[index];
        return point && previous ? <line key={index} x1={previous.x} y1={previous.y} x2={point.x} y2={point.y}
          vectorEffect="non-scaling-stroke" /> : null;
      })}
    </svg>
    {points.map((point, index) => point ? <button key={index} type="button"
      className="character-arm-joint" data-testid={`character-arm-joint-${index}`}
      data-current={pendingPoint && index === nextPoint} data-canvas-interactive-chrome="true"
      disabled={pendingPoint && index !== nextPoint}
      aria-label={JOINT_NAMES[index]} title={JOINT_NAMES[index]}
      style={{ left: point.x, top: point.y, transform: `translate(-50%, -50%) scale(${1 / scale})` }}
      onPointerDown={event => start(event, index)} onPointerMove={move}
      onPointerUp={event => finish(event, true)} onPointerCancel={event => finish(event, false)}
      onLostPointerCapture={event => finish(event, false)}
      onKeyDown={event => {
        const offset = KEYBOARD_OFFSET[event.key];
        if (!offset) return;
        event.preventDefault();
        event.stopPropagation();
        const step = event.shiftKey ? 10 : 1;
        setPoint(index, { x: point.x + offset.x * step, y: point.y + offset.y * step }, false);
      }}
      onClick={event => {
        if (event.detail === 0 && pendingPoint && index === nextPoint) update({ ...assembly, nextPoint: nextPoint + 1 });
      }} /> : null)}
  </div>;
}
