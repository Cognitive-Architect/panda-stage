import {
  frameDurationMs,
  frameTimeMs,
  integerFrameSpanMs,
  resolveTimelineFrameTime,
  snapToFrame,
  TIMELINE_FPS,
  type ShotCameraOverride,
} from '../../../domain';

export type CameraOverrideDragMode = 'move' | 'resize-start' | 'resize-end';

export interface CameraOverrideDraftRange {
  startMs: number;
  endMs: number;
}

export const OVERRIDE_DRAG_THRESHOLD_PX = 4;

function snapFrameAtOrAfter(minMs: number): number {
  if (minMs <= 0) return 0;
  let index = Math.max(0, Math.floor((minMs * TIMELINE_FPS) / 1_000));
  while (frameTimeMs(index) < minMs) index += 1;
  return frameTimeMs(index);
}

function snapFrameAtOrBefore(maxMs: number): number {
  if (maxMs <= 0) return 0;
  let index = Math.max(0, Math.ceil((maxMs * TIMELINE_FPS) / 1_000));
  while (index > 0 && frameTimeMs(index) > maxMs) index -= 1;
  return frameTimeMs(index);
}

/**
 * Preview a camera override bar drag (body move or left/right edge resize)
 * with frame snapping, minimum duration, neighbor half-open bounds, and shot bounds.
 */
export function previewCameraOverrideDrag(input: {
  override: ShotCameraOverride;
  overrides: readonly ShotCameraOverride[];
  mode: CameraOverrideDragMode;
  deltaPx: number;
  pixelsPerMs: number;
  durationMs: number;
}): CameraOverrideDraftRange {
  const { override, overrides, mode, deltaPx, pixelsPerMs, durationMs } = input;
  const fallback: CameraOverrideDraftRange = { startMs: override.startMs, endMs: override.endMs };
  if (!Number.isFinite(deltaPx) || !Number.isFinite(pixelsPerMs) || pixelsPerMs <= 0 || durationMs <= 0) {
    return fallback;
  }

  let previousEndMs = 0;
  let nextStartMs = durationMs;
  for (const other of overrides) {
    if (other.id === override.id) continue;
    if (other.endMs <= override.startMs && other.endMs > previousEndMs) {
      previousEndMs = other.endMs;
    }
    if (other.startMs >= override.endMs && other.startMs < nextStartMs) {
      nextStartMs = other.startMs;
    }
  }

  const length = override.endMs - override.startMs;
  const minSpanMs = Math.max(1, Math.min(integerFrameSpanMs(), length));
  const deltaMs = deltaPx / pixelsPerMs;

  if (mode === 'move') {
    const minStart = previousEndMs;
    const maxStart = Math.min(nextStartMs, durationMs) - length;
    if (maxStart < minStart) return fallback;

    const clamped = Math.max(minStart, Math.min(maxStart, override.startMs + deltaMs));
    let snappedStart = resolveTimelineFrameTime(clamped, durationMs);
    if (snappedStart < minStart) snappedStart = snapFrameAtOrAfter(minStart);
    if (snappedStart > maxStart) snappedStart = snapFrameAtOrBefore(maxStart);
    if (snappedStart < minStart || snappedStart > maxStart) return fallback;

    return { startMs: snappedStart, endMs: snappedStart + length };
  }

  if (mode === 'resize-start') {
    const minStart = previousEndMs;
    const maxStart = override.endMs - minSpanMs;
    if (maxStart < minStart) return fallback;

    const clamped = Math.max(minStart, Math.min(maxStart, override.startMs + deltaMs));
    let snappedStart = resolveTimelineFrameTime(clamped, durationMs);
    if (snappedStart < minStart) snappedStart = snapFrameAtOrAfter(minStart);
    if (snappedStart > maxStart) snappedStart = snapFrameAtOrBefore(maxStart);
    if (snappedStart < minStart || snappedStart >= override.endMs) return fallback;

    return { startMs: snappedStart, endMs: override.endMs };
  }

  // resize-end
  const minEnd = override.startMs + minSpanMs;
  const maxEnd = Math.min(nextStartMs, durationMs);
  if (maxEnd < minEnd) return fallback;

  const rawEnd = override.endMs + deltaMs;
  const clamped = Math.max(minEnd, Math.min(maxEnd, rawEnd));
  const snapToLimit = rawEnd >= maxEnd - 0.5 * frameDurationMs() && rawEnd >= maxEnd;
  let snappedEnd = snapToLimit ? maxEnd : snapToFrame(clamped);
  if (snappedEnd < minEnd) snappedEnd = snapFrameAtOrAfter(minEnd);
  if (snappedEnd > maxEnd) snappedEnd = snapToLimit ? maxEnd : snapFrameAtOrBefore(maxEnd);
  if (snappedEnd <= override.startMs || snappedEnd > maxEnd) return fallback;

  return { startMs: override.startMs, endMs: snappedEnd };
}
