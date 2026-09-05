import type { Point, ViewportTransform } from '../../../domain';

export interface CanvasToolbarProps {
  mode: 'fit' | 'half' | 'actual';
  point: Point | null;
  transform: ViewportTransform;
  onModeChange?: never;
}

/**
 * Lightweight Canvas feedback. The three viewport mode controls
 * (适应窗口 / 50% / 实际尺寸) live in the right-side 工具 surface
 * (ProjectToolsDrawer > 画布显示). The Canvas keeps only the compact
 * non-blocking feedback: current effective mode + scale + pointer
 * stage coordinate.
 */
export function CanvasToolbar({
  mode,
  point,
  transform,
}: CanvasToolbarProps): React.JSX.Element {
  return (
    <div
      className="canvas-toolbar"
      data-testid="canvas-toolbar-feedback"
      aria-label="画布状态"
    >
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
