import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  ChevronDown,
  ChevronUp,
  Clock3,
  MessageSquareText,
  Volume2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { shotStore } from '../../stores/shotStore';
import {
  computePixelsPerMs,
  formatTimecode,
  generateRulerTicks,
  pxToTime,
  timeToPx,
} from './timeGeometry';
import { timelineUiStore, useTimelineUi } from './timelineUiStore';
import { DialogueSheet } from '../dialogue/DialogueSheet';
import { DialogueClip } from './DialogueClip';
import { dialogueSelectionStore } from '../../stores/dialogueSelectionStore';

const TIMELINE_LANE_LABEL_WIDTH = 82;
const PORTRAIT_TIMELINE_LANE_LABEL_WIDTH = 58;

export interface TimelineDockProps {
  presentation?: 'desktop' | 'landscape' | 'portrait';
}

/**
 * The only product Timeline surface for Day 26. It renders the current shot's
 * `0 → durationMs` range with a mm:ss.mmm readout and a seekable playhead.
 *
 * All interactions (seek / zoom / scroll / collapse) write only to
 * `timelineUiStore`; the project snapshot, dirty flag, revision and History
 * are never touched.
 */
export function TimelineDock({
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
  const ui = useTimelineUi();
  const selectedDialogueId = useSyncExternalStore(
    dialogueSelectionStore.subscribe,
    dialogueSelectionStore.getSelectedDialogueId,
  );

  const durationMs = currentShotId
    ? snapshot?.project.shots.find((shot) => shot.id === currentShotId)
        ?.durationMs ?? 0
    : 0;
  const shot = currentShotId
    ? snapshot?.project.shots.find((candidate) => candidate.id === currentShotId) ?? null
    : null;
  const characters = snapshot?.project.characters ?? [];
  const audioClips = shot?.audioClips ?? [];
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
  const draggingRef = useRef(false);
  const [viewportWidth, setViewportWidth] = useState(0);

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

  // The store resets scrollPx to 0 on shot switch (resetForShot); mirror that
  // into the real viewport so the playhead at 0ms stays within the visible
  // track instead of being left off-screen at a stale horizontal offset.
  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollLeft = 0;
  }, [currentShotId]);

  const pixelsPerMs = computePixelsPerMs(viewportWidth, durationMs, ui.zoom);
  const trackWidth = durationMs * pixelsPerMs;
  const playheadPx = timeToPx(ui.currentTimeMs, pixelsPerMs);
  const ticks = generateRulerTicks(durationMs, pixelsPerMs);

  const seekFromClientX = (clientX: number): void => {
    const track = trackRef.current;
    if (!track || !hasShot) return;
    const rect = track.getBoundingClientRect();
    const time = pxToTime(clientX - rect.left, pixelsPerMs);
    timelineUiStore.seek(time, durationMs);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!hasShot) return;
    draggingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    seekFromClientX(event.clientX);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!draggingRef.current) return;
    seekFromClientX(event.clientX);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    draggingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleScroll = (event: React.UIEvent<HTMLDivElement>): void => {
    timelineUiStore.setScrollPx(event.currentTarget.scrollLeft);
  };

  return (
    <section
      aria-label="镜头时间轴"
      className="timeline-dock"
      data-expanded={ui.expanded ? 'true' : 'false'}
      data-has-shot={hasShot ? 'true' : 'false'}
      data-lane-label-width={laneLabelWidth}
      data-presentation={presentation}
      data-testid="timeline-dock"
      style={
        {
          '--timeline-lane-label-width': `${laneLabelWidth}px`,
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
              onPointerUp={handlePointerUp}
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
                aria-label="字幕和音频轨道"
                className="timeline-track-stack"
                data-testid="timeline-track-stack"
                data-timeline-layer="track-stack"
                role="group"
              >
                <div className="timeline-lanes" data-testid="timeline-lanes">
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
                      className="timeline-lane-content"
                      style={{ width: `${trackWidth}px` }}
                    >
                      <div
                        className="dialogue-track"
                        data-testid="dialogue-track"
                      >
                        {shot?.dialogues.map((dialogue) => (
                          <DialogueClip
                            characterName={
                              characters.find(
                                (character) =>
                                  character.id === dialogue.characterId,
                              )?.name ?? dialogue.characterId
                            }
                            dialogue={dialogue}
                            durationMs={durationMs}
                            key={dialogue.id}
                            pixelsPerMs={pixelsPerMs}
                            projectRoot={snapshot?.projectRoot ?? ''}
                            selected={dialogue.id === selectedDialogueId}
                            shotId={shot.id}
                          />
                        ))}
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
                      <span className="timeline-lane-label-text">音频</span>
                    </span>
                    <div
                      className="timeline-lane-content"
                      style={{ width: `${trackWidth}px` }}
                    >
                      {audioClips.map((clip) => (
                        <div
                          aria-label={`音频：${audioClipName(clip.assetId, clip.name)}`}
                          className="timeline-audio-clip"
                          data-audio-clip-id={clip.id}
                          data-testid="timeline-audio-clip"
                          key={clip.id}
                          style={{
                            left: `${timeToPx(clip.startMs, pixelsPerMs)}px`,
                            width: `${Math.max(
                              8,
                              timeToPx(clip.endMs - clip.startMs, pixelsPerMs),
                            )}px`,
                          }}
                        >
                          <span>
                            {audioClipName(clip.assetId, clip.name)}
                          </span>
                        </div>
                      ))}
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
            当前没有可定位的镜头或时长为 0。
          </div>
        )
      ) : null}
      <section
        aria-label="字幕任务区"
        className="timeline-task-tray"
        data-testid="timeline-task-tray"
        data-timeline-layer="task-tray"
      >
        <DialogueSheet />
      </section>
    </section>
  );
}
