import { ProjectSchema, type Project } from '../models';
import type { TimelineEvent } from '../models/timeline-event';

/**
 * Pure function that appends the given timeline events to a shot and returns a
 * new, schema-validated project. The caller is responsible for validating the
 * events beforehand (see `validatePresetApplication`).
 */
export function applyPresetEvents(
  project: Project,
  shotId: string,
  events: readonly TimelineEvent[],
): Project {
  const shotIndex = project.shots.findIndex(
    (candidate) => candidate.id === shotId,
  );
  if (shotIndex < 0) {
    throw new Error(`找不到镜头：${shotId}`);
  }
  const shot = project.shots[shotIndex]!;
  const nextShot = {
    ...shot,
    timelineEvents: [...shot.timelineEvents, ...events],
  };
  const shots = [...project.shots];
  shots[shotIndex] = nextShot;
  return ProjectSchema.parse({ ...project, shots });
}
