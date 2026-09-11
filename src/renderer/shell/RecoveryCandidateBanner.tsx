import type { RecoveryCandidate } from '../../shared/recovery-api';

export interface RecoveryCandidateBannerProps {
  candidate: RecoveryCandidate;
  busy: boolean;
  onRestore(): Promise<void>;
  onIgnore(): Promise<void>;
}

function formatClock(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes(),
  ).padStart(2, '0')}`;
}

export function formatRecoveryTime(
  savedAtMs: number,
  now = new Date(),
): string {
  const savedAt = new Date(savedAtMs);
  const isToday =
    savedAt.getFullYear() === now.getFullYear() &&
    savedAt.getMonth() === now.getMonth() &&
    savedAt.getDate() === now.getDate();

  if (isToday) return `今天 ${formatClock(savedAt)}`;

  const shortDate = new Intl.DateTimeFormat('zh-CN', {
    day: 'numeric',
    month: 'numeric',
  }).format(savedAt);
  return `${shortDate} ${formatClock(savedAt)}`;
}

export function RecoveryCandidateBanner({
  candidate,
  busy,
  onRestore,
  onIgnore,
}: RecoveryCandidateBannerProps): React.JSX.Element {
  return (
    <div
      className="recovery-prompt"
      data-testid="recovery-candidate-banner"
      role="alert"
    >
      <div className="recovery-prompt-content">
        <span aria-hidden="true" className="recovery-prompt-icon">
          ↶
        </span>
        <div className="recovery-prompt-summary">
          <strong>发现可恢复内容</strong>
          <span>{formatRecoveryTime(candidate.savedAtMs)}</span>
        </div>
      </div>
      <div className="recovery-prompt-actions">
        <button
          className="task4-hit-target"
          data-task4-core="recovery-restore"
          disabled={busy}
          onClick={() => void onRestore()}
          type="button"
        >
          恢复
        </button>
        <button
          className="task4-hit-target"
          data-task4-core="recovery-ignore"
          disabled={busy}
          onClick={() => void onIgnore()}
          type="button"
        >
          忽略
        </button>
        <details className="recovery-details">
          <summary
            aria-label="查看恢复详情"
            data-testid="recovery-details-toggle"
          >
            <span aria-hidden="true">···</span>
          </summary>
          <div className="recovery-details-content">
            <span>项目：{candidate.project.name}</span>
            <code className="recovery-path">
              {candidate.recoveryFilePath}
            </code>
          </div>
        </details>
      </div>
    </div>
  );
}
