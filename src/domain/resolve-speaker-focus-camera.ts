import { buildDialogueSubtitleCues } from '../shared/preview/dialogue-subtitle';
import { evaluateSubtitleAtTime } from '../shared/preview/subtitle-engine';
import { solveCameraCenterForWorldPoint, type CameraView } from './camera-projection';
import { evaluateLayerMotionAtTime } from './evaluate-layer-motion';
import { evaluateShotAtTime } from './evaluate-shot-at-time';
import { evaluatedLayerWorldMatrix } from './layer-parent-space';
import type { Layer, Project, Shot, TimelineEvent } from './models';

export type { CameraView };

export const SPEAKER_FOCUS_ZOOM = 1.5;
export const SPEAKER_FOCUS_TRANSITION_MS = 250;
export const DEFAULT_AUTO_FRAMING_TARGET_U = 0.5;
export const DEFAULT_AUTO_FRAMING_TARGET_V = 0.5;

export const AUTO_FRAMING_PRESETS = {
  center: { targetU: 0.5, targetV: 0.5 },
  'left-third': { targetU: 1 / 3, targetV: 0.5 },
  'right-third': { targetU: 2 / 3, targetV: 0.5 },
} as const;

export type AutoFramingPresetId = keyof typeof AUTO_FRAMING_PRESETS;

export interface ResolvedShotAutoFraming {
  readonly zoom: number;
  readonly targetU: number;
  readonly targetV: number;
}

export function resolveShotAutoFraming(
  shot: Pick<Shot, 'camera'>,
): ResolvedShotAutoFraming {
  const configured = shot.camera?.autoFraming;
  const rawZoom = configured?.zoom;
  const rawU = configured?.targetU;
  const rawV = configured?.targetV;
  return {
    zoom: typeof rawZoom === 'number' && Number.isFinite(rawZoom)
      ? Math.max(1, rawZoom)
      : SPEAKER_FOCUS_ZOOM,
    targetU: typeof rawU === 'number' && Number.isFinite(rawU)
      ? Math.max(0, Math.min(1, rawU))
      : DEFAULT_AUTO_FRAMING_TARGET_U,
    targetV: typeof rawV === 'number' && Number.isFinite(rawV)
      ? Math.max(0, Math.min(1, rawV))
      : DEFAULT_AUTO_FRAMING_TARGET_V,
  };
}

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
  readonly project: Project;
  readonly shot: Shot;
  readonly width: number;
  readonly height: number;
  readonly full: CameraView;
  readonly autoFraming: ResolvedShotAutoFraming;
  readonly transitions: readonly CameraTransition[];
  readonly eventsByLayer: ReadonlyMap<string, readonly TimelineEvent[]>;
}

function targetAt(
  layer: Layer | null,
  atMs: number,
  { project, shot, width, height, full, autoFraming, eventsByLayer }: Omit<SpeakerFocusCameraPlan, 'transitions'>,
): CameraView {
  if (!layer) return full;
  if (
    layer.parentLayerId ||
    layer.parentKeys?.length ||
    layer.parentSpaceOffset ||
    layer.depth !== undefined ||
    layer.depthKeys?.length ||
    layer.cameraSpace
  ) {
    // Follow the inherited pose and effective depth while leaving actor and ancestor Shake on screen.
    const evaluated = evaluateShotAtTime(shot, atMs, project, { includeShake: false })
      .layers.find(({ id }) => id === layer.id);
    if (evaluated) {
      const anchor = evaluated.parentSpace
        ? evaluatedLayerWorldMatrix(evaluated)
        : { tx: evaluated.x, ty: evaluated.y };
      const solved = solveCameraCenterForWorldPoint(
        anchor.tx,
        anchor.ty,
        width,
        height,
        autoFraming.zoom,
        evaluated.effectiveDepth ?? 0,
        evaluated.effectiveCameraSpace ?? 'world',
        autoFraming.targetU,
        autoFraming.targetV,
      );
      if (!solved) return full;
      return clampCamera(
        { centerX: solved.centerX, centerY: solved.centerY, zoom: autoFraming.zoom },
        width,
        height,
      );
    }
  }
  const main = evaluateLayerMotionAtTime(
    layer,
    eventsByLayer.get(layer.id) ?? [],
    atMs,
  ).mainPosition;
  const solved = solveCameraCenterForWorldPoint(
    main.x,
    main.y,
    width,
    height,
    autoFraming.zoom,
    0,
    'world',
    autoFraming.targetU,
    autoFraming.targetV,
  );
  if (!solved) return full;
  return clampCamera(
    { centerX: solved.centerX, centerY: solved.centerY, zoom: autoFraming.zoom },
    width,
    height,
  );
}

export function prepareSpeakerFocusCamera(
  project: Project,
  shot: Shot,
): SpeakerFocusCameraPlan {
  const full = fullStageCamera(project.width, project.height);
  const autoFraming = resolveShotAutoFraming(shot);
  const cues = buildDialogueSubtitleCues(shot.dialogues);
  const dialogueById = new Map(shot.dialogues.map((dialogue) => [dialogue.id, dialogue]));
  const eventsByLayer = new Map<string, TimelineEvent[]>();
  for (const event of shot.timelineEvents) {
    const events = eventsByLayer.get(event.layerId) ?? [];
    events.push(event);
    eventsByLayer.set(event.layerId, events);
  }
  const context = { project, shot, width: project.width, height: project.height, full, autoFraming, eventsByLayer };

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
      targetAt(intent, boundary, context),
      (boundary - transitionStart) / SPEAKER_FOCUS_TRANSITION_MS,
    );
    from = viewAtBoundary;
    transitionStart = boundary;
    intent = nextIntent;
    intentId = nextIntentId;
    transitions.push({ startMs: boundary, from, layer: intent });
  }
  return { ...context, transitions };
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
      targetAt(transition.layer, timeMs, plan),
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
