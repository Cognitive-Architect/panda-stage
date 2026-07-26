import {
  useEffect,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from 'react';
import {
  LAYER_MAX_SCALE,
  LAYER_MIN_SCALE,
  type LayerTransformInput,
} from '../../../domain';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { layerStore } from '../../stores/layerStore';
import { selectionStore } from '../../stores/selectionStore';
import { shotStore } from '../../stores/shotStore';

export interface LayerTransformDraft {
  x: string;
  y: string;
  scale: string;
  rotationDeg: string;
  opacity: string;
}

export function parseLayerTransformDraft(
  draft: LayerTransformDraft,
  flipX: boolean,
): LayerTransformInput {
  const entries = Object.entries(draft);
  if (entries.some(([, value]) => !value.trim())) {
    throw new Error('变换数值不能为空。');
  }
  const values = Object.fromEntries(
    entries.map(([key, value]) => [key, Number(value)]),
  ) as Record<keyof LayerTransformDraft, number>;
  if (Object.values(values).some((value) => !Number.isFinite(value))) {
    throw new Error('变换数值必须是有限数字。');
  }
  if (
    values.scale < LAYER_MIN_SCALE ||
    values.scale > LAYER_MAX_SCALE
  ) {
    throw new Error(
      `缩放必须在 ${LAYER_MIN_SCALE}–${LAYER_MAX_SCALE} 之间。`,
    );
  }
  if (values.opacity < 0 || values.opacity > 1) {
    throw new Error('不透明度必须在 0–1 之间。');
  }
  return {
    x: values.x,
    y: values.y,
    scale: values.scale,
    rotationDeg: values.rotationDeg,
    opacity: values.opacity,
    flipX,
  };
}

const EMPTY_DRAFT: LayerTransformDraft = {
  x: '',
  y: '',
  scale: '',
  rotationDeg: '',
  opacity: '',
};

export function LayerTransformPanel(): React.JSX.Element {
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
  const [draft, setDraft] = useState<LayerTransformDraft>(EMPTY_DRAFT);
  const [status, setStatus] = useState(
    '选择普通图层后可编辑中心位置与静态变换。',
  );

  useEffect(() => {
    setDraft(
      layer
        ? {
            x: String(layer.x),
            y: String(layer.y),
            scale: String(layer.scaleX),
            rotationDeg: String(layer.rotationDeg),
            opacity: String(layer.opacity),
          }
        : EMPTY_DRAFT,
    );
    setStatus(
      layer
        ? layer.locked
          ? '图层已锁定；请先解锁再修改。'
          : 'X/Y 始终表示视觉中心；缩放保持等比。'
        : '选择普通图层后可编辑中心位置与静态变换。',
    );
  }, [layer]);

  const updateDraft = (
    key: keyof LayerTransformDraft,
    value: string,
  ): void => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (!layer) return;
    try {
      const transform = parseLayerTransformDraft(draft, layer.flipX);
      layerStore.updateTransform(layer.id, transform);
      setStatus('图层变换已写入项目。');
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : '图层变换失败。',
      );
    }
  };

  return (
    <section
      className="layer-transform-panel"
      data-selected-layer-id={selectedLayerId ?? ''}
      data-testid="layer-transform-panel"
    >
      <div>
        <p className="eyebrow">Day 23 layer transform</p>
        <h3>图层变换</h3>
      </div>
      {layer ? (
        <form onSubmit={submit}>
          <strong>{layer.name}</strong>
          {(
            [
              ['x', 'X（中心）'],
              ['y', 'Y（中心）'],
              ['scale', '等比缩放'],
              ['rotationDeg', '旋转（°）'],
              ['opacity', '不透明度'],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                disabled={layer.locked}
                inputMode="decimal"
                onChange={(event) =>
                  updateDraft(key, event.target.value)
                }
                value={draft[key]}
              />
            </label>
          ))}
          <button
            disabled={layer.locked}
            onClick={() => {
              try {
                layerStore.toggleFlipX(layer.id);
                setStatus('水平翻转已切换，中心坐标保持不变。');
              } catch (error) {
                setStatus(
                  error instanceof Error
                    ? error.message
                    : '水平翻转失败。',
                );
              }
            }}
            type="button"
          >
            {layer.flipX ? '取消水平翻转' : '水平翻转'}
          </button>
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
            锁定图层
          </label>
          <button disabled={layer.locked} type="submit">
            应用变换
          </button>
        </form>
      ) : (
        <p>未选择普通图层。</p>
      )}
      <output data-testid="layer-transform-status">{status}</output>
    </section>
  );
}
