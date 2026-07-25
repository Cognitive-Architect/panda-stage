import type { Project } from '../models';

export function projectDurationMs(project: Project): number {
  return project.shots.reduce(
    (total, shot) => total + shot.durationMs,
    0,
  );
}
