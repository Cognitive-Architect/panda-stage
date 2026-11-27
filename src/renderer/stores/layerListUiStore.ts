import { useSyncExternalStore } from 'react';
import type { EditorProjectStore } from './EditorProjectStore';
import { editorProjectStore } from './EditorProjectStore';
import type { ShotStore } from './shotStore';
import { shotStore } from './shotStore';

type Listener = () => void;

const PARENT_CHAIN_STORAGE_KEY = 'panda-stage:layer-list-parent-chain-visible';

export interface LayerListUiState {
  /** Toggleable narrow parent-chain column visibility (UI preference only, never in Project). */
  readonly parentChainVisible: boolean;
  /** Session-only multi-select layer IDs within the active shot for batch parenting. */
  readonly batchSelectedLayerIds: readonly string[];
}

export interface LayerListUiDependencies {
  editorStore: Pick<
    EditorProjectStore,
    'getSnapshot' | 'getProjectInstanceId' | 'subscribe'
  >;
  shotSelection: Pick<ShotStore, 'getCurrentShotId' | 'subscribe'>;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
}

function readStoredParentChainVisible(
  storage: Pick<Storage, 'getItem'> | null | undefined,
): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(PARENT_CHAIN_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeStoredParentChainVisible(
  storage: Pick<Storage, 'setItem'> | null | undefined,
  visible: boolean,
): void {
  if (!storage) return;
  try {
    storage.setItem(PARENT_CHAIN_STORAGE_KEY, visible ? 'true' : 'false');
  } catch {
    // Ignore storage quota or sandbox errors; session state remains valid.
  }
}

export class LayerListUiStore {
  private state: LayerListUiState;
  private contextKey: string | null = null;
  private readonly listeners = new Set<Listener>();
  private readonly unsubscribers: (() => void)[];
  private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null;

  constructor(private readonly dependencies: LayerListUiDependencies) {
    this.storage =
      dependencies.storage !== undefined
        ? dependencies.storage
        : typeof window !== 'undefined'
          ? window.localStorage
          : null;
    this.state = {
      parentChainVisible: readStoredParentChainVisible(this.storage),
      batchSelectedLayerIds: [],
    };
    this.contextKey = this.currentContextKey();
    this.unsubscribers = [
      dependencies.editorStore.subscribe(() => this.reconcile()),
      dependencies.shotSelection.subscribe(() => this.reconcile()),
    ];
  }

  readonly getSnapshot = (): LayerListUiState => this.state;

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  dispose(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.listeners.clear();
  }

  setParentChainVisible(visible: boolean): void {
    if (this.state.parentChainVisible === visible) return;
    this.state = { ...this.state, parentChainVisible: visible };
    writeStoredParentChainVisible(this.storage, visible);
    this.emit();
  }

  toggleParentChain(): void {
    this.setParentChainVisible(!this.state.parentChainVisible);
  }

  toggleBatchLayer(layerId: string): void {
    this.reconcile();
    const eligible = this.eligibleBatchLayerIds();
    if (!eligible.has(layerId)) return;
    const current = this.state.batchSelectedLayerIds;
    const next = current.includes(layerId)
      ? current.filter((id) => id !== layerId)
      : [...current, layerId];
    this.state = { ...this.state, batchSelectedLayerIds: next };
    this.emit();
  }

  setBatchSelectedLayerIds(layerIds: readonly string[]): void {
    this.reconcile();
    const eligible = this.eligibleBatchLayerIds();
    const next = Array.from(new Set(layerIds)).filter((id) => eligible.has(id));
    if (
      next.length === this.state.batchSelectedLayerIds.length &&
      next.every((id, index) => id === this.state.batchSelectedLayerIds[index])
    ) {
      return;
    }
    this.state = { ...this.state, batchSelectedLayerIds: next };
    this.emit();
  }

  clearBatchSelection(): void {
    if (this.state.batchSelectedLayerIds.length === 0) return;
    this.state = { ...this.state, batchSelectedLayerIds: [] };
    this.emit();
  }

  private currentContextKey(): string | null {
    const snapshot = this.dependencies.editorStore.getSnapshot();
    const instanceId = this.dependencies.editorStore.getProjectInstanceId();
    const shotId = this.dependencies.shotSelection.getCurrentShotId();
    if (!snapshot || instanceId === null || !shotId) return null;
    return `${instanceId}:${snapshot.project.id}:${snapshot.projectRoot}:${shotId}`;
  }

  private eligibleBatchLayerIds(): Set<string> {
    const snapshot = this.dependencies.editorStore.getSnapshot();
    const shotId = this.dependencies.shotSelection.getCurrentShotId();
    const shot = snapshot?.project.shots.find((candidate) => candidate.id === shotId);
    if (!shot) return new Set();
    return new Set(
      shot.layers
        .filter((layer) => layer.id !== shot.backgroundLayerId && !layer.locked)
        .map((layer) => layer.id),
    );
  }

  private reconcile(): void {
    const nextKey = this.currentContextKey();
    if (nextKey !== this.contextKey) {
      this.contextKey = nextKey;
      if (this.state.batchSelectedLayerIds.length > 0) {
        this.state = { ...this.state, batchSelectedLayerIds: [] };
        this.emit();
      }
      return;
    }
    if (this.state.batchSelectedLayerIds.length === 0) return;
    const eligible = this.eligibleBatchLayerIds();
    const filtered = this.state.batchSelectedLayerIds.filter((id) => eligible.has(id));
    if (filtered.length !== this.state.batchSelectedLayerIds.length) {
      this.state = { ...this.state, batchSelectedLayerIds: filtered };
      this.emit();
    }
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export const layerListUiStore = new LayerListUiStore({
  editorStore: editorProjectStore,
  shotSelection: shotStore,
});

export function useLayerListUi(): LayerListUiState {
  return useSyncExternalStore(
    layerListUiStore.subscribe,
    layerListUiStore.getSnapshot,
  );
}
