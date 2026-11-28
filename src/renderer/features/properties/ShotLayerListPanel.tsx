import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { DecorativeIcon, IconButton } from '../../ui';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Box,
  Eye,
  Image,
  MoreHorizontal,
  Film,
  Layers2,
  Unlock,
  UserRound,
  Clock,
  Crosshair,
  EyeOff,
  GitBranch,
  Link2,
  Lock,
  Unlink2,
} from 'lucide-react';
import { evaluateAnimationTrackAtTime, findLayerMotionGraphic, resolveLayerDepthSource, validBatchLayerParentTargets } from '../../../domain';
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

const LAYER_TYPES = {
  background: { icon: Image, label: '背景' },
  control: { icon: Crosshair, label: '控制层' },
  character: { icon: UserRound, label: '角色' },
  asset: { icon: Box, label: '道具' },
  animation: { icon: Layers2, label: '动画' },
  graphic: { icon: Layers2, label: 'Graphic' },
  video: { icon: Film, label: '视频' },
} as const;

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
  const [commandError, setCommandError] = useState('');
  const [menuLayerId, setMenuLayerId] = useState<string | null>(null);
  const renameFocus = useRef<string | null>(null);
  const renameInput = useRef<HTMLInputElement>(null);
  const [rename, setRename] = useState<{ id: string; name: string } | null>(null);

  const shot = useMemo(
    () => snapshot?.project.shots.find((candidate) => candidate.id === shotId) ?? null,
    [shotId, snapshot],
  );
  const dragScope = editorProjectStore.getProjectInstanceId() + ':' + shotId;

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

  if (!snapshot || !shot || !viewModel || viewModel.rows.length === 0) return null;

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

  const movableRows = viewModel.rows.filter(row => !row.isBackground);
  const selectedIndex = movableRows.findIndex(row => row.isSelected);
  const selected = movableRows[selectedIndex];
  const execute = (command: () => void) => {
    try {
      command();
      setCommandError('');
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : '图层操作失败。');
    }
  };

  return (
    <section
      aria-label="图层列表"
      data-testid="shot-layer-list-panel"
      className="workbench-layer-panel"
    >
      <div className="workbench-layer-toolbar">
        <IconButton variant="secondary" aria-label="上移一层" title="上移一层" icon={<DecorativeIcon icon={ArrowUp} />}
          disabled={!selected || selected.isLocked || selectedIndex === 0} onClick={() => selected && execute(() => layerStore.reorder(selected.layer.id, 'forward'))} />
        <IconButton variant="secondary" aria-label="下移一层" title="下移一层" icon={<DecorativeIcon icon={ArrowDown} />}
          disabled={!selected || selected.isLocked || selectedIndex === movableRows.length - 1} onClick={() => selected && execute(() => layerStore.reorder(selected.layer.id, 'backward'))} />
        <IconButton variant="secondary" aria-label="切换父链视图" aria-pressed={parentChainVisible} title="父链与景深"
          data-testid="parent-chain-toggle" icon={<DecorativeIcon icon={GitBranch} />} onClick={() => layerListUiStore.toggleParentChain()} />
      </div>
      {commandError ? <output role="alert">{commandError}</output> : null}

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
        className="workbench-layer-scroll"
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

        <div className="workbench-layer-rows">
          {viewModel.rows.map((row) => {
            const { layer } = row;
            const editable = !row.isBackground && !row.isLocked;
            const index = movableRows.indexOf(row);
            const type = row.isBackground ? 'background'
              : findLayerMotionGraphic(snapshot.project, layer) ? 'graphic' : layer.source.kind;
            const { icon, label } = LAYER_TYPES[type];
            const depthSource = parentChainVisible ? resolveLayerDepthSource(shot, layer, currentTimeMs) : null;
            let depthLabel: number | string = layer.depth ?? 0;
            if (depthSource?.kind === 'dynamic-preserve') depthLabel = '保持';
            else if (depthSource?.parentLayerName) depthLabel = '继承';
            else if (layer.depthKeys?.length && parentChainVisible) {
              const depth = evaluateAnimationTrackAtTime({ keys: layer.depthKeys }, currentTimeMs);
              depthLabel = Number(depth.toFixed(2));
            }
            return <div key={layer.id} className="workbench-layer-row"
              data-layer-id={layer.id} data-layer-kind={type} data-selected={row.isSelected} data-hidden={row.isHidden}
              data-testid={"layer-list-row-" + layer.id} title={row.tooltip}
              onContextMenu={event => { event.preventDefault(); setMenuLayerId(layer.id); }}
              onDragOver={event => {
                if (!row.isBackground && event.dataTransfer.types.includes('application/x-panda-layer-order')) event.preventDefault();
              }}
              onDrop={event => {
                const payload = event.dataTransfer.getData('application/x-panda-layer-order');
                const source = movableRows.find(candidate =>
                  !candidate.isLocked && payload === JSON.stringify([dragScope, candidate.layer.id]),
                );
                if (!source || row.isBackground) return;
                event.preventDefault();
                execute(() => layerStore.reorder(source.layer.id, { toLayerId: layer.id }));
              }}>
              <input type="checkbox" aria-label={"勾选图层 " + layer.name} checked={batchSelectedLayerIds.includes(layer.id)}
                data-testid={"layer-batch-checkbox-" + layer.id} disabled={!editable}
                onChange={() => layerListUiStore.toggleBatchLayer(layer.id)} />
              {rename?.id === layer.id ? <input className="workbench-layer-name" aria-label="图层名称" ref={renameInput}
                value={rename.name} onChange={event => setRename({ id: layer.id, name: event.target.value })}
                onBlur={() => setRename(null)} onKeyDown={event => {
                  if (event.key === 'Escape') { event.preventDefault(); setRename(null); }
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    execute(() => { layerStore.rename(layer.id, rename.name); setRename(null); });
                  }
                }} /> : <button className="workbench-layer-name" aria-pressed={row.isSelected} type="button"
                title={layer.name + " · " + label} draggable={editable} onDragStart={event => {
                  event.dataTransfer.setData('application/x-panda-layer-order', JSON.stringify([dragScope, layer.id]));
                  event.dataTransfer.effectAllowed = 'move';
                }} onClick={() => selectLayerRow(layer.id, row.isBackground)}>
                <DecorativeIcon icon={icon} size={14} /> <span>{layer.name}</span>
              </button>}
              {parentChainVisible && <span className="workbench-layer-depth" title={row.activeParentName || "无父级"}>{depthLabel}</span>}
              {row.isDynamicBinding && <Clock size={12} aria-label="动态交接" />}
              {row.parentMissing && <AlertTriangle size={12} aria-label="父级缺失" />}
              <IconButton variant="secondary" aria-label={row.isHidden ? "显示图层" : "隐藏图层"} title={row.isHidden ? "显示图层" : "隐藏图层"}
                icon={<DecorativeIcon icon={row.isHidden ? EyeOff : Eye} />} disabled={row.isLocked || row.isBackground || row.isControl}
                onClick={() => execute(() => layerStore.setVisible(layer.id, row.isHidden))} />
              <IconButton variant="secondary" aria-label={row.isLocked ? "解锁图层" : "锁定图层"} title={row.isLocked ? "解锁图层" : "锁定图层"}
                icon={<DecorativeIcon icon={row.isLocked ? Lock : Unlock} />} disabled={row.isBackground}
                onClick={() => execute(() => layerStore.setLocked(layer.id, !row.isLocked))} />
              <Menu.Root open={menuLayerId === layer.id} onOpenChange={open => setMenuLayerId(open ? layer.id : null)}>
                <Menu.Trigger asChild><IconButton variant="secondary" aria-label={"图层操作 " + layer.name} title="图层操作"
                  icon={<DecorativeIcon icon={MoreHorizontal} />} /></Menu.Trigger>
                <Menu.Portal><Menu.Content className="workbench-menu" align="end" onCloseAutoFocus={event => {
                  if (renameFocus.current !== layer.id) return;
                  event.preventDefault();
                  renameFocus.current = null;
                  window.requestAnimationFrame(() => {
                    renameInput.current?.focus();
                    renameInput.current?.select();
                  });
                }}>
                  <Menu.Item disabled={!editable} onSelect={() => {
                    renameFocus.current = layer.id;
                    setRename({ id: layer.id, name: layer.name });
                  }}>重命名</Menu.Item>
                  <Menu.Item disabled={!editable || index === 0} onSelect={() => execute(() => layerStore.reorder(layer.id, 'forward'))}>上移一层</Menu.Item>
                  <Menu.Item disabled={!editable || index === movableRows.length - 1} onSelect={() => execute(() => layerStore.reorder(layer.id, 'backward'))}>下移一层</Menu.Item>
                  <Menu.Item disabled={!editable || index === 0} onSelect={() => execute(() => layerStore.reorder(layer.id, 'front'))}>置顶</Menu.Item>
                  <Menu.Item disabled={!editable || index === movableRows.length - 1} onSelect={() => execute(() => layerStore.reorder(layer.id, 'back'))}>置底</Menu.Item>
                  <Menu.Item disabled={row.isBackground} onSelect={() => { selectLayerRow(layer.id, false); onFocusParentBinding?.(layer.id); }}>父级属性</Menu.Item>
                  <Menu.Separator />
                  <Menu.Item disabled={!editable} onSelect={() => execute(() => layerStore.deleteLayer(layer.id, timelineUiStore.getSnapshot().currentTimeMs))}>删除图层</Menu.Item>
                </Menu.Content></Menu.Portal>
              </Menu.Root>
            </div>;
          })}
        </div>
      </div>
    </section>
  );
}
