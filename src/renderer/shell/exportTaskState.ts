import type { ExportJobUpdate } from '../../shared/export-types';
import type { ExportTaskState } from './ExportTaskSurface';

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

export function safeExportFailureMessage(
  error: unknown,
  cleanupError?: string | null,
): string {
  const message =
    error === null || error === undefined || error === ''
      ? '\u5bfc\u51fa\u4efb\u52a1\u672a\u80fd\u5b8c\u6210'
      : error instanceof Error
        ? error.message
        : String(error);
  if (cleanupError) {
    const safeDetail = (value: string): string =>
      value
        .replace(/[\r\n\t]+/gu, ' ')
        .replace(/\s{2,}/gu, ' ')
        .replace(/[A-Za-z]:\\[^\s"'<>|]+/gu, '\u6587\u4ef6\u8def\u5f84')
        .slice(0, 180);
    return `\u5bfc\u51fa\u5931\u8d25\uff1a${safeDetail(message)}\u3002\u4e34\u65f6\u5185\u5bb9\u6e05\u7406\u4e5f\u672a\u5b8c\u6210\uff1a${safeDetail(cleanupError)}\u3002\u8bf7\u5173\u95ed\u5360\u7528\u6587\u4ef6\u6216\u76ee\u5f55\u7684\u7a0b\u5e8f\u540e\u91cd\u8bd5\u3002`;
  }
  if (/EXPORT_SNAPSHOT_UNAVAILABLE|FROZEN_MEDIA_UNAVAILABLE|FROZEN_MEDIA_CHANGED/iu.test(message)) {
    return '\u539f\u51bb\u7ed3\u5185\u5bb9\u5df2\u8fc7\u671f\u3001\u7f3a\u5931\u6216\u6821\u9a8c\u5931\u8d25\uff0c\u65e0\u6cd5\u91cd\u8bd5\u65e7\u5185\u5bb9\u3002\u8bf7\u6309\u5f53\u524d\u5185\u5bb9\u91cd\u65b0\u5bfc\u51fa\u3002';
  }
  if (/PROJECT_SESSION_CHANGED/iu.test(message)) {
    return '\u539f\u9879\u76ee\u4f1a\u8bdd\u5df2\u5173\u95ed\u6216\u5207\u6362\uff0c\u65e0\u6cd5\u4f7f\u7528\u65e7\u5185\u5bb9\u91cd\u8bd5\u3002\u6253\u5f00\u539f\u9879\u76ee\u53ef\u91cd\u8bd5\uff0c\u6216\u6309\u5f53\u524d\u5185\u5bb9\u91cd\u65b0\u5bfc\u51fa\u3002';
  }
  if (/Hidden window export modes cannot change during a Job/iu.test(message)) {
    return '\u5bfc\u51fa\u7a97\u53e3\u72b6\u6001\u672a\u5c31\u7eea\u3002\u8bf7\u91cd\u65b0\u5bfc\u51fa\uff1b\u5982\u679c\u8fde\u7eed\u5931\u8d25\uff0c\u8bf7\u91cd\u542f Panda Stage \u540e\u518d\u8bd5\u3002';
  }
  if (/Hidden window is already prepared for another Job/iu.test(message)) {
    return '\u5f53\u524d\u5df2\u6709\u5bfc\u51fa\u4efb\u52a1\u6b63\u5728\u8fdb\u884c\uff0c\u8bf7\u7b49\u5f85\u5b83\u7ed3\u675f\u540e\u518d\u91cd\u8bd5\u3002';
  }
  if (/target was created before commit/iu.test(message)) {
    return '\u4fdd\u5b58\u4f4d\u7f6e\u5728\u5bfc\u51fa\u671f\u95f4\u51fa\u73b0\u4e86\u540c\u540d\u6587\u4ef6\u3002\u73b0\u6709\u6587\u4ef6\u672a\u88ab\u4fee\u6539\uff0c\u8bf7\u6362\u4e00\u4e2a\u65b0\u6587\u4ef6\u540d\u91cd\u8bd5\u3002';
  }
  if (/local NTFS|volume could not be verified|unsupported volume/iu.test(message)) {
    return '\u6b63\u5f0f MP4 仅\u80fd\u5bfc\u51fa\u5230 Windows \u672c\u673a NTFS \u6587\u4ef6\u5939\u3002\u8bf7\u9009\u62e9\u672c\u673a NTFS \u4f4d\u7f6e\u540e\u91cd\u8bd5\u3002';
  }
  if (/OUTPUT_TARGET_CHANGED|target changed|already exists|overwrite/iu.test(message)) {
    return '\u5bfc\u51fa\u4f4d\u7f6e\u5df2\u53d1\u751f\u53d8\u5316\u3002\u8bf7\u53e6\u9009\u4e00\u4e2a\u4fdd\u5b58\u4f4d\u7f6e\u540e\u91cd\u8bd5\u3002';
  }
  if (/OUTPUT_NOT_WRITABLE|permission|access is denied/iu.test(message)) {
    return '\u65e0\u6cd5\u5199\u5165\u8fd9\u4e2a\u4f4d\u7f6e\u3002\u8bf7\u9009\u62e9\u53ef\u5199\u5165\u7684\u6587\u4ef6\u5939\u540e\u91cd\u8bd5\u3002';
  }
  if (/frame budget|duration exceeds/iu.test(message)) {
    return '\u9879\u76ee\u603b\u65f6\u957f\u8d85\u51fa\u5f53\u524d\u5bfc\u51fa\u9650\u5236\u3002\u8bf7\u7f29\u77ed\u5de5\u7a0b\u603b\u65f6\u957f\u540e\u91cd\u8bd5\u3002';
  }
  const detail = message
    .replace(/\s*\u4e0b\u4e00\u6b65[:：].*$/u, '')
    .replace(/[\r\n\t]+/gu, ' ')
    .replace(/\s{2,}/gu, ' ')
    .replace(/[A-Za-z]:\\[^\s"'<>|]+/gu, '\u6587\u4ef6\u8def\u5f84')
    .slice(0, 240);
  return detail
    ? `\u5bfc\u51fa\u5931\u8d25\uff1a${detail}\u3002\u8bf7\u68c0\u67e5\u8f93\u5165\u8def\u5f84\u548c\u5a92\u4f53\u5de5\u5177\u540e\u91cd\u8bd5\u3002`
    : '\u5bfc\u51fa\u672a\u5b8c\u6210\u3002\u53ef\u4ee5\u91cd\u8bd5\u539f\u5185\u5bb9\uff0c\u6216\u6309\u5f53\u524d\u5185\u5bb9\u91cd\u65b0\u5bfc\u51fa\u3002';
}

export function applyExportJobUpdate(
  current: ExportTaskState,
  update: ExportJobUpdate,
): ExportTaskState {
  if (current.jobId !== update.jobId) return current;
  if (update.attemptId && current.attemptId !== update.attemptId) return current;
  if (update.snapshotId && current.snapshotId !== update.snapshotId) return current;
  if (TERMINAL_STATUSES.has(current.status)) return current;
  if (current.status === 'cancelling' && update.status === 'running') {
    return current;
  }
  return {
    ...current,
    status: update.status,
    phase: update.phase,
    completedFrames: update.completedFrames,
    totalFrames: update.totalFrames,
    message:
      update.status === 'failed'
        ? safeExportFailureMessage(
            update.originalError === undefined
              ? update.error
              : update.originalError,
            update.cleanupError,
          )
        : update.status === 'cancelled'
          ? '\u5bfc\u51fa\u5df2\u53d6\u6d88\u5e76\u5b8c\u6210\u4e34\u65f6\u5185\u5bb9\u6e05\u7406\u3002'
          : undefined,
  };
}

export function shouldShowExportFrameProgress(task: ExportTaskState): boolean {
  const active = [
    'selecting',
    'preparing',
    'starting',
    'running',
    'cancelling',
  ].includes(task.status);
  return (
    active &&
    (task.phase === 'rendering' || task.phase === 'writing') &&
    task.totalFrames > 0
  );
}

export function shouldRestoreExportTask(task: ExportTaskState): boolean {
  return task.status !== 'idle';
}
