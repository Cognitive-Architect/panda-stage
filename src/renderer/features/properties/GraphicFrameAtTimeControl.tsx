import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from 'react';
import { clearGraphicFrameAtTime, findGraphicFrameKey, getGraphicPlaybackSyncContext, isFlaGraphicDefinition, setGraphicFrameAtTime,
  syncGraphicPlaybackForward, type AnimationPlayback, type FlaGraphicDefinition, type Layer, type Project, type Shot } from '../../../domain';
import { findGraphicPlaybackAtTime } from '../../../domain/evaluate-shot-at-time';
import { resolveFlaGraphicPreviewTimeline } from '../../../domain/selectors/animationSourceTimeline';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { selectionStore } from '../../stores/selectionStore';
import { shotStore } from '../../stores/shotStore';
import { Button } from '../../ui/Button';
import { GraphicFrameChoices } from '../characters/GraphicFacePicker';
import { timelineUiStore, useTimelineUi } from '../timeline/timelineUiStore';
import { formatTimecode } from '../timeline/timeGeometry';
import { parseAnimationStartTime } from './AnimationPlaybackControls';

type GraphicTarget = { layerId: string; animationId: string };

const GraphicTargetContext = createContext<{
  fixed?: GraphicTarget;
  setFixed: (target?: GraphicTarget) => void;
}>({ setFixed: () => {} });

export function GraphicFrameTargetProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const snapshot = useSyncExternalStore(editorProjectStore.subscribe, editorProjectStore.getSnapshot);
  const shotId = useSyncExternalStore(shotStore.subscribe, shotStore.getCurrentShotId);
  const projectInstanceId = editorProjectStore.getProjectInstanceId();
  const [pin, setPin] = useState<{ projectInstanceId: number | null; shotId: string | null; target: GraphicTarget }>();
  const shot = snapshot?.project.shots.find((entry) => entry.id === shotId);
  const fixedLayer = pin && shot?.layers.find((entry) => entry.id === pin.target.layerId);
  const definition = pin && snapshot?.project.animations.find((entry) => entry.id === pin.target.animationId);
  const fixed = pin?.projectInstanceId === projectInstanceId && pin.shotId === shotId &&
    fixedLayer && !fixedLayer.locked && fixedLayer.source.kind === 'animation' &&
    fixedLayer.source.animationId === pin.target.animationId && definition && isFlaGraphicDefinition(definition)
    ? pin.target : undefined;
  if (pin && !fixed) setPin(undefined);
  return <GraphicTargetContext.Provider value={{ fixed,
    setFixed: (target) => setPin(target ? { projectInstanceId, shotId, target } : undefined) }}>
    {children}
  </GraphicTargetContext.Provider>;
}

export function GraphicFrameAtTimeControl({ project, shot, selection }: {
  project: Project;
  shot: Shot;
  selection: Layer | null;
}): React.JSX.Element | null {
  const { fixed, setFixed } = useContext(GraphicTargetContext);
  const layer = fixed ? shot.layers.find((entry) => entry.id === fixed.layerId) : selection;
  const source = layer?.source;
  const definition = source?.kind === 'animation'
    ? project.animations.find((entry) => entry.id === source.animationId)
    : undefined;
  if (!layer || !definition || !isFlaGraphicDefinition(definition)) return null;

  return <GraphicFrameEditor key={JSON.stringify([layer.id, definition.id])}
    project={project} definition={definition} shot={shot} layer={layer} fixed={Boolean(fixed)}
    onToggleFixed={() => setFixed(fixed ? undefined : { layerId: layer.id, animationId: definition.id })} />;
}

function GraphicFrameEditor({ project, definition, shot, layer, fixed, onToggleFixed }: {
  project: Project;
  definition: FlaGraphicDefinition;
  shot: Shot;
  layer: Layer;
  fixed: boolean;
  onToggleFixed: () => void;
}): React.JSX.Element {
  const { id: layerId, locked } = layer;
  const instance = editorProjectStore.getProjectInstanceId();
  const { currentTimeMs } = useTimelineUi();
  const [open, setOpen] = useState(fixed);
  const [error, setError] = useState('');
  const playbackRange = findGraphicPlaybackAtTime(shot.timelineEvents, layerId, definition.id, currentTimeMs);
  const key = playbackRange ? undefined : findGraphicFrameKey(shot, layerId, definition.id, currentTimeMs);

  const edit = (description: string, change: (project: Project, timeMs: number) => Project): void => {
    const snapshot = editorProjectStore.getSnapshot();
    if (locked || !snapshot ||
        instance !== editorProjectStore.getProjectInstanceId() ||
        shotStore.getCurrentShotId() !== shot.id || (!fixed && selectionStore.getSelectedLayerId() !== layerId)) return;
    const liveLayer = snapshot.project.shots.find((entry) => entry.id === shot.id)?.layers.find((entry) => entry.id === layerId);
    if (!liveLayer || liveLayer.locked || liveLayer.source.kind !== 'animation' ||
        liveLayer.source.animationId !== definition.id) return;
    try {
      const next = change(snapshot.project, timelineUiStore.getSnapshot().currentTimeMs);
      if (next !== snapshot.project) editorProjectStore.updateProject(next, description);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法修改元件显示帧。');
    }
  };

  return <section className="graphic-face-picker" data-testid="graphic-frame-at-time">
    <div className="graphic-face-pagination">
      <Button variant="secondary" aria-expanded={open} disabled={locked} onClick={() => setOpen(!open)}>选择显示帧</Button>
      {open || fixed ? <Button variant="secondary" aria-pressed={fixed} disabled={locked} onClick={onToggleFixed}>
        {fixed ? `取消固定 · ${layer.name}` : '固定目标'}
      </Button> : null}
    </div>
    {open ? <>
      <GraphicFrameChoices definition={definition} selectedIndex={key ? key.sourceFrameIndex - definition.source.startFrameIndex : -1}
        onSelect={(_, index) => edit('设置元件显示帧', (project, time) => setGraphicFrameAtTime(project, shot.id, layerId,
          definition.id, definition.source.startFrameIndex + index, time))}
        disabled={locked} requireReady includeInternalFrames sourceAddresses testId="graphic-instance" />
      <div className="graphic-face-pagination">
        <time>{formatTimecode(currentTimeMs)}</time>
        {key ? <Button variant="secondary" disabled={locked} onClick={() =>
          edit('清除元件显示帧切换', (project, time) =>
            clearGraphicFrameAtTime(project, shot.id, layerId, definition.id, time, key.id))
        }>清除这次切换</Button> : null}
      </div>
      {!locked && resolveFlaGraphicPreviewTimeline(definition, true).totalFrames > 1
        ? <GraphicPlaybackSync project={project} definition={definition} shot={shot} layer={layer}
            timeMs={currentTimeMs} onCommit={edit} />
        : null}
    </> : null}
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}

function GraphicPlaybackSync({ project, definition, shot, layer, timeMs, onCommit }: {
  project: Project;
  definition: FlaGraphicDefinition;
  shot: Shot;
  layer: Layer;
  timeMs: number;
  onCommit: (description: string, change: (project: Project, timeMs: number) => Project) => void;
}): React.JSX.Element | null {
  const [expanded, setExpanded] = useState(false);
  const [endDraft, setEndDraft] = useState<string>();
  const [playbackDraft, setPlaybackDraft] = useState<AnimationPlayback>();
  const [firstDraft, setFirstDraft] = useState<string>();
  const [rangeStartDraft, setRangeStartDraft] = useState<string>();
  const [rangeEndDraft, setRangeEndDraft] = useState<string>();
  const [closingReference, setClosingReference] = useState(false);
  const context = expanded ? getGraphicPlaybackSyncContext(project, shot, layer, timeMs) : null;
  return <details data-testid="graphic-playback-sync" onToggle={(event) => setExpanded(event.currentTarget.open)}>
    <summary>向后同步</summary>
    {context && context.endMs > context.startMs ? renderSettings(context) : expanded
      ? <p role="status">播放头处没有可同步的片段。</p>
      : null}
  </details>;

  function renderSettings(context: NonNullable<ReturnType<typeof getGraphicPlaybackSyncContext>>): React.JSX.Element {
  const { range, firstFrame, playback } = context.settings;
  const firstAddress = definition.source.startFrameIndex + 1;
  const startText = firstDraft ?? String(firstFrame + firstAddress);
  const rangeStartText = rangeStartDraft ?? String(range.firstFrame + firstAddress);
  const rangeEndText = rangeEndDraft ?? String(range.lastFrame + firstAddress);
  const endText = endDraft ?? String(context.endMs / 1_000);
  const selection = playbackDraft ?? playback;
  const mode = selection.mode === 'once' ? `once-${selection.endBehavior}` : selection.mode;
  const sourceStart = Number(rangeStartText) - firstAddress;
  const sourceEnd = Number(rangeEndText) - firstAddress - Number(closingReference);
  const sourceFirst = Number(startText) - firstAddress;
  const endTime = parseAnimationStartTime(endText, shot.durationMs);
  const valid = endTime.kind === 'valid' && endTime.startTimeMs > context.startMs &&
    [sourceStart, sourceEnd, sourceFirst].every(Number.isSafeInteger) &&
    sourceStart >= 0 && sourceStart <= sourceFirst && sourceFirst <= sourceEnd &&
    Number(rangeEndText) - firstAddress < context.totalFrames;
  const lastAddress = firstAddress + context.totalFrames - 1;
  return <div className="graphic-face-picker">
      <label className="animation-playback-field">结束时间（秒）
        <input type="number" step="0.001" min={context.startMs / 1_000} max={shot.durationMs / 1_000}
          value={endText} onChange={(event) => setEndDraft(event.target.value)} />
      </label>
      {endTime.kind === 'valid' && endTime.startTimeMs > context.endMs ? <time>{formatTimecode(context.endMs)} 停止</time> : null}
      <label className="animation-playback-field">播放方式
        <select value={mode} onChange={(event) => {
          const value = event.target.value;
          setPlaybackDraft(value === 'loop' || value === 'single-frame'
            ? { mode: value, endBehavior: 'hold' }
            : { mode: 'once', endBehavior: value === 'once-hide' ? 'hide' : 'hold' });
        }}>
          <option value="single-frame">单帧</option>
          <option value="loop">循环</option>
          <option value="once-hold">单次 · 定格</option>
          <option value="once-hide">单次 · 隐藏</option>
        </select>
      </label>
      <label className="animation-playback-field">起始帧
        <input type="number" min={firstAddress} max={lastAddress} value={startText}
          onChange={(event) => setFirstDraft(event.target.value)} />
      </label>
      <details>
        <summary>源帧范围</summary>
        <label className="animation-playback-field">首帧
          <input type="number" min={firstAddress} max={lastAddress} value={rangeStartText}
            onChange={(event) => setRangeStartDraft(event.target.value)} />
        </label>
        <label className="animation-playback-field">尾帧
          <input type="number" min={firstAddress} max={lastAddress} value={rangeEndText}
            onChange={(event) => setRangeEndDraft(event.target.value)} />
        </label>
        <label><input type="checkbox" checked={closingReference} onChange={(event) => setClosingReference(event.target.checked)} />尾帧仅作闭合参考</label>
      </details>
      <Button disabled={!valid} onClick={() => {
        if (!valid || endTime.kind !== 'valid') return;
        onCommit('同步元件播放范围', (latest, time) => syncGraphicPlaybackForward(latest, shot.id, layer.id, definition.id,
          time, endTime.startTimeMs, { firstFrame: sourceFirst,
            range: { firstFrame: sourceStart, lastFrame: sourceEnd }, playback: selection }));
      }}>同步到结束时间</Button>
    </div>;
  }
}
