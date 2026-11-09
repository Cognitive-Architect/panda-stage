import {
  LayerService,
  PartPoseAnimationService,
  evaluatePartPoseAnimationAtTime,
  type PartPoseEasing,
  type PartPoseKeyframe,
  type PartPosePoint,
  type CreateLayerInput,
  type AnimationPlaybackInput,
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
  getSelectedLayerId: () => string | null;
}

const noopLayerSelection: LayerSelection = {
  select: () => undefined,
  getSelectedLayerId: () => null,
};

interface CapturedPoseEditContext {
  editContext: NonNullable<
    ReturnType<EditorProjectStore['captureEditContext']>
  >;
  project: Project;
  shotId: string;
  layerId: string;
}

export class LayerStore {
  constructor(
    private readonly editorStore: EditorProjectStore,
    private readonly shotSelection: CurrentShotSelection,
    private readonly service: LayerService,
    private readonly layerSelection: LayerSelection = noopLayerSelection,
    private readonly poseService = new PartPoseAnimationService(),
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

  duplicateCharacterLayer(layerId: string): Layer {
    const { project, projectRoot, shotId } = this.context();
    const result = this.service.duplicateCharacterLayer(
      project,
      shotId,
      layerId,
    );
    this.editorStore.updateProject(
      result.project,
      'Duplicate Character layer',
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

  createPartPoseAnimation(
    layerId: string,
    pivotSourceByPartId?: Readonly<Record<string, PartPosePoint>>,
  ): Project {
    const context = this.poseContext(layerId);
    const next = this.poseService.create(context.project, {
      shotId: context.shotId,
      layerId,
      ...(pivotSourceByPartId ? { pivotSourceByPartId } : {}),
    });
    this.commitPoseProject(context, next, 'Capture Part pose snapshot');
    return next;
  }

  setPartPosePivot(
    layerId: string,
    partId: string,
    pivotSource: PartPosePoint,
  ): Project {
    const context = this.poseContext(layerId);
    const next = this.poseService.setPivot(context.project, {
      shotId: context.shotId,
      layerId,
      partId,
      pivotSource,
    });
    if (next !== context.project) {
      this.commitPoseProject(context, next, 'Set Part pose pivot');
    }
    return next;
  }

  setPartPoseKeyframe(
    layerId: string,
    partId: string,
    keyframe: PartPoseKeyframe,
  ): Project {
    const context = this.poseContext(layerId);
    const next = this.poseService.setKeyframe(context.project, {
      shotId: context.shotId,
      layerId,
      partId,
      keyframe,
    });
    if (next !== context.project) {
      this.commitPoseProject(context, next, 'Set Part pose keyframe');
    }
    return next;
  }

  retimePartPoseKeyframe(
    layerId: string,
    partId: string,
    fromTimeMs: number,
    toTimeMs: number,
  ): Project {
    const context = this.poseContext(layerId);
    const next = this.poseService.retimeKeyframe(context.project, {
      shotId: context.shotId,
      layerId,
      partId,
      fromTimeMs,
      toTimeMs,
    });
    if (next !== context.project) {
      this.commitPoseProject(context, next, 'Retime Part pose keyframe');
    }
    return next;
  }

  copyPartPoseKeyframe(
    layerId: string,
    partId: string,
    sourceTimeMs: number,
    targetTimeMs: number,
    sourceKeyframe?: PartPoseKeyframe,
  ): Project {
    const context = this.poseContext(layerId);
    const next = this.poseService.copyKeyframe(context.project, {
      shotId: context.shotId,
      layerId,
      partId,
      sourceTimeMs,
      targetTimeMs,
      ...(sourceKeyframe ? { sourceKeyframe } : {}),
    });
    if (next !== context.project) {
      this.commitPoseProject(context, next, 'Copy Part pose keyframe');
    }
    return next;
  }

  deletePartPoseKeyframe(
    layerId: string,
    partId: string,
    timeMs: number,
  ): Project {
    const context = this.poseContext(layerId);
    const next = this.poseService.deleteKeyframe(context.project, {
      shotId: context.shotId,
      layerId,
      partId,
      timeMs,
    });
    if (next !== context.project) {
      this.commitPoseProject(context, next, 'Delete Part pose keyframe');
    }
    return next;
  }

  setPartPoseKeyEasing(
    layerId: string,
    partId: string,
    timeMs: number,
    easingToNext: PartPoseEasing,
  ): Project {
    const context = this.poseContext(layerId);
    const next = this.poseService.setKeyEasing(context.project, {
      shotId: context.shotId,
      layerId,
      partId,
      timeMs,
      easingToNext,
    });
    if (next !== context.project) {
      this.commitPoseProject(context, next, 'Set Part pose key easing');
    }
    return next;
  }

  addPartPoseKeyframe(
    layerId: string,
    partId: string,
    timeMs: number,
    pivotSource?: PartPosePoint,
  ): Project {
    const context = this.poseContext(layerId);
    let next = context.project;
    const shot = next.shots.find((candidate) => candidate.id === context.shotId);
    const layer = shot?.layers.find((candidate) => candidate.id === layerId);
    if (!shot || !layer) {
      throw new Error('镜头或角色图层已改变，请重新选择后再添加关键帧。');
    }
    const creatingAnimation = !layer.poseAnimation;
    if (creatingAnimation) {
      next = this.poseService.create(next, {
        shotId: context.shotId,
        layerId,
        ...(pivotSource ? { pivotSourceByPartId: { [partId]: pivotSource } } : {}),
      });
      if (timeMs === 0) {
        this.commitPoseProject(context, next, 'Add Part pose keyframe');
        return next;
      }
    }
    const capturedLayer = next.shots
      .find((candidate) => candidate.id === context.shotId)
      ?.layers.find((candidate) => candidate.id === layerId);
    const animation = capturedLayer?.poseAnimation;
    const track = animation?.tracks.find((candidate) => candidate.partId === partId);
    if (!animation || !track) {
      throw new Error('无法找到所选部件的动作轨道，请重新选择后再试。');
    }
    if (!creatingAnimation && track.keys.some((key) => key.timeMs === timeMs)) {
      throw new Error('此时间已有关键帧，可直接在画布上编辑。');
    }
    const evaluated = evaluatePartPoseAnimationAtTime(animation, timeMs).find(
      (pose) => pose.partId === partId,
    );
    if (!evaluated) {
      throw new Error('无法读取所选部件当前姿势，请重新选择后再试。');
    }
    next = this.poseService.setKeyframe(next, {
      shotId: context.shotId,
      layerId,
      partId,
      keyframe: {
        timeMs,
        offsetX: evaluated.offsetX,
        offsetY: evaluated.offsetY,
        rotationDeg: evaluated.rotationDeg,
        scale: evaluated.scale,
        easingToNext: 'linear',
      },
    });
    if (next !== context.project) {
      this.commitPoseProject(context, next, 'Add Part pose keyframe');
    }
    return next;
  }

  clearPartPoseTrack(layerId: string, partId: string) {
    const context = this.poseContext(layerId);
    const result = this.poseService.clearTrack(context.project, {
      shotId: context.shotId,
      layerId,
      partId,
    });
    if (result.changed) {
      this.commitPoseProject(context, result.project, 'Clear Part pose track');
    }
    return result;
  }

  clearPartPoseAnimation(layerId: string) {
    const context = this.poseContext(layerId);
    const result = this.poseService.clearAnimation(context.project, {
      shotId: context.shotId,
      layerId,
    });
    this.commitPoseProject(context, result.project, 'Clear Part pose animation');
    return result;
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

  private poseContext(layerId: string): CapturedPoseEditContext {
    const editContext = this.editorStore.captureEditContext();
    if (!editContext) {
      throw new Error('Open a project before editing Part poses.');
    }
    const { project, shotId } = this.context();
    if (this.layerSelection.getSelectedLayerId() !== layerId) {
      throw new Error(
        'The Part pose command target is no longer the selected Character Layer.',
      );
    }
    return { editContext, project, shotId, layerId };
  }

  private commitPoseProject(
    context: CapturedPoseEditContext,
    project: Project,
    label: string,
  ): void {
    if (
      this.shotSelection.getCurrentShotId() !== context.shotId ||
      this.layerSelection.getSelectedLayerId() !== context.layerId
    ) {
      throw new Error(
        'The selected Shot or Character Layer changed before the Part pose command could commit.',
      );
    }
    this.editorStore.updateProjectAtContext(
      context.editContext,
      project,
      label,
    );
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
