import { useId, type KeyboardEventHandler } from 'react';
import { ArrowLeft, LockKeyhole, LogIn } from 'lucide-react';
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
  flaGraphicEditAvailable?: boolean;
  flaGraphicEditActive?: boolean;
  canEnterSelected?: boolean;
  readOnlySelected?: boolean;
  onToggleFlaGraphicEdit?: () => void;
  onEnterSelected?: () => void;
  onReturn?: () => void;
  onFlaGraphicEditKeyDownCapture?: KeyboardEventHandler<HTMLDivElement>;
  onModeChange?: never;
}

/**
 * Lightweight viewport chrome for status and the selected Structured FLA
 * instance's hierarchical edit actions.
 */
export function CanvasToolbar({
  mode,
  point,
  transform,
  showStatus = true,
  flaGraphicEditAvailable = false,
  flaGraphicEditActive = false,
  canEnterSelected = false,
  readOnlySelected = false,
  onToggleFlaGraphicEdit = () => undefined,
  onEnterSelected = () => undefined,
  onReturn = () => undefined,
  onFlaGraphicEditKeyDownCapture,
}: CanvasToolbarProps): React.JSX.Element {
  const returnTooltipId = `fla-group-edit-return-${useId()}`;
  const enterTooltipId = `fla-group-edit-enter-${useId()}`;
  const readOnlyTooltipId = `fla-group-edit-readonly-${useId()}`;

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
      {flaGraphicEditAvailable ? (
        <div
          className="canvas-group-edit-control"
          data-canvas-interactive-chrome="true"
          data-testid="fla-group-edit-control"
          onKeyDownCapture={onFlaGraphicEditKeyDownCapture}
        >
          {flaGraphicEditActive ? (
            <>
              <span className="canvas-group-edit-tooltip-anchor">
                <button
                  aria-describedby={returnTooltipId}
                  aria-label="返回上级"
                  className="canvas-group-edit-icon"
                  data-ui-button
                  data-ui-size="icon"
                  data-ui-variant="secondary"
                  onClick={onReturn}
                  title="返回上级"
                  type="button"
                >
                  <ArrowLeft aria-hidden="true" focusable="false" size={16} />
                </button>
                <span className="canvas-group-edit-tooltip" id={returnTooltipId} role="tooltip">
                  返回上级
                </span>
              </span>
              {canEnterSelected ? (
                <span className="canvas-group-edit-tooltip-anchor">
                  <button
                    aria-describedby={enterTooltipId}
                    aria-label="进入子元件"
                    className="canvas-group-edit-icon"
                    data-ui-button
                    data-ui-size="icon"
                    data-ui-variant="secondary"
                    onClick={onEnterSelected}
                    title="进入"
                    type="button"
                  >
                    <LogIn aria-hidden="true" focusable="false" size={16} />
                  </button>
                  <span className="canvas-group-edit-tooltip" id={enterTooltipId} role="tooltip">
                    进入
                  </span>
                </span>
              ) : null}
              {readOnlySelected ? (
                <span
                  aria-describedby={readOnlyTooltipId}
                  aria-label="当前对象只读"
                  className="canvas-group-edit-tooltip-anchor canvas-group-edit-readonly"
                  role="img"
                  tabIndex={0}
                  title="当前对象只读"
                >
                  <LockKeyhole aria-hidden="true" focusable="false" size={16} />
                  <span className="canvas-group-edit-tooltip" id={readOnlyTooltipId} role="tooltip">
                    当前对象只读
                  </span>
                </span>
              ) : null}
            </>
          ) : (
            <button
              aria-controls="project-canvas-stage"
              aria-pressed={false}
              className="canvas-group-edit-toggle"
              data-testid="fla-group-edit-toggle"
              data-ui-button
              data-ui-variant="secondary"
              onClick={onToggleFlaGraphicEdit}
              type="button"
            >
              编辑元件
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
