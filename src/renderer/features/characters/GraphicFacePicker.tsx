import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { isFlaGraphicDefinition, type CharacterFaceGraphicSource, type CharacterFaceSource } from '../../../domain';
import { resolveCharacterFaceSource } from '../../../domain/selectors/characterFaceSource';
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
      <button type="button" disabled={disabled} aria-expanded={open} data-testid={`${testId}-graphic-toggle`} onClick={() => setOpen(!open)}>{definition.name} · {source.firstFrame + 1}</button>
      {onClear ? <button type="button" disabled={disabled} onClick={onClear}>清除</button> : null}
    </div> : null}
    {source && !showImages ? <button type="button" disabled={disabled} onClick={() => setShowImages(true)}>更换图片</button> : children}
    {onChange && definitions.length && !source ? <button type="button" disabled={disabled} aria-expanded={open} data-testid={`${testId}-graphic-toggle`} onClick={() => setOpen(!open)}>选择元件</button> : null}
    {open && onChange ? <div className="graphic-face-options">
      <div className="graphic-face-definitions">{definitions.map(candidate => <button type="button" key={candidate.id} disabled={disabled} aria-pressed={candidate.id === source?.animationId} onClick={() => { setPage(0); setShowImages(false); onChange({ kind: 'fla-graphic', animationId: candidate.id, firstFrame: 0 }); }}>{candidate.name}</button>)}</div>
      {definition ? <>
        <div className="graphic-face-frames" aria-label="选择表情帧">{definition.frames.slice(page * 12, page * 12 + 12).map((frame, index) => {
          const firstFrame = page * 12 + index;
          const selected = { kind: 'fla-graphic' as const, animationId: definition.id, firstFrame };
          return <button type="button" key={frame.ordinal} disabled={disabled} aria-label={`第 ${firstFrame + 1} 帧`} aria-pressed={source?.firstFrame === firstFrame} data-testid={`${testId}-frame-${firstFrame}`} onClick={() => { setShowImages(false); onChange(selected); }}><GraphicFacePreview source={selected} label={`第 ${firstFrame + 1} 帧`} /><span>{firstFrame + 1}</span></button>;
        })}</div>
        {definition.frames.length > 12 ? <div><button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>上一页</button><button type="button" disabled={(page + 1) * 12 >= definition.frames.length} onClick={() => setPage(page + 1)}>下一页</button></div> : null}
      </> : null}
    </div> : null}
  </div>;
}
