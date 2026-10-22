import {
  evaluateShotAtTime,
  projectShotDialogueVisual,
  type EvaluatedShot,
  type Project,
  type Shot,
} from '../domain';

/** The hidden Export renderer's requested-time Dialogue projection. */
export function evaluateExportShotAtTime(
  project: Project,
  shot: Shot,
  requestedTimeMs: number,
): EvaluatedShot {
  return projectShotDialogueVisual(
    project,
    shot,
    evaluateShotAtTime(shot, requestedTimeMs, project),
  );
}
