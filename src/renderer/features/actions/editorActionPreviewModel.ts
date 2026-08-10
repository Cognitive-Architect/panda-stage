import {
  evaluateShotAtTime,
  type Project,
  type Shot,
  type TimelineEvent,
} from '../../../domain';

export interface EditorActionPreviewIdentity {
  projectId: string | null;
  shotId: string | null;
  layerId: string | null;
}

export interface EditorActionPreviewSession {
  projectId: string;
  shotId: string;
  layerId: string;
  /** First millisecond the applied action becomes visible. */
  startMs: number;
  /** Last millisecond the applied action is still in effect. */
  endMs: number;
}

/**
 * Reuses the FORMAL project evaluator to produce the preview frame at a given
 * time. There is deliberately no preview-only evaluation here: this is the same
 * `evaluateShotAtTime` that drives Product Preview and Export, so the editor
 * preview can never silently diverge from the real render.
 */
export function evaluatePreviewFrame(
  project: Project,
  shot: Shot,
  timeMs: number,
): ReturnType<typeof evaluateShotAtTime> {
  return evaluateShotAtTime(shot, timeMs, project);
}

/** True only when the live editor identity still matches the preview session. */
export function isPreviewIdentityMatch(
  session: EditorActionPreviewSession,
  identity: EditorActionPreviewIdentity,
): boolean {
  return (
    identity.projectId === session.projectId &&
    identity.shotId === session.shotId &&
    identity.layerId === session.layerId
  );
}

/**
 * Computes the bounded `[startMs, endMs]` window covering every newly added
 * timeline event. Used by the apply bridge to size the preview to exactly the
 * action that was just applied (and nothing else).
 */
export function previewWindowFromEvents(
  events: readonly TimelineEvent[],
): { startMs: number; endMs: number } | null {
  if (events.length === 0) return null;
  let startMs = Infinity;
  let endMs = -Infinity;
  for (const event of events) {
    if (event.startMs < startMs) startMs = event.startMs;
    if (event.endMs > endMs) endMs = event.endMs;
  }
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  return { startMs, endMs };
}
