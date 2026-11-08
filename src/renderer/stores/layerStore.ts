import {
  LayerService,
  type CreateLayerInput,
  type AnimationPlaybackInput,
  type Layer,
  type LayerOrderAction,
  type LayerTransformInput,
  type LayoutLayerTransform,
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
    const { project, projectRoot, shotId } = this.context();
    const result = this.service.createFromAsset(project, shotId, input);
    return this.persistCreatedLayer(
      result,
      project.id,
      projectRoot,
      shotId,
    );
  }

  createAdaptiveCharacter(
    characterId: string,
    position: Point,
  ): Layer {
    const { project, projectRoot, shotId } = this.context();
    const result = this.service.createFromAdaptiveCharacter(
      project,
      shotId,
      characterId,
      position,
    );
    return this.persistCreatedLayer(
      result,
      project.id,
      projectRoot,
      shotId,
    );
  }

  private persistCreatedLayer(
    result: ReturnType<LayerService['createFromAsset']>,
    projectId: string,
    projectRoot: string,
    shotId: string,
  ): Layer {
    this.editorStore.updateProject(
      result.project,
      'Create layer',
      {},
      {
        afterRedo: () =>
          this.restoreCreatedLayerSelection(
            projectId,
            projectRoot,
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

  fillBackground(): Project {
    const { project, shotId } = this.context();
    const next = this.service.fillBackground(project, shotId);
    if (next !== project) {
      this.editorStore.updateProject(next, 'Fill shot background');
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

  /**
   * Commit several Layer positions as one formal edit. Every position is
   * applied in memory first, so a rejected position leaves the Project
   * untouched and the store records exactly one History command.
   */
  updatePositions(
    entries: readonly { layerId: string; position: Point }[],
    label = 'Move layers',
  ): Project {
    const { project, shotId } = this.context();
    let next = project;
    for (const entry of entries) {
      next = this.service.updatePosition(
        next,
        shotId,
        entry.layerId,
        entry.position,
      );
    }
    if (next !== project) {
      this.editorStore.updateProject(next, label);
    }
    return next;
  }

  /**
   * Commit one align/distribute result as a single formal edit. Every Layer
   * transform is applied in memory first, so a rejected entry leaves the
   * Project untouched and History records exactly one command.
   */
  applyLayoutTransforms(
    entries: readonly LayoutLayerTransform[],
    label = 'Arrange layers',
  ): Project {
    const { project, shotId } = this.context();
    let next = project;
    for (const entry of entries) {
      next = this.service.updateLayoutTransform(next, shotId, entry.layerId, {
        x: entry.x,
        y: entry.y,
        scaleX: entry.scaleX,
        scaleY: entry.scaleY,
      });
    }
    if (next !== project) {
      this.editorStore.updateProject(next, label);
    }
    return next;
  }

  updateAnimationPlayback(
    layerId: string,
    input: AnimationPlaybackInput,
  ): Project {
    const { project, shotId } = this.context();
    const next = this.service.updateAnimationPlayback(
      project,
      shotId,
      layerId,
      input,
    );
    if (next !== project) {
      this.editorStore.updateProject(next, 'Edit animation playback');
    }
    return next;
  }

  duplicateAnimationLayer(layerId: string): Layer {
    const { project, projectRoot, shotId } = this.context();
    const result = this.service.duplicateAnimationLayer(
      project,
      shotId,
      layerId,
    );
    this.editorStore.updateProject(
      result.project,
      'Duplicate animation layer',
      {},
      {
        afterRedo: () =>
          this.restoreCreatedLayerSelection(
            project.id,
            projectRoot,
            shotId,
            result.layer.id,
          ),
      },
    );
    return result.layer;
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

  private context(): {
    project: Project;
    projectRoot: string;
    shotId: string;
  } {
    const snapshot = this.editorStore.getSnapshot();
    const shotId = this.shotSelection.getCurrentShotId();
    if (!snapshot || !shotId) {
      throw new Error('请先打开项目并选择镜头。');
    }
    return {
      project: snapshot.project,
      projectRoot: snapshot.projectRoot,
      shotId,
    };
  }

  private restoreCreatedLayerSelection(
    projectId: string,
    projectRoot: string,
    shotId: string,
    layerId: string,
  ): void {
    const snapshot = this.editorStore.getSnapshot();
    if (
      !snapshot ||
      snapshot.project.id !== projectId ||
      snapshot.projectRoot !== projectRoot ||
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
