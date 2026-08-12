import {
  evaluateShotAtTime,
  type EvaluatedShot,
  type Project,
  type Shot,
  type TimelineEvent,
} from '../../../domain';
import type { StageAssetUrlMap } from '../../../shared/stage/render-model';

export interface EditorActionPreviewIdentity {
  projectId: string | null;
  shotId: string | null;
  layerId: string | null;
}

export interface EditorActionPreviewPositionBaseline {
  x: number;
  y: number;
}

export interface EditorActionPreviewSession {
  projectId: string;
  shotId: string;
  layerId: string;
  /** First millisecond the applied action becomes visible. */
  startMs: number;
  /** Last millisecond the applied action is still in effect. */
  endMs: number;
  /** Exact events appended by the apply that started this preview. */
  eventIds?: readonly string[];
  /**
   * The position visible in the normal editor render path when the action was
   * applied. This is transient preview context, never project data.
   */
  positionBaseline?: EditorActionPreviewPositionBaseline;
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
  session?: EditorActionPreviewSession,
): ReturnType<typeof evaluateShotAtTime> {
  return evaluateShotAtTime(
    session?.positionBaseline && session.eventIds?.length
      ? withPreviewPositionBaseline(shot, session)
      : shot,
    timeMs,
    project,
  );
}

/**
 * Inserts a transient, deterministic position baseline into a preview-only
 * shot copy. The formal evaluator still does all frame evaluation; this only
 * makes the event-conflict boundary explicit for the newly applied action.
 *
 * Historical position events stay in the project and remain available to the
 * normal editor/product/export paths. They are ordered before the baseline,
 * while the exact newly-added events are ordered after it, so Scale/Shake
 * samples start from the position the editor was visibly showing.
 */
function withPreviewPositionBaseline(
  shot: Shot,
  session: EditorActionPreviewSession,
): Shot {
  const eventIds = session.eventIds;
  const baseline = session.positionBaseline;
  if (!eventIds?.length || !baseline) return shot;

  const previewEventIdSet = new Set(eventIds);
  const historicalEvents = shot.timelineEvents.filter(
    (event) => !previewEventIdSet.has(event.id),
  );
  const previewEvents = shot.timelineEvents.filter((event) =>
    previewEventIdSet.has(event.id),
  );
  if (previewEvents.length === 0) return shot;

  // This event exists only in the cloned Shot passed to evaluateShotAtTime;
  // it is never validated into or appended to the persisted project.
  const transientBaseline: TimelineEvent = {
    id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    layerId: session.layerId,
    startMs: session.startMs,
    endMs: session.endMs,
    type: 'move',
    from: { x: baseline.x, y: baseline.y },
    to: { x: baseline.x, y: baseline.y },
    easing: 'linear',
  };

  return {
    ...shot,
    timelineEvents: [...historicalEvents, transientBaseline, ...previewEvents],
  };
}

/**
 * Issue #168 (A): true only when every asset the evaluated frame needs already
 * has a loadable URL.
 *
 * The formal render model refuses to build a partial scene: the first layer
 * whose asset has no URL makes it throw `MISSING_ASSET_URL`, which the formal
 * `StageRenderer` surfaces as the full-bleed red `舞台无法渲染` state. The
 * overlay's asset map is filled asynchronously and the overlay is unmounted on
 * `stop()`/`finish()`, so that map restarts **empty** on every `start` and every
 * `replay`. Without this gate the preview therefore paints at least one invalid
 * frame at the beginning of every session.
 *
 * Gating on this predicate keeps the preview strictly bounded: while the scene
 * is not renderable the overlay renders nothing and the ordinary editor render
 * path stays on screen, which is the same "no residue" behaviour the overlay
 * already guarantees when the session ends.
 */
export function isPreviewSceneRenderable(
  evaluatedShot: EvaluatedShot,
  assetUrls: StageAssetUrlMap,
): boolean {
  if (evaluatedShot.layers.length === 0) {
    return false;
  }
  return evaluatedShot.layers.every((layer) =>
    Boolean(assetUrls[layer.assetId]),
  );
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

/**
 * Resolves the position around which a non-move action previews at its
 * persisted sequential boundary. Ordinarily this is the formal evaluator's
 * settled position. The static editor position remains the compatibility
 * fallback only when retained position events already overlap each other —
 * the legacy conflict isolated by Issue #174.
 */
export function resolvePreviewPositionBaseline(
  project: Project,
  shot: Shot,
  layerId: string,
  startMs: number,
  newEventIds: readonly string[],
): EditorActionPreviewPositionBaseline | null {
  const layer = shot.layers.find((candidate) => candidate.id === layerId);
  if (!layer) return null;

  const newEventIdSet = new Set(newEventIds);
  const retainedPositionEvents = shot.timelineEvents.filter(
    (event) =>
      event.layerId === layerId &&
      !newEventIdSet.has(event.id) &&
      (event.type === 'move' || event.type === 'shake'),
  );
  const hasLegacyPositionOverlap = retainedPositionEvents.some(
    (event, index) =>
      retainedPositionEvents.slice(index + 1).some(
        (candidate) =>
          event.startMs < candidate.endMs &&
          candidate.startMs < event.endMs,
      ),
  );
  if (hasLegacyPositionOverlap) {
    return { x: layer.x, y: layer.y };
  }

  const evaluatedLayer = evaluateShotAtTime(shot, startMs, project).layers.find(
    (candidate) => candidate.id === layerId,
  );
  return evaluatedLayer
    ? { x: evaluatedLayer.x, y: evaluatedLayer.y }
    : { x: layer.x, y: layer.y };
}
