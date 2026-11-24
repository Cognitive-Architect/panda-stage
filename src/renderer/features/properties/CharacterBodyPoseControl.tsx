import { useContext, useEffect, useRef, useState } from 'react';
import {
  characterFaceAndMouthPartIds, deleteCharacterBodyPose, planCharacterBodyPose, resolveTimelineFrameTime, saveCharacterBodyPose,
  type AdaptivePartsCharacter, type CharacterBodyPose, type Layer, type Shot,
} from '../../../domain';
import { editorProjectStore, type EditorProjectSnapshot } from '../../stores/EditorProjectStore';
import { Button } from '../../ui/Button';
import { AnimationCurveDraftDispatch } from '../timeline/AnimationCurveDraft';
import { timelineUiStore, useTimelineUi } from '../timeline/timelineUiStore';
import { CharacterBodyPoseGallery } from './CharacterBodyPoseGallery';

interface CharacterBodyPoseControlProps {
  snapshot: EditorProjectSnapshot;
  shot: Shot;
  layer: Layer;
}

export function CharacterBodyPoseControl(props: CharacterBodyPoseControlProps): React.JSX.Element | null {
  const characterId = props.layer.source.kind === 'character' ? props.layer.source.characterId : undefined;
  const character = props.snapshot.project.characters.find(({ id }) => id === characterId);
  return character?.mode === 'adaptive-parts'
    ? <BodyPoseForm key={`${editorProjectStore.getProjectInstanceId()}:${character.id}`} {...props} character={character} />
    : null;
}

function BodyPoseForm({ snapshot, shot, layer, character }: CharacterBodyPoseControlProps & {
  character: AdaptivePartsCharacter;
}): React.JSX.Element {
  const { currentTimeMs } = useTimelineUi();
  const onDraft = useContext(AnimationCurveDraftDispatch);
  const draftActive = useRef(false);
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState('');
  const [activePoseId, setActivePoseId] = useState('');
  const [selectedParts, setSelectedParts] = useState<readonly string[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [preview, setPreview] = useState<{ poseId: string; timeMs: number; revision: number; instance: number | null;
    plan: ReturnType<typeof planCharacterBodyPose> }>();
  const instance = editorProjectStore.getProjectInstanceId();
  const timeMs = resolveTimelineFrameTime(currentTimeMs, shot.durationMs);
  const address = { shotId: shot.id, layerId: layer.id, timeMs };
  const pose = character.bodyPoses?.find(({ id }) => id === activePoseId) ?? character.bodyPoses?.[0];
  const protectedParts = characterFaceAndMouthPartIds(character);
  const bodyParts = character.parts.filter(({ partId, visible }) => visible && !protectedParts.has(partId) &&
    (layer.animationClip?.version !== 1 || layer.animationClip.targetBases.some(({ target, visible }) => visible && target.partId === partId)));
  const currentPreview = preview?.instance === instance && preview?.revision === snapshot.revision &&
    preview.timeMs === timeMs && preview.poseId === pose?.id ? preview : undefined;

  useEffect(() => () => {
    if (draftActive.current) {
      draftActive.current = false;
      onDraft?.(null);
    }
  }, [instance, onDraft, snapshot.revision, timeMs]);

  function cancelPreview(): void {
    if (draftActive.current) onDraft?.(null);
    draftActive.current = false;
    setPreview(undefined);
    setNotice('');
  }

  function save(): void {
    cancelPreview();
    try {
      const state = editorProjectStore.getSnapshot();
      if (!state) return;
      const project = saveCharacterBodyPose(state.project, address, name, selectedParts);
      const updated = project.characters.find(({ id }) => id === character.id);
      const saved = updated?.mode === 'adaptive-parts' ? updated.bodyPoses?.at(-1) : undefined;
      const omitted = bodyParts.flatMap(({ partId, displayName }, index) =>
        selectedParts.includes(partId) && !saved?.parts.some(part => part.partId === partId)
          ? [displayName ?? `部件 ${index + 1}`] : []);
      editorProjectStore.updateProject(project, '保存身体姿势');
      if (saved) setActivePoseId(saved.id);
      setName('');
      setError('');
      if (omitted.length) setNotice(`无法保存当前姿态的部件：${omitted.join('、')}。可换一帧单独保存。`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法保存身体姿势。');
    }
  }

  function previewPose(selected: CharacterBodyPose): void {
    if (!onDraft || editorProjectStore.getSnapshot() !== snapshot) return;
    cancelPreview();
    setActivePoseId(selected.id);
    try {
      const plan = planCharacterBodyPose(snapshot.project, address, selected.id);
      const list = (ids: readonly string[]) => ids.map(id => selected.parts.find(part => part.partId === id)?.partName ?? id).join('、');
      const feedback = [plan.missingPartIds.length ? `缺少部件：${list(plan.missingPartIds)}` : '',
        plan.actionPartIds.length ? `当前动作占用：${list(plan.actionPartIds)}` : ''].filter(Boolean);
      if (plan.project !== snapshot.project) {
        draftActive.current = true;
        onDraft({ project: plan.project, projectInstanceId: instance, revision: snapshot.revision,
          shotId: shot.id, layerId: layer.id, timeMs });
        setPreview({ poseId: selected.id, timeMs, revision: snapshot.revision, instance, plan });
      } else if (!feedback.length) {
        feedback.push('当前姿势已一致。');
      }
      setNotice(feedback.join('。'));
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法预览身体姿势。');
    }
  }

  function apply(): void {
    if (!currentPreview || editorProjectStore.getSnapshot() !== snapshot || editorProjectStore.getProjectInstanceId() !== instance ||
        resolveTimelineFrameTime(timelineUiStore.getSnapshot().currentTimeMs, shot.durationMs) !== currentPreview.timeMs) return;
    editorProjectStore.updateProject(currentPreview.plan.project, '应用身体姿势');
    cancelPreview();
  }

  function remove(): void {
    if (!pose) return;
    cancelPreview();
    try {
      const state = editorProjectStore.getSnapshot();
      if (!state) return;
      const project = deleteCharacterBodyPose(state.project, address, pose.id);
      if (project !== state.project) editorProjectStore.updateProject(project, '删除身体姿势');
      setActivePoseId('');
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法删除身体姿势。');
    }
  }

  return <details className="animation-key-selection" data-testid="character-body-pose" onToggle={(event) => {
    const open = event.currentTarget.open;
    setExpanded(open);
    if (!open) cancelPreview();
  }}>
    <summary>身体姿势</summary>
    {expanded && pose ? <>
      <CharacterBodyPoseGallery project={snapshot.project} projectRoot={snapshot.projectRoot} shot={shot}
        layerId={layer.id} character={character} selectedId={pose.id} disabled={layer.locked || !onDraft} onSelect={previewPose} />
      <div className="animation-curve-fields">
      {currentPreview ? <>
        <Button onClick={apply} disabled={layer.locked}>应用并落键</Button>
        <Button onClick={cancelPreview} variant="secondary">取消预览</Button>
      </> : <Button onClick={remove} disabled={layer.locked} variant="secondary">删除姿势</Button>}
      </div>
    </> : null}
    {bodyParts.length ? <details className="animation-key-selection">
      <summary>保存当前姿势</summary>
      <div className="animation-key-targets">
        {bodyParts.map(({ partId, displayName }, index) => <label key={partId}>
          <input type="checkbox" disabled={layer.locked} checked={selectedParts.includes(partId)} onChange={event => {
            const checked = event.target.checked;
            setSelectedParts(values => checked ? [...values, partId] : values.filter(id => id !== partId));
          }} />{displayName ?? `部件 ${index + 1}`}
        </label>)}
      </div>
      <div className="animation-curve-fields">
        <label>名称<input maxLength={64} disabled={layer.locked} value={name} onChange={event => setName(event.target.value)} /></label>
        <Button disabled={layer.locked || !name.trim() || !bodyParts.some(({ partId }) => selectedParts.includes(partId))}
          onClick={save}>保存姿势</Button>
      </div>
    </details> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
  </details>;
}
