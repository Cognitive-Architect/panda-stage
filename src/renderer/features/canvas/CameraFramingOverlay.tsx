import { Group, Line, Rect } from 'react-konva';
import type Konva from 'konva';
import {
  cameraViewFromCenter,
  SHOT_CAMERA_MAX_ZOOM,
  type CameraView,
} from '../../../domain';

export interface CameraFramingOverlayProps {
  readonly view: CameraView;
  readonly stageWidth: number;
  readonly stageHeight: number;
  readonly onChange: (view: CameraView) => void;
  /** Wheel zoom step, kept in one place so both axes stay symmetric. */
  readonly zoomStep?: number;
}

const FRAMING_STROKE = '#8fe2a9';
const FRAMING_OPACITY = 0.9;

/**
 * The authoring framing box. It is drawn in logical stage coordinates, above
 * the content layer, and only while the camera tool is open, so it never
 * blocks ordinary layer editing or lingers after the tool closes.
 */
export function CameraFramingOverlay({
  view,
  stageWidth,
  stageHeight,
  onChange,
  zoomStep = 1.1,
}: CameraFramingOverlayProps): React.JSX.Element {
  const width = stageWidth / view.zoom;
  const height = stageHeight / view.zoom;
  const x = view.centerX - width / 2;
  const y = view.centerY - height / 2;

  const commitFrom = (centerX: number, centerY: number, zoom: number): void => {
    onChange(
      cameraViewFromCenter(centerX, centerY, zoom, stageWidth, stageHeight),
    );
  };

  const handleDragEnd = (event: Konva.KonvaEventObject<DragEvent>): void => {
    const node = event.target;
    commitFrom(node.x() + width / 2, node.y() + height / 2, view.zoom);
  };

  const handleWheel = (event: Konva.KonvaEventObject<WheelEvent>): void => {
    event.evt.preventDefault();
    const direction = event.evt.deltaY > 0 ? 1 / zoomStep : zoomStep;
    commitFrom(
      view.centerX,
      view.centerY,
      Math.min(SHOT_CAMERA_MAX_ZOOM, view.zoom * direction),
    );
  };

  return (
    <Group listening name="camera-framing-overlay">
      <Rect
        draggable
        fillEnabled={false}
        height={height}
        name="camera-framing-box"
        onDragEnd={handleDragEnd}
        onWheel={handleWheel}
        stroke={FRAMING_STROKE}
        strokeWidth={2 / view.zoom}
        width={width}
        x={x}
        y={y}
      />
      <Line
        listening={false}
        points={[
          x + width / 2,
          y,
          x + width / 2,
          y + height,
          x,
          y + height / 2,
          x + width,
          y + height / 2,
        ]}
        stroke={FRAMING_STROKE}
        strokeOpacity={FRAMING_OPACITY * 0.4}
        strokeWidth={1 / view.zoom}
      />
    </Group>
  );
}
