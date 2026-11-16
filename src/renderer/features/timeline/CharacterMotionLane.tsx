import { ChevronDown, ChevronRight } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  characterCompositeKeyTimes,
  hasAuthoredCharacterPartMotion,
  type Project,
  type Shot,
} from '../../../domain';
import { selectionStore } from '../../stores/selectionStore';
import { characterMotionParts } from '../canvas/characterMotionContext';
import { timelineUiStore } from './timelineUiStore';

export interface CharacterMotionLaneProps {
  project: Project;
  shot: Shot;
  layerId: string | null;
  pixelsPerMs: number;
  currentTimeMs: number;
  trackWidth?: number;
}

/** Scroll only the enclosing vertical lane viewport so horizontal ruler scroll stays intact. */
function focusSelectedPartRow(row: HTMLDivElement | null): void {
  if (!row) return;
  const container = row.closest<HTMLElement>('.timeline-media-lanes');
  if (container && container.clientHeight > 0) {
    const rowTop = row.offsetTop - container.offsetTop;
    const rowBottom = rowTop + row.offsetHeight;
    if (rowTop < container.scrollTop) {
      container.scrollTop = rowTop;
    } else if (rowBottom > container.scrollTop + container.clientHeight) {
      container.scrollTop = rowBottom - container.clientHeight;
    }
    return;
  }
  row.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
}

export function CharacterMotionLane({
  project,
  shot,
  layerId,
  pixelsPerMs,
  currentTimeMs,
  trackWidth = shot.durationMs * pixelsPerMs,
}: CharacterMotionLaneProps): React.JSX.Element | null {
  const partId = useSyncExternalStore(selectionStore.subscribe, selectionStore.getSelectedCharacterPartId);
  const revealNonce = useSyncExternalStore(
    timelineUiStore.subscribe,
    () => timelineUiStore.getSnapshot().characterMotionRevealNonce,
  );
  const [groupExpanded, setGroupExpanded] = useState(true);
  const selectedRowRef = useRef<HTMLDivElement>(null);
  const lastFocusedKeyRef = useRef<string | null>(null);
  const prevPartIdRef = useRef(partId);
  const prevRevealNonceRef = useRef(revealNonce);
  const layer = shot.layers.find((candidate) => candidate.id === layerId);
  const allParts = characterMotionParts(project, layer);

  useEffect(() => {
    setGroupExpanded(true);
    lastFocusedKeyRef.current = null;
  }, [shot.id, layer?.id]);

  useLayoutEffect(() => {
    const partChanged = partId !== prevPartIdRef.current;
    const revealed = revealNonce !== prevRevealNonceRef.current;
    prevPartIdRef.current = partId;
    prevRevealNonceRef.current = revealNonce;
    if (!partId || !layer) {
      lastFocusedKeyRef.current = null;
      return;
    }
    if ((partChanged || revealed) && !groupExpanded) {
      lastFocusedKeyRef.current = null;
      setGroupExpanded(true);
      return;
    }
    if (!groupExpanded) {
      lastFocusedKeyRef.current = null;
      return;
    }
    const focusKey = `${shot.id}:${layer.id}:${partId}`;
    if (!revealed && lastFocusedKeyRef.current === focusKey) return;
    lastFocusedKeyRef.current = focusKey;
    focusSelectedPartRow(selectedRowRef.current);
  }, [groupExpanded, layer, partId, revealNonce, shot.id]);

  if (!layer || allParts.length === 0) return null;

  const authoredPartIds = new Set(
    allParts
      .filter((part) => hasAuthoredCharacterPartMotion(layer, part.partId))
      .map((part) => part.partId),
  );
  const visibleParts = allParts.filter(
    (part) => part.partId === partId || authoredPartIds.has(part.partId),
  );
  if (visibleParts.length === 0) return null;

  const overviewTimes = [
    ...new Set(
      visibleParts
        .filter((part) => authoredPartIds.has(part.partId))
        .flatMap((part) =>
          characterCompositeKeyTimes(layer, part.partId).filter((time) => time <= shot.durationMs),
        ),
    ),
  ].sort((left, right) => left - right);

  const selectPart = (targetPartId: string): void => {
    if (selectionStore.getSelectedLayerId() !== layer.id) {
      selectionStore.select(layer.id);
    }
    selectionStore.selectCharacterPart(targetPartId);
  };

  return (
    <>
      <div
        aria-label="人物动作总览"
        className="timeline-lane character-motion-overview-lane"
        data-expanded={groupExpanded ? 'true' : 'false'}
        data-testid="character-motion-overview-lane"
        role="group"
      >
        <span
          className="timeline-lane-label character-motion-overview-label"
          data-track-label="character-motion-overview"
          title="人物动作"
        >
          <button
            type="button"
            className="character-motion-group-toggle"
            data-testid="character-motion-group-toggle"
            aria-expanded={groupExpanded}
            aria-label={groupExpanded ? '收起人物动作轨道' : '展开人物动作轨道'}
            title={groupExpanded ? '收起人物动作轨道' : '展开人物动作轨道'}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              setGroupExpanded((expanded) => !expanded);
            }}
          >
            {groupExpanded ? (
              <ChevronDown aria-hidden="true" size={13} />
            ) : (
              <ChevronRight aria-hidden="true" size={13} />
            )}
          </button>
          <span className="timeline-lane-label-text">人物动作</span>
        </span>
        <div
          className="timeline-lane-content character-motion-overview-keys"
          style={{ width: `${trackWidth}px` }}
        >
          {overviewTimes.map((time) => (
            <button
              type="button"
              key={time}
              className="character-motion-overview-marker"
              data-testid="character-motion-overview-marker"
              data-time-ms={time}
              aria-label={`人物动作总览关键帧 ${time}ms`}
              aria-current={time === currentTimeMs ? 'true' : undefined}
              style={{ left: time * pixelsPerMs }}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                timelineUiStore.seek(time, shot.durationMs);
              }}
            >
              <span aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>
      {groupExpanded
        ? visibleParts.map((part) => {
            const selected = part.partId === partId;
            const times = characterCompositeKeyTimes(layer, part.partId).filter(
              (time) => time <= shot.durationMs,
            );
            const spanStart = times.length > 1 ? times[0]! : null;
            const spanEnd = times.length > 1 ? times[times.length - 1]! : null;
            return (
              <div
                key={part.partId}
                ref={selected ? selectedRowRef : undefined}
                className="timeline-lane character-motion-lane"
                aria-label={`${part.name} 动作关键帧`}
                data-part-id={part.partId}
                data-selected-part={selected ? 'true' : 'false'}
                data-testid="character-motion-part-lane"
                onPointerDown={(event) => {
                  event.stopPropagation();
                  selectPart(part.partId);
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  selectPart(part.partId);
                }}
              >
                <span className="timeline-lane-label" title={part.name}>
                  <button
                    type="button"
                    className="character-motion-part-select"
                    aria-pressed={selected}
                    aria-label={part.name}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      selectPart(part.partId);
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      selectPart(part.partId);
                    }}
                  >
                    <span className="timeline-lane-label-text">{part.name}</span>
                  </button>
                </span>
                <div
                  className="timeline-lane-content character-motion-keys"
                  style={{ width: `${trackWidth}px` }}
                >
                  {spanStart !== null && spanEnd !== null ? (
                    <span
                      aria-hidden="true"
                      className="character-motion-span-line"
                      style={{
                        left: spanStart * pixelsPerMs,
                        width: Math.max(0, (spanEnd - spanStart) * pixelsPerMs),
                      }}
                    />
                  ) : null}
                  {times.map((time) => (
                    <button
                      type="button"
                      key={time}
                      data-time-ms={time}
                      aria-label={`${part.name} 动作关键帧 ${time}ms`}
                      aria-current={time === currentTimeMs ? 'true' : undefined}
                      style={{ left: time * pixelsPerMs }}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        selectPart(part.partId);
                        timelineUiStore.seek(time, shot.durationMs);
                      }}
                    >
                      ◆
                    </button>
                  ))}
                </div>
              </div>
            );
          })
        : null}
    </>
  );
}
