import { useEffect, useState } from 'react';
import {
  CHARACTER_PART_MAX_SCALE,
  CHARACTER_PART_MIN_SCALE,
  CharacterBoneService,
  characterBonePoseValues,
  characterBoneProtectedPartIds,
  resolveCharacterBoneTree,
  resolveTimelineFrameTime,
  type AdaptivePartsCharacter,
  type CharacterBone,
  type Layer,
  type Project,
  type Shot,
} from '../../../domain';
import { editorProjectStore, type EditorProjectSnapshot } from '../../stores/EditorProjectStore';
import { Button } from '../../ui/Button';
import { useTimelineUi } from '../timeline/timelineUiStore';

interface CharacterBoneControlProps {
  snapshot: EditorProjectSnapshot;
  shot: Shot;
  layer: Layer;
}

interface BoneSettingsDraft {
  revision: number;
  boneId: string;
  name: string;
  partId: string;
  restX: string;
  restY: string;
  rotation: string;
  length: string;
  minDeg: string;
  maxDeg: string;
}

interface BonePoseDraft {
  revision: number;
  boneId: string;
  x: string;
  y: string;
  rotation: string;
  scale: string;
}

const boneService = new CharacterBoneService();

function numberOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatNumber(value: number): string {
  return String(Number(value.toFixed(4)));
}

function draftFromBone(revision: number, bone: CharacterBone): BoneSettingsDraft {
  return {
    revision,
    boneId: bone.id,
    name: bone.name ?? '',
    partId: bone.partId ?? '',
    restX: formatNumber(bone.restLocal.x),
    restY: formatNumber(bone.restLocal.y),
    rotation: formatNumber(bone.restLocal.rotationDeg),
    length: bone.length === undefined ? '' : formatNumber(bone.length),
    minDeg: bone.minDeg === undefined ? '' : formatNumber(bone.minDeg),
    maxDeg: bone.maxDeg === undefined ? '' : formatNumber(bone.maxDeg),
  };
}

function boneDisplayName(bone: CharacterBone, index: number): string {
  return bone.name?.trim() || `骨骼 ${index + 1}`;
}

function CharacterBoneForm({ snapshot, shot, layer, character }: CharacterBoneControlProps & {
  character: AdaptivePartsCharacter;
}): React.JSX.Element {
  const { currentTimeMs } = useTimelineUi();
  const timeMs = resolveTimelineFrameTime(currentTimeMs, shot.durationMs);
  const revision = snapshot.revision;
  const tree = resolveCharacterBoneTree(character);
  const bones = tree.ok ? tree.order.flatMap((boneId) => {
    const bone = tree.byId.get(boneId);
    return bone ? [bone] : [];
  }) : [];
  const [selectedBoneId, setSelectedBoneId] = useState<string | null>(bones[0]?.id ?? null);
  const [settings, setSettings] = useState<BoneSettingsDraft>();
  const [pose, setPose] = useState<BonePoseDraft>();
  const [error, setError] = useState('');
  const selected = bones.find((bone) => bone.id === selectedBoneId) ?? bones[0];
  const protectedIds = characterBoneProtectedPartIds(character);
  const bindableParts = character.parts.filter((part) =>
    part.visible && !protectedIds.has(part.partId));
  const boundPart = selected?.partId
    ? character.parts.find((part) => part.partId === selected.partId)
    : undefined;
  const clip = layer.animationClip?.version === 1 ? layer.animationClip : undefined;
  const boundPartHasKeys = Boolean(selected?.partId && clip?.tracks.some((track) =>
    track.target.kind === 'character-part' && track.target.partId === selected.partId));

  useEffect(() => {
    if (!selected) {
      setSettings(undefined);
      setPose(undefined);
      return;
    }
    setSettings(draftFromBone(revision, selected));
    try {
      const values = characterBonePoseValues(snapshot.project, {
        shotId: shot.id, layerId: layer.id, boneId: selected.id, timeMs,
      });
      setPose({
        revision,
        boneId: selected.id,
        x: formatNumber(values['transform.offsetX']),
        y: formatNumber(values['transform.offsetY']),
        rotation: formatNumber(values['transform.rotationDeg']),
        scale: formatNumber(values['transform.scaleX'] * 100),
      });
    } catch {
      setPose(undefined);
    }
  }, [revision, selected?.id, timeMs]);

  const editable = !layer.locked;
  const activeSettings = settings?.revision === revision && settings.boneId === selected?.id
    ? settings
    : selected ? draftFromBone(revision, selected) : undefined;
  const activePose = pose?.revision === revision && pose.boneId === selected?.id
    ? pose
    : undefined;

  function mutate(project: Project, label: string): void {
    if (project !== editorProjectStore.getSnapshot()?.project) {
      editorProjectStore.updateProject(project, label);
    }
  }

  function createBone(parentBoneId: string | null): void {
    try {
      const state = editorProjectStore.getSnapshot();
      if (!state) return;
      const next = boneService.createBone(state.project, character.id, { parentBoneId });
      mutate(next, '新建骨骼');
      const nextCharacter = next.characters.find((candidate) => candidate.id === character.id);
      const created = nextCharacter?.mode === 'adaptive-parts'
        ? nextCharacter.bones?.at(-1)
        : undefined;
      if (created) setSelectedBoneId(created.id);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法新建骨骼。');
    }
  }

  function deleteBone(): void {
    if (!selected) return;
    try {
      const state = editorProjectStore.getSnapshot();
      if (!state) return;
      const next = boneService.deleteBone(state.project, character.id, selected.id);
      mutate(next, '删除骨骼');
      setSelectedBoneId(null);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法删除骨骼。');
    }
  }

  function saveSettings(): void {
    if (!selected || !activeSettings) return;
    const restX = numberOrNull(activeSettings.restX);
    const restY = numberOrNull(activeSettings.restY);
    const rotation = numberOrNull(activeSettings.rotation);
    if (restX === null || restY === null || rotation === null) {
      setError('请输入有效的骨骼位置与角度。');
      return;
    }
    const length = numberOrNull(activeSettings.length);
    const minDeg = numberOrNull(activeSettings.minDeg);
    const maxDeg = numberOrNull(activeSettings.maxDeg);
    try {
      const state = editorProjectStore.getSnapshot();
      if (!state) return;
      let project = boneService.updateBone(state.project, character.id, selected.id, {
        name: activeSettings.name.trim() || null,
        restLocal: { x: restX, y: restY, rotationDeg: rotation },
        length,
        minDeg,
        maxDeg,
      });
      project = boneService.bindBonePart(
        project, character.id, selected.id, activeSettings.partId || null);
      mutate(project, '编辑骨骼');
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法保存骨骼设置。');
    }
  }

  function commitPose(reset: boolean): void {
    if (!selected) return;
    try {
      const state = editorProjectStore.getSnapshot();
      if (!state) return;
      const address = { shotId: shot.id, layerId: layer.id, boneId: selected.id, timeMs };
      let project: typeof state.project;
      if (reset) {
        project = boneService.resetBonePose(state.project, address);
      } else {
        if (!activePose) return;
        const x = numberOrNull(activePose.x);
        const y = numberOrNull(activePose.y);
        const rotation = numberOrNull(activePose.rotation);
        const scalePercent = numberOrNull(activePose.scale);
        if (x === null || y === null || rotation === null || scalePercent === null) {
          setError('请输入有效的骨骼姿态数值。');
          return;
        }
        const scale = scalePercent / 100;
        if (scale < CHARACTER_PART_MIN_SCALE - 1e-9 || scale > CHARACTER_PART_MAX_SCALE + 1e-9) {
          setError(`缩放范围为 ${CHARACTER_PART_MIN_SCALE * 100}%～${CHARACTER_PART_MAX_SCALE * 100}%。`);
          return;
        }
        project = boneService.applyBonePose(state.project, address, {
          'transform.offsetX': x,
          'transform.offsetY': y,
          'transform.rotationDeg': rotation,
          'transform.scaleX': scale,
          'transform.scaleY': scale,
        });
      }
      mutate(project, reset ? '重置骨骼姿态' : '记录骨骼姿态');
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法记录骨骼姿态。');
    }
  }

  function deletePoseKey(): void {
    if (!selected) return;
    try {
      const state = editorProjectStore.getSnapshot();
      if (!state) return;
      const project = boneService.deleteBoneKey(state.project, {
        shotId: shot.id, layerId: layer.id, boneId: selected.id, timeMs,
      });
      mutate(project, '删除骨骼关键帧');
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法删除骨骼关键帧。');
    }
  }

  const field = (value: string, onChange: (next: string) => void, label: string, extra?: {
    step?: number; disabled?: boolean;
  }) => <label>{label}<input type="number" step={extra?.step ?? 1} disabled={!editable || extra?.disabled}
    value={value} onChange={(event) => onChange(event.target.value)} /></label>;

  if (!tree.ok) {
    return <details className="animation-key-selection" data-testid="character-bone">
      <summary>骨骼</summary>
      <p role="alert">骨骼数据无效：{tree.message}</p>
    </details>;
  }

  return <details className="animation-key-selection" data-testid="character-bone">
    <summary>骨骼</summary>
    {bones.length ? <div className="animation-curve-fields">
      <label>当前骨骼<select value={selected?.id ?? ''} disabled={!editable}
        onChange={(event) => { setSelectedBoneId(event.target.value); setError(''); }}>
        {bones.map((bone, index) => <option key={bone.id} value={bone.id}>{boneDisplayName(bone, index)}</option>)}
      </select></label>
      <Button variant="secondary" disabled={!editable || !selected}
        onClick={() => createBone(selected?.id ?? null)}>新建子骨骼</Button>
      <Button variant="secondary" disabled={!editable || !selected}
        onClick={deleteBone}>删除骨骼</Button>
    </div> : <div className="animation-curve-fields">
      <Button disabled={!editable} onClick={() => createBone(null)}>新建根骨骼</Button>
    </div>}
    {activeSettings && selected ? <>
      <fieldset className="animation-curve-fields">
        <legend>骨骼设置</legend>
        <label>名称<input maxLength={200} disabled={!editable} value={activeSettings.name}
          placeholder={boneDisplayName(selected, bones.indexOf(selected))}
          onChange={(event) => setSettings({ ...activeSettings, name: event.target.value })} /></label>
        <label>绑定部件<select value={activeSettings.partId} disabled={!editable}
          onChange={(event) => setSettings({ ...activeSettings, partId: event.target.value })}>
          <option value="">不绑定</option>
          {bindableParts.map((part) => <option key={part.partId} value={part.partId}>
            {part.displayName ?? part.partId}
          </option>)}
        </select></label>
        {field(activeSettings.restX, (restX) => setSettings({ ...activeSettings, restX }), '静止位置 X')}
        {field(activeSettings.restY, (restY) => setSettings({ ...activeSettings, restY }), '静止位置 Y')}
        {field(activeSettings.rotation, (rotation) => setSettings({ ...activeSettings, rotation }), '静止角度 °')}
        {field(activeSettings.length, (length) => setSettings({ ...activeSettings, length }), '骨骼长度')}
        {field(activeSettings.minDeg, (minDeg) => setSettings({ ...activeSettings, minDeg }), '最小角 °')}
        {field(activeSettings.maxDeg, (maxDeg) => setSettings({ ...activeSettings, maxDeg }), '最大角 °')}
      </fieldset>
      <div className="animation-curve-fields">
        <Button disabled={!editable} onClick={saveSettings}>保存骨骼设置</Button>
      </div>
      {boundPart ? <p role="note">
        {boundPart.displayName ?? boundPart.partId} 已绑定此骨骼，骨骼动作会带动该部件。
        {boundPartHasKeys ? ' 该部件已有自身动作关键帧，会叠加在骨骼动作之上。' : ''}
      </p> : null}
      <fieldset className="animation-curve-fields">
        <legend>姿态（当前帧）</legend>
        {activePose ? <>
          {field(activePose.x, (x) => setPose({ ...activePose, x }), '位移 X')}
          {field(activePose.y, (y) => setPose({ ...activePose, y }), '位移 Y')}
          {field(activePose.rotation, (rotation) => setPose({ ...activePose, rotation }), '旋转 °')}
          {field(activePose.scale, (scale) => setPose({ ...activePose, scale }), '缩放 %')}
        </> : <p>请先将播放头移到镜头内的有效帧。</p>}
      </fieldset>
      <div className="animation-curve-fields">
        <Button disabled={!editable || !activePose} onClick={() => commitPose(false)}>记录姿态</Button>
        <Button variant="secondary" disabled={!editable || !activePose}
          onClick={() => commitPose(true)}>重置姿态</Button>
        <Button variant="secondary" disabled={!editable || !clip || timeMs === 0}
          onClick={deletePoseKey}>删除当前帧关键帧</Button>
      </div>
    </> : null}
    {error ? <p role="alert">{error}</p> : null}
  </details>;
}

export function CharacterBoneControl(props: CharacterBoneControlProps): React.JSX.Element | null {
  const characterId = props.layer.source.kind === 'character'
    ? props.layer.source.characterId
    : undefined;
  const character = props.snapshot.project.characters.find(({ id }) => id === characterId);
  if (character?.mode !== 'adaptive-parts') return null;
  if ((character.bones?.length ?? 0) === 0) {
    const partCount = character.parts.filter((part) => part.visible).length;
    if (partCount === 0) return null;
  }
  return <CharacterBoneForm key={String(editorProjectStore.getProjectInstanceId()) + character.id + props.layer.id}
    {...props} character={character} />;
}
