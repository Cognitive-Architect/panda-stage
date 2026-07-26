import {
  useState,
  type DragEvent,
  type RefObject,
} from 'react';
import {
  clampLayerPosition,
  screenToStage,
  type Point,
  type ViewportTransform,
} from '../../../domain';
import {
  ASSET_DRAG_MIME,
  parseAssetDropPayload,
  type AssetDropPayload,
} from '../assets/AssetDropPayload';

export interface CanvasDropPreview {
  payload: AssetDropPayload | null;
  point: Point;
}

export interface CanvasDropHandlers {
  dragOver: boolean;
  onDragEnter: (event: DragEvent<HTMLDivElement>) => void;
  onDragLeave: (event: DragEvent<HTMLDivElement>) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
}

export interface CanvasDropOptions {
  viewportRef: RefObject<HTMLDivElement | null>;
  transform: ViewportTransform;
  disabled: boolean;
  onPreview: (preview: CanvasDropPreview | null) => void;
  onDropAsset: (
    payload: AssetDropPayload,
    point: Point,
  ) => void;
  onError: (message: string) => void;
}

export interface CanvasClientPointInput {
  client: Point;
  viewportOrigin: Point;
  scroll: Point;
  transform: ViewportTransform;
}

export function mapClientPointToLayerPosition(
  input: CanvasClientPointInput,
): Point | null {
  const point = screenToStage(
    {
      x:
        input.client.x -
        input.viewportOrigin.x +
        input.scroll.x,
      y:
        input.client.y -
        input.viewportOrigin.y +
        input.scroll.y,
    },
    input.transform,
  );
  return point ? clampLayerPosition(point) : null;
}

function hasAssetType(event: DragEvent<HTMLDivElement>): boolean {
  return Array.from(event.dataTransfer.types).includes(ASSET_DRAG_MIME);
}

function readPayload(
  event: DragEvent<HTMLDivElement>,
): AssetDropPayload | null {
  const serialized = event.dataTransfer.getData(ASSET_DRAG_MIME);
  if (!serialized) return null;
  try {
    return parseAssetDropPayload(serialized);
  } catch {
    return null;
  }
}

export function useCanvasDrop({
  viewportRef,
  transform,
  disabled,
  onPreview,
  onDropAsset,
  onError,
}: CanvasDropOptions): CanvasDropHandlers {
  const [dragOver, setDragOver] = useState(false);

  const pointFor = (
    event: DragEvent<HTMLDivElement>,
  ): Point | null => {
    const viewport = viewportRef.current;
    if (!viewport) return null;
    const rect = viewport.getBoundingClientRect();
    return mapClientPointToLayerPosition({
      client: { x: event.clientX, y: event.clientY },
      viewportOrigin: { x: rect.left, y: rect.top },
      scroll: {
        x: viewport.scrollLeft,
        y: viewport.scrollTop,
      },
      transform,
    });
  };

  const preview = (event: DragEvent<HTMLDivElement>): void => {
    const point = pointFor(event);
    if (!point) {
      onPreview(null);
      return;
    }
    onPreview({ payload: readPayload(event), point });
  };

  return {
    dragOver,
    onDragEnter: (event) => {
      if (disabled || !hasAssetType(event)) return;
      event.preventDefault();
      setDragOver(true);
      preview(event);
    },
    onDragLeave: (event) => {
      if (
        event.relatedTarget instanceof Node &&
        event.currentTarget.contains(event.relatedTarget)
      ) {
        return;
      }
      setDragOver(false);
      onPreview(null);
    },
    onDragOver: (event) => {
      if (disabled || !hasAssetType(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      setDragOver(true);
      preview(event);
    },
    onDrop: (event) => {
      if (disabled || !hasAssetType(event)) return;
      event.preventDefault();
      const payload = readPayload(event);
      const point = pointFor(event);
      setDragOver(false);
      onPreview(null);
      if (!payload) {
        onError('拖放载荷无效；未创建图层。');
        return;
      }
      if (payload.type === 'audio') {
        onError('音频素材不能放入画布。');
        return;
      }
      if (!point) {
        onError('无法把落点转换为画布坐标。');
        return;
      }
      onDropAsset(payload, point);
    },
  };
}
