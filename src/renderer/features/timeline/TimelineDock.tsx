import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
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

/**
 * The only product Timeline surface for Day 26. It renders the current shot's
 * `0 → durationMs` range with a mm:ss.mmm readout and a seekable playhead.
 *
 * All interactions (seek / zoom / scroll / collapse) write only to
 * `timelineUiStore`; the project snapshot, dirty flag, revision and History
 * are never touched.
 */
export function TimelineDock(): React.JSX.Element {
  const currentShotId = useSyncExternalStore(
    shotStore.subscribe,
    shotStore.getCurrentShotId,
  );
  const snapshot = useSyncExternalStore(
    editorProjectStore.subscribe,
    editorProjectStore.getSnapshot,
  );
  const ui = useTimelineUi();

  const durationMs = currentShotId
    ? snapshot?.project.shots.find((shot) => shot.id === currentShotId)
        ?.durationMs ?? 0
    : 0;

  const scrollRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [viewportWidth, setViewportWidth] = useState(0);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const measure = (): void => setViewportWidth(node.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

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
  const hasShot = currentShotId !== null && durationMs > 0;

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
      data-testid="timeline-dock"
    >
      <header className="timeline-header">
        <button
          type="button"
          className="timeline-collapse"
          data-testid="timeline-collapse"
          aria-expanded={ui.expanded}
          onClick={() => timelineUiStore.setExpanded(!ui.expanded)}
        >
          {ui.expanded ? '收起时间轴' : '展开时间轴'}
        </button>
        <output
          className="timeline-timecode"
          data-testid="timeline-timecode"
          data-current-time={ui.currentTimeMs}
          data-duration={durationMs}
        >
          {formatTimecode(ui.currentTimeMs)} / {formatTimecode(durationMs)}
        </output>
        <div className="timeline-zoom">
          <button
            type="button"
            className="timeline-zoom-out"
            data-testid="timeline-zoom-out"
            onClick={() => timelineUiStore.setZoom(ui.zoom / 2)}
          >
            −
          </button>
          <span className="timeline-zoom-value" data-testid="timeline-zoom-value">
            {ui.zoom}×
          </span>
          <button
            type="button"
            className="timeline-zoom-in"
            data-testid="timeline-zoom-in"
            onClick={() => timelineUiStore.setZoom(ui.zoom * 2)}
          >
            +
          </button>
        </div>
      </header>
      {ui.expanded ? (
        hasShot ? (
          <div
            className="timeline-ruler-scroll"
            ref={scrollRef}
            onScroll={handleScroll}
            data-testid="timeline-ruler-scroll"
          >
            <div
              className="timeline-ruler-track"
              ref={trackRef}
              style={{ width: `${trackWidth}px` }}
              data-duration={durationMs}
              data-testid="timeline-ruler-track"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
            >
              {ticks.map((tick) => (
                <div
                  key={tick.timeMs}
                  className="timeline-tick"
                  style={{ left: `${tick.px}px` }}
                >
                  <span className="timeline-tick-label">{tick.label}</span>
                </div>
              ))}
              <div
                className="timeline-playhead"
                data-testid="timeline-playhead"
                style={{ left: `${playheadPx}px` }}
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
    </section>
  );
}
