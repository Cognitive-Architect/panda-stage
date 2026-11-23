import { useState } from 'react';
import { LayerService, type AnimationPlayback, type Layer, type Project, type Shot } from '../../../domain';
import type { ReusableAnimationSegment } from '../../../domain/models/reusableAnimationSegment';
import { resolveFlaGraphicPreviewTimeline } from '../../../domain/selectors/animationSourceTimeline';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { selectionStore } from '../../stores/selectionStore';
import { shotStore } from '../../stores/shotStore';
import { Button } from '../../ui';
import { timelineUiStore } from '../timeline/timelineUiStore';

const layers = new LayerService();

export function AnimationSegmentControls({ project, shot, layer, onPreview }: {
  project: Project;
  shot: Shot;
  layer: Layer | null;
  onPreview?: (draft: Project) => void;
}): React.JSX.Element {
  const instance = editorProjectStore.getProjectInstanceId();
  const [selectedId, setSelectedId] = useState('');
  const [animationId, setAnimationId] = useState(layer?.source.kind === 'animation' ? layer.source.animationId : '');
  const [name, setName] = useState('');
  const [first, setFirst] = useState(1);
  const [last, setLast] = useState<number>();
  const [mode, setMode] = useState<AnimationPlayback['mode']>('once');
  const [endBehavior, setEndBehavior] = useState<AnimationPlayback['endBehavior']>('hold');
  const [error, setError] = useState('');
  const library = project.animationSegments ?? [];
  const selected = library.find((entry) => entry.id === selectedId);
  const definition = project.animations.find((entry) => entry.id === animationId);
  const total = definition ? resolveFlaGraphicPreviewTimeline(definition, true).totalFrames : 0;
  const end = last ?? total;
  const valid = Boolean(definition && name.trim() && Number.isInteger(first) && Number.isInteger(end) &&
    first >= 1 && first <= end && end <= total);
  const missing = selected && !project.animations.some((entry) => entry.id === selected.animationId);

  const choose = (segment?: ReusableAnimationSegment): void => {
    setSelectedId(segment?.id ?? '');
    setName(segment?.name ?? '');
    setAnimationId(segment?.animationId ?? (layer?.source.kind === 'animation' ? layer.source.animationId : ''));
    setFirst((segment?.range.firstFrame ?? 0) + 1);
    setLast(segment ? segment.range.lastFrame + 1 : undefined);
    setMode(segment?.playback.mode ?? 'once');
    setEndBehavior(segment?.playback.endBehavior ?? 'hold');
    setError('');
  };

  const run = (operation: 'save' | 'update' | 'place' | 'preview'): void => {
    const snapshot = editorProjectStore.getSnapshot();
    if (!snapshot || instance !== editorProjectStore.getProjectInstanceId() ||
      shotStore.getCurrentShotId() !== shot.id) return;
    try {
      if (operation === 'save' || operation === 'update') {
        const next = layers.saveAnimationSegment(snapshot.project, {
          name, animationId, range: { firstFrame: first - 1, lastFrame: end - 1 },
          playback: { mode, endBehavior },
          position: layer?.source.kind === 'animation' && layer.source.animationId === animationId
            ? { x: layer.x, y: layer.y }
            : selected?.position ?? { x: project.width / 2, y: project.height / 2 },
          ...(operation === 'update' ? { replaceId: selectedId } : {}),
        });
        editorProjectStore.updateProject(next, '保存动画片段');
        choose(operation === 'save' ? next.animationSegments?.at(-1)
          : next.animationSegments?.find((entry) => entry.id === selectedId));
      } else {
        const result = layers.placeAnimationSegment(snapshot.project, shot.id, selectedId, timelineUiStore.getSnapshot().currentTimeMs);
        if (operation === 'preview') {
          onPreview?.(result.project);
        } else {
          editorProjectStore.updateProject(result.project, '添加动画片段');
          selectionStore.select(result.layer.id);
        }
      }
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法处理动画片段。');
    }
  };

  return <details className="user-motion-preset" data-testid="animation-segment-controls">
    <summary>动画片段</summary>
    {library.length ? <label>已保存片段<select value={selectedId} onChange={(event) => choose(library.find((entry) => entry.id === event.target.value))}>
      <option value="">选择片段</option>
      {library.map((segment) => <option key={segment.id} value={segment.id}>{segment.name}</option>)}
    </select></label> : null}
    {selected ? <>
      {missing ? <p role="alert">源动画不可用。可重新选择源动画并更新片段。</p> : null}
      {onPreview ? <Button variant="secondary" disabled={missing} onClick={() => run('preview')}>预览片段</Button> : null}
      <Button disabled={missing} onClick={() => run('place')}>作为新图层添加</Button>
    </> : null}
    <label>片段名称<input value={name} maxLength={200} onChange={(event) => setName(event.target.value)} /></label>
    <label>源动画<select value={definition?.id ?? ''} onChange={(event) => {
      setAnimationId(event.target.value);
      setFirst(1);
      setLast(undefined);
      setError('');
    }}>
      <option value="">选择动画</option>
      {project.animations.map((animation) => <option key={animation.id} value={animation.id}>{animation.name}</option>)}
    </select></label>
    {definition ? <>
      <label>首帧<input type="number" min={1} max={total} value={first} onChange={(event) => setFirst(Number(event.target.value))} /></label>
      <label>尾帧<input type="number" min={1} max={total} value={end} onChange={(event) => setLast(Number(event.target.value))} /></label>
      <label>播放<select value={mode} onChange={(event) => setMode(event.target.value as AnimationPlayback['mode'])}>
        <option value="once">播放一次</option>
        <option value="loop">循环</option>
        <option value="single-frame">停在首帧</option>
      </select></label>
      {mode === 'once' ? <label>播放结束<select value={endBehavior}
        onChange={(event) => setEndBehavior(event.target.value === 'hide' ? 'hide' : 'hold')}>
        <option value="hold">保留尾帧</option>
        <option value="hide">隐藏</option>
      </select></label> : null}
    </> : null}
    <Button variant="secondary" disabled={!valid} onClick={() => run('save')}>保存新片段</Button>
    {selected ? <Button variant="secondary" disabled={!valid} onClick={() => run('update')}>更新选中的片段</Button> : null}
    {error ? <p role="alert">{error}</p> : null}
  </details>;
}
