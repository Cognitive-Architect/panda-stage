import { useEffect, useRef, useState } from 'react';
import type { Dialogue } from '../../../domain';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { dialogueSelectionStore } from '../../stores/dialogueSelectionStore';
import { dialogueStore } from '../../stores/dialogueStore';
import { shotStore } from '../../stores/shotStore';
import {
  commitDialogueGesture,
  isolateDialoguePointerEvent,
  shouldCommitDialogueGesture,
  type DialogueGestureIdentity,
  type DialogueGestureKind,
} from './dialogueGesture';
import {
  clampTime,
  frameDurationMs,
  snapToFrame,
  timeToPx,
} from './timeGeometry';

interface DragState {
  kind: DialogueGestureKind;
  pointerId: number;
  identity: DialogueGestureIdentity;
  originClientX: number;
  originStartMs: number;
  originEndMs: number;
  draftStartMs: number;
  draftEndMs: number;
}

export interface DialogueClipProps {
  dialogue: Dialogue;
  characterName: string;
  durationMs: number;
  pixelsPerMs: number;
  projectRoot: string;
  shotId: string;
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
  projectRoot,
  shotId,
  selected,
}: DialogueClipProps): React.JSX.Element {
  const dragRef = useRef<DragState | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState({
    startMs: dialogue.startMs,
    endMs: dialogue.endMs,
  });
  const [error, setError] = useState<string | null>(null);
  const timed = dialogue.endMs > dialogue.startMs;
  const displayedStartMs = dragRef.current
    ? preview.startMs
    : dialogue.startMs;
  const displayedEndMs = dragRef.current ? preview.endMs : dialogue.endMs;
  const rawLeft = timeToPx(displayedStartMs, pixelsPerMs);
  const left = timed
    ? rawLeft
    : Math.min(
        rawLeft,
        Math.max(0, timeToPx(durationMs, pixelsPerMs) - 18),
      );
  const width = timed
    ? Math.max(
        10,
        timeToPx(displayedEndMs - displayedStartMs, pixelsPerMs),
      )
    : 18;

  const releaseCapture = (pointerId: number): void => {
    if (rootRef.current?.hasPointerCapture(pointerId)) {
      rootRef.current.releasePointerCapture(pointerId);
    }
  };

  const discardDrag = (): void => {
    const drag = dragRef.current;
    if (drag) releaseCapture(drag.pointerId);
    dragRef.current = null;
    setPreview({ startMs: dialogue.startMs, endMs: dialogue.endMs });
  };

  useEffect(() => {
    const drag = dragRef.current;
    if (
      drag &&
      !shouldCommitDialogueGesture(drag.identity, {
        projectRoot,
        shotId,
        selectedDialogueId: selected ? dialogue.id : null,
        dialogueIds: [dialogue.id],
      }, 'pointerup')
    ) {
      discardDrag();
    }
  }, [dialogue.id, projectRoot, selected, shotId]);

  useEffect(() => {
    const cancelOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && dragRef.current) {
        event.preventDefault();
        discardDrag();
      }
    };
    window.addEventListener('keydown', cancelOnEscape);
    return () => {
      window.removeEventListener('keydown', cancelOnEscape);
      const drag = dragRef.current;
      if (drag) releaseCapture(drag.pointerId);
      dragRef.current = null;
    };
  }, [dialogue.id]);

  const updatePreview = (
    event: React.PointerEvent<HTMLDivElement>,
  ): void => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const deltaMs = roundedDelta(
      (event.clientX - drag.originClientX) /
        Math.max(pixelsPerMs, 0.0001),
    );
    let next: { startMs: number; endMs: number };
    if (drag.kind === 'move') {
      const duration = drag.originEndMs - drag.originStartMs;
      const startMs = clampTime(
        roundedTime(drag.originStartMs + deltaMs),
        Math.max(0, durationMs - duration),
      );
      next = { startMs, endMs: startMs + duration };
    } else if (drag.kind === 'start') {
      const startMs = Math.min(
        roundedTime(drag.originStartMs + deltaMs),
        drag.originEndMs - 1,
      );
      next = {
        startMs: clampTime(startMs, Math.max(0, drag.originEndMs - 1)),
        endMs: drag.originEndMs,
      };
    } else {
      const endMs = Math.max(
        roundedTime(drag.originEndMs + deltaMs),
        drag.originStartMs + 1,
      );
      next = {
        startMs: drag.originStartMs,
        endMs: clampTime(endMs, durationMs),
      };
    }
    drag.draftStartMs = next.startMs;
    drag.draftEndMs = next.endMs;
    setPreview(next);
  };

  const beginDrag = (
    event: React.PointerEvent<HTMLElement>,
    kind: DialogueGestureKind,
  ): void => {
    isolateDialoguePointerEvent(event);
    dialogueSelectionStore.select(dialogue.id);
    if (!timed) return;
    dragRef.current = {
      kind,
      pointerId: event.pointerId,
      identity: { projectRoot, shotId, dialogueId: dialogue.id },
      originClientX: event.clientX,
      originStartMs: dialogue.startMs,
      originEndMs: dialogue.endMs,
      draftStartMs: dialogue.startMs,
      draftEndMs: dialogue.endMs,
    };
    setPreview({ startMs: dialogue.startMs, endMs: dialogue.endMs });
    setError(null);
    rootRef.current?.setPointerCapture(event.pointerId);
  };

  const currentGestureContext = () => {
    const snapshot = editorProjectStore.getSnapshot();
    const currentShotId = shotStore.getCurrentShotId();
    const currentShot = snapshot?.project.shots.find(
      (candidate) => candidate.id === currentShotId,
    );
    return {
      projectRoot: snapshot?.projectRoot ?? null,
      shotId: currentShotId,
      selectedDialogueId:
        dialogueSelectionStore.getSelectedDialogueId(),
      dialogueIds:
        currentShot?.dialogues.map((candidate) => candidate.id) ?? [],
    };
  };

  const finishDrag = (
    event: React.PointerEvent<HTMLDivElement>,
  ): void => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    isolateDialoguePointerEvent(event);
    dragRef.current = null;
    releaseCapture(event.pointerId);
    try {
      const committed = commitDialogueGesture(
        drag.identity,
        currentGestureContext(),
        'pointerup',
        () => {
          if (drag.kind === 'move') {
            dialogueStore.move(
              dialogue.id,
              drag.draftStartMs - drag.originStartMs,
            );
          } else {
            dialogueStore.resize(
              dialogue.id,
              drag.kind,
              drag.kind === 'start'
                ? drag.draftStartMs
                : drag.draftEndMs,
            );
          }
        },
      );
      if (!committed) {
        setPreview({
          startMs: dialogue.startMs,
          endMs: dialogue.endMs,
        });
        return;
      }
      setError(null);
    } catch (nextError) {
      setPreview({ startMs: dialogue.startMs, endMs: dialogue.endMs });
      setError(
        nextError instanceof Error
          ? nextError.message
          : '对白时间段无效。',
      );
    }
  };

  const cancelDrag = (
    event: React.PointerEvent<HTMLDivElement>,
  ): void => {
    if (!dragRef.current) return;
    isolateDialoguePointerEvent(event);
    discardDrag();
  };

  return (
    <div
      aria-label={
        timed
          ? `${characterName}：${dialogue.text}`
          : `${characterName}：未定时对白，位于 ${dialogue.startMs}ms`
      }
      className={`dialogue-clip ${timed ? 'timed' : 'untimed'}${
        selected ? ' selected' : ''
      }`}
      data-dialogue-id={dialogue.id}
      data-end-ms={displayedEndMs}
      data-selected={String(selected)}
      data-start-ms={displayedStartMs}
      data-timed={String(timed)}
      data-testid="dialogue-clip"
      ref={rootRef}
      onClick={(event) => {
        event.stopPropagation();
        dialogueSelectionStore.select(dialogue.id);
      }}
      onPointerCancel={cancelDrag}
      onPointerDown={(event) => beginDrag(event, 'move')}
      onPointerMove={updatePreview}
      onPointerUp={finishDrag}
      role="button"
      style={{ left: `${left}px`, width: `${width}px` }}
      tabIndex={0}
    >
      {timed ? (
        <span
          aria-hidden="true"
          className="dialogue-clip-handle dialogue-clip-handle-start"
          data-testid="dialogue-clip-handle-start"
          onPointerDown={(event) => beginDrag(event, 'start')}
        />
      ) : null}
      <span className="dialogue-clip-label">
        <strong>{characterName}</strong>
        <span>{timed ? dialogue.text : '未定时'}</span>
      </span>
      {timed ? (
        <span
          aria-hidden="true"
          className="dialogue-clip-handle dialogue-clip-handle-end"
          data-testid="dialogue-clip-handle-end"
          onPointerDown={(event) => beginDrag(event, 'end')}
        />
      ) : null}
      {error ? (
        <span className="dialogue-clip-error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
