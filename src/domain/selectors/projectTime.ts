import type { Project, Shot } from '../models';
import { projectDurationMs } from './projectDuration';

/**
 * A read-only position in the formal project's continuous time line.
 *
 * Shot intervals are half-open: a boundary belongs to the shot that starts at
 * that boundary. The project terminal time is kept as a useful final sample
 * on the last shot, but it is never also assigned to a following shot.
 */
export interface ProjectTimePosition {
  projectTimeMs: number;
  shot: Shot | null;
  shotIndex: number | null;
  shotStartMs: number;
  shotLocalTimeMs: number;
  totalDurationMs: number;
}

function clampProjectTime(requestedTimeMs: number, totalDurationMs: number): number {
  if (!Number.isFinite(requestedTimeMs)) return 0;
  return Math.min(
    totalDurationMs,
    Math.max(0, Math.round(requestedTimeMs)),
  );
}

/**
 * Maps one continuous project-time sample to the formal shot order.
 *
 * This is deliberately store-free so Preview and later Export can share the
 * same time meaning without importing a realtime renderer or playback loop.
 */
export function mapProjectTime(
  project: Project,
  requestedTimeMs: number,
): ProjectTimePosition {
  const totalDurationMs = Math.max(0, Math.round(projectDurationMs(project)));
  const projectTimeMs = clampProjectTime(requestedTimeMs, totalDurationMs);

  if (project.shots.length === 0) {
    return {
      projectTimeMs,
      shot: null,
      shotIndex: null,
      shotStartMs: 0,
      shotLocalTimeMs: 0,
      totalDurationMs,
    };
  }

  let shotStartMs = 0;
  for (let shotIndex = 0; shotIndex < project.shots.length; shotIndex += 1) {
    const shot = project.shots[shotIndex]!;
    const shotDurationMs = Math.max(0, Math.round(shot.durationMs));
    const shotEndMs = shotStartMs + shotDurationMs;
    const isFinalShot = shotIndex === project.shots.length - 1;

    // The final-shot clause intentionally owns the terminal sample only. For
    // every earlier shot, equality belongs to the next half-open interval.
    if (projectTimeMs < shotEndMs || isFinalShot) {
      return {
        projectTimeMs,
        shot,
        shotIndex,
        shotStartMs,
        shotLocalTimeMs: Math.min(
          shotDurationMs,
          Math.max(0, projectTimeMs - shotStartMs),
        ),
        totalDurationMs,
      };
    }

    shotStartMs = shotEndMs;
  }

  // Formal Project validation guarantees at least one valid shot reaches the
  // return above. Keep a defensive empty position for malformed test inputs.
  return {
    projectTimeMs,
    shot: null,
    shotIndex: null,
    shotStartMs: 0,
    shotLocalTimeMs: 0,
    totalDurationMs,
  };
}
