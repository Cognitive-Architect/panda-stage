import {
  LayerService,
  type CreateLayerInput,
  type Layer,
  type LayerOrderAction,
  type LayerTransformInput,
  type Point,
  type Project,
} from '../../domain';
import {
  EditorProjectStore,
  editorProjectStore,
} from './EditorProjectStore';
import { shotStore } from './shotStore';

export interface CurrentShotSelection {
  getCurrentShotId: () => string | null;
}

export class LayerStore {
  constructor(
    private readonly editorStore: EditorProjectStore,
    private readonly shotSelection: CurrentShotSelection,
    private readonly service: LayerService,
  ) {}

  createFromAsset(input: CreateLayerInput): Layer {
    const { project, shotId } = this.context();
    const result = this.service.createFromAsset(project, shotId, input);
    this.editorStore.updateProject(result.project);
    return result.layer;
  }

  updatePosition(layerId: string, position: Point): Project {
    const { project, shotId } = this.context();
    const next = this.service.updatePosition(
      project,
      shotId,
      layerId,
      position,
    );
    if (next !== project) this.editorStore.updateProject(next);
    return next;
  }

  setLocked(layerId: string, locked: boolean): Project {
    const { project, shotId } = this.context();
    const next = this.service.setLocked(
      project,
      shotId,
      layerId,
      locked,
    );
    if (next !== project) this.editorStore.updateProject(next);
    return next;
  }

  updateTransform(
    layerId: string,
    input: LayerTransformInput,
  ): Project {
    const { project, shotId } = this.context();
    const next = this.service.updateTransform(
      project,
      shotId,
      layerId,
      input,
    );
    if (next !== project) this.editorStore.updateProject(next);
    return next;
  }

  toggleFlipX(layerId: string): Project {
    const { project, shotId } = this.context();
    const next = this.service.toggleFlipX(project, shotId, layerId);
    if (next !== project) this.editorStore.updateProject(next);
    return next;
  }

  reorder(layerId: string, action: LayerOrderAction): Project {
    const { project, shotId } = this.context();
    const next = this.service.reorder(
      project,
      shotId,
      layerId,
      action,
    );
    if (next !== project) this.editorStore.updateProject(next);
    return next;
  }

  deleteLayer(layerId: string): Project {
    const { project, shotId } = this.context();
    const next = this.service.deleteLayer(project, shotId, layerId);
    if (next !== project) this.editorStore.updateProject(next);
    return next;
  }

  private context(): { project: Project; shotId: string } {
    const snapshot = this.editorStore.getSnapshot();
    const shotId = this.shotSelection.getCurrentShotId();
    if (!snapshot || !shotId) {
      throw new Error('请先打开项目并选择镜头。');
    }
    return { project: snapshot.project, shotId };
  }
}

export const layerStore = new LayerStore(
  editorProjectStore,
  shotStore,
  new LayerService(),
);
