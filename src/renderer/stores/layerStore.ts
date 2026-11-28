import {
  LayerMotionService,
  LayerService,
  createNativeGraphicDefinitionFromNodes,
  deleteNativeGraphicDefinition,
  duplicateNativeGraphicDefinition,
  addNativeGraphicNode,
  moveNativeGraphicNode,
  removeNativeGraphicNode,
  replaceNativeGraphicNode,
  type AfterimageInput,
  type BackgroundTileInput,
  type ConvergingFlightInput,
  type DiffusionGhostInput,
  type CreateLayerInput,
  type AnimationPlaybackInput,
  type FlaEditableShapeRegion,
  type FlaGraphicTransformEasing,
  type FlaShapeTweenEasing,
  type FlaShapeTweenHintLocation,
  type FlaShapeVertexTarget,
  type GridArrayInput,
  type Layer,
  type LayerCurveMotionInput,
  type LayerAttachmentTarget,
  type LayerDisplayTransformPatch,
  type LayerOrderAction,
  type LayerTransformInput,
  type OrbitFlightInput,
  type PathArrayInput,
  type Point,
  type Project,
  type RadialArrayInput,
  type RadialBurstInput,
  type SetParentKeyOptions,
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
  private clipboard: { project: Project; shotId: string; layerId: string; timeMs: number; instance: number | null } | null = null;

  constructor(
    private readonly editorStore: EditorProjectStore,
    private readonly shotSelection: CurrentShotSelection,
    private readonly service: LayerService,
    private readonly layerSelection: LayerSelection = noopLayerSelection,
  ) {}

  createControl(): Layer {
    const { project, projectRoot, shotId } = this.context();
    const result = this.service.createControl(project, shotId);
    const created = this.persistCreatedLayer(result, project.id, projectRoot, shotId);
    this.layerSelection.select(created.id);
    return created;
  }

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

  planBackgroundTiles(layerId: string, input: BackgroundTileInput) {
    const { project, shotId } = this.context();
    return this.service.planBackgroundTiles(project, shotId, layerId, input);
  }

  generateBackgroundTiles(layerId: string, input: BackgroundTileInput): readonly Layer[] {
    const { project, shotId } = this.context();
    const result = this.service.generateBackgroundTiles(project, shotId, layerId, input);
    this.editorStore.updateProject(result.project, '背景铺排 / 循环');
    return result.layers;
  }

  generateOrbitFlight(layerId: string, input: OrbitFlightInput): readonly Layer[] {
    const { project, shotId } = this.context();
    const result = this.service.generateOrbitFlight(project, shotId, layerId, input);
    this.editorStore.updateProject(result.project, '环绕飞行');
    return result.layers;
  }

  generateConvergingFlight(layerId: string, input: ConvergingFlightInput): readonly Layer[] {
    const { project, shotId } = this.context();
    const result = this.service.generateConvergingFlight(project, shotId, layerId, input);
    this.editorStore.updateProject(result.project, '万剑归宗');
    return result.layers;
  }

  generateDiffusionGhosts(layerId: string, input: DiffusionGhostInput): readonly Layer[] {
    const { project, shotId } = this.context();
    const result = this.service.generateDiffusionGhosts(project, shotId, layerId, input);
    this.editorStore.updateProject(result.project, '扩散虚影');
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

  copyLayer(layerId: string, timeMs: number): void {
    const { project, shotId } = this.context();
    const shot = project.shots.find(({ id }) => id === shotId);
    const layer = shot?.layers.find(({ id }) => id === layerId);
    if (!layer || layer.locked || shot?.backgroundLayerId === layerId) return;
    this.clipboard = { project, shotId, layerId, timeMs, instance: this.editorStore.getProjectInstanceId() };
  }

  hasLayerClipboard(): boolean {
    return !!this.clipboard && this.clipboard.instance === this.editorStore.getProjectInstanceId();
  }

  pasteLayer(): void {
    const source = this.clipboard;
    if (!source || !this.hasLayerClipboard()) return;
    const { project, projectRoot, shotId } = this.context();
    const result = this.service.duplicateLayer(project, source.shotId, source.layerId, shotId, source.timeMs, source.project);
    this.editorStore.updateProject(result.project, '粘贴图层', {}, {
      afterRedo: () => this.restoreCreatedLayerSelection(project.id, projectRoot, shotId, result.layer.id),
    });
    this.layerSelection.select(result.layer.id);
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
    appearance?: Partial<Pick<Layer, 'opacity' | 'flipX'>>,
  ): Project {
    const { project, shotId } = this.context();
    const nextTransform = Object.keys(patch).length === 0 ? project : this.motionService.applyTransform(
      project,
      { shotId, layerId, timeMs, autoKey },
      patch,
    );
    const next = appearance ? this.service.updateLayerAppearance(nextTransform, shotId, layerId, appearance) : nextTransform;
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

  updateFlaGraphicInstanceText(
    layerId: string,
    frameOrdinal: number,
    nodePath: readonly string[],
    characters: string,
  ): Project {
    const { project, shotId } = this.context();
    const next = this.service.updateFlaGraphicInstanceText(project, shotId, layerId, frameOrdinal, nodePath, characters);
    if (next !== project) this.editorStore.updateProject(next, '替换文字');
    return next;
  }

  setFlaGraphicNodeIdentityAlias(
    layerId: string,
    frameOrdinal: number,
    nodePath: readonly string[],
    aliasId?: string,
  ): Project {
    const { project, shotId } = this.context();
    const next = this.service.setFlaGraphicNodeIdentityAlias(
      project,
      shotId,
      layerId,
      frameOrdinal,
      nodePath,
      aliasId,
    );
    if (next !== project) this.editorStore.updateProject(next, '建立节点关联');
    return next;
  }

  clearFlaGraphicNodeIdentityAlias(
    layerId: string,
    frameOrdinal: number,
    nodePath: readonly string[],
  ): Project {
    const { project, shotId } = this.context();
    const next = this.service.clearFlaGraphicNodeIdentityAlias(
      project,
      shotId,
      layerId,
      frameOrdinal,
      nodePath,
    );
    if (next !== project) this.editorStore.updateProject(next, '解除节点关联');
    return next;
  }

  /** Creates a reusable native Graphic Definition from 2+ staged editable nodes. */
  createNativeGraphicFromSelection(input: {
    readonly shotId: string;
    readonly layerId: string;
    readonly frameOrdinal: number;
    readonly nodePaths: readonly (readonly string[])[];
    readonly name?: string;
  }): { readonly animationId: string; readonly name: string } {
    const snapshot = this.editorStore.getSnapshot();
    if (!snapshot) throw new Error('请先打开项目。');
    const result = createNativeGraphicDefinitionFromNodes(snapshot.project, {
      ...input,
      createId: () => crypto.randomUUID(),
    });
    this.editorStore.updateProject(result.project, '创建原生元件');
    return { animationId: result.animationId, name: result.name };
  }

  duplicateNativeGraphicDefinition(animationId: string): { animationId: string; name: string } {
    const snapshot = this.editorStore.getSnapshot();
    if (!snapshot) throw new Error('请先打开项目。');
    const result = duplicateNativeGraphicDefinition(snapshot.project, {
      animationId,
      createId: () => crypto.randomUUID(),
    });
    this.editorStore.updateProject(result.project, '独立副本');
    return { animationId: result.animationId, name: result.name };
  }

  deleteNativeGraphicDefinition(animationId: string): readonly { assetId: string; name: string }[] {
    const snapshot = this.editorStore.getSnapshot();
    if (!snapshot) throw new Error('请先打开项目。');
    const result = deleteNativeGraphicDefinition(snapshot.project, { animationId });
    this.editorStore.updateProject(result.project, '删除原生元件');
    return result.releasedAssets;
  }

  removeNativeGraphicNode(
    animationId: string,
    frameOrdinal: number,
    nodePath: readonly string[],
  ): Project {
    const snapshot = this.editorStore.getSnapshot();
    if (!snapshot) throw new Error('请先打开项目。');
    const next = removeNativeGraphicNode(snapshot.project, {
      animationId,
      frameOrdinal,
      nodePath,
    });
    if (next !== snapshot.project) this.editorStore.updateProject(next, '删除元件节点');
    return next;
  }

  moveNativeGraphicNode(
    animationId: string,
    frameOrdinal: number,
    nodePath: readonly string[],
    direction: 1 | -1,
  ): Project {
    const snapshot = this.editorStore.getSnapshot();
    if (!snapshot) throw new Error('请先打开项目。');
    const next = moveNativeGraphicNode(snapshot.project, {
      animationId,
      frameOrdinal,
      nodePath,
      direction,
    });
    if (next !== snapshot.project) this.editorStore.updateProject(next, '调整元件节点顺序');
    return next;
  }

  addNativeGraphicNode(input: {
    readonly animationId: string;
    readonly frameOrdinal: number;
    readonly source: { readonly animationId: string; readonly frameOrdinal: number; readonly nodePath: readonly string[] };
    readonly afterNodePath?: readonly string[];
  }): readonly string[] {
    const snapshot = this.editorStore.getSnapshot();
    if (!snapshot) throw new Error('请先打开项目。');
    const result = addNativeGraphicNode(snapshot.project, {
      ...input,
      createId: () => crypto.randomUUID(),
    });
    if (result.project !== snapshot.project) {
      this.editorStore.updateProject(result.project, '添加元件节点');
    }
    return result.nodePath;
  }

  replaceNativeGraphicNode(input: {
    readonly animationId: string;
    readonly frameOrdinal: number;
    readonly nodePath: readonly string[];
    readonly source: { readonly animationId: string; readonly frameOrdinal: number; readonly nodePath: readonly string[] };
  }): Project {
    const snapshot = this.editorStore.getSnapshot();
    if (!snapshot) throw new Error('请先打开项目。');
    const next = replaceNativeGraphicNode(snapshot.project, input);
    if (next !== snapshot.project) this.editorStore.updateProject(next, '替换元件节点内容');
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
    readonly internalTimeMs?: number;
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

  createFlaGraphicShapeTween(input: {
    readonly layerId: string;
    readonly frameOrdinal: number;
    readonly nodePath: readonly string[];
    readonly regionRef?: string;
    readonly mode: 'instance' | 'definition';
    readonly svgText?: string;
    readonly startTimeMs: number;
    readonly durationMs: number;
    readonly easing?: FlaShapeTweenEasing;
  }): Project {
    const { project, shotId } = this.context();
    const next = this.service.createFlaGraphicShapeTween(project, {
      shotId,
      ...input,
    });
    if (next !== project) {
      this.editorStore.updateProject(next, '创建形状补间');
    }
    return next;
  }

  updateFlaGraphicShapeTween(input: {
    readonly layerId: string;
    readonly tweenId: string;
    readonly pose?: 'from' | 'to';
    readonly region?: FlaEditableShapeRegion;
    readonly startTimeMs?: number;
    readonly endTimeMs?: number;
    readonly easing?: FlaShapeTweenEasing;
  }): Project {
    const { project, shotId } = this.context();
    const next = this.service.updateFlaGraphicShapeTween(project, {
      shotId,
      ...input,
    });
    if (next !== project) {
      this.editorStore.updateProject(next, '修改形状补间');
    }
    return next;
  }

  deleteFlaGraphicShapeTween(input: {
    readonly layerId: string;
    readonly tweenId: string;
  }): Project {
    const { project, shotId } = this.context();
    const next = this.service.deleteFlaGraphicShapeTween(project, {
      shotId,
      ...input,
    });
    if (next !== project) {
      this.editorStore.updateProject(next, '删除形状补间');
    }
    return next;
  }

  addFlaGraphicShapeTweenHint(input: {
    readonly layerId: string;
    readonly tweenId: string;
    readonly from: FlaShapeTweenHintLocation;
    readonly to: FlaShapeTweenHintLocation;
  }): Project {
    const { project, shotId } = this.context();
    const next = this.service.addFlaGraphicShapeTweenHint(project, {
      shotId,
      ...input,
    });
    if (next !== project) {
      this.editorStore.updateProject(next, '添加形状提示点');
    }
    return next;
  }

  updateFlaGraphicShapeTweenHint(input: {
    readonly layerId: string;
    readonly tweenId: string;
    readonly hintId: string;
    readonly from?: FlaShapeTweenHintLocation;
    readonly to?: FlaShapeTweenHintLocation;
  }): Project {
    const { project, shotId } = this.context();
    const next = this.service.updateFlaGraphicShapeTweenHint(project, {
      shotId,
      ...input,
    });
    if (next !== project) {
      this.editorStore.updateProject(next, '修改形状提示点');
    }
    return next;
  }

  removeFlaGraphicShapeTweenHint(input: {
    readonly layerId: string;
    readonly tweenId: string;
    readonly hintId: string;
  }): Project {
    const { project, shotId } = this.context();
    const next = this.service.removeFlaGraphicShapeTweenHint(project, {
      shotId,
      ...input,
    });
    if (next !== project) {
      this.editorStore.updateProject(next, '删除形状提示点');
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

  deleteLayer(layerId: string, timeMs = 0): Project {
    const { project, shotId } = this.context();
    const next = this.service.deleteLayer(project, shotId, layerId, timeMs);
    if (next !== project) {
      this.editorStore.updateProject(next, 'Delete layer');
    }
    return next;
  }

  setCameraAttachment(layerId: string, attached: boolean): Project {
    const { project, shotId } = this.context();
    const next = this.service.setCameraAttachment(project, shotId, layerId, attached);
    if (next !== project) this.editorStore.updateProject(next, '切换相机附着');
    return next;
  }

  /** Sets or clears an author-level coverage mask (#1454); one undo step. */
  setMaskTargets(layerId: string, targetLayerIds: readonly string[] | null): Project {
    const { project, shotId } = this.context();
    const next = this.service.setMaskTargets(project, shotId, layerId, targetLayerIds);
    if (next !== project) {
      this.editorStore.updateProject(
        next,
        targetLayerIds === null ? '解除图层遮罩' : '设置图层遮罩',
      );
    }
    return next;
  }

  setParent(childId: string, parentId: string | null, timeMs: number, target?: LayerAttachmentTarget): Project {
    const { project, shotId } = this.context();
    const next = this.service.setParent(project, shotId, childId, parentId, timeMs, target);
    if (next !== project) this.editorStore.updateProject(next, parentId ? '绑定父级图层' : '解除父级绑定');
    return next;
  }

  batchSetParent(
    childIds: readonly string[],
    parentId: string | null,
    timeMs: number,
    target?: LayerAttachmentTarget,
  ): Project {
    const { project, shotId } = this.context();
    const next = this.service.batchSetParent(project, shotId, childIds, parentId, timeMs, target);
    if (next !== project) {
      this.editorStore.updateProject(next, parentId ? '批量绑定父级图层' : '批量解除父级绑定');
    }
    return next;
  }

  batchDetachParent(childIds: readonly string[], timeMs: number): Project {
    const { project, shotId } = this.context();
    const next = this.service.batchDetachParent(project, shotId, childIds, timeMs);
    if (next !== project) {
      this.editorStore.updateProject(next, '批量解除父级绑定');
    }
    return next;
  }

  createControllerAndBindLayers(childIds: readonly string[], timeMs: number): Layer {
    const { project, projectRoot, shotId } = this.context();
    const result = this.service.createControllerAndBindLayers(project, shotId, childIds, timeMs);
    this.editorStore.updateProject(
      result.project,
      '新建控制层并批量绑定',
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
    this.layerSelection.select(result.layer.id);
    return result.layer;
  }

  setParentKey(
    childId: string,
    timeMs: number,
    parentId: string | null,
    options?: SetParentKeyOptions,
  ): Project {
    const { project, shotId } = this.context();
    const next = this.service.setParentKey(project, shotId, childId, timeMs, parentId, options);
    if (next !== project) {
      this.editorStore.updateProject(next, parentId ? '在此帧切换父级图层' : '在此帧解除父级绑定');
    }
    return next;
  }

  moveParentKey(childId: string, fromTimeMs: number, toTimeMs: number): Project {
    const { project, shotId } = this.context();
    const next = this.service.moveParentKey(project, shotId, childId, fromTimeMs, toTimeMs);
    if (next !== project) this.editorStore.updateProject(next, '移动父级交接帧');
    return next;
  }

  removeParentKey(childId: string, timeMs: number): Project {
    const { project, shotId } = this.context();
    const next = this.service.removeParentKey(project, shotId, childId, timeMs);
    if (next !== project) this.editorStore.updateProject(next, '删除父级交接帧');
    return next;
  }

  realignParentKey(childId: string, timeMs: number): Project {
    const { project, shotId } = this.context();
    const next = this.service.realignParentKey(project, shotId, childId, timeMs);
    if (next !== project) this.editorStore.updateProject(next, '重新对齐父级交接帧');
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
