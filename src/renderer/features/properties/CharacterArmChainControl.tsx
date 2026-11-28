import { useEffect, useState } from 'react';
import {
  characterArmTipOnStage, characterFaceAndMouthPartIds, createCharacterPartAnimationClip, deleteCharacterArmChain,
  renameCharacterArmChain, resolveCharacterArmChains, resolveTimelineFrameTime, saveCharacterArmChain,
  type AdaptivePartsCharacter, type CharacterArmChain, type CharacterArmChainEntry, type CharacterArmChainKind,
  type Layer, type Shot,
} from '../../../domain';
import { editorProjectStore, type EditorProjectSnapshot } from '../../stores/EditorProjectStore';
import { selectionStore } from '../../stores/selectionStore';
import { shotStore } from '../../stores/shotStore';
import { Button } from '../../ui/Button';
import {
  characterArmChainLabels, replaceArmChainPart, updateArmAssemblyPart, useCharacterArmTool,
} from '../canvas/CharacterArmTool';
import { timelineUiStore, useTimelineUi } from '../timeline/timelineUiStore';

interface CharacterArmChainControlProps {
  snapshot: EditorProjectSnapshot;
  shot: Shot;
  layer: Layer;
}

const blankSegment = (): CharacterArmChain['segments'][number] => ({ partId: '', joint: { x: 0, y: 0 }, minDeg: -180, maxDeg: 180 });
const blankChain = (): CharacterArmChain => ({ segments: [blankSegment(), blankSegment()], tip: { x: 0, y: 0 } });

const KIND_OPTIONS: readonly { value: CharacterArmChainKind; label: string }[] = [
  { value: 'right-arm', label: '右手臂' },
  { value: 'left-arm', label: '左手臂' },
  { value: 'right-leg', label: '右腿' },
  { value: 'left-leg', label: '左腿' },
  { value: 'custom', label: '自定义' },
];

function chainNameExists(chains: readonly CharacterArmChainEntry[], name: string, exceptId?: string): boolean {
  const normalized = name.trim().toLocaleLowerCase();
  return Boolean(normalized) && chains.some(entry => entry.id !== exceptId && entry.name.toLocaleLowerCase() === normalized);
}

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
  const instance = editorProjectStore.getProjectInstanceId();
  const timeMs = resolveTimelineFrameTime(currentTimeMs, shot.durationMs);
  const address = { shotId: shot.id, layerId: layer.id, timeMs };
  const session = useCharacterArmTool({ shotId: shot.id, layerId: layer.id, projectInstanceId: instance });
  const resolvedChains = resolveCharacterArmChains(character);
  const [pending, setPending] = useState<CharacterArmChainEntry>();
  const selected = pending?.id === session.chainId
    ? pending
    : resolvedChains.find(({ id }) => id === session.chainId) ?? resolvedChains[0];
  const chainId = selected?.id ?? session.chainId;
  const target = { shotId: shot.id, layerId: layer.id, projectInstanceId: instance, chainId };
  const tool = useCharacterArmTool(target);
  const assembly = tool.assembly?.revision === snapshot.revision && tool.assembly.timeMs === timeMs ? tool.assembly : undefined;
  const [numericDraft, setNumericDraft] = useState<{ revision: number; chainId: string; chain: CharacterArmChain }>();
  const draft = assembly?.chain ?? (numericDraft?.revision === snapshot.revision && numericDraft.chainId === chainId ? numericDraft.chain : undefined);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newKind, setNewKind] = useState<CharacterArmChainKind>('right-arm');
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const labels = characterArmChainLabels(selected?.kind);
  const protectedIds = characterFaceAndMouthPartIds(character);
  const otherChainPartIds = new Set(resolvedChains.filter(entry => entry.id !== chainId)
    .flatMap(entry => entry.chain.segments.map(({ partId }) => partId)));
  const parts = character.parts.filter(part => part.visible && !protectedIds.has(part.partId) && !otherChainPartIds.has(part.partId));
  const chainableParts = character.parts.filter(part => part.visible && !protectedIds.has(part.partId));

  useEffect(() => {
    if (!selected || selected.id === session.chainId) return;
    session.selectChain?.(selected.id);
  }, [selected?.id, session.chainId, session.selectChain]);

  if (!resolvedChains.length && !pending && chainableParts.length < 2) return null;

  function initialChain(): CharacterArmChain {
    return selected?.chain ? structuredClone(selected.chain) : blankChain();
  }

  function setDraft(chain: CharacterArmChain): void {
    if (assembly) tool.setAssembly?.({ ...assembly, chain });
    else setNumericDraft({ revision: snapshot.revision, chainId, chain });
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
      const allowed = new Map([...available].filter(([partId]) => !otherChainPartIds.has(partId)));
      if (allowed.size < 2) throw new Error('当前帧可用部件不足：其余骨链已占用这些部件。');
      const existing = initialChain();
      const chain = {
        ...existing,
        segments: existing.segments.map(segment => allowed.has(segment.partId) ? segment : { ...segment, partId: '' }),
      };
      tool.setAssembly?.({ target, revision: snapshot.revision, timeMs, parts: allowed, chain, kind: selected?.kind,
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
    if (state !== snapshot || !draft || !selected || editorProjectStore.getProjectInstanceId() !== instance ||
        shotStore.getCurrentShotId() !== shot.id || selectionStore.getSelectedLayerId() !== layer.id ||
        resolveTimelineFrameTime(timelineUiStore.getSnapshot().currentTimeMs, shot.durationMs) !== timeMs) return;
    try {
      const project = saveCharacterArmChain(state.project, address, draft, chainId, {
        name: selected.name, ...(selected.kind ? { kind: selected.kind } : {}),
      });
      editorProjectStore.updateProject(project, '设置骨链');
      if (pending?.id === chainId) setPending(undefined);
      cancel();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法保存骨链。');
    }
  }

  function toggle(): void {
    if (!selected || pending?.id === selected.id) return;
    try {
      if (!tool.active) characterArmTipOnStage(snapshot.project, address, chainId);
      tool.toggle();
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '当前无法拖动末端。');
    }
  }

  function startCreate(): void {
    cancel();
    setPending(undefined);
    setRenaming(false);
    setCreating(true);
    setNewName('');
    setNewKind('right-arm');
    setError('');
  }

  function commitCreate(): void {
    const name = newName.trim();
    if (!name) {
      setError('请输入骨链名称。');
      return;
    }
    if (chainNameExists([...resolvedChains, ...(pending ? [pending] : [])], name)) {
      setError('骨链名称已存在。');
      return;
    }
    const entry: CharacterArmChainEntry = { id: crypto.randomUUID(), name, kind: newKind, chain: blankChain() };
    setPending(entry);
    session.selectChain?.(entry.id);
    setCreating(false);
    setError('');
  }

  function startRename(): void {
    if (!selected) return;
    setCreating(false);
    setRenaming(true);
    setRenameDraft(selected.name);
    setError('');
  }

  function commitRename(): void {
    if (!selected) return;
    const name = renameDraft.trim();
    if (!name) {
      setError('请输入骨链名称。');
      return;
    }
    if (pending?.id === selected.id) {
      setPending({ ...pending, name });
      setRenaming(false);
      setError('');
      return;
    }
    try {
      const state = editorProjectStore.getSnapshot();
      if (!state) return;
      const project = renameCharacterArmChain(state.project, address, selected.id, name);
      if (project !== state.project) editorProjectStore.updateProject(project, '重命名骨链');
      setRenaming(false);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法重命名骨链。');
    }
  }

  function remove(): void {
    if (!selected) return;
    cancel();
    if (pending?.id === selected.id) {
      setPending(undefined);
      setError('');
      return;
    }
    try {
      const state = editorProjectStore.getSnapshot();
      if (!state) return;
      const project = deleteCharacterArmChain(state.project, address, selected.id);
      if (project !== state.project) editorProjectStore.updateProject(project, '删除骨链');
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法删除骨链。');
    }
  }

  const options = pending && !resolvedChains.some(({ id }) => id === pending.id) ? [...resolvedChains, pending] : resolvedChains;
  return <details className="animation-key-selection" data-testid="character-arm-chain">
    <summary>骨链</summary>
    {options.length ? <div className="animation-curve-fields">
      <label>当前骨链<select value={selected?.id ?? ''} disabled={layer.locked} onChange={event => {
        cancel();
        setRenaming(false);
        session.selectChain?.(event.target.value);
      }}>
        {options.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
      </select></label>
      <Button variant="secondary" disabled={layer.locked || !selected} onClick={startRename}>重命名</Button>
      <Button variant="secondary" disabled={layer.locked || !selected} onClick={remove}>删除骨链</Button>
    </div> : null}
    {creating ? <div className="animation-curve-fields">
      <label>名称<input maxLength={64} disabled={layer.locked} value={newName} placeholder="例如：左手"
        onChange={event => setNewName(event.target.value)} /></label>
      <label>类型<select value={newKind} disabled={layer.locked} onChange={event => {
        const kind = event.target.value as CharacterArmChainKind;
        const option = KIND_OPTIONS.find(candidate => candidate.value === kind);
        setNewKind(kind);
        if (!newName.trim() && option) setNewName(option.label);
      }}>{KIND_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <Button disabled={layer.locked || !newName.trim()} onClick={commitCreate}>创建骨链</Button>
      <Button variant="secondary" onClick={() => { setCreating(false); setError(''); }}>取消</Button>
    </div> : options.length === 0 ? <div className="animation-curve-fields">
      <Button disabled={layer.locked || chainableParts.length < 2} onClick={startCreate}>新建骨链</Button>
    </div> : <div className="animation-curve-fields">
      <Button variant="secondary" disabled={layer.locked} onClick={startCreate}>新建骨链</Button>
    </div>}
    {renaming ? <div className="animation-curve-fields">
      <label>名称<input maxLength={64} disabled={layer.locked} value={renameDraft}
        onChange={event => setRenameDraft(event.target.value)} /></label>
      <Button disabled={layer.locked || !renameDraft.trim()} onClick={commitRename}>保存名称</Button>
      <Button variant="secondary" onClick={() => { setRenaming(false); setError(''); }}>取消</Button>
    </div> : null}
    {selected && !pending && !assembly ? <Button aria-pressed={tool.active} disabled={layer.locked} onClick={toggle}>
      {tool.active ? labels.hideHandle : labels.showHandle}
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
        <legend>{labels.parts[index]}</legend>
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
        <label>{`${draft.segments.length === 3 ? '末端' : labels.tip} X`}<input type="number" value={draft.tip.x}
          onChange={event => setDraft({ ...draft, tip: { ...draft.tip, x: Number(event.target.value) } })} /></label>
        <label>{`${draft.segments.length === 3 ? '末端' : labels.tip} Y`}<input type="number" value={draft.tip.y}
          onChange={event => setDraft({ ...draft, tip: { ...draft.tip, y: Number(event.target.value) } })} /></label>
      </div>
      </details>
      <Button disabled={layer.locked || draft.segments.some(({ partId }) => !parts.some(part => part.partId === partId))} onClick={save}>保存骨链</Button>
      <Button variant="secondary" onClick={cancel}>取消</Button>
    </> : selected ? <>
      {tool.setAssembly && parts.length >= 2 ? <Button disabled={layer.locked} onClick={startAssembly}>
        {pending?.id === selected.id ? '在画布装配' : '在画布校准'}
      </Button> : null}
      <Button disabled={layer.locked} variant="secondary" onClick={() => {
        setDraft(initialChain());
        setError('');
      }}>{pending?.id === selected.id ? '数值设置' : '编辑支点与限角'}</Button>
    </> : null}
    {error ? <p role="alert">{error}</p> : null}
  </details>;
}
