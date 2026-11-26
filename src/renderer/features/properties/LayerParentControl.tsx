import { useMemo, useState } from 'react';
import { MoveHorizontal, RotateCcw, Trash2 } from 'lucide-react';
import {
  evaluateShotAtTime,
  layerAttachmentTargetKey,
  projectShotDialogueVisual,
  resolveLayerAttachmentTargets,
  resolveLayerParentBindingAtTime,
  resolveTimelineFrameTime,
  validLayerParentTargets,
  type Layer,
  type LayerParentKeyDepthMode,
  type Project,
  type Shot,
} from '../../../domain';
import { layerStore } from '../../stores/layerStore';
import { IconButton } from '../../ui/Button';
import { timelineUiStore, useTimelineUi } from '../timeline/timelineUiStore';

const DETACH_OPTION_VALUE = '__detach__';

function formatKeyTime(timeMs: number): string {
  return `${(timeMs / 1000).toFixed(2)}s`;
}

export function LayerParentControl({ layer, project, shot }: { layer: Layer; project: Project; shot: Shot }): React.JSX.Element | null {
  const [error, setError] = useState('');
  const [handoffTargetId, setHandoffTargetId] = useState('');
  const [handoffAttachmentKey, setHandoffAttachmentKey] = useState('');
  const [handoffDepthMode, setHandoffDepthMode] = useState<LayerParentKeyDepthMode>('preserve');
  const { currentTimeMs } = useTimelineUi();
  const snappedTimeMs = resolveTimelineFrameTime(currentTimeMs, shot.durationMs);
  const parentKeys = layer.parentKeys ?? [];

  const baseTargets = useMemo(
    () => validLayerParentTargets(shot, layer.id, 0, parentKeys[0]?.timeMs ?? Infinity),
    [shot, layer.id, parentKeys],
  );
  const nextKeyTimeMs = useMemo(
    () => parentKeys.find((key) => key.timeMs > snappedTimeMs)?.timeMs ?? Infinity,
    [parentKeys, snappedTimeMs],
  );
  const handoffTargets = useMemo(
    () => validLayerParentTargets(shot, layer.id, snappedTimeMs, nextKeyTimeMs),
    [shot, layer.id, snappedTimeMs, nextKeyTimeMs],
  );

  const evaluatedLayers = useMemo(() => {
    try {
      return projectShotDialogueVisual(project, shot, evaluateShotAtTime(shot, snappedTimeMs, project)).layers;
    } catch {
      return [];
    }
  }, [project, shot, snappedTimeMs]);

  const parentId = layer.parentLayerId;
  const baseParent = baseTargets.find(({ id }) => id === parentId);
  const baseAttachments = useMemo(() => {
    if (!baseParent || (baseParent.source.kind !== 'character' && baseParent.source.kind !== 'animation')) return [];
    try {
      const evaluated = evaluatedLayers.find(({ id }) => id === baseParent.id);
      return evaluated ? resolveLayerAttachmentTargets(project, baseParent, evaluated) : [];
    } catch {
      return [];
    }
  }, [baseParent, evaluatedLayers, project]);

  const boundTarget = layer.parentAttachment?.target;
  const boundKey = boundTarget ? layerAttachmentTargetKey(boundTarget) : '';
  const targetUnavailable = boundKey !== '' && !baseAttachments.some(({ target }) => layerAttachmentTargetKey(target) === boundKey);

  const activeBinding = useMemo(
    () => resolveLayerParentBindingAtTime(layer, snappedTimeMs),
    [layer, snappedTimeMs],
  );
  const activeParentLayer = activeBinding.parentLayerId
    ? shot.layers.find(({ id }) => id === activeBinding.parentLayerId)
    : undefined;

  const selectedHandoffParent = handoffTargetId && handoffTargetId !== DETACH_OPTION_VALUE
    ? handoffTargets.find(({ id }) => id === handoffTargetId)
    : undefined;
  const handoffAttachments = useMemo(() => {
    if (!selectedHandoffParent || (selectedHandoffParent.source.kind !== 'character' && selectedHandoffParent.source.kind !== 'animation')) {
      return [];
    }
    try {
      const evaluated = evaluatedLayers.find(({ id }) => id === selectedHandoffParent.id);
      return evaluated ? resolveLayerAttachmentTargets(project, selectedHandoffParent, evaluated) : [];
    } catch {
      return [];
    }
  }, [selectedHandoffParent, evaluatedLayers, project]);

  const childPose = evaluatedLayers.find(({ id }) => id === layer.id);
  const handoffParentPose = selectedHandoffParent
    ? evaluatedLayers.find(({ id }) => id === selectedHandoffParent.id)
    : undefined;
  const crossDepthHandoff = Boolean(
    selectedHandoffParent &&
    !layer.depthKeys?.length &&
    Math.abs((childPose?.effectiveDepth ?? 0) - (handoffParentPose?.effectiveDepth ?? 0)) > 1e-6,
  );

  const hasDynamicParents = parentKeys.some((key) => key.parentLayerId !== null);

  if (shot.backgroundLayerId === layer.id) return null;

  const applyHandoff = () => {
    if (!handoffTargetId) return;
    const targetParentId = handoffTargetId === DETACH_OPTION_VALUE ? null : handoffTargetId;
    const attachment = targetParentId && handoffAttachmentKey
      ? handoffAttachments.find(({ target }) => layerAttachmentTargetKey(target) === handoffAttachmentKey)
      : undefined;
    try {
      layerStore.setParentKey(layer.id, snappedTimeMs, targetParentId, {
        ...(attachment ? { target: attachment.target } : {}),
        ...(crossDepthHandoff ? { depthMode: handoffDepthMode } : {}),
      });
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法在此帧切换父级图层。');
    }
  };

  return <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
    {(parentId || baseTargets.length > 0) && <label>{parentKeys.length > 0 ? '基础父级' : '父级图层'}{' '}
      <select aria-label="父级图层" value={parentId ?? ''} disabled={layer.locked} onChange={(event) => {
        try {
          layerStore.setParent(layer.id, event.currentTarget.value || null, timelineUiStore.getSnapshot().currentTimeMs);
          setError('');
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : '无法设置父级图层。');
        }
      }}>
        <option value="">无</option>
        {parentId && !baseTargets.some(({ id }) => id === parentId) && <option value={parentId} disabled>失效的父级图层</option>}
        {baseTargets.map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}
      </select>
    </label>}
    {parentId && (baseAttachments.length > 0 || boundTarget) && <label>挂接点{' '}
      <select aria-label="挂接点" value={boundKey} disabled={layer.locked} onChange={(event) => {
        const key = event.currentTarget.value;
        const attachment = baseAttachments.find(({ target }) => layerAttachmentTargetKey(target) === key);
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
        {baseAttachments.map(({ target, label }) => {
          const key = layerAttachmentTargetKey(target);
          return <option key={key} value={key}>{label}</option>;
        })}
      </select>
    </label>}
    {!parentId && !hasDynamicParents && <label>
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

    {(handoffTargets.length > 0 || activeBinding.parentLayerId || parentKeys.length > 0) && (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', paddingTop: '6px', borderTop: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px' }}>
          <span>在此帧切换（{formatKeyTime(snappedTimeMs)}）</span>
          <span>当前：{activeParentLayer ? activeParentLayer.name : '独立'}</span>
        </div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            aria-label="在此帧切换父级"
            value={handoffTargetId}
            disabled={layer.locked}
            onChange={(event) => {
              setHandoffTargetId(event.currentTarget.value);
              setHandoffAttachmentKey('');
              setHandoffDepthMode('preserve');
            }}
          >
            <option value="">选择交接目标…</option>
            <option value={DETACH_OPTION_VALUE}>解除绑定（独立）</option>
            {handoffTargets.map((target) => (
              <option key={target.id} value={target.id}>{target.name}</option>
            ))}
          </select>
          {selectedHandoffParent && handoffAttachments.length > 0 && (
            <select
              aria-label="在此帧挂接点"
              value={handoffAttachmentKey}
              disabled={layer.locked}
              onChange={(event) => setHandoffAttachmentKey(event.currentTarget.value)}
            >
              <option value="">图层根</option>
              {handoffAttachments.map(({ target, label }) => {
                const key = layerAttachmentTargetKey(target);
                return <option key={key} value={key}>{label}</option>;
              })}
            </select>
          )}
          {crossDepthHandoff && (
            <select
              aria-label="跨深度处理"
              value={handoffDepthMode}
              disabled={layer.locked}
              onChange={(event) => setHandoffDepthMode(event.currentTarget.value as LayerParentKeyDepthMode)}
            >
              <option value="preserve">保留当前深度</option>
              <option value="inherit">采用新父深度</option>
            </select>
          )}
          <button
            type="button"
            disabled={layer.locked || !handoffTargetId}
            onClick={applyHandoff}
          >
            {handoffTargetId === DETACH_OPTION_VALUE ? '在此帧解绑' : '在此帧绑定'}
          </button>
        </div>

        {parentKeys.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {parentKeys.map((key) => {
              const targetLayer = key.parentLayerId
                ? shot.layers.find(({ id }) => id === key.parentLayerId)
                : undefined;
              const targetLabel = key.parentLayerId === null
                ? '独立（解绑）'
                : (targetLayer?.name ?? '失效父级');
              const isCurrent = key.timeMs === snappedTimeMs;
              return (
                <div
                  key={key.timeMs}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '6px',
                    fontSize: '12px',
                    fontWeight: isCurrent ? 600 : 400,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => timelineUiStore.seek(key.timeMs, shot.durationMs)}
                    style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit' }}
                  >
                    {formatKeyTime(key.timeMs)} · {targetLabel}
                    {key.depthMode === 'preserve' && key.depth !== undefined ? ` · 深度 ${key.depth}` : ''}
                  </button>
                  <span style={{ display: 'inline-flex', gap: '4px' }}>
                    <IconButton
                      variant="secondary"
                      icon={<MoveHorizontal size={12} />}
                      disabled={layer.locked || isCurrent}
                      aria-label={`将 ${formatKeyTime(key.timeMs)} 交接帧移到播放头`}
                      title="移到播放头"
                      onClick={() => {
                        const targetTimeMs = timelineUiStore.getSnapshot().currentTimeMs;
                        try {
                          layerStore.moveParentKey(layer.id, key.timeMs, targetTimeMs);
                          timelineUiStore.seek(resolveTimelineFrameTime(targetTimeMs, shot.durationMs), shot.durationMs);
                          setError('');
                        } catch (cause) {
                          setError(cause instanceof Error ? cause.message : '无法移动交接帧。');
                        }
                      }}
                    />
                    <button
                      type="button"
                      disabled={layer.locked}
                      aria-label={`重新对齐 ${formatKeyTime(key.timeMs)} 交接帧`}
                      title="重新对齐"
                      onClick={() => {
                        try {
                          layerStore.realignParentKey(layer.id, key.timeMs);
                          setError('');
                        } catch (cause) {
                          setError(cause instanceof Error ? cause.message : '无法重新对齐交接帧。');
                        }
                      }}
                    >
                      <RotateCcw size={12} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      disabled={layer.locked}
                      aria-label={`删除 ${formatKeyTime(key.timeMs)} 交接帧`}
                      title="删除交接帧"
                      onClick={() => {
                        try {
                          layerStore.removeParentKey(layer.id, key.timeMs);
                          setError('');
                        } catch (cause) {
                          setError(cause instanceof Error ? cause.message : '无法删除交接帧。');
                        }
                      }}
                    >
                      <Trash2 size={12} aria-hidden="true" />
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    )}

    {error && <div role="alert">{error}</div>}
  </div>;
}
