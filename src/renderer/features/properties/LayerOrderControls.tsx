import {
  useEffect,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  ArrowDown,
  ArrowUp,
  BringToFront,
  Lock,
  SendToBack,
  ShieldCheck,
  Trash2,
  Unlock,
} from 'lucide-react';
import type { LayerOrderAction } from '../../../domain';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { layerStore } from '../../stores/layerStore';
import { selectionStore } from '../../stores/selectionStore';
import { shotStore } from '../../stores/shotStore';
import { DecorativeIcon } from '../../ui';

export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  return (
    typeof HTMLElement !== 'undefined' &&
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

export function shouldDeleteSelectedLayer(
  event: Pick<KeyboardEvent, 'key' | 'target' | 'defaultPrevented'>,
  selectedLayerId: string | null,
  backgroundLayerSelected = false,
): boolean {
  return (
    Boolean(selectedLayerId) &&
    !backgroundLayerSelected &&
    !event.defaultPrevented &&
    (event.key === 'Delete' || event.key === 'Backspace') &&
    !isEditableKeyboardTarget(event.target)
  );
}

export interface LayerOrderControlsProps {
  compact?: boolean;
  backgroundLayerSelected?: boolean;
  showLockControl?: boolean;
}

export function formatLayerOrderPosition(
  orderIndex: number,
  total: number,
  protectedLayer = false,
): string {
  return !protectedLayer && orderIndex >= 0 && total > 0
    ? `${orderIndex + 1} / ${total}`
    : '';
}

export function LayerOrderControls({
  compact = false,
  backgroundLayerSelected,
  showLockControl = false,
}: LayerOrderControlsProps = {}): React.JSX.Element {
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
  const shot =
    snapshot?.project.shots.find((candidate) => candidate.id === shotId) ??
    null;
  const layer =
    shot?.layers.find((candidate) => candidate.id === selectedLayerId) ??
    null;
  const isBackgroundLayer =
    Boolean(backgroundLayerSelected) ||
    Boolean(shot && layer && shot.backgroundLayerId === layer.id);
  const [status, setStatus] = useState('');
  const orderedContent =
    shot?.layers
      .filter((candidate) => candidate.id !== shot.backgroundLayerId)
      .sort((left, right) => left.zIndex - right.zIndex) ?? [];
  const orderIndex = layer
    ? orderedContent.findIndex((candidate) => candidate.id === layer.id)
    : -1;

  const deleteLayer = (): void => {
    if (!layer) return;
    if (isBackgroundLayer) {
      setStatus('正式背景不能在此进行排序或删除。');
      return;
    }
    try {
      layerStore.deleteLayer(layer.id);
      selectionStore.clear();
      setStatus(`已删除图层“${layer.name}”并清理选择。`);
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : '图层删除失败。',
      );
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (
        !shouldDeleteSelectedLayer(
          event,
          selectedLayerId,
          isBackgroundLayer,
        )
      ) {
        return;
      }
      event.preventDefault();
      deleteLayer();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const reorder = (action: LayerOrderAction): void => {
    if (!layer) return;
    if (isBackgroundLayer) {
      setStatus('正式背景不能在此进行排序或删除。');
      return;
    }
    try {
      layerStore.reorder(layer.id, action);
      setStatus('图层顺序已写入项目并同步画布。');
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : '图层排序失败。',
      );
    }
  };

  const setLock = (locked: boolean): void => {
    if (!layer) return;
    try {
      layerStore.setLocked(layer.id, locked);
      setStatus(locked ? '图层已锁定。' : '图层已解锁。');
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : '锁定状态更新失败。',
      );
    }
  };

  const disabled = !layer || layer.locked || isBackgroundLayer;
  const orderPosition = formatLayerOrderPosition(
    orderIndex,
    orderedContent.length,
    isBackgroundLayer,
  );
  const orderingDisabled = disabled || orderIndex < 0;

  if (compact) {
    return (
      <section
        className="layer-order-controls"
        data-background-protected={String(isBackgroundLayer)}
        data-compact="true"
        data-testid="layer-order-controls"
      >
        {isBackgroundLayer ? (
          <div
            className="layer-order-protected-state"
            data-testid="layer-order-protected-state"
          >
            <div className="layer-order-protected-heading">
              <DecorativeIcon icon={ShieldCheck} size={18} />
              <strong>正式背景受到保护</strong>
            </div>
            <p data-testid="layer-order-guidance">
              正式背景不参与普通图层排序，也不能在此处删除。请前往「外观 →
              画布背景」管理。
            </p>
          </div>
        ) : !layer ? (
          <div className="layer-order-empty-state">
            <p data-testid="layer-order-guidance">
              请先在画布中选择普通图层。
            </p>
          </div>
        ) : (
          <>
            <div className="layer-order-compact-heading">
              <div>
                <p className="eyebrow">层级顺序</p>
                <h3>层级顺序</h3>
              </div>
              {orderPosition ? (
                <span
                  className="layer-order-position"
                  data-testid="layer-order-position"
                >
                  <span aria-hidden="true">◫</span> {orderPosition}
                </span>
              ) : null}
            </div>
            {!layer.locked ? (
              <p className="layer-order-compact-help">
                调整当前对象在镜头中的前后关系
              </p>
            ) : null}
            <div className="layer-order-actions">
              <button
                aria-label="上移"
                disabled={
                  orderingDisabled || orderIndex >= orderedContent.length - 1
                }
                onClick={() => reorder('forward')}
                type="button"
              >
                <span className="ui-icon-label">
                  <DecorativeIcon icon={ArrowUp} size={16} />
                  <span>上移</span>
                </span>
              </button>
              <button
                aria-label="下移"
                disabled={orderingDisabled || orderIndex <= 0}
                onClick={() => reorder('backward')}
                type="button"
              >
                <span className="ui-icon-label">
                  <DecorativeIcon icon={ArrowDown} size={16} />
                  <span>下移</span>
                </span>
              </button>
              <button
                aria-label="置顶"
                disabled={
                  orderingDisabled || orderIndex >= orderedContent.length - 1
                }
                onClick={() => reorder('front')}
                type="button"
              >
                <span className="ui-icon-label">
                  <DecorativeIcon icon={BringToFront} size={16} />
                  <span>置顶</span>
                </span>
              </button>
              <button
                aria-label="置底"
                disabled={orderingDisabled || orderIndex <= 0}
                onClick={() => reorder('back')}
                type="button"
              >
                <span className="ui-icon-label">
                  <DecorativeIcon icon={SendToBack} size={16} />
                  <span>置底</span>
                </span>
              </button>
            </div>

            <div className="layer-order-state">
              <p className="layer-order-subheading">图层状态</p>
              <div className="layer-lock-state">
                <button
                  aria-checked={Boolean(layer?.locked)}
                  aria-describedby="layer-lock-state-help"
                  aria-label={layer?.locked ? '图层已锁定' : '锁定图层'}
                  className="layer-lock-switch"
                  disabled={!layer}
                  onClick={() => setLock(!layer?.locked)}
                  onKeyDown={(event) => {
                    if (event.key === 'Delete' || event.key === 'Backspace') {
                      event.preventDefault();
                    }
                  }}
                  role="switch"
                  type="button"
                >
                  <span className="layer-lock-switch-label">
                    <DecorativeIcon
                      icon={layer?.locked ? Lock : Unlock}
                      size={18}
                    />
                    <span>{layer?.locked ? '图层已锁定' : '锁定图层'}</span>
                  </span>
                  <span
                    aria-hidden="true"
                    className="layer-lock-switch-value"
                  >
                    {layer?.locked ? 'ON' : 'OFF'}
                  </span>
                </button>
                <p id="layer-lock-state-help">
                  {layer?.locked
                    ? '排序与删除暂不可用。'
                    : '锁定后不可排序或删除。'}
                </p>
              </div>
            </div>

            <div className="layer-order-danger-zone">
              <div className="layer-order-danger-copy">
                <p className="layer-order-subheading">危险操作</p>
                <strong>删除当前图层</strong>
                <span>此操作会从当前镜头中移除此图层。</span>
              </div>
              <button
                aria-label="删除图层"
                className="layer-delete-button"
                disabled={disabled}
                onClick={deleteLayer}
                type="button"
              >
                <span className="ui-icon-label">
                  <DecorativeIcon icon={Trash2} size={16} />
                  <span>删除图层</span>
                </span>
              </button>
            </div>
            <p data-testid="layer-order-guidance">
              {layer?.locked
                ? '排序与删除暂不可用。'
                : layer
                  ? '排序操作会影响当前镜头中的普通图层。'
                  : '请先在画布中选择普通图层。'}
            </p>
          </>
        )}
        <output data-testid="layer-order-status">{status}</output>
      </section>
    );
  }

  return (
    <section
      className="layer-order-controls"
      data-background-protected={String(isBackgroundLayer)}
      data-testid="layer-order-controls"
    >
      <div>
        <p className="eyebrow">图层顺序</p>
        <h3>层级与删除</h3>
      </div>
      <div className="layer-order-actions">
        <button
          disabled={disabled || orderIndex >= orderedContent.length - 1}
          onClick={() => reorder('forward')}
          type="button"
        >
          上移
        </button>
        <button
          disabled={disabled || orderIndex <= 0}
          onClick={() => reorder('backward')}
          type="button"
        >
          下移
        </button>
        <button
          disabled={disabled || orderIndex >= orderedContent.length - 1}
          onClick={() => reorder('front')}
          type="button"
        >
          置顶
        </button>
        <button
          disabled={disabled || orderIndex <= 0}
          onClick={() => reorder('back')}
          type="button"
        >
          置底
        </button>
        <button
          className="layer-delete-button"
          disabled={disabled}
          onClick={deleteLayer}
          type="button"
        >
          删除图层
        </button>
      </div>
      {showLockControl ? (
        <label className="layer-lock-control">
          <input
            checked={Boolean(layer?.locked)}
            disabled={!layer}
            onChange={(event) => setLock(event.target.checked)}
            type="checkbox"
          />
          锁定图层
        </label>
      ) : null}
      <p data-testid="layer-order-guidance">
        {isBackgroundLayer
          ? '正式背景受到保护，不能执行普通排序或删除操作。'
          : layer?.locked
            ? '请先解锁图层，再修改顺序或删除。'
            : layer
              ? '排序操作会影响当前镜头中的普通图层。'
              : '请先在画布中选择普通图层。'}
      </p>
      <output data-testid="layer-order-status">{status}</output>
    </section>
  );
}
