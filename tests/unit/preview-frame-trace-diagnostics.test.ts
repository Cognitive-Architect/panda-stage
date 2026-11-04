import { describe, expect, it, vi } from 'vitest';
import {
  getPreviewFrameTraceStatus,
  previewFrameDiagnosticsEnabled,
  recordPreviewFrameTrace,
  resetPreviewFrameTraceRecorderForTests,
  type PreviewFrameTraceContext,
} from '../../src/renderer/stage/previewDiagnostics';

const traceContext: PreviewFrameTraceContext = {
  traceId: 'synthetic-instance:g1:s0:c0:f0',
  instanceId: 'synthetic-instance',
  playbackGeneration: 1,
  seekGeneration: 0,
  targetEpoch: 1,
  shotId: 'synthetic-shot',
  shotTimeMs: 0,
  cycleIndex: 0,
  frameIndex: 0,
  targetFrameId: 'synthetic-animation:frame-0',
  targetAssetId: 'synthetic-asset-0',
  requestedAt: 0,
};

describe('Preview frame trace diagnostics', () => {
  it('stays disabled unless the diagnostic sink explicitly opts in', () => {
    const record = vi.fn();
    vi.stubGlobal('window', {
      __pandaPreviewDiagnostics: { record },
    } as unknown as Window);
    resetPreviewFrameTraceRecorderForTests();
    try {
      expect(previewFrameDiagnosticsEnabled()).toBe(false);
      recordPreviewFrameTrace('target-changed', traceContext, {
        status: 'PENDING',
      });
      expect(record).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps a child-first target commit terminal when the parent later reports the same target', () => {
    const events: string[] = [];
    vi.stubGlobal('window', {
      __pandaPreviewDiagnostics: {
        frameTraceEnabled: true,
        record(event: string) {
          events.push(event);
        },
      },
    } as unknown as Window);
    resetPreviewFrameTraceRecorderForTests();
    try {
      recordPreviewFrameTrace('target-changed', traceContext, {
        status: 'PENDING',
        requestBoundary: 'StageRenderer-rendered-target',
      });
      recordPreviewFrameTrace('exact-ready-commit', traceContext, {
        status: 'COMMITTED',
        displayedFrameId: traceContext.targetFrameId,
      });
      recordPreviewFrameTrace('target-changed', traceContext, {
        status: 'PENDING',
        requestBoundary: 'ProductPreviewOverlay-evaluated-target',
      });

      expect(events.filter((event) => event === 'frame-trace:target-changed')).toHaveLength(1);
      expect(getPreviewFrameTraceStatus(traceContext.traceId)).toBe('COMMITTED');
    } finally {
      vi.unstubAllGlobals();
      resetPreviewFrameTraceRecorderForTests();
    }
  });
});
