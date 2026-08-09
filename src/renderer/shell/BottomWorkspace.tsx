import { HistoryControls } from '../features/editor/HistoryControls';

/**
 * The formal editor bottom owner. Stage 3-C keeps the existing history
 * surface intact and changes only which shell region owns its UI.
 */
export function BottomWorkspace(): React.JSX.Element {
  return (
    <section
      aria-label="Bottom workspace"
      className="bottom-workspace"
      data-testid="bottom-workspace"
    >
      <HistoryControls />
    </section>
  );
}
