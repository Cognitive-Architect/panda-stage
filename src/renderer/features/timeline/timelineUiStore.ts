import { useSyncExternalStore } from 'react';
import { shotStore } from '../../stores/shotStore';
import { clampTime, clampZoom, snapToFrame } from './timeGeometry';

type Listener = () => void;

export interface TimelineUiState {
  /** Current playhead position in real milliseconds. UI-only, never persisted. */
  currentTimeMs: number;
  /** Horizontal scale multiplier (1 = fit duration to viewport width). */
  zoom: number;
  /** Horizontal scroll offset in pixels for zoomed timelines. */
  scrollPx: number;
  /** Whether the timeline ruler is expanded or collapsed to its header. */
  expanded: boolean;
}

const INITIAL_STATE: TimelineUiState = {
  currentTimeMs: 0,
  zoom: 1,
  scrollPx: 0,
  expanded: true,
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
    const snapped = snapToFrame(clampTime(timeMs, durationMs));
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
