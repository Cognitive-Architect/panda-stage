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
  stageToScreen,
  type ViewportNavigation,
  type CanvasViewportMode,
  type Point,
  type ViewportTransform,
} from '../../../domain';
import type {
  AnimationDropTarget,
  AssetDropPayload,
} from '../assets/AssetDropPayload';
import {
  useCanvasDrop,
  type CanvasDropPreview,
} from './useCanvasDrop';
import { canvasViewportStore } from '../../stores/canvasViewportStore';
import { isEditableKeyboardTarget, isMenuOrModalKeyboardTarget } from '../properties/LayerOrderControls';

export interface CanvasViewportProps {
  mode: CanvasViewportMode;
  navigation: ViewportNavigation;
  children: (transform: ViewportTransform) => ReactNode;
  viewportOverlay?: ReactNode;
  viewportChrome?: ReactNode;
  dropDisabled?: boolean;
  dropInteractionDisabled?: boolean;
  animationDropTarget?: AnimationDropTarget | null;
  onAssetDrop?: (payload: AssetDropPayload, point: Point) => void;
  onDropError?: (message: string) => void;
  onDropPreview?: (preview: CanvasDropPreview | null) => void;
  onStagePoint: (point: Point | null) => void;
  onTransform?: (transform: ViewportTransform) => void;
  onViewportChromePointerDown?: () => void;
}

interface ViewportPanStart {
  clientX: number;
  clientY: number;
  pan: Point;
  pointerId: number;
}

export function isViewportChromePointerTarget<T>(
  target: T | null,
  isInsideLogicalStage: (target: T) => boolean,
): boolean {
  return target !== null && !isInsideLogicalStage(target);
}

export function CanvasViewport({
  mode,
  navigation,
  children,
  viewportOverlay = null,
  viewportChrome = null,
  dropDisabled = false,
  dropInteractionDisabled = false,
  animationDropTarget = null,
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
    () => calculateViewportTransform(container, mode, undefined, navigation),
    [container, mode, navigation],
  );
  const dropHandlers = useCanvasDrop({
    viewportRef,
    transform,
    disabled: dropDisabled,
    interactionDisabled: dropInteractionDisabled,
    animationDropTarget,
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
      if (event.key === 'Escape' && panRef.current) {
        endPan();
        return;
      }
      if (
        mode !== 'actual' ||
        (event.code !== 'Space' && event.key !== ' ') ||
        event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey ||
        isEditableKeyboardTarget(event.target) || isMenuOrModalKeyboardTarget(event.target) ||
        isViewportInteractiveChromePointerTarget(event.target) ||
        (event.target instanceof Element && Boolean(event.target.closest('button, [role="button"]'))) ||
        document.querySelector('dialog[open], [aria-modal="true"]:not([hidden])') !== null ||
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
  }, [endPan, mode, releaseSpace]);

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

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (event: WheelEvent) => {
      if (event.defaultPrevented || panRef.current || isViewportInteractiveChromePointerTarget(event.target) ||
          isMenuOrModalKeyboardTarget(event.target) || isEditableKeyboardTarget(event.target) || event.deltaY === 0) return;
      const { mode, navigation } = canvasViewportStore.getSnapshot();
      const before = calculateViewportTransform(container, mode, undefined, navigation);
      const rect = viewport.getBoundingClientRect();
      const pointer = { x: event.clientX - rect.left - viewport.clientLeft, y: event.clientY - rect.top - viewport.clientTop };
      const logicalPoint = screenToStage(pointer, before);
      if (!logicalPoint) return;
      event.preventDefault();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? container.height : 1);
      const zoom = Math.min(16, Math.max(0.125, navigation.zoom * Math.exp(-delta * 0.002)));
      if (zoom === navigation.zoom) return;
      const after = calculateViewportTransform(container, mode, undefined, { ...navigation, zoom });
      const projected = stageToScreen(logicalPoint, after);
      canvasViewportStore.navigate(zoom, {
        x: navigation.pan.x + pointer.x - projected.x,
        y: navigation.pan.y + pointer.y - projected.y,
      });
      onStagePoint(isStagePointInside(logicalPoint, after) ? logicalPoint : null);
    };
    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', onWheel);
  }, [container, onStagePoint]);

  const mapPointer = (event: PointerEvent<HTMLDivElement>): void => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const point = screenToStage(
      {
        x: event.clientX - rect.left - viewport.clientLeft,
        y: event.clientY - rect.top - viewport.clientTop,
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
    if (isViewportInteractiveChromePointerTarget(target)) return;
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
    if (isViewportInteractiveChromePointerTarget(event.target) || isMenuOrModalKeyboardTarget(event.target)) return;
    const panButton = event.button === 1 || (event.button === 0 && (event.altKey || (mode === 'actual' && spaceHeldRef.current)));
    if (event.pointerType !== 'mouse' || !panButton || panRef.current) {
      return;
    }
    const viewport = viewportRef.current;
    if (!viewport) return;
    panRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
      pointerId: event.pointerId,
      pan: canvasViewportStore.getSnapshot().navigation.pan,
    };
    setPanActive(true);
    viewport.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const pan = panRef.current;
    if (pan?.pointerId === event.pointerId) {
      canvasViewportStore.navigate(canvasViewportStore.getSnapshot().navigation.zoom, {
        x: pan.pan.x + event.clientX - pan.clientX,
        y: pan.pan.y + event.clientY - pan.clientY,
      });
      onStagePoint(null);
      event.preventDefault();
      event.stopPropagation();
      return;
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
      data-view-mode={mode}
      data-view-zoom={navigation.zoom}
      data-view-pan-x={navigation.pan.x}
      data-view-pan-y={navigation.pan.y}
      data-drop-disabled={String(dropDisabled || dropInteractionDisabled)}
      data-logical-height={transform.logical.height}
      data-logical-width={transform.logical.width}
      data-offset-x={transform.offsetX.toFixed(3)}
      data-offset-y={transform.offsetY.toFixed(3)}
      data-pan-active={String(panActive)}
      data-pan-available={String(mode === 'actual' && spaceHeld)}
      data-testid="project-canvas-viewport"
      onAuxClick={event => { if (event.button === 1) event.preventDefault(); }}
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
          width: transform.container.width,
          height: transform.container.height,
        }}
      >
        <div
          className="canvas-logical-stage"
          data-testid="canvas-logical-stage"
          style={{
            left: transform.offsetX,
            top: transform.offsetY,
            width: transform.logical.width,
            height: transform.logical.height,
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

function isViewportInteractiveChromePointerTarget(
  target: EventTarget | null,
): boolean {
  const element = target instanceof Element
    ? target
    : target instanceof Node
      ? target.parentElement
      : null;
  return Boolean(element?.closest('[data-canvas-interactive-chrome="true"]'));
}
