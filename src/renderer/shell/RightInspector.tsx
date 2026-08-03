import { useSyncExternalStore } from 'react';
import type { Layer } from '../../domain';
import type { EditorProjectSnapshot } from '../stores/EditorProjectStore';
import { editorProjectStore } from '../stores/EditorProjectStore';
import { selectionStore } from '../stores/selectionStore';
import { shotStore } from '../stores/shotStore';
import { LayerOrderControls } from '../features/properties/LayerOrderControls';
import { LayerTransformPanel } from '../features/properties/LayerTransformPanel';

export type RightInspectorSelectionState =
  | 'empty'
  | 'invalid'
  | 'background'
  | 'selected'
  | 'locked';

export interface RightInspectorSelection {
  state: RightInspectorSelectionState;
  layer: Layer | null;
  message: string;
}

export function getRightInspectorSelection(
  snapshot: EditorProjectSnapshot | null,
  currentShotId: string | null,
  selectedLayerId: string | null,
): RightInspectorSelection {
  if (!selectedLayerId) {
    return {
      state: 'empty',
      layer: null,
      message: '请先在画布选择普通图层。',
    };
  }

  const shot = snapshot?.project.shots.find(
    (candidate) => candidate.id === currentShotId,
  );
  const layer = shot?.layers.find(
    (candidate) => candidate.id === selectedLayerId,
  ) ?? null;

  if (!shot || !layer) {
    return {
      state: 'invalid',
      layer: null,
      message: '当前图层选择已失效，请重新选择普通图层。',
    };
  }

  if (shot.backgroundLayerId === layer.id) {
    return {
      state: 'background',
      layer,
      message: '背景层不可执行普通图层操作。',
    };
  }

  if (layer.locked) {
    return {
      state: 'locked',
      layer,
      message: '图层已锁定，请先解锁后再变换、排序或删除。',
    };
  }

  return {
    state: 'selected',
    layer,
    message: `已选择图层：${layer.name}`,
  };
}

export function RightInspector(): React.JSX.Element {
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
  const selection = getRightInspectorSelection(
    snapshot,
    currentShotId,
    selectedLayerId,
  );

  return (
    <aside
      aria-labelledby="right-inspector-heading"
      className="right-inspector"
      data-selected-layer-id={selectedLayerId ?? ''}
      data-selection-state={selection.state}
      data-testid="right-inspector"
    >
      <div className="right-inspector-heading">
        <div>
          <p className="eyebrow">右侧检查器</p>
          <h2 id="right-inspector-heading">图层检查器</h2>
        </div>
        <span>当前镜头</span>
      </div>
      <section
        aria-live="polite"
        className="right-inspector-selection"
        data-testid="right-inspector-selection"
      >
        <p className="eyebrow">当前选择</p>
        <strong>{selection.layer?.name ?? '未选择图层'}</strong>
        <span data-testid="right-inspector-selection-message">
          {selection.message}
        </span>
      </section>
      <LayerTransformPanel />
      <LayerOrderControls />
    </aside>
  );
}
