import {
  EditorProjectStore,
  editorProjectStore,
} from './EditorProjectStore';
import type { Shot } from '../../domain';
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
  private structuredEditScope: FlaGraphicEditScopeState | null = null;
  private selectedStructuredNodePath: readonly string[] | null = null;
  private selectedLayerId: string | null = null;
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

  readonly getStructuredEditScope = (): FlaGraphicEditScopeState | null => this.structuredEditScope;
  readonly getSelectedStructuredNodePath = (): readonly string[] | null => this.selectedStructuredNodePath;

  readonly setStructuredEditScope = (scope: FlaGraphicEditScopeState | null): void => {
    if (this.structuredEditScope === scope) return;
    this.structuredEditScope = scope;
    for (const listener of this.listeners) listener();
  };

  readonly setSelectedStructuredNodePath = (path: readonly string[] | null): void => {
    if (this.selectedStructuredNodePath === path) return;
    this.selectedStructuredNodePath = path;
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
    if (!this.selectedLayerId || !this.selectedContext) return;
    const context = this.currentContext();
    if (
      !context ||
      context.projectInstanceId !== this.selectedContext.projectInstanceId ||
      context.projectId !== this.selectedContext.projectId ||
      context.projectRoot !== this.selectedContext.projectRoot ||
      context.shotId !== this.selectedContext.shotId ||
      !context.shot.layers.some(
        (layer) => layer.id === this.selectedLayerId,
      )
    ) {
      this.setSelectedLayerId(null, null);
    }
  }

  private setSelectedLayerId(
    layerId: string | null,
    context: SelectionContext | null,
  ): void {
    if (layerId === this.selectedLayerId) return;
    this.selectedLayerId = layerId;
    this.selectedContext = context;
    this.structuredEditScope = null;
    this.selectedStructuredNodePath = null;
    for (const listener of this.listeners) listener();
  }
}

export const selectionStore = new LayerSelectionStore(
  editorProjectStore,
  shotStore,
);
