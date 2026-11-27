import type { Project } from '../../../domain';

export interface ShotCameraCurveDraft {
  project: Project;
  projectInstanceId: number | null;
  revision: number;
  shotId: string;
  keyTimeMs: number;
  timeMs: number;
}

export function resolveActiveShotCameraCurveDraft(
  draft: ShotCameraCurveDraft | null | undefined,
  context: {
    projectInstanceId: number | null;
    revision: number | undefined;
    shotId: string | null;
    blocked?: boolean;
  },
): ShotCameraCurveDraft | null {
  if (!draft || context.blocked) return null;
  if (
    draft.projectInstanceId !== context.projectInstanceId ||
    draft.revision !== context.revision ||
    draft.shotId !== context.shotId
  ) {
    return null;
  }
  return draft;
}
