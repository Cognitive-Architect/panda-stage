import { useId, type KeyboardEventHandler } from 'react';
import type {
  CanvasViewportMode,
  Point,
  ViewportTransform,
} from '../../../domain';

export interface CanvasToolbarProps {
  mode: CanvasViewportMode;
  point: Point | null;
  transform: ViewportTransform;
  showStatus?: boolean;
  groupEditAvailable?: boolean;
  groupEditActive?: boolean;
  onToggleGroupEdit?: () => void;
  onGroupEditKeyDownCapture?: KeyboardEventHandler<HTMLDivElement>;
  onModeChange?: never;
}

/**
 * Lightweight viewport chrome for status and the selected layer's transient
 * Group edit action. The component lives outside the scaled logical stage.
 */
export function CanvasToolbar({
  mode,
  point,
  transform,
  showStatus = true,
  groupEditAvailable = false,
  groupEditActive = false,
  onToggleGroupEdit = () => undefined,
  onGroupEditKeyDownCapture,
}: CanvasToolbarProps): React.JSX.Element {
  const tooltipId = `fla-group-edit-tooltip-${useId()}`;
  const temporaryEditMessage = '当前分组调整尚不能保存到项目';

  return (
    <div
      className="canvas-toolbar canvas-viewport-chrome"
      data-testid="canvas-toolbar-feedback"
      aria-label="画布状态"
    >
      {showStatus ? (
        <>
          <output
            className="canvas-mode-feedback"
            data-testid="canvas-mode-feedback"
          >
            {mode === 'fit' ? '适应窗口' : '1:1 像素 · 可滚动查看'}
            {' · '}
            {(transform.scale * 100).toFixed(1)}%
          </output>
          <output
            data-testid="canvas-pointer-coordinate"
            hidden={!point}
          >
            {point ? `x ${point.x.toFixed(1)} · y ${point.y.toFixed(1)}` : null}
          </output>
        </>
      ) : null}
      {groupEditAvailable ? (
        <div
          className="canvas-group-edit-control"
          data-canvas-interactive-chrome="true"
          data-testid="fla-group-edit-control"
          onKeyDownCapture={onGroupEditKeyDownCapture}
        >
          {groupEditActive ? (
            <>
              <span className="canvas-group-edit-temporary">临时编辑</span>
              <span className="canvas-group-edit-tooltip-anchor">
                <button
                  aria-describedby={tooltipId}
                  aria-label="分组编辑保存说明"
                  className="canvas-group-edit-info"
                  data-ui-button
                  data-ui-size="icon"
                  data-ui-variant="secondary"
                  title={temporaryEditMessage}
                  type="button"
                >
                  <span aria-hidden="true">ⓘ</span>
                </button>
                <span className="canvas-group-edit-tooltip" id={tooltipId} role="tooltip">
                  {temporaryEditMessage}
                </span>
              </span>
            </>
          ) : null}
          <button
            aria-controls="project-canvas-stage"
            aria-pressed={groupEditActive}
            className="canvas-group-edit-toggle"
            data-testid="fla-group-edit-toggle"
            data-ui-button
            data-ui-variant="secondary"
            onClick={onToggleGroupEdit}
            type="button"
          >
            {groupEditActive ? '返回整体' : '编辑分组'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
