import { HistoryControls } from '../features/editor/HistoryControls';
import { TimelineDock } from '../features/timeline/TimelineDock';
import { useTimelineUi } from '../features/timeline/timelineUiStore';
import type { EditorShellLayoutMode } from './adaptiveEditorShell';

/**
 * The formal editor bottom owner. Stage 3-C keeps the history behavior intact;
 * Day 26 adds the Timeline Shell as a second, UI-only product surface. In
 * portrait the existing HistoryControls owner is rendered by the top bar,
 * leaving this region to the Timeline only.
 *
 * Issue #197 mirrors the one existing Timeline expand state
 * (`timelineUiStore.expanded`) onto `data-timeline-expanded` so the bottom
 * height contract can actually shrink when the ruler is collapsed and the
 * freed vertical space returns to the central Canvas. Reading that store is
 * presentation-only: no project snapshot, dirty flag, revision or History is
 * touched, and no second collapse state is introduced here.
 */
export interface BottomWorkspaceProps {
  hidden?: boolean;
  presentation?: EditorShellLayoutMode;
  showHistoryControls?: boolean;
}

export function BottomWorkspace({
  hidden = false,
  presentation = 'landscape',
  showHistoryControls = true,
}: BottomWorkspaceProps = {}): React.JSX.Element {
  const { expanded } = useTimelineUi();

  return (
    <section
      aria-label="Bottom workspace"
      className="bottom-workspace"
      data-presentation={presentation}
      data-testid="bottom-workspace"
      data-timeline-expanded={expanded ? 'true' : 'false'}
      hidden={hidden}
    >
      <TimelineDock presentation={presentation} />
      {showHistoryControls ? <HistoryControls presentation="bottom" /> : null}
    </section>
  );
}
