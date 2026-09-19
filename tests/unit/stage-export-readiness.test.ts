import { describe, expect, it } from 'vitest';
import {
  exportFrameRenderToken,
  isExactExportFrameReady,
  readExportStageReadiness,
} from '../../src/export-renderer/export-frame-readiness';
import type { ExportRenderFrameRequest } from '../../src/shared/export-types';

const requestA: ExportRenderFrameRequest = {
  jobId: '57100000-0000-4000-8000-000000000901',
  frameIndex: 11,
  timeMs: 458,
};
const requestB: ExportRenderFrameRequest = {
  ...requestA,
  frameIndex: 12,
  timeMs: 500,
};

describe('hidden Export exact frame readiness', () => {
  it('does not capture drawable fallback A and captures only committed requested frame B', () => {
    const sentFrames: ExportRenderFrameRequest[] = [];
    const tryCapture = (stage: ReturnType<typeof readExportStageReadiness>) => {
      if (isExactExportFrameReady(stage, requestB)) {
        sentFrames.push(requestB);
      }
    };

    // Frame A remains drawable while B is pending, but it is not an exact B
    // readiness signal and therefore cannot cross the hidden Export seam.
    tryCapture({
      stageReady: false,
      stageError: false,
      stageTimeMs: requestA.timeMs,
      renderToken: exportFrameRenderToken(requestA),
    });
    expect(sentFrames).toEqual([]);

    // Even a stale ready callback for A cannot capture B when both frames
    // happen to have the same time; the render token identifies the request.
    tryCapture({
      stageReady: true,
      stageError: false,
      stageTimeMs: requestB.timeMs,
      renderToken: exportFrameRenderToken(requestA),
    });
    expect(sentFrames).toEqual([]);

    // Only after B commits may the hidden renderer send B.
    tryCapture({
      stageReady: true,
      stageError: false,
      stageTimeMs: requestB.timeMs,
      renderToken: exportFrameRenderToken(requestB),
    });
    expect(sentFrames).toEqual([requestB]);
  });

  it('reads the Stage DOM contract without treating fallback time as readiness', () => {
    const stage = {
      dataset: {
        stageReady: 'false',
        stageError: 'false',
        stageTime: String(requestA.timeMs),
        stageRenderToken: exportFrameRenderToken(requestA),
      },
    } as unknown as HTMLElement;

    expect(isExactExportFrameReady(readExportStageReadiness(stage), requestB)).toBe(
      false,
    );
  });
});
