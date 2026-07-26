import type {
  CanvasViewportMode,
  Point,
} from '../../domain';

export interface CanvasViewportSnapshot {
  mode: CanvasViewportMode;
  lastStagePoint: Point | null;
}

type Listener = () => void;

const INITIAL_SNAPSHOT: CanvasViewportSnapshot = {
  mode: 'fit',
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

  setMode(mode: CanvasViewportMode): void {
    if (mode === this.snapshot.mode) return;
    this.snapshot = {
      ...this.snapshot,
      mode,
    };
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
