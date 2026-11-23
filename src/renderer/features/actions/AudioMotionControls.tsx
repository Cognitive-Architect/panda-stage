import { useMemo, useState } from 'react';
import {
  audioClipDurationMs,
  frameTimeMs,
  LayerMotionService,
  resolveTimelineFrameTime,
  type AudioMotionDraft,
  type Layer,
  type Project,
  type Shot,
} from '../../../domain';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { selectionStore } from '../../stores/selectionStore';
import { shotStore } from '../../stores/shotStore';
import { Button } from '../../ui';
import { sampleAudioMotionLevels } from '../timeline/audioWaveformGeometry';
import { useTimelineAudio } from '../timeline/useTimelineAudio';

const motion = new LayerMotionService();

export function AudioMotionControls({ shot, layer, onPreview }: {
  shot: Shot;
  layer: Layer;
  onPreview?: (draft: Project) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [clipId, setClipId] = useState('');
  const [start, setStart] = useState<number>();
  const [end, setEnd] = useState<number>();
  const [property, setProperty] = useState<AudioMotionDraft['property']>('vertical');
  const [strength, setStrength] = useState(45);
  const [replace, setReplace] = useState(false);
  const [previewed, setPreviewed] = useState<string>();
  const [error, setError] = useState('');
  const instance = editorProjectStore.getProjectInstanceId();
  const revision = editorProjectStore.getSnapshot()?.revision;
  const clip = shot.audioClips.find(({ id }) => id === clipId);
  const clips = shot.audioClips.filter(({ role }) => role === 'dialogue');
  const audio = useTimelineAudio(shot.id, clip, open);
  const fps = editorProjectStore.getSnapshot()?.project.fps ?? 24;
  const firstFrame = clip ? Math.round(clip.startMs * fps / 1_000) : 0;
  const lastFrame = clip ? Math.round(clip.endMs * fps / 1_000) : 0;
  const firstMs = frameTimeMs(clip && frameTimeMs(firstFrame, fps) < clip.startMs ? firstFrame + 1 : firstFrame, fps);
  const finalMs = frameTimeMs(clip && frameTimeMs(lastFrame, fps) > clip.endMs ? lastFrame - 1 : lastFrame, fps);
  const startMs = resolveTimelineFrameTime(start ?? firstMs, shot.durationMs);
  const endMs = resolveTimelineFrameTime(end ?? finalMs, shot.durationMs);
  const legal = Boolean(clip && startMs >= clip.startMs && endMs <= clip.endMs && endMs > startMs && audioClipDurationMs(clip) > 0);
  const levels = useMemo(() => legal && clip && audio.samples
    ? sampleAudioMotionLevels(audio.samples, clip, startMs, endMs) : [],
  [legal, clip, audio.samples, startMs, endMs]);
  const ready = legal && !layer.locked && levels.length > 0;
  const intention = JSON.stringify([revision, clipId, startMs, endMs, property, strength, replace]);

  const run = (preview: boolean): void => {
    const snapshot = editorProjectStore.getSnapshot();
    if (!snapshot || snapshot.revision !== revision || instance !== editorProjectStore.getProjectInstanceId() ||
      shotStore.getCurrentShotId() !== shot.id || selectionStore.getSelectedLayerId() !== layer.id ||
      !ready || (!preview && previewed !== intention)) return;
    try {
      const draft = motion.applyAudioMotion(snapshot.project, { shotId: shot.id, layerId: layer.id },
        { startMs, endMs, property, strength: strength / 100, replaceExisting: replace, levels });
      if (preview) {
        setPreviewed(intention);
        onPreview?.(draft);
      } else {
        editorProjectStore.updateProject(draft, '生成音量动作');
        setPreviewed(undefined);
      }
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法生成动作。');
    }
  };

  return <details className="user-motion-preset" data-testid="audio-motion-controls" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>音量生成动作</summary>
    <label>对白配音<select value={clipId} onChange={(event) => {
      setClipId(event.target.value);
      setStart(undefined);
      setEnd(undefined);
      setPreviewed(undefined);
      setError('');
    }}>
      <option value="">选择配音</option>
      {clips.map((entry) => <option value={entry.id} key={entry.id}>
        {shot.dialogues.find(({ audioClipId }) => audioClipId === entry.id)?.text ?? entry.name}
      </option>)}
    </select></label>
    {clip ? <>
      <label>起点 (ms)<input type="number" min={firstMs} max={finalMs} value={start ?? firstMs}
        onChange={(event) => setStart(Number(event.target.value))} /></label>
      <label>终点 (ms)<input type="number" min={firstMs} max={finalMs} value={end ?? finalMs}
        onChange={(event) => setEnd(Number(event.target.value))} /></label>
      {legal && (start !== undefined || end !== undefined) ? <output>{startMs}–{endMs} ms</output> : null}
      <label>属性<select value={property} onChange={(event) => setProperty(event.target.value === 'vertical' ? 'vertical' : 'uniform-scale')}>
        <option value="vertical">纵向起伏</option>
        <option value="uniform-scale">均匀缩放</option>
      </select></label>
      <label>强度<input type="range" min="1" max="100" value={strength}
        onChange={(event) => setStrength(Number(event.target.value))} /><output>{strength}%</output></label>
      <label><input type="checkbox" checked={replace} onChange={(event) => setReplace(event.target.checked)} />替换选段内已有关键帧</label>
      <Button variant="secondary" disabled={!ready || !onPreview} onClick={() => run(true)}>预览动作</Button>
      <Button disabled={!ready || previewed !== intention} onClick={() => run(false)}>应用动作</Button>
    </> : null}
    {audio.unavailable || error ? <p role="alert">{error || '这段对白音频无法解码。'}</p> : null}
  </details>;
}
