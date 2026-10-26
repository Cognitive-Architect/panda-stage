import {
  AlertTriangle,
  Check,
  ChevronDown,
  Clapperboard,
  FolderOpen,
  LoaderCircle,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { Button, IconButton, PanelSurface } from '../ui';
import type { ExportJobPhase } from '../../shared/export-types';
import type { ExportPreparationCameraMode } from '../../shared/export-preparation-types';
import { shouldShowExportFrameProgress } from './exportTaskState';

export type ExportTaskStatus =
  | 'idle'
  | 'selecting'
  | 'preparing'
  | 'starting'
  | 'running'
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface ExportTaskIssueView {
  location: string;
  problem: string;
  nextStep: string;
}

export interface ExportTaskState {
  status: ExportTaskStatus;
  attemptId?: string;
  jobId?: string;
  snapshotId?: string;
  projectId?: string;
  openInstanceId?: number;
  fileName?: string;
  projectRoot?: string;
  durationMs?: number;
  cameraMode?: ExportPreparationCameraMode;
  snapshotRetryAvailable?: boolean;
  phase?: ExportJobPhase;
  completedFrames: number;
  totalFrames: number;
  message?: string;
  issues: ExportTaskIssueView[];
}

interface ExportTaskSurfaceProps {
  task: ExportTaskState;
  open: boolean;
  onHide(): void;
  onCancel(): void;
  onRetrySameSnapshot(): void;
  onRetryCurrentContent(): void;
  onStartNewExport(): void;
  onRevealOutput(): void;
}

const STATUS_COPY: Record<ExportTaskStatus, string> = {
  idle: '',
  selecting: '\u6b63\u5728\u9009\u62e9\u4fdd\u5b58\u4f4d\u7f6e\u2026',
  preparing: '\u6b63\u5728\u68c0\u67e5\u9879\u76ee\u955c\u5934\u548c\u7d20\u6750\u2026',
  starting: '\u6b63\u5728\u51c6\u5907\u5bfc\u51fa\u2026',
  running: '\u6b63\u5728\u5bfc\u51fa\u2026',
  cancelling: '\u6b63\u5728\u5b89\u5168\u53d6\u6d88\u2026',
  completed: '\u89c6\u9891\u5df2\u5bfc\u51fa',
  failed: '\u5bfc\u51fa\u672a\u5b8c\u6210',
  cancelled: '\u5bfc\u51fa\u5df2\u53d6\u6d88',
};

function phaseCopy(phase?: ExportJobPhase): string {
  switch (phase) {
    case 'rendering':
    case 'writing':
      return '\u6b63\u5728\u7ed8\u5236\u753b\u9762';
    case 'preparing':
      return '\u6b63\u5728\u51c6\u5907\u9879\u76ee\u548c\u7d20\u6750';
    case 'encoding':
      return '\u6b63\u5728\u5408\u6210\u89c6\u9891';
    case 'muxing':
      return '\u6b63\u5728\u6df7\u5408\u58f0\u97f3';
    case 'probing':
      return '\u6b63\u5728\u68c0\u67e5\u5bfc\u51fa\u7ed3\u679c';
    case 'committing':
      return '\u6b63\u5728\u4fdd\u5b58\u89c6\u9891\uff0c\u6b64\u523b\u65e0\u6cd5\u53d6\u6d88';
    case 'cleaning':
      return '\u6b63\u5728\u6e05\u7406\u4e34\u65f6\u5185\u5bb9';
    default:
      return STATUS_COPY.running;
  }
}

export function ExportTaskSurface({
  task,
  open,
  onHide,
  onCancel,
  onRetrySameSnapshot,
  onRetryCurrentContent,
  onStartNewExport,
  onRevealOutput,
}: ExportTaskSurfaceProps): React.JSX.Element | null {
  if (!open) return null;
  const progress =
    task.totalFrames > 0
      ? Math.min(100, Math.floor((task.completedFrames / task.totalFrames) * 100))
      : 0;
  const canCancelPreparation = task.status === 'preparing' && task.attemptId;
  const canCancelExport =
    (task.status === 'running' || task.status === 'cancelling') &&
    task.phase !== 'committing';
  const hasFrameProgress = shouldShowExportFrameProgress(task);
  const isCompleted = task.status === 'completed';
  const isFailed = task.status === 'failed';
  const isCancelled = task.status === 'cancelled';
  const failureReasonIsListed =
    isFailed &&
    Boolean(task.message) &&
    task.issues.some((issue) => issue.problem.trim() === task.message?.trim());
  const title = isCompleted
    ? '\u5bfc\u51fa\u5b8c\u6210'
    : '\u5bfc\u51fa\u89c6\u9891';
  const statusText =
    task.status === 'running'
      ? phaseCopy(task.phase)
      : isFailed
        ? failureReasonIsListed
          ? STATUS_COPY.failed
          : task.message ?? ''
        : isCancelled
          ? task.message ?? ''
        : STATUS_COPY[task.status];
  const statusKey = `${task.status}-${task.phase ?? ''}-${statusText}`;
  const showMessage = Boolean(task.message) && !isFailed && !isCancelled;

  return (
    <aside
      aria-label={'\u5bfc\u51fa\u89c6\u9891\u4efb\u52a1'}
      className="export-task-surface"
      data-task-status={task.status}
      data-task-phase={task.phase ?? ''}
      data-testid="export-task-surface"
    >
      <PanelSurface className="export-task-panel">
        <header className="export-task-header">
          <div className="export-task-heading">
            <span
              aria-hidden="true"
              className={`export-task-result-icon${
                isCompleted
                  ? ' export-task-result-icon-complete'
                  : isFailed
                    ? ' export-task-result-icon-failed'
                    : isCancelled
                      ? ' export-task-result-icon-cancelled'
                      : task.status === 'running' || task.status === 'cancelling'
                        ? ' export-task-result-icon-running'
                        : ''
              }`}
            >
              {isCompleted ? (
                <Check focusable="false" size={18} />
              ) : isFailed ? (
                <AlertTriangle focusable="false" size={18} />
              ) : isCancelled ? (
                <XCircle focusable="false" size={18} />
              ) : task.status === 'running' || task.status === 'cancelling' ? (
                <LoaderCircle
                  className="export-task-result-spinner"
                  focusable="false"
                  size={18}
                />
              ) : (
                <Clapperboard focusable="false" size={18} />
              )}
            </span>
            <div className="export-task-heading-copy">
              <h2
                aria-live={isCompleted || isFailed || isCancelled ? 'polite' : undefined}
                data-testid="export-task-title"
              >
                {title}
              </h2>
              {task.fileName ? (
                <p
                  aria-label={`\u5bfc\u51fa\u6587\u4ef6\uff1a${task.fileName}`}
                  className="export-task-file-name"
                  title={task.fileName}
                >
                  {task.fileName}
                </p>
              ) : null}
            </div>
          </div>
          <IconButton
            aria-label={'\u6536\u8d77\u5bfc\u51fa\u4efb\u52a1'}
            className="export-task-hide"
            icon={<ChevronDown aria-hidden="true" size={18} />}
            onClick={onHide}
            title={'\u6536\u8d77'}
            variant="secondary"
          />
        </header>

        {hasFrameProgress ? (
          <div className="export-task-progress">
            <span
              key={statusKey}
              aria-live="polite"
              className="export-task-status"
              role="status"
            >
              {statusText}
            </span>
            <span className="export-task-progress-count">
              {task.completedFrames.toLocaleString()} /{' '}
              {task.totalFrames.toLocaleString()} 帧 · {progress}%
            </span>
            <progress
              aria-label={'\u5bfc\u51fa\u8fdb\u5ea6'}
              max={task.totalFrames}
              value={Math.min(task.completedFrames, task.totalFrames)}
            />
          </div>
        ) : null}

        {!hasFrameProgress && !isCompleted && statusText ? (
          <div
            key={statusKey}
            aria-live="polite"
            className="export-task-status"
            role="status"
          >
            {statusText}
          </div>
        ) : null}

        {task.status === 'running' && !hasFrameProgress ? (
          <div
            aria-label={phaseCopy(task.phase)}
            className="export-task-indeterminate"
            role="progressbar"
          />
        ) : null}

        {task.issues.length > 0 ? (
          <ul className="export-task-issues">
            {task.issues.map((issue, index) => (
              <li key={`${issue.location}-${index}`}>
                <strong>{issue.location}</strong>
                <span>{issue.problem}</span>
                <small>{issue.nextStep}</small>
              </li>
            ))}
          </ul>
        ) : null}

        {showMessage && task.message ? (
          <p className="export-task-message">{task.message}</p>
        ) : null}

        {canCancelPreparation ||
        canCancelExport ||
        isCompleted ||
        isFailed ||
        isCancelled ? (
          <div className="export-task-actions">
            {canCancelPreparation || canCancelExport ? (
              <Button
                disabled={task.status === 'cancelling' || task.phase === 'committing'}
                onClick={onCancel}
                variant="secondary"
              >
                {task.status === 'cancelling'
                  ? '\u6b63\u5728\u53d6\u6d88'
                  : '\u53d6\u6d88\u5bfc\u51fa'}
              </Button>
            ) : null}
            {isCompleted ? (
              <>
                <Button
                  className="export-task-primary"
                  onClick={onRevealOutput}
                  variant="primary"
                >
                  <FolderOpen aria-hidden="true" size={16} />
                  {'\u5728\u6587\u4ef6\u5939\u4e2d\u663e\u793a'}
                </Button>
                <Button onClick={onStartNewExport} variant="secondary">
                  {'\u518d\u6b21\u5bfc\u51fa'}
                </Button>
              </>
            ) : null}
            {isFailed || isCancelled ? (
              <>
                {task.snapshotId && task.snapshotRetryAvailable ? (
                  <Button onClick={onRetrySameSnapshot} variant="primary">
                    <RefreshCw aria-hidden="true" size={16} />
                    {'\u9009\u62e9\u4f4d\u7f6e\uff0c\u91cd\u8bd5\u539f\u5185\u5bb9'}
                  </Button>
                ) : null}
                <Button
                  onClick={onRetryCurrentContent}
                  variant={task.snapshotRetryAvailable ? 'secondary' : 'primary'}
                >
                  {'\u6309\u5f53\u524d\u5185\u5bb9\u91cd\u65b0\u5bfc\u51fa'}
                </Button>
              </>
            ) : null}
          </div>
        ) : null}
      </PanelSurface>
    </aside>
  );
}
