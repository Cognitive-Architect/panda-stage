import { PROJECT_HEIGHT, PROJECT_WIDTH } from '../constants';

export type CanvasViewportMode = 'fit' | 'actual';

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface ViewportNavigation {
  zoom: number;
  pan: Point;
  padding: number;
}

export interface ViewportTransform {
  mode: CanvasViewportMode;
  container: Size;
  logical: Size;
  scale: number;
  offsetX: number;
  offsetY: number;
  displayWidth: number;
  displayHeight: number;
  contentWidth: number;
  contentHeight: number;
}

function safeDimension(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function calculateViewportTransform(
  container: Size,
  mode: CanvasViewportMode,
  logical: Size = {
    width: PROJECT_WIDTH,
    height: PROJECT_HEIGHT,
  },
  navigation?: ViewportNavigation,
): ViewportTransform {
  const containerWidth = safeDimension(container.width);
  const containerHeight = safeDimension(container.height);
  const logicalWidth = safeDimension(logical.width);
  const logicalHeight = safeDimension(logical.height);
  const canScale =
    containerWidth > 0 &&
    containerHeight > 0 &&
    logicalWidth > 0 &&
    logicalHeight > 0;
  const inset = navigation ? navigation.padding * 2 : 0;
  const baseScale =
    mode === 'actual'
      ? logicalWidth > 0 && logicalHeight > 0
        ? 1
        : 0
      : canScale
        ? Math.min(
            Math.max(navigation ? 1 : 0, containerWidth - inset) / logicalWidth,
            Math.max(navigation ? 1 : 0, containerHeight - inset) / logicalHeight,
          )
        : 0;
  const scale = baseScale * (navigation?.zoom ?? 1);
  const displayWidth = logicalWidth * scale;
  const displayHeight = logicalHeight * scale;
  const centerX = (containerWidth - displayWidth) / 2;
  const centerY = (containerHeight - displayHeight) / 2;
  const offsetX = navigation ? centerX + navigation.pan.x : Math.max(0, centerX);
  const offsetY = navigation ? centerY + navigation.pan.y : Math.max(0, centerY);

  return {
    mode,
    container: {
      width: containerWidth,
      height: containerHeight,
    },
    logical: {
      width: logicalWidth,
      height: logicalHeight,
    },
    scale,
    offsetX,
    offsetY,
    displayWidth,
    displayHeight,
    contentWidth: Math.max(containerWidth, displayWidth),
    contentHeight: Math.max(containerHeight, displayHeight),
  };
}

export function stageToScreen(
  point: Point,
  transform: ViewportTransform,
): Point {
  return {
    x: transform.offsetX + point.x * transform.scale,
    y: transform.offsetY + point.y * transform.scale,
  };
}

export function screenToStage(
  point: Point,
  transform: ViewportTransform,
): Point | null {
  if (!(transform.scale > 0) || !Number.isFinite(transform.scale)) {
    return null;
  }
  return {
    x: (point.x - transform.offsetX) / transform.scale,
    y: (point.y - transform.offsetY) / transform.scale,
  };
}

export function isStagePointInside(
  point: Point | null,
  transform: ViewportTransform,
): point is Point {
  return (
    point !== null &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    point.x >= 0 &&
    point.y >= 0 &&
    point.x <= transform.logical.width &&
    point.y <= transform.logical.height
  );
}
