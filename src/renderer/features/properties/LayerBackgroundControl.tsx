import { useState, useSyncExternalStore } from 'react';
import type { Layer } from '../../../domain';
import type { EditorProjectSnapshot } from '../../stores/EditorProjectStore';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { layerStore } from '../../stores/layerStore';
import { selectionStore } from '../../stores/selectionStore';
import { shotStore } from '../../stores/shotStore';

export type LayerBackgroundControlState =
  | 'empty'
  | 'invalid'
  | 'background'
  | 'available'
  | 'unsupported'
  | 'locked';

export interface LayerBackgroundControlModel {
  state: LayerBackgroundControlState;
  canSet: boolean;
  canSelect: boolean;
  canClear: boolean;
  canFill: boolean;
  backgroundLayer: Layer | null;
  message: string;
}

export function getLayerBackgroundControlModel(
  snapshot: EditorProjectSnapshot | null,
  currentShotId: string | null,
  selectedLayerId: string | null,
): LayerBackgroundControlModel {
  const shot = snapshot?.project.shots.find(
    (candidate) => candidate.id === currentShotId,
  );
  const backgroundLayer =
    shot?.layers.find(
      (candidate) => candidate.id === shot.backgroundLayerId,
    ) ?? null;
  const management = {
    canSelect: Boolean(backgroundLayer),
    canClear: Boolean(backgroundLayer),
    canFill: Boolean(backgroundLayer),
    backgroundLayer,
  };

  if (!selectedLayerId) {
    return {
      ...management,
      state: 'empty',
      canSet: false,
      message: backgroundLayer
        ? '当前镜头已有正式背景，可通过入口选择、解锁、编辑或取消身份。'
        : '请先在画布选择普通图片图层。',
    };
  }

  const layer = shot?.layers.find(
    (candidate) => candidate.id === selectedLayerId,
  );
  if (!shot || !layer) {
    return {
      ...management,
      state: 'invalid',
      canSet: false,
      message: '当前图层选择已失效，请重新选择普通图片图层。',
    };
  }
  if (shot.backgroundLayerId === layer.id) {
    return {
      ...management,
      state: 'background',
      canSet: false,
      message: layer.locked
        ? '当前镜头背景已选择并锁定；点击解锁后可编辑。'
        : '当前镜头背景已进入管理状态；完成编辑后可重新锁定。',
    };
  }
  if (layer.locked) {
    return {
      ...management,
      state: 'locked',
      canSet: false,
      message: '图层已锁定，请先解锁后再设为镜头背景。',
    };
  }
  const assetId =
    layer.source.kind === 'asset' ? layer.source.assetId : undefined;
  const asset = assetId
    ? snapshot?.project.assets.find((candidate) => candidate.id === assetId)
    : undefined;
  if (!asset || asset.kind !== 'image') {
    return {
      ...management,
      state: 'unsupported',
      canSet: false,
      message: '只有直接引用图片素材的普通图层可以设为镜头背景。',
    };
  }
  return {
    ...management,
    state: 'available',
    canSet: true,
    message: '拖入画布仍会创建普通图层；点击按钮后才会绑定为正式背景。',
  };
}

export function LayerBackgroundControl(): React.JSX.Element {
  const snapshot = useSyncExternalStore(
    editorProjectStore.subscribe,
    editorProjectStore.getSnapshot,
  );
  const currentShotId = useSyncExternalStore(
    shotStore.subscribe,
    shotStore.getCurrentShotId,
  );
  const selectedLayerId = useSyncExternalStore(
    selectionStore.subscribe,
    selectionStore.getSelectedLayerId,
  );
  const model = getLayerBackgroundControlModel(
    snapshot,
    currentShotId,
    selectedLayerId,
  );
  const [status, setStatus] = useState('');

  const selectBackground = (): void => {
    if (!model.canSelect) return;
    try {
      selectionStore.selectBackground();
      setStatus('已选择当前镜头背景；普通画布命中仍保持关闭。');
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : '选择当前镜头背景失败。',
      );
    }
  };

  const setAsBackground = (): void => {
    if (!selectedLayerId || !model.canSet) return;
    try {
      const next = layerStore.setBackground(selectedLayerId);
      const nextShot = next.shots.find(
        (candidate) => candidate.id === currentShotId,
      );
      if (nextShot?.backgroundLayerId === selectedLayerId) {
        selectionStore.selectBackground();
        setStatus('已将该图层设为当前镜头背景，并默认锁定。');
      }
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : '设置镜头背景失败。',
      );
    }
  };

  const clearBackground = (): void => {
    if (!model.canClear) return;
    try {
      layerStore.clearBackground();
      setStatus('已取消正式背景身份；原图层保留为普通图层。');
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : '取消镜头背景失败。',
      );
    }
  };

  const fillBackground = (): void => {
    if (!model.canFill) return;
    try {
      layerStore.fillBackground();
      setStatus('已按 Cover 规则填满当前逻辑画布；该操作可撤销或重做。');
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : '填满画布失败。',
      );
    }
  };

  return (
    <section
      className="layer-background-control"
      data-background-control-state={model.state}
      data-background-layer-id={model.backgroundLayer?.id ?? ''}
      data-background-locked={String(model.backgroundLayer?.locked ?? false)}
      data-testid="layer-background-control"
    >
      <div>
        <p className="eyebrow">镜头背景</p>
        <h3>正式背景管理</h3>
        <strong data-testid="current-background-name">
          {model.backgroundLayer?.name ?? '未设置正式背景'}
        </strong>
      </div>
      <div className="layer-background-actions">
        <button
          aria-label="选择或定位当前镜头背景"
          data-testid="select-current-shot-background"
          disabled={!model.canSelect}
          onClick={selectBackground}
          type="button"
        >
          {model.state === 'background'
            ? '已选择当前背景'
            : '选择/定位当前背景'}
        </button>
        <button
          aria-label="设为当前镜头背景"
          data-testid="set-current-shot-background"
          disabled={!model.canSet}
          onClick={setAsBackground}
          type="button"
        >
          设为当前镜头背景
        </button>
        <button
          aria-label="取消当前镜头背景身份"
          data-testid="clear-current-shot-background"
          disabled={!model.canClear}
          onClick={clearBackground}
          type="button"
        >
          取消背景身份
        </button>
        <button
          aria-label="填满当前镜头背景画布"
          data-testid="fill-current-shot-background"
          disabled={!model.canFill}
          onClick={fillBackground}
          type="button"
        >
          填满画布
        </button>
      </div>
      <p data-testid="layer-background-guidance">
        {status || model.message}
      </p>
    </section>
  );
}
