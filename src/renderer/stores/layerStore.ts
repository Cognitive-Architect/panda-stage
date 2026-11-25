import {
  LayerMotionService,
  LayerService,
  type AfterimageInput,
  type CreateLayerInput,
  type AnimationPlaybackInput,
  type FlaEditableShapeRegion,
  type FlaGraphicTransformEasing,
  type FlaShapeVertexTarget,
  type GridArrayInput,
  type Layer,
  type LayerCurveMotionInput,
  type LayerDisplayTransformPatch,
  type LayerOrderAction,
  type LayerTransformInput,
  type PathArrayInput,
  type Point,
  type Project,
  type RadialArrayInput,
  type RadialBurstInput,
} from '../../domain';
import type { AffineMatrix2D } from '../../shared/affine-matrix';
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
  private readonly motionService = new LayerMotionService();

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

  applySourceLoop(layerId: string, input: Parameters<LayerService['applySourceLoop']>[3]): string | undefined {
    const { project, shotId } = this.context();
    const result = this.service.applySourceLoop(project, shotId, layerId, input);
    if (result.project !== project) this.editorStore.updateProject(result.project, '设置动画循环范围');
    return result.stoppedAt;
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

  duplicateAnimationLayerGrid(
    layerId: string,
    input: GridArrayInput,
  ): readonly Layer[] {
    const { project, shotId } = this.context();
    const result = this.service.duplicateAnimationLayerGrid(
      project,
      shotId,
      layerId,
      input,
    );
    if (result.project !== project) {
      this.editorStore.updateProject(result.project, '排兵布阵');
    }
    return result.layers;
  }

  duplicateAnimationLayerRadial(
    layerId: string,
    input: RadialArrayInput,
  ): readonly Layer[] {
    const { project, shotId } = this.context();
    const result = this.service.duplicateAnimationLayerRadial(
      project,
      shotId,
      layerId,
      input,
    );
    if (result.project !== project) {
      this.editorStore.updateProject(result.project, '径向阵列');
    }
    return result.layers;
  }

  duplicateAnimationLayerAlongPath(
    layerId: string,
    input: PathArrayInput,
  ): readonly Layer[] {
    const { project, shotId } = this.context();
    const result = this.service.duplicateAnimationLayerAlongPath(
      project,
      shotId,
      layerId,
      input,
    );
    if (result.project !== project) {
      this.editorStore.updateProject(result.project, '沿路径阵列');
    }
    return result.layers;
  }

  generateAfterimages(
    layerId: string,
    input: AfterimageInput,
  ): readonly Layer[] {
    const { project, shotId } = this.context();
    const result = this.service.generateAfterimages(
      project,
      shotId,
      layerId,
      input,
    );
    if (result.project !== project) {
      this.editorStore.updateProject(result.project, '生成位置残影');
    }
    return result.layers;
  }

  generateRadialBurst(
    layerId: string,
    input: RadialBurstInput,
  ): readonly Layer[] {
    const { project, shotId } = this.context();
    const result = this.service.generateRadialBurst(
      project,
      shotId,
      layerId,
      input,
    );
    if (result.project !== project) {
      this.editorStore.updateProject(result.project, '生成径向爆炸');
    }
    return result.layers;
  }

  applyCurveMotion(
    layerId: string,
    input: Omit<LayerCurveMotionInput, 'shotId' | 'layerId'>,
  ): Project {
    const { project, shotId } = this.context();
    const next = this.motionService.applyCurveMotion(project, {
      ...input,
      shotId,
      layerId,
    });
    if (next !== project) {
      this.editorStore.updateProject(next, '生成曲线运动');
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

  applyMotionTransform(
    layerId: string,
    timeMs: number,
    autoKey: boolean,
    patch: LayerDisplayTransformPatch,
  ): Project {
    const { project, shotId } = this.context();
    const next = this.motionService.applyTransform(
      project,
      { shotId, layerId, timeMs, autoKey },
      patch,
    );
    if (next !== project) {
      this.editorStore.updateProject(
        next,
        autoKey ? '记录图层动作关键帧' : '修改图层变换',
      );
    }
    return next;
  }

  updateFlaGraphicInstanceTransform(
    layerId: string,
    frameOrdinal: number,
    nodePath: readonly string[],
    localTransform: AffineMatrix2D,
  ): Project {
    const { project, shotId } = this.context();
    const next = this.service.updateFlaGraphicInstanceTransform(
      project,
      shotId,
      layerId,
      frameOrdinal,
      nodePath,
      localTransform,
    );
    if (next !== project) {
      this.editorStore.updateProject(next, 'Edit Graphic instance');
    }
    return next;
  }

  updateFlaGraphicSharedDefinitionTransform(
    layerId: string,
    frameOrdinal: number,
    nodePath: readonly string[],
    localTransform: AffineMatrix2D,
  ): Project {
    const { project, shotId } = this.context();
    const next = this.service.updateFlaGraphicSharedDefinitionTransform(
      project,
      shotId,
      layerId,
      frameOrdinal,
      nodePath,
      localTransform,
    );
    if (next !== project) {
      this.editorStore.updateProject(next, '编辑共享元件');
    }
    return next;
  }

  extractFlaGraphicShapeRegion(input: {
    readonly layerId: string;
    readonly frameOrdinal: number;
    readonly nodePath: readonly string[];
    readonly regionRef: string;
    readonly mode: 'instance' | 'definition';
    readonly svgText?: string;
    readonly displayName?: string;
  }): {
    readonly project: Project;
    readonly extractedNodePath: readonly string[];
    readonly region: FlaEditableShapeRegion;
  } {
    const { project, shotId } = this.context();
    const result = this.service.extractFlaGraphicShapeRegion(project, {
      shotId,
      ...input,
    });
    if (result.project !== project) {
      this.editorStore.updateProject(
        result.project,
        input.mode === 'definition' ? '提取共享区域' : '提取独立区域',
      );
    }
    return result;
  }

  updateFlaGraphicShapeRegionFillColor(input: {
    readonly layerId: string;
    readonly frameOrdinal: number;
    readonly nodePath: readonly string[];
    readonly regionRef?: string;
    readonly mode: 'instance' | 'definition';
    readonly color: string;
    readonly opacity?: number;
    readonly svgText?: string;
  }): Project {
    const { project, shotId } = this.context();
    const next = this.service.updateFlaGraphicShapeRegionFillColor(project, {
      shotId,
      ...input,
    });
    if (next !== project) {
      this.editorStore.updateProject(next, '修改区域颜色');
    }
    return next;
  }

  moveFlaGraphicShapeRegionVertex(input: {
    readonly layerId: string;
    readonly frameOrdinal: number;
    readonly nodePath: readonly string[];
    readonly regionRef?: string;
    readonly mode: 'instance' | 'definition';
    readonly target: FlaShapeVertexTarget;
    readonly x: number;
    readonly y: number;
    readonly svgText?: string;
  }): Project {
    const { project, shotId } = this.context();
    const next = this.service.moveFlaGraphicShapeRegionVertex(project, {
      shotId,
      ...input,
    });
    if (next !== project) {
      this.editorStore.updateProject(next, '编辑路径顶点');
    }
    return next;
  }

  private commitTimelineEdit(
    project: Project,
    next: Project,
    label: string,
  ): Project {
    if (next !== project) {
      this.editorStore.updateProject(next, label);
    }
    return next;
  }

  addFlaGraphicTimelineKeyframe(
    layerId: string,
    frameOrdinal: number,
    nodePath: readonly string[],
    timeMs: number,
    easing: FlaGraphicTransformEasing = 'linear',
  ): Project {
    const { project, shotId } = this.context();
    const next = this.service.addFlaGraphicTimelineKeyframe(
      project,
      shotId,
      layerId,
      frameOrdinal,
      nodePath,
      timeMs,
      easing,
    );
    return this.commitTimelineEdit(project, next, '添加元件关键帧');
  }

  updateFlaGraphicTimelineKeyframeTransform(
    layerId: string,
    frameOrdinal: number,
    nodePath: readonly string[],
    timeMs: number,
    localTransform: AffineMatrix2D,
  ): Project {
    const { project, shotId } = this.context();
    const next = this.service.updateFlaGraphicTimelineKeyframeTransform(
      project,
      shotId,
      layerId,
      frameOrdinal,
      nodePath,
      timeMs,
      localTransform,
    );
    return this.commitTimelineEdit(project, next, '编辑元件关键帧');
  }

  deleteFlaGraphicTimelineKeyframe(
    layerId: string,
    frameOrdinal: number,
    nodePath: readonly string[],
    timeMs: number,
  ): Project {
    const { project, shotId } = this.context();
    const next = this.service.deleteFlaGraphicTimelineKeyframe(
      project,
      shotId,
      layerId,
      frameOrdinal,
      nodePath,
      timeMs,
    );
    return this.commitTimelineEdit(project, next, '删除元件关键帧');
  }

  moveFlaGraphicTimelineKeyframe(
    layerId: string,
    frameOrdinal: number,
    nodePath: readonly string[],
    fromTimeMs: number,
    toTimeMs: number,
  ): Project {
    const { project, shotId } = this.context();
    const next = this.service.moveFlaGraphicTimelineKeyframe(
      project,
      shotId,
      layerId,
      frameOrdinal,
      nodePath,
      fromTimeMs,
      toTimeMs,
    );
    return this.commitTimelineEdit(project, next, '移动元件关键帧');
  }

  duplicateFlaGraphicTimelineKeyframe(
    layerId: string,
    frameOrdinal: number,
    nodePath: readonly string[],
    fromTimeMs: number,
    toTimeMs: number,
  ): Project {
    const { project, shotId } = this.context();
    const next = this.service.duplicateFlaGraphicTimelineKeyframe(
      project,
      shotId,
      layerId,
      frameOrdinal,
      nodePath,
      fromTimeMs,
      toTimeMs,
    );
    return this.commitTimelineEdit(project, next, '复制元件关键帧');
  }

  setFlaGraphicTimelineKeyframeEasing(
    layerId: string,
    frameOrdinal: number,
    nodePath: readonly string[],
    timeMs: number,
    easing: FlaGraphicTransformEasing,
  ): Project {
    const { project, shotId } = this.context();
    const next = this.service.setFlaGraphicTimelineKeyframeEasing(
      project,
      shotId,
      layerId,
      frameOrdinal,
      nodePath,
      timeMs,
      easing,
    );
    return this.commitTimelineEdit(project, next, '修改元件补间曲线');
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
