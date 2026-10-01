import { useEffect, useRef, useState } from 'react';
import type { AudioClip, Project } from '../../../domain';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { audioClipSelectionStore } from '../../stores/audioClipSelectionStore';
import { audioClipStore } from '../../stores/audioClipStore';
import { shotStore } from '../../stores/shotStore';
import { canCommitStandaloneAudioGesture, standaloneAudioPreview, type StandaloneAudioGestureIdentity, type StandaloneAudioGestureKind } from './standaloneAudioGesture';
import { timeToPx } from './timeGeometry';

interface Drag {
  pointerId: number;
  kind: StandaloneAudioGestureKind;
  identity: StandaloneAudioGestureIdentity;
  project: Project;
  originX: number;
  scale: number;
  origin: AudioClip;
  draft: AudioClip;
}

export function StandaloneAudioClip({ clip, displayName, shotId, pixelsPerMs, selected }: {
  clip: AudioClip; displayName: string; shotId: string; pixelsPerMs: number; selected: boolean;
}): React.JSX.Element {
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [preview, setPreview] = useState(clip);
  const [error, setError] = useState<string | null>(null);
  const shown = drag.current ? preview : clip;

  const cancel = (): void => {
    const pointerId = drag.current?.pointerId;
    drag.current = null;
    if (pointerId !== undefined && root.current?.hasPointerCapture(pointerId)) root.current.releasePointerCapture(pointerId);
    setPreview(clip);
  };
  useEffect(() => {
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && drag.current) { event.preventDefault(); cancel(); }
    };
    window.addEventListener('keydown', escape);
    return () => { window.removeEventListener('keydown', escape); drag.current = null; };
  }, [clip.id]);

  const attempt = (action: () => void): void => {
    try { action(); setError(null); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '音频片段调整失败。'); }
  };
  const begin = (event: React.PointerEvent<HTMLElement>, kind: StandaloneAudioGestureKind): void => {
    event.preventDefault(); event.stopPropagation();
    if (event.button !== 0 || pixelsPerMs <= 0) return;
    const snapshot = editorProjectStore.getSnapshot();
    if (!snapshot) return;
    audioClipSelectionStore.select(clip.id);
    root.current?.focus();
    drag.current = {
      pointerId: event.pointerId, kind, project: snapshot.project,
      identity: { projectInstanceId: editorProjectStore.getProjectInstanceId(), revision: snapshot.revision, shotId, clipId: clip.id },
      originX: event.clientX, scale: pixelsPerMs, origin: clip, draft: clip,
    };
    setPreview(clip); setError(null);
    root.current?.setPointerCapture(event.pointerId);
  };
  const handleKey = (event: React.KeyboardEvent<HTMLElement>, kind: StandaloneAudioGestureKind): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault(); event.stopPropagation();
    audioClipSelectionStore.select(clip.id);
    const delta = (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 1000 : 100);
    attempt(() => {
      if (kind === 'move') audioClipStore.move(clip.id, clip.startMs + delta);
      else if (kind === 'start') audioClipStore.trimStart(clip.id, clip.startMs + delta);
      else audioClipStore.trimEnd(clip.id, clip.endMs + delta);
    });
  };
  return <div
    ref={root} role="button" tabIndex={0} aria-label={`${clip.role === 'bgm' ? 'BGM' : '音效'}：${displayName}`}
    aria-pressed={selected}
    className={`timeline-audio-clip standalone-audio-clip${selected ? ' selected' : ''}`}
    data-testid="standalone-audio-clip" data-audio-clip-id={clip.id} data-role={clip.role}
    data-start-ms={shown.startMs} data-end-ms={shown.endMs} data-offset-ms={shown.offsetMs} data-selected={String(selected)}
    style={{ left: timeToPx(shown.startMs, pixelsPerMs), width: Math.max(24, timeToPx(shown.endMs - shown.startMs, pixelsPerMs)) }}
    onClick={event => { event.stopPropagation(); audioClipSelectionStore.select(clip.id); }}
    onPointerDown={event => begin(event, 'move')}
    onPointerMove={event => {
      const gesture = drag.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      event.stopPropagation();
      attempt(() => {
        gesture.draft = standaloneAudioPreview(gesture.project, shotId, gesture.origin, gesture.kind, event.clientX - gesture.originX, gesture.scale);
        setPreview(gesture.draft);
      });
    }}
    onPointerUp={event => {
      const gesture = drag.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      event.preventDefault(); event.stopPropagation(); cancel();
      const snapshot = editorProjectStore.getSnapshot();
      if (!snapshot || !canCommitStandaloneAudioGesture(gesture.identity, {
        projectInstanceId: editorProjectStore.getProjectInstanceId(), revision: snapshot.revision,
        shotId: shotStore.getCurrentShotId() ?? '', clipId: clip.id,
        selectedClipId: audioClipSelectionStore.getSelectedAudioClipId(),
      })) return;
      attempt(() => {
        if (gesture.kind === 'move') audioClipStore.move(clip.id, gesture.draft.startMs);
        else if (gesture.kind === 'start') audioClipStore.trimStart(clip.id, gesture.draft.startMs);
        else audioClipStore.trimEnd(clip.id, gesture.draft.endMs);
      });
    }}
    onPointerCancel={event => { event.stopPropagation(); cancel(); }}
    onLostPointerCapture={() => { if (drag.current) cancel(); }}
    onKeyDown={event => {
      if (event.target !== event.currentTarget) return;
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault(); event.stopPropagation(); attempt(() => audioClipStore.remove(clip.id));
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault(); audioClipSelectionStore.select(clip.id);
      } else handleKey(event, 'move');
    }}
  >
    <span className="timeline-audio-clip-label">{displayName}</span>
    {selected ? (['start', 'end'] as const).map(kind => <span
      key={kind} role="button" tabIndex={0} aria-label={kind === 'start' ? '裁剪音频起点' : '裁剪音频终点'}
      className={`standalone-audio-trim standalone-audio-trim-${kind}`} data-testid={`standalone-audio-trim-${kind}`}
      onPointerDown={event => begin(event, kind)} onKeyDown={event => handleKey(event, kind)}
    ><span aria-hidden="true">Ⅱ</span></span>) : null}
    {error ? <span className="timeline-audio-clip-error" role="alert">{error}</span> : null}
  </div>;
}
