import { CanvasStage } from '../features/canvas/CanvasStage';
import {
  EMPTY_PART_POSE_EDITOR_UI,
  type PartPoseEditorUi,
} from '../features/part-pose/partPoseEditorTypes';

export interface CanvasWorkspaceProps {
  showHeading?: boolean;
  showToolbar?: boolean;
  partPoseEditor?: PartPoseEditorUi;
}

/**
 * The editor's permanent central owner for the production canvas.
 *
 * The CanvasStage remains the single owner of the canvas viewport, transform
 * controls, and layer controls. The toolbar is a presentation seam on that
 * same owner so portrait workspaces can hide it without recreating the Canvas.
 */
export function CanvasWorkspace({
  showHeading = true,
  showToolbar = true,
  partPoseEditor = EMPTY_PART_POSE_EDITOR_UI,
}: CanvasWorkspaceProps = {}): React.JSX.Element {
  return (
    <section
      aria-label="中央画布工作区"
      className="canvas-workspace"
      data-testid="canvas-workspace-scroll"
    >
      <CanvasStage
        partPoseEditor={partPoseEditor}
        showHeading={showHeading}
        showToolbar={showToolbar}
      />
    </section>
  );
}
