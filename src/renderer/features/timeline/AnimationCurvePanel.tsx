import { useEffect, useRef, useState, type PointerEvent } from 'react';
import {
  animationTargetIdentity, editAnimationPropertyKey, evaluateAnimationEase, keySelectedAnimationTargets, resolveTimelineFrameTime,
  type AnimationBezier, type AnimationInterpolation, type AnimationKey, type Layer, type Shot,
  type AnimationTargetRef,
} from '../../../domain';
import { editorProjectStore, type EditorProjectSnapshot } from '../../stores/EditorProjectStore';
import { selectionStore } from '../../stores/selectionStore';
import { shotStore } from '../../stores/shotStore';
import { Button } from '../../ui';
import type { AnimationCurveDraft } from './AnimationCurveDraft';
import { formatTimecode } from './timeGeometry';
import { useTimelineUi } from './timelineUiStore';

const presets: Readonly<Record<AnimationInterpolation, string>> = {
  linear: '线性', 'ease-in': '缓入', 'ease-out': '缓出', 'ease-in-out': '缓入缓出', step: '保持',
};
const properties = {
  'transform.offsetX': '位置 X', 'transform.offsetY': '位置 Y',
  'transform.scaleX': '缩放 X', 'transform.scaleY': '缩放 Y', 'transform.rotationDeg': '旋转',
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

export function AnimationCurvePanel({ snapshot, shot, layer, onDraft, onClose }: {
  snapshot: EditorProjectSnapshot;
  shot: Shot;
  layer: Layer;
  onDraft?: (draft: AnimationCurveDraft | null) => void;
  onClose: () => void;
}): React.JSX.Element {
  const tracks = layer.animationClip?.tracks ?? [];
  const [trackId, setTrackId] = useState('');
  const [keyTime, setKeyTime] = useState(0);
  const [handles, setHandles] = useState<AnimationBezier>();
  const [error, setError] = useState('');
  const [selectedTargets, setSelectedTargets] = useState<readonly string[]>([]);
  const { currentTimeMs } = useTimelineUi();
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const instance = editorProjectStore.getProjectInstanceId();
  const trackKey = (entry: (typeof tracks)[number]) => JSON.stringify([entry.property, animationTargetIdentity(entry.target)]);
  const track = tracks.find((entry) => trackKey(entry) === trackId) ?? tracks[0];
  const targets = layer.animationClip?.targetBases.map(({ target }) => target) ?? [];
  const selected = targets.filter((target) => selectedTargets.includes(animationTargetIdentity(target)));
  const index = Math.max(0, track?.keys.findIndex(({ timeMs }) => timeMs === keyTime) ?? 0);
  const key = track?.keys[index];
  const next = track?.keys[index + 1];
  const curve = handles ? { bezier: handles } : key?.curveToNext;
  const points = handles ?? key?.curveToNext?.bezier ?? defaults;
  const characterId = layer.source.kind === 'character' ? layer.source.characterId : null;
  const character = snapshot.project.characters.find(({ id }) => id === characterId);
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
  const polyline = Array.from({ length: 65 }, (_, i) => {
    const x = i / 64;
    return `${toX(x)},${toY(evaluateAnimationEase(x, key?.interpolationToNext ?? 'linear', curve))}`;
  }).join(' ');

  useEffect(() => () => onDraft?.(null), [onDraft]);

  function cancel(): void {
    const active = drag.current;
    drag.current = null;
    if (active && svg.current?.hasPointerCapture(active.pointer)) svg.current.releasePointerCapture(active.pointer);
    onDraft?.(null);
    setHandles(undefined);
  }

  function current(revision = snapshot.revision, owner = instance) {
    const state = editorProjectStore.getSnapshot();
    return state?.revision === revision && editorProjectStore.getProjectInstanceId() === owner &&
      shotStore.getCurrentShotId() === shot.id && selectionStore.getSelectedLayerId() === layer.id ? state : null;
  }

  function edit(change: Partial<AnimationKey>, project = snapshot.project) {
    if (!key || !track) return project;
    return editAnimationPropertyKey(project, {
      shotId: shot.id, target: track.target, property: track.property, keyTimeMs: key.timeMs,
    }, change);
  }

  function commit(change: Partial<AnimationKey>): void {
    const state = current();
    if (!state) return;
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
    if (!active || event.pointerId !== active.pointer || !key || !next) return;
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
    if (event.button !== 0 || !next || layer.locked || !current() || !svg.current) return;
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

  return <section className="animation-curve-panel" aria-label="属性曲线" onKeyDown={(event) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    if (drag.current) cancel(); else onClose();
  }}>
    <header><strong>属性曲线</strong><Button variant="secondary" onClick={() => { cancel(); onClose(); }}>关闭</Button></header>
    {track && key ? <>
      <div className="animation-curve-fields">
        <label>属性<select value={trackKey(track)} onChange={(event) => { cancel(); setTrackId(event.target.value); setKeyTime(0); }}>
          {tracks.map((entry) => <option key={trackKey(entry)} value={trackKey(entry)}>
            {targetLabel(entry.target)} · {properties[entry.property]}
          </option>)}
        </select></label>
        <label>关键帧<select value={key.timeMs} onChange={(event) => { cancel(); setKeyTime(Number(event.target.value)); }}>
          {track.keys.map(({ timeMs }) => <option key={timeMs} value={timeMs}>{formatTimecode(timeMs)}</option>)}
        </select></label>
        <label>帧时间 (ms)<input key={`time-${key.timeMs}`} type="number" min={0} max={shot.durationMs}
          disabled={layer.locked || index === 0} defaultValue={key.timeMs} onBlur={(event) => {
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
      </div>
      {next ? <svg ref={svg} viewBox="0 0 320 128" aria-label="区段贝塞尔曲线" className="animation-curve-graph"
        onPointerMove={move} onPointerCancel={cancel} onLostPointerCapture={cancel} onPointerUp={(event) => {
          const active = drag.current;
          if (!active || active.pointer !== event.pointerId) return;
          const state = current(active.revision, active.projectInstanceId);
          cancel();
          if (state && active.draft && active.draft.project !== state.project) {
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
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}
