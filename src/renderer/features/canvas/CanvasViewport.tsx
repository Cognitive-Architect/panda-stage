import {
  useCallback,
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
  viewportOverlay?: ReactNode;
  viewportChrome?: ReactNode;
  dropDisabled?: boolean;
  onAssetDrop?: (payload: AssetDropPayload, point: Point) => void;
  onDropError?: (message: string) => void;
  onDropPreview?: (preview: CanvasDropPreview | null) => void;
  onStagePoint: (point: Point | null) => void;
  onTransform?: (transform: ViewportTransform) => void;
  onViewportChromePointerDown?: () => void;
}

export interface ViewportPanStart {
  clientX: number;
  clientY: number;
  scrollLeft: number;
  scrollTop: number;
  pointerId: number;
}

export function calculateViewportPanScrollPosition(
  start: ViewportPanStart,
  current: Pick<ViewportPanStart, 'clientX' | 'clientY'>,
): { left: number; top: number } {
  return {
    left: start.scrollLeft - (current.clientX - start.clientX),
    top: start.scrollTop - (current.clientY - start.clientY),
  };
}

export function isViewportChromePointerTarget<T>(
  target: T | null,
  isInsideLogicalStage: (target: T) => boolean,
): boolean {
  return target !== null && !isInsideLogicalStage(target);
}

export function CanvasViewport({
  mode,
  children,
  viewportOverlay = null,
  viewportChrome = null,
  dropDisabled = false,
  onAssetDrop = () => undefined,
  onDropError = () => undefined,
  onDropPreview = () => undefined,
  onStagePoint,
  onTransform,
  onViewportChromePointerDown = () => undefined,
}: CanvasViewportProps): React.JSX.Element {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [container, setContainer] = useState({
    width: 0,
    height: 0,
  });
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [panActive, setPanActive] = useState(false);
  const pointerInsideRef = useRef(false);
  const spaceHeldRef = useRef(false);
  const panRef = useRef<ViewportPanStart | null>(null);
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

  const endPan = useCallback((pointerId?: number): void => {
    const pan = panRef.current;
    if (!pan || (pointerId !== undefined && pan.pointerId !== pointerId)) {
      return;
    }
    panRef.current = null;
    setPanActive(false);
    const viewport = viewportRef.current;
    if (viewport?.hasPointerCapture(pan.pointerId)) {
      viewport.releasePointerCapture(pan.pointerId);
    }
  }, []);

  const releaseSpace = useCallback((): void => {
    spaceHeldRef.current = false;
    setSpaceHeld(false);
    endPan();
  }, [endPan]);

  useLayoutEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (
        mode !== 'actual' ||
        (event.code !== 'Space' && event.key !== ' ') ||
        isEditableTarget(event.target) ||
        !pointerInsideRef.current
      ) {
        return;
      }
      if (!spaceHeldRef.current) {
        spaceHeldRef.current = true;
        setSpaceHeld(true);
      }
      event.preventDefault();
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.code !== 'Space' && event.key !== ' ') return;
      if (!spaceHeldRef.current) return;
      event.preventDefault();
      releaseSpace();
    };
    const onWindowBlur = (): void => releaseSpace();

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onWindowBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onWindowBlur);
      releaseSpace();
    };
  }, [mode, releaseSpace]);

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

  const handlePointerDown = (
    event: PointerEvent<HTMLDivElement>,
  ): void => {
    const logicalStage = event.currentTarget.querySelector(
      '.canvas-logical-stage',
    );
    const target = event.target;
    if (!logicalStage || !(target instanceof Node)) return;
    if (
      isViewportChromePointerTarget(target, (candidate) =>
        logicalStage.contains(candidate),
      )
    ) {
      onViewportChromePointerDown();
    }
  };

  const handlePointerDownCapture = (
    event: PointerEvent<HTMLDivElement>,
  ): void => {
    if (
      mode !== 'actual' ||
      !spaceHeldRef.current ||
      event.button !== 0 ||
      event.pointerType !== 'mouse' ||
      panRef.current
    ) {
      return;
    }
    const viewport = viewportRef.current;
    if (!viewport) return;
    panRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
      pointerId: event.pointerId,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
    };
    setPanActive(true);
    viewport.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const pan = panRef.current;
    if (pan?.pointerId === event.pointerId) {
      const viewport = viewportRef.current;
      if (viewport) {
        const next = calculateViewportPanScrollPosition(pan, event);
        viewport.scrollLeft = next.left;
        viewport.scrollTop = next.top;
      }
      event.preventDefault();
      event.stopPropagation();
    }
    mapPointer(event);
  };

  const finishPan = (event: PointerEvent<HTMLDivElement>): void => {
    if (panRef.current?.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    endPan(event.pointerId);
  };

  return (
    <div
      className={[
        'canvas-viewport',
        `canvas-viewport-${mode}`,
        mode === 'actual' && spaceHeld ? 'canvas-viewport-space-held' : '',
        panActive ? 'canvas-viewport-panning' : '',
        dropHandlers.dragOver ? 'canvas-viewport-drag-over' : '',
      ].join(' ')}
      data-display-scale={transform.scale.toFixed(6)}
      data-logical-height={transform.logical.height}
      data-logical-width={transform.logical.width}
      data-offset-x={transform.offsetX.toFixed(3)}
      data-offset-y={transform.offsetY.toFixed(3)}
      data-pan-active={String(panActive)}
      data-pan-available={String(mode === 'actual' && spaceHeld)}
      data-testid="project-canvas-viewport"
      onDragEnter={dropHandlers.onDragEnter}
      onDragLeave={dropHandlers.onDragLeave}
      onDragOver={dropHandlers.onDragOver}
      onDrop={dropHandlers.onDrop}
      onPointerDown={handlePointerDown}
      onPointerDownCapture={handlePointerDownCapture}
      onPointerEnter={() => {
        pointerInsideRef.current = true;
      }}
      onPointerLeave={() => {
        pointerInsideRef.current = false;
        if (!panRef.current) onStagePoint(null);
      }}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPan}
      onPointerCancel={finishPan}
      onLostPointerCapture={() => endPan()}
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
      {viewportOverlay}
      {viewportChrome}
    </div>
  );
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
  );
}
