import { useSyncExternalStore } from 'react';
import type { CameraView } from '../../../domain';

/**
 * AUTO-07B camera-tool session state.
 *
 * This store is UI-only: it never holds a camera that claims to be saved. The
 * persisted camera lives in `Shot.camera`; the draft here is just the framing
 * the author is currently holding before pressing 记录取景.
 */
export interface CameraToolSnapshot {
  /** Framing box visible on the Canvas. */
  readonly active: boolean;
  /** Live framing preview: the Canvas draws through the Shot camera. */
  readonly previewing: boolean;
  /** Draft view being authored; null means "follow the persisted camera". */
  readonly draft: CameraView | null;
}

type Listener = () => void;

const INITIAL_SNAPSHOT: CameraToolSnapshot = {
  active: false,
  previewing: false,
  draft: null,
};

export class CameraToolStore {
  private snapshot: CameraToolSnapshot = INITIAL_SNAPSHOT;
  private readonly listeners = new Set<Listener>();

  readonly getSnapshot = (): CameraToolSnapshot => this.snapshot;

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  setActive(active: boolean): void {
    if (active === this.snapshot.active) return;
    this.snapshot = {
      active,
      previewing: active ? this.snapshot.previewing : false,
      draft: active ? this.snapshot.draft : null,
    };
    this.emit();
  }

  setPreviewing(previewing: boolean): void {
    if (previewing === this.snapshot.previewing) return;
    this.snapshot = { ...this.snapshot, previewing };
    this.emit();
  }

  setDraft(draft: CameraView | null): void {
    if (
      draft?.centerX === this.snapshot.draft?.centerX &&
      draft?.centerY === this.snapshot.draft?.centerY &&
      draft?.zoom === this.snapshot.draft?.zoom &&
      (draft === null) === (this.snapshot.draft === null)
    ) {
      return;
    }
    this.snapshot = { ...this.snapshot, draft };
    this.emit();
  }

  reset(): void {
    if (
      this.snapshot.active === INITIAL_SNAPSHOT.active &&
      this.snapshot.previewing === INITIAL_SNAPSHOT.previewing &&
      this.snapshot.draft === INITIAL_SNAPSHOT.draft
    ) {
      return;
    }
    this.snapshot = INITIAL_SNAPSHOT;
    this.emit();
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

export const cameraToolStore = new CameraToolStore();

/** Session tool state; deliberately not part of the Project or its History. */
export function useCameraTool(): CameraToolSnapshot {
  return useSyncExternalStore(
    cameraToolStore.subscribe,
    cameraToolStore.getSnapshot,
  );
}
