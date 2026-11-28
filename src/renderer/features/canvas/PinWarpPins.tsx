import { Circle } from 'react-konva';
import type Konva from 'konva';
import type { PinWarpPoint } from '../../../domain';

export interface PinWarpPinsProps {
  /** Evaluated (`at`) pin positions in Layer-local image pixels. */
  readonly pins: readonly PinWarpPoint[];
  readonly radius: number;
  readonly draggable: boolean;
  readonly onPreview: (pinIndex: number, point: PinWarpPoint) => void;
  readonly onCommit: (pinIndex: number, point: PinWarpPoint) => void;
}

/**
 * Editor handles for the bitmap pin-warp prototype (#1460).
 *
 * Handles are drawn at the *evaluated* pin positions, so hit-testing always
 * matches what the user sees. A drag previews through `onPreview` (transient,
 * never persisted); only pointer-up commits through `onCommit`. Every handler
 * stops bubbling so the owning Layer's position/transform drag never reacts to
 * a pin drag.
 */
export function PinWarpPins({
  pins,
  radius,
  draggable,
  onPreview,
  onCommit,
}: PinWarpPinsProps): React.JSX.Element {
  const stop = (event: Konva.KonvaEventObject<Event>): void => {
    event.cancelBubble = true;
  };
  return (
    <>
      {pins.map((pin, index) => (
        <Circle
          key={index}
          draggable={draggable}
          fill={draggable ? 'rgba(255, 209, 102, 0.35)' : 'rgba(255, 209, 102, 0.18)'}
          name="pin-warp-pin"
          onClick={stop}
          onDragEnd={(event) => {
            stop(event);
            onCommit(index, { x: event.target.x(), y: event.target.y() });
          }}
          onDragMove={(event) => {
            stop(event);
            onPreview(index, { x: event.target.x(), y: event.target.y() });
          }}
          onDragStart={stop}
          onTap={stop}
          radius={radius}
          stroke="#ffd166"
          strokeScaleEnabled={false}
          strokeWidth={2}
          x={pin.x}
          y={pin.y}
        />
      ))}
    </>
  );
}
