import { useState } from 'react';
import {
  characterArmTipOnStage, characterFaceAndMouthPartIds, createCharacterPartAnimationClip, resolveTimelineFrameTime,
  saveCharacterArmChain, type AdaptivePartsCharacter, type CharacterArmChain, type Layer, type Shot,
} from '../../../domain';
import { editorProjectStore, type EditorProjectSnapshot } from '../../stores/EditorProjectStore';
import { selectionStore } from '../../stores/selectionStore';
import { shotStore } from '../../stores/shotStore';
import { Button } from '../../ui/Button';
import { replaceArmChainPart, updateArmAssemblyPart, useCharacterArmTool } from '../canvas/CharacterArmTool';
import { timelineUiStore, useTimelineUi } from '../timeline/timelineUiStore';

interface CharacterArmChainControlProps {
  snapshot: EditorProjectSnapshot;
  shot: Shot;
  layer: Layer;
}

const blankSegment = (): CharacterArmChain['segments'][number] => ({ partId: '', joint: { x: 0, y: 0 }, minDeg: -180, maxDeg: 180 });

export function CharacterArmChainControl(props: CharacterArmChainControlProps): React.JSX.Element | null {
  const characterId = props.layer.source.kind === 'character' ? props.layer.source.characterId : undefined;
  const character = props.snapshot.project.characters.find(({ id }) => id === characterId);
  return character?.mode === 'adaptive-parts'
    ? <ArmChainForm key={`${editorProjectStore.getProjectInstanceId()}:${character.id}`} {...props} character={character} />
    : null;
}

function ArmChainForm({ snapshot, shot, layer, character }: CharacterArmChainControlProps & {
  character: AdaptivePartsCharacter;
}): React.JSX.Element | null {
  const { currentTimeMs } = useTimelineUi();
  const timeMs = resolveTimelineFrameTime(currentTimeMs, shot.durationMs);
  const address = { shotId: shot.id, layerId: layer.id, timeMs };
  const target = { shotId: shot.id, layerId: layer.id, projectInstanceId: editorProjectStore.getProjectInstanceId() };
  const tool = useCharacterArmTool(target);
  const assembly = tool.assembly?.revision === snapshot.revision && tool.assembly.timeMs === timeMs ? tool.assembly : undefined;
  const [numericDraft, setNumericDraft] = useState<{ revision: number; chain: CharacterArmChain }>();
  const draft = assembly?.chain ?? (numericDraft?.revision === snapshot.revision ? numericDraft.chain : undefined);
  const [error, setError] = useState('');
  const excluded = characterFaceAndMouthPartIds(character);
  const parts = character.parts.filter(part => part.visible && !excluded.has(part.partId));
  if (parts.length < 2 && !character.armChain) return null;

  function initialChain(): CharacterArmChain {
    return character.armChain ? structuredClone(character.armChain)
      : { segments: [blankSegment(), blankSegment()], tip: { x: 0, y: 0 } };
  }

  function setDraft(chain: CharacterArmChain): void {
    if (assembly) tool.setAssembly?.({ ...assembly, chain });
    else setNumericDraft({ revision: snapshot.revision, chain });
  }

  function cancel(): void {
    if (assembly) tool.setAssembly?.(undefined);
    setNumericDraft(undefined);
    setError('');
  }

  function startAssembly(): void {
    try {
      const available = tool.readAssemblyParts?.current?.(snapshot, address);
      if (!available || available.size < 2) throw new Error('当前帧可点选的部件不足。可换一帧或使用数值设置。');
      const existing = initialChain();
      const chain = {
        ...existing,
        segments: existing.segments.map(segment => available.has(segment.partId) ? segment : {
          ...segment, partId: '',
        }),
      };
      tool.setAssembly?.({ target, revision: snapshot.revision, timeMs, parts: available, chain,
        nextPoint: chain.segments.every(({ partId }) => partId) ? chain.segments.length + 1 : 0 });
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法在画布装配，可使用数值设置。');
    }
  }

  function updatePart(index: number, partId: string): void {
    if (!draft) return;
    if (assembly) {
      tool.setAssembly?.(updateArmAssemblyPart(assembly, index, partId));
      return;
    }
    try {
      const clip = createCharacterPartAnimationClip(snapshot.project, shot.id, layer.id);
      const pivot = clip.targetBases.find(({ target }) => target.partId === partId)?.pivot;
      setDraft(replaceArmChainPart(draft, index, partId, pivot));
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
    if (state !== snapshot || !draft || editorProjectStore.getProjectInstanceId() !== target.projectInstanceId ||
        shotStore.getCurrentShotId() !== shot.id || selectionStore.getSelectedLayerId() !== layer.id ||
        resolveTimelineFrameTime(timelineUiStore.getSnapshot().currentTimeMs, shot.durationMs) !== timeMs) return;
    try {
      const project = saveCharacterArmChain(state.project, address, draft);
      editorProjectStore.updateProject(project, '设置手臂链');
      cancel();
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
    {character.armChain && !assembly ? <Button aria-pressed={tool.active} disabled={layer.locked} onClick={toggle}>
      {tool.active ? '隐藏手腕拖柄' : '显示手腕拖柄'}
    </Button> : null}
    {draft ? <>
      <label>节数<select value={draft.segments.length} onChange={event => {
        const segments = Number(event.target.value) === 3 ? [...draft.segments, blankSegment()] : draft.segments.slice(0, 2);
        const tip = segments.length > draft.segments.length ? draft.tip : {
          x: segments.at(-1)!.joint.x + 40, y: segments.at(-1)!.joint.y,
        };
        if (assembly) tool.setAssembly?.({ ...assembly, chain: { segments, tip }, nextPoint: 0 });
        else setDraft({ ...draft, segments });
      }}><option value={2}>2</option><option value={3} disabled={(assembly?.parts.size ?? parts.length) < 3}>3</option></select></label>
      <details className="animation-key-selection" open={!assembly}>
        <summary>支点与限角</summary>
      {draft.segments.map((segment, index) => <fieldset className="animation-curve-fields" key={index}>
        <legend>{['上臂', '前臂', '手'][index]}</legend>
        <label>部件<select value={segment.partId} onChange={event => updatePart(index, event.target.value)}>
          <option value="">选择部件</option>
          {parts.filter(part => !assembly || assembly.parts.has(part.partId)).map((part, partIndex) => <option key={part.partId} value={part.partId}
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
        <label>{draft.segments.length === 3 ? '末端 X' : '腕点 X'}<input type="number" value={draft.tip.x}
          onChange={event => setDraft({ ...draft, tip: { ...draft.tip, x: Number(event.target.value) } })} /></label>
        <label>{draft.segments.length === 3 ? '末端 Y' : '腕点 Y'}<input type="number" value={draft.tip.y}
          onChange={event => setDraft({ ...draft, tip: { ...draft.tip, y: Number(event.target.value) } })} /></label>
      </div>
      </details>
      <Button disabled={layer.locked || draft.segments.some(({ partId }) => !parts.some(part => part.partId === partId))} onClick={save}>保存手臂链</Button>
      <Button variant="secondary" onClick={cancel}>取消</Button>
    </> : <>
      {tool.setAssembly && parts.length >= 2 ? <Button disabled={layer.locked} onClick={startAssembly}>
        {character.armChain ? '在画布校准' : '在画布装配'}
      </Button> : null}
      <Button disabled={layer.locked} variant="secondary" onClick={() => {
        setDraft(initialChain());
        setError('');
      }}>{character.armChain ? '编辑支点与限角' : '数值设置'}</Button>
    </>}
    {error ? <p role="alert">{error}</p> : null}
  </details>;
}
