import { buildDialogueSubtitleCues } from '../shared/preview/dialogue-subtitle';
import { evaluateSubtitleAtTime } from '../shared/preview/subtitle-engine';
import { evaluateLayerMotionAtTime } from './evaluate-layer-motion';
import { evaluateShotAtTime } from './evaluate-shot-at-time';
import type { Layer, Project, Shot, TimelineEvent } from './models';

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

interface CameraTransition {
  readonly startMs: number;
  readonly from: CameraView;
  readonly layer: Layer | null;
}

/** Immutable-input, runtime-only preparation. Each Shot owns its own schedule. */
export interface SpeakerFocusCameraPlan {
  readonly shot: Shot;
  readonly width: number;
  readonly height: number;
  readonly full: CameraView;
  readonly transitions: readonly CameraTransition[];
  readonly eventsByLayer: ReadonlyMap<string, readonly TimelineEvent[]>;
}

function targetAt(
  layer: Layer | null,
  atMs: number,
  width: number,
  height: number,
  full: CameraView,
  eventsByLayer: ReadonlyMap<string, readonly TimelineEvent[]>,
): CameraView {
  if (!layer) return full;
  const main = evaluateLayerMotionAtTime(
    layer,
    eventsByLayer.get(layer.id) ?? [],
    atMs,
  ).mainPosition;
  return clampCamera(
    { centerX: main.x, centerY: main.y, zoom: SPEAKER_FOCUS_ZOOM },
    width,
    height,
  );
}

export function prepareSpeakerFocusCamera(
  project: Project,
  shot: Shot,
): SpeakerFocusCameraPlan {
  const full = fullStageCamera(project.width, project.height);
  const cues = buildDialogueSubtitleCues(shot.dialogues);
  const dialogueById = new Map(shot.dialogues.map((dialogue) => [dialogue.id, dialogue]));
  const eventsByLayer = new Map<string, TimelineEvent[]>();
  for (const event of shot.timelineEvents) {
    const events = eventsByLayer.get(event.layerId) ?? [];
    events.push(event);
    eventsByLayer.set(event.layerId, events);
  }

  const intentAt = (atMs: number): Layer | null => {
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
    return matches.length === 1 ? matches[0]! : null;
  };

  // Every cue boundary and visibility change can alter the winner/occurrence.
  const boundaries = [...new Set([
    0,
    ...cues.flatMap((cue) => [cue.startMs, cue.endMs]),
    ...shot.timelineEvents
      .filter((event) => event.type === 'visibility')
      .map((event) => event.startMs),
  ])].filter((boundary) => boundary >= 0 && boundary <= shot.durationMs).sort((a, b) => a - b);

  let intent: Layer | null = null;
  let intentId: string | null = null;
  let transitionStart = 0;
  let from = full;
  const transitions: CameraTransition[] = [];
  for (const boundary of boundaries) {
    const nextIntent = intentAt(boundary);
    const nextIntentId = nextIntent?.id ?? null;
    if (nextIntentId === intentId) continue;
    const viewAtBoundary = interpolate(
      from,
      targetAt(intent, boundary, project.width, project.height, full, eventsByLayer),
      (boundary - transitionStart) / SPEAKER_FOCUS_TRANSITION_MS,
    );
    from = viewAtBoundary;
    transitionStart = boundary;
    intent = nextIntent;
    intentId = nextIntentId;
    transitions.push({ startMs: boundary, from, layer: intent });
  }
  return {
    shot,
    width: project.width,
    height: project.height,
    full,
    transitions,
    eventsByLayer,
  };
}

/** Binary lookup + dynamic main Position; no historical schedule replay. */
export function evaluateSpeakerFocusCamera(
  plan: SpeakerFocusCameraPlan,
  requestedTimeMs: number,
): CameraView {
  const timeMs = Math.max(0, Math.min(plan.shot.durationMs, Math.round(requestedTimeMs)));
  let low = 0;
  let high = plan.transitions.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (plan.transitions[middle]!.startMs <= timeMs) low = middle + 1;
    else high = middle;
  }
  const transition = plan.transitions[low - 1];
  if (!transition) return plan.full;
  return clampCamera(
    interpolate(
      transition.from,
      targetAt(
        transition.layer,
        timeMs,
        plan.width,
        plan.height,
        plan.full,
        plan.eventsByLayer,
      ),
      (timeMs - transition.startMs) / SPEAKER_FOCUS_TRANSITION_MS,
    ),
    plan.width,
    plan.height,
  );
}

/** Convenient pure one-shot evaluation for non-playback consumers. */
export function resolveSpeakerFocusCamera(
  project: Project,
  shot: Shot,
  requestedTimeMs: number,
): CameraView {
  return evaluateSpeakerFocusCamera(prepareSpeakerFocusCamera(project, shot), requestedTimeMs);
}
