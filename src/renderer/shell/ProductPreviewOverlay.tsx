/**
 * Stage 1B product preview overlay.
 *
 * Contract (Issue #76):
 *   - Reuses the **formal** evaluator (`evaluateShotAtTime`) and the **formal**
 *     renderer (`CanvasStage` -> `StageRenderer` -> `buildStageRenderModel`).
 *     No preview-only evaluation or drawing code exists here.
 *   - Strictly read-only. The overlay never writes the project, the revision,
 *     the dirty flag, the selection or the history. It receives the already
 *     loaded project as a prop and only *reads* it.
 *   - The only state it owns is its own playback clock (`timeMs`, `playing`),
 *     the first-frame data/handoff readiness gates, and the asset URLs it needs
 *     to draw.
 *     Closing the overlay throws that state away; the editor is untouched.
 *   - No second project tree and no hidden DOM: the overlay is mounted only
 *     while open and unmounted on close.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  evaluateShotAtTime,
  mapProjectTime,
  projectDurationMs,
  type Project,
} from '../../domain';
import { evaluateSubtitleAtTime } from '../../shared/preview/subtitle-engine';
import { CanvasStage } from '../stage/CanvasStage';
import { SegmentedTabs } from '../ui/SegmentedTabs';
import {
  advanceProductPreviewTime,
  buildProductPreviewCues,
  clampProductPreviewTime,
  formatProductPreviewTimecode,
  listProductPreviewAssetIds,
  projectProductPreviewMouth,
  resolveProductPreviewShot,
  resolveProductPreviewSubtitleStyle,
  resolveProductPreviewTransportAction,
  type ProductPreviewRange,
  type ProductPreviewTransportAction,
} from './productPreviewModel';
import { useProductPreviewAudio } from './productPreviewAudio';
import { useProductPreviewImages } from './productPreviewImages';
import {
  advanceProductPreviewHandoffPhase,
  canStartProductPreviewPlayback,
  productPreviewRevealPhaseFromHandoff,
  scheduleProductPreviewPaintFence,
  scheduleProductPreviewWarmupStatus,
  shouldBlockProductPreviewWarmupKeyboard,
  shouldStartProductPreviewAutoplay,
  type ProductPreviewHandoffPhase,
} from './productPreviewReveal';

export interface ProductPreviewOverlayProps {
  /** Project folder of the current project, used by bounded asset reads. */
  projectRoot: string;
  /** The already loaded formal project. Treated as immutable input. */
  project: Project;
  /** Shot selected in the editor, or `null` when nothing is selected. */
  shotId: string | null;
  /** Starts the existing preview transport immediately when the overlay mounts. */
  autoPlay?: boolean;
  /** Whether EditorShell has committed the Preview surface handoff. */
  surfaceActive: boolean;
  /** Requests that EditorShell commit visual ownership after warmup. */
  onHandoffReady(): void;
  /** Closes the overlay and discards all preview-local playback state. */
  onClose(): void;
}

type ProductPreviewInitialReadiness = 'preparing' | 'ready' | 'error';

export function ProductPreviewOverlay({
  projectRoot,
  project,
  shotId,
  autoPlay = false,
  surfaceActive,
  onHandoffReady,
  onClose,
}: ProductPreviewOverlayProps): React.JSX.Element {
  const currentShot = useMemo(
    () => resolveProductPreviewShot(project, shotId),
    [project, shotId],
  );
  const [range, setRange] = useState<ProductPreviewRange>('project');
  // Playback position and transport flag: the ONLY temporal state in the app
  // that belongs to the preview. Both die with the overlay.
  const [timeMs, setTimeMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [initialReadiness, setInitialReadiness] =
    useState<ProductPreviewInitialReadiness>('preparing');
  const [handoffPhase, setHandoffPhase] =
    useState<ProductPreviewHandoffPhase>('warming');
  const [showWarmupStatus, setShowWarmupStatus] = useState(false);
  const [seekRevision, setSeekRevision] = useState(0);
  const initialStageReadyRef = useRef(false);
  const initialReadinessRef = useRef<ProductPreviewInitialReadiness>(
    'preparing',
  );
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const handoffPhaseRef = useRef<ProductPreviewHandoffPhase>('warming');
  handoffPhaseRef.current = handoffPhase;
  const handoffReadyNotifiedRef = useRef(false);
  const revealPhase = productPreviewRevealPhaseFromHandoff(handoffPhase);
  const previewSurfaceActive = surfaceActive && handoffPhase === 'active';
  const projectPosition = useMemo(
    () => mapProjectTime(project, range === 'project' ? timeMs : 0),
    [project, range, timeMs],
  );
  const shot = range === 'project' ? projectPosition.shot : currentShot;
  const durationMs =
    range === 'project'
      ? projectPosition.totalDurationMs
      : currentShot?.durationMs ?? 0;
  const displayedTimeMs = clampProductPreviewTime(timeMs, durationMs);
  const activeShotTimeMs =
    range === 'project' ? projectPosition.shotLocalTimeMs : displayedTimeMs;
  const activeShotIndex =
    range === 'project'
      ? projectPosition.shotIndex
      : shot
        ? project.shots.findIndex((candidate) => candidate.id === shot.id)
        : null;
  const assetIds = useMemo(
    () => (shot ? listProductPreviewAssetIds(project, shot) : []),
    [project, shot],
  );
  const nextShot =
    range === 'project' && activeShotIndex !== null
      ? project.shots[activeShotIndex + 1] ?? null
      : null;
  const nextAssetIds = useMemo(
    () => (nextShot ? listProductPreviewAssetIds(project, nextShot) : []),
    [nextShot, project],
  );
  const assets = useProductPreviewImages(
    projectRoot,
    project,
    assetIds,
    nextAssetIds,
  );
  const cues = useMemo(
    () => (shot ? buildProductPreviewCues(shot) : []),
    [shot],
  );

  const applyTransportAction = useCallback(
    (action: ProductPreviewTransportAction): void => {
      if (
        !previewSurfaceActive ||
        !canStartProductPreviewPlayback(
          initialReadiness === 'ready',
          handoffPhase,
        )
      ) {
        return;
      }
      const next = resolveProductPreviewTransportAction(
        displayedTimeMs,
        durationMs,
        action,
      );
      setPlaying(next.playing);
      setTimeMs(next.timeMs);
      if (next.repositionAudio) {
        setSeekRevision((current) => current + 1);
      }
    },
    [
      displayedTimeMs,
      durationMs,
      handoffPhase,
      initialReadiness,
      previewSurfaceActive,
    ],
  );

  const switchPreviewRange = useCallback(
    (nextRange: ProductPreviewRange): void => {
      if (nextRange === range) return;
      // Range changes pause and reset the new range. The existing media
      // transports observe the reset and invalidate their old async work.
      setPlaying(false);
      setRange(nextRange);
      setTimeMs(0);
      setSeekRevision((current) => current + 1);
    },
    [range],
  );

  useEffect(() => {
    if (range !== 'shot') return;
    // Current Shot is a Preview-local range. A change in editor selection
    // starts that range over without mutating the selection itself.
    setPlaying(false);
    setTimeMs(0);
    setSeekRevision((current) => current + 1);
  }, [currentShot?.id, range]);

  useEffect(() => {
    if (durationMs <= 0) setPlaying(false);
  }, [durationMs]);

  useEffect(() => {
    if (!playing || durationMs <= 0) {
      return;
    }
    let frame = 0;
    let previous = window.performance.now();
    const tick = (now: number): void => {
      const delta = now - previous;
      previous = now;
      setTimeMs((current) => {
        const step = advanceProductPreviewTime(current, delta, durationMs);
        if (step.ended) {
          setPlaying(false);
        }
        return step.timeMs;
      });
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [durationMs, playing]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (handoffPhase !== 'active') {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
          return;
        }
        const targetInsidePreview =
          typeof Node !== 'undefined' &&
          event.target instanceof Node &&
          Boolean(overlayRef.current?.contains(event.target));
        if (
          shouldBlockProductPreviewWarmupKeyboard(
            event.key,
            targetInsidePreview,
          )
        ) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [handoffPhase, onClose]);

  const evaluatedShot = useMemo(
    () =>
      shot
        ? evaluateShotAtTime(
            shot,
            activeShotTimeMs,
            project,
          )
        : null,
    [activeShotTimeMs, project, shot],
  );
  const activeCue = evaluatedShot
    ? evaluateSubtitleAtTime(cues, evaluatedShot.timeMs)
    : null;
  const renderedShot = useMemo(
    () =>
      shot && evaluatedShot
        ? projectProductPreviewMouth(
            project,
            shot,
            evaluatedShot,
            activeCue?.id ?? null,
          )
        : evaluatedShot,
    [activeCue?.id, evaluatedShot, project, shot],
  );
  const caption = activeCue?.text ?? null;
  const captionStyle = resolveProductPreviewSubtitleStyle(project, activeCue);
  const handleInitialStageReady = useCallback((): void => {
    if (
      initialStageReadyRef.current ||
      initialReadinessRef.current === 'error'
    ) {
      return;
    }
    initialStageReadyRef.current = true;
    initialReadinessRef.current = 'ready';
    setInitialReadiness('ready');
  }, []);
  const handleInitialStageError = useCallback((): void => {
    if (
      handoffPhaseRef.current === 'active' ||
      initialReadinessRef.current === 'error'
    ) {
      return;
    }
    initialReadinessRef.current = 'error';
    setInitialReadiness('error');
    setHandoffPhase('warming');
    setPlaying(false);
  }, []);
  useEffect(() => {
    if (assets.status === 'error') {
      if (handoffPhase !== 'active') handleInitialStageError();
      return;
    }
    if (initialReadiness !== 'preparing') return;
    if (shot === null) {
      if (assets.status === 'ready') handleInitialStageReady();
      return;
    }
    // A shot with no image layers has no browser image boundary to await; its
    // formal blank frame is already stable once the bounded asset read is
    // complete.
    if (assets.status === 'ready' && assetIds.length === 0 && renderedShot) {
      handleInitialStageReady();
    }
  }, [
    assetIds.length,
    assets.status,
    handleInitialStageError,
    handleInitialStageReady,
    handoffPhase,
    initialReadiness,
    renderedShot,
    shot,
  ]);
  useEffect(() => {
    if (initialReadiness !== 'ready' || handoffPhase !== 'warming') return;
    return scheduleProductPreviewPaintFence(() => {
      if (handoffReadyNotifiedRef.current) return;
      handoffReadyNotifiedRef.current = true;
      setHandoffPhase((current) =>
        advanceProductPreviewHandoffPhase(current, 'paint-fence-passed'),
      );
      onHandoffReady();
    });
  }, [handoffPhase, initialReadiness, onHandoffReady]);
  useEffect(() => {
    if (handoffPhase !== 'ready' || !surfaceActive) return;
    setHandoffPhase((current) =>
      advanceProductPreviewHandoffPhase(current, 'surface-activated'),
    );
  }, [handoffPhase, surfaceActive]);
  useEffect(() => {
    if (handoffPhase !== 'warming') return;
    return scheduleProductPreviewWarmupStatus(() => {
      setShowWarmupStatus(true);
    });
  }, [handoffPhase]);
  useEffect(() => {
    if (
      previewSurfaceActive &&
      shouldStartProductPreviewAutoplay({
        autoPlay,
        dataReady: initialReadiness === 'ready',
        durationMs: projectDurationMs(project),
        revealPhase: handoffPhase,
      })
    ) {
      setPlaying(true);
    }
  }, [autoPlay, handoffPhase, initialReadiness, previewSurfaceActive, project]);
  const lastReadyVisual = useRef<{
    assetUrls: typeof assets.urls;
    caption: typeof caption;
    captionStyle: typeof captionStyle;
    evaluatedShot: NonNullable<typeof renderedShot>;
  } | null>(null);
  useLayoutEffect(() => {
    if (assets.status !== 'ready' || !renderedShot) return;
    lastReadyVisual.current = {
      assetUrls: assets.urls,
      caption,
      captionStyle,
      evaluatedShot: renderedShot,
    };
  }, [assets.status, assets.urls, caption, captionStyle, renderedShot]);
  const heldVisual =
    assets.status === 'loading' ? lastReadyVisual.current : null;
  const initialReadinessError =
    initialReadiness === 'error' || assets.status === 'error';
  const previewVisualState = initialReadinessError
    ? 'error'
    : initialReadiness === 'preparing'
      ? 'preparing'
      : heldVisual
        ? 'holding'
        : assets.status;
  const atEnd = durationMs > 0 && displayedTimeMs >= durationMs;
  const audioWarning = useProductPreviewAudio({
    projectRoot,
    project,
    shot,
    activeDialogueId: activeCue?.id ?? null,
    timeMs: activeShotTimeMs,
    playing,
    seekRevision,
  });

  return (
    <div
      aria-label="产品预览"
      aria-modal={previewSurfaceActive}
      className="product-preview-overlay"
      data-preview-playing={String(playing)}
      data-preview-range={range}
      data-preview-data-ready={String(initialReadiness === 'ready')}
      data-preview-readiness={initialReadiness}
      data-preview-handoff={handoffPhase}
      data-preview-reveal={revealPhase}
      data-preview-shot-id={shot?.id ?? ''}
      data-preview-time={evaluatedShot?.timeMs ?? 0}
      data-preview-project-time={displayedTimeMs}
      data-preview-surface={previewSurfaceActive ? 'active' : 'warming'}
      data-testid="product-preview-overlay"
      ref={overlayRef}
      role="dialog"
    >
      {!previewSurfaceActive && (showWarmupStatus || initialReadinessError) ? (
        <div
          aria-live="polite"
          className="product-preview-warmup-status"
          data-testid="product-preview-warmup-status"
          role="status"
        >
          <span>
            {initialReadinessError
              ? '预览首帧无法显示，编辑器保持不变。'
              : '正在准备预览…'}
          </span>
          <button
            className="product-preview-warmup-cancel"
            data-testid="product-preview-cancel"
            onClick={onClose}
            type="button"
          >
            取消
          </button>
        </div>
      ) : null}
      <div className="product-preview-frame">
        <button
          aria-label="关闭预览"
          className="product-preview-close task4-hit-target"
          data-task4-core="preview-close"
          data-testid="product-preview-close"
          onClick={onClose}
          title="关闭预览"
          type="button"
        >
          ×
        </button>

        {shot === null ? (
          <div
            className="product-preview-empty"
            data-testid="product-preview-empty"
          >
            <strong>当前项目还没有可预览的镜头</strong>
            <span>请先在镜头管理中创建一个镜头，然后再打开产品预览。</span>
          </div>
        ) : (
          <>
            <div className="product-preview-player">
              <div
                className="product-preview-transport-meta"
                data-testid="product-preview-range"
              >
                <SegmentedTabs
                  aria-label="预览范围"
                  className="product-preview-range-control"
                  onChange={(value) =>
                    switchPreviewRange(value as ProductPreviewRange)
                  }
                  options={[
                    { value: 'project', label: '整个项目' },
                    { value: 'shot', label: '当前镜头' },
                  ]}
                  value={range}
                />
              </div>
              <div
                className="product-preview-stage"
                data-preview-image-source="bounded-original"
                data-preview-stage-fit="contain"
                data-preview-visual-state={previewVisualState}
              >
                {initialReadinessError ? (
                  assets.status === 'error' ? (
                    <div
                      className="product-preview-message product-preview-warning"
                      data-testid="product-preview-asset-warning"
                    >
                      <strong>部分素材无法预览</strong>
                      <span>
                        有 {assets.missingCount} 个图片素材无法读取，请在项目素材库中重新导入或刷新后再试。
                      </span>
                    </div>
                  ) : (
                    <div
                      className="product-preview-message product-preview-warning"
                      data-testid="product-preview-stage-warning"
                    >
                      <strong>预览首帧无法显示</strong>
                      <span>请检查项目图片素材后重试。</span>
                    </div>
                  )
                ) : assets.status === 'ready' && renderedShot ? (
                  <CanvasStage
                    assetUrls={assets.urls}
                    caption={caption}
                    captionStyle={captionStyle}
                    evaluatedShot={renderedShot}
                    onError={handleInitialStageError}
                    onReady={
                      initialReadiness === 'preparing'
                        ? handleInitialStageReady
                        : undefined
                    }
                    project={project}
                  />
                ) : heldVisual ? (
                  <CanvasStage
                    assetUrls={heldVisual.assetUrls}
                    caption={heldVisual.caption}
                    captionStyle={heldVisual.captionStyle}
                    evaluatedShot={heldVisual.evaluatedShot}
                    project={project}
                  />
                ) : assets.status === 'loading' ? (
                  <div
                    className="product-preview-message"
                    data-testid="product-preview-loading"
                  >
                    <strong>预览素材加载中</strong>
                    <span>正在读取当前镜头需要的图片素材。</span>
                  </div>
                ) : renderedShot ? (
                  <CanvasStage
                    assetUrls={assets.urls}
                    caption={caption}
                    captionStyle={captionStyle}
                    evaluatedShot={renderedShot}
                    project={project}
                  />
                ) : null}
              </div>

              <div className="product-preview-transport">
                <div
                  aria-label="产品预览播放控制"
                  className="product-preview-controls"
                >
                  <button
                    aria-label={playing ? '暂停' : '播放'}
                    aria-pressed={playing}
                    className="product-preview-icon-button task4-hit-target"
                    data-task4-core={
                      playing ? 'preview-pause' : 'preview-play'
                    }
                    data-testid="product-preview-play-pause"
                    disabled={
                      durationMs <= 0 ||
                      !previewSurfaceActive ||
                      !canStartProductPreviewPlayback(
                        initialReadiness === 'ready',
                        handoffPhase,
                      ) ||
                      (!playing && atEnd)
                    }
                    onClick={() =>
                      applyTransportAction({
                        type: playing ? 'pause' : 'play',
                      })
                    }
                    title={playing ? '暂停' : '播放'}
                    type="button"
                  >
                    {playing ? (
                      <span
                        aria-hidden="true"
                        className="product-preview-icon"
                        data-testid="product-preview-pause"
                      >
                        ⏸
                      </span>
                    ) : (
                      <span
                        aria-hidden="true"
                        className="product-preview-icon"
                        data-testid="product-preview-play"
                      >
                        ▶
                      </span>
                    )}
                  </button>
                  <button
                    aria-label="停止"
                    className="product-preview-icon-button task4-hit-target"
                    data-task4-core="preview-stop"
                    data-testid="product-preview-stop"
                    disabled={
                      durationMs <= 0 ||
                      !previewSurfaceActive ||
                      !canStartProductPreviewPlayback(
                        initialReadiness === 'ready',
                        handoffPhase,
                      )
                    }
                    onClick={() => applyTransportAction({ type: 'stop' })}
                    title="停止"
                    type="button"
                  >
                    <span aria-hidden="true" className="product-preview-icon">
                      ■
                    </span>
                  </button>
                  <button
                    aria-label="重播"
                    className="product-preview-icon-button task4-hit-target"
                    data-task4-core="preview-replay"
                    data-testid="product-preview-replay"
                    disabled={
                      durationMs <= 0 ||
                      !previewSurfaceActive ||
                      !canStartProductPreviewPlayback(
                        initialReadiness === 'ready',
                        handoffPhase,
                      )
                    }
                    onClick={() => applyTransportAction({ type: 'replay' })}
                    title="重播"
                    type="button"
                  >
                    <span aria-hidden="true" className="product-preview-icon">
                      ↺
                    </span>
                  </button>
                </div>
                <input
                  aria-label="产品预览进度"
                  className="product-preview-scrubber"
                  data-testid="product-preview-scrubber"
                  max={durationMs}
                  min={0}
                  onChange={(event) => {
                    applyTransportAction({
                      type: 'seek',
                      timeMs: Number(event.target.value),
                    });
                  }}
                  step={10}
                  type="range"
                  value={displayedTimeMs}
                />
                <span
                  className="product-preview-timecode"
                  data-testid="product-preview-timecode"
                >
                  {activeShotIndex !== null && activeShotIndex >= 0
                    ? `镜头 ${activeShotIndex + 1} / ${project.shots.length} · `
                    : ''}
                  {formatProductPreviewTimecode(displayedTimeMs)} /{' '}
                  {formatProductPreviewTimecode(durationMs)}
                </span>
              </div>
            </div>

            {audioWarning ? (
              <p
                className="product-preview-hint product-preview-warning"
                data-testid="product-preview-audio-warning"
                title={audioWarning}
                role="status"
              >
                {audioWarning}
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
