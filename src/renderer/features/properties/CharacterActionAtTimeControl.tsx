import { useState } from 'react';
import {
  resolveTimelineFrameTime,
  type CharacterAction,
  type CharacterActionEvent,
  type Layer,
  type Project,
  type Shot,
} from '../../../domain';
import { isFlaGraphicDefinition, type ProjectAnimationDefinition } from '../../../domain/models/animation';
import { resolveFlaGraphicPreviewTimeline } from '../../../domain/selectors/animationSourceTimeline';
import { formatTimecode } from '../timeline/timeGeometry';
import { timelineUiStore, useTimelineUi } from '../timeline/timelineUiStore';
import { characterActionAuthoringStore } from '../../stores/characterActionAuthoringStore';
import { Button } from '../../ui/Button';

interface CharacterActionAtTimeControlProps {
  project: Project;
  shot: Shot;
  layer: Layer;
}

function defaultActionEnd(startMs: number, shotDuration: number, animation?: ProjectAnimationDefinition, layeredDuration?: number): number {
  let duration = layeredDuration ?? animation?.durationMs ?? 1_000;
  if (animation && isFlaGraphicDefinition(animation) && animation.frames.length === 1) {
    const timeline = resolveFlaGraphicPreviewTimeline(animation, true);
    if (timeline.hasInternalTimeline) duration = Math.max(duration, timeline.totalFrames * 1_000 / timeline.fps);
  }
  return Math.min(shotDuration, startMs + Math.max(1, Math.round(duration)));
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
  const allActions: readonly CharacterAction[] = character?.actions ?? [];
  // #1449: another layer's instance-scoped copy is private to that layer and
  // must never be offered here; same-layer copies stay selectable.
  const actions = allActions.filter((action) =>
    !('instanceScope' in action) || action.instanceScope?.layerId === layer.id);
  const [selectedActionId, setSelectedActionId] = useState(actions[0]?.id ?? '');
  const [editing, setEditing] = useState<{ id: string; actionId: string } | null>(null);
  const [manualRange, setManualRange] = useState<{ startMs: number; endMs: number } | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const [error, setError] = useState('');
  if (!character || layer.source.kind !== 'character' || actions.length === 0) return null;
  const events = shot.timelineEvents
    .filter((event): event is CharacterActionEvent => event.type === 'character-action' && event.layerId === layer.id)
    .sort((left, right) => left.startMs - right.startMs || left.id.localeCompare(right.id));
  const selectedAction = actions.find((action) => action.id === (editing?.actionId ?? selectedActionId)) ?? actions[0]!;
  const animation = 'animationId' in selectedAction ? project.animations.find((entry) => entry.id === selectedAction.animationId) : undefined;
  const layeredDuration = 'kind' in selectedAction ? Math.max(...selectedAction.tracks.map(({ keys }) => keys.at(-1)!.timeMs)) : undefined;
  const playhead = resolveTimelineFrameTime(currentTimeMs, shot.durationMs);
  const { startMs, endMs } = manualRange ?? {
    startMs: playhead,
    endMs: defaultActionEnd(playhead, shot.durationMs, animation, layeredDuration),
  };
  const validRange = Number.isSafeInteger(startMs) && Number.isSafeInteger(endMs) && startMs >= 0 && startMs < endMs && endMs <= shot.durationMs;

  const resetRange = (): void => {
    setEditing(null);
    setManualRange(null);
    setAdjusting(false);
    setError('');
  };
  const save = (): void => {
    const result = characterActionAuthoringStore.upsert(selectedAction.id, startMs, endMs, editing?.id);
    if (result.ok) resetRange();
    else setError(result.error ?? '无法设置角色动作段。');
  };
  const remove = (eventId: string): void => {
    const result = characterActionAuthoringStore.delete(eventId);
    setError(result.ok ? '' : result.error ?? '无法删除角色动作段。');
    if (result.ok && editing?.id === eventId) resetRange();
  };
  const copyForInstance = (eventId: string): void => {
    const result = characterActionAuthoringStore.copyForInstance(eventId);
    setError(result.ok ? '' : result.error ?? '无法复制角色动作副本。');
  };
  const revertFromInstance = (eventId: string): void => {
    const result = characterActionAuthoringStore.revertFromInstance(eventId);
    setError(result.ok ? '' : result.error ?? '无法恢复共享角色动作。');
  };

  return (
    <section className="expression-at-time character-action-at-time" data-testid="character-action-at-time">
      <div className="expression-at-time-heading">
        <h3>动作</h3>
        <time>{formatTimecode(currentTimeMs)}</time>
      </div>
      <div className="character-action-range-fields">
        <select aria-label="角色动作" disabled={layer.locked} value={selectedAction.id}
          onChange={(event) => {
            if (editing) setEditing({ ...editing, actionId: event.target.value });
            else setSelectedActionId(event.target.value);
            setError('');
          }}>
          {actions.map((action) => <option key={action.id} value={action.id}>{action.name}</option>)}
        </select>
        {editing || adjusting ? <>
          <label>开始（毫秒） <input aria-label="动作开始时间" type="number" min={0} max={shot.durationMs - 1} step={1}
            disabled={layer.locked} value={startMs} onChange={(event) => setManualRange({ startMs: Number(event.target.value), endMs })} /></label>
          <label>结束（毫秒） <input aria-label="动作结束时间" type="number" min={1} max={shot.durationMs} step={1}
            disabled={layer.locked} value={endMs} onChange={(event) => setManualRange({ startMs, endMs: Number(event.target.value) })} /></label>
        </> : null}
        <Button disabled={layer.locked || !validRange} onClick={save}>
          {editing ? '更新' : '添加动作'}
        </Button>
        {editing || adjusting
          ? <Button variant="secondary" onClick={resetRange}>取消</Button>
          : <Button variant="secondary" disabled={layer.locked} onClick={() => setAdjusting(true)}>调整时间</Button>}
      </div>
      {events.length > 0 ? <div className="expression-at-time-events">
        <ul aria-label="角色动作段">
          {events.map((event) => {
            const eventAction = allActions.find((action) => action.id === event.actionId);
            // A reference to another layer's private copy degrades to the
            // shared origin action for display and playback alike.
            const displayAction = eventAction && 'kind' in eventAction && eventAction.instanceScope &&
                eventAction.instanceScope.layerId !== layer.id
              ? allActions.find((action) => action.id === eventAction.originActionId)
              : eventAction;
            const name = displayAction?.name ?? '未知动作';
            const baked = eventAction !== undefined && !('kind' in eventAction);
            const instanceCopy = eventAction !== undefined && 'kind' in eventAction &&
              'instanceScope' in eventAction && Boolean(eventAction.instanceScope);
            return <li key={event.id}>
              <div className="character-action-event-row">
                <button className="expression-at-time-seek" type="button" onClick={() => timelineUiStore.seek(event.startMs, shot.durationMs)}>
                  <time>{formatTimecode(event.startMs)}–{formatTimecode(event.endMs)}</time><span>{name}</span>
                </button>
                <button className="expression-at-time-delete" type="button" disabled={layer.locked}
                  aria-label={`编辑动作段 ${name}`} onClick={() => {
                    setEditing({ id: event.id, actionId: event.actionId });
                    setManualRange({ startMs: event.startMs, endMs: event.endMs }); setError('');
                  }}>编辑</button>
                <button className="expression-at-time-delete" type="button" disabled={layer.locked}
                  aria-label={`删除动作段 ${name}`} onClick={() => remove(event.id)}>删除</button>
              </div>
              <div className="character-action-instance-row">
                {baked
                  ? <span className="character-action-instance-note">整图动作不支持局部修改</span>
                  : instanceCopy
                    ? <button className="character-action-instance-toggle" type="button" disabled={layer.locked}
                        onClick={() => revertFromInstance(event.id)}>恢复共享动作</button>
                    : <button className="character-action-instance-toggle" type="button" disabled={layer.locked}
                        onClick={() => copyForInstance(event.id)}>复制为可编辑副本</button>}
              </div>
            </li>;
          })}
        </ul>
      </div> : null}
      {error ? <p className="expression-at-time-error" role="alert">{error}</p> : null}
    </section>
  );
}
