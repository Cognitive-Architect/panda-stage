import { useContext, useEffect, useRef, useState } from 'react';
import {
  defaultLayerVisualEffects, hasLayerVisualEffects, LayerVisualEffectsSchema, type LayerVisualEffects,
} from '../../../domain/models/layerVisualEffects';
import { LayerService, type Layer } from '../../../domain';
import { editorProjectStore, type EditorProjectSnapshot } from '../../stores/EditorProjectStore';
import { selectionStore } from '../../stores/selectionStore';
import { shotStore } from '../../stores/shotStore';
import { Button } from '../../ui';
import { LayerEffectPreviewDispatch } from '../../stage/LayerEffectPreview';

const layerService = new LayerService();

const blendLabels: Record<LayerVisualEffects['blend'], string> = {
  normal: '正常', multiply: '正片叠底', screen: '滤色', add: '相加',
};

export function LayerEffectsPreviewControl({ snapshot, shotId, layer }: {
  snapshot: EditorProjectSnapshot;
  shotId: string;
  layer: Layer;
}): React.JSX.Element | null {
  const dispatch = useContext(LayerEffectPreviewDispatch);
  const saved = layer.visualEffects ?? defaultLayerVisualEffects;
  const [draft, setDraft] = useState<{ revision: number; effects: LayerVisualEffects }>();
  const [previewRevision, setPreviewRevision] = useState<number>();
  const [error, setError] = useState('');
  const effects = draft?.revision === snapshot.revision ? draft.effects : saved;
  const payload = LayerVisualEffectsSchema.safeParse(effects);
  const showing = previewRevision === snapshot.revision;
  const changed = JSON.stringify(effects) !== JSON.stringify(saved);
  const active = useRef(false);
  const instance = editorProjectStore.getProjectInstanceId();

  useEffect(() => () => {
    if (!active.current) return;
    active.current = false;
    dispatch?.(null);
  }, [dispatch, instance, layer.id, shotId, snapshot.revision]);

  if (!dispatch || layer.source.kind === 'control') return null;

  function stillCurrent(): boolean {
    return !layer.locked && editorProjectStore.getSnapshot() === snapshot &&
      editorProjectStore.getProjectInstanceId() === instance && shotStore.getCurrentShotId() === shotId &&
      selectionStore.getSelectedLayerId() === layer.id;
  }

  function publish(value: LayerVisualEffects): void {
    if (!stillCurrent()) return;
    const parsed = LayerVisualEffectsSchema.safeParse(value);
    if (!parsed.success) {
      if (active.current) dispatch?.(null);
      active.current = false;
      return;
    }
    active.current = true;
    dispatch?.({
      effects: hasLayerVisualEffects(parsed.data) ? parsed.data : undefined,
      layerId: layer.id, shotId, projectInstanceId: instance, revision: snapshot.revision,
    });
  }

  function update(value: LayerVisualEffects): void {
    setDraft({ effects: value, revision: snapshot.revision });
    setError('');
    if (showing) publish(value);
  }

  function cancel(): void {
    if (active.current) dispatch?.(null);
    active.current = false;
    setPreviewRevision(undefined);
    setDraft(undefined);
    setError('');
  }

  function apply(value: LayerVisualEffects | undefined): void {
    if (!stillCurrent()) return;
    try {
      const project = layerService.setVisualEffects(snapshot.project, shotId, layer.id, value);
      if (project !== snapshot.project) {
        editorProjectStore.updateProject(project, value && hasLayerVisualEffects(value) ? '应用图层效果' : '清除图层效果');
      }
      cancel();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法设置图层效果。');
    }
  }

  return <details className="animation-key-selection" data-testid="layer-effects-preview" onToggle={(event) => {
    if (!event.currentTarget.open) cancel();
  }}>
    <summary>图层效果</summary>
    <fieldset className="animation-curve-fields" disabled={layer.locked}>
      <legend>合成与轮廓</legend>
      <label>混合模式<select value={effects.blend} onChange={(event) => update({
        ...effects, blend: event.target.value as LayerVisualEffects['blend'],
      })}>
        {Object.entries(blendLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      {([['blur', '模糊'], ['feather', '局部边缘羽化']] as const).map(([key, label]) => (
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
      <Button type="button" disabled={!payload.success || !changed}
        onClick={() => { publish(effects); setPreviewRevision(snapshot.revision); }}>预览</Button>
      <Button type="button" disabled={!payload.success || !changed}
        onClick={() => { if (payload.success) apply(payload.data); }}>应用</Button>
      {showing || changed ? <Button type="button" variant="secondary" onClick={cancel}>取消</Button> : null}
      {layer.visualEffects ? <Button type="button" variant="secondary" onClick={() => apply(undefined)}>清除效果</Button> : null}
    </fieldset>
    {error ? <p role="alert">{error}</p> : null}
  </details>;
}
