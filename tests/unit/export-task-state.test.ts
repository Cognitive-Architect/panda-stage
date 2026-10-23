import { describe, expect, it } from 'vitest';
import type { ExportJobUpdate } from '../../src/shared/export-types';
import type { ExportTaskState } from '../../src/renderer/shell/ExportTaskSurface';
import {
  applyExportJobUpdate,
  shouldRestoreExportTask,
  shouldShowExportFrameProgress,
} from '../../src/renderer/shell/exportTaskState';

const baseTask: ExportTaskState = {
  status: 'running',
  attemptId: '10000000-0000-4000-8000-000000000001',
  jobId: '20000000-0000-4000-8000-000000000001',
  snapshotId: '30000000-0000-4000-8000-000000000001',
  completedFrames: 8,
  totalFrames: 72,
  issues: [],
};

function update(overrides: Partial<ExportJobUpdate> = {}): ExportJobUpdate {
  return {
    jobId: baseTask.jobId!,
    attemptId: baseTask.attemptId,
    snapshotId: baseTask.snapshotId,
    status: 'running',
    phase: 'rendering',
    completedFrames: 10,
    totalFrames: 72,
    error: null,
    originalError: null,
    cleanupError: null,
    ...overrides,
  };
}

describe('export task state', () => {
  it.each(['selecting', 'preparing', 'starting', 'running', 'cancelling', 'completed', 'failed', 'cancelled'] as const)(
    'restores the existing %s task from the export entry point',
    (status) => {
      expect(shouldRestoreExportTask({ ...baseTask, status })).toBe(true);
    },
  );

  it('starts the formal export flow only when no prior task exists', () => {
    expect(
      shouldRestoreExportTask({ status: 'idle', completedFrames: 0, totalFrames: 0, issues: [] }),
    ).toBe(false);
  });

  it('ignores updates from a previous Job, Attempt, or snapshot', () => {
    expect(
      applyExportJobUpdate(baseTask, update({ jobId: '20000000-0000-4000-8000-000000000002' })),
    ).toBe(baseTask);
    expect(
      applyExportJobUpdate(baseTask, update({ attemptId: '10000000-0000-4000-8000-000000000002' })),
    ).toBe(baseTask);
    expect(
      applyExportJobUpdate(baseTask, update({ snapshotId: '30000000-0000-4000-8000-000000000002' })),
    ).toBe(baseTask);
  });

  it.each(['completed', 'failed', 'cancelled'] as const)(
    'does not revive a %s task when a late progress event arrives',
    (status) => {
      const terminal = { ...baseTask, status };
      expect(applyExportJobUpdate(terminal, update())).toBe(terminal);
    },
  );

  it('does not regress cancellation to running but accepts its terminal event', () => {
    const cancelling = { ...baseTask, status: 'cancelling' as const };
    expect(applyExportJobUpdate(cancelling, update())).toBe(cancelling);
    expect(
      applyExportJobUpdate(
        cancelling,
        update({ status: 'cancelled', phase: 'finished' }),
      ).status,
    ).toBe('cancelled');
  });

  it('keeps cleanup failure separate when no operation error exists', () => {
    const failed = applyExportJobUpdate(
      baseTask,
      update({
        status: 'failed',
        phase: 'finished',
        error: 'Cleanup failed',
        originalError: null,
        cleanupError: 'controlled file lock',
      }),
    );
    expect(failed.message).toContain('controlled file lock');
    expect(failed.message).not.toContain('null');
  });

  it.each(['encoding', 'muxing', 'probing', 'cleaning', 'committing'] as const)(
    'hides frame percentage during %s',
    (phase) => {
      expect(
        shouldShowExportFrameProgress({ ...baseTask, phase, completedFrames: 72 }),
      ).toBe(false);
    },
  );

  it.each(['rendering', 'writing'] as const)(
    'shows real frame progress during %s',
    (phase) => {
      expect(shouldShowExportFrameProgress({ ...baseTask, phase })).toBe(true);
    },
  );
});
