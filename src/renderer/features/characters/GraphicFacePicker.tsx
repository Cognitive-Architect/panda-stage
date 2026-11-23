import { useEffect, useEffectEvent, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { isFlaGraphicDefinition, TalkingAnimationPlaybackSchema, type Character, type FlaGraphicDefinition, type TalkingAnimationPlayback, type CharacterFaceGraphicSource, type MouthPoseSource } from '../../../domain';
import { isCharacterTalkingSourceAvailable, resolveCharacterFaceSourceOrNull } from '../../../domain/selectors/characterFaceSource';
import { resolveFlaGraphicPreviewTimeline } from '../../../domain/selectors/animationSourceTimeline';
import { hasFlaGraphicTemporalPlayback } from '../../../domain/evaluate-shot-at-time';
import { Button } from '../../ui/Button';
import { AnimationPreview } from '../assets/AnimationLibraryPanel';
import { editorProjectStore, type EditorProjectSnapshot } from '../../stores/EditorProjectStore';
import { CanvasImageResourceSession, EMPTY_CANVAS_IMAGE_STATE } from '../canvas/canvasImageResources';
import { renderFlaGraphicCanvas } from '../canvas/flaGraphicCanvasRenderer';
import './graphic-face-picker.css';

export type GraphicFacePreviewResult = 'pending' | 'ready' | 'failed';

/** Uses the same structured renderer and decoded-image cache contract as Stage. */
export function GraphicFacePreview({ source, label = '表情预览', onResult }: {
  source: Extract<MouthPoseSource, { kind: 'fla-graphic' }>;
  label?: string;
  onResult?: (snapshot: EditorProjectSnapshot, result: GraphicFacePreviewResult) => void;
}): React.JSX.Element {
  const snapshot = useSyncExternalStore(editorProjectStore.subscribe, editorProjectStore.getSnapshot, editorProjectStore.getSnapshot);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [loaded, setLoaded] = useState<{ resolved: NonNullable<typeof resolved>; images: typeof EMPTY_CANVAS_IMAGE_STATE }>();
  const [failed, setFailed] = useState(false);
  const resolved = useMemo(() => snapshot ? resolveCharacterFaceSourceOrNull(snapshot.project, source) : null,
    [snapshot, source.animationId, source.firstFrame, source.internalTimeMs]);
  const report = useEffectEvent((result: GraphicFacePreviewResult) => {
    if (snapshot) onResult?.(snapshot, result);
  });
  const checkPreview = Boolean(onResult);
  useEffect(() => {
    const target = canvas.current;
    if (!target || checkPreview) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); } });
    observer.observe(target);
    return () => observer.disconnect();
  }, [checkPreview]);
  const active = visible || checkPreview;
  const graphic = resolved?.flaGraphic;
  const requiredIds = useMemo(() => new Set([
    ...(graphic?.resourceAssetIds ?? []),
    ...(resolved?.assetId ? [resolved.assetId] : []),
  ]), [resolved, graphic]);
  useEffect(() => {
    if (!active || !snapshot || !resolved || requiredIds.size === 0) return;
    const resourceSession = new CanvasImageResourceSession();
    resourceSession.reconcile({
      contextKey: snapshot.projectRoot,
      projectRoot: snapshot.projectRoot,
      assets: snapshot.project.assets.filter(asset => asset.kind === 'image' && requiredIds.has(asset.id)),
    }, images => setLoaded({ resolved, images }));
    return () => resourceSession.dispose();
  }, [active, snapshot, resolved, requiredIds]);
  useEffect(() => {
    const target = canvas.current;
    const context = target?.getContext('2d');
    const finish = (result: GraphicFacePreviewResult): void => {
      setFailed(result === 'failed');
      report(result);
    };
    if (!active) return;
    if (!target || !context || !resolved || !graphic) {
      finish('failed');
      return;
    }
    context.clearRect(0, 0, target.width, target.height);
    const images = loaded?.resolved === resolved ? loaded.images : EMPTY_CANVAS_IMAGE_STATE;
    if (images.missing.size > 0 || [...requiredIds].some(id => !snapshot?.project.assets.some(
      asset => asset.kind === 'image' && asset.id === id,
    ))) {
      finish('failed');
      return;
    }
    if ([...requiredIds].some(id => !images.images.has(id))) {
      finish('pending');
      return;
    }
    const scale = Math.min(target.width / resolved.width, target.height / resolved.height);
    const left = (target.width - resolved.width * scale) / 2, top = (target.height - resolved.height * scale) / 2;
    try {
      if (graphic.structureFrame) {
        const rendered = renderFlaGraphicCanvas(graphic, images.images);
        if (rendered?.visibleRect) {
          context.drawImage(rendered.canvas, left + (rendered.rect.x + resolved.width / 2) * scale, top + (rendered.rect.y + resolved.height / 2) * scale, rendered.rect.width * scale, rendered.rect.height * scale);
        } else {
          finish('failed');
          return;
        }
      } else {
        const image = resolved.assetId ? images.images.get(resolved.assetId) : undefined;
        if (!image) {
          finish('failed');
          return;
        }
        context.drawImage(image, left + graphic.frameOffset.x * scale, top + graphic.frameOffset.y * scale, graphic.frameViewport.width * scale, graphic.frameViewport.height * scale);
      }
      const visiblePixels = !checkPreview || context.getImageData(0, 0, target.width, target.height).data.some(
        (value, index) => index % 4 === 3 && value !== 0,
      );
      finish(visiblePixels ? 'ready' : 'failed');
    } catch {
      finish('failed');
    }
  }, [active, checkPreview, graphic, loaded, requiredIds, resolved, snapshot]);
  const thumbnailScale = resolved ? Math.min(1, 480 / resolved.width, 360 / resolved.height) : 1;
  const width = resolved ? Math.max(1, Math.round(resolved.width * thumbnailScale)) : 240;
  const height = resolved ? Math.max(1, Math.round(resolved.height * thumbnailScale)) : 180;
  return <canvas ref={canvas} width={width} height={height} role="img" aria-label={failed || !resolved ? `${label}：素材不可用` : label} data-first-frame={source.firstFrame} />;
}

export function TalkingAnimationPicker({ animationId, playback, onApply, disabled, forClaim = false, forExpression = false }: {
  animationId?: string;
  playback?: TalkingAnimationPlayback;
  forClaim?: boolean;
  forExpression?: boolean;
  onApply: (animationId: string | null, playback?: TalkingAnimationPlayback) => void;
  disabled?: boolean;
}): React.JSX.Element {
  const snapshot = useSyncExternalStore(editorProjectStore.subscribe, editorProjectStore.getSnapshot, editorProjectStore.getSnapshot);
  const [draft, setDraft] = useState<string | null>(null);
  const [draftPlayback, setDraftPlayback] = useState<TalkingAnimationPlayback>();
  const [previewRest, setPreviewRest] = useState(false);
  const [open, setOpen] = useState(forExpression);
  const titleId = useId();
  const animations = snapshot?.project.animations.filter(animation =>
    isFlaGraphicDefinition(animation) ? hasFlaGraphicTemporalPlayback(animation) : animation.frames.length > 1,
  ) ?? [];
  const selected = animations.find(animation => animation.id === (draft ?? animationId));
  const selectedPlayback = draftPlayback ?? (selected?.id === animationId ? playback : undefined);
  const total = selected ? resolveFlaGraphicPreviewTimeline(selected, true).totalFrames : 1;
  const settings = selectedPlayback ?? { firstFrame: 0, lastFrame: total - 1, mode: 'loop' as const };
  const appliedPlayback = forClaim || forExpression ? settings : selectedPlayback;
  const update = (value: Partial<TalkingAnimationPlayback>): void => {
    setDraftPlayback({ ...settings, ...value });
    setPreviewRest(false);
  };
  return (
    <div className="graphic-face-picker">
      {!forExpression ? <Button variant="secondary" aria-expanded={open} disabled={disabled} onClick={() => {
        setDraft(null);
        setDraftPlayback(undefined);
        setPreviewRest(false);
        setOpen(!open);
      }}>{forClaim ? '选择说话片段' : '说话动画'}</Button> : null}
      {open && snapshot ? (
        <div className="graphic-face-options">
          <label>
            选择说话动画
            <select value={selected?.id ?? ''} disabled={disabled} onChange={event => {
              setDraft(event.target.value);
              setDraftPlayback(undefined);
              setPreviewRest(false);
            }}>
              <option value="">{forExpression ? '沿用角色通用来源' : '未配置'}</option>
              {animations.map(animation => <option key={animation.id} value={animation.id}>{animation.name}</option>)}
            </select>
          </label>
          {animations.length === 0 ? <p>请先在素材库导入一段多帧动画。</p> : null}
          {selected ? <>
            <div className="animation-preview-controls">
              <label>起始帧 <input type="number" min={1} max={settings.mode === 'single frame' ? total : settings.lastFrame + 1} value={settings.firstFrame + 1}
                disabled={disabled} onChange={event => {
                  const frame = event.target.valueAsNumber - 1;
                  if (!Number.isInteger(frame) || frame < 0 || frame >= total) return;
                  if (settings.mode === 'single frame') update({ firstFrame: frame, lastFrame: Math.max(frame, settings.lastFrame) });
                  else if (frame <= settings.lastFrame) update({ firstFrame: frame });
                }} /></label>
              <label>结束帧 <input type="number" min={settings.firstFrame + 1} max={total} value={settings.lastFrame + 1}
                disabled={disabled || settings.mode === 'single frame'} onChange={event => {
                  const frame = event.target.valueAsNumber - 1;
                  if (Number.isInteger(frame) && frame >= settings.firstFrame && frame < total) update({ lastFrame: frame });
                }} /></label>
              <label>播放方式 <select value={settings.mode} disabled={disabled}
                onChange={event => update({ mode: TalkingAnimationPlaybackSchema.shape.mode.parse(event.target.value) })}>
                <option value="loop">正放循环</option>
                <option value="play once">正放一次</option>
                <option value="loop reverse">倒放循环</option>
                <option value="play once reverse">倒放一次</option>
                <option value="single frame">单帧</option>
              </select></label>
              <label>静止帧 <input type="number" min={1} max={total} value={settings.restFrame === undefined ? '' : settings.restFrame + 1}
                placeholder="当前表情" disabled={disabled} onChange={event => {
                  const frame = event.target.valueAsNumber - 1;
                  if (event.target.value === '') update({ restFrame: undefined });
                  else if (Number.isInteger(frame) && frame >= 0 && frame < total) {
                    update({ restFrame: frame });
                    setPreviewRest(true);
                  }
                }} /></label>
              {settings.restFrame !== undefined ? <Button variant="secondary" aria-pressed={previewRest}
                onClick={() => setPreviewRest(!previewRest)}>查看静止帧</Button> : null}
            </div>
            <AnimationPreview key={selected.id} animation={selected} project={snapshot.project} projectRoot={snapshot.projectRoot}
              titleId={titleId} playback={appliedPlayback} stillFrame={previewRest ? settings.restFrame : undefined} />
          </> : null}
          <Button disabled={disabled || ((selected?.id ?? undefined) === animationId &&
            JSON.stringify(selected ? appliedPlayback : undefined) === JSON.stringify(playback))} onClick={() => {
            onApply(selected?.id ?? null, selected ? appliedPlayback : undefined);
            if (!forExpression) setOpen(false);
          }}>{forClaim ? '选用这段' : '应用说话动画'}</Button>
        </div>
      ) : null}
    </div>
  );
}

export function ExpressionTalkingAnimationPicker({ character, disabled, onApply }: {
  character: Character;
  disabled?: boolean;
  onApply: (expressionId: string, animationId: string | null, playback?: TalkingAnimationPlayback) => void;
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const snapshot = useSyncExternalStore(editorProjectStore.subscribe, editorProjectStore.getSnapshot, editorProjectStore.getSnapshot);
  const expressions = character.expressions ?? [];
  const expression = expressions.find((entry) => entry.id === selectedId) ?? expressions[0];
  if (!expression) return null;
  const source = character.expressionTalkingSources?.[expression.id];
  return <div className="graphic-face-picker">
    <Button variant="secondary" aria-expanded={open} disabled={disabled} onClick={() => setOpen(!open)}>表情专属说话</Button>
    {open ? <>
      <label>表情 <select value={expression.id} onChange={(event) => setSelectedId(event.target.value)}>
        {expressions.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
      </select></label>
      {source && snapshot && !isCharacterTalkingSourceAvailable(snapshot.project, source.animationId, source.playback)
        ? <p role="status">专属说话动画不可用。{character.talkingAnimationId ? '当前沿用角色通用来源。' : '当前沿用原表情与口型。'}</p> : null}
      <TalkingAnimationPicker key={expression.id} forExpression animationId={source?.animationId} playback={source?.playback}
        disabled={disabled} onApply={(id, playback) => onApply(expression.id, id, playback)} />
    </> : null}
  </div>;
}

type GraphicFrameSource = Extract<MouthPoseSource, { kind: 'fla-graphic' }>;

export function GraphicFrameChoices({ definition, selectedIndex, onSelect, includeInternalFrames, sourceAddresses, disabled, testId }: {
  definition: FlaGraphicDefinition;
  selectedIndex: number;
  onSelect: (source: GraphicFrameSource, frameIndex: number) => void;
  includeInternalFrames?: boolean;
  sourceAddresses?: boolean;
  disabled?: boolean;
  testId: string;
}): React.JSX.Element {
  const [page, setPage] = useState(0);
  const [address, setAddress] = useState('');
  const timeline = includeInternalFrames ? resolveFlaGraphicPreviewTimeline(definition, true) : null;
  const count = timeline?.totalFrames ?? definition.frames.length;
  const firstAddress = definition.source.startFrameIndex + 1;
  const query = address.trim();
  const labels = definition.sourceFrameLabels ?? [];
  const labelMatch = query && !/^\d+$/u.test(query)
    ? labels.find((label) => label.text.toLocaleLowerCase('zh-CN').includes(query.toLocaleLowerCase('zh-CN')))
    : undefined;
  const offset = (labelMatch ? labelMatch.sourceFrameIndex + 1 : Number(query)) - firstAddress;
  const validAddress = Number.isInteger(offset) && offset >= 0 && offset < count;
  return <>
    {sourceAddresses && (count > 12 || labels.length > 0) ? <form className="graphic-face-pagination" onSubmit={(event) => {
      event.preventDefault();
      if (validAddress) setPage(Math.floor(offset / 12));
    }}>
      <input type="search" aria-label="标签或源帧号" placeholder="标签或源帧号"
        value={address} onChange={(event) => setAddress(event.target.value)} />
      <Button variant="secondary" type="submit" disabled={!validAddress}>定位</Button>
    </form> : null}
    <div className="graphic-face-frames" aria-label={sourceAddresses ? '选择元件帧' : '选择表情帧'}>
      {Array.from({ length: Math.max(0, Math.min(12, count - page * 12)) }, (_, index) => {
        const frameIndex = page * 12 + index;
        const sample = timeline?.sampleAtFrameIndex(frameIndex);
        const source: GraphicFrameSource = { kind: 'fla-graphic', animationId: definition.id, firstFrame: sample?.frameOrdinal ?? frameIndex,
          ...(sample?.internalTimeMs !== undefined ? { internalTimeMs: sample.internalTimeMs } : {}) };
        const number = frameIndex + (sourceAddresses ? firstAddress : 1);
        const label = sourceAddresses ? labels.find((entry) => entry.sourceFrameIndex === number - 1)?.text : undefined;
        const frameLabel = label ? `${label} · 第 ${number} 帧` : `第 ${number} 帧`;
        return <button type="button" className="graphic-face-frame" key={frameIndex} disabled={disabled}
          aria-label={frameLabel} title={frameLabel} aria-pressed={selectedIndex === frameIndex}
          data-testid={`${testId}-frame-${frameIndex}`} onClick={() => onSelect(source, frameIndex)}>
          <GraphicFacePreview source={source} label={frameLabel} /><span>{label ?? number}</span>
        </button>;
      })}
    </div>
    {count > 12 ? <div className="graphic-face-pagination">
      <button type="button" className="graphic-face-page-button" disabled={page === 0} onClick={() => setPage(page - 1)}>上一页</button>
      <button type="button" className="graphic-face-page-button" disabled={(page + 1) * 12 >= count} onClick={() => setPage(page + 1)}>下一页</button>
    </div> : null}
  </>;
}

export function GraphicFacePicker({ source, onChange, onClear, disabled, testId, children, includeInternalFrames, excludeAnimationId }: {
  source?: CharacterFaceGraphicSource & { internalTimeMs?: number };
  onChange?: (source: MouthPoseSource) => void;
  onClear?: () => void;
  disabled?: boolean;
  testId: string;
  children: React.ReactNode;
  includeInternalFrames?: boolean;
  excludeAnimationId?: string;
}): React.JSX.Element {
  const snapshot = useSyncExternalStore(editorProjectStore.subscribe, editorProjectStore.getSnapshot, editorProjectStore.getSnapshot);
  const [open, setOpen] = useState(false);
  const [showImages, setShowImages] = useState(false);
  useEffect(() => {
    setOpen(false);
    setShowImages(false);
  }, [testId]);
  useEffect(() => { setShowImages(false); }, [source?.animationId, source?.firstFrame]);
  const definitions = snapshot?.project.animations.filter(isFlaGraphicDefinition)
    .filter((definition) => definition.id !== excludeAnimationId) ?? [];
  const definition = definitions.find(candidate => candidate.id === source?.animationId);
  const timeline = definition && includeInternalFrames ? resolveFlaGraphicPreviewTimeline(definition, true) : null;
  const selectedIndex = timeline && source?.internalTimeMs !== undefined
    ? Math.round(source.internalTimeMs * timeline.fps / 1_000) : source?.firstFrame ?? 0;
  return <div className="graphic-face-picker" data-testid={`${testId}-visual-source`}>
    {source && definition ? <div className="graphic-face-selected">
      <GraphicFacePreview source={source} />
      <button type="button" className="graphic-face-selected-toggle" disabled={disabled} aria-expanded={open} data-testid={`${testId}-graphic-toggle`} title={`${definition.name} · 第 ${selectedIndex + 1} 帧`} onClick={() => setOpen(!open)}>{definition.name} · {selectedIndex + 1}</button>
      {onClear ? <button type="button" className="graphic-face-clear" disabled={disabled} onClick={onClear}>清除</button> : null}
    </div> : null}
    {source && !showImages ? <button type="button" className="graphic-face-switch" disabled={disabled} onClick={() => setShowImages(true)}>更换图片</button> : children}
    {onChange && definitions.length && !source ? <button type="button" className="graphic-face-toggle" disabled={disabled} aria-expanded={open} data-testid={`${testId}-graphic-toggle`} onClick={() => setOpen(!open)}>选择元件</button> : null}
    {open && onChange ? <div className="graphic-face-options">
      <div className="graphic-face-definitions">{definitions.map(candidate => <button type="button" className="graphic-face-definition" key={candidate.id} disabled={disabled} aria-pressed={candidate.id === source?.animationId} onClick={() => { setShowImages(false); onChange({ kind: 'fla-graphic', animationId: candidate.id, firstFrame: 0 }); }}>{candidate.name}</button>)}</div>
      {definition ? <GraphicFrameChoices key={`${testId}:${definition.id}`} definition={definition} selectedIndex={selectedIndex}
        includeInternalFrames={includeInternalFrames} disabled={disabled} testId={testId} onSelect={(next) => {
          setShowImages(false); onChange(next);
        }} /> : null}
    </div> : null}
  </div>;
}
