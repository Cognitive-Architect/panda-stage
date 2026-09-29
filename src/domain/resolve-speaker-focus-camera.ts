import { buildDialogueSubtitleCues } from '../shared/preview/dialogue-subtitle';
import { evaluateSubtitleAtTime } from '../shared/preview/subtitle-engine';
import { evaluateLayerMotionAtTime } from './evaluate-layer-motion';
import { evaluateShotAtTime } from './evaluate-shot-at-time';
import type { Project, Shot } from './models';

export interface CameraView {
  centerX: number;
  centerY: number;
  zoom: number;
}

export const SPEAKER_FOCUS_ZOOM = 1.5;
export const SPEAKER_FOCUS_TRANSITION_MS = 250;

export function fullStageCamera(width: number, height: number): CameraView {
  return { centerX: width / 2, centerY: height / 2, zoom: 1 };
}

export function clampCamera(
  camera: CameraView,
  width: number,
  height: number,
): CameraView {
  const zoom = Math.max(1, camera.zoom);
  const halfWidth = width / (2 * zoom);
  const halfHeight = height / (2 * zoom);
  return {
    centerX: Math.max(halfWidth, Math.min(width - halfWidth, camera.centerX)),
    centerY: Math.max(halfHeight, Math.min(height - halfHeight, camera.centerY)),
    zoom,
  };
}

function easeInOut(progress: number): number {
  return progress < 0.5
    ? 2 * progress * progress
    : 1 - Math.pow(-2 * progress + 2, 2) / 2;
}

function interpolate(from: CameraView, to: CameraView, progress: number): CameraView {
  const amount = easeInOut(Math.max(0, Math.min(1, progress)));
  return {
    centerX: from.centerX + (to.centerX - from.centerX) * amount,
    centerY: from.centerY + (to.centerY - from.centerY) * amount,
    zoom: from.zoom + (to.zoom - from.zoom) * amount,
  };
}

/** One Shot is an independent requested-time camera domain. */
export function resolveSpeakerFocusCamera(
  project: Project,
  shot: Shot,
  requestedTimeMs: number,
): CameraView {
  const timeMs = Math.max(0, Math.min(shot.durationMs, Math.round(requestedTimeMs)));
  const full = fullStageCamera(project.width, project.height);
  const cues = buildDialogueSubtitleCues(shot.dialogues);
  const dialogueById = new Map(shot.dialogues.map((dialogue) => [dialogue.id, dialogue]));

  const intentAt = (atMs: number): string | null => {
    const cue = evaluateSubtitleAtTime(cues, atMs);
    const characterId = cue ? dialogueById.get(cue.id)?.characterId : null;
    if (!characterId) return null;
    const evaluated = evaluateShotAtTime(shot, atMs, project);
    const matches = shot.layers.filter((layer) =>
      layer.source.kind === 'character' &&
      layer.source.characterId === characterId &&
      layer.id !== shot.backgroundLayerId &&
      evaluated.layers.find((candidate) => candidate.id === layer.id)?.visible,
    );
    return matches.length === 1 ? matches[0]!.id : null;
  };

  const targetAt = (layerId: string | null, atMs: number): CameraView => {
    const layer = shot.layers.find((candidate) => candidate.id === layerId);
    if (!layer) return full;
    const main = evaluateLayerMotionAtTime(layer, shot.timelineEvents, atMs).mainPosition;
    return clampCamera(
      { centerX: main.x, centerY: main.y, zoom: SPEAKER_FOCUS_ZOOM },
      project.width,
      project.height,
    );
  };

  // Every cue boundary and visibility change can alter the winner/occurrence.
  const boundaries = [...new Set([
    0,
    ...cues.flatMap((cue) => [cue.startMs, cue.endMs]),
    ...shot.timelineEvents
      .filter((event) => event.type === 'visibility')
      .map((event) => event.startMs),
  ])].filter((boundary) => boundary >= 0 && boundary <= timeMs).sort((a, b) => a - b);

  let intent: string | null = null;
  let transitionStart = 0;
  let from = full;
  for (const boundary of boundaries) {
    const nextIntent = intentAt(boundary);
    if (nextIntent === intent) continue;
    const viewAtBoundary = interpolate(
      from,
      targetAt(intent, boundary),
      (boundary - transitionStart) / SPEAKER_FOCUS_TRANSITION_MS,
    );
    from = viewAtBoundary;
    transitionStart = boundary;
    intent = nextIntent;
  }
  return clampCamera(
    interpolate(from, targetAt(intent, timeMs), (timeMs - transitionStart) / SPEAKER_FOCUS_TRANSITION_MS),
    project.width,
    project.height,
  );
}
