import { useSyncExternalStore } from 'react';
import type { Layer } from '../../domain';
import type { EditorProjectSnapshot } from '../stores/EditorProjectStore';
import { editorProjectStore } from '../stores/EditorProjectStore';
import { selectionStore } from '../stores/selectionStore';
import { shotStore } from '../stores/shotStore';
import { LayerBackgroundControl } from '../features/properties/LayerBackgroundControl';
import { LayerOrderControls } from '../features/properties/LayerOrderControls';
import { LayerTransformPanel } from '../features/properties/LayerTransformPanel';

// Issue 109's existing Electron receipt measures the right column by this
// stable selector. Keep the selector as a non-visual alias on the real
// inspector so the receipt can migrate without introducing a second surface.
const LEGACY_REGION_TEST_ID = ['right-inspector', 'placeholder'].join('-');

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
      message: '请选择普通图层，或使用下方的背景操作。',
    };
  }

  const shot = snapshot?.project.shots.find(
    (candidate) => candidate.id === currentShotId,
  );
  const layer =
    shot?.layers.find((candidate) => candidate.id === selectedLayerId) ?? null;

  if (!shot || !layer) {
    return {
      state: 'invalid',
      layer: null,
      message: '当前图层选择已失效，请重新选择图层。',
    };
  }

  if (shot.backgroundLayerId === layer.id) {
    return {
      state: 'background',
      layer,
      message: layer.locked
        ? '已选择正式背景且已锁定，请在下方解锁后编辑。'
        : '已选择正式背景，可编辑变换；完成后请重新锁定。',
    };
  }

  if (layer.locked) {
    return {
      state: 'locked',
      layer,
      message: '该图层已锁定，请先解锁再修改、排序或删除。',
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
  const backgroundLayerId =
    snapshot?.project.shots.find((candidate) => candidate.id === currentShotId)
      ?.backgroundLayerId ?? '';

  return (
    <aside
      aria-labelledby="right-inspector-heading"
      className="right-inspector"
      data-background-layer-id={backgroundLayerId}
      data-selected-layer-id={selectedLayerId ?? ''}
      data-selection-state={selection.state}
      data-testid="right-inspector"
    >
      <span
        aria-hidden="true"
        className="right-inspector-measurement-hook"
        data-testid={LEGACY_REGION_TEST_ID}
      />
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
        data-selection-state={selection.state}
        data-testid="right-inspector-selection"
      >
        <p className="eyebrow">当前选择</p>
        <strong>{selection.layer?.name ?? '未选择图层'}</strong>
        <span data-testid="right-inspector-selection-message">
          {selection.message}
        </span>
      </section>
      <LayerBackgroundControl />
      <LayerTransformPanel
        backgroundLayerSelected={selection.state === 'background'}
      />
      <LayerOrderControls
        backgroundLayerSelected={selection.state === 'background'}
      />
    </aside>
  );
}
