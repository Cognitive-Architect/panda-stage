import { useRef, useState, type PointerEvent } from 'react';
import { Plus } from 'lucide-react';
import { ProjectSchema, setManualMouthPose, type MouthPoseEvent, type Project, type Shot } from '../../../domain';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { timelineUiStore } from './timelineUiStore';
import './mouth-pose-lane.css';

type Drag = {
  id: string; pointerId: number; clientX: number; edge: 'startMs' | 'endMs'; event: MouthPoseEvent;
};

export function MouthPoseLane({ project, shot, layerId, currentTimeMs, pixelsPerMs, trackWidth, disabled }: {
  project: Project; shot: Shot; layerId: string; currentTimeMs: number; pixelsPerMs: number; trackWidth: number; disabled: boolean;
}) {
  const [selectedId, setSelectedId] = useState('');
  const [preview, setPreview] = useState<MouthPoseEvent>();
  const [error, setError] = useState('');
  const drag = useRef<Drag | undefined>(undefined);
  const layer = shot.layers.find((item) => item.id === layerId);
  const characterId = layer?.source.kind === 'character' ? layer.source.characterId : undefined;
  const character = project.characters.find((item) => item.id === characterId);
  const set = character?.mouthPoseSet;
  if (!set || !layer) return null;

  const locked = disabled || layer.locked;
  const events = shot.timelineEvents.filter((event): event is MouthPoseEvent =>
    event.type === 'mouth-pose' && event.layerId === layerId);
  const selected = events.find((event) => event.id === selectedId);

  function commit(event: Pick<MouthPoseEvent, 'id' | 'startMs' | 'endMs' | 'poseId' | 'dialogueId'>) {
    if (locked || editorProjectStore.getSnapshot()?.project !== project) return;
    try {
      editorProjectStore.updateProject(setManualMouthPose(project, shot.id, layerId, event.id, event), '编辑口型段');
      setSelectedId(event.id);
      setError('');
    } catch {
      setError('请让口型段保留正时长，并保持在镜头或关联对白范围内。');
    }
  }

  function add() {
    const startMs = Math.max(0, Math.min(Math.round(currentTimeMs), shot.durationMs - 1));
    const dialogue = shot.dialogues.find((item) => item.characterId === characterId &&
      item.startMs <= startMs && startMs < item.endMs);
    commit({
      id: crypto.randomUUID(),
      startMs, endMs: Math.min(startMs + 120, dialogue?.endMs ?? shot.durationMs),
      poseId: set!.restPoseId, ...(dialogue ? { dialogueId: dialogue.id } : {}),
    });
  }

  function dragChange(event: PointerEvent<HTMLButtonElement>, end: boolean) {
    event.stopPropagation();
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const dialogue = shot.dialogues.find((item) => item.id === state.event.dialogueId);
    const original = state.event;
    const minimum = state.edge === 'startMs' ? dialogue?.startMs ?? 0 : original.startMs + 1;
    const maximum = state.edge === 'endMs' ? dialogue?.endMs ?? shot.durationMs : original.endMs - 1;
    const time = Math.round(original[state.edge] + (event.clientX - state.clientX) / pixelsPerMs);
    const changed = { ...original, [state.edge]: Math.max(minimum, Math.min(time, maximum)) };
    if (!end) { setPreview(changed); return; }
    drag.current = undefined;
    setPreview(undefined);
    if (changed[state.edge] !== original[state.edge]) commit(changed);
  }

  function handle(event: MouthPoseEvent, edge: Drag['edge']) {
    return <button type="button" className={`mouth-pose-handle mouth-pose-handle-${edge}`}
      aria-label={edge === 'startMs' ? '拖动口型起点' : '拖动口型终点'} disabled={locked}
      onPointerDown={(pointer) => {
        if (pointer.button !== 0) return;
        pointer.stopPropagation();
        pointer.currentTarget.setPointerCapture(pointer.pointerId);
        setSelectedId(event.id);
        drag.current = { id: event.id, pointerId: pointer.pointerId, clientX: pointer.clientX, edge, event };
      }}
      onPointerMove={(pointer) => dragChange(pointer, false)}
      onPointerUp={(pointer) => dragChange(pointer, true)}
      onLostPointerCapture={() => { drag.current = undefined; setPreview(undefined); }} />;
  }

  return <div className="mouth-pose-lane" data-testid="mouth-pose-lane">
    <div className="timeline-lane character-motion-lane">
      <span className="timeline-lane-label">
        口型 <button type="button" aria-label="在播放位置添加口型段" disabled={locked} onClick={add}>
          <Plus size={12} aria-hidden="true" focusable="false" />
        </button>
      </span>
      <div className="timeline-lane-content mouth-pose-track" style={{ width: trackWidth }} aria-label="口型时间段">
        {events.map((event) => {
          const range = preview?.id === event.id ? preview : event;
          const pose = set.poses.find((item) => item.id === event.poseId);
          return <div key={event.id} className="mouth-pose-range" data-origin={event.origin}
            data-selected={event.id === selectedId} style={{
              left: range.startMs * pixelsPerMs, width: Math.max(3, (range.endMs - range.startMs) * pixelsPerMs),
            }}>
            <button type="button" className="mouth-pose-range-label" title={pose?.name}
              data-testid="mouth-pose-segment" data-pose-id={event.poseId} data-start-ms={event.startMs} data-end-ms={event.endMs}
              onPointerDown={(pointer) => pointer.stopPropagation()} onClick={() => {
                setSelectedId(event.id);
                timelineUiStore.seek(event.startMs, shot.durationMs);
              }}>{pose?.name ?? '口型'}</button>
            {handle(event, 'startMs')}{handle(event, 'endMs')}
          </div>;
        })}
      </div>
    </div>
    {selected ? <form className="mouth-pose-range-editor" key={`${selected.id}/${selected.startMs}/${selected.endMs}/${selected.poseId}`}
      onPointerDown={(event) => event.stopPropagation()} onSubmit={(event) => {
        event.preventDefault();
        const values = new FormData(event.currentTarget);
        commit({ ...selected, poseId: String(values.get('poseId')),
          startMs: Math.round(Number(values.get('start')) * 1_000), endMs: Math.round(Number(values.get('end')) * 1_000) });
      }}>
      <label>姿态 <select name="poseId" defaultValue={selected.poseId} disabled={locked}>
        {set.poses.map((pose) => <option value={pose.id} key={pose.id}>{pose.name}</option>)}
      </select></label>
      <label>起点（秒） <input name="start" type="number" min="0" step="0.001" required disabled={locked} defaultValue={selected.startMs / 1_000} /></label>
      <label>终点（秒） <input name="end" type="number" min="0" step="0.001" required disabled={locked} defaultValue={selected.endMs / 1_000} /></label>
      <button type="submit" disabled={locked}>应用口型</button>
      <button type="button" disabled={locked} onClick={() => {
        if (editorProjectStore.getSnapshot()?.project !== project) return;
        editorProjectStore.updateProject(ProjectSchema.parse({ ...project, shots: project.shots.map((item) =>
          item.id === shot.id ? { ...item, timelineEvents: item.timelineEvents.filter((event) => event.id !== selected.id) } : item) }), '删除口型段');
        setSelectedId('');
      }}>移除段</button>
      <button type="button" onClick={() => setSelectedId('')}>收起</button>
    </form> : null}
    {error ? <p role="alert">{error}</p> : null}
  </div>;
}
