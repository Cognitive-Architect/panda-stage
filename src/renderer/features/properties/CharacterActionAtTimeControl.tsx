import { useEffect, useState } from 'react';
import {
  resolveTimelineFrameTime,
  type CharacterActionEvent,
  type Layer,
  type Project,
  type Shot,
} from '../../../domain';
import { formatTimecode } from '../timeline/timeGeometry';
import { timelineUiStore, useTimelineUi } from '../timeline/timelineUiStore';
import { characterActionAuthoringStore } from '../../stores/characterActionAuthoringStore';

interface CharacterActionAtTimeControlProps {
  project: Project;
  shot: Shot;
  layer: Layer;
}

/** Edit bounded action intervals on the selected existing Character Layer. */
export function CharacterActionAtTimeControl({
  project,
  shot,
  layer,
}: CharacterActionAtTimeControlProps): React.JSX.Element | null {
  const { currentTimeMs } = useTimelineUi();
  const characterId = layer.source.kind === 'character' ? layer.source.characterId : null;
  const character = characterId ? project.characters.find((candidate) => candidate.id === characterId) : null;
  const actions = character?.actions ?? [];
  const [selectedActionId, setSelectedActionId] = useState(actions[0]?.id ?? '');
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const initialStart = resolveTimelineFrameTime(currentTimeMs, shot.durationMs);
  const initialAnimation = project.animations.find((candidate) => candidate.id === actions[0]?.animationId);
  const [startMs, setStartMs] = useState(initialStart);
  const [endMs, setEndMs] = useState(Math.min(shot.durationMs, initialStart + Math.max(1, Math.round(initialAnimation?.durationMs ?? 1_000))));
  const [error, setError] = useState('');

  useEffect(() => {
    if (selectedActionId && actions.some((action) => action.id === selectedActionId)) return;
    const firstAction = actions[0];
    if (!firstAction) return;
    const start = resolveTimelineFrameTime(currentTimeMs, shot.durationMs);
    const animation = project.animations.find((candidate) => candidate.id === firstAction.animationId);
    setSelectedActionId(firstAction.id);
    setStartMs(start);
    setEndMs(Math.min(shot.durationMs, start + Math.max(1, Math.round(animation?.durationMs ?? 1_000))));
  }, [actions, currentTimeMs, project.animations, selectedActionId, shot.durationMs]);

  if (!character || layer.source.kind !== 'character' || actions.length === 0) return null;
  const events = shot.timelineEvents
    .filter((event): event is CharacterActionEvent => event.type === 'character-action' && event.layerId === layer.id)
    .sort((left, right) => left.startMs - right.startMs || left.id.localeCompare(right.id));
  const validRange = Number.isSafeInteger(startMs) && Number.isSafeInteger(endMs) && startMs >= 0 && startMs < endMs && endMs <= shot.durationMs;

  const save = (): void => {
    const result = characterActionAuthoringStore.upsert(selectedActionId, startMs, endMs, selectedEventId ?? undefined);
    setError(result.ok ? '' : result.error ?? '无法设置角色动作段。');
    if (result.ok) setSelectedEventId(null);
  };
  const remove = (eventId: string): void => {
    const result = characterActionAuthoringStore.delete(eventId);
    setError(result.ok ? '' : result.error ?? '无法删除角色动作段。');
    if (result.ok && selectedEventId === eventId) setSelectedEventId(null);
  };

  return (
    <section className="expression-at-time character-action-at-time" data-testid="character-action-at-time">
      <div className="expression-at-time-heading">
        <h3>动作</h3>
        <time>{formatTimecode(currentTimeMs)}</time>
      </div>
      <div className="character-action-range-fields">
        <select aria-label="角色动作" disabled={layer.locked} value={selectedActionId}
          onChange={(event) => {
            const nextActionId = event.target.value;
            const nextStart = resolveTimelineFrameTime(currentTimeMs, shot.durationMs);
            const animation = project.animations.find((candidate) => candidate.id === actions.find((action) => action.id === nextActionId)?.animationId);
            setSelectedActionId(nextActionId);
            setSelectedEventId(null);
            setStartMs(nextStart);
            setEndMs(Math.min(shot.durationMs, nextStart + Math.max(1, Math.round(animation?.durationMs ?? 1_000))));
          }}>
          {actions.map((action) => <option key={action.id} value={action.id}>{action.name}</option>)}
        </select>
        <label>开始 <input aria-label="动作开始时间" type="number" min={0} max={shot.durationMs - 1} step={1}
          disabled={layer.locked} value={startMs} onChange={(event) => setStartMs(Number(event.target.value))} /></label>
        <label>结束 <input aria-label="动作结束时间" type="number" min={1} max={shot.durationMs} step={1}
          disabled={layer.locked} value={endMs} onChange={(event) => setEndMs(Number(event.target.value))} /></label>
        <button type="button" disabled={layer.locked || !validRange} onClick={save}>
          {selectedEventId ? '更新' : '添加'}
        </button>
        {selectedEventId ? <button type="button" onClick={() => { setSelectedEventId(null); setError(''); }}>取消</button> : null}
      </div>
      {events.length > 0 ? <div className="expression-at-time-events">
        <ul aria-label="角色动作段">
          {events.map((event) => {
            const name = actions.find((action) => action.id === event.actionId)?.name ?? '未知动作';
            return <li key={event.id}>
              <button className="expression-at-time-seek" type="button" onClick={() => timelineUiStore.seek(event.startMs, shot.durationMs)}>
                <time>{formatTimecode(event.startMs)}–{formatTimecode(event.endMs)}</time><span>{name}</span>
              </button>
              <button className="expression-at-time-delete" type="button" disabled={layer.locked}
                aria-label={`编辑动作段 ${name}`} onClick={() => {
                  setSelectedEventId(event.id); setSelectedActionId(event.actionId);
                  setStartMs(event.startMs); setEndMs(event.endMs); setError('');
                }}>编辑</button>
              <button className="expression-at-time-delete" type="button" disabled={layer.locked}
                aria-label={`删除动作段 ${name}`} onClick={() => remove(event.id)}>删除</button>
            </li>;
          })}
        </ul>
      </div> : null}
      {error ? <p className="expression-at-time-error" role="alert">{error}</p> : null}
    </section>
  );
}
