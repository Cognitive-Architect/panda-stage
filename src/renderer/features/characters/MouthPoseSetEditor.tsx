import { useMemo, useState, useSyncExternalStore } from 'react';
import {
  MouthPoseCategorySchema, MouthPoseSetSchema, resolveCharacterPartVisualSource, resolveExpressionVisualSource,
  type ImageAsset, type MouthPose, type MouthPoseCategory, type MouthPoseSet, type MouthPoseSource,
} from '../../../domain';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { isFlaGraphicDefinition } from '../../../domain';
import { GraphicFacePicker } from './GraphicFacePicker';
import { ImageAssetPicker } from './ImageAssetPicker';
import { useProjectImageThumbnails } from './CharacterIdentity';

export const MOUTH_POSE_LABELS: Record<MouthPoseCategory, string> = {
  rest: '静止', open: '张嘴', wide: '咧嘴', round: '圆嘴', closed: '闭嘴',
};

export function MouthPoseSetEditor({ characterId, disabled }: { characterId: string; disabled?: boolean }) {
  const snapshot = useSyncExternalStore(editorProjectStore.subscribe, editorProjectStore.getSnapshot, editorProjectStore.getSnapshot);
  const character = snapshot?.project.characters.find((item) => item.id === characterId);
  const [selectedId, setSelectedId] = useState('');
  const [initialMouth, setInitialMouth] = useState<{ projectRoot: string; characterId: string; partId: string }>();
  const [initialPick, setInitialPick] = useState<{ target: typeof initialMouth; source: MouthPoseSource }>();
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState('');
  const [visibleImageIds, setVisibleImageIds] = useState<readonly string[]>([]);
  const set = character?.mouthPoseSet;
  const pose = set?.poses.find((candidate) => candidate.id === selectedId) ?? set?.poses[0];
  const projectAssets = snapshot?.project.assets;
  const images = useMemo(() => projectAssets?.filter((asset) => asset.kind === 'image') ?? [], [projectAssets]);
  const pickerSource = pose?.source ?? (initialPick?.target === initialMouth ? initialPick?.source : undefined);
  const selectedAssetId = pickerSource?.kind === 'image' ? pickerSource.assetId : null;
  const thumbnailAssets = useMemo(() => snapshot?.project.assets.filter((asset): asset is ImageAsset =>
    expanded && asset.kind === 'image' && (asset.id === selectedAssetId || visibleImageIds.includes(asset.id))) ?? [],
  [expanded, selectedAssetId, snapshot, visibleImageIds]);
  const { thumbnails, onThumbnailError } = useProjectImageThumbnails(snapshot?.projectRoot ?? null, thumbnailAssets, snapshot?.project ?? null);
  if (!snapshot || !character) return null;

  const needsMouthTarget = !pose && character.mode === 'adaptive-parts' && !character.faceBinding;
  const mouthPart = character.mode === 'adaptive-parts' && initialMouth?.projectRoot === snapshot.projectRoot &&
    initialMouth.characterId === character.id
    ? character.parts.find((part) => part.partId === initialMouth.partId)
    : undefined;
  const partSource = needsMouthTarget && mouthPart ? resolveCharacterPartVisualSource(mouthPart) : undefined;
  const scopedGraphic = partSource?.kind === 'fla-graphic' && (
    partSource.nodePath || partSource.regionRef || partSource.regionVector || partSource.instanceTransformOverrides
  ) ? partSource.animationId : undefined;
  const imageMapping = partSource?.kind === 'image' ? partSource.imageMapping : undefined;
  // The Part asset already contains the crop pixels. Its mapping places those pixels
  // at the original position, which the independent mouth replacement preserves.
  const partImage = partSource?.kind === 'image' && imageMapping
    ? images.find((asset) => asset.id === partSource.assetId &&
      asset.width === Math.round(imageMapping.crop.width * imageMapping.exportScale) &&
      asset.height === Math.round(imageMapping.crop.height * imageMapping.exportScale))
    : undefined;
  const partGraphic = partSource?.kind === 'fla-graphic'
    ? snapshot.project.animations.find((animation) => animation.id === partSource.animationId && isFlaGraphicDefinition(animation))
    : undefined;
  const needsExplicitSource = Boolean(partSource && (
    partSource.kind === 'image' ? !partImage :
      scopedGraphic || !partGraphic?.frames[partSource.poseFrameOrdinal ?? 0]
  ));
  const explicitSource = initialPick?.target === initialMouth ? initialPick?.source : undefined;
  const validExplicitSource = explicitSource?.kind === 'image'
    ? images.some((asset) => asset.id === explicitSource.assetId)
    : Boolean(explicitSource && explicitSource.animationId !== scopedGraphic &&
      snapshot.project.animations.some((item) => item.id === explicitSource.animationId &&
        isFlaGraphicDefinition(item) && item.frames[explicitSource.firstFrame]));

  function save(next: MouthPoseSet) {
    try {
      const current = editorProjectStore.getSnapshot();
      if (!current || current.project !== snapshot!.project) return;
      const parsed = MouthPoseSetSchema.parse(next);
      editorProjectStore.updateProject({
        ...current.project,
        characters: current.project.characters.map((item) =>
          item.id === characterId ? { ...item, mouthPoseSet: parsed } : item),
        updatedAt: new Date().toISOString(),
      }, '配置口型姿态');
      setError('');
    } catch {
      setError('无法保存口型，请检查姿态素材和绑定目标。');
    }
  }

  function changePose(update: Partial<MouthPose>) {
    if (!set || !pose) return;
    save({ ...set, poses: set.poses.map((item) => item.id === pose.id ? { ...pose, ...update } : item) });
  }

  function addPose() {
    if (!character || (needsMouthTarget && !mouthPart) || (needsExplicitSource && !validExplicitSource)) return;
    const expression = character.expressions?.find((item) => item.id === character.defaultExpressionId);
    const graphic = snapshot?.project.animations.find(isFlaGraphicDefinition);
    const initialSource = needsExplicitSource ? explicitSource :
      partImage ? { kind: 'image' as const, assetId: partImage.id } :
      partSource?.kind === 'fla-graphic'
        ? { kind: 'fla-graphic' as const, animationId: partSource.animationId, firstFrame: partSource.poseFrameOrdinal ?? 0 }
        : undefined;
    const source = pose?.source ?? initialSource ?? (
      expression ? resolveExpressionVisualSource(expression) :
      images[0] ? { kind: 'image' as const, assetId: images[0].id } :
        graphic ? { kind: 'fla-graphic' as const, animationId: graphic.id, firstFrame: 0 } : null);
    if (!source) { setError('请先导入一张嘴部或表情图片，或一个 Graphic 元件。'); return; }
    const id = crypto.randomUUID();
    const target = pose?.target ?? (needsMouthTarget && mouthPart
      ? { kind: 'mouth' as const, partId: mouthPart.partId } : { kind: 'face' as const });
    const newPose: MouthPose = { id, name: set ? `姿态 ${set.poses.length + 1}` : '静止', source, target };
    save(set ? { ...set, poses: [...set.poses, newPose] } : {
      poses: [newPose], restPoseId: id, driveMode: 'mouth-poses',
      analyzerMapping: { rest: id, open: id, wide: id, round: id, closed: id },
    });
    setSelectedId(id);
  }

  const mapped = Boolean(pose && set && Object.values(set.analyzerMapping).includes(pose.id));
  const inUse = Boolean(pose && snapshot.project.shots.some((shot) => shot.timelineEvents.some((event) =>
    event.type === 'mouth-pose' && event.poseId === pose.id)));
  function reorder(delta: number) {
    if (!set || !pose) return;
    const index = set.poses.indexOf(pose);
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= set.poses.length) return;
    const poses = [...set.poses];
    poses.splice(index, 1);
    poses.splice(nextIndex, 0, pose);
    save({ ...set, poses });
  }
  const targetPicker = character.mode === 'adaptive-parts' && (needsMouthTarget || pose) ? (
    <label>替换目标 <select value={pose?.target.kind === 'face' ? 'face' : pose?.target.partId ?? mouthPart?.partId ?? ''}
      onChange={(event) => {
        const partId = event.currentTarget.value;
        if (pose) changePose({ target: partId === 'face' ? { kind: 'face' } : { kind: 'mouth', partId } });
        else setInitialMouth({ projectRoot: snapshot.projectRoot, characterId: character.id, partId });
      }}>
      {needsMouthTarget ? <option value="" disabled>请选择嘴部零件</option> : <option value="face" disabled={!character.faceBinding}>整脸</option>}
      {character.parts.map((part) => <option key={part.partId} value={part.partId}>{part.displayName ?? '独立部件'}</option>)}
    </select></label>
  ) : null;
  function chooseSource(source: MouthPoseSource) {
    if (pose) changePose({ source });
    else setInitialPick({ target: initialMouth, source });
  }
  const sourcePicker = expanded && (pose || needsExplicitSource) ? (
    <GraphicFacePicker source={pickerSource?.kind === 'fla-graphic' ? pickerSource : undefined}
      key={pose?.id ?? mouthPart?.partId} disabled={disabled} includeInternalFrames
      excludeAnimationId={needsExplicitSource ? scopedGraphic : undefined} onChange={chooseSource}
      testId="mouth-pose-source">
      <ImageAssetPicker label="姿态图片" assets={images} selectedAssetId={selectedAssetId} thumbnails={thumbnails}
        onVisibleCandidatesChange={setVisibleImageIds} onThumbnailError={onThumbnailError}
        onChange={(assetId) => { if (assetId) chooseSource({ kind: 'image', assetId }); }} />
    </GraphicFacePicker>
  ) : null;
  return <details className="character-mouth-pose-settings" data-testid="mouth-pose-settings"
    onToggle={(event) => setExpanded(event.currentTarget.open)}>
    <summary>可编辑口型</summary>
    <fieldset disabled={disabled}>
      {set ? <label>播放模式 <select value={set.driveMode} onChange={(event) =>
        save({ ...set, driveMode: event.currentTarget.value as MouthPoseSet['driveMode'] })}>
        <option value="mouth-poses">口型帧</option><option value="asset-loop">素材循环</option>
      </select></label> : null}
      {needsMouthTarget ? targetPicker : null}
      {needsExplicitSource ? <>
        <p>请在下方选择一张独立的嘴部图片，或选择只包含嘴部的元件及对应帧。</p>
        {sourcePicker}
      </> : null}
      <button type="button" onClick={addPose}
        disabled={(needsMouthTarget && !mouthPart) || (needsExplicitSource && !validExplicitSource) ||
          (set?.poses.length ?? 0) >= 64}>添加姿态</button>
      {set && pose ? <>
        <label>姿态 <select value={pose.id} onChange={(event) => setSelectedId(event.currentTarget.value)}>
          {set.poses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        <input key={pose.id} aria-label="姿态名称" defaultValue={pose.name} maxLength={200}
          onBlur={(event) => { const name = event.currentTarget.value.trim(); if (name && name !== pose.name) changePose({ name }); }} />
        {targetPicker}
        {sourcePicker}
        <button type="button" disabled={mapped || inUse} title={mapped || inUse ? '此姿态仍被映射或时间段使用' : undefined}
          onClick={() => save({ ...set, poses: set.poses.filter((item) => item.id !== pose.id) })}>移除姿态</button>
        <button type="button" disabled={set.poses[0] === pose} onClick={() => reorder(-1)}>上移姿态</button>
        <button type="button" disabled={set.poses.at(-1) === pose} onClick={() => reorder(1)}>下移姿态</button>
        <div aria-label="配音映射">
          {MouthPoseCategorySchema.options.map((category) => <label key={category}>
            {MOUTH_POSE_LABELS[category]} <select aria-label={`${MOUTH_POSE_LABELS[category]}映射`} value={set.analyzerMapping[category]}
              onChange={(event) => {
                const id = event.currentTarget.value;
                save({ ...set, restPoseId: category === 'rest' ? id : set.restPoseId,
                  analyzerMapping: { ...set.analyzerMapping, [category]: id } });
              }}>
              {set.poses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>)}
        </div>
      </> : null}
      {error ? <p role="alert">{error}</p> : null}
    </fieldset>
  </details>;
}
