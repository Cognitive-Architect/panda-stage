import { useRef } from 'react';

/**
 * Stage A is a presentation-only waiting state. Inspection and cancellation
 * authority remain with FlaInspectionLifecycle and Main.
 */
export function FlaStageAInspecting({
  onCancel,
}: {
  onCancel: () => void;
}): React.JSX.Element {
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  const keepFocusInDialog = (event: React.KeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'Tab') return;
    event.preventDefault();
    cancelButtonRef.current?.focus();
  };

  return (
    <section
      aria-busy="true"
      aria-labelledby="fla-stage-a-title"
      aria-modal="true"
      className="fla-review-session fla-stage-a-session"
      data-review-layout="portal"
      data-stage-a-state="inspecting"
      data-testid="fla-review-session"
      data-workbench-route="inspection"
      onKeyDown={keepFocusInDialog}
      role="dialog"
    >
      <header
        className="fla-stage-a-title-wrap"
        data-testid="fla-review-header"
      >
        <h2
          className="fla-stage-a-title"
          data-testid="fla-stage-a-headline"
          id="fla-stage-a-title"
        >导入素材</h2>
      </header>

      <div
        className="fla-stage-a-inspection"
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

      <button
        autoFocus
        className="fla-stage-a-cancel"
        data-testid="fla-review-cancel"
        onClick={onCancel}
        ref={cancelButtonRef}
        type="button"
      >
        取消
      </button>
    </section>
  );
}
