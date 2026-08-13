import { PROJECT_FPS } from '../../../domain/constants';

/** Timeline time base. Panda Stage renders at 24 FPS. */
export const TIMELINE_FPS = PROJECT_FPS;

export const MIN_TIMELINE_ZOOM = 1;
export const MAX_TIMELINE_ZOOM = 8;

/** Milliseconds spanned by a single frame at the timeline FPS. */
export function frameDurationMs(fps: number = TIMELINE_FPS): number {
  return 1000 / fps;
}

/**
 * Clamp a time value into the inclusive `[0, durationMs]` window.
 * Negative or non-finite durations collapse to `0`, so an empty timeline
 * never produces a playhead offset.
 */
export function clampTime(timeMs: number, durationMs: number): number {
  if (!Number.isFinite(timeMs)) return 0;
  const dur = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;
  return Math.min(Math.max(0, timeMs), dur);
}

/**
 * Snap a time value to the nearest frame boundary at the timeline FPS.
 * Pure geometry only — never clamps to shot duration (callers clamp after).
 */
export function snapToFrame(timeMs: number, fps: number = TIMELINE_FPS): number {
  if (!Number.isFinite(timeMs)) return 0;
  const frameMs = frameDurationMs(fps);
  const frames = Math.round(timeMs / frameMs);
  return Math.max(0, Math.round(frames * frameMs));
}

/** Pixels per millisecond for a given viewport width, duration and zoom. */
export function computePixelsPerMs(
  viewportWidthPx: number,
  durationMs: number,
  zoom: number = 1,
): number {
  if (!Number.isFinite(viewportWidthPx) || viewportWidthPx <= 0) return 0;
  const dur = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;
  if (dur <= 0) return 0;
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return (viewportWidthPx / dur) * safeZoom;
}

/** Map a real time (ms) to an x offset (px) inside the timeline track. */
export function timeToPx(timeMs: number, pixelsPerMs: number): number {
  if (!Number.isFinite(pixelsPerMs) || pixelsPerMs <= 0) return 0;
  return Math.max(0, timeMs) * pixelsPerMs;
}

/** Map an x offset (px) back to a real time (ms). Inverse of `timeToPx`. */
export function pxToTime(px: number, pixelsPerMs: number): number {
  if (!Number.isFinite(pixelsPerMs) || pixelsPerMs <= 0) return 0;
  return Math.max(0, px) / pixelsPerMs;
}

/** Keep zoom inside the supported `[1, 8]` band. */
export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom <= 0) return 1;
  return Math.min(MAX_TIMELINE_ZOOM, Math.max(MIN_TIMELINE_ZOOM, zoom));
}

/** Format a time value as `mm:ss.mmm` for the timeline readout. */
export function formatTimecode(timeMs: number): string {
  const safe = Number.isFinite(timeMs) && timeMs > 0 ? timeMs : 0;
  const totalMs = Math.round(safe);
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const sec = totalSec % 60;
  const min = Math.floor(totalSec / 60);
  const pad = (n: number, width: number): string => String(n).padStart(width, '0');
  return `${pad(min, 2)}:${pad(sec, 2)}.${pad(ms, 3)}`;
}

export interface RulerTick {
  timeMs: number;
  px: number;
  label: string;
}

/**
 * Produce evenly spaced, frame-aligned ruler ticks for a given duration and
 * pixel scale. Pure: the same inputs always yield the same ticks, and the
 * label/time invariant holds regardless of zoom.
 */
export function generateRulerTicks(
  durationMs: number,
  pixelsPerMs: number,
  maxTicks: number = 10,
): RulerTick[] {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return [];
  if (!Number.isFinite(pixelsPerMs) || pixelsPerMs <= 0) return [];
  const frameMs = frameDurationMs();
  const totalPx = durationMs * pixelsPerMs;
  const targetStepPx = totalPx / Math.max(1, maxTicks);
  const niceFrameSteps = [
    1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000,
  ];
  let frameStep = niceFrameSteps[niceFrameSteps.length - 1]!;
  for (const candidate of niceFrameSteps) {
    if (candidate * frameMs * pixelsPerMs >= targetStepPx) {
      frameStep = candidate;
      break;
    }
  }
  const ticks: RulerTick[] = [];
  const roundedDuration = Math.round(durationMs);
  for (let t = 0; t <= roundedDuration + 0.5; t += frameStep * frameMs) {
    const timeMs = Math.min(Math.round(t), roundedDuration);
    ticks.push({
      timeMs,
      px: timeMs * pixelsPerMs,
      label: formatTimecode(timeMs),
    });
    if (timeMs >= roundedDuration) break;
  }
  return ticks;
}
