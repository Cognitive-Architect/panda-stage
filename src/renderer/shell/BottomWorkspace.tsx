import { HistoryControls } from '../features/editor/HistoryControls';
import { TimelineDock } from '../features/timeline/TimelineDock';
import { useTimelineUi } from '../features/timeline/timelineUiStore';
import type { EditorShellLayoutMode } from './adaptiveEditorShell';

/**
 * The formal editor bottom owner. Stage 3-C keeps the history surface intact;
 * Day 26 adds the Timeline Shell as a second, UI-only product surface so the
 * bottom region carries both without a second Canvas / Inspector / History.
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
}

export function BottomWorkspace({
  hidden = false,
  presentation = 'landscape',
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
      <HistoryControls />
    </section>
  );
}
