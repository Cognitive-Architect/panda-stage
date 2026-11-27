import {
  evaluateShotAtTime,
  normalizeShotTimeMs,
  projectShotDialogueVisual,
  resolveExportFrameAuthoringTime,
  type EvaluatedShot,
  type Project,
  type Shot,
} from '../domain';

import type { DialogueSilence } from '../shared/dialogue-silence';
import { evaluateSubtitleAtTime, type SubtitleCue } from '../shared/preview/subtitle-engine';

export interface ExportFrameEvaluation {
  readonly subtitle: SubtitleCue | null;
  readonly evaluatedShot: EvaluatedShot;
}

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

/**
 * Evaluates a formal export frame in a single Shot evaluation pass:
 * normalizes `requestedTimeMs` purely for subtitle selection, then runs the
 * formal authoring-clock Shot evaluation + dialogue projection + draw filter.
 */
export function evaluateFormalExportFrame(
  project: Project,
  shot: Shot,
  requestedTimeMs: number,
  subtitleCues: readonly SubtitleCue[],
  dialogueSilence?: DialogueSilence,
  outputLayerId?: string,
): ExportFrameEvaluation {
  const subtitle = evaluateSubtitleAtTime(
    subtitleCues,
    normalizeShotTimeMs(requestedTimeMs, shot.durationMs),
  );
  const evaluatedShot = selectExportDrawingLayers(
    evaluateExportShotAtTime(
      project,
      shot,
      requestedTimeMs,
      subtitle?.id ?? null,
      dialogueSilence,
      outputLayerId,
    ),
  );
  return { subtitle, evaluatedShot };
}

/** Apply the draw filter only after layer inheritance and dialogue evaluation. */
export function selectExportDrawingLayers(shot: EvaluatedShot): EvaluatedShot {
  return { ...shot, layers: shot.layers.filter(({ visible, control }) => visible && !control) };
}
