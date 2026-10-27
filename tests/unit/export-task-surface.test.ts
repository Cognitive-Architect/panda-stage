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
    expect(markup).toContain('data-testid="export-task-title"');
    expect(markup).not.toContain('export-task-result-spinner');
    expect(markup).not.toContain('export-task-indeterminate');
    expect(markup).not.toContain('<progress');
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
    expect(markup).toContain('>\u5bfc\u51fa\u5b8c\u6210</h2>');
    expect(markup).toContain('export-task-result-icon-complete');
    expect(markup).toContain('\u5728\u6587\u4ef6\u5939\u4e2d\u663e\u793a');
    expect(markup).toContain('\u518d\u6b21\u5bfc\u51fa');
    expect(markup).not.toContain('class="export-task-check"');
    expect(markup).not.toContain('class="export-task-status"');
    expect(markup).not.toContain('data-testid="export-support-summary"');
  });

  it('keeps the failure reason with recovery actions when the frozen snapshot is unavailable', () => {
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
          message: '\u539f\u51bb\u7ed3\u5185\u5bb9\u5df2\u8fc7\u671f\uff0c\u65e0\u6cd5\u91cd\u8bd5\u65e7\u5185\u5bb9\u3002\u8bf7\u6309\u5f53\u524d\u5185\u5bb9\u91cd\u65b0\u5bfc\u51fa\u3002',
          completedFrames: 4,
          totalFrames: 4,
          issues: [],
        },
      }),
    );

    expect(markup).toContain('>\u5bfc\u51fa\u89c6\u9891</h2>');
    expect(markup).toContain('export-task-result-icon-failed');
    expect(markup).toContain('\u539f\u51bb\u7ed3\u5185\u5bb9\u5df2\u8fc7\u671f');
    expect(markup).not.toContain('class="export-task-message"');
    expect(markup).not.toContain('\u9009\u62e9\u4f4d\u7f6e\uff0c\u91cd\u8bd5\u539f\u5185\u5bb9');
    expect(markup).toContain('\u6309\u5f53\u524d\u5185\u5bb9\u91cd\u65b0\u5bfc\u51fa');
  });

  it('does not repeat a failure reason already shown in the actionable issue details', () => {
    const reason = '\u8f93\u51fa\u6587\u4ef6\u5df2\u5b58\u5728\uff0c\u6b63\u5f0f\u5bfc\u51fa\u4e0d\u4f1a\u8986\u76d6\u73b0\u6709 MP4\u3002';
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
          message: reason,
          completedFrames: 0,
          totalFrames: 0,
          issues: [
            {
              location: '\u8f93\u51fa\u4f4d\u7f6e',
              problem: reason,
              nextStep: '\u8bf7\u9009\u62e9\u4e00\u4e2a\u5c1a\u672a\u5b58\u5728\u7684\u65b0\u6587\u4ef6\u540d\u3002',
            },
          ],
        },
      }),
    );

    expect(markup.split(reason).length - 1).toBe(1);
    expect(markup).toContain('\u5bfc\u51fa\u672a\u5b8c\u6210');
    expect(markup).toContain('\u8bf7\u9009\u62e9\u4e00\u4e2a\u5c1a\u672a\u5b58\u5728\u7684\u65b0\u6587\u4ef6\u540d');
  });

  it('announces cancellation after cleanup and keeps retry beside the task', () => {
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
          status: 'cancelled',
          message: '\u5bfc\u51fa\u5df2\u53d6\u6d88\u5e76\u5b8c\u6210\u4e34\u65f6\u5185\u5bb9\u6e05\u7406\u3002',
          completedFrames: 3,
          totalFrames: 12,
          issues: [],
        },
      }),
    );

    expect(markup).toContain('>\u5bfc\u51fa\u89c6\u9891</h2>');
    expect(markup).toContain('export-task-result-icon-cancelled');
    expect(markup).toContain('\u5b8c\u6210\u4e34\u65f6\u5185\u5bb9\u6e05\u7406');
    expect(markup).toContain('\u6309\u5f53\u524d\u5185\u5bb9\u91cd\u65b0\u5bfc\u51fa');
    expect(markup).not.toContain('class="export-task-progress"');
  });

  it('shows frame copy and the real count together above the determinate bar', () => {
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
    expect(markup).toContain('\u6b63\u5728\u7ed8\u5236\u753b\u9762');
    expect(markup.indexOf('class="export-task-status"')).toBeLessThan(
      markup.indexOf('class="export-task-progress-count"'),
    );
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
    expect(markup).toContain('\u6b63\u5728\u5408\u6210\u89c6\u9891');
    expect(markup).not.toContain('25 / 25');
    expect(markup).not.toContain('100%');
  });

  it('keeps the complete filename available to assistive technology and pointer users', () => {
    const fileName = `${'long-export-name-'.repeat(6)}final.mp4`;
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
          fileName,
          completedFrames: 12,
          totalFrames: 12,
          issues: [],
        },
      }),
    );

    expect(markup).toContain(`title="${fileName}"`);
    expect(markup).toContain(`aria-label="\u5bfc\u51fa\u6587\u4ef6\uff1a${fileName}"`);
  });
});
