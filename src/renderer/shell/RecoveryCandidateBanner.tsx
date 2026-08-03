import type { RecoveryCandidate } from '../../shared/recovery-api';

export interface RecoveryCandidateBannerProps {
  candidate: RecoveryCandidate;
  busy: boolean;
  onRestore(): Promise<void>;
  onIgnore(): Promise<void>;
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
      <div className="recovery-prompt-summary">
        <strong>检测到未保存的恢复内容</strong>
        <span>{new Date(candidate.savedAtMs).toLocaleString()}</span>
      </div>
      <div>
        <button
          disabled={busy}
          onClick={() => void onRestore()}
          type="button"
        >
          恢复
        </button>
        <button
          disabled={busy}
          onClick={() => void onIgnore()}
          type="button"
        >
          忽略
        </button>
      </div>
      <details className="recovery-details">
        <summary>查看详情</summary>
        <span>{candidate.project.name}</span>
        <code className="recovery-path">{candidate.recoveryFilePath}</code>
      </details>
    </div>
  );
}
