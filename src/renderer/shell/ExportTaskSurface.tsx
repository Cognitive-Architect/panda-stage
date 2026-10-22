import {
  Check,
  FolderOpen,
  LoaderCircle,
  RefreshCw,
  X,
} from 'lucide-react';
import { Button, IconButton, PanelSurface } from '../ui';
import type { ExportJobPhase } from '../../shared/export-types';
import type { ExportPreparationCameraMode } from '../../shared/export-preparation-types';

export type ExportTaskStatus =
  | 'idle'
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
  fileName?: string;
  projectRoot?: string;
  durationMs?: number;
  cameraMode?: ExportPreparationCameraMode;
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
  onChooseAnotherOutput(): void;
  onRevealOutput(): void;
}

const STATUS_COPY: Record<ExportTaskStatus, string> = {
  idle: '',
  preparing: '\u6b63\u5728\u68c0\u67e5\u955c\u5934\u548c\u7d20\u6750\u2026',
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
    case 'encoding':
      return '\u6b63\u5728\u5408\u6210\u89c6\u9891';
    case 'probing':
      return '\u6b63\u5728\u68c0\u67e5\u5bfc\u51fa\u7ed3\u679c';
    case 'committing':
      return '\u6b63\u5728\u4fdd\u5b58\u89c6\u9891';
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
  onChooseAnotherOutput,
  onRevealOutput,
}: ExportTaskSurfaceProps): React.JSX.Element | null {
  if (!open) return null;
  const active = ['preparing', 'starting', 'running', 'cancelling'].includes(
    task.status,
  );
  const progress =
    task.totalFrames > 0
      ? Math.min(100, Math.floor((task.completedFrames / task.totalFrames) * 100))
      : 0;
  const canCancelPreparation = task.status === 'preparing' && task.attemptId;
  const canCancelExport =
    (task.status === 'running' || task.status === 'cancelling') &&
    task.phase !== 'committing';

  return (
    <aside
      aria-label={'\u5bfc\u51fa\u89c6\u9891\u4efb\u52a1'}
      className="export-task-surface"
      data-task-status={task.status}
      data-testid="export-task-surface"
    >
      <PanelSurface className="export-task-panel">
        <header className="export-task-header">
          <div>
            <h2>{'\u5bfc\u51fa\u89c6\u9891'}</h2>
            {task.fileName ? <p>{task.fileName}</p> : null}
          </div>
          <IconButton
            aria-label={'\u9690\u85cf\u5bfc\u51fa\u4efb\u52a1'}
            className="export-task-hide"
            icon={<X aria-hidden="true" size={18} />}
            onClick={onHide}
            title={'\u9690\u85cf'}
            variant="secondary"
          />
        </header>

        <div aria-live="polite" className="export-task-status" role="status">
          {task.status === 'running' ? phaseCopy(task.phase) : STATUS_COPY[task.status]}
        </div>

        {active && task.totalFrames > 0 ? (
          <div className="export-task-progress">
            <progress
              aria-label={'\u5bfc\u51fa\u8fdb\u5ea6'}
              max={task.totalFrames}
              value={Math.min(task.completedFrames, task.totalFrames)}
            />
            <span>{progress}%</span>
          </div>
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

        {task.message ? (
          <p className="export-task-message">{task.message}</p>
        ) : null}

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
          {task.status === 'completed' ? (
            <Button
              className="export-task-primary"
              onClick={onRevealOutput}
              variant="primary"
            >
              <FolderOpen aria-hidden="true" size={16} />
              {'\u663e\u793a\u89c6\u9891'}
            </Button>
          ) : null}
          {task.status === 'failed' || task.status === 'cancelled' ? (
            <>
              {task.snapshotId ? (
                <Button onClick={onRetrySameSnapshot} variant="primary">
                  <RefreshCw aria-hidden="true" size={16} />
                  {'\u91cd\u8bd5\u8fd9\u4e2a\u955c\u5934'}
                </Button>
              ) : null}
              <Button onClick={onChooseAnotherOutput} variant="secondary">
                {'\u53e6\u9009\u4fdd\u5b58\u4f4d\u7f6e'}
              </Button>
            </>
          ) : null}
          {task.status === 'preparing' || task.status === 'starting' ? (
            <LoaderCircle
              aria-label={'\u6b63\u5728\u51c6\u5907'}
              className="export-task-spinner"
              role="img"
              size={18}
            />
          ) : null}
          {task.status === 'completed' ? (
            <Check aria-hidden="true" className="export-task-check" size={18} />
          ) : null}
        </div>
      </PanelSurface>
    </aside>
  );
}
