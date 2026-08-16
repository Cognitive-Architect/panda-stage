import { useRef, useState } from 'react';
import type { Dialogue } from '../../../domain';
import { dialogueSelectionStore } from '../../stores/dialogueSelectionStore';
import { dialogueStore } from '../../stores/dialogueStore';
import {
  clampTime,
  frameDurationMs,
  snapToFrame,
  timeToPx,
} from './timeGeometry';

type DragKind = 'move' | 'start' | 'end';

interface DragState {
  kind: DragKind;
  pointerId: number;
  originClientX: number;
  originStartMs: number;
  originEndMs: number;
}

export interface DialogueClipProps {
  dialogue: Dialogue;
  characterName: string;
  durationMs: number;
  pixelsPerMs: number;
  trackRef: React.RefObject<HTMLDivElement | null>;
  selected: boolean;
}

function roundedTime(value: number): number {
  return snapToFrame(Math.round(value));
}

function roundedDelta(value: number): number {
  return Math.round(
    Math.round(value / frameDurationMs()) * frameDurationMs(),
  );
}

export function DialogueClip({
  dialogue,
  characterName,
  durationMs,
  pixelsPerMs,
  trackRef,
  selected,
}: DialogueClipProps): React.JSX.Element {
  const dragRef = useRef<DragState | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState({
    startMs: dialogue.startMs,
    endMs: dialogue.endMs,
  });
  const [error, setError] = useState<string | null>(null);
  const displayedStartMs = dragRef.current ? draft.startMs : dialogue.startMs;
  const displayedEndMs = dragRef.current ? draft.endMs : dialogue.endMs;
  const left = timeToPx(displayedStartMs, pixelsPerMs);
  const width = Math.max(
    10,
    timeToPx(displayedEndMs - displayedStartMs, pixelsPerMs),
  );

  const updateDraft = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag || !trackRef.current) return;
    event.stopPropagation();
    const deltaMs = roundedDelta(
      (event.clientX - drag.originClientX) / Math.max(pixelsPerMs, 0.0001),
    );
    if (drag.kind === 'move') {
      const duration = drag.originEndMs - drag.originStartMs;
      const startMs = clampTime(
        roundedTime(drag.originStartMs + deltaMs),
        Math.max(0, durationMs - duration),
      );
      setDraft({ startMs, endMs: startMs + duration });
      return;
    }
    if (drag.kind === 'start') {
      const startMs = Math.min(
        roundedTime(drag.originStartMs + deltaMs),
        drag.originEndMs - 1,
      );
      setDraft({
        startMs: clampTime(startMs, Math.max(0, drag.originEndMs - 1)),
        endMs: drag.originEndMs,
      });
      return;
    }
    const endMs = Math.max(
      roundedTime(drag.originEndMs + deltaMs),
      drag.originStartMs + 1,
    );
    setDraft({
      startMs: drag.originStartMs,
      endMs: clampTime(endMs, durationMs),
    });
  };

  const beginDrag = (
    event: React.PointerEvent<HTMLElement>,
    kind: DragKind,
  ): void => {
    event.preventDefault();
    event.stopPropagation();
    dialogueSelectionStore.select(dialogue.id);
    dragRef.current = {
      kind,
      pointerId: event.pointerId,
      originClientX: event.clientX,
      originStartMs: dialogue.startMs,
      originEndMs: dialogue.endMs,
    };
    setDraft({ startMs: dialogue.startMs, endMs: dialogue.endMs });
    setError(null);
    rootRef.current?.setPointerCapture(event.pointerId);
  };

  const finishDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = null;
    if (rootRef.current?.hasPointerCapture(event.pointerId)) {
      rootRef.current.releasePointerCapture(event.pointerId);
    }
    try {
      if (drag.kind === 'move') {
        dialogueStore.move(dialogue.id, draft.startMs - dialogue.startMs);
      } else {
        dialogueStore.resize(
          dialogue.id,
          drag.kind,
          drag.kind === 'start' ? draft.startMs : draft.endMs,
        );
      }
      setError(null);
    } catch (nextError) {
      setDraft({ startMs: dialogue.startMs, endMs: dialogue.endMs });
      setError(nextError instanceof Error ? nextError.message : '对白时间段无效。');
    }
  };

  const cancelDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!dragRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = null;
    setDraft({ startMs: dialogue.startMs, endMs: dialogue.endMs });
    if (rootRef.current?.hasPointerCapture(event.pointerId)) {
      rootRef.current.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div
      aria-label={`${characterName}：${dialogue.text}`}
      className={`dialogue-clip${selected ? ' selected' : ''}`}
      data-dialogue-id={dialogue.id}
      data-end-ms={displayedEndMs}
      data-selected={String(selected)}
      data-start-ms={displayedStartMs}
      data-testid="dialogue-clip"
      ref={rootRef}
      onClick={(event) => {
        event.stopPropagation();
        dialogueSelectionStore.select(dialogue.id);
      }}
      onPointerCancel={cancelDrag}
      onPointerDown={(event) => beginDrag(event, 'move')}
      onPointerMove={updateDraft}
      onPointerUp={finishDrag}
      role="button"
      style={{ left: `${left}px`, width: `${width}px` }}
      tabIndex={0}
    >
      <span
        aria-hidden="true"
        className="dialogue-clip-handle dialogue-clip-handle-start"
        data-testid="dialogue-clip-handle-start"
        onPointerDown={(event) => beginDrag(event, 'start')}
      />
      <span className="dialogue-clip-label">
        <strong>{characterName}</strong>
        <span>{dialogue.text}</span>
      </span>
      <span
        aria-hidden="true"
        className="dialogue-clip-handle dialogue-clip-handle-end"
        data-testid="dialogue-clip-handle-end"
        onPointerDown={(event) => beginDrag(event, 'end')}
      />
      {error ? (
        <span className="dialogue-clip-error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
