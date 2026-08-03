import {
  useEffect,
  useState,
  useSyncExternalStore,
} from 'react';
import type { LayerOrderAction } from '../../../domain';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { layerStore } from '../../stores/layerStore';
import { selectionStore } from '../../stores/selectionStore';
import { shotStore } from '../../stores/shotStore';

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
  /** The RightInspector owns this identity when the panel is mounted there. */
  backgroundLayerSelected?: boolean;
}

export function LayerOrderControls({
  backgroundLayerSelected,
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
  const [status, setStatus] = useState(
    '层级操作只影响当前镜头中的普通图层。',
  );
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
      setStatus('背景层不能通过普通图层层级工具排序或删除。');
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
      setStatus('背景层不能通过普通图层层级工具排序或删除。');
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

  const disabled = !layer || layer.locked || isBackgroundLayer;
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
      <p data-testid="layer-order-guidance">
        {isBackgroundLayer
          ? '背景层不能通过普通图层层级工具排序或删除。'
          : layer?.locked
            ? '图层已锁定，请先解锁后再调整层级或删除。'
          : layer
            ? '层级操作只影响当前镜头中的普通图层。'
            : '请先在画布选择普通图层。'}
      </p>
      <output data-testid="layer-order-status">{status}</output>
    </section>
  );
}
