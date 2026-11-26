import { useMemo, useState } from 'react';
import {
  evaluateShotAtTime, layerAttachmentTargetKey, projectShotDialogueVisual,
  resolveLayerAttachmentTargets, validLayerParentTargets, type Layer, type Project, type Shot,
} from '../../../domain';
import { layerStore } from '../../stores/layerStore';
import { timelineUiStore, useTimelineUi } from '../timeline/timelineUiStore';

export function LayerParentControl({ layer, project, shot }: { layer: Layer; project: Project; shot: Shot }): React.JSX.Element | null {
  const [error, setError] = useState('');
  const targets = useMemo(() => validLayerParentTargets(shot, layer.id), [shot, layer.id]);
  const parentId = layer.parentLayerId;
  const { currentTimeMs } = useTimelineUi();
  const parent = targets.find(({ id }) => id === parentId);
  const attachments = useMemo(() => {
    if (!parent || (parent.source.kind !== 'character' && parent.source.kind !== 'animation')) return [];
    try {
      const evaluated = projectShotDialogueVisual(project, shot, evaluateShotAtTime(shot, currentTimeMs, project))
        .layers.find(({ id }) => id === parent.id);
      return evaluated ? resolveLayerAttachmentTargets(project, parent, evaluated) : [];
    } catch {
      return [];
    }
  }, [currentTimeMs, parent, project, shot]);
  const boundTarget = layer.parentAttachment?.target;
  const boundKey = boundTarget ? layerAttachmentTargetKey(boundTarget) : '';
  const targetUnavailable = boundKey !== '' && !attachments.some(({ target }) => layerAttachmentTargetKey(target) === boundKey);
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
    {parentId && (attachments.length > 0 || boundTarget) && <label>挂接点{' '}
      <select aria-label="挂接点" value={boundKey} disabled={layer.locked} onChange={(event) => {
        const key = event.currentTarget.value;
        const attachment = attachments.find(({ target }) => layerAttachmentTargetKey(target) === key);
        if (key && !attachment) return;
        try {
          layerStore.setParent(layer.id, parentId, timelineUiStore.getSnapshot().currentTimeMs, attachment?.target);
          setError('');
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : '无法设置挂接点。');
        }
      }}>
        <option value="">图层根</option>
        {targetUnavailable && <option value={boundKey} disabled>挂接点当前不可用</option>}
        {attachments.map(({ target, label }) => {
          const key = layerAttachmentTargetKey(target);
          return <option key={key} value={key}>{label}</option>;
        })}
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
