import { useState } from 'react';
import {
  characterArmTipOnStage, characterFaceAndMouthPartIds, createCharacterPartAnimationClip, resolveTimelineFrameTime,
  saveCharacterArmChain, type AdaptivePartsCharacter, type CharacterArmChain, type Layer, type Shot,
} from '../../../domain';
import { editorProjectStore, type EditorProjectSnapshot } from '../../stores/EditorProjectStore';
import { Button } from '../../ui/Button';
import { useCharacterArmTool } from '../canvas/CharacterArmTool';
import { useTimelineUi } from '../timeline/timelineUiStore';

interface CharacterArmChainControlProps {
  snapshot: EditorProjectSnapshot;
  shot: Shot;
  layer: Layer;
}

const blankSegment = (): CharacterArmChain['segments'][number] => ({ partId: '', joint: { x: 0, y: 0 }, minDeg: -180, maxDeg: 180 });

export function CharacterArmChainControl(props: CharacterArmChainControlProps): React.JSX.Element | null {
  const characterId = props.layer.source.kind === 'character' ? props.layer.source.characterId : undefined;
  const character = props.snapshot.project.characters.find(({ id }) => id === characterId);
  return character?.mode === 'adaptive-parts' ? <ArmChainForm {...props} character={character} /> : null;
}

function ArmChainForm({ snapshot, shot, layer, character }: CharacterArmChainControlProps & {
  character: AdaptivePartsCharacter;
}): React.JSX.Element | null {
  const { currentTimeMs } = useTimelineUi();
  const timeMs = resolveTimelineFrameTime(currentTimeMs, shot.durationMs);
  const address = { shotId: shot.id, layerId: layer.id, timeMs };
  const tool = useCharacterArmTool({ ...address, projectInstanceId: editorProjectStore.getProjectInstanceId() });
  const [draft, setDraft] = useState<CharacterArmChain>();
  const [error, setError] = useState('');
  const excluded = characterFaceAndMouthPartIds(character);
  const parts = character.parts.filter(part => part.visible && !excluded.has(part.partId));
  if (parts.length < 2 && !character.armChain) return null;

  function updatePart(index: number, partId: string): void {
    if (!draft) return;
    const segments = [...draft.segments];
    try {
      const clip = createCharacterPartAnimationClip(snapshot.project, shot.id, layer.id);
      const pivot = clip.targetBases.find(({ target }) => target.partId === partId)?.pivot;
      const joint = pivot ? { x: pivot.x, y: pivot.y } : { x: 0, y: 0 };
      segments[index] = { ...segments[index]!, partId, joint };
      setDraft({ segments, tip: index === segments.length - 1 && pivot ? { x: pivot.x + 40, y: pivot.y } : draft.tip });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法读取部件支点。');
    }
  }

  function setSegment(index: number, segment: CharacterArmChain['segments'][number]): void {
    if (!draft) return;
    setDraft({ ...draft, segments: draft.segments.map((entry, entryIndex) => entryIndex === index ? segment : entry) });
  }

  function save(): void {
    const state = editorProjectStore.getSnapshot();
    if (!state || !draft) return;
    try {
      const project = saveCharacterArmChain(state.project, address, draft);
      editorProjectStore.updateProject(project, '设置手臂链');
      setDraft(undefined);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法保存手臂链。');
    }
  }

  function toggle(): void {
    try {
      if (!tool.active) characterArmTipOnStage(snapshot.project, address);
      tool.toggle();
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '当前无法拖动手腕。');
    }
  }

  return <details className="animation-key-selection" data-testid="character-arm-chain">
    <summary>手臂链</summary>
    {character.armChain ? <Button aria-pressed={tool.active} disabled={layer.locked} onClick={toggle}>
      {tool.active ? '隐藏手腕拖柄' : '显示手腕拖柄'}
    </Button> : null}
    {draft ? <>
      <label>节数<select value={draft.segments.length} onChange={event => {
        const segments = Number(event.target.value) === 3 ? [...draft.segments, blankSegment()] : draft.segments.slice(0, 2);
        setDraft({ ...draft, segments });
      }}><option value={2}>2</option><option value={3} disabled={parts.length < 3}>3</option></select></label>
      {draft.segments.map((segment, index) => <fieldset className="animation-curve-fields" key={index}>
        <legend>{['上臂', '前臂', '手'][index]}</legend>
        <label>部件<select value={segment.partId} onChange={event => updatePart(index, event.target.value)}>
          <option value="">选择部件</option>
          {parts.map((part, partIndex) => <option key={part.partId} value={part.partId}
            disabled={draft.segments.some((candidate, i) => i !== index && candidate.partId === part.partId)}>
            {part.displayName ?? `部件 ${partIndex + 1}`}
          </option>)}
        </select></label>
        <label>支点 X<input type="number" value={segment.joint.x}
          onChange={event => setSegment(index, { ...segment, joint: { ...segment.joint, x: Number(event.target.value) } })} /></label>
        <label>支点 Y<input type="number" value={segment.joint.y}
          onChange={event => setSegment(index, { ...segment, joint: { ...segment.joint, y: Number(event.target.value) } })} /></label>
        <label>最小角<input type="number" min={-360} max={360} value={segment.minDeg}
          onChange={event => setSegment(index, { ...segment, minDeg: Number(event.target.value) })} /></label>
        <label>最大角<input type="number" min={-360} max={360} value={segment.maxDeg}
          onChange={event => setSegment(index, { ...segment, maxDeg: Number(event.target.value) })} /></label>
      </fieldset>)}
      <div className="animation-curve-fields">
        <label>腕点 X<input type="number" value={draft.tip.x}
          onChange={event => setDraft({ ...draft, tip: { ...draft.tip, x: Number(event.target.value) } })} /></label>
        <label>腕点 Y<input type="number" value={draft.tip.y}
          onChange={event => setDraft({ ...draft, tip: { ...draft.tip, y: Number(event.target.value) } })} /></label>
      </div>
      <Button disabled={layer.locked || draft.segments.some(({ partId }) => !parts.some(part => part.partId === partId))} onClick={save}>保存手臂链</Button>
      <Button variant="secondary" onClick={() => { setDraft(undefined); setError(''); }}>取消</Button>
    </> : <Button disabled={layer.locked} variant="secondary" onClick={() => {
      setDraft(character.armChain ? structuredClone(character.armChain) : { segments: [blankSegment(), blankSegment()], tip: { x: 0, y: 0 } });
      setError('');
    }}>{character.armChain ? '编辑支点与限角' : '设置手臂链'}</Button>}
    {error ? <p role="alert">{error}</p> : null}
  </details>;
}
