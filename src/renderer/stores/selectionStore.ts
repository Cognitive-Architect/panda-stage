import {
  EditorProjectStore,
  editorProjectStore,
} from './EditorProjectStore';
import {
  shotStore,
  type ShotStore,
} from './shotStore';

type Listener = () => void;

export class LayerSelectionStore {
  private selectedLayerId: string | null = null;
  private readonly listeners = new Set<Listener>();
  private readonly unsubscribeEditor: () => void;
  private readonly unsubscribeShot: () => void;

  constructor(
    private readonly editorStore: EditorProjectStore,
    private readonly currentShot: Pick<
      ShotStore,
      'getCurrentShotId' | 'subscribe'
    >,
  ) {
    this.unsubscribeEditor = editorStore.subscribe(() =>
      this.reconcileSelection(),
    );
    this.unsubscribeShot = currentShot.subscribe(() =>
      this.reconcileSelection(),
    );
  }

  readonly getSelectedLayerId = (): string | null =>
    this.selectedLayerId;

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  select(layerId: string): void {
    const shot = this.currentShotValue();
    const layer = shot?.layers.find((candidate) => candidate.id === layerId);
    if (!shot || !layer) {
      throw new Error(`找不到当前镜头中的图层：${layerId}`);
    }
    if (shot.backgroundLayerId === layer.id) {
      this.setSelectedLayerId(null);
      return;
    }
    this.setSelectedLayerId(layer.id);
  }

  clear(): void {
    this.setSelectedLayerId(null);
  }

  dispose(): void {
    this.unsubscribeEditor();
    this.unsubscribeShot();
    this.listeners.clear();
  }

  private currentShotValue() {
    const project = this.editorStore.getSnapshot()?.project;
    const shotId = this.currentShot.getCurrentShotId();
    return project?.shots.find((shot) => shot.id === shotId) ?? null;
  }

  private reconcileSelection(): void {
    if (!this.selectedLayerId) return;
    const shot = this.currentShotValue();
    if (
      !shot ||
      shot.backgroundLayerId === this.selectedLayerId ||
      !shot.layers.some((layer) => layer.id === this.selectedLayerId)
    ) {
      this.setSelectedLayerId(null);
    }
  }

  private setSelectedLayerId(layerId: string | null): void {
    if (layerId === this.selectedLayerId) return;
    this.selectedLayerId = layerId;
    for (const listener of this.listeners) listener();
  }
}

export const selectionStore = new LayerSelectionStore(
  editorProjectStore,
  shotStore,
);
