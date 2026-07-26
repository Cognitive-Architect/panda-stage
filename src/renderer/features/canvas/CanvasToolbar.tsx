import type {
  CanvasViewportMode,
  Point,
  ViewportTransform,
} from '../../../domain';

export interface CanvasToolbarProps {
  mode: CanvasViewportMode;
  point: Point | null;
  transform: ViewportTransform;
  onModeChange: (mode: CanvasViewportMode) => void;
}

export function CanvasToolbar({
  mode,
  point,
  transform,
  onModeChange,
}: CanvasToolbarProps): React.JSX.Element {
  return (
    <div className="canvas-toolbar" aria-label="Canvas viewport controls">
      <div className="canvas-mode-switch" role="group" aria-label="Zoom mode">
        <button
          aria-pressed={mode === 'fit'}
          data-testid="canvas-mode-fit"
          onClick={() => onModeChange('fit')}
          type="button"
        >
          Fit
        </button>
        <button
          aria-pressed={mode === 'actual'}
          data-testid="canvas-mode-actual"
          onClick={() => onModeChange('actual')}
          type="button"
        >
          Actual size
        </button>
      </div>
      <output
        className="canvas-mode-feedback"
        data-testid="canvas-mode-feedback"
      >
        {mode === 'fit' ? 'Fit to viewport' : '1:1 pixels · scroll to inspect'}
        {' · '}
        {(transform.scale * 100).toFixed(1)}%
      </output>
      <span>Logical canvas 1920 × 1080</span>
      <output data-testid="canvas-pointer-coordinate">
        {point
          ? `x ${point.x.toFixed(1)} · y ${point.y.toFixed(1)}`
          : 'Move over canvas to inspect coordinates'}
      </output>
    </div>
  );
}
