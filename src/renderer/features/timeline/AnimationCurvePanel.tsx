import { useEffect, useRef, useState, type PointerEvent } from 'react';
import {
  RICH_EASING_DIRECTIONS, RICH_EASING_FAMILIES, animationTargetIdentity, bakeRichEasingToPropertySegments,
  characterFaceAndMouthPartIds, editAnimationPropertyKey, editOpacityEventKey, evaluateAnimationEase,
  evaluateRichEasing, getRichEasingPropertyApplicability, keySelectedAnimationTargets,
  resolveTimelineFrameTime, retimeAnimationPropertyRange, richEasingPresetId, saveLayeredCharacterAction,
  type AnimationBezier, type AnimationInterpolation, type AnimationKey, type Layer, type RichEasingDirection,
  type RichEasingFamily, type RichEasingPresetId, type Shot, type AnimationTargetRef, type AnimationTrack,
} from '../../../domain';
import { editorProjectStore, type EditorProjectSnapshot } from '../../stores/EditorProjectStore';
import { selectionStore } from '../../stores/selectionStore';
import { shotStore } from '../../stores/shotStore';
import { Button } from '../../ui';
import { AnimationKeyRangeControls } from './AnimationKeyRangeControls';
import type { AnimationCurveDraft } from './AnimationCurveDraft';
import { formatTimecode } from './timeGeometry';
import { useTimelineUi } from './timelineUiStore';

const presets: Readonly<Record<AnimationInterpolation, string>> = {
  linear: '线性', 'ease-in': '缓入', 'ease-out': '缓出', 'ease-in-out': '缓入缓出', step: '保持',
};
const richFamilyLabels: Readonly<Record<RichEasingFamily, string>> = {
  sin: '正弦', cubic: '三次方', circle: '圆形', quint: '五次方', back: '过冲', bounce: '弹跳',
};
const richDirectionLabels: Readonly<Record<RichEasingDirection, string>> = {
  in: '缓入', out: '缓出', 'in-out': '缓入缓出',
};
const properties = {
  'transform.offsetX': '位置 X', 'transform.offsetY': '位置 Y',
  'transform.scaleX': '缩放 X', 'transform.scaleY': '缩放 Y', 'transform.rotationDeg': '旋转',
  opacity: '透明度',
};
const defaults: AnimationBezier = { x1: 1 / 3, y1: 1 / 3, x2: 2 / 3, y2: 2 / 3 };
const chart = { left: 20, top: 14, width: 280, height: 100 };
const toX = (x: number) => chart.left + x * chart.width;
const toY = (y: number) => chart.top + (1 - y) * chart.height;
const clamp = (value: number) => Math.min(1, Math.max(0, value));

type Drag = {
  pointer: number;
  handle: 'first' | 'second';
  revision: number;
  projectInstanceId: number | null;
  handles: AnimationBezier;
  draft?: AnimationCurveDraft;
};
type CurveTrack = AnimationTrack | {
  property: 'opacity';
  target: AnimationTargetRef;
  eventId: string;
  keys: AnimationKey[];
};
type RichEasingSelection = {
  projectInstanceId: number | null;
  shotId: string;
  layerId: string;
  trackKey: string;
  startMs: number;
  endMs: number;
};
type RichEasingDraftBinding = {
  projectInstanceId: number | null;
  revision: number;
  shotId: string;
  layerId: string;
  trackKey: string;
  startMs: number;
  endMs: number;
  keyTimesMs: readonly number[];
  presetId: RichEasingPresetId;
};

export function hasAnimationCurveTracks(shot: Shot, layer: Layer): boolean {
  return Boolean(layer.animationClip?.tracks.length || shot.timelineEvents.some(
    (event) => event.layerId === layer.id && event.type === 'opacity' && event.endMs > event.startMs,
  ));
}

export function AnimationCurvePanel({ snapshot, shot, layer, onDraft, onClose }: {
  snapshot: EditorProjectSnapshot;
  shot: Shot;
  layer: Layer;
  onDraft?: (draft: AnimationCurveDraft | null) => void;
  onClose?: () => void;
}): React.JSX.Element {
  const tracks: CurveTrack[] = [...(layer.animationClip?.tracks ?? [])];
  for (const event of shot.timelineEvents) {
    if (event.layerId !== layer.id || event.type !== 'opacity' || event.endMs <= event.startMs) continue;
    tracks.push({
      property: 'opacity', target: { kind: 'layer', layerId: layer.id }, eventId: event.id,
      keys: [
        { timeMs: event.startMs, value: event.from, interpolationToNext: event.easing, curveToNext: event.curveToNext },
        { timeMs: event.endMs, value: event.to, interpolationToNext: 'linear' },
      ],
    });
  }
  const [trackId, setTrackId] = useState('');
  const [keyTime, setKeyTime] = useState(0);
  const [handles, setHandles] = useState<AnimationBezier>();
  const [error, setError] = useState('');
  const [selectedTargets, setSelectedTargets] = useState<readonly string[]>([]);
  const [rangeStart, setRangeStart] = useState(0);
  const [rangeEnd, setRangeEnd] = useState<number>();
  const [rangeMode, setRangeMode] = useState<'move' | 'scale' | 'hold'>('move');
  const [rangeFrames, setRangeFrames] = useState(1);
  const [actionName, setActionName] = useState('');
  const [headAnchor, setHeadAnchor] = useState('');
  const [richFamily, setRichFamily] = useState<RichEasingFamily>('cubic');
  const [richDirection, setRichDirection] = useState<RichEasingDirection>('in-out');
  const [richSelection, setRichSelection] = useState<RichEasingSelection | null>(null);
  const [richDraft, setRichDraft] = useState<RichEasingDraftBinding | null>(null);
  const { currentTimeMs } = useTimelineUi();
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const instance = editorProjectStore.getProjectInstanceId();
  const trackKey = (entry: CurveTrack) => entry.property === 'opacity' ? entry.eventId
    : JSON.stringify([entry.property, animationTargetIdentity(entry.target)]);
  const track = tracks.find((entry) => trackKey(entry) === trackId) ?? tracks[0];
  const currentTrackKey = track ? trackKey(track) : '';
  const targets = layer.animationClip?.targetBases.map(({ target }) => target) ?? [];
  const selected = targets.filter((target) => selectedTargets.includes(animationTargetIdentity(target)));
  const index = Math.max(0, track?.keys.findIndex(({ timeMs }) => timeMs === keyTime) ?? 0);
  const key = track?.keys[index];
  const next = track?.keys[index + 1];
  const rangeKeys = track?.keys ?? [];
  const startMs = rangeKeys.some(({ timeMs }) => timeMs === rangeStart) ? rangeStart : 0;
  const endMs = rangeKeys.some(({ timeMs }) => timeMs === rangeEnd) ? rangeEnd! : (rangeKeys.at(-1)?.timeMs ?? 0);
  const scopedRichSelection = richSelection &&
    richSelection.projectInstanceId === instance &&
    richSelection.shotId === shot.id &&
    richSelection.layerId === layer.id &&
    richSelection.trackKey === currentTrackKey
    ? richSelection : null;
  const defaultRichStart = next ? key!.timeMs : (rangeKeys[Math.max(0, index - 1)]?.timeMs ?? 0);
  const defaultRichEnd = next ? next.timeMs : (rangeKeys[Math.max(1, index)]?.timeMs ?? defaultRichStart);
  const richStartMissing = scopedRichSelection !== null &&
    !rangeKeys.some(({ timeMs }) => timeMs === scopedRichSelection.startMs);
  const richEndMissing = scopedRichSelection !== null &&
    !rangeKeys.some(({ timeMs }) => timeMs === scopedRichSelection.endMs);
  const hasStaleRichSelection = richStartMissing || richEndMissing;
  const effectiveRichStart = scopedRichSelection ? scopedRichSelection.startMs : defaultRichStart;
  const effectiveRichEnd = scopedRichSelection ? scopedRichSelection.endMs : defaultRichEnd;
  const richKeyTimes = !hasStaleRichSelection && effectiveRichEnd > effectiveRichStart
    ? rangeKeys.filter(({ timeMs }) => timeMs >= effectiveRichStart && timeMs <= effectiveRichEnd).map(({ timeMs }) => timeMs)
    : [];
  const richSegmentCount = Math.max(0, richKeyTimes.length - 1);
  const richPresetId = richEasingPresetId(richFamily, richDirection);
  const richDraftOnLayer = Boolean(
    richDraft &&
    richDraft.projectInstanceId === instance &&
    richDraft.shotId === shot.id &&
    richDraft.layerId === layer.id,
  );
  const requestedTrackKey = trackId || (richDraftOnLayer ? richDraft?.trackKey : undefined);
  const trackMissing = Boolean(requestedTrackKey && requestedTrackKey !== currentTrackKey);
  const trackReadOnly = layer.locked || trackMissing;
  const richDraftMatchesCurrent = Boolean(
    richDraftOnLayer && !trackMissing &&
    richDraft &&
    richDraft.revision === snapshot.revision &&
    !hasStaleRichSelection &&
    richDraft.startMs === effectiveRichStart &&
    richDraft.endMs === effectiveRichEnd &&
    richDraft.presetId === richPresetId &&
    richDraft.keyTimesMs.length === richKeyTimes.length &&
    richDraft.keyTimesMs.every((timeMs, idx) => timeMs === richKeyTimes[idx]),
  );
  const richDraftActive = richDraftMatchesCurrent;
  const hasStaleRichDraft = Boolean(richDraft && !richDraftMatchesCurrent);
  const richDraftStatus = richDraftActive ? 'active' : hasStaleRichDraft ? 'stale' : 'idle';
  const richApplicability = track
    ? getRichEasingPropertyApplicability(track.property, richPresetId)
    : { applicable: false, reason: '当前没有可编辑轨道。' };
  const canApplyRichEasing = Boolean(
    track && !layer.locked && richApplicability.applicable && richSegmentCount > 0 &&
    !hasStaleRichSelection && !hasStaleRichDraft,
  );
  const curve = handles ? { bezier: handles } : key?.curveToNext;
  const points = handles ?? key?.curveToNext?.bezier ?? defaults;
  const characterId = layer.source.kind === 'character' ? layer.source.characterId : null;
  const character = snapshot.project.characters.find(({ id }) => id === characterId);
  const protectedParts = character?.mode === 'adaptive-parts' ? characterFaceAndMouthPartIds(character) : undefined;
  const selectedParts = selected.filter(target => target.kind === 'character-part')
    .filter(target => !protectedParts?.has(target.partId));
  const headAnchors = selectedParts.filter(target => tracks.some(entry => entry.target.kind === 'character-part' && entry.target.partId === target.partId));
  function targetLabel(target: AnimationTargetRef): string {
    if (target.kind === 'layer') return layer.name;
    const node = target.kind === 'character-node' ? target.nodeId : null;
    if (node === 'root') return '角色';
    if (node === 'body') return '身体';
    if (node === 'head') return '头部';
    if (node === 'face') return '脸部';
    const partId = target.kind === 'character-part' ? target.partId : node?.slice('part:'.length);
    const part = character?.mode === 'adaptive-parts' ? character.parts.find((candidate) => candidate.partId === partId) : null;
    if (part?.displayName) return part.displayName;
    const partIndex = layer.animationClip?.targetBases.findIndex((basis) => animationTargetIdentity(basis.target) === animationTargetIdentity(target)) ?? -1;
    return `部件 ${partIndex + 1}`;
  }
  const curveSamples = Array.from({ length: 65 }, (_, i) => {
    const x = i / 64;
    const y = richDraftActive
      ? evaluateRichEasing(richPresetId, x)
      : evaluateAnimationEase(x, key?.interpolationToNext ?? 'linear', curve);
    return { x, y };
  });
  const minY = Math.min(0, ...curveSamples.map(({ y }) => y));
  const maxY = Math.max(1, ...curveSamples.map(({ y }) => y));
  const ySpan = Math.max(1, maxY - minY);
  const toPreviewY = (y: number) => chart.top + (1 - (y - minY) / ySpan) * chart.height;
  const polyline = curveSamples.map(({ x, y }) => `${toX(x)},${toPreviewY(y)}`).join(' ');

  useEffect(() => () => onDraft?.(null), [onDraft]);
  useEffect(() => {
    if (!hasStaleRichDraft) return;
    onDraft?.(null);
    if (!richDraftOnLayer) setRichDraft(null);
  }, [hasStaleRichDraft, richDraftOnLayer, onDraft]);

  function cancel(): void {
    const active = drag.current;
    drag.current = null;
    if (active && svg.current?.hasPointerCapture(active.pointer)) svg.current.releasePointerCapture(active.pointer);
    onDraft?.(null);
    setHandles(undefined);
    setRichDraft(null);
  }

  function current(revision = snapshot.revision, owner = instance) {
    const state = editorProjectStore.getSnapshot();
    return state?.revision === revision && editorProjectStore.getProjectInstanceId() === owner &&
      shotStore.getCurrentShotId() === shot.id && selectionStore.getSelectedLayerId() === layer.id ? state : null;
  }

  function edit(change: Partial<AnimationKey>, project = snapshot.project) {
    if (!key || !track) return project;
    if (track.property === 'opacity') return editOpacityEventKey(project, shot.id, layer.id, track.eventId, key.timeMs, change);
    return editAnimationPropertyKey(project, {
      shotId: shot.id, target: track.target, property: track.property, keyTimeMs: key.timeMs,
    }, change);
  }

  function commit(change: Partial<AnimationKey>): void {
    const state = current();
    if (!state || trackReadOnly) return;
    try {
      const project = edit(change, state.project);
      if (project !== state.project) editorProjectStore.updateProject(project, '编辑属性曲线');
      if (change.timeMs !== undefined) setKeyTime(change.timeMs);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法编辑关键帧。');
    }
  }

  function move(event: PointerEvent<SVGSVGElement>): void {
    const active = drag.current;
    if (!active || event.pointerId !== active.pointer || !key || !next || trackReadOnly) return;
    const state = current(active.revision, active.projectInstanceId);
    const matrix = event.currentTarget.getScreenCTM();
    if (!state || !matrix) { cancel(); return; }
    const location = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    const x = clamp((location.x - chart.left) / chart.width);
    const y = clamp(1 - (location.y - chart.top) / chart.height);
    const adjusted = active.handle === 'first'
      ? { ...active.handles, x1: Math.min(x, active.handles.x2), y1: y }
      : { ...active.handles, x2: Math.max(x, active.handles.x1), y2: y };
    if (adjusted.x1 === active.handles.x1 && adjusted.x2 === active.handles.x2 &&
      adjusted.y1 === active.handles.y1 && adjusted.y2 === active.handles.y2) return;
    try {
      const project = edit({ curveToNext: { bezier: adjusted } }, state.project);
      active.handles = adjusted;
      active.draft = {
        project, projectInstanceId: active.projectInstanceId, revision: active.revision,
        shotId: shot.id, layerId: layer.id,
        timeMs: Math.round(key.timeMs + (next.timeMs - key.timeMs) * Math.min(0.95, Math.max(0.05, x))),
      };
      setHandles(adjusted);
      onDraft?.(active.draft);
      setError('');
    } catch (cause) {
      cancel();
      setError(cause instanceof Error ? cause.message : '无法调整曲线。');
    }
  }

  function begin(event: PointerEvent<SVGCircleElement>, handle: Drag['handle']): void {
    if (event.button !== 0 || !next || trackReadOnly || !current() || !svg.current) return;
    if (drag.current) cancel();
    event.preventDefault();
    event.currentTarget.focus();
    svg.current.setPointerCapture(event.pointerId);
    drag.current = { pointer: event.pointerId, handle, revision: snapshot.revision, projectInstanceId: instance, handles: points };
  }

  function keySelected(): void {
    const state = current();
    if (!state || !selected.length) return;
    try {
      const time = resolveTimelineFrameTime(currentTimeMs, shot.durationMs);
      const result = keySelectedAnimationTargets(state.project, shot.id, layer.id, selected, time);
      if (result.project !== state.project) {
        editorProjectStore.updateProject(result.project, '记录所选部件的姿势');
        setKeyTime(time);
      }
      setError(result.skipped ? `${result.skipped} 个所选部件没有可记录的属性轨。` : '');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法记录所选部件。');
    }
  }

  function previewRichEasing(
    family: RichEasingFamily,
    direction: RichEasingDirection,
    scopeStart: number,
    scopeEnd: number,
  ): void {
    const state = current();
    if (!state || !track || layer.locked || trackMissing) return;
    const presetId = richEasingPresetId(family, direction);
    const applicability = getRichEasingPropertyApplicability(track.property, presetId);
    const hasStart = track.keys.some(({ timeMs }) => timeMs === scopeStart);
    const hasEnd = track.keys.some(({ timeMs }) => timeMs === scopeEnd);
    const keyTimesMs = hasStart && hasEnd && scopeEnd > scopeStart
      ? track.keys.filter(({ timeMs }) => timeMs >= scopeStart && timeMs <= scopeEnd).map(({ timeMs }) => timeMs)
      : [];
    if (!applicability.applicable || keyTimesMs.length < 2) {
      setRichDraft(null);
      onDraft?.(null);
      return;
    }
    try {
      const result = bakeRichEasingToPropertySegments(state.project, {
        shotId: shot.id,
        target: track.target,
        property: track.property,
        presetId,
        keyTimesMs,
      });
      const previewTimeMs = currentTimeMs >= keyTimesMs[0]! && currentTimeMs <= keyTimesMs.at(-1)!
        ? currentTimeMs
        : Math.round((keyTimesMs[0]! + keyTimesMs.at(-1)!) / 2);
      setRichDraft({
        projectInstanceId: instance,
        revision: state.revision,
        shotId: shot.id,
        layerId: layer.id,
        trackKey: currentTrackKey,
        startMs: scopeStart,
        endMs: scopeEnd,
        keyTimesMs,
        presetId,
      });
      onDraft?.({
        project: result.project,
        projectInstanceId: instance,
        revision: state.revision,
        shotId: shot.id,
        layerId: layer.id,
        timeMs: previewTimeMs,
      });
      setError('');
    } catch (cause) {
      setRichDraft(null);
      onDraft?.(null);
      setError(cause instanceof Error ? cause.message : '无法预览丰富缓动。');
    }
  }

  function applyRichEasing(): void {
    if (!track || !canApplyRichEasing) return;
    const state = richDraft
      ? current(richDraft.revision, richDraft.projectInstanceId)
      : current();
    if (!state) {
      onDraft?.(null);
      return;
    }
    if (richDraft && (
      richDraft.shotId !== shot.id ||
      richDraft.layerId !== layer.id ||
      richDraft.trackKey !== currentTrackKey ||
      richDraft.presetId !== richPresetId ||
      richDraft.startMs !== effectiveRichStart ||
      richDraft.endMs !== effectiveRichEnd ||
      richDraft.keyTimesMs.length !== richKeyTimes.length ||
      !richDraft.keyTimesMs.every((timeMs, idx) => timeMs === richKeyTimes[idx])
    )) {
      onDraft?.(null);
      return;
    }
    try {
      const result = bakeRichEasingToPropertySegments(state.project, {
        shotId: shot.id,
        target: track.target,
        property: track.property,
        presetId: richPresetId,
        keyTimesMs: richKeyTimes,
      });
      setRichDraft(null);
      onDraft?.(null);
      if (result.project !== state.project) {
        editorProjectStore.updateProject(result.project, '应用丰富缓动');
      }
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法应用丰富缓动。');
    }
  }

  function retime(): void {
    const state = current();
    if (!state || !track || trackReadOnly || track.property === 'opacity') return;
    try {
      const project = retimeAnimationPropertyRange(state.project,
        { shotId: shot.id, target: track.target, property: track.property },
        { startMs, endMs, mode: rangeMode, frames: rangeFrames });
      if (project !== state.project) editorProjectStore.updateProject(project, '调整属性选段时间');
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法调整选段时间。');
    }
  }

  function cancelPropertyDraft(): void {
    cancel();
    if (trackMissing) {
      setTrackId('');
      setKeyTime(0);
    }
    if (trackMissing || hasStaleRichSelection) setRichSelection(null);
  }

  return <section className="animation-curve-panel" aria-label="属性曲线" onKeyDown={(event) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    if (drag.current || richDraft !== null || hasStaleRichSelection || trackMissing) {
      cancelPropertyDraft();
    } else onClose?.();
  }}>
    {onClose && <header><strong>属性曲线</strong><Button variant="secondary" onClick={() => { cancel(); onClose(); }}>关闭</Button></header>}
    {tracks.length || trackMissing ? <div className="animation-curve-fields">
        <label>属性<select value={trackMissing ? '' : currentTrackKey} onChange={(event) => {
          cancel(); setTrackId(event.target.value); setKeyTime(0); setRichSelection(null);
        }}>
          {trackMissing ? <option value="" disabled>原属性已失效</option> : null}
          {tracks.map((entry) => <option key={trackKey(entry)} value={trackKey(entry)}>
            {targetLabel(entry.target)} · {properties[entry.property]}
            {entry.property === 'opacity' ? ` ${formatTimecode(entry.keys[0]!.timeMs)}` : ''}
          </option>)}
        </select></label>
        {track && key && !trackMissing ? <>
        <label>关键帧<select value={key.timeMs} onChange={(event) => {
          cancel(); setKeyTime(Number(event.target.value)); setRichSelection(null);
        }}>
          {track.keys.map(({ timeMs }) => <option key={timeMs} value={timeMs}>{formatTimecode(timeMs)}</option>)}
        </select></label>
        <label>帧时间 (ms)<input key={`time-${key.timeMs}`} type="number" min={0} max={shot.durationMs}
          disabled={layer.locked || (index === 0 && track.property !== 'opacity')} defaultValue={key.timeMs} onBlur={(event) => {
            if (event.target.value !== '') commit({ timeMs: resolveTimelineFrameTime(Number(event.target.value), shot.durationMs) });
          }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></label>
        <label>值<input key={`value-${key.timeMs}-${key.value}`} type="number" step="any" disabled={layer.locked}
          defaultValue={key.value} onBlur={(event) => { if (event.target.value !== '') commit({ value: Number(event.target.value) }); }}
          onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></label>
        {next ? <label>插值<select disabled={layer.locked} value={curve ? 'custom' : key.interpolationToNext}
          onChange={(event) => commit({ interpolationToNext: event.target.value as AnimationInterpolation, curveToNext: undefined })}>
          {curve ? <option value="custom" disabled>自定义</option> : null}
          {Object.entries(presets).map(([value, title]) => <option key={value} value={value}>{title}</option>)}
        </select></label> : null}
        </> : null}
      </div> : null}
    {trackMissing ? <div>
      <p role="status">原属性轨已失效，请重新选择属性或取消预览</p>
      <Button variant="secondary" data-testid="rich-easing-cancel" onClick={cancelPropertyDraft}>取消</Button>
    </div> : null}
    {track && key && !trackMissing ? <>
      {next ? <svg ref={svg} viewBox="0 0 320 128" aria-label="区段贝塞尔曲线" className="animation-curve-graph"
        onPointerMove={move} onPointerCancel={cancel} onLostPointerCapture={cancel} onPointerUp={(event) => {
          const active = drag.current;
          if (!active || active.pointer !== event.pointerId) return;
          const state = current(active.revision, active.projectInstanceId);
          cancel();
          if (state && !trackReadOnly && active.draft && active.draft.project !== state.project) {
            editorProjectStore.updateProject(active.draft.project, '调整属性曲线');
          }
        }}>
        <rect x={chart.left} y={chart.top} width={chart.width} height={chart.height} />
        <polyline points={polyline} className="animation-curve-line" />
        <line x1={toX(0)} y1={toY(0)} x2={toX(points.x1)} y2={toY(points.y1)} />
        <line x1={toX(1)} y1={toY(1)} x2={toX(points.x2)} y2={toY(points.y2)} />
        <circle cx={toX(points.x1)} cy={toY(points.y1)} r={7} data-curve-handle="first" tabIndex={-1} onPointerDown={(event) => begin(event, 'first')} />
        <circle cx={toX(points.x2)} cy={toY(points.y2)} r={7} data-curve-handle="second" tabIndex={-1} onPointerDown={(event) => begin(event, 'second')} />
      </svg> : null}
      {rangeKeys.length > 1 ? <details className="animation-key-selection" open data-testid="rich-easing-section"
        data-rich-easing-draft={richDraftStatus}>
        <summary>丰富缓动</summary>
        {!richApplicability.applicable ? (
          <p className="animation-rich-easing-meta" data-testid="rich-easing-inapplicable">
            {richApplicability.reason ?? '当前属性不支持丰富缓动。'}
          </p>
        ) : layer.locked ? (
          <p className="animation-rich-easing-meta" data-testid="rich-easing-locked">
            当前图层已锁定，解锁后可应用丰富缓动。
          </p>
        ) : (
          <p className="animation-rich-easing-meta" data-testid="rich-easing-scope">
            {hasStaleRichSelection
              ? '原选区端点已失效，请重新选择起止帧后再应用'
              : hasStaleRichDraft
                ? '工程已变更，旧预览已失效，请重新预览或取消后再应用'
                : richSegmentCount > 0
                  ? `替换 ${richSegmentCount} 段（${formatTimecode(effectiveRichStart)} → ${formatTimecode(effectiveRichEnd)}），保留原有关键帧`
                  : '请选择结束帧晚于起始帧的区段'}
          </p>
        )}
        <div className="animation-rich-easing-fields">
          <label>缓动类型<select data-testid="rich-easing-family" disabled={layer.locked || !richApplicability.applicable}
            value={richFamily} onChange={(event) => {
              const nextFamily = event.target.value as RichEasingFamily;
              setRichFamily(nextFamily);
              if (!hasStaleRichSelection) previewRichEasing(nextFamily, richDirection, effectiveRichStart, effectiveRichEnd);
            }}>
            {RICH_EASING_FAMILIES.map((family) => <option key={family} value={family}>{richFamilyLabels[family]}</option>)}
          </select></label>
          <label>方向<select data-testid="rich-easing-direction" disabled={layer.locked || !richApplicability.applicable}
            value={richDirection} onChange={(event) => {
              const nextDirection = event.target.value as RichEasingDirection;
              setRichDirection(nextDirection);
              if (!hasStaleRichSelection) previewRichEasing(richFamily, nextDirection, effectiveRichStart, effectiveRichEnd);
            }}>
            {RICH_EASING_DIRECTIONS.map((direction) => <option key={direction} value={direction}>{richDirectionLabels[direction]}</option>)}
          </select></label>
          <label>起始帧<select data-testid="rich-easing-start" disabled={layer.locked || !richApplicability.applicable}
            value={richStartMissing ? '' : effectiveRichStart} onChange={(event) => {
              const nextStart = Number(event.target.value);
              if (!Number.isFinite(nextStart)) return;
              const nextEnd = scopedRichSelection ? scopedRichSelection.endMs : effectiveRichEnd;
              setRichSelection({
                projectInstanceId: instance,
                shotId: shot.id,
                layerId: layer.id,
                trackKey: currentTrackKey,
                startMs: nextStart,
                endMs: nextEnd,
              });
              if (!richEndMissing && richDraft !== null) previewRichEasing(richFamily, richDirection, nextStart, nextEnd);
            }}>
            {richStartMissing ? <option value="" disabled>原起点已失效</option> : null}
            {rangeKeys.map(({ timeMs }) => <option key={timeMs} value={timeMs}>{formatTimecode(timeMs)}</option>)}
          </select></label>
          <label>结束帧<select data-testid="rich-easing-end" disabled={layer.locked || !richApplicability.applicable}
            value={richEndMissing ? '' : effectiveRichEnd} onChange={(event) => {
              const nextEnd = Number(event.target.value);
              if (!Number.isFinite(nextEnd)) return;
              const nextStart = scopedRichSelection ? scopedRichSelection.startMs : effectiveRichStart;
              setRichSelection({
                projectInstanceId: instance,
                shotId: shot.id,
                layerId: layer.id,
                trackKey: currentTrackKey,
                startMs: nextStart,
                endMs: nextEnd,
              });
              if (!richStartMissing && richDraft !== null) previewRichEasing(richFamily, richDirection, nextStart, nextEnd);
            }}>
            {richEndMissing ? <option value="" disabled>原终点已失效</option> : null}
            {rangeKeys.map(({ timeMs }) => <option key={timeMs} value={timeMs}>{formatTimecode(timeMs)}</option>)}
          </select></label>
        </div>
        <div className="animation-rich-easing-actions">
          <Button data-testid="rich-easing-apply" disabled={!canApplyRichEasing} onClick={applyRichEasing}>应用</Button>
          {hasStaleRichDraft && !trackMissing && !hasStaleRichSelection && !layer.locked && richApplicability.applicable && richSegmentCount > 0 ? (
            <Button variant="secondary" data-testid="rich-easing-repreview" onClick={() => {
              previewRichEasing(richFamily, richDirection, effectiveRichStart, effectiveRichEnd);
            }}>重新预览</Button>
          ) : null}
          <Button variant="secondary" data-testid="rich-easing-cancel" disabled={richDraft === null && !hasStaleRichSelection} onClick={() => {
            cancel();
            if (hasStaleRichSelection) setRichSelection(null);
            setError('');
          }}>取消</Button>
        </div>
      </details> : null}
    </> : null}
    {targets.length ? <details className="animation-key-selection">
      <summary>所选部件落键</summary>
      <div className="animation-key-targets">
        {targets.map((target) => {
          const identity = animationTargetIdentity(target);
          return <label key={identity}><input type="checkbox" checked={selectedTargets.includes(identity)}
            onChange={(event) => {
              const checked = event.target.checked;
              setSelectedTargets((values) => checked ? [...values, identity] : values.filter((value) => value !== identity));
            }} />{targetLabel(target)}</label>;
        })}
      </div>
      <Button disabled={layer.locked || !selected.length} onClick={keySelected}>
        在 {formatTimecode(currentTimeMs)} 落键
      </Button>
    </details> : null}
    {track && !trackMissing && track.property !== 'opacity' ? <details className="animation-key-selection">
      <summary>选段时间</summary>
      <div className="animation-curve-fields">
        <label>起始关键帧<select value={startMs} onChange={(event) => setRangeStart(Number(event.target.value))}>
          {rangeKeys.map(({ timeMs }) => <option key={timeMs} value={timeMs}>{formatTimecode(timeMs)}</option>)}
        </select></label>
        <label>结束关键帧<select value={endMs} onChange={(event) => setRangeEnd(Number(event.target.value))}>
          {rangeKeys.map(({ timeMs }) => <option key={timeMs} value={timeMs}>{formatTimecode(timeMs)}</option>)}
        </select></label>
        <label>操作<select value={rangeMode} onChange={(event) => setRangeMode(event.target.value as typeof rangeMode)}>
          <option value="move">整体移动</option><option value="scale">等比改时</option><option value="hold">延长停留</option>
        </select></label>
        <label>{rangeMode === 'move' ? '移动帧数' : rangeMode === 'scale' ? '新时长（帧）' : '停留帧数'}
          <input type="number" step={1} min={rangeMode === 'move' ? undefined : 1} value={rangeFrames}
            onChange={(event) => setRangeFrames(Number(event.target.value))} />
        </label>
      </div>
      <Button disabled={layer.locked || startMs >= endMs || !Number.isSafeInteger(rangeFrames) ||
        (rangeMode === 'move' ? rangeFrames === 0 : rangeFrames < 1)} onClick={retime}>应用到当前属性</Button>
      <AnimationKeyRangeControls
        key={String(instance) + shot.id + layer.id}
        track={track} snapshot={snapshot} shotId={shot.id} durationMs={shot.durationMs}
        startMs={startMs} endMs={endMs} currentTimeMs={currentTimeMs} disabled={layer.locked || trackMissing} />
      {character?.mode === 'adaptive-parts' && selectedParts.length > 0 ? <div className="animation-curve-fields">
        <label>分件动作名称<input value={actionName} maxLength={64} onChange={event => setActionName(event.target.value)} /></label>
        <label>头部跟随<select value={headAnchors.some(part => part.partId === headAnchor) ? headAnchor : ''}
          onChange={event => setHeadAnchor(event.target.value)}>
          <option value="">无</option>
          {headAnchors.map(part => <option key={part.partId} value={part.partId}>{targetLabel(part)}</option>)}
        </select></label>
        <Button disabled={layer.locked || startMs >= endMs || !actionName.trim()} onClick={() => {
          try {
            const state = current();
            if (!state || trackReadOnly) return;
            const project = saveLayeredCharacterAction(state.project, shot.id, layer.id, {
              name: actionName, startMs, endMs, partIds: selectedParts.map(({ partId }) => partId),
              headAnchorPartId: headAnchors.some(part => part.partId === headAnchor) ? headAnchor : undefined,
            });
            editorProjectStore.updateProject(project, '保存分件动作');
            setActionName('');
            setError('');
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : '无法保存分件动作。');
          }
        }}>保存分件动作</Button>
      </div> : null}
    </details> : null}
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}
