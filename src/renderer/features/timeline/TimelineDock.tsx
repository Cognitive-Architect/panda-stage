import { MouthPoseLane } from './MouthPoseLane';
import { CharacterMotionLane } from './CharacterMotionLane';
import { LayerMotionLane } from './LayerMotionLane';
import { LayerParentLane } from './LayerParentLane';
import { ShotCameraLane } from './ShotCameraLane';
import {
  useLayoutEffect,
  useContext,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  ChevronDown,
  ChevronUp,
  Clock3,
  MessageSquareText,
  Spline,
  Search,
  SkipBack,
  SlidersHorizontal,
  Volume2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { getBoundAudioEndRange, type DialogueTextMatch } from '../../../domain';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { selectionStore } from '../../stores/selectionStore';
import { shotStore } from '../../stores/shotStore';
import {
  computePixelsPerMs,
  formatTimecode,
  generateRulerTicks,
  pxToTime,
  timeToPx,
} from './timeGeometry';
import { timelineUiStore, useTimelineUi } from './timelineUiStore';
import { DialogueClip } from './DialogueClip';
import { AudioClip } from './AudioClip';
import { dialogueSelectionStore } from '../../stores/dialogueSelectionStore';
import { usePendingDialoguePlacement } from './PendingDialoguePlacement';
import { dialogueSpeakerName } from '../dialogue/dialogueSpeaker';
import { DialogueFindReplace } from '../dialogue/DialogueFindReplace';
import { PositionLane, recognizeSelectedPositionLane } from './PositionLane';
import { audioClipSelectionStore } from '../../stores/audioClipSelectionStore';
import { StandaloneAudioLane } from './StandaloneAudioLane';
import { StandaloneAudioControls } from './StandaloneAudioControls';
import { FlaGraphicInternalTimelineBar } from './FlaGraphicInternalTimelineBar';
import { TimelineAudioWaveform } from './TimelineAudioWaveform';
import { useTimelineAudio } from './useTimelineAudio';
import { AnimationCurveDraftDispatch } from './AnimationCurveDraft';
import { AnimationCurvePanel } from './AnimationCurvePanel';
import { BatchTimeEditPanel } from './BatchTimeEditPanel';

const TIMELINE_LANE_LABEL_WIDTH = 82;
const PORTRAIT_TIMELINE_LANE_LABEL_WIDTH = 58;

export interface TimelineDockProps {
  productPreviewOpen?: boolean;
  presentation?: 'desktop' | 'landscape' | 'portrait';
}

/** Mirror Timeline UI scroll state into its one real horizontal viewport. */
export function syncTimelineRulerScroll(
  rulerScroll: Pick<HTMLDivElement, 'scrollLeft'> | null,
  scrollPx: number,
): void {
  if (rulerScroll && rulerScroll.scrollLeft !== scrollPx) {
    rulerScroll.scrollLeft = scrollPx;
  }
}

/** Bind the actual ruler viewport to Timeline scroll intent and commands. */
export function bindTimelineRulerScroll(
  rulerScroll: Pick<HTMLDivElement, 'scrollLeft'> | null,
): () => void {
  const reconcile = (): void => {
    syncTimelineRulerScroll(rulerScroll, timelineUiStore.getSnapshot().scrollPx);
  };
  reconcile();
  return timelineUiStore.subscribe(reconcile);
}

/**
 * The single product Timeline surface. It renders the current shot's
 * `0 → durationMs` range with a mm:ss.mmm readout and a seekable playhead.
 *
 * Seek / zoom / scroll / collapse write only to `timelineUiStore`.
 * Clip authoring delegates to the existing Dialogue / standalone audio owners;
 * this surface never directly mutates the project snapshot or History.
 */
export function TimelineDock({
  productPreviewOpen = false,
  presentation = 'landscape',
}: TimelineDockProps = {}): React.JSX.Element {
  const currentShotId = useSyncExternalStore(
    shotStore.subscribe,
    shotStore.getCurrentShotId,
  );
  const snapshot = useSyncExternalStore(
    editorProjectStore.subscribe,
    editorProjectStore.getSnapshot,
  );
  const selectedLayerId = useSyncExternalStore(
    selectionStore.subscribe,
    selectionStore.getSelectedLayerId,
  );
  const ui = useTimelineUi();
  const selectedAudioClipId = useSyncExternalStore(audioClipSelectionStore.subscribe, audioClipSelectionStore.getSelectedAudioClipId);
  const selectedDialogueId = useSyncExternalStore(
    dialogueSelectionStore.subscribe,
    dialogueSelectionStore.getSelectedDialogueId,
  );
  const selectedDialogueIds = useSyncExternalStore(
    dialogueSelectionStore.subscribe,
    dialogueSelectionStore.getSelectedDialogueIds,
  );

  const durationMs = currentShotId
    ? snapshot?.project.shots.find((shot) => shot.id === currentShotId)
        ?.durationMs ?? 0
    : 0;
  const shot = currentShotId
    ? snapshot?.project.shots.find((candidate) => candidate.id === currentShotId) ?? null
    : null;
  const positionLane = recognizeSelectedPositionLane(shot, selectedLayerId);
  const motionLayer = shot?.layers.find(({ id }) => id === selectedLayerId);
  const hasCurveTracks = Boolean(motionLayer && (motionLayer.animationClip?.tracks.length ||
    shot?.timelineEvents.some((event) => event.layerId === motionLayer.id && event.type === 'opacity' && event.endMs > event.startMs)));
  const [curveOpen, setCurveOpen] = useState(false);
  const onAnimationCurveDraft = useContext(AnimationCurveDraftDispatch);
  const characters = snapshot?.project.characters ?? [];
  const audioClips = shot?.audioClips.filter(clip => clip.role === 'dialogue') ?? [];
  const selectedAudioClip = shot?.audioClips.find(clip => clip.id === selectedAudioClipId && clip.role !== 'dialogue');
  const selectedDialogueAudioId = shot?.dialogues.find(({ id }) => id === selectedDialogueId)?.audioClipId;
  const focusedAudio = selectedAudioClip ?? audioClips.find(({ id }) => id === selectedDialogueAudioId);
  const timelineAudio = useTimelineAudio(currentShotId, focusedAudio, ui.expanded && !productPreviewOpen);
  const [scrubAudio, setScrubAudio] = useState(true);
  const lastAudition = useRef<number | null>(null);
  const laneLabelWidth =
    presentation === 'portrait'
      ? PORTRAIT_TIMELINE_LANE_LABEL_WIDTH
      : TIMELINE_LANE_LABEL_WIDTH;

  const audioClipName = (assetId: string, clipName: string): string =>
    snapshot?.project.assets.find((asset) => asset.id === assetId)?.name ??
    clipName;

  // Whether a seekable ruler is actually mounted. The ruler only renders when
  // the Timeline is expanded AND a real shot is active, so `hasShot` flips
  // false→true *after* this component first mounts (the active shot is
  // selected once the project opens). The measurement effect below must re-run
  // on this change or `viewportWidth` stays frozen at its first (often 0) value.
  const hasShot = currentShotId !== null && durationMs > 0;

  const scrollRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const subtitleLaneContentRef = useRef<HTMLDivElement>(null);
  const rulerDragRef = useRef<{
    pointerId: number;
    element: HTMLDivElement;
    stopAudition?: () => void;
  } | null>(null);
  const mediaGestureRef = useRef<{ pointerId: number; x: number; y: number; axis: 'pending' | 'horizontal' | 'vertical' } | null>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [motionToolbarHost, setMotionToolbarHost] = useState<HTMLDivElement | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [batchTimeOpen, setBatchTimeOpen] = useState(false);
  const findButton = useRef<HTMLButtonElement>(null);
  const batchTimeButton = useRef<HTMLButtonElement>(null);
  const {
    drag: pendingDrag,
    registerDropTarget,
  } = usePendingDialoguePlacement();

  // Re-measure whenever the ruler actually mounts or unmounts. The ruler only
  // exists when the Timeline is expanded (ui.expanded) and a real shot is
  // active (hasShot); both can change after the first mount. A one-shot mount
  // effect would freeze viewportWidth at its initial (often 0) reading, which
  // makes pixelsPerMs=0 → no ticks and a playhead that never seeks. Re-running
  // on [ui.expanded, hasShot] guarantees the live width is captured the moment
  // the ruler appears, fixing the stuck-at-0 seek failure (Issue #199).
  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const measure = (): void => setViewportWidth(node.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [ui.expanded, hasShot]);

  // The store owns horizontal scroll intent. Subscribe the mounted ruler so a
  // return-to-start request can reconcile DOM even when UI state is 0/0.
  useLayoutEffect(() => {
    return bindTimelineRulerScroll(scrollRef.current);
  }, [currentShotId, hasShot, ui.expanded]);

  const endRulerDrag = (interrupted: boolean): void => {
    const drag = rulerDragRef.current;
    if (!drag) return;
    rulerDragRef.current = null;
    if (interrupted) drag.stopAudition?.();
    if (drag.element.hasPointerCapture(drag.pointerId)) {
      drag.element.releasePointerCapture(drag.pointerId);
    }
  };

  useLayoutEffect(() => {
    if (!hasShot || !ui.expanded) return;
    const cancelRulerDrag = (): void => endRulerDrag(true);
    window.addEventListener('blur', cancelRulerDrag);
    return () => {
      window.removeEventListener('blur', cancelRulerDrag);
      cancelRulerDrag();
    };
  }, [currentShotId, hasShot, ui.expanded]);

  const pixelsPerMs = computePixelsPerMs(viewportWidth, durationMs, ui.zoom);
  const trackWidth = durationMs * pixelsPerMs;
  const playheadPx = timeToPx(ui.currentTimeMs, pixelsPerMs);
  const ticks = generateRulerTicks(durationMs, pixelsPerMs);
  const selectedWaveform = focusedAudio && timelineAudio.samples ? (
    <TimelineAudioWaveform clip={focusedAudio} samples={timelineAudio.samples} pixelsPerMs={pixelsPerMs}
      scrollPx={ui.scrollPx} viewportWidth={viewportWidth} laneLabelWidth={laneLabelWidth} />
  ) : null;

  useLayoutEffect(() => {
    const element = subtitleLaneContentRef.current;
    if (presentation !== 'landscape' || !hasShot || !element) {
      registerDropTarget(null);
      return;
    }
    registerDropTarget({ element, durationMs, pixelsPerMs });
    return () => registerDropTarget(null);
  }, [durationMs, hasShot, pixelsPerMs, presentation, registerDropTarget]);

  const seekFromClientX = (clientX: number): void => {
    const track = trackRef.current;
    if (!track || !hasShot) return;
    const rect = track.getBoundingClientRect();
    const time = pxToTime(clientX - rect.left - laneLabelWidth, pixelsPerMs);
    timelineUiStore.seek(time, durationMs);
    const position = timelineUiStore.getSnapshot().currentTimeMs;
    if (!scrubAudio || productPreviewOpen || position === lastAudition.current) return;
    lastAudition.current = position;
    const samples = timelineAudio.samples;
    if (samples && rulerDragRef.current) {
      rulerDragRef.current.stopAudition = () => samples.stop();
    }
    void samples?.audition(position).catch(() => undefined);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!hasShot || !event.isPrimary || event.button !== 0 || rulerDragRef.current) return;
    lastAudition.current = null;
    event.currentTarget.setPointerCapture(event.pointerId);
    rulerDragRef.current = { pointerId: event.pointerId, element: event.currentTarget };
    seekFromClientX(event.clientX);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (rulerDragRef.current?.pointerId !== event.pointerId) return;
    seekFromClientX(event.clientX);
  };

  const handlePointerEnd = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (rulerDragRef.current?.pointerId === event.pointerId) {
      endRulerDrag(event.type !== 'pointerup');
    }
  };

  const handleScroll = (event: React.UIEvent<HTMLDivElement>): void => {
    timelineUiStore.setScrollPx(event.currentTarget.scrollLeft);
  };

  const mediaPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.pointerType !== 'touch' ||
        getComputedStyle(event.currentTarget).overflowY !== 'auto') return;
    event.stopPropagation();
    lastAudition.current = null;
    mediaGestureRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, axis: 'pending' };
  };

  const mediaPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const gesture = mediaGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    if (gesture.axis === 'pending' && Math.max(Math.abs(dx), Math.abs(dy)) > 6) {
      gesture.axis = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
    }
    if (gesture.axis === 'horizontal') seekFromClientX(event.clientX);
  };

  const mediaPointerEnd = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (mediaGestureRef.current?.pointerId !== event.pointerId) return;
    event.stopPropagation();
    mediaGestureRef.current = null;
  };

  const locateDialogue = (match: DialogueTextMatch): void => {
    const targetShot = editorProjectStore.getSnapshot()?.project.shots.find((entry) => entry.id === match.shotId);
    const target = targetShot?.dialogues.find((entry) => entry.id === match.dialogueId);
    if (!targetShot || !target || target.text !== match.text) return;
    shotStore.select(targetShot.id);
    dialogueSelectionStore.select(target.id);
    timelineUiStore.setExpanded(true);
    timelineUiStore.seek(target.startMs, targetShot.durationMs);
    const scale = computePixelsPerMs(viewportWidth, targetShot.durationMs, timelineUiStore.getSnapshot().zoom);
    timelineUiStore.setScrollPx(Math.max(0, timeToPx(target.startMs, scale) - viewportWidth / 4));
  };

  return (
    <section
      aria-label="镜头时间轴"
      className="timeline-dock"
      data-expanded={ui.expanded ? 'true' : 'false'}
      data-has-shot={hasShot ? 'true' : 'false'}
      data-lane-label-width={laneLabelWidth}
      data-has-position-lane={positionLane ? 'true' : 'false'}
      data-presentation={presentation}
      data-testid="timeline-dock"
      style={
        {
          '--timeline-lane-label-width': `${laneLabelWidth}px`,
          '--timeline-scroll-px': `${ui.scrollPx}px`,
        } as React.CSSProperties
      }
    >
      <header
        aria-label="时间轴工具栏"
        className="timeline-header timeline-toolbar"
        data-testid="timeline-toolbar"
        data-timeline-layer="toolbar"
        role="toolbar"
      >
        <button
          type="button"
          className="timeline-collapse"
          data-testid="timeline-collapse"
          data-expanded={ui.expanded ? 'true' : 'false'}
          aria-expanded={ui.expanded}
          aria-label={ui.expanded ? '收起时间轴' : '展开时间轴'}
          title={ui.expanded ? '收起时间轴' : '展开时间轴'}
          onClick={() => timelineUiStore.setExpanded(!ui.expanded)}
        >
          {ui.expanded ? (
            <ChevronUp aria-hidden="true" focusable="false" size={18} />
          ) : (
            <ChevronDown aria-hidden="true" focusable="false" size={18} />
          )}
          <span className="timeline-collapse-label">
            {ui.expanded ? '收起时间轴' : '展开时间轴'}
          </span>
        </button>
        <output
          className="timeline-timecode"
          data-testid="timeline-timecode"
          data-current-time={ui.currentTimeMs}
          data-duration={durationMs}
        >
          <Clock3 aria-hidden="true" focusable="false" size={14} />
          <span>
            {formatTimecode(ui.currentTimeMs)} / {formatTimecode(durationMs)}
          </span>
        </output>
        <button
          type="button"
          className="timeline-return-to-start"
          data-testid="timeline-return-to-start"
          aria-label="回到起点"
          title="回到起点"
          disabled={!hasShot}
          onClick={() => timelineUiStore.returnToStart(durationMs)}
        >
          <SkipBack aria-hidden="true" focusable="false" size={18} />
        </button>
        <button type="button" className="timeline-dialogue-find" ref={findButton}
          aria-label="台词查找替换" title="台词查找替换" aria-expanded={findOpen && !productPreviewOpen}
          disabled={!hasShot || productPreviewOpen} onClick={() => setFindOpen(!findOpen)}>
          <Search aria-hidden="true" focusable="false" size={16} />
        </button>
        <button
          type="button"
          className="timeline-batch-time-toggle"
          data-testid="timeline-batch-time-toggle"
          ref={batchTimeButton}
          aria-label="批量时间编辑"
          title="批量时间编辑"
          aria-expanded={batchTimeOpen && !productPreviewOpen}
          disabled={!hasShot || productPreviewOpen}
          onClick={() => setBatchTimeOpen((open) => !open)}
        >
          <SlidersHorizontal aria-hidden="true" focusable="false" size={16} />
          {selectedDialogueIds.length > 1 ? (
            <span className="timeline-batch-time-count">
              {selectedDialogueIds.length}
            </span>
          ) : null}
        </button>
        {hasCurveTracks && !productPreviewOpen ? (
          <button type="button" className="animation-curve-toggle" aria-label="属性曲线" title="属性曲线"
            aria-expanded={curveOpen && ui.expanded} onClick={() => {
              if (!ui.expanded) timelineUiStore.setExpanded(true);
              setCurveOpen(!(curveOpen && ui.expanded));
            }}>
            <Spline aria-hidden="true" focusable="false" size={16} />
          </button>
        ) : null}
        <div
          className="character-motion-toolbar-host"
          data-testid="character-motion-toolbar-host"
          ref={setMotionToolbarHost}
        />
        {focusedAudio && ui.expanded && !productPreviewOpen ? (timelineAudio.unavailable ? (
          <span role="status" className="timeline-audio-notice">这段音频无法解码</span>
        ) : (
          <button type="button" className="timeline-scrub-audio" aria-pressed={scrubAudio}
            title="拖动播放头时试听附近声音"
            onClick={() => {
              timelineAudio.samples?.stop();
              setScrubAudio(!scrubAudio);
            }}>擦听</button>
        )) : null}
        {selectedAudioClip && ui.expanded && !productPreviewOpen ? (
          <StandaloneAudioControls
            key={`${editorProjectStore.getProjectInstanceId()}:${selectedAudioClip.id}`}
            clip={selectedAudioClip}
            displayName={audioClipName(selectedAudioClip.assetId, selectedAudioClip.name)}
          />
        ) : null}
        <div className="timeline-zoom">
          <button
            type="button"
            className="timeline-zoom-out"
            data-testid="timeline-zoom-out"
            aria-label="缩小时间轴"
            title="缩小时间轴"
            onClick={() => timelineUiStore.setZoom(ui.zoom / 2)}
          >
            <ZoomOut aria-hidden="true" focusable="false" size={16} />
            −
          </button>
          <span className="timeline-zoom-value" data-testid="timeline-zoom-value">
            {ui.zoom}×
          </span>
          <button
            type="button"
            className="timeline-zoom-in"
            data-testid="timeline-zoom-in"
            aria-label="放大时间轴"
            title="放大时间轴"
            onClick={() => timelineUiStore.setZoom(ui.zoom * 2)}
          >
            <ZoomIn aria-hidden="true" focusable="false" size={16} />
            +
          </button>
        </div>
      </header>
      {curveOpen && ui.expanded && !productPreviewOpen && snapshot && shot && motionLayer && hasCurveTracks ? (
        <AnimationCurvePanel key={JSON.stringify([editorProjectStore.getProjectInstanceId(), shot.id, motionLayer.id])}
          snapshot={snapshot} shot={shot} layer={motionLayer} onDraft={onAnimationCurveDraft} onClose={() => setCurveOpen(false)} />
      ) : null}
      {findOpen && !productPreviewOpen && snapshot && currentShotId ? (
        <DialogueFindReplace key={editorProjectStore.getProjectInstanceId()} project={snapshot.project} shotId={currentShotId}
          onLocate={locateDialogue} onClose={() => {
            setFindOpen(false);
            findButton.current?.focus();
          }} />
      ) : null}
      {batchTimeOpen && !productPreviewOpen && snapshot && shot ? (
        <BatchTimeEditPanel
          key={`${editorProjectStore.getProjectInstanceId()}:${shot.id}`}
          project={snapshot.project}
          shot={shot}
          onClose={() => {
            setBatchTimeOpen(false);
            batchTimeButton.current?.focus();
          }}
        />
      ) : null}
      {ui.expanded ? (
        hasShot ? (
          <div
            aria-label="时间标尺和时间轴轨道"
            className="timeline-ruler-scroll"
            data-timeline-scroll-owner="timeline-ui-store"
            ref={scrollRef}
            onScroll={handleScroll}
            data-testid="timeline-ruler-scroll"
          >
            <div
              className="timeline-ruler-track"
              ref={trackRef}
              style={{
                width: `${trackWidth + laneLabelWidth}px`,
              }}
              data-duration={durationMs}
              data-testid="timeline-ruler-track"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerEnd}
              onPointerCancel={handlePointerEnd}
              onLostPointerCapture={handlePointerEnd}
            >
              <div
                aria-label="时间标尺"
                className="timeline-ruler"
                data-testid="timeline-ruler"
                data-timeline-layer="ruler"
              >
                <span
                  aria-hidden="true"
                  className="timeline-ruler-label-spacer"
                />
                {ticks.map((tick) => (
                  <div
                    key={tick.timeMs}
                    className="timeline-tick"
                    data-testid="timeline-tick"
                    style={{
                      left: `${laneLabelWidth + tick.px}px`,
                    }}
                  >
                    <span className="timeline-tick-label">{tick.label}</span>
                  </div>
                ))}
              </div>
              <div
                aria-label="时间轴轨道"
                className="timeline-track-stack"
                data-testid="timeline-track-stack"
                data-timeline-layer="track-stack"
                role="group"
              >
                <div className="timeline-lanes" data-testid="timeline-lanes">
                  {(shot?.camera?.mode === 'manual' || shot?.camera?.mode === 'hybrid') && snapshot ? (
                    <ShotCameraLane key={shot.id} shot={shot} snapshot={snapshot} currentTimeMs={ui.currentTimeMs}
                      pixelsPerMs={pixelsPerMs} trackWidth={trackWidth} disabled={Boolean(productPreviewOpen)} />
                  ) : null}
                  {shot && snapshot && motionLayer ? (
                    <ShotCameraLane key={shot.id + ":" + motionLayer.id + ":depth"} shot={shot} snapshot={snapshot}
                      depthLayer={motionLayer} currentTimeMs={ui.currentTimeMs} pixelsPerMs={pixelsPerMs}
                      trackWidth={trackWidth} disabled={Boolean(productPreviewOpen)} />
                  ) : null}
                  {shot && snapshot && motionLayer && shot.backgroundLayerId !== motionLayer.id && motionLayer.parentKeys?.length ? (
                    <LayerParentLane
                      key={shot.id + ":" + motionLayer.id + ":parent"}
                      shot={shot}
                      snapshot={snapshot}
                      layer={motionLayer}
                      currentTimeMs={ui.currentTimeMs}
                      pixelsPerMs={pixelsPerMs}
                      trackWidth={trackWidth}
                      disabled={Boolean(productPreviewOpen)}
                    />
                  ) : null}
                  {ui.flaGraphicInternalContext && snapshot?.project ? (
                    <FlaGraphicInternalTimelineBar
                      context={ui.flaGraphicInternalContext}
                      project={snapshot.project}
                    />
                  ) : null}
                  {positionLane && shot ? (
                    <PositionLane
                      productPreviewOpen={productPreviewOpen}
                      key={`${shot.id}:${positionLane.layer.id}`}
                      currentTimeMs={ui.currentTimeMs}
                      layer={positionLane.layer}
                      pixelsPerMs={pixelsPerMs}
                      shot={shot}
                      trackWidth={trackWidth}
                      snapshot={snapshot!}
                    />
                  ) : null}
                  <div
                    className="timeline-media-lanes"
                    onPointerDown={mediaPointerDown}
                    onPointerMove={mediaPointerMove}
                    onPointerUp={mediaPointerEnd}
                    onPointerCancel={mediaPointerEnd}
                  >
                  {shot && snapshot ? (
                    <CharacterMotionLane
                      project={snapshot.project}
                      shot={shot}
                      layerId={selectedLayerId}
                      pixelsPerMs={pixelsPerMs}
                      currentTimeMs={ui.currentTimeMs}
                      trackWidth={trackWidth}
                      toolbarHost={motionToolbarHost}
                      productPreviewOpen={productPreviewOpen}
                    />
                  ) : null}
                  {shot && snapshot && selectedLayerId ? <MouthPoseLane
                    key={`${snapshot.project.id}/${shot.id}/${selectedLayerId}`}
                    project={snapshot.project} shot={shot} layerId={selectedLayerId}
                    pixelsPerMs={pixelsPerMs} currentTimeMs={ui.currentTimeMs}
                    trackWidth={trackWidth} disabled={Boolean(productPreviewOpen)} /> : null}
                  {shot && snapshot ? (
                    <LayerMotionLane
                      snapshot={snapshot}
                      shot={shot}
                      layerId={selectedLayerId}
                      pixelsPerMs={pixelsPerMs}
                      currentTimeMs={ui.currentTimeMs}
                      trackWidth={trackWidth}
                      toolbarHost={motionToolbarHost}
                      productPreviewOpen={productPreviewOpen}
                    />
                  ) : null}
                  <div
                    className="timeline-lane timeline-subtitle-lane"
                    data-testid="timeline-subtitle-track"
                    data-track-kind="subtitle"
                  >
                    <span
                      className="timeline-lane-label"
                      data-track-label="subtitle"
                    >
                      <MessageSquareText
                        aria-hidden="true"
                        className="timeline-lane-icon"
                        focusable="false"
                        size={16}
                      />
                      <span className="timeline-lane-label-text">字幕</span>
                    </span>
                    <div
                      className={`timeline-lane-content${
                        pendingDrag ? ' pending-drop-surface' : ''
                      }`}
                      data-pending-drop-surface="subtitle"
                      data-pending-drop-target={
                        pendingDrag ? pendingDrag.dropState : undefined
                      }
                      ref={subtitleLaneContentRef}
                      style={{ width: `${trackWidth}px` }}
                    >
                      <div
                        className="dialogue-track"
                        data-testid="dialogue-track"
                      >
                        {shot?.dialogues.map((dialogue) => (
                          <DialogueClip
                            characterName={dialogueSpeakerName(
                              dialogue,
                              characters,
                            )}
                            dialogue={dialogue}
                            durationMs={durationMs}
                            key={dialogue.id}
                            pixelsPerMs={pixelsPerMs}
                            projectRoot={snapshot?.projectRoot ?? ''}
                            selected={
                              dialogue.id === selectedDialogueId ||
                              selectedDialogueIds.includes(dialogue.id)
                            }
                            shotId={shot.id}
                          />
                          ))}
                        {pendingDrag &&
                        pendingDrag.mappedStartMs !== null ? (
                          <div
                            aria-hidden="true"
                            className="pending-dialogue-drop-marker"
                            data-testid="pending-dialogue-drop-marker"
                            style={{
                              left: `${timeToPx(
                                pendingDrag.mappedStartMs,
                                pixelsPerMs,
                              )}px`,
                            }}
                          />
                        ) : null}
                        {pendingDrag?.dropState === 'valid' &&
                        pendingDrag.previewStartMs !== null &&
                        pendingDrag.previewEndMs !== null ? (
                          <div
                            aria-hidden="true"
                            className="pending-dialogue-drop-preview"
                            data-end-ms={pendingDrag.previewEndMs}
                            data-start-ms={pendingDrag.previewStartMs}
                            data-testid="pending-dialogue-drop-preview"
                            style={{
                              left: `${timeToPx(
                                pendingDrag.previewStartMs,
                                pixelsPerMs,
                              )}px`,
                              width: `${Math.max(
                                10,
                                timeToPx(
                                  pendingDrag.previewEndMs -
                                    pendingDrag.previewStartMs,
                                  pixelsPerMs,
                                ),
                              )}px`,
                            }}
                          />
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <div
                    className={`timeline-lane timeline-audio-lane ${
                      audioClips.length === 0 ? 'is-empty' : 'has-clips'
                    }`}
                    data-audio-state={
                      audioClips.length === 0 ? 'empty' : 'populated'
                    }
                    data-testid="timeline-audio-track"
                    data-track-kind="audio"
                  >
                    <span
                      className="timeline-lane-label"
                      data-track-label="audio"
                    >
                      <Volume2
                        aria-hidden="true"
                        className="timeline-lane-icon"
                        focusable="false"
                        size={16}
                      />
                      <span className="timeline-lane-label-text">对白</span>
                    </span>
                    <div
                      className="timeline-lane-content"
                      data-pending-drop-target={
                        pendingDrag ? 'not-allowed' : undefined
                      }
                      style={{ width: `${trackWidth}px` }}
                    >
                      {audioClips.map((clip) => {
                        const dialogue =
                          shot?.dialogues.find(
                            (candidate) => candidate.audioClipId === clip.id,
                          ) ?? null;
                        const asset = snapshot?.project.assets.find(
                          (candidate) => candidate.id === clip.assetId,
                        );
                        const legalRange =
                          dialogue &&
                          asset?.kind === 'audio' &&
                          asset.durationMs !== undefined
                            ? getBoundAudioEndRange({
                                shotDurationMs: durationMs,
                                dialogueEndMs: dialogue.endMs,
                                clipStartMs: clip.startMs,
                                clipOffsetMs: clip.offsetMs,
                                sourceDurationMs: asset.durationMs,
                              })
                            : null;
                        return (
                          <AudioClip
                            clip={clip}
                            dialogue={dialogue}
                            displayName={audioClipName(clip.assetId, clip.name)}
                            key={clip.id}
                            maximumEndMs={legalRange?.maximumEndMs ?? null}
                            pixelsPerMs={pixelsPerMs}
                            projectRoot={snapshot?.projectRoot ?? ''}
                            selected={
                              Boolean(dialogue) &&
                              (dialogue!.id === selectedDialogueId ||
                                selectedDialogueIds.includes(dialogue!.id))
                            }
                            shotId={shot!.id}
                            waveform={clip.id === focusedAudio?.id ? selectedWaveform : null}
                          />
                        );
                      })}
                      {audioClips.length === 0 ? (
                        <span
                          className="timeline-audio-empty"
                          data-testid="timeline-audio-empty"
                        >
                          暂无音频片段
                        </span>
                      ) : null}
                    </div>
                  </div>
                  {shot && snapshot ? (['sfx', 'bgm'] as const).map(role => (
                    <StandaloneAudioLane key={`${editorProjectStore.getProjectInstanceId()}:${shot.id}:${role}`} role={role} project={snapshot.project} shotId={shot.id}
                      trackWidth={trackWidth} pixelsPerMs={pixelsPerMs} selectedClipId={selectedAudioClipId} selectedWaveform={selectedWaveform} />
                  )) : null}
                  </div>
                </div>
              </div>
              <div
                className="timeline-playhead"
                data-testid="timeline-playhead"
                style={{
                  left: `${laneLabelWidth + playheadPx}px`,
                }}
                data-current-time={ui.currentTimeMs}
              >
                <span className="timeline-playhead-handle" />
              </div>
            </div>
          </div>
        ) : (
          <div className="timeline-empty" data-testid="timeline-empty">
            新建镜头后，这里会显示时间轴。
          </div>
        )
      ) : null}
    </section>
  );
}
