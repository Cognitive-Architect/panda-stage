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
import { selectionStore } from './selectionStore';
import { shotStore } from './shotStore';

export interface CurrentShotSelection {
  getCurrentShotId: () => string | null;
}

export interface LayerSelection {
  select: (layerId: string) => void;
}

const noopLayerSelection: LayerSelection = {
  select: () => undefined,
};

export class LayerStore {
  constructor(
    private readonly editorStore: EditorProjectStore,
    private readonly shotSelection: CurrentShotSelection,
    private readonly service: LayerService,
    private readonly layerSelection: LayerSelection = noopLayerSelection,
  ) {}

  createFromAsset(input: CreateLayerInput): Layer {
    const { project, shotId } = this.context();
    const result = this.service.createFromAsset(project, shotId, input);
    this.editorStore.updateProject(
      result.project,
      'Create layer',
      {},
      {
        afterRedo: () =>
          this.restoreCreatedLayerSelection(
            project.id,
            shotId,
            result.layer.id,
          ),
      },
    );
    return result.layer;
  }

  setBackground(layerId: string): Project {
    const { project, shotId } = this.context();
    const next = this.service.setBackground(project, shotId, layerId);
    if (next !== project) {
      this.editorStore.updateProject(next, 'Set shot background');
    }
    return next;
  }

  clearBackground(): Project {
    const { project, shotId } = this.context();
    const next = this.service.clearBackground(project, shotId);
    if (next !== project) {
      this.editorStore.updateProject(next, 'Clear shot background');
    }
    return next;
  }

  updatePosition(layerId: string, position: Point): Project {
    const { project, shotId } = this.context();
    const next = this.service.updatePosition(
      project,
      shotId,
      layerId,
      position,
    );
    if (next !== project) {
      this.editorStore.updateProject(next, 'Move layer');
    }
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
    if (next !== project) {
      this.editorStore.updateProject(
        next,
        locked ? 'Lock layer' : 'Unlock layer',
      );
    }
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
    if (next !== project) {
      this.editorStore.updateProject(next, 'Transform layer');
    }
    return next;
  }

  toggleFlipX(layerId: string): Project {
    const { project, shotId } = this.context();
    const next = this.service.toggleFlipX(project, shotId, layerId);
    if (next !== project) {
      this.editorStore.updateProject(next, 'Flip layer');
    }
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
    if (next !== project) {
      this.editorStore.updateProject(next, 'Reorder layer');
    }
    return next;
  }

  deleteLayer(layerId: string): Project {
    const { project, shotId } = this.context();
    const next = this.service.deleteLayer(project, shotId, layerId);
    if (next !== project) {
      this.editorStore.updateProject(next, 'Delete layer');
    }
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

  private restoreCreatedLayerSelection(
    projectId: string,
    shotId: string,
    layerId: string,
  ): void {
    const snapshot = this.editorStore.getSnapshot();
    if (
      !snapshot ||
      snapshot.project.id !== projectId ||
      this.shotSelection.getCurrentShotId() !== shotId
    ) {
      return;
    }
    const shot = snapshot.project.shots.find(
      (candidate) => candidate.id === shotId,
    );
    if (
      !shot ||
      shot.backgroundLayerId === layerId ||
      !shot.layers.some((layer) => layer.id === layerId)
    ) {
      return;
    }
    this.layerSelection.select(layerId);
  }
}

export const layerStore = new LayerStore(
  editorProjectStore,
  shotStore,
  new LayerService(),
  selectionStore,
);
