import {
  LAYER_MAX_SCALE,
  LAYER_MIN_SCALE,
  PROJECT_HEIGHT,
  PROJECT_WIDTH,
} from '../constants';
import {
  evaluateLayerPreTrackState,
  evaluateShotAtTime,
  type EvaluatedLayer,
} from '../evaluate-shot-at-time';
import {
  canAuthorLayerRootMotion,
  findLayerMotionGraphic,
} from '../layer-animation';
import {
  layerPoseMatrix,
  resolveLayerParentBindingAtTime,
} from '../layer-parent-space';
import type { Layer, Project, Shot } from '../models';
import { recognizePositionChain } from '../position-chain';
import {
  resolveCharacterActionRootPatch,
  resolveLayerVisualParts,
  type LayerVisualParts,
} from '../selectors/visualParts';
import {
  LayerMotionService,
  type LayerDisplayTransformPatch,
} from '../services/LayerMotionService';
import { PositionProjectService } from '../services/PositionProjectService';
import {
  invertAffineMatrix,
  multiplyAffineMatrices,
  type AffineMatrix2D,
} from '../../shared/affine-matrix';
import {
  computeAlignTranslation,
  computeDistributeTranslations,
  transformRectToWorldBounds,
  translateLayoutBounds,
  unionLayoutBounds,
  type LayoutAxis,
  type LayoutAlignPosition,
  type LayoutBounds,
  type NegativeGapStrategy,
} from './excalidrawBoundsMath';
import {
  computeStandingSlotTargets,
  type StandingPlacementOptions,
} from './standingPlacement';

export const LAYER_LAYOUT_ACTIONS = [
  'align-left',
  'align-center-x',
  'align-right',
  'align-top',
  'align-center-y',
  'align-bottom',
  'distribute-horizontal',
  'distribute-vertical',
  'match-height',
  'standing-layout',
] as const;

export type LayerLayoutAction = (typeof LAYER_LAYOUT_ACTIONS)[number];

export const LAYER_LAYOUT_ACTION_LABELS: Record<LayerLayoutAction, string> = {
  'align-left': '左对齐',
  'align-center-x': '水平居中',
  'align-right': '右对齐',
  'align-top': '顶对齐',
  'align-center-y': '垂直居中',
  'align-bottom': '底对齐',
  'distribute-horizontal': '水平均分',
  'distribute-vertical': '垂直均分',
  'match-height': '等高',
  'standing-layout': '落地站位',
};

export type LayerLayoutSkipReason =
  | 'not-found'
  | 'background-layer'
  | 'locked'
  | 'hidden'
  | 'visual-unavailable'
  | 'non-invertible-parent-space'
  | 'mixed-camera-space'
  | 'zero-height'
  | 'scale-out-of-range'
  | 'transform-rejected';

export interface LayerWorldMeasurement {
  readonly layerId: string;
  readonly name: string;
  readonly cameraSpace: 'world' | 'screen';
  readonly evaluated: EvaluatedLayer;
  readonly visual: LayerVisualParts;
  readonly worldMatrix: AffineMatrix2D;
  readonly worldBounds: LayoutBounds;
}

export interface LayoutSkippedItem {
  readonly layerId: string;
  readonly name: string;
  readonly reason: LayerLayoutSkipReason;
  readonly message: string;
}

export interface LayoutPlannedItem {
  readonly layerId: string;
  readonly name: string;
  /** Selected descendants carried along when this root moves. */
  readonly memberLayerIds: readonly string[];
  readonly currentBounds: LayoutBounds;
  readonly targetBounds: LayoutBounds;
  readonly patch: LayerDisplayTransformPatch;
  readonly changed: boolean;
}

export interface LayerLayoutPlanInput {
  readonly shotId: string;
  readonly layerIds: readonly string[];
  readonly action: LayerLayoutAction;
  readonly timeMs?: number;
  readonly autoKey?: boolean;
  /** Optional explicit reference layer ID (for align and match-height). */
  readonly referenceLayerId?: string | null;
  readonly negativeGapStrategy?: NegativeGapStrategy;
  readonly expandGapPx?: number;
  readonly standingOptions?: StandingPlacementOptions;
}

export interface LayerLayoutPlanResult {
  readonly ok: boolean;
  readonly action: LayerLayoutAction;
  readonly timeMs: number;
  readonly autoKey: boolean;
  readonly referenceLayerId: string | null;
  readonly items: readonly LayoutPlannedItem[];
  readonly skipped: readonly LayoutSkippedItem[];
  readonly negativeGapDetected: boolean;
  readonly usedNegativeGapStrategy: NegativeGapStrategy | null;
  readonly degenerateSpan: boolean;
  readonly changedCount: number;
  readonly candidateProject: Project | null;
  readonly error?: string;
}

interface EffectiveGroup {
  readonly rootLayerId: string;
  readonly rootLayer: Layer;
  readonly rootMeasurement: LayerWorldMeasurement;
  readonly memberLayerIds: readonly string[];
  readonly groupBounds: LayoutBounds;
  readonly locked: boolean;
}

const POSITION_EPSILON = 1e-4;
const SCALE_EPSILON = 1e-5;

const motionService = new LayerMotionService();
const positionProjectService = new PositionProjectService();

export function layoutActionMinimumSelection(action: LayerLayoutAction): number {
  switch (action) {
    case 'distribute-horizontal':
    case 'distribute-vertical':
      return 3;
    case 'standing-layout':
      return 1;
    default:
      return 2;
  }
}

/**
 * Compute the exact world matrix for a layer's `combinedLocalBounds`.
 *
 * `resolveLayerVisualParts` already folds any active `characterAction.placement`
 * into `visual.ownerTransform`, while keeping `combinedLocalBounds` strictly in
 * layer-local coordinates (excluding `ownerTransform`). Composing
 * `evaluated.parentSpace` with `layerPoseMatrix(visual.ownerTransform)` matches
 * `StageRenderer` and `evaluatedLayerWorldMatrix` without double-multiplying
 * `ownerTransform`.
 */
export function resolveVisualWorldMatrix(
  evaluated: EvaluatedLayer,
  visual: LayerVisualParts,
): AffineMatrix2D {
  const ownerLocal = layerPoseMatrix(visual.ownerTransform);
  return evaluated.parentSpace
    ? multiplyAffineMatrices(evaluated.parentSpace, ownerLocal)
    : ownerLocal;
}

/**
 * Measure world visible bounds for layers in `shot` at `timeMs` using the
 * official `evaluateShotAtTime` + `resolveLayerVisualParts` + parent-space
 * world matrix chain.
 */
export function measureShotLayerWorldBounds(
  project: Project,
  shot: Shot,
  timeMs = 0,
  layerIds?: readonly string[],
): {
  readonly measurements: ReadonlyMap<string, LayerWorldMeasurement>;
  readonly skipped: readonly LayoutSkippedItem[];
} {
  const evaluatedShot = evaluateShotAtTime(shot, timeMs, project);
  const evaluatedById = new Map(
    evaluatedShot.layers.map((entry) => [entry.id, entry]),
  );
  const layerById = new Map(shot.layers.map((entry) => [entry.id, entry]));

  const targetIds = layerIds
    ? Array.from(new Set(layerIds))
    : shot.layers
        .filter((layer) => layer.id !== shot.backgroundLayerId)
        .map((layer) => layer.id);

  const measurements = new Map<string, LayerWorldMeasurement>();
  const skipped: LayoutSkippedItem[] = [];

  for (const layerId of targetIds) {
    const layer = layerById.get(layerId);
    if (!layer) {
      skipped.push({
        layerId,
        name: layerId,
        reason: 'not-found',
        message: '所选图层已不存在。',
      });
      continue;
    }
    if (layer.id === shot.backgroundLayerId) {
      skipped.push({
        layerId: layer.id,
        name: layer.name,
        reason: 'background-layer',
        message: `背景图层「${layer.name}」不参与对象排列。`,
      });
      continue;
    }
    const evaluated = evaluatedById.get(layer.id);
    if (!evaluated || !evaluated.visible) {
      skipped.push({
        layerId: layer.id,
        name: layer.name,
        reason: 'hidden',
        message: `「${layer.name}」当前隐藏，已跳过。`,
      });
      continue;
    }

    let visual: LayerVisualParts;
    try {
      visual = resolveLayerVisualParts(project, shot, evaluated, timeMs);
    } catch {
      skipped.push({
        layerId: layer.id,
        name: layer.name,
        reason: 'visual-unavailable',
        message: `「${layer.name}」的可见画面暂时无法计算，已跳过。`,
      });
      continue;
    }

    const worldMatrix = resolveVisualWorldMatrix(evaluated, visual);
    const worldBounds = transformRectToWorldBounds(
      visual.combinedLocalBounds,
      worldMatrix,
    );
    if (!worldBounds) {
      skipped.push({
        layerId: layer.id,
        name: layer.name,
        reason: 'visual-unavailable',
        message: `「${layer.name}」的世界边界不可计算，已跳过。`,
      });
      continue;
    }

    measurements.set(layer.id, {
      layerId: layer.id,
      name: layer.name,
      cameraSpace: evaluated.effectiveCameraSpace ?? 'world',
      evaluated,
      visual,
      worldMatrix,
      worldBounds,
    });
  }

  return { measurements, skipped };
}

function findHighestSelectedAncestor(
  shot: Shot,
  layerById: ReadonlyMap<string, Layer>,
  selectedSet: ReadonlySet<string>,
  layerId: string,
  timeMs: number,
): string {
  let highestSelected = layerId;
  const visited = new Set<string>([layerId]);
  let currentId: string | undefined = layerId;

  while (currentId) {
    const layer = layerById.get(currentId);
    if (!layer) break;
    const parentId = resolveLayerParentBindingAtTime(layer, timeMs).parentLayerId;
    if (!parentId || parentId === shot.backgroundLayerId || visited.has(parentId)) {
      break;
    }
    visited.add(parentId);
    if (selectedSet.has(parentId)) {
      highestSelected = parentId;
    }
    currentId = parentId;
  }

  return highestSelected;
}

function worldDeltaToLocalDelta(
  evaluated: EvaluatedLayer,
  worldDx: number,
  worldDy: number,
): { readonly dx: number; readonly dy: number } | null {
  if (!evaluated.parentSpace) {
    return { dx: worldDx, dy: worldDy };
  }
  if (evaluated.parentSpaceUnavailable) {
    return null;
  }
  const inverse = invertAffineMatrix(evaluated.parentSpace);
  if (!inverse) {
    return null;
  }
  const dx = inverse.a * worldDx + inverse.c * worldDy;
  const dy = inverse.b * worldDx + inverse.d * worldDy;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
    return null;
  }
  return { dx, dy };
}

function buildTranslationPatch(
  measurement: LayerWorldMeasurement,
  worldDx: number,
  worldDy: number,
): LayerDisplayTransformPatch | null {
  if (Math.abs(worldDx) <= POSITION_EPSILON && Math.abs(worldDy) <= POSITION_EPSILON) {
    return {};
  }
  const localDelta = worldDeltaToLocalDelta(measurement.evaluated, worldDx, worldDy);
  if (!localDelta) return null;

  const displayed = measurement.visual.ownerTransform;
  const rawPatch: LayerDisplayTransformPatch = {
    x: displayed.x + localDelta.dx,
    y: displayed.y + localDelta.dy,
  };
  return resolveCharacterActionRootPatch(measurement.evaluated, rawPatch);
}

function buildScaleAndAnchorPatch(
  group: EffectiveGroup,
  scaleRatio: number,
  targetCenterX: number,
  targetBottomY: number,
  allMeasurements: ReadonlyMap<string, LayerWorldMeasurement>,
): {
  readonly patch: LayerDisplayTransformPatch;
  readonly targetBounds: LayoutBounds;
} | { readonly errorReason: LayerLayoutSkipReason; readonly message: string } {
  const { rootMeasurement } = group;
  const { evaluated, visual } = rootMeasurement;
  const displayed = visual.ownerTransform;

  const nextDisplayedScaleX = displayed.scaleX * scaleRatio;
  const nextDisplayedScaleY = displayed.scaleY * scaleRatio;
  const nextRootScaleX = evaluated.scaleX * scaleRatio;
  const nextRootScaleY = evaluated.scaleY * scaleRatio;

  if (
    !Number.isFinite(nextRootScaleX) ||
    !Number.isFinite(nextRootScaleY) ||
    nextRootScaleX < LAYER_MIN_SCALE ||
    nextRootScaleX > LAYER_MAX_SCALE ||
    nextRootScaleY < LAYER_MIN_SCALE ||
    nextRootScaleY > LAYER_MAX_SCALE
  ) {
    return {
      errorReason: 'scale-out-of-range',
      message: `「${rootMeasurement.name}」等高缩放超出允许范围（${LAYER_MIN_SCALE}–${LAYER_MAX_SCALE}），已跳过。`,
    };
  }

  // Compute the scaled world bounds around the root's world origin before
  // translating to anchor visible bottom + centerX.
  const scaledOwnerMatrix = layerPoseMatrix({
    ...displayed,
    scaleX: nextDisplayedScaleX,
    scaleY: nextDisplayedScaleY,
  });
  const scaledWorldMatrix = evaluated.parentSpace
    ? multiplyAffineMatrices(evaluated.parentSpace, scaledOwnerMatrix)
    : scaledOwnerMatrix;

  const memberScaledBounds: LayoutBounds[] = [];
  const rootScaledBounds = transformRectToWorldBounds(
    visual.combinedLocalBounds,
    scaledWorldMatrix,
  );
  if (!rootScaledBounds) {
    return {
      errorReason: 'visual-unavailable',
      message: `「${rootMeasurement.name}」缩放后的可见边界无法计算，已跳过。`,
    };
  }
  memberScaledBounds.push(rootScaledBounds);

  // If selected descendants move with this root, scale their world bounds
  // around the root's world origin by the same uniform ratio.
  const rootOriginX = rootMeasurement.worldMatrix.tx;
  const rootOriginY = rootMeasurement.worldMatrix.ty;
  for (const memberId of group.memberLayerIds) {
    if (memberId === group.rootLayerId) continue;
    const member = allMeasurements.get(memberId);
    if (!member) continue;
    const oldBounds = member.worldBounds;
    const scaledMemberBounds: LayoutBounds = {
      minX: rootOriginX + (oldBounds.minX - rootOriginX) * scaleRatio,
      minY: rootOriginY + (oldBounds.minY - rootOriginY) * scaleRatio,
      maxX: rootOriginX + (oldBounds.maxX - rootOriginX) * scaleRatio,
      maxY: rootOriginY + (oldBounds.maxY - rootOriginY) * scaleRatio,
      width: oldBounds.width * scaleRatio,
      height: oldBounds.height * scaleRatio,
      centerX: rootOriginX + (oldBounds.centerX - rootOriginX) * scaleRatio,
      centerY: rootOriginY + (oldBounds.centerY - rootOriginY) * scaleRatio,
    };
    memberScaledBounds.push(scaledMemberBounds);
  }

  const combinedScaledBounds = unionLayoutBounds(memberScaledBounds) ?? rootScaledBounds;
  const worldDx = targetCenterX - combinedScaledBounds.centerX;
  const worldDy = targetBottomY - combinedScaledBounds.maxY;

  const localDelta = worldDeltaToLocalDelta(evaluated, worldDx, worldDy);
  if (!localDelta) {
    return {
      errorReason: 'non-invertible-parent-space',
      message: `「${rootMeasurement.name}」的父级空间不可求逆，无法调整位置，已跳过。`,
    };
  }

  const rawPatch: LayerDisplayTransformPatch = {
    x: displayed.x + localDelta.dx,
    y: displayed.y + localDelta.dy,
    scaleX: nextDisplayedScaleX,
    scaleY: nextDisplayedScaleY,
  };
  const resolvedPatch = resolveCharacterActionRootPatch(evaluated, rawPatch);
  const targetBounds = translateLayoutBounds(combinedScaledBounds, worldDx, worldDy);

  return { patch: resolvedPatch, targetBounds };
}

function hasEffectivePatchChange(
  evaluated: EvaluatedLayer,
  patch: LayerDisplayTransformPatch,
): boolean {
  if (patch.x !== undefined && Math.abs(patch.x - evaluated.x) > POSITION_EPSILON) {
    return true;
  }
  if (patch.y !== undefined && Math.abs(patch.y - evaluated.y) > POSITION_EPSILON) {
    return true;
  }
  if (patch.scaleX !== undefined && Math.abs(patch.scaleX - evaluated.scaleX) > SCALE_EPSILON) {
    return true;
  }
  if (patch.scaleY !== undefined && Math.abs(patch.scaleY - evaluated.scaleY) > SCALE_EPSILON) {
    return true;
  }
  if (patch.rotationDeg !== undefined && Math.abs(patch.rotationDeg - evaluated.rotationDeg) > SCALE_EPSILON) {
    return true;
  }
  return false;
}

/**
 * Apply one layer's planned display transform patch via the official services:
 * - `LayerMotionService.applyTransform` for FLA Graphics and root-motion-capable
 *   layers (including parented layers and keyframed layers), respecting `autoKey`.
 * - `PositionProjectService.applyBaseBoundLayerChange` for ordinary static
 *   layers, preserving non-uniform `scaleX`/`scaleY` and managed Position chains.
 */
function applySingleLayerTransform(
  project: Project,
  shotId: string,
  layerId: string,
  timeMs: number,
  autoKey: boolean,
  patch: LayerDisplayTransformPatch,
): Project {
  const shot = project.shots.find((candidate) => candidate.id === shotId);
  const layer = shot?.layers.find((candidate) => candidate.id === layerId);
  if (!shot || !layer) {
    throw new Error('找不到目标图层。');
  }
  if (layer.locked) {
    throw new Error(`图层「${layer.name}」已锁定，请先解锁。`);
  }

  const useMotionService = Boolean(
    findLayerMotionGraphic(project, layer) || canAuthorLayerRootMotion(layer),
  );
  if (useMotionService) {
    return motionService.applyTransform(
      project,
      { shotId, layerId, timeMs, autoKey },
      patch,
    );
  }

  const preTrack = evaluateLayerPreTrackState(shot, layer, timeMs, project);
  const editingPosition = patch.x !== undefined || patch.y !== undefined;
  const editingScale = patch.scaleX !== undefined || patch.scaleY !== undefined;
  const isMoveLockedAtTime =
    preTrack.controlledByMove &&
    !(timeMs === 0 && recognizePositionChain({ shot, layer }).status === 'editable');

  if (editingPosition && isMoveLockedAtTime) {
    throw new Error('当前时刻位置正由时间轴移动事件控制，请到事件生效前编辑基准。');
  }
  if (editingScale && preTrack.controlledByScale) {
    throw new Error('当前时刻缩放正由时间轴缩放事件控制，请到事件生效前编辑基准。');
  }

  const nextX =
    patch.x !== undefined ? patch.x - preTrack.motion.shakeOffset.x : layer.x;
  const nextY =
    patch.y !== undefined ? patch.y - preTrack.motion.shakeOffset.y : layer.y;
  const nextScaleX = patch.scaleX ?? layer.scaleX;
  const nextScaleY = patch.scaleY ?? layer.scaleY;

  if (
    !Number.isFinite(nextScaleX) ||
    !Number.isFinite(nextScaleY) ||
    nextScaleX < LAYER_MIN_SCALE ||
    nextScaleX > LAYER_MAX_SCALE ||
    nextScaleY < LAYER_MIN_SCALE ||
    nextScaleY > LAYER_MAX_SCALE
  ) {
    throw new Error(
      `图层缩放必须是 ${LAYER_MIN_SCALE}–${LAYER_MAX_SCALE} 之间的有限数字。`,
    );
  }
  if (
    !Number.isFinite(nextX) ||
    !Number.isFinite(nextY) ||
    nextX < 0 ||
    nextX > PROJECT_WIDTH ||
    nextY < 0 ||
    nextY > PROJECT_HEIGHT
  ) {
    throw new Error(
      `图层坐标必须位于 0–${PROJECT_WIDTH} 和 0–${PROJECT_HEIGHT} 之间。`,
    );
  }

  return positionProjectService.applyBaseBoundLayerChange(project, shotId, layerId, {
    x: nextX,
    y: nextY,
    scaleX: nextScaleX,
    scaleY: nextScaleY,
    rotationDeg: patch.rotationDeg ?? layer.rotationDeg,
  });
}

function alignActionParams(
  action: LayerLayoutAction,
): { readonly axis: LayoutAxis; readonly position: LayoutAlignPosition } | null {
  switch (action) {
    case 'align-left':
      return { axis: 'x', position: 'start' };
    case 'align-center-x':
      return { axis: 'x', position: 'center' };
    case 'align-right':
      return { axis: 'x', position: 'end' };
    case 'align-top':
      return { axis: 'y', position: 'start' };
    case 'align-center-y':
      return { axis: 'y', position: 'center' };
    case 'align-bottom':
      return { axis: 'y', position: 'end' };
    default:
      return null;
  }
}

/**
 * Pure domain layout planner. Never mutates the input `project`.
 * Produces a validated `candidateProject` ready for read-only stage preview
 * or a single `EditorProjectStore.updateProject` commit (1 Undo/Redo step).
 */
export function planLayerLayout(
  project: Project,
  input: LayerLayoutPlanInput,
): LayerLayoutPlanResult {
  const timeMs = input.timeMs ?? 0;
  const autoKey = input.autoKey ?? false;
  const referenceLayerId = input.referenceLayerId ?? null;

  const shot = project.shots.find((candidate) => candidate.id === input.shotId);
  if (!shot) {
    return {
      ok: false,
      action: input.action,
      timeMs,
      autoKey,
      referenceLayerId,
      items: [],
      skipped: [],
      negativeGapDetected: false,
      usedNegativeGapStrategy: null,
      degenerateSpan: false,
      changedCount: 0,
      candidateProject: null,
      error: `找不到镜头：${input.shotId}`,
    };
  }

  const orderedUniqueIds = Array.from(new Set(input.layerIds));
  const idsToMeasure =
    referenceLayerId && !orderedUniqueIds.includes(referenceLayerId)
      ? [...orderedUniqueIds, referenceLayerId]
      : orderedUniqueIds;

  const { measurements, skipped: initialSkipped } = measureShotLayerWorldBounds(
    project,
    shot,
    timeMs,
    idsToMeasure,
  );
  const skipped: LayoutSkippedItem[] = [...initialSkipped];

  const layerById = new Map(shot.layers.map((layer) => [layer.id, layer]));

  // Determine primary camera space so world-space and screen-space layers are
  // never silently mixed.
  const referenceMeasurement = referenceLayerId
    ? measurements.get(referenceLayerId)
    : undefined;
  const firstMeasured = orderedUniqueIds
    .map((id) => measurements.get(id))
    .find((entry): entry is LayerWorldMeasurement => entry !== undefined);
  const primaryCameraSpace: 'world' | 'screen' =
    referenceMeasurement?.cameraSpace ?? firstMeasured?.cameraSpace ?? 'world';

  const compatibleSelectedIds: string[] = [];
  for (const id of orderedUniqueIds) {
    const measured = measurements.get(id);
    if (!measured) continue;
    if (measured.cameraSpace !== primaryCameraSpace) {
      skipped.push({
        layerId: id,
        name: measured.name,
        reason: 'mixed-camera-space',
        message: `「${measured.name}」位于${
          measured.cameraSpace === 'screen' ? '屏幕固定' : '世界'
        }空间，与当前${
          primaryCameraSpace === 'screen' ? '屏幕固定' : '世界'
        }空间选区不兼容，已跳过。`,
      });
      continue;
    }
    compatibleSelectedIds.push(id);
  }

  const compatibleSet = new Set(compatibleSelectedIds);

  // Group selected layers by their highest selected ancestor at `timeMs` so
  // selecting a parent + child moves the root once using combined group bounds.
  const groupMembers = new Map<string, string[]>();
  const rootOrder: string[] = [];
  for (const id of compatibleSelectedIds) {
    const rootId = findHighestSelectedAncestor(
      shot,
      layerById,
      compatibleSet,
      id,
      timeMs,
    );
    let members = groupMembers.get(rootId);
    if (!members) {
      members = [];
      groupMembers.set(rootId, members);
      rootOrder.push(rootId);
    }
    members.push(id);
  }

  const allGroups: EffectiveGroup[] = [];
  for (const rootId of rootOrder) {
    const rootLayer = layerById.get(rootId);
    const rootMeasurement = measurements.get(rootId);
    const members = groupMembers.get(rootId) ?? [rootId];
    if (!rootLayer || !rootMeasurement) continue;

    const memberBounds = members
      .map((memberId) => measurements.get(memberId)?.worldBounds)
      .filter((entry): entry is LayoutBounds => entry !== undefined);
    const groupBounds = unionLayoutBounds(memberBounds) ?? rootMeasurement.worldBounds;

    allGroups.push({
      rootLayerId: rootId,
      rootLayer,
      rootMeasurement,
      memberLayerIds: members,
      groupBounds,
      locked: rootLayer.locked,
    });
  }

  // Separate locked or non-invertible roots locally without corrupting others.
  // Locked groups remain eligible as reference bounds!
  const movableGroups: EffectiveGroup[] = [];
  for (const group of allGroups) {
    if (group.locked) {
      skipped.push({
        layerId: group.rootLayerId,
        name: group.rootLayer.name,
        reason: 'locked',
        message: `「${group.rootLayer.name}」已锁定，保持不变（可用作参考）。`,
      });
      continue;
    }
    const { evaluated } = group.rootMeasurement;
    if (
      evaluated.parentSpaceUnavailable ||
      (evaluated.parentSpace && !invertAffineMatrix(evaluated.parentSpace))
    ) {
      skipped.push({
        layerId: group.rootLayerId,
        name: group.rootLayer.name,
        reason: 'non-invertible-parent-space',
        message: `「${group.rootLayer.name}」的父级空间不可求逆，已跳过。`,
      });
      continue;
    }
    movableGroups.push(group);
  }

  // Resolve reference group (if referenceLayerId is provided).
  const referenceGroup = referenceLayerId
    ? allGroups.find(
        (group) =>
          group.rootLayerId === referenceLayerId ||
          group.memberLayerIds.includes(referenceLayerId),
      ) ?? null
    : null;
  const referenceBoundsFromExplicit =
    referenceGroup?.groupBounds ??
    (referenceMeasurement && referenceMeasurement.cameraSpace === primaryCameraSpace
      ? referenceMeasurement.worldBounds
      : null);

  const minCount = layoutActionMinimumSelection(input.action);
  const participantCount =
    alignActionParams(input.action) !== null || input.action === 'match-height'
      ? referenceBoundsFromExplicit
        ? movableGroups.length + (referenceGroup && !referenceGroup.locked ? 0 : 1)
        : allGroups.length
      : movableGroups.length;

  if (movableGroups.length === 0 || participantCount < minCount) {
    return {
      ok: false,
      action: input.action,
      timeMs,
      autoKey,
      referenceLayerId,
      items: [],
      skipped,
      negativeGapDetected: false,
      usedNegativeGapStrategy: null,
      degenerateSpan: false,
      changedCount: 0,
      candidateProject: null,
      error:
        movableGroups.length === 0
          ? '没有可移动的有效对象。'
          : `「${LAYER_LAYOUT_ACTION_LABELS[input.action]}」至少需要 ${minCount} 个有效对象。`,
    };
  }

  const plannedItems: LayoutPlannedItem[] = [];
  let negativeGapDetected = false;
  let usedNegativeGapStrategy: NegativeGapStrategy | null = null;
  let degenerateSpan = false;

  const alignParams = alignActionParams(input.action);
  if (alignParams) {
    const referenceBounds =
      referenceBoundsFromExplicit ??
      unionLayoutBounds(allGroups.map((group) => group.groupBounds));
    if (!referenceBounds) {
      return {
        ok: false,
        action: input.action,
        timeMs,
        autoKey,
        referenceLayerId,
        items: [],
        skipped,
        negativeGapDetected: false,
        usedNegativeGapStrategy: null,
        degenerateSpan: false,
        changedCount: 0,
        candidateProject: null,
        error: '无法计算对齐参考边界。',
      };
    }

    for (const group of movableGroups) {
      const { dx, dy } = computeAlignTranslation(
        group.groupBounds,
        referenceBounds,
        alignParams.axis,
        alignParams.position,
      );
      const patch = buildTranslationPatch(group.rootMeasurement, dx, dy);
      if (!patch) {
        skipped.push({
          layerId: group.rootLayerId,
          name: group.rootLayer.name,
          reason: 'non-invertible-parent-space',
          message: `「${group.rootLayer.name}」的父级空间不可求逆，已跳过。`,
        });
        continue;
      }
      plannedItems.push({
        layerId: group.rootLayerId,
        name: group.rootLayer.name,
        memberLayerIds: group.memberLayerIds,
        currentBounds: group.groupBounds,
        targetBounds: translateLayoutBounds(group.groupBounds, dx, dy),
        patch,
        changed: hasEffectivePatchChange(group.rootMeasurement.evaluated, patch),
      });
    }
  } else if (
    input.action === 'distribute-horizontal' ||
    input.action === 'distribute-vertical'
  ) {
    const axis: LayoutAxis =
      input.action === 'distribute-horizontal' ? 'x' : 'y';
    const distributed = computeDistributeTranslations(
      movableGroups.map((group) => ({
        id: group.rootLayerId,
        bounds: group.groupBounds,
      })),
      axis,
      {
        negativeGapStrategy: input.negativeGapStrategy,
        expandGapPx: input.expandGapPx,
      },
    );
    negativeGapDetected = distributed.negativeGapDetected;
    usedNegativeGapStrategy = distributed.usedStrategy;
    degenerateSpan = distributed.degenerateSpan;

    if (!distributed.ok) {
      return {
        ok: false,
        action: input.action,
        timeMs,
        autoKey,
        referenceLayerId,
        items: [],
        skipped,
        negativeGapDetected,
        usedNegativeGapStrategy,
        degenerateSpan,
        changedCount: 0,
        candidateProject: null,
        error: distributed.error ?? '无法计算均分位置。',
      };
    }

    for (const group of movableGroups) {
      const translation = distributed.translations.get(group.rootLayerId) ?? {
        dx: 0,
        dy: 0,
      };
      const patch = buildTranslationPatch(
        group.rootMeasurement,
        translation.dx,
        translation.dy,
      );
      if (!patch) {
        skipped.push({
          layerId: group.rootLayerId,
          name: group.rootLayer.name,
          reason: 'non-invertible-parent-space',
          message: `「${group.rootLayer.name}」的父级空间不可求逆，已跳过。`,
        });
        continue;
      }
      plannedItems.push({
        layerId: group.rootLayerId,
        name: group.rootLayer.name,
        memberLayerIds: group.memberLayerIds,
        currentBounds: group.groupBounds,
        targetBounds: translateLayoutBounds(
          group.groupBounds,
          translation.dx,
          translation.dy,
        ),
        patch,
        changed: hasEffectivePatchChange(group.rootMeasurement.evaluated, patch),
      });
    }
  } else if (input.action === 'match-height') {
    const targetHeight =
      referenceBoundsFromExplicit?.height ?? allGroups[0]!.groupBounds.height;
    if (!Number.isFinite(targetHeight) || targetHeight <= 1e-6) {
      return {
        ok: false,
        action: input.action,
        timeMs,
        autoKey,
        referenceLayerId,
        items: [],
        skipped,
        negativeGapDetected: false,
        usedNegativeGapStrategy: null,
        degenerateSpan: false,
        changedCount: 0,
        candidateProject: null,
        error: '参考对象高度无效，无法执行等高。',
      };
    }

    for (const group of movableGroups) {
      if (group.groupBounds.height <= 1e-6) {
        skipped.push({
          layerId: group.rootLayerId,
          name: group.rootLayer.name,
          reason: 'zero-height',
          message: `「${group.rootLayer.name}」可见高度为 0，已跳过。`,
        });
        continue;
      }
      const ratio = targetHeight / group.groupBounds.height;
      if (Math.abs(ratio - 1) <= SCALE_EPSILON) {
        plannedItems.push({
          layerId: group.rootLayerId,
          name: group.rootLayer.name,
          memberLayerIds: group.memberLayerIds,
          currentBounds: group.groupBounds,
          targetBounds: group.groupBounds,
          patch: {},
          changed: false,
        });
        continue;
      }
      const scaled = buildScaleAndAnchorPatch(
        group,
        ratio,
        group.groupBounds.centerX,
        group.groupBounds.maxY,
        measurements,
      );
      if ('errorReason' in scaled) {
        skipped.push({
          layerId: group.rootLayerId,
          name: group.rootLayer.name,
          reason: scaled.errorReason,
          message: scaled.message,
        });
        continue;
      }
      plannedItems.push({
        layerId: group.rootLayerId,
        name: group.rootLayer.name,
        memberLayerIds: group.memberLayerIds,
        currentBounds: group.groupBounds,
        targetBounds: scaled.targetBounds,
        patch: scaled.patch,
        changed: hasEffectivePatchChange(
          group.rootMeasurement.evaluated,
          scaled.patch,
        ),
      });
    }
  } else if (input.action === 'standing-layout') {
    const slotTargets = computeStandingSlotTargets(
      movableGroups.length,
      input.standingOptions,
    );
    const matchHeight = Boolean(input.standingOptions?.matchHeight);
    const explicitTargetHeight =
      input.standingOptions?.targetHeightRatio !== undefined
        ? (input.standingOptions.canvasHeight ?? PROJECT_HEIGHT) *
          input.standingOptions.targetHeightRatio
        : null;
    const standingTargetHeight =
      explicitTargetHeight ??
      (matchHeight
        ? referenceBoundsFromExplicit?.height ?? movableGroups[0]!.groupBounds.height
        : null);

    for (let i = 0; i < movableGroups.length; i += 1) {
      const group = movableGroups[i]!;
      const slot = slotTargets[i]!;
      if (
        standingTargetHeight !== null &&
        Number.isFinite(standingTargetHeight) &&
        standingTargetHeight > 1e-6 &&
        group.groupBounds.height > 1e-6
      ) {
        const ratio = standingTargetHeight / group.groupBounds.height;
        const scaled = buildScaleAndAnchorPatch(
          group,
          ratio,
          slot.centerX,
          slot.groundY,
          measurements,
        );
        if ('errorReason' in scaled) {
          skipped.push({
            layerId: group.rootLayerId,
            name: group.rootLayer.name,
            reason: scaled.errorReason,
            message: scaled.message,
          });
          continue;
        }
        plannedItems.push({
          layerId: group.rootLayerId,
          name: group.rootLayer.name,
          memberLayerIds: group.memberLayerIds,
          currentBounds: group.groupBounds,
          targetBounds: scaled.targetBounds,
          patch: scaled.patch,
          changed: hasEffectivePatchChange(
            group.rootMeasurement.evaluated,
            scaled.patch,
          ),
        });
      } else {
        const dx = slot.centerX - group.groupBounds.centerX;
        const dy = slot.groundY - group.groupBounds.maxY;
        const patch = buildTranslationPatch(group.rootMeasurement, dx, dy);
        if (!patch) {
          skipped.push({
            layerId: group.rootLayerId,
            name: group.rootLayer.name,
            reason: 'non-invertible-parent-space',
            message: `「${group.rootLayer.name}」的父级空间不可求逆，已跳过。`,
          });
          continue;
        }
        plannedItems.push({
          layerId: group.rootLayerId,
          name: group.rootLayer.name,
          memberLayerIds: group.memberLayerIds,
          currentBounds: group.groupBounds,
          targetBounds: translateLayoutBounds(group.groupBounds, dx, dy),
          patch,
          changed: hasEffectivePatchChange(group.rootMeasurement.evaluated, patch),
        });
      }
    }
  }

  // Apply planned patches sequentially to a candidate Project in memory,
  // isolating any per-layer service rejection so valid objects still succeed.
  let candidateProject = project;
  const finalItems: LayoutPlannedItem[] = [];
  let changedCount = 0;

  for (const item of plannedItems) {
    if (!item.changed) {
      finalItems.push(item);
      continue;
    }
    try {
      const next = applySingleLayerTransform(
        candidateProject,
        shot.id,
        item.layerId,
        timeMs,
        autoKey,
        item.patch,
      );
      if (next !== candidateProject) {
        candidateProject = next;
        changedCount += 1;
      }
      finalItems.push(item);
    } catch (cause) {
      skipped.push({
        layerId: item.layerId,
        name: item.name,
        reason: 'transform-rejected',
        message:
          cause instanceof Error
            ? `「${item.name}」${cause.message}`
            : `「${item.name}」无法应用排列变换，已跳过。`,
      });
    }
  }

  if (finalItems.length === 0) {
    return {
      ok: false,
      action: input.action,
      timeMs,
      autoKey,
      referenceLayerId,
      items: [],
      skipped,
      negativeGapDetected,
      usedNegativeGapStrategy,
      degenerateSpan,
      changedCount: 0,
      candidateProject: null,
      error: skipped[0]?.message ?? '没有可应用的排列更改。',
    };
  }

  return {
    ok: true,
    action: input.action,
    timeMs,
    autoKey,
    referenceLayerId,
    items: finalItems,
    skipped,
    negativeGapDetected,
    usedNegativeGapStrategy,
    degenerateSpan,
    changedCount,
    candidateProject,
  };
}

/**
 * Convenience helper to plan and return the updated candidate `Project` in one
 * call (for domain services, CLI, or WF-03). Does not touch any renderer store.
 */
export function applyLayerLayout(
  project: Project,
  input: LayerLayoutPlanInput,
): {
  readonly project: Project;
  readonly plan: LayerLayoutPlanResult;
} {
  const plan = planLayerLayout(project, input);
  return {
    project: plan.ok && plan.candidateProject ? plan.candidateProject : project,
    plan,
  };
}
