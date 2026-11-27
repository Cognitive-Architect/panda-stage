import {
  EditorProjectStore,
  editorProjectStore,
} from './EditorProjectStore';
import type { FlaShapeVertexTarget, Shot } from '../../domain';
import { adaptivePartIdForNodeId, characterPartNodeId, resolveCharacterView, type CharacterNodeId } from '../features/characters/characterView';
import type { FlaGraphicEditScopeState } from '../features/canvas/flaGraphicEditScope';
import {
  shotStore,
  type ShotStore,
} from './shotStore';

type Listener = () => void;

interface SelectionContext {
  projectInstanceId: number | null;
  projectId: string;
  projectRoot: string;
  shotId: string;
}

export class LayerSelectionStore {
  private selectedCharacterNodeId: CharacterNodeId | null = null;
  readonly getSelectedCharacterNodeId = (): CharacterNodeId | null => this.selectedCharacterNodeId;
  readonly selectCharacterNode = (nodeId: CharacterNodeId | null): void => {
    if (nodeId && !this.characterNodeExists(nodeId)) throw new Error('找不到当前角色部件。');
    if (nodeId === this.selectedCharacterNodeId) return;
    this.selectedCharacterNodeId = nodeId;
    for (const listener of this.listeners) listener();
  };
  readonly getSelectedCharacterPartId = (): string | null =>
    adaptivePartIdForNodeId(this.selectedCharacterNodeId);
  readonly selectCharacterPart = (partId: string | null): void =>
    this.selectCharacterNode(partId ? characterPartNodeId(partId) : null);
  private structuredEditScope: FlaGraphicEditScopeState | null = null;
  private selectedStructuredNodePath: readonly string[] | null = null;
  private selectedStructuredRegionRef: string | null = null;
  private flaShapeVertexEditActive = false;
  private selectedFlaShapeVertex: FlaShapeVertexTarget | null = null;
  private selectedLayerId: string | null = null;
  private batchLayerIds: readonly string[] = [];
  private batchContext: SelectionContext | null = null;
  private selectedContext: SelectionContext | null = null;
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

  readonly getBatchLayerIds = (): readonly string[] => this.batchLayerIds;

  readonly toggleBatchLayer = (layerId: string): void => {
    const context = this.currentContext();
    if (!context || context.shot.backgroundLayerId === layerId ||
      !context.shot.layers.some(({ id }) => id === layerId)) return;
    this.batchContext = context;
    this.batchLayerIds = this.batchLayerIds.includes(layerId)
      ? this.batchLayerIds.filter((id) => id !== layerId)
      : [...this.batchLayerIds, layerId];
    for (const listener of this.listeners) listener();
  };

  readonly clearBatchLayers = (): void => {
    if (!this.batchLayerIds.length) return;
    this.batchContext = null;
    this.batchLayerIds = [];
    for (const listener of this.listeners) listener();
  };

  readonly getStructuredEditScope = (): FlaGraphicEditScopeState | null => this.structuredEditScope;
  readonly getSelectedStructuredNodePath = (): readonly string[] | null => this.selectedStructuredNodePath;
  readonly getSelectedStructuredRegionRef = (): string | null => this.selectedStructuredRegionRef;
  readonly isFlaShapeVertexEditActive = (): boolean => this.flaShapeVertexEditActive;
  readonly getSelectedFlaShapeVertex = (): FlaShapeVertexTarget | null => this.selectedFlaShapeVertex;

  readonly setStructuredEditScope = (scope: FlaGraphicEditScopeState | null): void => {
    if (this.structuredEditScope === scope) return;
    this.structuredEditScope = scope;
    for (const listener of this.listeners) listener();
  };

  readonly setSelectedStructuredNodePath = (path: readonly string[] | null): void => {
    this.setSelectedStructuredNodeSelection(path, null);
  };

  readonly setSelectedStructuredNodeSelection = (
    path: readonly string[] | null,
    regionRef: string | null = null,
  ): void => {
    const samePath =
      this.selectedStructuredNodePath === path ||
      (this.selectedStructuredNodePath !== null &&
        path !== null &&
        this.selectedStructuredNodePath.length === path.length &&
        this.selectedStructuredNodePath.every((entry, i) => entry === path[i]));
    if (samePath && this.selectedStructuredRegionRef === regionRef) return;
    this.selectedStructuredNodePath = path;
    this.selectedStructuredRegionRef = regionRef;
    this.selectedFlaShapeVertex = null;
    if (!path) this.flaShapeVertexEditActive = false;
    for (const listener of this.listeners) listener();
  };

  readonly setSelectedStructuredRegionRef = (regionRef: string | null): void => {
    if (this.selectedStructuredRegionRef === regionRef) return;
    this.selectedStructuredRegionRef = regionRef;
    this.selectedFlaShapeVertex = null;
    for (const listener of this.listeners) listener();
  };

  readonly setFlaShapeVertexEditActive = (active: boolean): void => {
    if (this.flaShapeVertexEditActive === active) return;
    this.flaShapeVertexEditActive = active;
    if (!active) this.selectedFlaShapeVertex = null;
    for (const listener of this.listeners) listener();
  };

  readonly setSelectedFlaShapeVertex = (target: FlaShapeVertexTarget | null): void => {
    this.selectedFlaShapeVertex = target;
    for (const listener of this.listeners) listener();
  };

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
      this.clear();
      return;
    }
    this.selectExplicit(layer.id);
  }

  /**
   * Backgrounds are intentionally not hit-testable in the ordinary canvas
   * path. The inspector calls this explicit entry point to enter background
   * management mode without weakening the default anti-misclick contract.
   */
  selectBackground(): void {
    const shot = this.currentShotValue();
    const layerId = shot?.backgroundLayerId;
    if (!shot || !layerId) {
      throw new Error('当前镜头没有可管理的正式背景。');
    }
    this.selectExplicit(layerId);
  }

  selectExplicit(layerId: string): void {
    const context = this.currentContext();
    const layer = context?.shot.layers.find(
      (candidate) => candidate.id === layerId,
    );
    if (!context || !layer) {
      throw new Error(`找不到当前镜头中的图层：${layerId}`);
    }
    this.setSelectedLayerId(layer.id, context);
  }

  clear(): void {
    this.setSelectedLayerId(null, null);
  }

  dispose(): void {
    this.unsubscribeEditor();
    this.unsubscribeShot();
    this.listeners.clear();
  }

  private currentShotValue(): Shot | null {
    return this.currentContext()?.shot ?? null;
  }

  private characterNodeExists(nodeId: CharacterNodeId): boolean {
    const project = this.editorStore.getSnapshot()?.project;
    const layer = this.currentShotValue()?.layers.find((entry) => entry.id === this.selectedLayerId);
    return Boolean(project && resolveCharacterView(project, layer)?.nodes.some((node) => node.id === nodeId));
  }

  private currentContext(): (SelectionContext & { shot: Shot }) | null {
    const snapshot = this.editorStore.getSnapshot();
    const shotId = this.currentShot.getCurrentShotId();
    const shot = snapshot?.project.shots.find(
      (candidate) => candidate.id === shotId,
    );
    if (!snapshot || !shot) return null;
    return {
      projectInstanceId: this.editorStore.getProjectInstanceId(),
      projectId: snapshot.project.id,
      projectRoot: snapshot.projectRoot,
      shotId: shot.id,
      shot,
    };
  }

  private reconcileSelection(): void {
    const context = this.currentContext();
    if (this.batchLayerIds.length) {
      if (!context || context.projectInstanceId !== this.batchContext?.projectInstanceId ||
        context.shotId !== this.batchContext?.shotId) {
        this.clearBatchLayers();
      } else {
        const remaining = this.batchLayerIds.filter((id) =>
          id !== context.shot.backgroundLayerId && context.shot.layers.some((layer) => layer.id === id));
        if (remaining.length !== this.batchLayerIds.length) {
          this.batchLayerIds = remaining;
          for (const listener of this.listeners) listener();
        }
      }
    }
    if (!this.selectedLayerId || !this.selectedContext) return;
    if (
      !context ||
      context.projectId !== this.selectedContext.projectId ||
      context.projectRoot !== this.selectedContext.projectRoot ||
      context.shotId !== this.selectedContext.shotId ||
      !context.shot.layers.some(
        (layer) => layer.id === this.selectedLayerId,
      )
    ) {
      this.setSelectedLayerId(null, null);
    } else if (context.projectInstanceId !== this.selectedContext.projectInstanceId) {
      this.selectedCharacterNodeId = this.characterNodeExists('root') ? 'root' : null;
      this.selectedContext = context;
      this.structuredEditScope = null;
      this.selectedStructuredNodePath = null;
      this.selectedStructuredRegionRef = null;
      this.flaShapeVertexEditActive = false;
      this.selectedFlaShapeVertex = null;
      for (const listener of this.listeners) listener();
    } else if (this.selectedCharacterNodeId && !this.characterNodeExists(this.selectedCharacterNodeId)) {
      this.selectCharacterNode(this.characterNodeExists('root') ? 'root' : null);
    }
  }

  private setSelectedLayerId(
    layerId: string | null,
    context: SelectionContext | null,
  ): void {
    if (layerId === this.selectedLayerId) return;
    this.selectedLayerId = layerId;
    this.selectedCharacterNodeId = layerId && this.characterNodeExists('root') ? 'root' : null;
    this.selectedContext = context;
    this.structuredEditScope = null;
    this.selectedStructuredNodePath = null;
    this.selectedStructuredRegionRef = null;
    this.flaShapeVertexEditActive = false;
    this.selectedFlaShapeVertex = null;
    for (const listener of this.listeners) listener();
  }
}

export const selectionStore = new LayerSelectionStore(
  editorProjectStore,
  shotStore,
);
