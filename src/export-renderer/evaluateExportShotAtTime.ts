import {
  evaluateShotAtTime,
  projectShotDialogueVisual,
  resolveExportFrameAuthoringTime,
  type EvaluatedShot,
  type Project,
  type Shot,
} from '../domain';

import type { DialogueSilence } from '../shared/dialogue-silence';

/** The hidden Export renderer's requested-time Dialogue projection. */
export function evaluateExportShotAtTime(
  project: Project,
  shot: Shot,
  requestedTimeMs: number,
  activeDialogueId?: string | null,
  dialogueSilence?: DialogueSilence,
  outputLayerId?: string,
): EvaluatedShot {
  const visual = projectShotDialogueVisual(
    project,
    shot,
    evaluateShotAtTime(shot, requestedTimeMs, project, {
      graphicFrameTimeMs: resolveExportFrameAuthoringTime(requestedTimeMs, shot.durationMs),
    }),
    activeDialogueId,
    dialogueSilence,
  );
  return outputLayerId ? {
    ...visual,
    backgroundLayerId: null,
    layers: visual.layers.filter(({ id }) => id === outputLayerId),
  } : visual;
}

/** Apply the draw filter only after layer inheritance and dialogue evaluation. */
export function selectExportDrawingLayers(shot: EvaluatedShot): EvaluatedShot {
  return { ...shot, layers: shot.layers.filter(({ visible }) => visible) };
}
