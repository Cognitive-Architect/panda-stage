import { useEffect, useState } from 'react';
import {
  evaluateShotAtTime,
  resolveTimelineFrameTime,
  type Layer,
  type ExpressionEvent,
  type Project,
  type Shot,
} from '../../../domain';
import { thumbnailStateFromResponse } from '../assets/AssetCard';
import { formatTimecode } from '../timeline/timeGeometry';
import { timelineUiStore, useTimelineUi } from '../timeline/timelineUiStore';
import { expressionAuthoringStore } from './expressionAuthoringStore';

interface ExpressionAtTimeControlProps {
  project: Project;
  projectRoot: string;
  shot: Shot;
  layer: Layer;
}

/** The selected Character occurrence's compact, time-based Expression editor. */
export function ExpressionAtTimeControl({
  project,
  projectRoot,
  shot,
  layer,
}: ExpressionAtTimeControlProps): React.JSX.Element | null {
  const { currentTimeMs } = useTimelineUi();
  const [error, setError] = useState('');
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const characterId = layer.source.kind === 'character' ? layer.source.characterId : null;
  const character = characterId
    ? project.characters.find((candidate) => candidate.id === characterId)
    : null;
  const expressions = character?.expressions ?? [];
  const timeMs = resolveTimelineFrameTime(currentTimeMs, shot.durationMs);
  const validTime =
    Number.isFinite(currentTimeMs) &&
    currentTimeMs >= 0 &&
    currentTimeMs < shot.durationMs &&
    timeMs < shot.durationMs;
  const activeExpressionId = evaluateShotAtTime(shot, currentTimeMs, project)
    .layers.find((candidate) => candidate.id === layer.id)?.currentExpressionId;
  const activeExpression = expressions.find(
    (expression) => expression.id === activeExpressionId,
  );
  const events = shot.timelineEvents
    .filter((event): event is ExpressionEvent =>
      event.type === 'expression' && event.layerId === layer.id,
    )
    .sort((left, right) => left.startMs - right.startMs || left.id.localeCompare(right.id));
  const assets = expressions
    .map((expression) => project.assets.find((asset) => asset.id === expression.assetId))
    .filter((asset) => asset?.kind === 'image');
  const assetKeys = assets.map((asset) => `${asset!.id}:${asset!.sha256 ?? ''}`).join('|');

  useEffect(() => {
    if (typeof window === 'undefined' || !window.pandaStage?.assets) return undefined;
    let active = true;
    void Promise.all(
      assets.map(async (asset) => {
        if (!asset) return null;
        try {
          const response = await window.pandaStage.assets.readThumbnail({
            projectRoot,
            assetId: asset.id,
            sha256: asset.sha256,
          });
          const state = thumbnailStateFromResponse(response);
          return state.status === 'ready' ? [asset.id, state.dataUrl] as const : null;
        } catch {
          return null;
        }
      }),
    ).then((results) => {
      if (active) setThumbnails(Object.fromEntries(results.filter((result) => result !== null)));
    });
    return () => { active = false; };
  }, [assetKeys, projectRoot]);

  if (!character) return null;

  const apply = (expressionId: string): void => {
    const result = expressionAuthoringStore.setAtCurrentTime(expressionId);
    setError(result.ok ? '' : result.error ?? '无法设置表情切换。');
  };
  const remove = (eventId: string): void => {
    const result = expressionAuthoringStore.delete(eventId);
    setError(result.ok ? '' : result.error ?? '无法删除表情切换。');
  };

  return (
    <section className="expression-at-time" data-testid="expression-at-time">
      <div className="expression-at-time-heading">
        <h3>表情</h3>
        <time>{formatTimecode(currentTimeMs)}</time>
      </div>
      <p className="expression-at-time-active">
        当前：<strong>{activeExpression?.name ?? '无可用表情'}</strong>
      </p>
      <div aria-label="在当前时间切换表情" className="expression-at-time-choices" role="group">
        {expressions.map((expression) => (
          <button
            key={expression.id}
            aria-pressed={activeExpressionId === expression.id}
            className="expression-at-time-choice"
            data-expression-id={expression.id}
            disabled={layer.locked || !validTime}
            onClick={() => apply(expression.id)}
            type="button"
          >
            {thumbnails[expression.assetId] ? (
              <img alt="" src={thumbnails[expression.assetId]} />
            ) : (
              <span aria-hidden="true" className="expression-at-time-placeholder">表情</span>
            )}
            <span>{expression.name}</span>
          </button>
        ))}
      </div>
      {!validTime ? <p className="expression-at-time-note">请把播放头移到镜头内。</p> : null}
      {events.length > 0 ? (
        <div className="expression-at-time-events">
          <h4>切换点</h4>
          <ul>
            {events.map((event) => {
              const name = expressions.find((candidate) => candidate.id === event.expressionId)?.name ?? '未知表情';
              return (
                <li key={event.id}>
                  <button
                    aria-label={`前往 ${formatTimecode(event.startMs)} 的 ${name}`}
                    className="expression-at-time-seek"
                    data-current={String(event.startMs === timeMs)}
                    onClick={() => timelineUiStore.seek(event.startMs, shot.durationMs)}
                    type="button"
                  >
                    <time>{formatTimecode(event.startMs)}</time>
                    <span>{name}</span>
                  </button>
                  <button
                    aria-label={`删除 ${formatTimecode(event.startMs)} 的 ${name} 切换`}
                    className="expression-at-time-delete"
                    disabled={layer.locked}
                    onClick={() => remove(event.id)}
                    type="button"
                  >删除</button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      {error ? <p className="expression-at-time-error" role="alert">{error}</p> : null}
    </section>
  );
}
