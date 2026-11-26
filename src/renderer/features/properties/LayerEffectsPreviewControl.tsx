import { useContext, useEffect, useRef, useState } from 'react';
import {
  defaultLayerVisualEffects, hasLayerVisualEffects, LayerVisualEffectsSchema, type LayerVisualEffects,
} from '../../../domain/models/layerVisualEffects';
import type { Layer } from '../../../domain';
import { editorProjectStore, type EditorProjectSnapshot } from '../../stores/EditorProjectStore';
import { selectionStore } from '../../stores/selectionStore';
import { shotStore } from '../../stores/shotStore';
import { Button } from '../../ui';
import { LayerEffectPreviewDispatch } from '../../stage/LayerEffectPreview';

const blendLabels: Record<LayerVisualEffects['blend'], string> = {
  normal: '正常', multiply: '正片叠底', screen: '滤色', add: '相加',
};

export function LayerEffectsPreviewControl({ snapshot, shotId, layer }: {
  snapshot: EditorProjectSnapshot;
  shotId: string;
  layer: Layer;
}): React.JSX.Element | null {
  const dispatch = useContext(LayerEffectPreviewDispatch);
  const [effects, setEffects] = useState(defaultLayerVisualEffects);
  const [previewRevision, setPreviewRevision] = useState<number>();
  const showing = previewRevision === snapshot.revision;
  const active = useRef(false);
  const instance = editorProjectStore.getProjectInstanceId();

  useEffect(() => () => {
    if (!active.current) return;
    active.current = false;
    dispatch?.(null);
  }, [dispatch, instance, layer.id, shotId, snapshot.revision]);

  if (!dispatch) return null;

  function publish(value: LayerVisualEffects): void {
    if (layer.locked || editorProjectStore.getSnapshot() !== snapshot ||
      editorProjectStore.getProjectInstanceId() !== instance || shotStore.getCurrentShotId() !== shotId ||
      selectionStore.getSelectedLayerId() !== layer.id) return;
    const payload = LayerVisualEffectsSchema.safeParse(value);
    active.current = Boolean(payload.success && hasLayerVisualEffects(payload.data));
    dispatch?.(active.current && payload.success ? {
      effects: payload.data, layerId: layer.id, shotId, projectInstanceId: instance, revision: snapshot.revision,
    } : null);
  }

  function update(value: LayerVisualEffects): void {
    setEffects(value);
    if (showing) publish(value);
  }

  function clear(): void {
    if (active.current) dispatch?.(null);
    active.current = false;
    setPreviewRevision(undefined);
  }

  return <details className="animation-key-selection" data-testid="layer-effects-preview" onToggle={(event) => {
    if (!event.currentTarget.open) clear();
  }}>
    <summary>图层效果预览</summary>
    <fieldset className="animation-curve-fields" disabled={layer.locked}>
      <legend>合成与轮廓</legend>
      <label>混合模式<select value={effects.blend} onChange={(event) => update({
        ...effects, blend: event.target.value as LayerVisualEffects['blend'],
      })}>
        {Object.entries(blendLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      {([['blur', '模糊'], ['feather', '羽化']] as const).map(([key, label]) => (
        <label key={key}>{label}<input type="number" min={0} max={32} step={1} value={effects[key]}
          onChange={(event) => update({ ...effects, [key]: Number(event.target.value) })} /></label>
      ))}
      {([['glow', '外发光'], ['outline', '描边']] as const).map(([key, label]) => (
        <div key={key}>
          <label>{label}<input type="number" min={0} max={32} step={1} value={effects[key].radius}
            onChange={(event) => update({ ...effects, [key]: { ...effects[key], radius: Number(event.target.value) } })} /></label>
          <label>{label}颜色<input type="color" value={effects[key].color}
            onChange={(event) => update({ ...effects, [key]: { ...effects[key], color: event.target.value } })} /></label>
        </div>
      ))}
      <label><input type="checkbox" checked={Boolean(effects.silhouette)} onChange={(event) => update({
        ...effects, silhouette: event.target.checked ? '#000000' : undefined,
      })} />剪影</label>
      {effects.silhouette ? <label>剪影颜色<input type="color" value={effects.silhouette}
        onChange={(event) => update({ ...effects, silhouette: event.target.value })} /></label> : null}
      <Button type="button" disabled={!LayerVisualEffectsSchema.safeParse(effects).success || !hasLayerVisualEffects(effects)}
        onClick={() => { publish(effects); setPreviewRevision(snapshot.revision); }}>预览</Button>
      {showing ? <Button type="button" variant="secondary" onClick={clear}>取消预览</Button> : null}
    </fieldset>
  </details>;
}
