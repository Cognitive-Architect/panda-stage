/**
 * Stage A is deliberately a presentation-only state.  Inspection authority
 * remains in FlaInspectionLifecycle and Main; this component only gives the
 * user one calm, truthful view while that operation is pending.
 */
export function FlaStageAInspecting({
  onCancel,
}: {
  onCancel: () => void;
}): React.JSX.Element {
  return (
    <section
      aria-busy="true"
      aria-label="FLA WORKBENCH"
      aria-modal="true"
      className="fla-review-session fla-stage-a-session"
      data-review-layout="portal"
      data-stage-a-state="inspecting"
      data-testid="fla-review-session"
      data-workbench-route="inspection"
      role="dialog"
    >
      <header
        className="fla-review-heading fla-stage-a-header"
        data-testid="fla-review-header"
      >
        <h2>FLA WORKBENCH</h2>
        <div className="fla-stage-a-header-actions">
          <span
            className="fla-stage-a-state"
            data-testid="fla-stage-a-state"
          >
            检查中
          </span>
          <button
            autoFocus
            className="fla-stage-a-cancel"
            data-testid="fla-review-cancel"
            onClick={onCancel}
            type="button"
          >
            取消
          </button>
        </div>
      </header>

      <div className="fla-review-body fla-stage-a-body" data-testid="fla-review-body">
        <div
          aria-hidden="true"
          className="fla-stage-a-quiet-pane"
          data-placeholder-authoritative="false"
          data-testid="fla-stage-a-quiet-pane"
        />
        <main
          className="fla-stage-a-inspection"
          data-testid="fla-stage-a-inspection"
        >
          <div
            aria-hidden="true"
            className="fla-stage-a-scan-core"
            data-ring-count="3"
            data-testid="fla-stage-a-scan-core"
          >
            <span className="fla-stage-a-scan-ring fla-stage-a-scan-ring-outer" />
            <span className="fla-stage-a-scan-ring fla-stage-a-scan-ring-middle" />
            <span className="fla-stage-a-scan-ring fla-stage-a-scan-ring-inner" />
            <span className="fla-stage-a-scan-center" />
          </div>
          <div className="fla-stage-a-copy">
            <h1 data-testid="fla-stage-a-headline">正在检查 FLA</h1>
            <p data-testid="fla-stage-a-trust">不会修改原文件或当前项目</p>
          </div>
        </main>
      </div>

      <footer className="fla-stage-a-footer">
        <span data-testid="fla-stage-a-helper">检查完成后自动进入下一步</span>
      </footer>
    </section>
  );
}
