import { X } from 'lucide-react';
import { IconButton } from '../ui';

/**
 * Stage A is a presentation-only waiting state. Inspection and cancellation
 * authority remain with FlaInspectionLifecycle and Main.
 */
export function FlaStageAInspecting({
  onCancel,
}: {
  onCancel: () => void;
}): React.JSX.Element {
  const keepFocusInDialog = (event: React.KeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'Tab') return;
    event.preventDefault();
    event.currentTarget.querySelector('button')?.focus();
  };

  return (
    <section
      aria-busy="true"
      aria-label="正在准备素材"
      aria-modal="true"
      className="fla-review-session fla-compact-status"
      data-review-layout="portal"
      data-stage-a-state="inspecting"
      data-testid="fla-review-session"
      data-workbench-route="inspection"
      onKeyDown={keepFocusInDialog}
      role="dialog"
    >
      <div
        className="fla-stage-a-inspection fla-compact-status-message"
        data-testid="fla-stage-a-inspection"
      >
        <span
          aria-hidden="true"
          className="fla-stage-a-spinner"
          data-testid="fla-stage-a-spinner"
        />
        <p
          aria-atomic="true"
          aria-live="polite"
          className="fla-stage-a-status"
          data-testid="fla-stage-a-status"
          role="status"
        >
          正在准备素材…
        </p>
      </div>

      <IconButton
        aria-label="取消导入"
        autoFocus
        className="fla-compact-status-close"
        data-testid="fla-review-cancel"
        icon={<X size={18} />}
        onClick={onCancel}
        type="button"
        variant="secondary"
      />
    </section>
  );
}
