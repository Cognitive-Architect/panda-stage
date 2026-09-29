import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Trash2 } from 'lucide-react';
import type { PositionKey } from '../../../domain';
import type { EditorProjectSnapshot } from '../../stores/EditorProjectStore';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { positionStore } from '../../stores/positionStore';
import { selectionStore } from '../../stores/selectionStore';
import { shotStore } from '../../stores/shotStore';
import { Button } from '../../ui/Button';
import { timelineUiStore } from './timelineUiStore';
import { formatTimecode, timeToPx } from './timeGeometry';
import { positionActionPlacement, previewPositionKeyTime } from './positionKeyGesture';
import { recognizeSelectedPositionLane } from './PositionLane';

export interface PositionKeyMarkerProps {
  point: PositionKey;
  current: boolean;
  durationMs: number;
  pixelsPerMs: number;
  shotId: string;
  layerId: string;
  previousTimeMs: number | null;
  nextTimeMs: number | null;
  snapshot: EditorProjectSnapshot;
  onError: (message: string) => void;
}

interface DragSession {
  pointerId: number;
  startX: number;
  previewTimeMs: number;
  moved: boolean;
  snapshot: EditorProjectSnapshot;
  instanceId: number | null;
}

/** Keep marker input out of the parent's playhead-seek gesture. */
export function isolatePositionMarkerPointer(event: ReactPointerEvent): void {
  event.stopPropagation();
}

export function seekPositionMarker(timeMs: number, durationMs: number): void {
  timelineUiStore.seek(timeMs, durationMs);
}

function targetIsCurrent(props: PositionKeyMarkerProps, snapshot: EditorProjectSnapshot, instanceId: number | null): boolean {
  if (editorProjectStore.getSnapshot() !== snapshot ||
      editorProjectStore.getProjectInstanceId() !== instanceId ||
      shotStore.getCurrentShotId() !== props.shotId ||
      selectionStore.getSelectedLayerId() !== props.layerId) return false;
  const shot = snapshot.project.shots.find((candidate) => candidate.id === props.shotId);
  const lane = recognizeSelectedPositionLane(shot ?? null, props.layerId);
  return lane?.recognition.status === 'editable' &&
    lane.recognition.chain.points.some((candidate) => candidate.timeMs === props.point.timeMs);
}

export function PositionKeyMarker(props: PositionKeyMarkerProps): React.JSX.Element {
  const { point, current, durationMs, pixelsPerMs, shotId, layerId, previousTimeMs, nextTimeMs, snapshot, onError } = props;
  const base = point.kind === 'base';
  const markerRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<DragSession | null>(null);
  const suppressClickRef = useRef(false);
  const [previewTimeMs, setPreviewTimeMs] = useState<number | null>(null);
  const [actionPosition, setActionPosition] = useState<{ top: number; left: number; below: boolean } | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(true);
  const displayTime = previewTimeMs ?? point.timeMs;
  const name = base ? '0 秒，基础位置' : `${formatTimecode(point.timeMs)}，位置点`;

  useLayoutEffect(() => {
    if (!current) setDeleteOpen(true);
  }, [current]);

  useLayoutEffect(() => {
    if (base || !current || !deleteOpen || previewTimeMs !== null) {
      setActionPosition(null);
      return;
    }
    const update = (): void => {
      const rect = markerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const viewport = markerRef.current?.closest('.timeline-ruler-scroll')?.getBoundingClientRect();
      setActionPosition(positionActionPlacement({
        marker: rect,
        scrollViewport: viewport ?? null,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        portrait: !!markerRef.current?.closest(".timeline-dock[data-presentation='portrait']"),
      }));
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [base, current, deleteOpen, previewTimeMs, pixelsPerMs]);

  useLayoutEffect(() => {
    if (!current || base || !deleteOpen) return;
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setDeleteOpen(false);
        markerRef.current?.focus();
      }
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [base, current, deleteOpen]);

  const reportStale = (): void => onError('这个位置点已发生变化，请重新操作。');

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    isolatePositionMarkerPointer(event);
    if (base || event.button !== 0) return;
    if (editorProjectStore.getSnapshot() !== snapshot ||
        shotStore.getCurrentShotId() !== shotId ||
        selectionStore.getSelectedLayerId() !== layerId) {
      reportStale();
      return;
    }
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      previewTimeMs: point.timeMs,
      moved: false,
      snapshot,
      instanceId: editorProjectStore.getProjectInstanceId(),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    isolatePositionMarkerPointer(event);
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || previousTimeMs === null) return;
    const deltaPx = event.clientX - drag.startX;
    if (!drag.moved && Math.abs(deltaPx) < 3) return;
    drag.moved = true;
    drag.previewTimeMs = previewPositionKeyTime({
      fromTimeMs: point.timeMs, deltaPx, pixelsPerMs,
      previousTimeMs, nextTimeMs, durationMs,
    });
    setPreviewTimeMs(drag.previewTimeMs);
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    isolatePositionMarkerPointer(event);
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null; // release/lost-capture can now never commit twice
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setPreviewTimeMs(null);
    if (!drag.moved) return;
    suppressClickRef.current = true;
    window.setTimeout(() => { suppressClickRef.current = false; }, 0);
    if (!targetIsCurrent(props, drag.snapshot, drag.instanceId)) {
      reportStale();
      return;
    }
    if (drag.previewTimeMs === point.timeMs) return;
    try {
      positionStore.retimeKey(shotId, layerId, point.timeMs, drag.previewTimeMs);
      timelineUiStore.seek(drag.previewTimeMs, durationMs);
    } catch {
      reportStale();
    }
  };

  const cancelDrag = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    isolatePositionMarkerPointer(event);
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setPreviewTimeMs(null);
  };

  const deleteKey = (): void => {
    if (!targetIsCurrent(props, snapshot, editorProjectStore.getProjectInstanceId()) ||
        timelineUiStore.getSnapshot().currentTimeMs !== point.timeMs) {
      reportStale();
      return;
    }
    try {
      positionStore.deleteKey(shotId, layerId, point.timeMs);
      setDeleteOpen(false);
    } catch {
      reportStale();
    }
  };

  return (
    <>
      <button
        ref={markerRef}
        aria-current={current ? 'time' : undefined}
        aria-label={name}
        className="position-key-marker"
        data-current={current ? 'true' : 'false'}
        data-dragging={previewTimeMs === null ? 'false' : 'true'}
        data-kind={point.kind}
        data-testid={base ? 'position-base-marker' : 'position-key-marker'}
        onClick={(event) => {
          event.stopPropagation();
          if (suppressClickRef.current && event.detail !== 0) {
            suppressClickRef.current = false;
            return;
          }
          setDeleteOpen(true);
          seekPositionMarker(point.timeMs, durationMs);
        }}
        onPointerCancel={cancelDrag}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onLostPointerCapture={cancelDrag}
        style={{ left: `${timeToPx(displayTime, pixelsPerMs)}px` }}
        title={name}
        type="button"
      >
        <span aria-hidden="true" className="position-key-diamond">
          {base ? <span className="position-key-root" /> : null}
        </span>
      </button>
      {previewTimeMs !== null ? (
        <span className="position-key-time-bubble" style={{ left: `${timeToPx(displayTime, pixelsPerMs)}px` }}>
          {formatTimecode(previewTimeMs)}
        </span>
      ) : null}
      {!base && current && deleteOpen && actionPosition && typeof document !== 'undefined'
        ? createPortal(
          <div
            className="position-key-action"
            data-below={actionPosition.below ? 'true' : 'false'}
            data-testid="position-key-action"
            style={{ top: actionPosition.top, left: actionPosition.left }}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <Button variant="danger" type="button" onClick={deleteKey} aria-label="删除当前位置点">
              <Trash2 aria-hidden="true" size={14} /> 删除
            </Button>
          </div>,
          document.body,
        ) : null}
    </>
  );
}
