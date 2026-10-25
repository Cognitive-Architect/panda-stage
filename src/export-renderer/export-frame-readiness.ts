import type { ExportRenderFrameRequest } from '../shared/export-types';

export interface ExportStageReadinessSnapshot {
  stageReady: boolean;
  stageError: boolean;
  stageTimeMs: number | null;
  stageShotId: string | null;
  renderToken: string | null;
  drawnRenderToken?: string | null;
}

export function exportFrameRenderToken(
  request: Pick<ExportRenderFrameRequest, 'jobId' | 'frameIndex'>,
): string {
  return `${request.jobId}:${request.frameIndex}`;
}

export function readExportStageReadiness(
  stage: Pick<HTMLElement, 'dataset'> | null,
): ExportStageReadinessSnapshot {
  const rawTimeMs = stage?.dataset.stageTime;
  const parsedTimeMs = rawTimeMs === undefined ? Number.NaN : Number(rawTimeMs);

  return {
    stageReady: stage?.dataset.stageReady === 'true',
    stageError: stage?.dataset.stageError === 'true',
    stageTimeMs: Number.isFinite(parsedTimeMs) ? parsedTimeMs : null,
    stageShotId: stage?.dataset.stageShotId || null,
    renderToken: stage?.dataset.stageRenderToken ?? null,
    drawnRenderToken: stage?.dataset.stageDrawnRenderToken ?? null,
  };
}

/** A synchronous draw completion marker must match the exact requested frame. */
export function isExactExportFrameDrawn(
  stage: ExportStageReadinessSnapshot,
  request: Pick<
    ExportRenderFrameRequest,
    'jobId' | 'frameIndex' | 'timeMs' | 'shotId' | 'shotLocalTimeMs'
  >,
): boolean {
  return (
    isExactExportFrameReady(stage, request) &&
    stage.drawnRenderToken === exportFrameRenderToken(request)
  );
}

/**
 * Export may draw a committed fallback while the requested replacement is
 * pending. Only the exact requested Stage render may cross the capture seam.
 */
export function isExactExportFrameReady(
  stage: ExportStageReadinessSnapshot,
  request: Pick<
    ExportRenderFrameRequest,
    'jobId' | 'frameIndex' | 'timeMs' | 'shotId' | 'shotLocalTimeMs'
  >,
): boolean {
  return (
    stage.stageReady &&
    !stage.stageError &&
    stage.stageTimeMs === (request.shotLocalTimeMs ?? request.timeMs) &&
    (request.shotId === undefined || stage.stageShotId === request.shotId) &&
    stage.renderToken === exportFrameRenderToken(request)
  );
}
