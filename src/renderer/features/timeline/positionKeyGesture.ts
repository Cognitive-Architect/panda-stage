import {
  frameTimeMs,
  lastValidFrameTime,
  TIMELINE_FPS,
} from '../../../domain/timeline/frame-grid';

/** Resolve a drag against immediate neighbours, never crossing another Key. */
export function previewPositionKeyTime(input: {
  fromTimeMs: number;
  deltaPx: number;
  pixelsPerMs: number;
  previousTimeMs: number;
  nextTimeMs: number | null;
  durationMs: number;
}): number {
  const { fromTimeMs, deltaPx, pixelsPerMs, previousTimeMs, nextTimeMs, durationMs } = input;
  if (!Number.isFinite(deltaPx) || !Number.isFinite(pixelsPerMs) || pixelsPerMs <= 0) {
    return fromTimeMs;
  }
  const frameIndex = (timeMs: number): number =>
    Math.round((timeMs * TIMELINE_FPS) / 1_000);
  const minimum = frameIndex(previousTimeMs) + 1;
  const maximum = frameIndex(nextTimeMs ?? lastValidFrameTime(durationMs))
    - (nextTimeMs === null ? 0 : 1);
  if (maximum < minimum) return fromTimeMs;
  const requested = Math.round(((fromTimeMs + deltaPx / pixelsPerMs) * TIMELINE_FPS) / 1_000);
  return frameTimeMs(Math.max(minimum, Math.min(maximum, requested)));
}

interface RectLike {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly width: number;
}

/** Fixed-overlay placement keeps Delete attached without scroll clipping. */
export function positionActionPlacement(input: {
  marker: RectLike;
  scrollViewport: RectLike | null;
  viewportWidth: number;
  viewportHeight: number;
  portrait: boolean;
}): { top: number; left: number; below: boolean } | null {
  const { marker, scrollViewport, viewportWidth, viewportHeight, portrait } = input;
  if (scrollViewport && (marker.right < scrollViewport.left || marker.left > scrollViewport.right ||
      marker.bottom < scrollViewport.top || marker.top > scrollViewport.bottom)) return null;
  const below = portrait || marker.top < 76;
  const width = 104;
  return {
    top: below ? Math.min(viewportHeight - 48, marker.bottom + 8) : Math.max(8, marker.top - 48),
    left: Math.max(8, Math.min(viewportWidth - width - 8, marker.left + marker.width / 2 - width / 2)),
    below,
  };
}
