import { useMemo, useState } from 'react';
import { validLayerParentTargets, type Layer, type Shot } from '../../../domain';
import { layerStore } from '../../stores/layerStore';
import { timelineUiStore } from '../timeline/timelineUiStore';

export function LayerParentControl({ layer, shot }: { layer: Layer; shot: Shot }): React.JSX.Element | null {
  const [error, setError] = useState('');
  const targets = useMemo(() => validLayerParentTargets(shot, layer.id), [shot, layer.id]);
  const parentId = layer.parentLayerId;
  if (shot.backgroundLayerId === layer.id) return null;
  return <div>
    {(parentId || targets.length > 0) && <label>父级图层{' '}
      <select aria-label="父级图层" value={parentId ?? ''} disabled={layer.locked} onChange={(event) => {
        try {
          layerStore.setParent(layer.id, event.currentTarget.value || null, timelineUiStore.getSnapshot().currentTimeMs);
          setError('');
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : '无法设置父级图层。');
        }
      }}>
        <option value="">无</option>
        {parentId && !targets.some(({ id }) => id === parentId) && <option value={parentId} disabled>失效的父级图层</option>}
        {targets.map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}
      </select>
    </label>}
    {!parentId && <label>
      <input type="checkbox" checked={layer.cameraSpace === 'screen'} disabled={layer.locked}
        onChange={(event) => {
          try {
            layerStore.setCameraAttachment(layer.id, event.currentTarget.checked);
            setError('');
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : '无法切换相机附着。');
          }
        }} />
      附着到相机
    </label>}
    {error && <div role="alert">{error}</div>}
  </div>;
}
