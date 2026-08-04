import { useState, useSyncExternalStore } from 'react';
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
  message: string;
}

export function getLayerBackgroundControlModel(
  snapshot: EditorProjectSnapshot | null,
  currentShotId: string | null,
  selectedLayerId: string | null,
): LayerBackgroundControlModel {
  if (!selectedLayerId) {
    return {
      state: 'empty',
      canSet: false,
      message: '请先在画布选择普通图片图层。',
    };
  }

  const shot = snapshot?.project.shots.find(
    (candidate) => candidate.id === currentShotId,
  );
  const layer = shot?.layers.find(
    (candidate) => candidate.id === selectedLayerId,
  );
  if (!shot || !layer) {
    return {
      state: 'invalid',
      canSet: false,
      message: '当前图层选择已失效，请重新选择普通图片图层。',
    };
  }
  if (shot.backgroundLayerId === layer.id) {
    return {
      state: 'background',
      canSet: false,
      message: '该图层已经是当前镜头背景。',
    };
  }
  if (layer.locked) {
    return {
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
      state: 'unsupported',
      canSet: false,
      message: '只有直接引用图片素材的普通图层可以设为镜头背景。',
    };
  }
  return {
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

  const setAsBackground = (): void => {
    if (!selectedLayerId || !model.canSet) return;
    try {
      const next = layerStore.setBackground(selectedLayerId);
      const nextShot = next.shots.find(
        (candidate) => candidate.id === currentShotId,
      );
      if (nextShot?.backgroundLayerId === selectedLayerId) {
        selectionStore.clear();
        setStatus('已将该图层设为当前镜头背景。');
      }
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : '设置镜头背景失败。',
      );
    }
  };

  return (
    <section
      className="layer-background-control"
      data-background-control-state={model.state}
      data-testid="layer-background-control"
    >
      <div>
        <p className="eyebrow">镜头背景</p>
        <h3>正式背景绑定</h3>
      </div>
      <button
        aria-label="设为当前镜头背景"
        data-testid="set-current-shot-background"
        disabled={!model.canSet}
        onClick={setAsBackground}
        type="button"
      >
        {model.state === 'background' ? '当前镜头背景' : '设为当前镜头背景'}
      </button>
      <p data-testid="layer-background-guidance">
        {status || model.message}
      </p>
    </section>
  );
}
