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

const ACTION_WIDTH = 104;
// Shared Button minimum (48px) + overlay padding (3px × 2) + border (1px × 2).
const ACTION_OUTER_HEIGHT = 56;
const VIEWPORT_INSET = 8;
const MARKER_GAP = 8;
/** Landscape keeps the incumbent above-first rule: flip below near the ruler. */
const LANDSCAPE_ABOVE_MIN_TOP = 76;

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
  // Portrait prefers below per #647; only a bottom-edge Key flips above.
  const below = portrait
    ? marker.bottom + MARKER_GAP + ACTION_OUTER_HEIGHT <= viewportHeight - VIEWPORT_INSET
    : marker.top < LANDSCAPE_ABOVE_MIN_TOP;
  const maximumTop = viewportHeight - VIEWPORT_INSET - ACTION_OUTER_HEIGHT;
  return {
    top: Math.max(VIEWPORT_INSET, Math.min(
      maximumTop,
      below ? marker.bottom + MARKER_GAP : marker.top - ACTION_OUTER_HEIGHT,
    )),
    left: Math.max(VIEWPORT_INSET, Math.min(
      viewportWidth - ACTION_WIDTH - VIEWPORT_INSET,
      marker.left + marker.width / 2 - ACTION_WIDTH / 2,
    )),
    below,
  };
}
