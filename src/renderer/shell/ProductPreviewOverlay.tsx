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
 *   - It owns its playback clock (`timeMs`, `playing`), first-frame
 *     data/handoff readiness gates, and bounded asset URLs. The optional
 *     Camera mode is owned by EditorShell across Preview mounts.
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
  evaluateSpeakerFocusCamera,
  mapProjectTime,
  prepareSpeakerFocusCamera,
  projectDurationMs,
  type CameraView,
  type Project,
} from '../../domain';
import { evaluateSubtitleAtTime } from '../../shared/preview/subtitle-engine';
import { CanvasStage } from '../stage/CanvasStage';
import {
  previewDiagnosticNow,
  recordPreviewDiagnostic,
  recordPreviewDuration,
} from '../stage/previewDiagnostics';
import type { StageImageResourceFailure } from '../stage/stageImageResourceSession';
import { SegmentedTabs } from '../ui/SegmentedTabs';
import {
  applyProductPreviewMouthFallback,
  buildProductPreviewImagePlan,
  buildProductPreviewCues,
  clampProductPreviewTime,
  formatProductPreviewTimecode,
  isProductPreviewMouthFallbackFailure,
  listProductPreviewAssetIds,
  projectProductPreviewDialogue,
  resolveProductPreviewShot,
  resolveProductPreviewSubtitleStyle,
  resolveProductPreviewClockTime,
  resolveProductPreviewTransportAction,
  resolveProductPreviewVisibilityPause,
  type ProductPreviewClockAnchor,
  type ProductPreviewRange,
  type ProductPreviewTransportAction,
  type ProductPreviewTransportState,
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
  /** Session-only Camera mode shared with the persistent editor rail. */
  autoCameraEnabled: boolean;
  onAutoCameraChange(enabled: boolean): void;
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
  autoCameraEnabled,
  onAutoCameraChange,
  surfaceActive,
  onHandoffReady,
  onClose,
}: ProductPreviewOverlayProps): React.JSX.Element {
  const renderStartedAt = previewDiagnosticNow();
  const currentShot = useMemo(
    () => resolveProductPreviewShot(project, shotId),
    [project, shotId],
  );
  const [range, setRange] = useState<ProductPreviewRange>('project');
  // Playback position and transport flag: the ONLY temporal state in the app
  // that belongs to the preview. Both die with the overlay.
  const [timeMs, setTimeMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timeMsRef = useRef(timeMs);
  const initialAutoplayConsumedRef = useRef(false);
  const playbackClockAnchorRef =
    useRef<ProductPreviewClockAnchor | null>(null);
  const playbackClockGenerationRef = useRef(0);
  const projectIdRef = useRef(project.id);
  const [initialReadiness, setInitialReadiness] =
    useState<ProductPreviewInitialReadiness>('preparing');
  const [handoffPhase, setHandoffPhase] =
    useState<ProductPreviewHandoffPhase>('warming');
  const [showWarmupStatus, setShowWarmupStatus] = useState(false);
  const [seekRevision, setSeekRevision] = useState(0);
  const [stageImageFailures, setStageImageFailures] = useState<
    StageImageResourceFailure[]
  >([]);
  const initialStageReadyRef = useRef(false);
  const initialReadinessRef = useRef<ProductPreviewInitialReadiness>(
    'preparing',
  );
  const overlayRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    overlayRef.current?.focus();
  }, []);
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
  const durationMsRef = useRef(durationMs);
  useLayoutEffect(() => {
    durationMsRef.current = durationMs;
  }, [durationMs]);
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
  const cues = useMemo(
    () => (shot ? buildProductPreviewCues(shot) : []),
    [shot],
  );

  useLayoutEffect(() => {
    timeMsRef.current = timeMs;
  }, [timeMs]);

  const commitTransportState = useCallback(
    (
      next: ProductPreviewTransportState,
      anchoredAtMs: number,
    ): void => {
      playbackClockGenerationRef.current += 1;
      playbackClockAnchorRef.current = next.playing
        ? { startedAtMs: anchoredAtMs, startTimeMs: next.timeMs }
        : null;
      timeMsRef.current = next.timeMs;
      setTimeMs(next.timeMs);
      setPlaying(next.playing);
    },
    [],
  );

  const pauseAtCurrentClock = useCallback((): number => {
    const now = window.performance.now();
    const anchor = playbackClockAnchorRef.current;
    const positionMs = anchor
      ? resolveProductPreviewClockTime(
          anchor,
          now,
          durationMsRef.current,
        ).timeMs
      : timeMsRef.current;
    commitTransportState(
      { timeMs: positionMs, playing: false, repositionAudio: false },
      now,
    );
    return positionMs;
  }, [commitTransportState]);

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
      const now = window.performance.now();
      const anchor = playbackClockAnchorRef.current;
      const currentTimeMs = anchor
        ? resolveProductPreviewClockTime(anchor, now, durationMs).timeMs
        : displayedTimeMs;
      const next = resolveProductPreviewTransportAction(
        currentTimeMs,
        durationMs,
        action,
      );
      if (next.playing && document.visibilityState !== 'visible') return;
      if (next.playing) initialAutoplayConsumedRef.current = true;
      commitTransportState(next, now);
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
      commitTransportState,
    ],
  );

  const switchPreviewRange = useCallback(
    (nextRange: ProductPreviewRange): void => {
      if (nextRange === range) return;
      // Range changes pause and reset the new range. The existing media
      // transports observe the reset and invalidate their old async work.
      commitTransportState(
        { timeMs: 0, playing: false, repositionAudio: true },
        window.performance.now(),
      );
      setRange(nextRange);
      setSeekRevision((current) => current + 1);
    },
    [commitTransportState, range],
  );

  useLayoutEffect(() => {
    if (projectIdRef.current === project.id) return;
    projectIdRef.current = project.id;
    commitTransportState(
      { timeMs: 0, playing: false, repositionAudio: true },
      window.performance.now(),
    );
    setSeekRevision((current) => current + 1);
  }, [commitTransportState, project.id]);

  useLayoutEffect(() => {
    if (range !== 'shot') return;
    // Current Shot is a Preview-local range. A change in editor selection
    // starts that range over without mutating the selection itself.
    commitTransportState(
      { timeMs: 0, playing: false, repositionAudio: true },
      window.performance.now(),
    );
    setSeekRevision((current) => current + 1);
  }, [commitTransportState, currentShot?.id, range]);

  useLayoutEffect(() => {
    if (durationMs > 0) return;
    commitTransportState(
      { timeMs: 0, playing: false, repositionAudio: true },
      window.performance.now(),
    );
  }, [commitTransportState, durationMs]);

  useEffect(() => {
    if (!playing || durationMs <= 0) {
      return;
    }
    const anchor = playbackClockAnchorRef.current;
    if (!anchor) return;
    const generation = playbackClockGenerationRef.current;
    let frame = 0;
    let previousFrameAt = anchor.startedAtMs;
    const tick = (now: number): void => {
      if (generation !== playbackClockGenerationRef.current) return;
      const activeAnchor = playbackClockAnchorRef.current;
      if (!activeAnchor) return;
      const delta = Math.max(0, now - previousFrameAt);
      previousFrameAt = now;
      recordPreviewDiagnostic('tick-callback', { deltaMs: delta });
      const elapsed = resolveProductPreviewClockTime(
        activeAnchor,
        now,
        durationMs,
      );
      recordPreviewDiagnostic('raf', {
        deltaMs: delta,
        elapsedMs: Math.max(0, now - activeAnchor.startedAtMs),
        requestedTimeMs: activeAnchor.startTimeMs + Math.max(0, now - activeAnchor.startedAtMs),
        nextTimeMs: elapsed.timeMs,
        visibility: document.visibilityState,
        focused: document.hasFocus(),
      });
      timeMsRef.current = elapsed.timeMs;
      setTimeMs(elapsed.timeMs);
      if (elapsed.ended) {
        commitTransportState(
          {
            timeMs: elapsed.timeMs,
            playing: false,
            repositionAudio: false,
          },
          now,
        );
        return;
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [commitTransportState, durationMs, playing]);

  useEffect(() => {
    const onVisibilityChange = (): void => {
      const now = window.performance.now();
      const pause = resolveProductPreviewVisibilityPause(
        document.visibilityState,
        playbackClockAnchorRef.current,
        now,
        durationMsRef.current,
      );
      if (pause) commitTransportState(pause, now);
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    if (document.visibilityState === 'hidden') onVisibilityChange();
    return () =>
      document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [commitTransportState]);

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
    () => {
      if (!shot) return null;
      const startedAt = previewDiagnosticNow();
      const evaluated = evaluateShotAtTime(shot, activeShotTimeMs, project);
      recordPreviewDuration('evaluate-shot', startedAt, {
        timeMs: activeShotTimeMs,
        layerCount: evaluated.layers.length,
      });
      return evaluated;
    },
    [activeShotTimeMs, project, shot],
  );
  const activeCue = evaluatedShot
    ? evaluateSubtitleAtTime(cues, evaluatedShot.timeMs)
    : null;
  const cameraPlan = useMemo(
    () => (autoCameraEnabled && shot ? prepareSpeakerFocusCamera(project, shot) : null),
    [project, shot, autoCameraEnabled],
  );
  const camera = cameraPlan
    ? evaluateSpeakerFocusCamera(cameraPlan, activeShotTimeMs)
    : undefined;
  const renderedShot = useMemo(
    () => {
      if (!shot || !evaluatedShot) return evaluatedShot;
      const startedAt = previewDiagnosticNow();
      const projected = projectProductPreviewDialogue(
        project,
        shot,
        evaluatedShot,
        activeCue?.id ?? null,
      );
      recordPreviewDuration('mouth-projection', startedAt, {
        timeMs: evaluatedShot.timeMs,
      });
      return projected;
    },
    [activeCue?.id, evaluatedShot, project, shot],
  );
  const caption = activeCue?.text ?? null;
  const captionStyle = resolveProductPreviewSubtitleStyle(project, activeCue);
  const imagePlan = useMemo(
    () => {
      if (!shot || !renderedShot) {
        return {
          requiredAssetIds: [],
          fallbackAssetIds: [],
          candidateAssetIds: assetIds,
          mouthFallbacks: [],
        };
      }
      const startedAt = previewDiagnosticNow();
      const plan = buildProductPreviewImagePlan(project, shot, renderedShot);
      recordPreviewDuration('image-plan', startedAt, {
        timeMs: renderedShot.timeMs,
      });
      return plan;
    },
    [assetIds, project, renderedShot, shot],
  );
  const decodeFallbackAssetIds = imagePlan.mouthFallbacks
    .filter((rule) =>
      stageImageFailures.some(
        (failure) =>
          failure.partId === rule.partId &&
          failure.assetId === rule.sourceAssetId,
      ),
    )
    .map((rule) => rule.fallbackAssetId);
  const imageScope = {
    ...imagePlan,
    requiredAssetIds: [
      ...new Set([...imagePlan.requiredAssetIds, ...decodeFallbackAssetIds]),
    ],
  };
  const assets = useProductPreviewImages(
    projectRoot,
    project,
    imageScope,
    nextAssetIds,
  );
  const currentStageImageFailures = stageImageFailures.filter(
    (failure) =>
      imagePlan.requiredAssetIds.includes(failure.assetId) &&
      assets.urls[failure.assetId] === failure.sourceUrl,
  );
  const stageMouthFailureAssetIds = currentStageImageFailures
    .filter((failure) =>
      isProductPreviewMouthFallbackFailure(imagePlan, failure),
    )
    .map((failure) => failure.assetId);
  const degradedAssetIds = [
    ...new Set([
      ...(assets.degradedAssetIds ?? []),
      ...stageMouthFailureAssetIds,
    ]),
  ];
  const fatalAssetIds = [
    ...new Set([
      ...(assets.fatalAssetIds ?? []),
      ...currentStageImageFailures
        .filter(
          (failure) =>
            !isProductPreviewMouthFallbackFailure(imagePlan, failure),
        )
        .map((failure) => failure.assetId),
    ]),
  ];
  const displayedShot = useMemo(
    () =>
      shot && renderedShot && degradedAssetIds.length > 0
        ? applyProductPreviewMouthFallback(
            project,
            shot,
            renderedShot,
            new Set(degradedAssetIds),
          )
        : renderedShot,
    [degradedAssetIds.join('|'), project, renderedShot, shot],
  );
  const previewDegraded =
    degradedAssetIds.length > 0 &&
    (assets.status === 'ready' || assets.status === 'degraded');
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
    pauseAtCurrentClock();
  }, [pauseAtCurrentClock]);
  const handleImageResourceFailure = useCallback(
    (failure: StageImageResourceFailure): void => {
      if (assets.urls[failure.assetId] !== failure.sourceUrl) return;
      setStageImageFailures((current) =>
        current.some(
          (item) =>
            item.partId === failure.partId &&
            item.assetId === failure.assetId &&
            item.sourceUrl === failure.sourceUrl,
        )
          ? current
          : [...current, failure],
      );
      if (isProductPreviewMouthFallbackFailure(imagePlan, failure)) return;

      initialReadinessRef.current = 'error';
      setInitialReadiness('error');
      pauseAtCurrentClock();
      if (handoffPhaseRef.current !== 'active') {
        setHandoffPhase('warming');
      }
    },
    [assets.urls, imagePlan, pauseAtCurrentClock],
  );
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
      !initialAutoplayConsumedRef.current &&
      !playbackClockAnchorRef.current &&
      document.visibilityState === 'visible' &&
      previewSurfaceActive &&
      shouldStartProductPreviewAutoplay({
        autoPlay,
        autoplayConsumed: initialAutoplayConsumedRef.current,
        dataReady: initialReadiness === 'ready',
        durationMs: projectDurationMs(project),
        revealPhase: handoffPhase,
      })
    ) {
      const now = window.performance.now();
      const next = resolveProductPreviewTransportAction(
        timeMsRef.current,
        durationMs,
        { type: 'play' },
      );
      if (next.playing) initialAutoplayConsumedRef.current = true;
      commitTransportState(next, now);
    }
  }, [
    autoPlay,
    commitTransportState,
    durationMs,
    handoffPhase,
    initialReadiness,
    previewSurfaceActive,
    project,
  ]);
  const lastReadyVisual = useRef<{
    assetUrls: typeof assets.urls;
    caption: typeof caption;
    captionStyle: typeof captionStyle;
    evaluatedShot: NonNullable<typeof displayedShot>;
    degraded: boolean;
    camera?: CameraView;
  } | null>(null);
  useLayoutEffect(() => {
    if (
      (assets.status !== 'ready' && assets.status !== 'degraded') ||
      !displayedShot
    ) {
      return;
    }
    lastReadyVisual.current = {
      assetUrls: assets.urls,
      caption,
      captionStyle,
      evaluatedShot: displayedShot,
      degraded: previewDegraded,
      camera,
    };
  }, [
    assets.status,
    assets.urls,
    caption,
    captionStyle,
    camera,
    displayedShot,
    previewDegraded,
  ]);
  const heldVisual =
    assets.status === 'loading' ? lastReadyVisual.current : null;
  const initialReadinessError =
    initialReadiness === 'error' ||
    assets.status === 'error' ||
    fatalAssetIds.length > 0;
  const previewVisualState = initialReadinessError
    ? 'error'
    : initialReadiness === 'preparing'
      ? 'preparing'
      : heldVisual
        ? 'holding'
        : previewDegraded
          ? 'degraded'
          : assets.status;
  const atEnd = durationMs > 0 && displayedTimeMs >= durationMs;
  const audioWarning = useProductPreviewAudio({
    projectRoot,
    project,
    shot,
    timeMs: activeShotTimeMs,
    playing,
    seekRevision,
  });
  useLayoutEffect(() => {
    recordPreviewDuration('overlay-render-to-commit', renderStartedAt, { timeMs });
  });
  recordPreviewDuration('overlay-render-pre-jsx', renderStartedAt, { timeMs });

  return (
    <div
      aria-label="产品预览"
      aria-modal={previewSurfaceActive}
      className="product-preview-overlay"
      data-preview-playing={String(playing)}
      data-preview-range={range}
      data-speaker-focus={String(autoCameraEnabled)}
      data-preview-data-ready={String(initialReadiness === 'ready')}
      data-preview-degraded={String(previewDegraded)}
      data-preview-failed-asset-ids={JSON.stringify(fatalAssetIds)}
      data-preview-stage-failures={JSON.stringify(
        currentStageImageFailures.map(({ partId, assetId, sourceUrl, reason }) => ({
          partId,
          assetId,
          sourceUrl,
          reason,
        })),
      )}
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
      tabIndex={-1}
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
                <button
                  aria-pressed={autoCameraEnabled}
                  className="product-preview-speaker-focus"
                  data-testid="product-preview-speaker-focus"
                  onClick={() => onAutoCameraChange(!autoCameraEnabled)}
                  type="button"
                >
                  自动运镜
                </button>
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
                ) : assets.status === 'ready' && renderedShot && !previewDegraded ? (
                  <>
                    <CanvasStage
                      assetUrls={assets.urls}
                      camera={camera}
                      caption={caption}
                      captionStyle={captionStyle}
                      evaluatedShot={renderedShot}
                      onDisplayReady={
                        initialReadiness === 'preparing'
                          ? handleInitialStageReady
                          : undefined
                      }
                      onError={handleInitialStageError}
                      onImageResourceFailure={handleImageResourceFailure}
                      onReady={
                        initialReadiness === 'preparing'
                          ? handleInitialStageReady
                          : undefined
                      }
                      project={project}
                    />
                    {(assets.optionalFailedAssetIds?.length ?? 0) > 0 ? (
                      <div
                        className="product-preview-message product-preview-warning"
                        data-testid="product-preview-optional-warning"
                      >
                        <strong>部分候选素材未能预加载</strong>
                        <span>切换到对应画面时仍会按需检查这些素材。</span>
                      </div>
                    ) : null}
                  </>
                ) : previewDegraded && displayedShot ? (
                  <>
                    <CanvasStage
                      assetUrls={assets.urls}
                      camera={camera}
                      caption={caption}
                      captionStyle={captionStyle}
                      degraded
                      evaluatedShot={displayedShot}
                      onDisplayReady={
                        initialReadiness === 'preparing'
                          ? handleInitialStageReady
                          : undefined
                      }
                      onError={handleInitialStageError}
                      onImageResourceFailure={handleImageResourceFailure}
                      project={project}
                    />
                    <div
                      className="product-preview-message product-preview-warning"
                      data-testid="product-preview-mouth-degraded-warning"
                    >
                      <strong>嘴型素材不可用，已显示当前表情</strong>
                      <span>修复嘴型素材后，预览会恢复到目标嘴型。</span>
                    </div>
                    {(assets.optionalFailedAssetIds?.length ?? 0) > 0 ? (
                      <div
                        className="product-preview-message product-preview-warning"
                        data-testid="product-preview-optional-warning"
                      >
                        <strong>部分候选素材未能预加载</strong>
                        <span>切换到对应画面时仍会按需检查这些素材。</span>
                      </div>
                    ) : null}
                  </>
                ) : heldVisual ? (
                  <CanvasStage
                    assetUrls={heldVisual.assetUrls}
                    camera={heldVisual.camera}
                    caption={heldVisual.caption}
                    captionStyle={heldVisual.captionStyle}
                    degraded={heldVisual.degraded}
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
                ) : displayedShot ? (
                  <CanvasStage
                    assetUrls={assets.urls}
                    camera={camera}
                    caption={caption}
                    captionStyle={captionStyle}
                    degraded={previewDegraded}
                    evaluatedShot={displayedShot}
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
                        type: playbackClockAnchorRef.current
                          ? 'pause'
                          : 'play',
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
