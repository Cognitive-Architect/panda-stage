import type { CurveMotionStageDraft } from '../features/canvas/CurveMotionStageOverlay';
import type { DialogueSilence } from '../../shared/dialogue-silence';
import { CanvasStage } from '../features/canvas/CanvasStage';
import type { AnimationCurveDraft } from '../features/timeline/AnimationCurveDraft';

export interface CanvasWorkspaceProps {
  objectToolbarSuspended?: boolean;
  curveDraft?: AnimationCurveDraft | null;
  curveMotionDraft?: CurveMotionStageDraft | null;
  dialogueSilence?: DialogueSilence;
  showHeading?: boolean;
  showToolbar?: boolean;
  onCharacterPartSelected?: () => void;
}

/**
 * The editor's permanent central owner for the production canvas.
 *
 * The CanvasStage remains the single owner of the canvas viewport, transform
 * controls, and layer controls. The toolbar is a presentation seam on that
 * same owner so portrait workspaces can hide it without recreating the Canvas.
 */
export function CanvasWorkspace({
  curveDraft,
  curveMotionDraft,
  dialogueSilence,
  showHeading = true,
  objectToolbarSuspended,
  showToolbar = true,
  onCharacterPartSelected,
}: CanvasWorkspaceProps = {}): React.JSX.Element {
  return (
    <section
      aria-label="中央画布工作区"
      className="canvas-workspace"
      data-testid="canvas-workspace-scroll"
    >
      <CanvasStage
        curveDraft={curveDraft}
        curveMotionDraft={curveMotionDraft}
        dialogueSilence={dialogueSilence}
        showHeading={showHeading}
        objectToolbarSuspended={objectToolbarSuspended}
        showToolbar={showToolbar}
        onCharacterPartSelected={onCharacterPartSelected}
      />
    </section>
  );
}
