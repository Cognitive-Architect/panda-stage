import { useSyncExternalStore } from 'react';
import { shotStore } from '../../stores/shotStore';
import { clampTime, clampZoom, snapToFrame } from './timeGeometry';

type Listener = () => void;

/**
 * Stage A keeps the existing expanded Timeline surface usable while allowing
 * Cloud Touch landscape to trade Canvas space for Timeline space. These are
 * UI/session bounds only; they are never part of the formal Project model.
 *
 * Issue #422 re-baselines the expanded floor after the Toolbar, ruler/track
 * stack, and unified Task Tray were added. Collapse remains the explicit way
 * to reclaim more vertical space; an expanded Timeline must keep its core
 * surface usable.
 *
 * Issue #431 removes the obsolete Task Tray contribution from the expanded
 * floor. The pure Timeline minimum is derived only from the unchanged
 * Toolbar/ruler geometry and the existing layout chrome around them.
 */
export const TIMELINE_TOOLBAR_HEIGHT = 48;
export const TIMELINE_RULER_SCROLL_HEIGHT = 112;
export const TIMELINE_DOCK_GAP_HEIGHT = 4;
export const TIMELINE_BOTTOM_WORKSPACE_VERTICAL_PADDING = 12;
export const TIMELINE_BOTTOM_WORKSPACE_BORDER_HEIGHT = 2;
export const TIMELINE_EXPANDED_CORE_MIN_HEIGHT =
  TIMELINE_TOOLBAR_HEIGHT + TIMELINE_RULER_SCROLL_HEIGHT;
export const TIMELINE_EXPANDED_MIN_HEIGHT =
  TIMELINE_EXPANDED_CORE_MIN_HEIGHT +
  TIMELINE_DOCK_GAP_HEIGHT +
  TIMELINE_BOTTOM_WORKSPACE_VERTICAL_PADDING +
  TIMELINE_BOTTOM_WORKSPACE_BORDER_HEIGHT;
export const TIMELINE_EXPANDED_DEFAULT_HEIGHT = 280;
export const TIMELINE_EXPANDED_MAX_HEIGHT = 420;
export const TIMELINE_MIN_CANVAS_HEIGHT = 240;
export const TIMELINE_RESIZE_KEYBOARD_STEP = 16;

export interface TimelineHeightBounds {
  minHeight: number;
  maxHeight: number;
}

/** Clamp a candidate expanded height to one safe UI/session range. */
export function clampTimelineHeight(
  height: number,
  minHeight = TIMELINE_EXPANDED_MIN_HEIGHT,
  maxHeight = TIMELINE_EXPANDED_MAX_HEIGHT,
): number {
  const min = Number.isFinite(minHeight)
    ? Math.max(0, Math.round(minHeight))
    : TIMELINE_EXPANDED_MIN_HEIGHT;
  const max = Math.max(
    min,
    Number.isFinite(maxHeight) ? Math.round(maxHeight) : min,
  );
  const candidate = Number.isFinite(height) ? Math.round(height) : min;
  return Math.min(max, Math.max(min, candidate));
}

/**
 * Derive a generous but finite maximum from the live editor geometry. The
 * current body+bottom sum represents the available grid budget. The caller
 * may provide the strongest measured editor-body floor so Canvas and the
 * side-rail affordances are protected by the same bound.
 */
export function getTimelineHeightBounds(
  editorBodyHeight: number,
  currentBottomHeight: number,
  editorBodyMinimumHeight = TIMELINE_MIN_CANVAS_HEIGHT,
): TimelineHeightBounds {
  const body = Number.isFinite(editorBodyHeight)
    ? Math.max(0, editorBodyHeight)
    : 0;
  const bottom = Number.isFinite(currentBottomHeight)
    ? Math.max(0, currentBottomHeight)
    : 0;
  const bodyMinimum = Number.isFinite(editorBodyMinimumHeight)
    ? Math.max(TIMELINE_MIN_CANVAS_HEIGHT, editorBodyMinimumHeight)
    : TIMELINE_MIN_CANVAS_HEIGHT;
  const editorBodyPreservingMaximum = Math.floor(
    body + bottom - bodyMinimum,
  );
  const maxHeight = Math.min(
    TIMELINE_EXPANDED_MAX_HEIGHT,
    Math.max(TIMELINE_EXPANDED_MIN_HEIGHT, editorBodyPreservingMaximum),
  );
  return {
    minHeight: TIMELINE_EXPANDED_MIN_HEIGHT,
    maxHeight,
  };
}

/** Convert an upward/downward pointer delta into a clamped Timeline height. */
export function getTimelineHeightFromPointer(
  startHeight: number,
  startY: number,
  currentY: number,
  maxHeight: number,
): number {
  return clampTimelineHeight(
    startHeight - (currentY - startY),
    TIMELINE_EXPANDED_MIN_HEIGHT,
    maxHeight,
  );
}

export interface TimelineUiState {
  /** Current playhead position in real milliseconds. UI-only, never persisted. */
  currentTimeMs: number;
  /** Horizontal scale multiplier (1 = fit duration to viewport width). */
  zoom: number;
  /** Horizontal scroll offset in pixels for zoomed timelines. */
  scrollPx: number;
  /** Whether the timeline ruler is expanded or collapsed to its header. */
  expanded: boolean;
  /** Last valid expanded height, in CSS pixels; UI-only and session-only. */
  expandedHeightPx: number;
  /** Live layout-derived upper bound for the expanded height. */
  expandedHeightMaxPx: number;
  /** Whether the dedicated Stage A resize handle currently owns a pointer. */
  resizing: boolean;
}

const INITIAL_STATE: TimelineUiState = {
  currentTimeMs: 0,
  zoom: 1,
  scrollPx: 0,
  expanded: true,
  // Issue #431 P-04: the old 280px startup height included room for the
  // removed Bottom Task Tray. Start the pure Timeline at the existing legal
  // minimum; the incumbent resize owner and its min/max bounds remain intact.
  expandedHeightPx: TIMELINE_EXPANDED_MIN_HEIGHT,
  expandedHeightMaxPx: TIMELINE_EXPANDED_MAX_HEIGHT,
  resizing: false,
};

/**
 * Holds all Timeline Shell UI/preview state. This store is deliberately
 * isolated from `EditorProjectStore`: seeking, zooming and scrolling never
 * write to the project snapshot, dirty flag, revision or History.
 */
export class TimelineUiStore {
  private state: TimelineUiState = { ...INITIAL_STATE };
  private readonly listeners = new Set<Listener>();
  private readonly unsubscribeShot: () => void;
  private observedShotId: string | null = shotStore.getCurrentShotId();

  constructor() {
    // Reset the playhead whenever the active shot changes so a stale time from
    // the previous shot never carries over.
    this.unsubscribeShot = shotStore.subscribe(() => {
      const shotId = shotStore.getCurrentShotId();
      if (shotId === this.observedShotId) return;
      this.observedShotId = shotId;
      this.resetForShot();
    });
  }

  readonly getSnapshot = (): TimelineUiState => this.state;

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private patch(next: Partial<TimelineUiState>): void {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
  }

  /**
   * Move the playhead. Always clamps into `[0, durationMs]` and snaps to the
   * nearest 24 FPS frame. Does not touch the project. A no-op when the value
   * is already current (avoids render thrash during drag).
   */
  seek(timeMs: number, durationMs: number): void {
    const clamped = clampTime(timeMs, durationMs);
    // Snap to the nearest 24 FPS frame, then re-clamp to the shot window so a
    // non-integer-frame duration (e.g. 4321ms) never yields a playhead past
    // the shot end. The final current time always satisfies [0, durationMs].
    const snapped = Math.min(snapToFrame(clamped), durationMs);
    if (snapped === this.state.currentTimeMs) return;
    this.patch({ currentTimeMs: snapped });
  }

  setZoom(zoom: number): void {
    const next = clampZoom(zoom);
    if (next === this.state.zoom) return;
    this.patch({ zoom: next });
  }

  setScrollPx(scrollPx: number): void {
    const next = Number.isFinite(scrollPx) && scrollPx > 0 ? Math.round(scrollPx) : 0;
    if (next === this.state.scrollPx) return;
    this.patch({ scrollPx: next });
  }

  setExpanded(expanded: boolean): void {
    if (expanded === this.state.expanded) return;
    this.patch({ expanded });
  }

  /** Set the last expanded height without touching Project or History. */
  setHeight(height: number): void {
    const next = clampTimelineHeight(
      height,
      TIMELINE_EXPANDED_MIN_HEIGHT,
      this.state.expandedHeightMaxPx,
    );
    if (next === this.state.expandedHeightPx) return;
    this.patch({ expandedHeightPx: next });
  }

  /** Update the live geometry bound and clamp the current expanded height. */
  setHeightMax(maxHeight: number): void {
    const nextMax = clampTimelineHeight(
      maxHeight,
      TIMELINE_EXPANDED_MIN_HEIGHT,
      TIMELINE_EXPANDED_MAX_HEIGHT,
    );
    const nextHeight = clampTimelineHeight(
      this.state.expandedHeightPx,
      TIMELINE_EXPANDED_MIN_HEIGHT,
      nextMax,
    );
    if (
      nextMax === this.state.expandedHeightMaxPx &&
      nextHeight === this.state.expandedHeightPx
    ) {
      return;
    }
    this.patch({
      expandedHeightMaxPx: nextMax,
      expandedHeightPx: nextHeight,
    });
  }

  setResizing(resizing: boolean): void {
    if (resizing === this.state.resizing) return;
    this.patch({ resizing });
  }

  /** Reset playhead + scroll on shot change. Zoom is intentionally kept. */
  resetForShot(): void {
    if (this.state.currentTimeMs === 0 && this.state.scrollPx === 0) return;
    this.patch({ currentTimeMs: 0, scrollPx: 0 });
  }

  dispose(): void {
    this.unsubscribeShot();
    this.listeners.clear();
  }
}

export const timelineUiStore = new TimelineUiStore();

/** React hook that subscribes to the Timeline UI store. */
export function useTimelineUi(): TimelineUiState {
  return useSyncExternalStore(timelineUiStore.subscribe, timelineUiStore.getSnapshot);
}
