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
      <strong>{candidate.project.name}</strong>
      <span>
        Recovery from {new Date(candidate.savedAtMs).toLocaleString()}
      </span>
      <span className="recovery-path">{candidate.recoveryFilePath}</span>
      <div>
        <button
          disabled={busy}
          onClick={() => void onRestore()}
          type="button"
        >
          Restore in memory
        </button>
        <button
          disabled={busy}
          onClick={() => void onIgnore()}
          type="button"
        >
          Ignore and retain file
        </button>
      </div>
    </div>
  );
}
