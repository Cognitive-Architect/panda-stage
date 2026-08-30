import { clampTime, pxToTime, snapToFrame } from './timeGeometry';

/**
 * Stage C keeps a horizontal swipe in the Pending Tray. Stage D uses a
 * separate, explicit threshold so a tap or a short tray gesture cannot turn
 * into placement drag.
 */
export const PENDING_TRAY_SWIPE_THRESHOLD_PX = 8;
export const PENDING_DIALOGUE_DRAG_THRESHOLD_PX = 10;

export function isHorizontalPendingTrayGesture(
  startX: number,
  startY: number,
  currentX: number,
  currentY: number,
): boolean {
  const horizontalDistance = Math.abs(currentX - startX);
  const verticalDistance = Math.abs(currentY - startY);
  return (
    horizontalDistance >= PENDING_TRAY_SWIPE_THRESHOLD_PX &&
    horizontalDistance > verticalDistance
  );
}

/**
 * Placement begins only after an upward movement with vertical intent. This
 * leaves the existing horizontal Pending Tray scroll owner untouched.
 */
export function isPendingDialoguePlacementGesture(
  startX: number,
  startY: number,
  currentX: number,
  currentY: number,
): boolean {
  const horizontalDistance = Math.abs(currentX - startX);
  const verticalDistance = startY - currentY;
  return (
    verticalDistance >= PENDING_DIALOGUE_DRAG_THRESHOLD_PX &&
    verticalDistance > horizontalDistance
  );
}

/** Map a client X to the snapped, bounded Timeline time at the lane surface. */
export function mapPendingDropXToStartMs(
  clientX: number,
  laneLeft: number,
  pixelsPerMs: number,
  durationMs: number,
): number {
  const rawTimeMs = pxToTime(clientX - laneLeft, pixelsPerMs);
  return clampTime(snapToFrame(rawTimeMs), durationMs);
}

export function isPointInsidePendingDropTarget(
  clientX: number,
  clientY: number,
  rect: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>,
): boolean {
  return (
    clientX >= rect.left &&
    clientX <= rect.right &&
    clientY >= rect.top &&
    clientY <= rect.bottom
  );
}
