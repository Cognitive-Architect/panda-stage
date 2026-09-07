import { useEffect, useRef, useState } from 'react';
import type { AudioClip as AudioClipModel, Dialogue } from '../../../domain';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { dialogueSelectionStore } from '../../stores/dialogueSelectionStore';
import { dialogueStore } from '../../stores/dialogueStore';
import { shotStore } from '../../stores/shotStore';
import {
  commitAudioTrimGesture,
  getAudioTrimPreviewEnd,
  type AudioTrimGestureIdentity,
} from './audioTrimGesture';
import { formatTimecode, timeToPx } from './timeGeometry';

interface DragState {
  pointerId: number;
  identity: AudioTrimGestureIdentity;
  originClientX: number;
  originEndMs: number;
  draftEndMs: number;
}

export interface AudioClipProps {
  clip: AudioClipModel;
  dialogue: Dialogue | null;
  displayName: string;
  maximumEndMs: number | null;
  pixelsPerMs: number;
  projectRoot: string;
  selected: boolean;
  shotId: string;
}

export function AudioClip({
  clip,
  dialogue,
  displayName,
  maximumEndMs,
  pixelsPerMs,
  projectRoot,
  selected,
  shotId,
}: AudioClipProps): React.JSX.Element {
  const dragRef = useRef<DragState | null>(null);
  const handleRef = useRef<HTMLSpanElement>(null);
  const [previewEndMs, setPreviewEndMs] = useState(clip.endMs);
  const [error, setError] = useState<string | null>(null);
  const displayedEndMs = dragRef.current ? previewEndMs : clip.endMs;

  const discardDrag = (): void => {
    const drag = dragRef.current;
    if (drag && handleRef.current?.hasPointerCapture(drag.pointerId)) {
      handleRef.current.releasePointerCapture(drag.pointerId);
    }
    dragRef.current = null;
    setPreviewEndMs(clip.endMs);
  };

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
      dragRef.current = null;
    };
  }, [clip.id]);

  const currentContext = () => {
    const snapshot = editorProjectStore.getSnapshot();
    const currentShotId = shotStore.getCurrentShotId();
    const currentShot = snapshot?.project.shots.find(
      (candidate) => candidate.id === currentShotId,
    );
    const currentDialogue = currentShot?.dialogues.find(
      (candidate) => candidate.id === dialogue?.id,
    );
    return {
      projectRoot: snapshot?.projectRoot ?? null,
      shotId: currentShotId,
      selectedDialogueId: dialogueSelectionStore.getSelectedDialogueId(),
      dialogueAudioClipId: currentDialogue?.audioClipId ?? null,
    };
  };

  return (
    <div
      aria-label={`音频：${displayName}`}
      className={`timeline-audio-clip${selected ? ' selected' : ''}`}
      data-audio-clip-id={clip.id}
      data-end-ms={displayedEndMs}
      data-selected={String(selected)}
      data-trimming={String(Boolean(dragRef.current))}
      data-testid="timeline-audio-clip"
      onClick={(event) => {
        event.stopPropagation();
        if (dialogue) dialogueSelectionStore.select(dialogue.id);
      }}
      onPointerDown={(event) => event.stopPropagation()}
      role={dialogue ? 'button' : undefined}
      style={{
        left: `${timeToPx(clip.startMs, pixelsPerMs)}px`,
        width: `${Math.max(
          8,
          timeToPx(displayedEndMs - clip.startMs, pixelsPerMs),
        )}px`,
      }}
      tabIndex={dialogue ? 0 : undefined}
    >
      <span className="timeline-audio-clip-label">{displayName}</span>
      {selected && dialogue && maximumEndMs !== null ? (
        <span
          aria-label="调整配音结束时间"
          aria-valuemax={maximumEndMs}
          aria-valuemin={clip.startMs + 1}
          aria-valuenow={displayedEndMs}
          className="timeline-audio-trim-handle"
          data-testid="timeline-audio-trim-handle-end"
          title="拖动右端调整配音时长"
          onPointerCancel={(event) => {
            event.preventDefault();
            event.stopPropagation();
            discardDrag();
          }}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            dialogueSelectionStore.select(dialogue.id);
            dragRef.current = {
              pointerId: event.pointerId,
              identity: {
                projectRoot,
                shotId,
                dialogueId: dialogue.id,
                clipId: clip.id,
              },
              originClientX: event.clientX,
              originEndMs: clip.endMs,
              draftEndMs: clip.endMs,
            };
            setPreviewEndMs(clip.endMs);
            setError(null);
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current;
            if (!drag || drag.pointerId !== event.pointerId) return;
            event.stopPropagation();
            drag.draftEndMs = getAudioTrimPreviewEnd(
              drag.originEndMs,
              event.clientX - drag.originClientX,
              pixelsPerMs,
              clip.startMs + 1,
              maximumEndMs,
            );
            setPreviewEndMs(drag.draftEndMs);
          }}
          onPointerUp={(event) => {
            const drag = dragRef.current;
            if (!drag || drag.pointerId !== event.pointerId) return;
            event.preventDefault();
            event.stopPropagation();
            dragRef.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
            if (drag.draftEndMs === drag.originEndMs) return;
            try {
              commitAudioTrimGesture(
                drag.identity,
                currentContext(),
                'pointerup',
                () =>
                  dialogueStore.resizeBoundAudioEnd(
                    dialogue.id,
                    drag.draftEndMs,
                  ),
              );
              setError(null);
            } catch (nextError) {
              setPreviewEndMs(clip.endMs);
              setError(
                nextError instanceof Error
                  ? nextError.message
                  : '配音时长调整失败。',
              );
            }
          }}
          role="slider"
          tabIndex={0}
        >
          <span aria-hidden="true" className="timeline-audio-trim-grip">
            <i />
            <i />
          </span>
        </span>
      ) : null}
      {selected && dialogue ? (
        <output
          aria-live="off"
          className="timeline-audio-duration"
          data-testid="timeline-audio-duration"
        >
          {formatTimecode(displayedEndMs - clip.startMs)}
        </output>
      ) : null}
      {error ? <span className="timeline-audio-clip-error" role="alert">{error}</span> : null}
    </div>
  );
}
