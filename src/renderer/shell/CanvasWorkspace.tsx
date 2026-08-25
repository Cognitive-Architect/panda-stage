import { CanvasStage } from '../features/canvas/CanvasStage';

export interface CanvasWorkspaceProps {
  showHeading?: boolean;
}

/**
 * The editor's permanent central owner for the production canvas.
 *
 * The CanvasStage remains the single owner of the canvas viewport, transform
 * controls, and layer controls. HistoryControls belongs to BottomWorkspace,
 * outside this canvas region.
 */
export function CanvasWorkspace({
  showHeading = true,
}: CanvasWorkspaceProps = {}): React.JSX.Element {
  return (
    <section
      aria-label="中央画布工作区"
      className="canvas-workspace"
      data-testid="canvas-workspace-scroll"
    >
      <CanvasStage showHeading={showHeading} />
    </section>
  );
}
