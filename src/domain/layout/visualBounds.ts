import { PROJECT_HEIGHT, PROJECT_WIDTH } from '../constants';
import type { Project, Shot } from '../models';
import { buildEditorStageRenderModel } from '../selectors/stageRenderModel';

export interface LayoutPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Geometry one Layer needs for layout math: the complete visual in the Layer's
 * own local coordinates plus the scale that turns it into canvas space.
 */
export interface LayoutVisualMetrics {
  readonly bounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  /** flipX is already folded in, so the rect keeps a stable orientation. */
  readonly scaleX: number;
  readonly scaleY: number;
}

/** The on-stage rectangle one complete visual occupies at a candidate position. */
export interface LayoutVisualRect {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/**
 * The formal canvas resolves every visual through this one model, so layout
 * reads the exact same local bounds the Stage renders. A shot whose assets
 * cannot be resolved degrades to "no metrics" instead of throwing into a panel.
 */
export function resolveLayoutVisualMetrics(
  project: Project,
  shot: Shot,
): ReadonlyMap<string, LayoutVisualMetrics> {
  try {
    const model = buildEditorStageRenderModel(project, shot);
    return new Map(
      model.layers.map(({ layer, visual }) => [
        layer.id,
        {
          bounds: {
            x: visual.combinedLocalBounds.x,
            y: visual.combinedLocalBounds.y,
            width: visual.combinedLocalBounds.width,
            height: visual.combinedLocalBounds.height,
          },
          scaleX: layer.flipX ? -layer.scaleX : layer.scaleX,
          scaleY: layer.scaleY,
        },
      ]),
    );
  } catch {
    return new Map();
  }
}

/**
 * V0 refuses rotation, so a visual rect only needs the Layer scale; min/max
 * keeps the rectangle ordered after a horizontal mirror.
 */
export function layoutVisualRectAt(
  metrics: LayoutVisualMetrics,
  position: LayoutPoint,
): LayoutVisualRect {
  const { bounds, scaleX, scaleY } = metrics;
  const firstX = position.x + bounds.x * scaleX;
  const secondX = position.x + (bounds.x + bounds.width) * scaleX;
  const firstY = position.y + bounds.y * scaleY;
  const secondY = position.y + (bounds.y + bounds.height) * scaleY;
  return {
    left: Math.min(firstX, secondX),
    right: Math.max(firstX, secondX),
    top: Math.min(firstY, secondY),
    bottom: Math.max(firstY, secondY),
  };
}

/** True only when the whole visual stays inside the Project canvas. */
export function layoutRectFitsCanvas(rect: LayoutVisualRect): boolean {
  return (
    Number.isFinite(rect.left) &&
    Number.isFinite(rect.right) &&
    Number.isFinite(rect.top) &&
    Number.isFinite(rect.bottom) &&
    rect.left >= 0 &&
    rect.right <= PROJECT_WIDTH &&
    rect.top >= 0 &&
    rect.bottom <= PROJECT_HEIGHT
  );
}

/** A Layer anchor coordinate the formal position service would accept. */
export function layoutPointInsideCanvas(point: LayoutPoint): boolean {
  return (
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    point.x >= 0 &&
    point.x <= PROJECT_WIDTH &&
    point.y >= 0 &&
    point.y <= PROJECT_HEIGHT
  );
}

/**
 * Labels disambiguate duplicate Layer names for display only; identity is
 * always the Layer id, so two copies of the same Character stay distinct.
 */
export function uniqueLayoutNameLabels(
  layers: readonly { readonly id: string; readonly name: string }[],
): Map<string, string> {
  const totals = new Map<string, number>();
  for (const layer of layers) {
    totals.set(layer.name, (totals.get(layer.name) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  const labels = new Map<string, string>();
  for (const layer of layers) {
    const total = totals.get(layer.name) ?? 0;
    if (total < 2) {
      labels.set(layer.id, layer.name);
      continue;
    }
    const ordinal = (seen.get(layer.name) ?? 0) + 1;
    seen.set(layer.name, ordinal);
    labels.set(layer.id, `${layer.name}（${ordinal}）`);
  }
  return labels;
}
