import { CanvasStage } from '../features/canvas/CanvasStage';

/**
 * The editor's permanent central owner for the production canvas.
 *
 * The CanvasStage itself remains the single owner of the canvas viewport,
 * transform controls, layer controls, and HistoryControls. This shell keeps
 * that owner out of the temporary compatibility surface on the left.
 */
export function CanvasWorkspace(): React.JSX.Element {
  return (
    <section
      aria-label="中央画布工作区"
      className="canvas-workspace"
      data-testid="canvas-workspace-scroll"
    >
      <CanvasStage />
    </section>
  );
}
