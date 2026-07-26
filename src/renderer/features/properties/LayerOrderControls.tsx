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
): boolean {
  return (
    Boolean(selectedLayerId) &&
    !event.defaultPrevented &&
    (event.key === 'Delete' || event.key === 'Backspace') &&
    !isEditableKeyboardTarget(event.target)
  );
}

export function LayerOrderControls(): React.JSX.Element {
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
      if (!shouldDeleteSelectedLayer(event, selectedLayerId)) return;
      event.preventDefault();
      deleteLayer();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const reorder = (action: LayerOrderAction): void => {
    if (!layer) return;
    try {
      layerStore.reorder(layer.id, action);
      setStatus('图层顺序已写入项目并同步画布。');
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : '图层排序失败。',
      );
    }
  };

  const disabled = !layer || layer.locked;
  return (
    <section
      className="layer-order-controls"
      data-testid="layer-order-controls"
    >
      <div>
        <p className="eyebrow">Day 23 layer order</p>
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
      <output data-testid="layer-order-status">{status}</output>
    </section>
  );
}
