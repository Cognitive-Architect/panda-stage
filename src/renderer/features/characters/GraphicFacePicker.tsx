import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { isFlaGraphicDefinition, TalkingAnimationPlaybackSchema, type TalkingAnimationPlayback, type CharacterFaceGraphicSource, type CharacterFaceSource } from '../../../domain';
import { resolveCharacterFaceSource } from '../../../domain/selectors/characterFaceSource';
import { resolveFlaGraphicPreviewTimeline } from '../../../domain/selectors/animationSourceTimeline';
import { hasFlaGraphicTemporalPlayback } from '../../../domain/evaluate-shot-at-time';
import { Button } from '../../ui/Button';
import { AnimationPreview } from '../assets/AnimationLibraryPanel';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { CanvasImageResourceSession, EMPTY_CANVAS_IMAGE_STATE } from '../canvas/canvasImageResources';
import { renderFlaGraphicCanvas } from '../canvas/flaGraphicCanvasRenderer';
import './graphic-face-picker.css';

/** Uses the same structured renderer and decoded-image cache contract as Stage. */
export function GraphicFacePreview({ source, label = '表情预览' }: { source: CharacterFaceGraphicSource; label?: string }): React.JSX.Element {
  const snapshot = useSyncExternalStore(editorProjectStore.subscribe, editorProjectStore.getSnapshot, editorProjectStore.getSnapshot);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [images, setImages] = useState(EMPTY_CANVAS_IMAGE_STATE);
  const session = useRef<CanvasImageResourceSession | null>(null);
  const resolved = useMemo(() => snapshot ? resolveCharacterFaceSource(snapshot.project, source) : null, [snapshot, source.animationId, source.firstFrame]);
  useEffect(() => {
    const target = canvas.current;
    if (!target) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); } });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible || !snapshot || !resolved) return;
    const resourceSession = new CanvasImageResourceSession();
    session.current = resourceSession;
    const ids = new Set(resolved.flaGraphic?.resourceAssetIds ?? []);
    if (resolved.assetId) ids.add(resolved.assetId);
    resourceSession.reconcile({ contextKey: snapshot.projectRoot, projectRoot: snapshot.projectRoot, assets: snapshot.project.assets.filter(asset => asset.kind === 'image' && ids.has(asset.id)) }, setImages);
    return () => { resourceSession.dispose(); session.current = null; };
  }, [visible, snapshot?.projectRoot, resolved]);
  useEffect(() => {
    const target = canvas.current;
    const context = target?.getContext('2d');
    if (!target || !context) return;
    context.clearRect(0, 0, target.width, target.height);
    if (!resolved) return;
    const scale = Math.min(target.width / resolved.width, target.height / resolved.height);
    const left = (target.width - resolved.width * scale) / 2, top = (target.height - resolved.height * scale) / 2;
    const graphic = resolved.flaGraphic;
    if (graphic?.structureFrame) {
      const rendered = renderFlaGraphicCanvas(graphic, images.images);
      if (rendered) context.drawImage(rendered.canvas, left + (rendered.rect.x + resolved.width / 2) * scale, top + (rendered.rect.y + resolved.height / 2) * scale, rendered.rect.width * scale, rendered.rect.height * scale);
    } else if (graphic && resolved.assetId) {
      const image = images.images.get(resolved.assetId);
      if (image) context.drawImage(image, left + graphic.frameOffset.x * scale, top + graphic.frameOffset.y * scale, graphic.frameViewport.width * scale, graphic.frameViewport.height * scale);
    }
  }, [resolved, images]);
  const missing = images.missing.size > 0;
  const thumbnailScale = resolved ? Math.min(1, 480 / resolved.width, 360 / resolved.height) : 1;
  const width = resolved ? Math.max(1, Math.round(resolved.width * thumbnailScale)) : 240;
  const height = resolved ? Math.max(1, Math.round(resolved.height * thumbnailScale)) : 180;
  return <canvas ref={canvas} width={width} height={height} role="img" aria-label={missing ? `${label}：素材不可用` : label} data-first-frame={source.firstFrame} />;
}

export function TalkingAnimationPicker({ animationId, playback, onApply, disabled }: {
  animationId?: string;
  playback?: TalkingAnimationPlayback;
  onApply: (animationId: string | null, playback?: TalkingAnimationPlayback) => void;
  disabled?: boolean;
}): React.JSX.Element {
  const snapshot = useSyncExternalStore(editorProjectStore.subscribe, editorProjectStore.getSnapshot, editorProjectStore.getSnapshot);
  const [draft, setDraft] = useState<string | null>(null);
  const [draftPlayback, setDraftPlayback] = useState<TalkingAnimationPlayback>();
  const [previewRest, setPreviewRest] = useState(false);
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const animations = snapshot?.project.animations.filter(animation =>
    isFlaGraphicDefinition(animation) ? hasFlaGraphicTemporalPlayback(animation) : animation.frames.length > 1,
  ) ?? [];
  const selected = animations.find(animation => animation.id === (draft ?? animationId));
  const selectedPlayback = draftPlayback ?? (selected?.id === animationId ? playback : undefined);
  const total = selected ? resolveFlaGraphicPreviewTimeline(selected, true).totalFrames : 1;
  const settings = selectedPlayback ?? { firstFrame: 0, lastFrame: total - 1, mode: 'loop' as const };
  const update = (value: Partial<TalkingAnimationPlayback>): void => {
    setDraftPlayback({ ...settings, ...value });
    setPreviewRest(false);
  };
  return (
    <div className="graphic-face-picker">
      <Button variant="secondary" aria-expanded={open} disabled={disabled} onClick={() => {
        setDraft(null);
        setDraftPlayback(undefined);
        setPreviewRest(false);
        setOpen(!open);
      }}>说话动画</Button>
      {open && snapshot ? (
        <div className="graphic-face-options">
          <label>
            选择说话动画
            <select value={selected?.id ?? ''} disabled={disabled} onChange={event => {
              setDraft(event.target.value);
              setDraftPlayback(undefined);
              setPreviewRest(false);
            }}>
              <option value="">未配置</option>
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
              titleId={titleId} playback={selectedPlayback} stillFrame={previewRest ? settings.restFrame : undefined} />
          </> : null}
          <Button disabled={disabled || ((selected?.id ?? undefined) === animationId &&
            JSON.stringify(selectedPlayback) === JSON.stringify(playback))} onClick={() => {
            onApply(selected?.id ?? null, selectedPlayback);
            setOpen(false);
          }}>应用说话动画</Button>
        </div>
      ) : null}
    </div>
  );
}

export function GraphicFacePicker({ source, onChange, onClear, disabled, testId, children }: {
  source?: CharacterFaceGraphicSource;
  onChange?: (source: CharacterFaceSource) => void;
  onClear?: () => void;
  disabled?: boolean;
  testId: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const snapshot = useSyncExternalStore(editorProjectStore.subscribe, editorProjectStore.getSnapshot, editorProjectStore.getSnapshot);
  const [open, setOpen] = useState(false);
  const [showImages, setShowImages] = useState(false);
  const [page, setPage] = useState(0);
  useEffect(() => {
    setOpen(false);
    setShowImages(false);
    setPage(0);
  }, [testId]);
  useEffect(() => { setShowImages(false); }, [source?.animationId, source?.firstFrame]);
  const definitions = snapshot?.project.animations.filter(isFlaGraphicDefinition) ?? [];
  const definition = definitions.find(candidate => candidate.id === source?.animationId);
  return <div className="graphic-face-picker" data-testid={`${testId}-visual-source`}>
    {source && definition ? <div className="graphic-face-selected">
      <GraphicFacePreview source={source} />
      <button type="button" className="graphic-face-selected-toggle" disabled={disabled} aria-expanded={open} data-testid={`${testId}-graphic-toggle`} title={`${definition.name} · 第 ${source.firstFrame + 1} 帧`} onClick={() => setOpen(!open)}>{definition.name} · {source.firstFrame + 1}</button>
      {onClear ? <button type="button" className="graphic-face-clear" disabled={disabled} onClick={onClear}>清除</button> : null}
    </div> : null}
    {source && !showImages ? <button type="button" className="graphic-face-switch" disabled={disabled} onClick={() => setShowImages(true)}>更换图片</button> : children}
    {onChange && definitions.length && !source ? <button type="button" className="graphic-face-toggle" disabled={disabled} aria-expanded={open} data-testid={`${testId}-graphic-toggle`} onClick={() => setOpen(!open)}>选择元件</button> : null}
    {open && onChange ? <div className="graphic-face-options">
      <div className="graphic-face-definitions">{definitions.map(candidate => <button type="button" className="graphic-face-definition" key={candidate.id} disabled={disabled} aria-pressed={candidate.id === source?.animationId} onClick={() => { setPage(0); setShowImages(false); onChange({ kind: 'fla-graphic', animationId: candidate.id, firstFrame: 0 }); }}>{candidate.name}</button>)}</div>
      {definition ? <>
        <div className="graphic-face-frames" aria-label="选择表情帧">{definition.frames.slice(page * 12, page * 12 + 12).map((frame, index) => {
          const firstFrame = page * 12 + index;
          const selected = { kind: 'fla-graphic' as const, animationId: definition.id, firstFrame };
          return <button type="button" className="graphic-face-frame" key={frame.ordinal} disabled={disabled} aria-label={`第 ${firstFrame + 1} 帧`} aria-pressed={source?.firstFrame === firstFrame} data-testid={`${testId}-frame-${firstFrame}`} onClick={() => { setShowImages(false); onChange(selected); }}><GraphicFacePreview source={selected} label={`第 ${firstFrame + 1} 帧`} /><span>{firstFrame + 1}</span></button>;
        })}</div>
        {definition.frames.length > 12 ? <div className="graphic-face-pagination"><button type="button" className="graphic-face-page-button" disabled={page === 0} onClick={() => setPage(page - 1)}>上一页</button><button type="button" className="graphic-face-page-button" disabled={(page + 1) * 12 >= definition.frames.length} onClick={() => setPage(page + 1)}>下一页</button></div> : null}
      </> : null}
    </div> : null}
  </div>;
}
