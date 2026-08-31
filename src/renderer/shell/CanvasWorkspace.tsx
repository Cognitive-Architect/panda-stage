import { CanvasStage } from '../features/canvas/CanvasStage';

export interface CanvasWorkspaceProps {
  showHeading?: boolean;
  showToolbar?: boolean;
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
}: CanvasWorkspaceProps = {}): React.JSX.Element {
  return (
    <section
      aria-label="中央画布工作区"
      className="canvas-workspace"
      data-testid="canvas-workspace-scroll"
    >
      <CanvasStage showHeading={showHeading} showToolbar={showToolbar} />
    </section>
  );
}
