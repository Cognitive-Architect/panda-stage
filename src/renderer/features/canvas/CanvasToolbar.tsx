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
    <div className="canvas-toolbar" aria-label="画布视口控制">
      <div className="canvas-mode-switch" role="group" aria-label="缩放模式">
        <button
          aria-pressed={mode === 'fit'}
          data-testid="canvas-mode-fit"
          onClick={() => onModeChange('fit')}
          type="button"
        >
          适应窗口
        </button>
        <button
          aria-pressed={mode === 'half'}
          data-testid="canvas-mode-half"
          onClick={() => onModeChange('half')}
          type="button"
        >
          50%
        </button>
        <button
          aria-pressed={mode === 'actual'}
          data-testid="canvas-mode-actual"
          onClick={() => onModeChange('actual')}
          type="button"
        >
          实际尺寸
        </button>
      </div>
      <output
        className="canvas-mode-feedback"
        data-testid="canvas-mode-feedback"
      >
        {mode === 'fit'
          ? '适应窗口'
          : mode === 'half'
            ? '50% 预览 · 可滚动查看'
            : '1:1 像素 · 可滚动查看'}
        {' · '}
        {(transform.scale * 100).toFixed(1)}%
      </output>
      <output data-testid="canvas-pointer-coordinate">
        {point
          ? `x ${point.x.toFixed(1)} · y ${point.y.toFixed(1)}`
          : '将指针移入画布查看坐标'}
      </output>
    </div>
  );
}
