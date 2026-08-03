import {
  useEffect,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from 'react';
import type { Point } from '../../../domain';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { layerStore } from '../../stores/layerStore';
import { selectionStore } from '../../stores/selectionStore';
import { shotStore } from '../../stores/shotStore';

export function parseLayerPositionDraft(
  xDraft: string,
  yDraft: string,
): Point {
  if (!xDraft.trim() || !yDraft.trim()) {
    throw new Error('X 和 Y 坐标不能为空。');
  }
  const point = {
    x: Number(xDraft),
    y: Number(yDraft),
  };
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new Error('X 和 Y 坐标必须是有限数字。');
  }
  return point;
}

export function LayerPositionPanel(): React.JSX.Element {
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
  const layer =
    snapshot?.project.shots
      .find((shot) => shot.id === shotId)
      ?.layers.find((candidate) => candidate.id === selectedLayerId) ??
    null;
  const [xDraft, setXDraft] = useState('');
  const [yDraft, setYDraft] = useState('');
  const [status, setStatus] = useState(
    '选择普通图层后可编辑中心坐标。',
  );

  useEffect(() => {
    setXDraft(layer ? String(layer.x) : '');
    setYDraft(layer ? String(layer.y) : '');
    setStatus(
      layer
        ? layer.locked
          ? '图层已锁定；请先解锁再修改位置。'
          : '坐标表示图层中心点。'
        : '选择普通图层后可编辑中心坐标。',
    );
  }, [layer]);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (!layer) return;
    try {
      const point = parseLayerPositionDraft(xDraft, yDraft);
      layerStore.updatePosition(layer.id, point);
      setStatus(`位置已更新为 (${point.x}, ${point.y})。`);
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : '位置更新失败。',
      );
    }
  };

  return (
    <section
      className="layer-position-panel"
      data-selected-layer-id={selectedLayerId ?? ''}
      data-testid="layer-position-panel"
    >
      <div>
        <p className="eyebrow">图层属性</p>
        <h3>图层位置</h3>
      </div>
      {layer ? (
        <form onSubmit={submit}>
          <strong>{layer.name}</strong>
          <label>
            X（中心）
            <input
              disabled={layer.locked}
              inputMode="decimal"
              onChange={(event) => setXDraft(event.target.value)}
              value={xDraft}
            />
          </label>
          <label>
            Y（中心）
            <input
              disabled={layer.locked}
              inputMode="decimal"
              onChange={(event) => setYDraft(event.target.value)}
              value={yDraft}
            />
          </label>
          <label className="layer-lock-control">
            <input
              checked={layer.locked}
              onChange={(event) => {
                try {
                  layerStore.setLocked(
                    layer.id,
                    event.target.checked,
                  );
                } catch (error) {
                  setStatus(
                    error instanceof Error
                      ? error.message
                      : '锁定状态更新失败。',
                  );
                }
              }}
              type="checkbox"
            />
            锁定位置
          </label>
          <button disabled={layer.locked} type="submit">
            应用位置
          </button>
        </form>
      ) : (
        <p>未选择图层。点击画布中的普通图层进行选择。</p>
      )}
      <output data-testid="layer-position-status">{status}</output>
    </section>
  );
}
