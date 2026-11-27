import {
  resolveLayerParentBindingAtTime,
  type Layer,
  type Shot,
} from '../../../domain';

export const DEFAULT_PARENT_CHAIN_MAX_COLUMNS = 4;
export const DEFAULT_PARENT_CHAIN_ROW_HEIGHT = 28;
export const PARENT_CHAIN_COLUMN_STEP_PX = 12;
export const PARENT_CHAIN_COLUMN_PAD_PX = 10;

export interface ParentChainRow {
  readonly layer: Layer;
  readonly rowIndex: number;
  readonly isBackground: boolean;
  readonly isControl: boolean;
  readonly isHidden: boolean;
  readonly isLocked: boolean;
  readonly isSelected: boolean;
  readonly inSelectedChain: boolean;
  readonly activeParentId: string | undefined;
  readonly activeParentName: string | undefined;
  readonly isDynamicBinding: boolean;
  readonly hasDynamicKeys: boolean;
  readonly parentMissing: boolean;
  readonly hasAttachment: boolean;
  readonly ancestorDepth: number;
  readonly columnIndex: number;
  readonly compressed: boolean;
  readonly tooltip: string;
}

export interface ParentChainEdge {
  readonly id: string;
  readonly childId: string;
  readonly parentId: string;
  readonly childRowIndex: number;
  readonly parentRowIndex: number;
  readonly childColumn: number;
  readonly parentColumn: number;
  readonly isDynamic: boolean;
  readonly highlighted: boolean;
}

export interface ParentChainViewModel {
  readonly rows: readonly ParentChainRow[];
  readonly edges: readonly ParentChainEdge[];
  readonly columnCount: number;
  readonly columnWidth: number;
  readonly rowHeight: number;
  readonly totalHeight: number;
}

function formatTooltipTime(timeMs: number): string {
  return `${(timeMs / 1000).toFixed(2)}s`;
}

/**
 * Pure read-only parent-chain layout model for the layer list at `timeMs`.
 *
 * Uses ONLY `resolveLayerParentBindingAtTime` and authored layer metadata —
 * never triggers `evaluateShotAtTime`, matrix math, or Graphic evaluation, and
 * never mutates `zIndex` or Project state.
 */
export function buildParentChainViewModel(
  shot: Shot,
  timeMs: number,
  selectedLayerId: string | null,
  options?: {
    readonly maxColumns?: number;
    readonly rowHeight?: number;
  },
): ParentChainViewModel {
  const maxColumns = Math.max(2, options?.maxColumns ?? DEFAULT_PARENT_CHAIN_MAX_COLUMNS);
  const rowHeight = Math.max(20, options?.rowHeight ?? DEFAULT_PARENT_CHAIN_ROW_HEIGHT);

  // Display top-to-bottom by zIndex descending (matching visual stacking); never modifies zIndex.
  const orderedLayers = [...shot.layers].sort((left, right) => right.zIndex - left.zIndex);
  const layerById = new Map(orderedLayers.map((layer) => [layer.id, layer]));
  const rowIndexById = new Map(orderedLayers.map((layer, index) => [layer.id, index]));

  const bindings = new Map(
    orderedLayers.map((layer) => [layer.id, resolveLayerParentBindingAtTime(layer, timeMs)]),
  );

  // Build active children adjacency for selected-chain highlighting (ancestors + descendants).
  const activeChildrenByParent = new Map<string, string[]>();
  for (const layer of orderedLayers) {
    const parentId = bindings.get(layer.id)?.parentLayerId;
    if (parentId && layerById.has(parentId)) {
      const list = activeChildrenByParent.get(parentId) ?? [];
      list.push(layer.id);
      activeChildrenByParent.set(parentId, list);
    }
  }

  const selectedChainIds = new Set<string>();
  if (selectedLayerId && layerById.has(selectedLayerId)) {
    selectedChainIds.add(selectedLayerId);
    // Walk ancestors with cycle guard
    let ancestor = bindings.get(selectedLayerId)?.parentLayerId;
    while (ancestor && layerById.has(ancestor) && !selectedChainIds.has(ancestor)) {
      selectedChainIds.add(ancestor);
      ancestor = bindings.get(ancestor)?.parentLayerId;
    }
    // Walk descendants with cycle guard
    const queue = [selectedLayerId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const childId of activeChildrenByParent.get(current) ?? []) {
        if (!selectedChainIds.has(childId)) {
          selectedChainIds.add(childId);
          queue.push(childId);
        }
      }
    }
  }

  // Compute ancestor depth per layer with cycle guard.
  const ancestorDepthById = new Map<string, number>();
  for (const layer of orderedLayers) {
    let depth = 0;
    const seen = new Set<string>([layer.id]);
    let current = bindings.get(layer.id)?.parentLayerId;
    while (current && layerById.has(current) && !seen.has(current)) {
      seen.add(current);
      depth += 1;
      current = bindings.get(current)?.parentLayerId;
    }
    ancestorDepthById.set(layer.id, depth);
  }

  let maxUsedColumn = 0;
  const rows: ParentChainRow[] = orderedLayers.map((layer, rowIndex) => {
    const binding = bindings.get(layer.id)!;
    const activeParentId = binding.parentLayerId;
    const parentLayer = activeParentId ? layerById.get(activeParentId) : undefined;
    const parentMissing = Boolean(activeParentId && !parentLayer);
    const isDynamicBinding = binding.source === 'key';
    const hasDynamicKeys = Boolean(layer.parentKeys?.length);
    const hasAttachment = Boolean(binding.parentAttachment);
    const ancestorDepth = ancestorDepthById.get(layer.id) ?? 0;
    const compressed = ancestorDepth >= maxColumns;
    const columnIndex = Math.min(ancestorDepth, maxColumns - 1);
    if (columnIndex > maxUsedColumn) maxUsedColumn = columnIndex;

    const isBackground = shot.backgroundLayerId === layer.id;
    const isControl = layer.source.kind === 'control';
    const isHidden = !layer.visible;
    const isLocked = layer.locked;

    const parts: string[] = [];
    if (isBackground) {
      parts.push('正式背景');
    } else if (parentMissing) {
      parts.push('父级目标缺失');
    } else if (parentLayer) {
      const attachmentText = hasAttachment ? '（挂接点）' : '';
      if (isDynamicBinding && binding.keyTimeMs !== undefined) {
        parts.push(`动态交接 → ${parentLayer.name}${attachmentText}（${formatTooltipTime(binding.keyTimeMs)}）`);
      } else {
        parts.push(`跟随 ${parentLayer.name}${attachmentText}`);
      }
    } else if (isDynamicBinding && binding.keyTimeMs !== undefined) {
      parts.push(`动态解绑（${formatTooltipTime(binding.keyTimeMs)}）`);
    } else {
      parts.push('独立图层');
    }
    if (isControl) parts.push('空控制层');
    if (isHidden) parts.push('已隐藏');
    if (isLocked) parts.push('已锁定');
    if (compressed) parts.push(`层级深度 ${ancestorDepth}`);

    return {
      layer,
      rowIndex,
      isBackground,
      isControl,
      isHidden,
      isLocked,
      isSelected: layer.id === selectedLayerId,
      inSelectedChain: selectedChainIds.has(layer.id),
      activeParentId,
      activeParentName: parentLayer?.name,
      isDynamicBinding,
      hasDynamicKeys,
      parentMissing,
      hasAttachment,
      ancestorDepth,
      columnIndex,
      compressed,
      tooltip: parts.join(' · '),
    };
  });

  const rowById = new Map(rows.map((row) => [row.layer.id, row]));
  const edges: ParentChainEdge[] = [];
  for (const row of rows) {
    if (!row.activeParentId || row.parentMissing) continue;
    const parentRow = rowById.get(row.activeParentId);
    if (!parentRow) continue;
    const parentRowIndex = rowIndexById.get(row.activeParentId)!;
    edges.push({
      id: `${row.layer.id}->${row.activeParentId}`,
      childId: row.layer.id,
      parentId: row.activeParentId,
      childRowIndex: row.rowIndex,
      parentRowIndex,
      childColumn: row.columnIndex,
      parentColumn: parentRow.columnIndex,
      isDynamic: row.isDynamicBinding,
      highlighted: row.inSelectedChain && parentRow.inSelectedChain,
    });
  }

  const columnCount = Math.max(1, maxUsedColumn + 1);
  const columnWidth = PARENT_CHAIN_COLUMN_PAD_PX * 2 + (columnCount - 1) * PARENT_CHAIN_COLUMN_STEP_PX;

  return {
    rows,
    edges,
    columnCount,
    columnWidth,
    rowHeight,
    totalHeight: rows.length * rowHeight,
  };
}

export function parentChainColumnX(columnIndex: number): number {
  return PARENT_CHAIN_COLUMN_PAD_PX + columnIndex * PARENT_CHAIN_COLUMN_STEP_PX;
}

export function parentChainRowCenterY(rowIndex: number, rowHeight: number): number {
  return rowIndex * rowHeight + rowHeight / 2;
}
