import { PROJECT_HEIGHT, PROJECT_WIDTH } from '../constants';
import type { Layer, Project, Shot } from '../models';
import { recognizePositionChain } from '../position-chain';
import {
  layoutRectFitsCanvas,
  layoutVisualRectAt,
  resolveLayoutVisualMetrics,
  uniqueLayoutNameLabels,
  type LayoutVisualMetrics,
  type LayoutVisualRect,
} from './visualBounds';

/**
 * AUTO-01 V0 freezes exactly one two-person dialogue stance. There is no
 * spacing slider and no layout-template system; the numbers are the contract.
 */
export const QUICK_LAYOUT_LEFT_X_RATIO = 0.34;
export const QUICK_LAYOUT_RIGHT_X_RATIO = 0.66;
export const QUICK_LAYOUT_GROUND_Y_RATIO = 0.92;

export const QUICK_LAYOUT_LEFT_X = PROJECT_WIDTH * QUICK_LAYOUT_LEFT_X_RATIO;
export const QUICK_LAYOUT_RIGHT_X = PROJECT_WIDTH * QUICK_LAYOUT_RIGHT_X_RATIO;
export const QUICK_LAYOUT_GROUND_Y =
  PROJECT_HEIGHT * QUICK_LAYOUT_GROUND_Y_RATIO;

export type QuickLayoutBlockReason =
  | 'locked'
  | 'rotated'
  | 'position-animation'
  | 'visual-unavailable';

export type QuickLayoutPlanErrorReason =
  | QuickLayoutBlockReason
  | 'incomplete'
  | 'same-layer'
  | 'not-character'
  | 'out-of-canvas';

export interface QuickLayoutPoint {
  readonly x: number;
  readonly y: number;
}

export interface QuickLayoutCharacterOption {
  readonly layerId: string;
  readonly name: string;
  /** Display copy only; Layer identity is always the id. */
  readonly label: string;
  readonly blocked: QuickLayoutBlockReason | null;
}

export interface QuickLayoutPlan {
  readonly leftLayerId: string;
  readonly rightLayerId: string;
  readonly left: QuickLayoutPoint;
  readonly right: QuickLayoutPoint;
}

export type QuickLayoutPlanResult =
  | { readonly ok: true; readonly plan: QuickLayoutPlan }
  | {
      readonly ok: false;
      readonly reason: QuickLayoutPlanErrorReason;
      readonly message: string;
    };

type QuickLayoutMetrics = LayoutVisualMetrics;

/** The on-stage rectangle one complete visual occupies at a candidate position. */
export type QuickLayoutVisualRect = LayoutVisualRect;

/** Copy for refusals that are about the two-slot choice, not one person. */
export function describeQuickLayoutChoice(
  reason: Extract<
    QuickLayoutPlanErrorReason,
    'incomplete' | 'same-layer' | 'not-character'
  >,
): string {
  switch (reason) {
    case 'incomplete':
      return '先选择左右两个人物。';
    case 'same-layer':
      return '左右不能是同一个人物。';
    case 'not-character':
      return '只有人物图层可以布阵。';
  }
}

/** Creator-facing refusal copy; the plan and the panel share one owner. */
export function describeQuickLayoutBlock(
  name: string,
  reason: QuickLayoutBlockReason | 'out-of-canvas',
): string {
  switch (reason) {
    case 'locked':
      return `「${name}」已锁定，请先解锁再布阵。`;
    case 'rotated':
      return `「${name}」当前有旋转，请先恢复角度再布阵。`;
    case 'position-animation':
      return `「${name}」已有位置动画，V0 暂不自动改动它的位置。`;
    case 'visual-unavailable':
      return `「${name}」的画面暂时无法计算，请稍后重试。`;
    case 'out-of-canvas':
      return `「${name}」布阵后会超出画布范围。`;
  }
}

/**
 * The formal canvas resolves every visual through this one model, so Quick
 * Layout reads the exact same local bounds the Stage renders. A shot whose
 * assets cannot be resolved degrades to "no metrics" instead of throwing into
 * the tools panel.
 */
function quickLayoutMetrics(
  project: Project,
  shot: Shot,
): ReadonlyMap<string, QuickLayoutMetrics> {
  return resolveLayoutVisualMetrics(project, shot);
}

function characterLayer(shot: Shot, layerId: string | null): Layer | null {
  if (!layerId || shot.backgroundLayerId === layerId) return null;
  const layer = shot.layers.find((candidate) => candidate.id === layerId);
  if (!layer || layer.source.kind !== 'character') return null;
  return layer;
}

function blockReason(
  layer: Layer,
  shot: Shot,
  metrics: ReadonlyMap<string, QuickLayoutMetrics>,
): QuickLayoutBlockReason | null {
  if (layer.locked) return 'locked';
  if (layer.rotationDeg !== 0) return 'rotated';
  if (recognizePositionChain({ shot, layer }).status !== 'none') {
    return 'position-animation';
  }
  if (!metrics.has(layer.id)) return 'visual-unavailable';
  return null;
}

/** Character Layers of the current Shot, in canvas stacking order. */
export function listQuickLayoutCharacters(
  project: Project,
  shot: Shot,
): QuickLayoutCharacterOption[] {
  const metrics = quickLayoutMetrics(project, shot);
  const candidates = [...shot.layers]
    .filter(
      (layer) =>
        layer.source.kind === 'character' &&
        layer.id !== shot.backgroundLayerId,
    )
    .sort((left, right) => left.zIndex - right.zIndex);
  const labels = uniqueLayoutNameLabels(candidates);
  return candidates.map((layer) => ({
    layerId: layer.id,
    name: layer.name,
    label: labels.get(layer.id) ?? layer.name,
    blocked: blockReason(layer, shot, metrics),
  }));
}

/** Bottom-aligned Y for one Layer; never mutates scale, rotation or flip. */
function alignedBottomY(
  metrics: QuickLayoutMetrics | undefined,
  groundY: number = QUICK_LAYOUT_GROUND_Y,
): number | null {
  if (!metrics) return null;
  const bottomOffset = metrics.bounds.y + metrics.bounds.height;
  const y = groundY - bottomOffset * metrics.scaleY;
  return Number.isFinite(y) ? y : null;
}

/**
 * The complete visual rectangle at a candidate position. V0 refuses rotation,
 * so the local bounds only need the Layer scale.
 */
export function quickLayoutVisualRect(
  project: Project,
  shot: Shot,
  layerId: string,
  position: QuickLayoutPoint,
): QuickLayoutVisualRect | null {
  const metrics = quickLayoutMetrics(project, shot).get(layerId);
  if (!metrics) return null;
  return layoutVisualRectAt(metrics, position);
}

/** True only when the whole visual stays inside the Project canvas. */
export function quickLayoutRectFitsCanvas(
  rect: QuickLayoutVisualRect,
): boolean {
  return layoutRectFitsCanvas(rect);
}

export function planQuickCharacterLayout(
  project: Project,
  shot: Shot,
  leftLayerId: string | null,
  rightLayerId: string | null,
): QuickLayoutPlanResult {
  if (!leftLayerId || !rightLayerId) {
    return {
      ok: false,
      reason: 'incomplete',
      message: describeQuickLayoutChoice('incomplete'),
    };
  }
  if (leftLayerId === rightLayerId) {
    return {
      ok: false,
      reason: 'same-layer',
      message: describeQuickLayoutChoice('same-layer'),
    };
  }
  const left = characterLayer(shot, leftLayerId);
  if (!left) {
    return {
      ok: false,
      reason: 'not-character',
      message: describeQuickLayoutChoice('not-character'),
    };
  }
  const right = characterLayer(shot, rightLayerId);
  if (!right) {
    return {
      ok: false,
      reason: 'not-character',
      message: describeQuickLayoutChoice('not-character'),
    };
  }

  const metrics = quickLayoutMetrics(project, shot);
  for (const layer of [left, right]) {
    const reason = blockReason(layer, shot, metrics);
    if (reason) {
      return {
        ok: false,
        reason,
        message: describeQuickLayoutBlock(layer.name, reason),
      };
    }
  }

  const leftY = alignedBottomY(metrics.get(left.id));
  const rightY = alignedBottomY(metrics.get(right.id));
  for (const [layer, position, y] of [
    [left, QUICK_LAYOUT_LEFT_X, leftY],
    [right, QUICK_LAYOUT_RIGHT_X, rightY],
  ] as const) {
    const layerMetrics = metrics.get(layer.id);
    // The center point staying on canvas is not enough: the whole visual has
    // to fit, otherwise a large Character renders its head outside the frame.
    if (
      y === null ||
      !layerMetrics ||
      !quickLayoutRectFitsCanvas(
        layoutVisualRectAt(layerMetrics, { x: position, y }),
      )
    ) {
      return {
        ok: false,
        reason: 'out-of-canvas',
        message: describeQuickLayoutBlock(layer.name, 'out-of-canvas'),
      };
    }
  }

  return {
    ok: true,
    plan: {
      leftLayerId: left.id,
      rightLayerId: right.id,
      left: { x: QUICK_LAYOUT_LEFT_X, y: leftY as number },
      right: { x: QUICK_LAYOUT_RIGHT_X, y: rightY as number },
    },
  };
}
