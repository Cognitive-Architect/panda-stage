import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from 'react';
import {
  calculateViewportTransform,
  isStagePointInside,
  screenToStage,
  type CanvasViewportMode,
  type Point,
  type ViewportTransform,
} from '../../../domain';
import type { AssetDropPayload } from '../assets/AssetDropPayload';
import {
  useCanvasDrop,
  type CanvasDropPreview,
} from './useCanvasDrop';

export interface CanvasViewportProps {
  mode: CanvasViewportMode;
  children: (transform: ViewportTransform) => ReactNode;
  dropDisabled?: boolean;
  onAssetDrop?: (payload: AssetDropPayload, point: Point) => void;
  onDropError?: (message: string) => void;
  onDropPreview?: (preview: CanvasDropPreview | null) => void;
  onStagePoint: (point: Point | null) => void;
  onTransform?: (transform: ViewportTransform) => void;
}

export function CanvasViewport({
  mode,
  children,
  dropDisabled = false,
  onAssetDrop = () => undefined,
  onDropError = () => undefined,
  onDropPreview = () => undefined,
  onStagePoint,
  onTransform,
}: CanvasViewportProps): React.JSX.Element {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [container, setContainer] = useState({
    width: 0,
    height: 0,
  });
  const transform = useMemo(
    () => calculateViewportTransform(container, mode),
    [container, mode],
  );
  const dropHandlers = useCanvasDrop({
    viewportRef,
    transform,
    disabled: dropDisabled,
    onPreview: onDropPreview,
    onDropAsset: onAssetDrop,
    onError: onDropError,
  });

  useLayoutEffect(() => {
    onTransform?.(transform);
  }, [onTransform, transform]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const update = (): void => {
      setContainer({
        width: viewport.clientWidth,
        height: viewport.clientHeight,
      });
    };
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    update();
    return () => observer.disconnect();
  }, []);

  const mapPointer = (event: PointerEvent<HTMLDivElement>): void => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const point = screenToStage(
      {
        x: event.clientX - rect.left + viewport.scrollLeft,
        y: event.clientY - rect.top + viewport.scrollTop,
      },
      transform,
    );
    onStagePoint(isStagePointInside(point, transform) ? point : null);
  };

  return (
    <div
      className={[
        'canvas-viewport',
        `canvas-viewport-${mode}`,
        dropHandlers.dragOver ? 'canvas-viewport-drag-over' : '',
      ].join(' ')}
      data-display-scale={transform.scale.toFixed(6)}
      data-logical-height={transform.logical.height}
      data-logical-width={transform.logical.width}
      data-offset-x={transform.offsetX.toFixed(3)}
      data-offset-y={transform.offsetY.toFixed(3)}
      data-testid="project-canvas-viewport"
      onDragEnter={dropHandlers.onDragEnter}
      onDragLeave={dropHandlers.onDragLeave}
      onDragOver={dropHandlers.onDragOver}
      onDrop={dropHandlers.onDrop}
      onPointerLeave={() => onStagePoint(null)}
      onPointerMove={mapPointer}
      ref={viewportRef}
    >
      <div
        className="canvas-viewport-content"
        style={{
          width: transform.contentWidth,
          height: transform.contentHeight,
        }}
      >
        <div
          className="canvas-logical-stage"
          data-testid="canvas-logical-stage"
          style={{
            left: transform.offsetX,
            top: transform.offsetY,
            transform: `scale(${transform.scale})`,
          }}
        >
          {children(transform)}
        </div>
      </div>
    </div>
  );
}
