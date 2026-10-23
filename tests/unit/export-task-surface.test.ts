import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ExportTaskSurface } from '../../src/renderer/shell/ExportTaskSurface';

describe('ExportTaskSurface', () => {
  it('keeps the completed result visible beside an explicit new-export action', () => {
    const markup = renderToStaticMarkup(
      createElement(ExportTaskSurface, {
        onCancel: vi.fn(),
        onHide: vi.fn(),
        onRetryCurrentContent: vi.fn(),
        onRetrySameSnapshot: vi.fn(),
        onRevealOutput: vi.fn(),
        onStartNewExport: vi.fn(),
        open: true,
        task: {
          status: 'completed',
          attemptId: 'attempt-old',
          jobId: 'job-old',
          snapshotId: 'snapshot-old',
          fileName: 'old-export.mp4',
          completedFrames: 24,
          totalFrames: 24,
          issues: [],
        },
      }),
    );

    expect(markup).toContain('old-export.mp4');
    expect(markup).toContain('\u663e\u793a\u89c6\u9891');
    expect(markup).toContain('\u5bfc\u51fa\u65b0\u7248\u672c');
  });
});
