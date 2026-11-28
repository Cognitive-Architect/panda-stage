import { useMemo, useState, useSyncExternalStore } from 'react';
import {
  AlertTriangle,
  Clock,
  Crosshair,
  EyeOff,
  GitBranch,
  Link2,
  Lock,
  Scan,
  Unlink2,
} from 'lucide-react';
import { validBatchLayerParentTargets } from '../../../domain';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { layerListUiStore, useLayerListUi } from '../../stores/layerListUiStore';
import { layerStore } from '../../stores/layerStore';
import { selectionStore } from '../../stores/selectionStore';
import { shotStore } from '../../stores/shotStore';
import { timelineUiStore, useTimelineUi } from '../timeline/timelineUiStore';
import {
  buildParentChainViewModel,
  DEFAULT_PARENT_CHAIN_ROW_HEIGHT,
  parentChainColumnX,
  parentChainRowCenterY,
} from './parentChainModel';

export interface ShotLayerListPanelProps {
  /** Called when a user clicks a parent-chain node to jump to the existing parent control. */
  onFocusParentBinding?: (layerId: string) => void;
}

export function ShotLayerListPanel({
  onFocusParentBinding,
}: ShotLayerListPanelProps = {}): React.JSX.Element | null {
  const snapshot = useSyncExternalStore(
    editorProjectStore.subscribe,
    editorProjectStore.getSnapshot,
  );
  const shotId = useSyncExternalStore(
    shotStore.subscribe,
    shotStore.getCurrentShotId,
  );
  const selectedLayerId = useSyncExternalStore(
    selectionStore.subscribe,
    selectionStore.getSelectedLayerId,
  );
  const { currentTimeMs } = useTimelineUi();
  const { parentChainVisible, batchSelectedLayerIds } = useLayerListUi();
  const [batchParentId, setBatchParentId] = useState('');
  const [batchError, setBatchError] = useState('');

  const shot = useMemo(
    () => snapshot?.project.shots.find((candidate) => candidate.id === shotId) ?? null,
    [shotId, snapshot],
  );

  const viewModel = useMemo(
    () =>
      shot
        ? buildParentChainViewModel(shot, currentTimeMs, selectedLayerId, {
            rowHeight: DEFAULT_PARENT_CHAIN_ROW_HEIGHT,
          })
        : null,
    [currentTimeMs, selectedLayerId, shot],
  );

  const batchTargets = useMemo(
    () =>
      shot && batchSelectedLayerIds.length > 0
        ? validBatchLayerParentTargets(shot, batchSelectedLayerIds)
        : [],
    [batchSelectedLayerIds, shot],
  );

  const selectedHasDynamicKeys = useMemo(() => {
    if (!shot || batchSelectedLayerIds.length === 0) return false;
    const idSet = new Set(batchSelectedLayerIds);
    return shot.layers.some((layer) => idSet.has(layer.id) && Boolean(layer.parentKeys?.length));
  }, [batchSelectedLayerIds, shot]);

  if (!shot || !viewModel || viewModel.rows.length === 0) return null;

  const effectiveBatchTargetId = batchTargets.some(({ id }) => id === batchParentId)
    ? batchParentId
    : '';

  const selectLayerRow = (layerId: string, isBackground: boolean): void => {
    if (isBackground) {
      selectionStore.selectBackground();
    } else {
      selectionStore.select(layerId);
    }
  };

  return (
    <section
      aria-label="图层列表"
      data-testid="shot-layer-list-panel"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        marginBottom: '8px',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '6px',
          fontSize: '12px',
        }}
      >
        <strong>图层 ({viewModel.rows.length})</strong>
        <button
          aria-label="切换父链视图"
          aria-pressed={parentChainVisible}
          data-testid="parent-chain-toggle"
          data-ui-button
          data-ui-variant="secondary"
          onClick={() => layerListUiStore.toggleParentChain()}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            padding: '2px 8px',
            fontSize: '11px',
          }}
          title="显示或隐藏当前时刻的父链关系列"
          type="button"
        >
          <GitBranch size={12} aria-hidden="true" />
          <span>父链</span>
        </button>
      </div>

      {batchSelectedLayerIds.length > 0 ? (
        <div
          data-testid="batch-parent-toolbar"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
            padding: '6px',
            borderRadius: 'var(--ui-radius-small, 6px)',
            background: 'var(--ui-color-surface-work, #141c18)',
            border: '1px solid var(--ui-color-border, rgb(127 199 148 / 28%))',
            fontSize: '12px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
            <span>已勾选 {batchSelectedLayerIds.length} 项</span>
            <button
              type="button"
              onClick={() => {
                layerListUiStore.clearBatchSelection();
                setBatchError('');
              }}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--ui-color-text-secondary, #aebfb4)',
                cursor: 'pointer',
                fontSize: '11px',
                padding: 0,
              }}
            >
              清空
            </button>
          </div>

          {selectedHasDynamicKeys ? (
            <div
              data-testid="batch-parent-dynamic-note"
              style={{
                fontSize: '11px',
                color: 'var(--ui-color-text-secondary, #aebfb4)',
              }}
            >
              含动态交接层：仅改静态基础父级，保留后续交接段
            </div>
          ) : null}

          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center' }}>
            <select
              aria-label="批量目标父级"
              data-testid="batch-parent-target-select"
              value={effectiveBatchTargetId}
              onChange={(event) => setBatchParentId(event.currentTarget.value)}
              style={{ flex: '1 1 110px', minWidth: 0, fontSize: '12px' }}
            >
              <option value="">选择父级图层…</option>
              {batchTargets.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              data-testid="batch-parent-bind"
              data-ui-button
              data-ui-variant="secondary"
              disabled={!effectiveBatchTargetId}
              onClick={() => {
                if (!effectiveBatchTargetId) return;
                try {
                  layerStore.batchSetParent(
                    batchSelectedLayerIds,
                    effectiveBatchTargetId,
                    timelineUiStore.getSnapshot().currentTimeMs,
                  );
                  setBatchError('');
                } catch (cause) {
                  setBatchError(cause instanceof Error ? cause.message : '无法批量绑定父级。');
                }
              }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', padding: '3px 7px' }}
            >
              <Link2 size={12} aria-hidden="true" />
              <span>批量绑定</span>
            </button>
            <button
              type="button"
              data-testid="batch-parent-detach"
              data-ui-button
              data-ui-variant="secondary"
              onClick={() => {
                try {
                  layerStore.batchDetachParent(
                    batchSelectedLayerIds,
                    timelineUiStore.getSnapshot().currentTimeMs,
                  );
                  setBatchError('');
                } catch (cause) {
                  setBatchError(cause instanceof Error ? cause.message : '无法批量解除绑定。');
                }
              }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', padding: '3px 7px' }}
            >
              <Unlink2 size={12} aria-hidden="true" />
              <span>批量解绑</span>
            </button>
            <button
              type="button"
              data-testid="batch-parent-create-control"
              data-ui-button
              data-ui-variant="secondary"
              onClick={() => {
                try {
                  layerStore.createControllerAndBindLayers(
                    batchSelectedLayerIds,
                    timelineUiStore.getSnapshot().currentTimeMs,
                  );
                  layerListUiStore.clearBatchSelection();
                  setBatchError('');
                } catch (cause) {
                  setBatchError(cause instanceof Error ? cause.message : '无法新建控制层并绑定。');
                }
              }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', padding: '3px 7px' }}
            >
              <Crosshair size={12} aria-hidden="true" />
              <span>新建控制层并绑定</span>
            </button>
          </div>
          {batchError ? <div role="alert">{batchError}</div> : null}
        </div>
      ) : null}

      <div
        data-testid="shot-layer-list-scroll"
        style={{
          maxHeight: '220px',
          overflowY: 'auto',
          display: 'flex',
          alignItems: 'flex-start',
          borderRadius: 'var(--ui-radius-small, 6px)',
          background: 'var(--ui-color-surface-work, #141c18)',
        }}
      >
        {parentChainVisible ? (
          <div
            aria-label="当前时刻父链列"
            data-testid="parent-chain-column"
            style={{
              position: 'relative',
              flex: '0 0 auto',
              width: `${viewModel.columnWidth}px`,
              height: `${viewModel.totalHeight}px`,
              borderRight: '1px solid var(--ui-color-separator, rgb(154 216 172 / 24%))',
            }}
          >
            <svg
              aria-hidden="true"
              height={viewModel.totalHeight}
              style={{ display: 'block', overflow: 'visible' }}
              width={viewModel.columnWidth}
            >
              {viewModel.edges.map((edge) => {
                const xChild = parentChainColumnX(edge.childColumn);
                const yChild = parentChainRowCenterY(edge.childRowIndex, viewModel.rowHeight);
                const xParent = parentChainColumnX(edge.parentColumn);
                const yParent = parentChainRowCenterY(edge.parentRowIndex, viewModel.rowHeight);
                const stroke = edge.highlighted
                  ? 'var(--ui-color-selected-border, #7fc794)'
                  : 'var(--ui-color-text-muted, #84958b)';
                return (
                  <path
                    key={edge.id}
                    d={`M ${xParent} ${yParent} L ${xParent} ${yChild} L ${xChild} ${yChild}`}
                    data-dynamic={edge.isDynamic ? 'true' : 'false'}
                    data-highlighted={edge.highlighted ? 'true' : 'false'}
                    fill="none"
                    stroke={stroke}
                    strokeDasharray={edge.isDynamic ? '3 2' : undefined}
                    strokeWidth={edge.highlighted ? 1.8 : 1.1}
                  />
                );
              })}
              {viewModel.rows.map((row) => {
                const cx = parentChainColumnX(row.columnIndex);
                const cy = parentChainRowCenterY(row.rowIndex, viewModel.rowHeight);
                const fill = row.parentMissing
                  ? 'var(--ui-color-action-warning, #a36d19)'
                  : row.inSelectedChain
                    ? 'var(--ui-color-selected-border, #7fc794)'
                    : 'var(--ui-color-text-secondary, #aebfb4)';
                return (
                  <circle
                    key={row.layer.id}
                    cx={cx}
                    cy={cy}
                    fill={row.isHidden ? 'none' : fill}
                    r={row.isSelected ? 3.5 : 2.5}
                    stroke={fill}
                    strokeWidth={1.2}
                  />
                );
              })}
            </svg>
            {viewModel.rows.map((row) => (
              <button
                key={row.layer.id}
                aria-label={`${row.layer.name}：${row.tooltip}`}
                data-testid={`parent-chain-node-${row.layer.id}`}
                onClick={() => {
                  selectLayerRow(row.layer.id, row.isBackground);
                  if (!row.isBackground) onFocusParentBinding?.(row.layer.id);
                }}
                style={{
                  position: 'absolute',
                  left: 0,
                  top: `${row.rowIndex * viewModel.rowHeight}px`,
                  width: `${viewModel.columnWidth}px`,
                  height: `${viewModel.rowHeight}px`,
                  background: 'transparent',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                }}
                title={row.tooltip}
                type="button"
              />
            ))}
          </div>
        ) : null}

        <div style={{ flex: '1 1 auto', minWidth: 0 }}>
          {viewModel.rows.map((row) => {
            const checked = batchSelectedLayerIds.includes(row.layer.id);
            const batchEligible = !row.isBackground && !row.isLocked;
            return (
              <div
                key={row.layer.id}
                data-layer-id={row.layer.id}
                data-selected={row.isSelected ? 'true' : 'false'}
                data-selected-chain={row.inSelectedChain ? 'true' : 'false'}
                data-testid={`layer-list-row-${row.layer.id}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  height: `${viewModel.rowHeight}px`,
                  padding: '0 6px',
                  fontSize: '12px',
                  background: row.isSelected
                    ? 'var(--ui-color-selected-surface, rgb(65 145 87 / 34%))'
                    : row.inSelectedChain && parentChainVisible
                      ? 'rgb(127 199 148 / 10%)'
                      : 'transparent',
                  opacity: row.isHidden ? 0.65 : 1,
                }}
                title={row.tooltip}
              >
                <input
                  aria-label={`勾选图层 ${row.layer.name}`}
                  checked={checked}
                  data-testid={`layer-batch-checkbox-${row.layer.id}`}
                  disabled={!batchEligible}
                  onChange={() => layerListUiStore.toggleBatchLayer(row.layer.id)}
                  style={{ margin: 0, flex: '0 0 auto' }}
                  type="checkbox"
                />
                <button
                  onClick={() => selectLayerRow(row.layer.id, row.isBackground)}
                  style={{
                    flex: '1 1 auto',
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    textAlign: 'left',
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    color: 'inherit',
                    cursor: 'pointer',
                    fontWeight: row.isSelected ? 600 : 400,
                  }}
                  type="button"
                >
                  {row.layer.name}
                </button>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '3px',
                    flex: '0 0 auto',
                    color: 'var(--ui-color-text-muted, #84958b)',
                  }}
                >
                  {row.isControl ? <Crosshair size={11} aria-label="空控制层" /> : null}
                  {row.layer.maskTargets !== undefined ? <Scan size={11} aria-label="遮罩图层" /> : null}
                  {row.isDynamicBinding ? <Clock size={11} aria-label="动态交接" /> : null}
                  {row.parentMissing ? (
                    <AlertTriangle
                      size={11}
                      aria-label="父级缺失"
                      style={{ color: 'var(--ui-color-action-warning, #a36d19)' }}
                    />
                  ) : null}
                  {row.isHidden ? <EyeOff size={11} aria-label="已隐藏" /> : null}
                  {row.isLocked ? <Lock size={11} aria-label="已锁定" /> : null}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
