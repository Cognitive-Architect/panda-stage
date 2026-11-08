import { Group, Line, Rect, Text } from 'react-konva';
import type Konva from 'konva';
import {
  cameraViewFromCenter,
  stepShotCameraZoom,
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
const ZOOM_CONTROL_SIZE = 32;
const ZOOM_CONTROL_GAP = 4;

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

  /** One zoom path for wheel and the visible touch controls. */
  const zoomBy = (factor: number): void => {
    commitFrom(
      view.centerX,
      view.centerY,
      stepShotCameraZoom(view.zoom, factor),
    );
  };

  const handleWheel = (event: Konva.KonvaEventObject<WheelEvent>): void => {
    event.evt.preventDefault();
    zoomBy(event.evt.deltaY > 0 ? 1 / zoomStep : zoomStep);
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
      {/* Minimal visible zoom controls: tap/click works on touch as well as
          mouse; no gesture recognizer, same clamp as the wheel. */}
      {[
        { name: 'camera-framing-zoom-in', label: '+', factor: zoomStep },
        { name: 'camera-framing-zoom-out', label: '−', factor: 1 / zoomStep },
      ].map((control, index) => (
        <Group
          key={control.name}
          listening
          name={control.name}
          onClick={() => zoomBy(control.factor)}
          onTap={() => zoomBy(control.factor)}
          x={
            x + width - (ZOOM_CONTROL_SIZE + ZOOM_CONTROL_GAP) * 2 +
            index * (ZOOM_CONTROL_SIZE + ZOOM_CONTROL_GAP)
          }
          y={y + 8}
        >
          <Rect
            fill="#12291b"
            height={ZOOM_CONTROL_SIZE}
            stroke={FRAMING_STROKE}
            strokeWidth={1}
            width={ZOOM_CONTROL_SIZE}
          />
          <Text
            align="center"
            fill={FRAMING_STROKE}
            fontSize={20}
            height={ZOOM_CONTROL_SIZE}
            listening={false}
            text={control.label}
            verticalAlign="middle"
            width={ZOOM_CONTROL_SIZE}
          />
        </Group>
      ))}
    </Group>
  );
}
