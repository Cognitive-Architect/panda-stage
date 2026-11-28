import type {
  CanvasViewportMode,
  Point,
  ViewportNavigation,
} from '../../domain';

export interface CanvasViewportSnapshot {
  mode: CanvasViewportMode;
  navigation: ViewportNavigation;
  lastStagePoint: Point | null;
}

type Listener = () => void;

const DEFAULT_NAVIGATION: ViewportNavigation = {
  zoom: 1,
  pan: { x: 0, y: 0 },
  padding: 16,
};

const INITIAL_SNAPSHOT: CanvasViewportSnapshot = {
  mode: 'fit',
  navigation: DEFAULT_NAVIGATION,
  lastStagePoint: null,
};

export class CanvasViewportStore {
  private snapshot: CanvasViewportSnapshot = INITIAL_SNAPSHOT;
  private readonly listeners = new Set<Listener>();

  readonly getSnapshot = (): CanvasViewportSnapshot => this.snapshot;

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly setMode = (mode: CanvasViewportMode): void => {
    if (mode === this.snapshot.mode && this.snapshot.navigation === DEFAULT_NAVIGATION) return;
    this.snapshot = { ...this.snapshot, mode, navigation: DEFAULT_NAVIGATION };
    this.emit();
  };

  navigate(zoom: number, pan: Point): void {
    const current = this.snapshot.navigation;
    if (zoom === current.zoom && pan.x === current.pan.x && pan.y === current.pan.y) return;
    this.snapshot = { ...this.snapshot, navigation: { ...current, zoom, pan } };
    this.emit();
  }

  recordStagePoint(point: Point | null): void {
    if (
      point?.x === this.snapshot.lastStagePoint?.x &&
      point?.y === this.snapshot.lastStagePoint?.y
    ) {
      return;
    }
    this.snapshot = {
      ...this.snapshot,
      lastStagePoint: point,
    };
    this.emit();
  }

  reset(): void {
    if (
      this.snapshot.mode === INITIAL_SNAPSHOT.mode &&
      this.snapshot.navigation === DEFAULT_NAVIGATION &&
      this.snapshot.lastStagePoint === null
    ) {
      return;
    }
    this.snapshot = INITIAL_SNAPSHOT;
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export const canvasViewportStore = new CanvasViewportStore();
