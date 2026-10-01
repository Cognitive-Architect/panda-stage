import { AudioClipService, type AudioClip, type Project } from '../../../domain';
import { pxToTime } from './timeGeometry';

export type StandaloneAudioGestureKind = 'move' | 'start' | 'end';
const service = new AudioClipService();

/** Draft projection uses the same legal range owner as the final authoring command. */
export function standaloneAudioPreview(
  project: Project, shotId: string, clip: AudioClip,
  kind: StandaloneAudioGestureKind, deltaPx: number, pixelsPerMs: number,
): AudioClip {
  const delta = Math.round(pxToTime(Math.abs(deltaPx), pixelsPerMs)) * Math.sign(deltaPx);
  const target = { shotId, clipId: clip.id };
  const next = kind === 'move'
    ? service.move(project, { ...target, startMs: clip.startMs + delta })
    : kind === 'start'
      ? service.trimStart(project, { ...target, startMs: clip.startMs + delta })
      : service.trimEnd(project, { ...target, endMs: clip.endMs + delta });
  return next.shots.find(shot => shot.id === shotId)!.audioClips.find(candidate => candidate.id === clip.id)!;
}

export interface StandaloneAudioGestureIdentity {
  projectInstanceId: number | null;
  revision: number;
  shotId: string;
  clipId: string;
}

/** Cancel stale gestures, including same-path reopen and concurrent Undo/Redo. */
export function canCommitStandaloneAudioGesture(
  origin: StandaloneAudioGestureIdentity,
  current: StandaloneAudioGestureIdentity & { selectedClipId: string | null },
): boolean {
  return origin.projectInstanceId !== null &&
    origin.projectInstanceId === current.projectInstanceId &&
    origin.revision === current.revision && origin.shotId === current.shotId &&
    origin.clipId === current.clipId && origin.clipId === current.selectedClipId;
}
