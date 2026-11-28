import {
  MAX_COVERAGE_MASK_TARGETS,
  type Layer,
  type Shot,
} from './models';

/**
 * Resolved author-level coverage mask relations for one Shot (#1454).
 *
 * The mask Layer owns the persisted relationship (`maskTargets`). Evaluation,
 * rendering, and the Inspector all derive the reverse mapping from this module
 * so they never disagree and nothing reverse is persisted.
 */

export type CoverageMaskIssueCode =
  | 'cycle'
  | 'dangling-target'
  | 'duplicate-target'
  | 'mask-targets-mask'
  | 'multiple-masks'
  | 'self-reference';

export interface CoverageMaskIssue {
  readonly code: CoverageMaskIssueCode;
  /** Mask Layer that owns the degraded relationship. */
  readonly layerId: string;
  readonly targetLayerId?: string;
  /** Creator-facing Chinese explanation; never an internal field name. */
  readonly message: string;
}

/** Transient evaluation projection. Never persisted. */
export type EvaluatedCoverageMask =
  | {
      /** This Layer supplies coverage and is not an ordinary drawn Layer. */
      readonly role: 'mask-layer';
      readonly targetLayerIds: readonly string[];
    }
  | {
      /** This Layer is clipped by the coverage of `maskLayerId`. */
      readonly role: 'masked-target';
      readonly maskLayerId: string;
    };

export interface ShotCoverageMaskResolution {
  /** Every Layer that carries an authored mask relationship (drawn as a mask only). */
  readonly maskLayerIds: ReadonlySet<string>;
  /** Valid target ids per mask Layer, in authored order. */
  readonly maskTargetLayerIds: ReadonlyMap<string, readonly string[]>;
  /** Derived reverse mapping: clipped Layer id -> its mask Layer id. */
  readonly maskLayerIdByTarget: ReadonlyMap<string, string>;
  readonly issues: readonly CoverageMaskIssue[];
}

function orderedByZIndex(layers: readonly Layer[]): Layer[] {
  return [...layers].sort((left, right) => left.zIndex - right.zIndex);
}

function declaredMaskEdges(
  layers: readonly Layer[],
  override?: { readonly maskLayerId: string; readonly targetLayerIds: readonly string[] },
): Map<string, readonly string[]> {
  const edges = new Map<string, readonly string[]>();
  for (const layer of layers) {
    if (layer.maskTargets === undefined) continue;
    edges.set(layer.id, layer.maskTargets);
  }
  if (override) edges.set(override.maskLayerId, override.targetLayerIds);
  return edges;
}

/**
 * Mask ids that participate in a declared mask -> mask cycle. A mask may only
 * clip ordinary content, so a cycle is always an invalid authoring state.
 */
function cyclicMaskLayerIds(edges: ReadonlyMap<string, readonly string[]>): Set<string> {
  const cyclic = new Set<string>();
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (maskId: string): boolean => {
    const current = state.get(maskId);
    if (current === 'visiting') return true;
    if (current === 'done') return false;
    state.set(maskId, 'visiting');
    let found = false;
    for (const targetId of edges.get(maskId) ?? []) {
      if (!edges.has(targetId)) continue;
      if (visit(targetId)) {
        found = true;
        cyclic.add(maskId);
      }
    }
    state.set(maskId, 'done');
    if (found) cyclic.add(maskId);
    return found;
  };
  for (const maskId of edges.keys()) visit(maskId);
  return cyclic;
}

/**
 * Resolves a Shot's coverage mask relations, degrading locally instead of
 * throwing so pre-existing data can still be opened, previewed, and exported.
 * Dangling or invalid entries are reported as issues and simply do not clip.
 */
export function resolveShotCoverageMasks(
  shot: Pick<Shot, 'layers'>,
): ShotCoverageMaskResolution {
  const layers = orderedByZIndex(shot.layers);
  const byId = new Map(layers.map((layer) => [layer.id, layer]));
  const maskLayerIds = new Set(
    layers.filter((layer) => layer.maskTargets !== undefined).map((layer) => layer.id),
  );
  const cyclic = cyclicMaskLayerIds(declaredMaskEdges(layers));
  const issues: CoverageMaskIssue[] = [];
  const maskTargetLayerIds = new Map<string, readonly string[]>();
  const maskLayerIdByTarget = new Map<string, string>();

  for (const maskLayer of layers) {
    const declared = maskLayer.maskTargets;
    if (declared === undefined) continue;
    if (cyclic.has(maskLayer.id)) {
      issues.push({
        code: 'cycle',
        layerId: maskLayer.id,
        message: '遮罩关系存在循环，已局部停用有问题的遮罩目标。',
      });
    }
    const kept: string[] = [];
    for (const targetLayerId of declared) {
      if (targetLayerId === maskLayer.id) {
        issues.push({
          code: 'self-reference',
          layerId: maskLayer.id,
          targetLayerId,
          message: '图层不能遮罩自身，已忽略该目标。',
        });
        continue;
      }
      if (kept.includes(targetLayerId)) {
        issues.push({
          code: 'duplicate-target',
          layerId: maskLayer.id,
          targetLayerId,
          message: '遮罩目标重复，已忽略重复项。',
        });
        continue;
      }
      const target = byId.get(targetLayerId);
      if (!target) {
        issues.push({
          code: 'dangling-target',
          layerId: maskLayer.id,
          targetLayerId,
          message: '被遮罩图层已不存在，已自动忽略该目标。',
        });
        continue;
      }
      if (target.maskTargets !== undefined) {
        issues.push({
          code: 'mask-targets-mask',
          layerId: maskLayer.id,
          targetLayerId,
          message: '遮罩图层不能再作为其他遮罩的目标（暂不支持嵌套遮罩），已忽略该目标。',
        });
        continue;
      }
      const existingMaskLayerId = maskLayerIdByTarget.get(targetLayerId);
      if (existingMaskLayerId !== undefined) {
        issues.push({
          code: 'multiple-masks',
          layerId: maskLayer.id,
          targetLayerId,
          message: '该图层已被其他遮罩覆盖，后设置的遮罩已局部停用。',
        });
        continue;
      }
      maskLayerIdByTarget.set(targetLayerId, maskLayer.id);
      kept.push(targetLayerId);
    }
    maskTargetLayerIds.set(maskLayer.id, kept);
  }

  return {
    maskLayerIds,
    maskTargetLayerIds,
    maskLayerIdByTarget,
    issues,
  };
}

export class CoverageMaskValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CoverageMaskValidationError';
  }
}

function maskTargetValidationError(
  shot: Pick<Shot, 'layers'>,
  maskLayerId: string,
  targetLayerIds: readonly string[],
): string | null {
  const byId = new Map(shot.layers.map((layer) => [layer.id, layer]));
  const maskLayer = byId.get(maskLayerId);
  if (!maskLayer) return `找不到遮罩图层：${maskLayerId}`;
  if (targetLayerIds.length > MAX_COVERAGE_MASK_TARGETS) {
    return `单个遮罩最多覆盖 ${MAX_COVERAGE_MASK_TARGETS} 个图层。`;
  }
  if (new Set(targetLayerIds).size !== targetLayerIds.length) {
    return '遮罩目标图层不能重复。';
  }
  for (const targetLayerId of targetLayerIds) {
    if (targetLayerId === maskLayerId) return '图层不能遮罩自身。';
  }
  const cyclic = cyclicMaskLayerIds(
    declaredMaskEdges(shot.layers, { maskLayerId, targetLayerIds }),
  );
  if (cyclic.has(maskLayerId)) {
    return '遮罩关系不能形成循环。';
  }
  for (const targetLayerId of targetLayerIds) {
    const target = byId.get(targetLayerId);
    if (!target) return `找不到被遮罩图层：${targetLayerId}`;
    if (target.maskTargets !== undefined) {
      return '遮罩图层不能再作为其他遮罩的目标（暂不支持嵌套遮罩）。';
    }
    const claimedBy = shot.layers.find(
      (layer) => layer.id !== maskLayerId && layer.maskTargets?.includes(targetLayerId),
    );
    if (claimedBy) {
      return `图层“${target.name}”已被遮罩“${claimedBy.name}”覆盖，一个图层只能被一个遮罩覆盖。`;
    }
  }
  return null;
}

/**
 * Save-time validation for a mask relationship change. Throws a
 * creator-facing Chinese error instead of silently persisting an invalid graph.
 */
export function assertCoverageMaskChange(
  shot: Pick<Shot, 'layers'>,
  maskLayerId: string,
  targetLayerIds: readonly string[],
): void {
  const message = maskTargetValidationError(shot, maskLayerId, targetLayerIds);
  if (message) throw new CoverageMaskValidationError(message);
}

export interface CoverageMaskTargetCandidate {
  readonly layer: Layer;
  /** False when the relationship is technically valid but currently inactive. */
  readonly selected: boolean;
}

/**
 * Layers that may be added as targets of the given mask Layer: ordinary
 * non-background, non-control content that is not already masked elsewhere.
 * The mask's own current targets are always included so the Inspector can show
 * and uncheck them.
 */
export function validCoverageMaskTargets(
  shot: Pick<Shot, 'layers' | 'backgroundLayerId'>,
  maskLayerId: string,
): CoverageMaskTargetCandidate[] {
  const current = new Set(
    shot.layers.find((layer) => layer.id === maskLayerId)?.maskTargets ?? [],
  );
  return orderedByZIndex(shot.layers)
    .filter((layer) =>
      layer.id !== maskLayerId &&
      layer.id !== shot.backgroundLayerId &&
      layer.source.kind !== 'control' &&
      layer.maskTargets === undefined,
    )
    .filter((layer) =>
      current.has(layer.id) ||
      !shot.layers.some(
        (other) => other.id !== maskLayerId && other.maskTargets?.includes(layer.id),
      ),
    )
    .map((layer) => ({ layer, selected: current.has(layer.id) }));
}

/** Resolved mask Layer for one ordinary target Layer, if any. */
export function resolveMaskLayerForTarget(
  shot: Pick<Shot, 'layers'>,
  targetLayerId: string,
): Layer | null {
  const resolution = resolveShotCoverageMasks(shot);
  const maskLayerId = resolution.maskLayerIdByTarget.get(targetLayerId);
  if (!maskLayerId) return null;
  return shot.layers.find((layer) => layer.id === maskLayerId) ?? null;
}

/**
 * Projects resolved relations onto evaluated Layers. Layers that do not
 * participate keep their identity so downstream memoization is unaffected.
 */
export function applyResolvedCoverageMasks<T extends { readonly id: string }>(
  layers: readonly T[],
  resolution: ShotCoverageMaskResolution,
): T[] {
  return layers.map((layer) => {
    const targetLayerIds = resolution.maskTargetLayerIds.get(layer.id);
    if (targetLayerIds !== undefined) {
      return {
        ...layer,
        coverageMask: {
          role: 'mask-layer',
          targetLayerIds,
        } satisfies EvaluatedCoverageMask,
      } as T;
    }
    const maskLayerId = resolution.maskLayerIdByTarget.get(layer.id);
    if (maskLayerId !== undefined) {
      return {
        ...layer,
        coverageMask: {
          role: 'masked-target',
          maskLayerId,
        } satisfies EvaluatedCoverageMask,
      } as T;
    }
    return layer;
  });
}
