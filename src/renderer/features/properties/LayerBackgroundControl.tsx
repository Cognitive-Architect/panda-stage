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
        ? '当前已有正式背景，请在此选择以管理锁定和变换。'
        : '请先在画布中选择普通图片图层。',
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
      message: '当前选择的图层已不可用，请重新选择。',
    };
  }
  if (shot.backgroundLayerId === layer.id) {
    return {
      ...management,
      state: 'background',
      canSet: false,
      message: layer.locked
        ? '已选择正式背景且已锁定，请在下方解锁后编辑。'
        : '已选择正式背景，可编辑变换；完成后请重新锁定。',
    };
  }
  if (layer.locked) {
    return {
      ...management,
      state: 'locked',
      canSet: false,
      message: '请先解锁图层，再将其设为正式背景。',
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
      message: '只有直接引用图片素材的图层才能设为正式背景。',
    };
  }
  return {
    ...management,
    state: 'available',
    canSet: true,
    message: '将此直接图片图层设为正式背景后，会应用 Cover 填充几何。',
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
      setStatus('已选择正式背景，可进行显式管理。');
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : '无法选择正式背景。',
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
        setStatus('该图层已设为正式背景，并默认锁定。');
      }
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : '无法设置正式背景。',
      );
    }
  };

  const clearBackground = (): void => {
    if (!model.canClear) return;
    try {
      layerStore.clearBackground();
      setStatus('已清除正式背景标识；该图层仍保留为普通图层。');
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : '无法清除正式背景。',
      );
    }
  };

  const fillBackground = (): void => {
    if (!model.canFill) return;
    try {
      layerStore.fillBackground();
      setStatus('已使用持久化的 Cover 几何修复背景。');
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : '无法填充画布。',
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
        <p className="eyebrow">正式背景</p>
        <h3>背景管理</h3>
        <strong data-testid="current-background-name">
          {model.backgroundLayer?.name ?? '未设置正式背景'}
        </strong>
      </div>
      <div className="layer-background-actions">
        <button
          aria-label="选择当前镜头背景"
          data-testid="select-current-shot-background"
          disabled={!model.canSelect}
          onClick={selectBackground}
          type="button"
        >
          {model.state === 'background'
            ? '已选择背景'
            : '选择背景'}
        </button>
        <button
          aria-label="将选择的图层设为当前镜头背景"
          className="layer-background-primary"
          data-testid="set-current-shot-background"
          disabled={!model.canSet}
          onClick={setAsBackground}
          type="button"
        >
          设为背景
        </button>
        <button
          aria-label="清除当前镜头背景标识"
          data-testid="clear-current-shot-background"
          disabled={!model.canClear}
          onClick={clearBackground}
          type="button"
        >
          清除背景
        </button>
        <button
          aria-label="将当前镜头背景填充到画布"
          data-testid="fill-current-shot-background"
          disabled={!model.canFill}
          onClick={fillBackground}
          type="button"
        >
          填充画布
        </button>
      </div>
      <p data-testid="layer-background-guidance">{status || model.message}</p>
    </section>
  );
}
