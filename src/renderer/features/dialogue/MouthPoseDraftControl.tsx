import { useEffect, useMemo, useRef, useState } from 'react';
import {
  applyMouthPoseDraft, selectMouthPoseGeneration, type Dialogue, type ImageAsset, type MouthPoseDraftSegment, type Shot,
} from '../../../domain';
import { editorProjectStore, type EditorProjectSnapshot } from '../../stores/EditorProjectStore';
import { useProjectImageThumbnails } from '../characters/CharacterIdentity';
import { GraphicFacePreview } from '../characters/GraphicFacePicker';
import { MOUTH_POSE_LABELS } from '../characters/MouthPoseSetEditor';

type DraftAuthority = {
  snapshot: EditorProjectSnapshot;
  key: string;
  selection: Parameters<typeof selectMouthPoseGeneration>[1];
};
type Draft = DraftAuthority & { segments: MouthPoseDraftSegment[] };

export function MouthPoseDraftControl({ snapshot, shot, dialogue }: {
  snapshot: EditorProjectSnapshot; shot: Shot; dialogue: Dialogue;
}) {
  const [layerId, setLayerId] = useState('');
  const [from, setFrom] = useState(String(dialogue.startMs / 1_000));
  const [to, setTo] = useState(String(dialogue.endMs / 1_000));
  const [pending, setPending] = useState<DraftAuthority>();
  const [draft, setDraft] = useState<Draft>();
  const [error, setError] = useState('');
  const [inspected, setInspected] = useState(0);
  const request = useRef<string | undefined>(undefined);
  const character = snapshot.project.characters.find((item) => item.id === dialogue.characterId);
  const layers = shot.layers.filter((layer) =>
    layer.source.kind === 'character' && layer.source.characterId === character?.id && !layer.locked);
  const key = JSON.stringify([shot.id, dialogue.id, layerId, from, to]);
  const isCurrent = (authority?: DraftAuthority) =>
    authority?.snapshot.project === snapshot.project && authority.key === key;
  const currentDraft = isCurrent(draft) ? draft : undefined;
  const busy = isCurrent(pending);

  useEffect(() => () => {
    const requestId = request.current;
    request.current = undefined;
    if (requestId) void window.pandaStage?.assets?.cancelMouthPoseAnalysis(requestId).catch(() => undefined);
  }, [snapshot.project, key]);

  function cancel() {
    const requestId = request.current;
    request.current = undefined;
    if (requestId) void window.pandaStage.assets.cancelMouthPoseAnalysis(requestId).catch(() => undefined);
    setPending(undefined);
    setDraft(undefined);
  }

  async function generate() {
    setError('');
    if (!from.trim() || !to.trim()) { setError('请输入分析范围。'); return; }
    const selection = { shotId: shot.id, dialogueId: dialogue.id, layerId,
      startMs: Math.round(Number(from) * 1_000), endMs: Math.round(Number(to) * 1_000) };
    let id: string | undefined;
    try {
      const source = selectMouthPoseGeneration(snapshot.project, selection);
      const authority = { snapshot, key, selection };
      id = crypto.randomUUID();
      request.current = id;
      setPending(authority);
      setDraft(undefined);
      const analyzed = await window.pandaStage.assets.analyzeMouthPoses({
        projectRoot: snapshot.projectRoot, assetId: source.asset.id, sha256: source.sha256,
        requestId: id, sourceStartMs: source.sourceStartMs, durationMs: source.audio.endMs - source.audio.startMs,
      });
      if (request.current !== id || editorProjectStore.getSnapshot()?.project !== snapshot.project) return;
      if (!analyzed?.length) throw new Error('无法分析这段配音，请确认音频文件可以正常播放。');
      const segments: MouthPoseDraftSegment[] = [];
      const push = (segment: MouthPoseDraftSegment) => {
        if (segment.endMs <= segment.startMs) return;
        const prev = segments.at(-1);
        if (prev?.category === segment.category && prev.endMs === segment.startMs) prev.endMs = segment.endMs;
        else segments.push(segment);
      };
      push({ startMs: selection.startMs, endMs: source.audio.startMs, category: 'rest' });
      for (const item of analyzed) push({ category: item.category,
        startMs: source.audio.startMs + item.startMs, endMs: source.audio.startMs + item.endMs });
      push({ startMs: source.audio.endMs, endMs: selection.endMs, category: 'rest' });
      setInspected(0);
      setDraft({ ...authority, segments });
      request.current = undefined;
      setPending(undefined);
    } catch (problem) {
      if (editorProjectStore.getSnapshot()?.project !== snapshot.project || (id && request.current !== id)) return;
      setError(problem instanceof Error ? problem.message : '无法生成口型。');
      request.current = undefined;
      setPending(undefined);
    }
  }

  function apply() {
    if (!currentDraft || editorProjectStore.getSnapshot()?.project !== snapshot.project) return;
    try {
      const next = applyMouthPoseDraft(snapshot.project, currentDraft.selection, currentDraft.segments, () => crypto.randomUUID());
      editorProjectStore.updateProject(next, '应用口型草稿');
      setDraft(undefined);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : '无法应用口型草稿。');
    }
  }

  const oldCue = currentDraft && shot.timelineEvents.some((event) =>
    event.type === 'mouth-cue' && event.layerId === layerId && event.startMs < currentDraft.selection.endMs);
  const preview = currentDraft?.segments[inspected];
  const mapped = preview && character?.mouthPoseSet?.poses.find((pose) =>
    pose.id === character.mouthPoseSet?.analyzerMapping[preview.category]);
  const imageId = mapped?.source.kind === 'image' ? mapped.source.assetId : undefined;
  const previewAssets = useMemo(() => snapshot.project.assets.filter((asset): asset is ImageAsset =>
    asset.kind === 'image' && asset.id === imageId), [snapshot.project.assets, imageId]);
  const { thumbnails, onThumbnailError } = useProjectImageThumbnails(snapshot.projectRoot, previewAssets, snapshot.project);
  const thumbnail = imageId ? thumbnails[imageId] : undefined;
  if (!character) return null;
  return <details className="dialogue-mouth-pose" data-testid="dialogue-mouth-pose">
    <summary>生成口型</summary>
    {!character.mouthPoseSet ? <p>请先在角色的「可编辑口型」中配置姿态。</p> : <>
      <label>镜头实例 <select value={layerId} onChange={(event) => { cancel(); setLayerId(event.currentTarget.value); }}>
        <option value="">选择实例</option>
        {layers.map((layer) => <option key={layer.id} value={layer.id}>{layer.name}（图层 {shot.layers.indexOf(layer) + 1}）</option>)}
      </select></label>
      <label>开始（秒） <input aria-label="口型分析开始秒数" type="number" min="0" step="0.001" value={from}
        onChange={(event) => { cancel(); setFrom(event.currentTarget.value); }} /></label>
      <label>结束（秒） <input aria-label="口型分析结束秒数" type="number" min="0" step="0.001" value={to}
        onChange={(event) => { cancel(); setTo(event.currentTarget.value); }} /></label>
      {busy ? <button type="button" onClick={cancel}>取消分析</button>
        : <button type="button" disabled={!layerId || !dialogue.audioClipId} onClick={() => void generate()}>分析配音</button>}
      {!dialogue.audioClipId ? <p>绑定配音后可生成草稿。时间轴仍可手动添加口型。</p> : null}
      {character.mouthPoseSet.driveMode === 'asset-loop' ? <p>当前为素材循环。切换到口型帧后，自动生成的口型段会生效。</p> : null}
      {currentDraft ? <>
        {oldCue ? <p role="status">旧张闭嘴标记会盖过自动段。可在时间轴选择并删除对应标记。</p> : null}
        <label>草稿段 <select value={inspected} onChange={(event) => setInspected(Number(event.currentTarget.value))}>
          {currentDraft.segments.map((segment, i) => <option key={segment.startMs} value={i}>
            {segment.startMs / 1_000}–{segment.endMs / 1_000} 秒 · {MOUTH_POSE_LABELS[segment.category]}
          </option>)}
        </select></label>
        {mapped ? <output>{mapped.name}</output> : null}
        {mapped?.source.kind === 'fla-graphic' ? <GraphicFacePreview source={mapped.source} label={`口型预览：${mapped.name}`} /> : null}
        {thumbnail?.status === 'ready' && imageId ? <img src={thumbnail.dataUrl} alt={`口型预览：${mapped?.name}`} width={48} height={48}
          style={{ objectFit: 'contain' }} onError={() => onThumbnailError(imageId)} /> : null}
        <button type="button" onClick={apply}>应用草稿</button>
        <button type="button" onClick={cancel}>丢弃草稿</button>
      </> : null}
    </>}
    {error ? <p role="alert">{error}</p> : null}
  </details>;
}
