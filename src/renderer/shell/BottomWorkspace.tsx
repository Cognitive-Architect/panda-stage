import { HistoryControls } from '../features/editor/HistoryControls';
import { TimelineDock } from '../features/timeline/TimelineDock';

/**
 * The formal editor bottom owner. Stage 3-C keeps the history surface intact;
 * Day 26 adds the Timeline Shell as a second, UI-only product surface so the
 * bottom region carries both without a second Canvas / Inspector / History.
 */
export function BottomWorkspace(): React.JSX.Element {
  return (
    <section
      aria-label="Bottom workspace"
      className="bottom-workspace"
      data-testid="bottom-workspace"
    >
      <TimelineDock />
      <HistoryControls />
    </section>
  );
}
