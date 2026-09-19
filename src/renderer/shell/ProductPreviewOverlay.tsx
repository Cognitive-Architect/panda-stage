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
 *   - The only state it owns is its own playback clock (`timeMs`, `playing`)
 *     plus the asset URLs it needs to draw. Closing the overlay throws that
 *     state away; the editor is untouched.
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

export interface ProductPreviewOverlayProps {
  /** Project folder of the current project, used by bounded asset reads. */
  projectRoot: string;
  /** The already loaded formal project. Treated as immutable input. */
  project: Project;
  /** Shot selected in the editor, or `null` when nothing is selected. */
  shotId: string | null;
  /** Starts the existing preview transport immediately when the overlay mounts. */
  autoPlay?: boolean;
  /** Closes the overlay and discards all preview-local playback state. */
  onClose(): void;
}

export function ProductPreviewOverlay({
  projectRoot,
  project,
  shotId,
  autoPlay = false,
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
  const [playing, setPlaying] = useState(() =>
    autoPlay && projectDurationMs(project) > 0,
  );
  const [seekRevision, setSeekRevision] = useState(0);
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
    [displayedTimeMs, durationMs],
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
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

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
      aria-modal="true"
      className="product-preview-overlay"
      data-preview-playing={String(playing)}
      data-preview-range={range}
      data-preview-shot-id={shot?.id ?? ''}
      data-preview-time={evaluatedShot?.timeMs ?? 0}
      data-preview-project-time={displayedTimeMs}
      data-testid="product-preview-overlay"
      role="dialog"
    >
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
                data-preview-visual-state={heldVisual ? 'holding' : assets.status}
              >
                {heldVisual ? (
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
                ) : assets.status === 'error' ? (
                  <div
                    className="product-preview-message product-preview-warning"
                    data-testid="product-preview-asset-warning"
                  >
                    <strong>部分素材无法预览</strong>
                    <span>
                      有 {assets.missingCount} 个图片素材无法读取，请在项目素材库中重新导入或刷新后再试。
                    </span>
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
                    disabled={durationMs <= 0 || (!playing && atEnd)}
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
                    disabled={durationMs <= 0}
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
                    disabled={durationMs <= 0}
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
