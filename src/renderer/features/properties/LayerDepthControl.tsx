import { useState } from 'react';
import {
  canEditLayerDepth, evaluateShotAtTime, LAYER_DEPTH_MAX, LAYER_DEPTH_MIN,
  setLayerDepth, setLayerDepthKey, type Layer, type Shot,
} from '../../../domain';
import { editorProjectStore, type EditorProjectSnapshot } from '../../stores/EditorProjectStore';
import { shotStore } from '../../stores/shotStore';
import { timelineUiStore, useTimelineUi } from '../timeline/timelineUiStore';

export function LayerDepthControl({ layer, shot, snapshot }: {
  layer: Layer;
  shot: Shot;
  snapshot: EditorProjectSnapshot;
}): React.JSX.Element {
  const { currentTimeMs } = useTimelineUi();
  const [error, setError] = useState('');
  const hasKeys = Boolean(layer.depthKeys?.length);
  const evaluatedDepth = evaluateShotAtTime(shot, currentTimeMs, snapshot.project)
    .layers.find(({ id }) => id === layer.id)?.effectiveDepth ?? 0;
  const value = hasKeys ? Number(evaluatedDepth.toFixed(2)) : layer.depth ?? '';
  return <div>
    <label>图层深度{' '}
      <input type="number" aria-label="图层深度" key={`${snapshot.revision}:${currentTimeMs}`}
        min={LAYER_DEPTH_MIN} max={LAYER_DEPTH_MAX} step="any" defaultValue={value}
        placeholder={String(Number(evaluatedDepth.toFixed(2)))} disabled={!canEditLayerDepth(layer, shot)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            event.currentTarget.value = String(value);
            event.currentTarget.blur();
          }
        }}
        onBlur={(event) => {
          const input = event.currentTarget;
          if (input.value === String(value)) return;
          if (editorProjectStore.getSnapshot() !== snapshot || shotStore.getCurrentShotId() !== shot.id ||
              timelineUiStore.getSnapshot().currentTimeMs !== currentTimeMs) return;
          try {
            const depth = input.value === '' ? undefined : input.valueAsNumber;
            if (!input.validity.valid || (hasKeys && depth === undefined)) {
              throw new Error('请输入范围内的深度数值。');
            }
            const next = hasKeys
              ? setLayerDepthKey(snapshot.project, shot.id, layer.id, currentTimeMs, depth)
              : setLayerDepth(snapshot.project, shot.id, layer.id, depth);
            if (next !== snapshot.project) editorProjectStore.updateProject(next, '设置图层深度');
            setError('');
          } catch (cause) {
            input.value = String(value);
            setError(cause instanceof Error ? cause.message : '无法设置图层深度。');
          }
        }} />
    </label>
    {error && <div role="alert">{error}</div>}
  </div>;
}
