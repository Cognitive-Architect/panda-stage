import { Circle, Group, Line, Shape, Text } from 'react-konva';
import type { CubicBezier2D, Point } from '../../../domain';

export interface CurveMotionStageDraft {
  projectInstanceId: number | null;
  revision: number;
  shotId: string;
  layerId: string;
  curve: CubicBezier2D;
  samples: readonly Point[];
  replaced: readonly Point[];
  fixedEnd: boolean;
  move(handle: 'p1' | 'p2' | 'p3', point: Point): void;
}

export function CurveMotionStageOverlay({ draft, scale }: {
  draft: CurveMotionStageDraft;
  scale: number;
}): React.JSX.Element {
  const { p0, p1, p2, p3 } = draft.curve;
  const unit = 1 / Math.max(0.05, scale);
  const accent = '#65e4a3';
  return <Group name="curve-motion-overlay">
    <Line points={[p0.x, p0.y, p1.x, p1.y]} stroke={accent} strokeWidth={unit} listening={false} />
    <Line points={[p3.x, p3.y, p2.x, p2.y]} stroke={accent} strokeWidth={unit} listening={false} />
    <Shape sceneFunc={(context, shape) => {
      context.beginPath();
      context.moveTo(p0.x, p0.y);
      context.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
      context.strokeShape(shape);
    }} stroke={accent} strokeWidth={2 * unit} listening={false} />
    {draft.samples.map(({ x, y }, index) =>
      <Circle key={index} x={x} y={y} radius={2.5 * unit} fill={accent} listening={false} />)}
    {draft.replaced.map(({ x, y }, index) =>
      <Circle key={index} x={x} y={y} radius={3 * unit} stroke="#ffbd82" strokeWidth={unit} listening={false} />)}
    {(['p0', 'p1', 'p2', 'p3'] as const).map((handle) => {
      const point = draft.curve[handle];
      const draggable = handle !== 'p0' && (handle !== 'p3' || !draft.fixedEnd);
      return <Group key={handle}>
        <Circle name={'curve-motion-' + handle} x={point.x} y={point.y} radius={6 * unit}
          hitStrokeWidth={10 * unit} stroke={accent} strokeWidth={2 * unit} fill={draggable ? '#164a39' : accent}
          draggable={draggable} onDragMove={(event) => {
            if (handle === 'p0' || !draggable) return;
            event.cancelBubble = true;
            draft.move(handle, event.target.position());
          }} />
        <Text text={handle.toUpperCase()} x={point.x + 9 * unit} y={point.y - 6 * unit}
          fontSize={12 * unit} fill={accent} listening={false} />
      </Group>;
    })}
  </Group>;
}
