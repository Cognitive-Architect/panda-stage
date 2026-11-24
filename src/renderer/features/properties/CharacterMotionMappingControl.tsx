import { useContext, useEffect, useRef, useState } from 'react';
import {
  MOTION_PROPERTY_LABELS, characterFaceAndMouthPartIds, planMappedCharacterMotion, resolveTimelineFrameTime,
  suggestCharacterMotionMapping, type AdaptivePartsCharacter, type CharacterMotionMappingRule, type Layer,
  type LayeredCharacterAction, type Shot,
} from '../../../domain';
import { editorProjectStore, type EditorProjectSnapshot } from '../../stores/EditorProjectStore';
import { Button } from '../../ui/Button';
import { AnimationCurveDraftDispatch } from '../timeline/AnimationCurveDraft';
import { useTimelineUi } from '../timeline/timelineUiStore';

interface CharacterMotionMappingControlProps {
  snapshot: EditorProjectSnapshot;
  shot: Shot;
  layer: Layer;
}

type Source = { character: AdaptivePartsCharacter; action: LayeredCharacterAction };
const sourceKey = ({ character, action }: Source) => `${character.id}:${action.id}`;

export function CharacterMotionMappingControl(props: CharacterMotionMappingControlProps): React.JSX.Element | null {
  const targetId = props.layer.source.kind === 'character' ? props.layer.source.characterId : undefined;
  const target = props.snapshot.project.characters.find(({ id }) => id === targetId);
  const [sourceId, setSourceId] = useState('');
  if (target?.mode !== 'adaptive-parts') return null;
  const sources = props.snapshot.project.characters.flatMap((character) => character.mode === 'adaptive-parts' && character.id !== targetId
    ? (character.actions ?? []).filter(action => 'kind' in action).map(action => ({ character, action })) : []);
  const source = sources.find(entry => sourceKey(entry) === sourceId);
  if (!sources.length) return null;
  return <details className="animation-key-selection" data-testid="character-motion-mapping">
    <summary>跨角色动作</summary>
    <label>源角色动作<select value={source ? sourceKey(source) : ''} disabled={props.layer.locked}
      onChange={event => setSourceId(event.target.value)}>
      <option value="">选择动作</option>
      {sources.map(entry => <option key={sourceKey(entry)} value={sourceKey(entry)}>{entry.character.name} · {entry.action.name}</option>)}
    </select></label>
    {source ? <MappingForm key={sourceKey(source)} {...props} source={source} target={target} /> : null}
  </details>;
}

function MappingForm({ snapshot, shot, layer, source, target }: CharacterMotionMappingControlProps & {
  source: Source;
  target: AdaptivePartsCharacter;
}): React.JSX.Element {
  const dispatch = useContext(AnimationCurveDraftDispatch);
  const { currentTimeMs } = useTimelineUi();
  const instance = editorProjectStore.getProjectInstanceId();
  const timeMs = resolveTimelineFrameTime(currentTimeMs, shot.durationMs);
  const saved = target.motionMappings?.find(entry => entry.sourceCharacterId === source.character.id && entry.sourceActionId === source.action.id);
  const [rules, setRules] = useState(() => structuredClone(saved?.rules ?? suggestCharacterMotionMapping(source.character, source.action, target)));
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState<{ plan: ReturnType<typeof planMappedCharacterMotion>; revision: number; timeMs: number; instance: number | null }>();
  const activeDraft = useRef(false);
  const preview = pending?.revision === snapshot.revision && pending.timeMs === timeMs && pending.instance === instance ? pending : undefined;
  const protectedIds = characterFaceAndMouthPartIds(target);
  const parts = target.parts.filter(({ partId, visible }) => visible && !protectedIds.has(partId));

  useEffect(() => () => {
    if (activeDraft.current) {
      activeDraft.current = false;
      dispatch?.(null);
    }
  }, [dispatch, instance, snapshot.revision, timeMs]);

  function cancel(): void {
    if (activeDraft.current) dispatch?.(null);
    activeDraft.current = false;
    setPending(undefined);
    setNotice('');
  }

  function editRule(rule: CharacterMotionMappingRule): void {
    cancel();
    setError('');
    setRules(values => values.map(entry => entry.sourcePartId === rule.sourcePartId ? rule : entry));
  }

  function partLabel(id: string): string {
    return source.character.parts.find(({ partId }) => partId === id)?.displayName ?? id;
  }

  function beginPreview(): void {
    if (!dispatch) return;
    cancel();
    try {
      const mapped = planMappedCharacterMotion(snapshot.project, shot.id, layer.id, timeMs, {
        sourceCharacterId: source.character.id, sourceActionId: source.action.id, rules,
      });
      activeDraft.current = true;
      const previewTime = Math.floor((mapped.startMs + mapped.endMs) / 2);
      dispatch({ project: mapped.project, projectInstanceId: instance, revision: snapshot.revision,
        shotId: shot.id, layerId: layer.id, timeMs: previewTime });
      setPending({ plan: mapped, revision: snapshot.revision, timeMs, instance });
      setNotice(mapped.missingSourcePartIds.length ? `保留目标现状：${mapped.missingSourcePartIds.map(partLabel).join('、')}` : '');
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法预览动作映射。');
    }
  }

  function apply(): void {
    if (!preview || editorProjectStore.getSnapshot() !== snapshot || editorProjectStore.getProjectInstanceId() !== instance) return;
    editorProjectStore.updateProject(preview.plan.project, '应用跨角色动作');
    cancel();
  }

  return <div>
    {rules.map(rule => <fieldset className="animation-curve-fields" key={rule.sourcePartId}>
      <legend>{partLabel(rule.sourcePartId)}</legend>
      <label>目标部件<select value={parts.some(({ partId }) => partId === rule.targetPartId) ? rule.targetPartId : ''}
        disabled={layer.locked} onChange={event => editRule({ ...rule, targetPartId: event.target.value || undefined })}>
        <option value="">保留目标现状</option>
        {parts.map(({ partId, displayName }, index) => <option key={partId} value={partId}
          disabled={rules.some(entry => entry.sourcePartId !== rule.sourcePartId && entry.targetPartId === partId)}>
          {displayName ?? `部件 ${index + 1}`}
        </option>)}
      </select></label>
      {rule.targetPartId ? <details className="animation-key-selection">
        <summary>校准</summary>
        <label><input type="checkbox" checked={rule.mirror} onChange={event => editRule({ ...rule, mirror: event.target.checked })} />镜像方向</label>
        <label>位移比例<input type="number" min={0.01} max={100} step={0.01} value={rule.translationScale}
          onChange={event => editRule({ ...rule, translationScale: Number(event.target.value) })} /></label>
        <label>支点偏移 X<input type="number" value={rule.pivotOffset.x}
          onChange={event => editRule({ ...rule, pivotOffset: { ...rule.pivotOffset, x: Number(event.target.value) } })} /></label>
        <label>支点偏移 Y<input type="number" value={rule.pivotOffset.y}
          onChange={event => editRule({ ...rule, pivotOffset: { ...rule.pivotOffset, y: Number(event.target.value) } })} /></label>
        <div className="animation-key-targets" aria-label="覆盖属性">
          {source.action.tracks.filter(track => track.partId === rule.sourcePartId).map(({ property }) =>
            <label key={property}><input type="checkbox" checked={rule.properties.includes(property)}
              onChange={event => editRule({ ...rule, properties: event.target.checked ? [...rule.properties, property]
                : rule.properties.filter(value => value !== property) })} />{MOTION_PROPERTY_LABELS[property]}</label>)}
        </div>
      </details> : null}
    </fieldset>)}
    {preview ? <>
      <Button disabled={layer.locked} onClick={apply}>应用到当前实例</Button>
      <Button variant="secondary" onClick={cancel}>取消预览</Button>
    </> : <Button disabled={layer.locked || !dispatch || !rules.some(rule => rule.targetPartId)} onClick={beginPreview}>预览映射</Button>}
    {notice ? <p role="status">{notice}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
  </div>;
}
