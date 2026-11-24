import { useState } from 'react';
import {
  layerCompositeKeyTimes,
  LayerMotionService,
  MOTION_PROPERTY_LABELS,
  resolveTimelineFrameTime,
  userMotionPresetRange,
  type Layer,
  type Project,
  type Shot,
} from '../../../domain';
import { editorProjectStore, type EditorProjectSnapshot } from '../../stores/EditorProjectStore';
import { selectionStore } from '../../stores/selectionStore';
import { shotStore } from '../../stores/shotStore';
import { Button } from '../../ui';
import { formatTimecode } from '../timeline/timeGeometry';
import { timelineUiStore, useTimelineUi } from '../timeline/timelineUiStore';

const motion = new LayerMotionService();

export function UserMotionPresetControls({ snapshot, shot, layer, onPreview }: {
  snapshot: EditorProjectSnapshot;
  shot: Shot;
  layer: Layer;
  onPreview?: (project: Project) => void;
}): React.JSX.Element {
  const { currentTimeMs } = useTimelineUi();
  const instance = editorProjectStore.getProjectInstanceId();
  const [name, setName] = useState('');
  const [from, setFrom] = useState(0);
  const [to, setTo] = useState<number>();
  const [selectedId, setSelectedId] = useState('');
  const [error, setError] = useState('');
  const times = layerCompositeKeyTimes(layer);
  const startMs = times.includes(from) ? from : 0;
  const endMs = times.includes(to ?? -1) ? to! : (times.at(-1) ?? 0);
  const library = snapshot.project.userMotionPresets ?? [];
  const preset = library.find((item) => item.id === selectedId);
  const playhead = resolveTimelineFrameTime(currentTimeMs, shot.durationMs);
  const target = { shotId: shot.id, layerId: layer.id };

  const run = (operation: 'save' | 'update' | 'apply' | 'preview'): void => {
    const current = editorProjectStore.getSnapshot();
    if (!current || instance !== editorProjectStore.getProjectInstanceId() ||
      shotStore.getCurrentShotId() !== shot.id || selectionStore.getSelectedLayerId() !== layer.id) return;
    try {
      const latestTime = resolveTimelineFrameTime(timelineUiStore.getSnapshot().currentTimeMs, shot.durationMs);
      const next = operation === 'apply' || operation === 'preview'
        ? motion.applyUserMotionPreset(current.project, { ...target, timeMs: latestTime }, selectedId)
        : motion.saveUserMotionPreset(current.project, { ...target, name, startMs, endMs,
          ...(operation === 'update' ? { replaceId: selectedId } : {}) });
      if (operation === 'preview') {
        onPreview?.(next);
      } else {
        editorProjectStore.updateProject(next, operation === 'apply' ? '应用运动预设' : '保存运动预设');
      }
      if (operation === 'save') {
        const latest = next.userMotionPresets?.at(-1);
        if (latest) setSelectedId(latest.id);
      }
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法处理运动预设。');
    }
  };

  let affected: string | undefined;
  let conflict: string | undefined;
  if (preset) {
    try {
      const range = userMotionPresetRange(preset, playhead, shot.durationMs);
      affected = `${formatTimecode(playhead)}–${formatTimecode(range.endMs)} · ${preset.tracks.map(({ property }) => MOTION_PROPERTY_LABELS[property]).join('、')}`;
    } catch (cause) {
      conflict = cause instanceof Error ? cause.message : '无法预览这段运动。';
    }
  }

  return <details className="user-motion-preset" data-testid="user-motion-preset">
    <summary>自定义运动预设</summary>
    {times.length >= 2 ? <>
      <label>预设名称<input value={name} maxLength={200} onChange={(event) => setName(event.target.value)} /></label>
      <label>起点<select value={startMs} onChange={(event) => setFrom(Number(event.target.value))}>
        {times.map((time) => <option value={time} key={time}>{formatTimecode(time)}</option>)}
      </select></label>
      <label>终点<select value={endMs} onChange={(event) => setTo(Number(event.target.value))}>
        {times.map((time) => <option value={time} key={time}>{formatTimecode(time)}</option>)}
      </select></label>
      <Button variant="secondary" disabled={!name.trim() || startMs >= endMs} onClick={() => run('save')}>保存新预设</Button>
      {preset ? <Button variant="secondary" disabled={!name.trim() || startMs >= endMs} onClick={() => run('update')}>更新选中的预设</Button> : null}
    </> : <p>先在对象动作轨添加关键帧。</p>}
    {library.length ? <label>套用预设<select value={selectedId} onChange={(event) => {
      const id = event.target.value;
      setSelectedId(id);
      setName(library.find((item) => item.id === id)?.name ?? '');
      setError('');
    }}>
      <option value="">选择预设</option>
      {library.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
    </select></label> : null}
    {preset ? <>
      {affected ? <output>{layer.name} · {affected}</output> : null}
      {onPreview ? <Button variant="secondary" disabled={layer.locked || Boolean(conflict)}
        onClick={() => run('preview')}>预览运动</Button> : null}
      <Button disabled={layer.locked || Boolean(conflict)} onClick={() => run('apply')}>应用到播放头</Button>
    </> : null}
    {error || conflict ? <p role="alert">{error || conflict}</p> : null}
  </details>;
}
