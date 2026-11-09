import { LAYER_MAX_SCALE, LAYER_MIN_SCALE } from '../constants';
import type { Layer, Project, Shot } from '../models';
import { recognizePositionChain } from '../position-chain';
import {
  layoutPointInsideCanvas,
  layoutRectFitsCanvas,
  layoutVisualRectAt,
  resolveLayoutVisualMetrics,
  uniqueLayoutNameLabels,
  type LayoutPoint,
  type LayoutVisualMetrics,
  type LayoutVisualRect,
} from './visualBounds';

/**
 * EF-02 V0 freezes one align/distribute page. Each action is executed once and
 * never chained: the numbers and the refusal policy are the contract.
 */
export const LAYOUT_ALIGN_ACTIONS = [
  'align-left',
  'align-center',
  'align-right',
  'align-bottom',
  'equal-height',
  'distribute-horizontal',
] as const;

export type LayoutAlignAction = (typeof LAYOUT_ALIGN_ACTIONS)[number];

export const LAYOUT_ACTION_LABELS: Record<LayoutAlignAction, string> = {
  'align-left': '左对齐',
  'align-center': '水平居中',
  'align-right': '右对齐',
  'align-bottom': '底部对齐',
  'equal-height': '等高',
  'distribute-horizontal': '水平均分',
};

export type LayoutBlockReason =
  | 'locked'
  | 'hidden'
  | 'rotated'
  | 'position-animation'
  | 'scale-animation'
  | 'visual-unavailable';

export type LayoutPlanErrorReason =
  | LayoutBlockReason
  | 'incomplete'
  | 'not-enough'
  | 'missing-reference'
  | 'unavailable-layer'
  | 'out-of-canvas'
  | 'invalid-scale'
  | 'insufficient-space';

/** One Layer the page may offer, with its own refusal reason if it has one. */
export interface LayoutTargetOption {
  readonly layerId: string;
  readonly name: string;
  /** Display copy only; Layer identity is always the id. */
  readonly label: string;
  readonly blocked: LayoutBlockReason | null;
}

/** The complete result values one Layer must hold after the action. */
export interface LayoutLayerTransform {
  readonly layerId: string;
  readonly x: number;
  readonly y: number;
  readonly scaleX: number;
  readonly scaleY: number;
}

export interface LayoutPlan {
  readonly action: LayoutAlignAction;
  /** Null for horizontal distribution, which needs no reference object. */
  readonly referenceLayerId: string | null;
  readonly transforms: readonly LayoutLayerTransform[];
}

export type LayoutPlanResult =
  | { readonly ok: true; readonly plan: LayoutPlan }
  | {
      readonly ok: false;
      readonly reason: LayoutPlanErrorReason;
      readonly message: string;
    };

export function layoutActionRequiresReference(
  action: LayoutAlignAction,
): boolean {
  return action !== 'distribute-horizontal';
}

export function layoutActionMinimumSelection(
  action: LayoutAlignAction,
): number {
  return action === 'distribute-horizontal' ? 3 : 2;
}

/** Creator-facing refusal copy; the plan and the panel share one owner. */
export function describeLayoutBlock(
  name: string,
  reason: LayoutBlockReason | 'out-of-canvas' | 'invalid-scale',
): string {
  switch (reason) {
    case 'locked':
      return `「${name}」已锁定，请先解锁再排列。`;
    case 'hidden':
      return `「${name}」已隐藏，请先显示再排列。`;
    case 'rotated':
      return `「${name}」当前有旋转，请先恢复角度再排列。`;
    case 'position-animation':
      return `「${name}」已有位置动画，V0 暂不自动改动它的位置。`;
    case 'scale-animation':
      return `「${name}」已有缩放动画，V0 暂不自动改动它的大小。`;
    case 'visual-unavailable':
      return `「${name}」的画面暂时无法计算，请稍后重试。`;
    case 'out-of-canvas':
      return `「${name}」排列后会超出画布范围。`;
    case 'invalid-scale':
      return `「${name}」调整后的缩放超出可用范围。`;
  }
}

export function describeLayoutPlanError(
  reason: Extract<
    LayoutPlanErrorReason,
    'incomplete' | 'not-enough' | 'missing-reference' | 'unavailable-layer'
  >,
  action: LayoutAlignAction,
): string {
  switch (reason) {
    case 'incomplete':
      return '先选择要对齐的对象。';
    case 'not-enough':
      return `「${LAYOUT_ACTION_LABELS[action]}」至少需要 ${layoutActionMinimumSelection(action)} 个对象。`;
    case 'missing-reference':
      return '请在所选对象中指定参照。';
    case 'unavailable-layer':
      return '所选对象已不存在，请重新选择。';
  }
}

/** V0 scope: static Character and image/prop Layers, never the background. */
function isLayoutTarget(layer: Layer, shot: Shot): boolean {
  if (layer.id === shot.backgroundLayerId) return false;
  return layer.source.kind === 'character' || layer.source.kind === 'asset';
}

function blockReason(
  layer: Layer,
  shot: Shot,
  metrics: ReadonlyMap<string, LayoutVisualMetrics>,
): LayoutBlockReason | null {
  if (layer.locked) return 'locked';
  if (!layer.visible) return 'hidden';
  if (layer.rotationDeg !== 0) return 'rotated';
  if (recognizePositionChain({ shot, layer }).status !== 'none') {
    return 'position-animation';
  }
  if (
    shot.timelineEvents.some(
      (event) => event.type === 'scale' && event.layerId === layer.id,
    )
  ) {
    return 'scale-animation';
  }
  if (!metrics.has(layer.id)) return 'visual-unavailable';
  return null;
}

/** Layout-eligible Layers of the current Shot, in canvas stacking order. */
export function listLayoutTargets(
  project: Project,
  shot: Shot,
): LayoutTargetOption[] {
  const metrics = resolveLayoutVisualMetrics(project, shot);
  const candidates = [...shot.layers]
    .filter((layer) => isLayoutTarget(layer, shot))
    .sort((left, right) => left.zIndex - right.zIndex);
  const labels = uniqueLayoutNameLabels(candidates);
  return candidates.map((layer) => ({
    layerId: layer.id,
    name: layer.name,
    label: labels.get(layer.id) ?? layer.name,
    blocked: blockReason(layer, shot, metrics),
  }));
}

/** Keep only the first occurrence so a repeated id never skews the math. */
function distinctLayerIds(layerIds: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const layerId of layerIds) {
    if (seen.has(layerId)) continue;
    seen.add(layerId);
    result.push(layerId);
  }
  return result;
}

/** Three decimals of a 1920px canvas is sub-pixel precision, no saved dust. */
function roundPosition(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function roundScale(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

interface TargetSnapshot {
  readonly layer: Layer;
  readonly metrics: LayoutVisualMetrics;
  readonly rect: LayoutVisualRect;
}

function targetSnapshot(
  layer: Layer,
  metrics: LayoutVisualMetrics,
): TargetSnapshot {
  return {
    layer,
    metrics,
    rect: layoutVisualRectAt(metrics, { x: layer.x, y: layer.y }),
  };
}

/** Horizontal translate that lands this visual's left edge on `left`. */
function shiftLeft(snapshot: TargetSnapshot, left: number): LayoutLayerTransform {
  return movedBy(snapshot, left - snapshot.rect.left, 0);
}

function movedBy(
  snapshot: TargetSnapshot,
  deltaX: number,
  deltaY: number,
): LayoutLayerTransform {
  const { layer } = snapshot;
  return {
    layerId: layer.id,
    x: roundPosition(layer.x + deltaX),
    y: roundPosition(layer.y + deltaY),
    scaleX: layer.scaleX,
    scaleY: layer.scaleY,
  };
}

/**
 * Uniform scale multiplier on the object's own scaleX/scaleY: the existing
 * aspect ratio, flipX and part definitions stay untouched, and the visual
 * center keeps its place on the canvas.
 */
function scaledToVisualHeight(
  snapshot: TargetSnapshot,
  targetHeight: number,
): LayoutLayerTransform | null {
  const { layer, metrics, rect } = snapshot;
  const currentHeight = rect.bottom - rect.top;
  if (!(currentHeight > 0) || !(targetHeight > 0)) return null;
  const factor = targetHeight / currentHeight;
  const scaleX = roundScale(layer.scaleX * factor);
  const scaleY = roundScale(layer.scaleY * factor);
  const centerX = (rect.left + rect.right) / 2;
  const centerY = (rect.top + rect.bottom) / 2;
  const effectiveScaleX = layer.flipX ? -scaleX : scaleX;
  const localCenterX = metrics.bounds.x + metrics.bounds.width / 2;
  const localCenterY = metrics.bounds.y + metrics.bounds.height / 2;
  return {
    layerId: layer.id,
    x: roundPosition(centerX - localCenterX * effectiveScaleX),
    y: roundPosition(centerY - localCenterY * scaleY),
    scaleX,
    scaleY,
  };
}

interface PlannedChange {
  readonly snapshot: TargetSnapshot;
  readonly transform: LayoutLayerTransform;
}

function alignChanges(
  action: Exclude<LayoutAlignAction, 'distribute-horizontal'>,
  targets: readonly TargetSnapshot[],
  reference: TargetSnapshot,
): PlannedChange[] {
  const ref = reference.rect;
  const changes: PlannedChange[] = [];
  for (const target of targets) {
    if (target.layer.id === reference.layer.id) continue;
    const transform = ((): LayoutLayerTransform | null => {
      switch (action) {
        case 'align-left':
          return shiftLeft(target, ref.left);
        case 'align-right':
          return movedBy(target, ref.right - target.rect.right, 0);
        case 'align-center':
          return movedBy(
            target,
            (ref.left + ref.right) / 2 -
              (target.rect.left + target.rect.right) / 2,
            0,
          );
        case 'align-bottom':
          return movedBy(target, 0, ref.bottom - target.rect.bottom);
        case 'equal-height':
          return scaledToVisualHeight(target, ref.bottom - ref.top);
      }
    })();
    if (transform) changes.push({ snapshot: target, transform });
  }
  return changes;
}

/**
 * Fixed outer pair, equal visible gaps between neighbours. Ordering uses the
 * rendered left edge, not the Layer x, so different visual widths still read
 * as evenly spaced.
 */
function distributeChanges(
  targets: readonly TargetSnapshot[],
): PlannedChange[] | null {
  const ordered = [...targets].sort(
    (left, right) =>
      left.rect.left - right.rect.left ||
      left.rect.right - right.rect.right ||
      left.layer.zIndex - right.layer.zIndex,
  );
  const first = ordered[0]!;
  const last = ordered[ordered.length - 1]!;
  const totalWidth = ordered.reduce(
    (sum, target) => sum + (target.rect.right - target.rect.left),
    0,
  );
  const span = last.rect.right - first.rect.left;
  const gap = (span - totalWidth) / (ordered.length - 1);
  // V0 never overlaps objects to make a distribution fit.
  if (!(gap >= 0)) return null;
  const changes: PlannedChange[] = [
    { snapshot: first, transform: movedBy(first, 0, 0) },
  ];
  let cursor = first.rect.right;
  for (const target of ordered.slice(1, -1)) {
    const targetLeft = cursor + gap;
    changes.push({
      snapshot: target,
      transform: shiftLeft(target, targetLeft),
    });
    cursor = targetLeft + (target.rect.right - target.rect.left);
  }
  changes.push({ snapshot: last, transform: movedBy(last, 0, 0) });
  return changes;
}

function transformRejection(
  transform: LayoutLayerTransform,
  snapshot: TargetSnapshot,
): { reason: LayoutPlanErrorReason; message: string } | null {
  const { layer } = snapshot;
  const position: LayoutPoint = { x: transform.x, y: transform.y };
  if (
    transform.scaleX < LAYER_MIN_SCALE ||
    transform.scaleX > LAYER_MAX_SCALE ||
    transform.scaleY < LAYER_MIN_SCALE ||
    transform.scaleY > LAYER_MAX_SCALE
  ) {
    return {
      reason: 'invalid-scale',
      message: describeLayoutBlock(layer.name, 'invalid-scale'),
    };
  }
  const rect = layoutVisualRectAt(
    {
      bounds: snapshot.metrics.bounds,
      scaleX: layer.flipX ? -transform.scaleX : transform.scaleX,
      scaleY: transform.scaleY,
    },
    position,
  );
  if (!layoutPointInsideCanvas(position) || !layoutRectFitsCanvas(rect)) {
    return {
      reason: 'out-of-canvas',
      message: describeLayoutBlock(layer.name, 'out-of-canvas'),
    };
  }
  return null;
}

export interface LayoutPlanInput {
  readonly action: LayoutAlignAction;
  readonly layerIds: readonly string[];
  readonly referenceLayerId?: string | null;
}

/**
 * Pure candidate computation. It reads the formal Project and never writes it:
 * the panel previews this result and only the explicit Apply commits it.
 */
export function planLayerLayout(
  project: Project,
  shot: Shot,
  input: LayoutPlanInput,
): LayoutPlanResult {
  const { action } = input;
  const layerIds = distinctLayerIds(input.layerIds);
  const minimum = layoutActionMinimumSelection(action);
  if (layerIds.length === 0) {
    return {
      ok: false,
      reason: 'incomplete',
      message: describeLayoutPlanError('incomplete', action),
    };
  }
  const byId = new Map(shot.layers.map((layer) => [layer.id, layer]));
  const missing = layerIds.find((layerId) => {
    const layer = byId.get(layerId);
    return !layer || !isLayoutTarget(layer, shot);
  });
  if (missing) {
    return {
      ok: false,
      reason: 'unavailable-layer',
      message: describeLayoutPlanError('unavailable-layer', action),
    };
  }
  if (layerIds.length < minimum) {
    return {
      ok: false,
      reason: 'not-enough',
      message: describeLayoutPlanError('not-enough', action),
    };
  }

  const metrics = resolveLayoutVisualMetrics(project, shot);
  const targets: TargetSnapshot[] = [];
  for (const layerId of layerIds) {
    const layer = byId.get(layerId)!;
    const reason = blockReason(layer, shot, metrics);
    if (reason) {
      return {
        ok: false,
        reason,
        message: describeLayoutBlock(layer.name, reason),
      };
    }
    targets.push(targetSnapshot(layer, metrics.get(layerId)!));
  }

  let referenceLayerId: string | null = null;
  let changes: PlannedChange[];
  if (action === 'distribute-horizontal') {
    const distributed = distributeChanges(targets);
    if (!distributed) {
      return {
        ok: false,
        reason: 'insufficient-space',
        message: '当前空间不足，无法在不重叠的情况下均分。',
      };
    }
    changes = distributed;
  } else {
    const requested = input.referenceLayerId ?? null;
    const reference = requested
      ? targets.find((target) => target.layer.id === requested)
      : undefined;
    if (requested && !reference) {
      return {
        ok: false,
        reason: 'missing-reference',
        message: describeLayoutPlanError('missing-reference', action),
      };
    }
    const resolved = reference ?? targets[0]!;
    referenceLayerId = resolved.layer.id;
    changes = alignChanges(action, targets, resolved);
  }

  const planned: LayoutLayerTransform[] = [];
  for (const change of changes) {
    const rejection = transformRejection(change.transform, change.snapshot);
    if (rejection) return { ok: false, ...rejection };
    planned.push(change.transform);
  }
  if (planned.length === 0) {
    return {
      ok: false,
      reason: 'incomplete',
      message: describeLayoutPlanError('incomplete', action),
    };
  }
  return {
    ok: true,
    plan: { action, referenceLayerId, transforms: planned },
  };
}
