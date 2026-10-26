import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ExportTaskSurface } from '../../src/renderer/shell/ExportTaskSurface';

describe('ExportTaskSurface', () => {
  it('keeps the normal preparing state short without the support profile summary', () => {
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
          status: 'preparing',
          completedFrames: 0,
          totalFrames: 0,
          issues: [],
        },
      }),
    );

    expect(markup).not.toContain('data-testid="export-support-summary"');
    expect(markup).not.toContain('MP3/WAV');
    expect(markup).toContain('\u6b63\u5728\u68c0\u67e5\u9879\u76ee');
  });

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
    expect(markup).toContain('\u5728\u6587\u4ef6\u5939\u4e2d\u663e\u793a');
    expect(markup).toContain('\u518d\u6b21\u5bfc\u51fa');
    expect(markup).not.toContain('data-testid="export-support-summary"');
  });

  it('shows only the current-content retry when the frozen snapshot is unavailable', () => {
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
          status: 'failed',
          snapshotId: 'snapshot-expired',
          snapshotRetryAvailable: false,
          completedFrames: 4,
          totalFrames: 4,
          issues: [],
        },
      }),
    );

    expect(markup).not.toContain('\u9009\u62e9\u4f4d\u7f6e\uff0c\u91cd\u8bd5\u539f\u5185\u5bb9');
    expect(markup).toContain('\u6309\u5f53\u524d\u5185\u5bb9\u91cd\u65b0\u5bfc\u51fa');
  });

  it('shows a determinate frame count only when the real total is known', () => {
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
          status: 'running',
          phase: 'rendering',
          completedFrames: 5,
          totalFrames: 25,
          issues: [],
        },
      }),
    );

    expect(markup).toContain('5 / 25 帧 · 20%');
    expect(markup).not.toContain('export-task-indeterminate');
  });

  it('uses an indeterminate progress pulse during encoding', () => {
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
          status: 'running',
          phase: 'encoding',
          completedFrames: 25,
          totalFrames: 25,
          issues: [],
        },
      }),
    );

    expect(markup).toContain('class="export-task-indeterminate"');
    expect(markup).toContain('role="progressbar"');
    expect(markup).not.toContain('25 / 25');
    expect(markup).not.toContain('100%');
  });
});
