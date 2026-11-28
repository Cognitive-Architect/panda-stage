import { useEffect, useState } from 'react';
import {
  CharacterVectorSkinService,
  characterBoneProtectedPartIds,
  characterVectorSkinFallbackText,
  resolveCharacterBoneTree,
  resolveTimelineFrameTime,
  type AdaptivePartsCharacter,
  type CharacterVectorSkin,
  type CharacterVectorSkinStatusRow,
  type Layer,
  type Project,
  type Shot,
} from '../../../domain';
import { editorProjectStore, type EditorProjectSnapshot } from '../../stores/EditorProjectStore';
import { Button } from '../../ui/Button';
import { useTimelineUi } from '../timeline/timelineUiStore';

interface CharacterVectorSkinControlProps {
  snapshot: EditorProjectSnapshot;
  shot: Shot;
  layer: Layer;
}

const vectorSkinService = new CharacterVectorSkinService();

function boneLabel(character: AdaptivePartsCharacter, boneId: string): string {
  const tree = resolveCharacterBoneTree(character);
  const index = tree.ok ? tree.order.indexOf(boneId) : -1;
  const bone = tree.ok ? tree.byId.get(boneId) : undefined;
  return bone?.name?.trim() || `骨骼 ${Math.max(0, index) + 1}`;
}

function partLabel(character: AdaptivePartsCharacter, partId: string): string {
  const index = character.parts.findIndex((part) => part.partId === partId);
  const part = character.parts[index];
  return part?.displayName?.trim() || `部件 ${Math.max(0, index) + 1}`;
}

function statusText(row: CharacterVectorSkinStatusRow): string {
  if (row.requiresAnimationClip) return '记录骨骼姿态后生效';
  const status = row.status;
  if (!status) return '等待求值';
  if (status.fallback) return characterVectorSkinFallbackText(status.fallback);
  return `锚点 ${status.anchorCount}${status.deformed ? ' · 已变形' : ' · 静止'}`;
}

function CharacterVectorSkinForm({
  snapshot,
  shot,
  layer,
  character,
}: CharacterVectorSkinControlProps & { character: AdaptivePartsCharacter }): React.JSX.Element | null {
  const { currentTimeMs } = useTimelineUi();
  const timeMs = resolveTimelineFrameTime(currentTimeMs, shot.durationMs);
  const revision = snapshot.revision;
  const tree = resolveCharacterBoneTree(character);
  const bones = tree.ok
    ? tree.order.flatMap((boneId) => {
        const bone = tree.byId.get(boneId);
        return bone ? [bone] : [];
      })
    : [];
  const skins = character.vectorSkins ?? [];
  const skinnedPartIds = new Set(skins.map((skin) => skin.partId));
  const protectedPartIds = characterBoneProtectedPartIds(character);
  const eligibleParts = character.parts.filter((part) =>
    part.visible &&
    !protectedPartIds.has(part.partId) &&
    !skinnedPartIds.has(part.partId) &&
    part.visualSource?.kind === 'fla-graphic');
  const [partId, setPartId] = useState<string>(eligibleParts[0]?.partId ?? '');
  const [firstBoneId, setFirstBoneId] = useState<string>(bones[0]?.id ?? '');
  const [secondBoneId, setSecondBoneId] = useState<string>(bones[1]?.id ?? '');
  const [error, setError] = useState('');
  const [rows, setRows] = useState<readonly CharacterVectorSkinStatusRow[]>([]);
  const editable = !layer.locked;
  const activePartId = eligibleParts.some((part) => part.partId === partId)
    ? partId
    : (eligibleParts[0]?.partId ?? '');
  const activeFirstBoneId = bones.some((bone) => bone.id === firstBoneId) ? firstBoneId : (bones[0]?.id ?? '');
  const activeSecondBoneId = bones.some((bone) => bone.id === secondBoneId) && secondBoneId !== activeFirstBoneId
    ? secondBoneId
    : (bones.find((bone) => bone.id !== activeFirstBoneId)?.id ?? '');

  useEffect(() => {
    try {
      setRows(vectorSkinService.describe(snapshot.project, {
        shotId: shot.id, layerId: layer.id, timeMs,
      }));
      setError('');
    } catch (cause) {
      setRows([]);
      setError(cause instanceof Error ? cause.message : '无法读取蒙皮状态。');
    }
  }, [revision, shot.id, layer.id, timeMs]);

  function mutate(project: Project, label: string): void {
    if (project !== editorProjectStore.getSnapshot()?.project) {
      editorProjectStore.updateProject(project, label);
    }
  }

  function createSkin(): void {
    try {
      const state = editorProjectStore.getSnapshot();
      if (!state || !activePartId || !activeFirstBoneId || !activeSecondBoneId) return;
      const next = vectorSkinService.create(state.project, character.id, {
        partId: activePartId,
        boneIds: [activeFirstBoneId, activeSecondBoneId],
      });
      mutate(next, '创建矢量蒙皮');
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法创建矢量蒙皮。');
    }
  }

  function deleteSkin(skin: CharacterVectorSkin): void {
    try {
      const state = editorProjectStore.getSnapshot();
      if (!state) return;
      mutate(vectorSkinService.delete(state.project, character.id, skin.id), '删除矢量蒙皮');
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法删除矢量蒙皮。');
    }
  }

  if (bones.length < 2 && skins.length === 0) return null;

  return <details className="animation-key-selection" data-testid="character-vector-skin">
    <summary>矢量蒙皮</summary>
    {bones.length >= 2 && eligibleParts.length > 0 ? <>
      <div className="animation-curve-fields">
        <label>矢量部件<select value={activePartId} disabled={!editable}
          onChange={(event) => { setPartId(event.target.value); setError(''); }}>
          {eligibleParts.map((part) => <option key={part.partId} value={part.partId}>
            {partLabel(character, part.partId)}
          </option>)}
        </select></label>
      </div>
      <div className="animation-curve-fields">
        <label>骨骼 A<select value={activeFirstBoneId} disabled={!editable}
          onChange={(event) => { setFirstBoneId(event.target.value); setError(''); }}>
          {bones.map((bone) => <option key={bone.id} value={bone.id}>{boneLabel(character, bone.id)}</option>)}
        </select></label>
        <label>骨骼 B<select value={activeSecondBoneId} disabled={!editable}
          onChange={(event) => { setSecondBoneId(event.target.value); setError(''); }}>
          {bones.filter((bone) => bone.id !== activeFirstBoneId).map((bone) =>
            <option key={bone.id} value={bone.id}>{boneLabel(character, bone.id)}</option>)}
        </select></label>
        <Button disabled={!editable || !activePartId || !activeFirstBoneId || !activeSecondBoneId}
          onClick={createSkin}>创建蒙皮</Button>
      </div>
    </> : null}
    {skins.length > 0
      ? <ul data-testid="character-vector-skin-list">
        {skins.map((skin) => {
          const row = rows.find((candidate) => candidate.skin.id === skin.id);
          return <li key={skin.id}>
            <strong>{row?.partName ?? partLabel(character, skin.partId)}</strong>
            <span>{` · ${row?.boneNames[0] ?? boneLabel(character, skin.boneIds[0])} + ${row?.boneNames[1] ?? boneLabel(character, skin.boneIds[1])}`}</span>
            <span>{` · ${row ? statusText(row) : '等待求值'}`}</span>
            <div className="animation-curve-fields">
              <Button variant="secondary" disabled={!editable} onClick={() => deleteSkin(skin)}>删除蒙皮</Button>
            </div>
          </li>;
        })}
      </ul>
      : <p>选择矢量部件与两根骨骼后创建。</p>}
    {error ? <p role="alert">{error}</p> : null}
  </details>;
}

export function CharacterVectorSkinControl(props: CharacterVectorSkinControlProps): React.JSX.Element | null {
  const characterId = props.layer.source.kind === 'character'
    ? props.layer.source.characterId
    : undefined;
  const character = props.snapshot.project.characters.find(({ id }) => id === characterId);
  if (character?.mode !== 'adaptive-parts') return null;
  if (!character.parts.some((part) => part.visualSource?.kind === 'fla-graphic')) return null;
  return <CharacterVectorSkinForm
    key={String(editorProjectStore.getProjectInstanceId()) + character.id + props.layer.id}
    {...props} character={character} />;
}
