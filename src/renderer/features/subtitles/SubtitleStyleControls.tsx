import { Palette } from 'lucide-react';
import {
  DEFAULT_SUBTITLE_STROKE_COLOR,
  DEFAULT_SUBTITLE_STROKE_WIDTH,
  SUBTITLE_STYLE_FONT_SIZE_MAX,
  SUBTITLE_STYLE_FONT_SIZE_MIN,
  SUBTITLE_STYLE_STROKE_WIDTH_MAX,
  type SubtitleStyle,
  type SubtitleStylePatch,
} from '../../../domain';
import { DecorativeIcon } from '../../ui';

type SubtitleStyleControlsPresentation =
  | 'inspector'
  | 'timeline'
  | 'properties'
  | 'landscape';

const POSITIONS: ReadonlyArray<SubtitleStyle['position']> = [
  'top',
  'center',
  'bottom',
];

const POSITION_LABELS: Record<SubtitleStyle['position'], string> = {
  top: '顶部',
  center: '中间',
  bottom: '底部',
};

function colorInputValue(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  if (/^#[0-9a-f]{6}$/iu.test(value)) return value;
  if (/^#[0-9a-f]{8}$/iu.test(value)) return value.slice(0, 7);
  return fallback;
}

function steppedValue(
  value: number,
  delta: number,
  minimum: number,
  maximum: number,
): number {
  return Math.min(maximum, Math.max(minimum, value + delta));
}

export interface SubtitleStyleControlsProps {
  style: SubtitleStyle;
  presentation: SubtitleStyleControlsPresentation;
  onUpdate(patch: SubtitleStylePatch): void;
  errorMessage?: string | null;
}

/**
 * Compact shared-style editor used by every existing DialogueInspector
 * presentation. Each control commits immediately through the injected store
 * callback; the real Stage remains the only preview surface.
 */
export function SubtitleStyleControls({
  style,
  presentation,
  onUpdate,
  errorMessage = null,
}: SubtitleStyleControlsProps): React.JSX.Element {
  const outlineEnabled = (style.strokeWidth ?? 0) > 0;
  const strokeWidth = style.strokeWidth ?? 0;
  const strokeColor = colorInputValue(
    style.strokeColor,
    DEFAULT_SUBTITLE_STROKE_COLOR,
  );
  const compact = presentation === 'properties' || presentation === 'landscape';
  const sectionClassName = [
    compact ? 'dialogue-properties-section' : 'dialogue-inspector-section',
    presentation === 'landscape'
      ? 'dialogue-landscape-properties-section'
      : '',
    'dialogue-subtitle-style-section',
  ]
    .filter(Boolean)
    .join(' ');
  const headingClassName = [
    compact ? 'dialogue-properties-section-heading' : '',
    'dialogue-subtitle-style-heading',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section
      aria-labelledby="dialogue-subtitle-style-heading"
      className={sectionClassName}
      data-testid="dialogue-subtitle-style-section"
    >
      <div className={headingClassName}>
        <DecorativeIcon icon={Palette} size={18} />
        <h3 id="dialogue-subtitle-style-heading">字幕样式</h3>
        <span
          className="dialogue-subtitle-style-shared-badge"
          data-testid="subtitle-style-shared-badge"
        >
          共享
        </span>
      </div>
      <p className="dialogue-subtitle-style-helper">同样式字幕同步</p>

      <div className="dialogue-subtitle-style-controls">
        <div className="dialogue-subtitle-style-row dialogue-subtitle-style-primary-row">
          <div className="dialogue-subtitle-style-control-group">
            <span className="dialogue-subtitle-style-label">字号</span>
            <div
              aria-label="字号"
              className="dialogue-subtitle-style-stepper"
              data-testid="subtitle-style-font-size-control"
            >
              <button
                aria-label="减小字号"
                data-testid="subtitle-style-font-size-decrease"
                disabled={style.fontSize <= SUBTITLE_STYLE_FONT_SIZE_MIN}
                onClick={() =>
                  onUpdate({
                    fontSize: steppedValue(
                      style.fontSize,
                      -2,
                      SUBTITLE_STYLE_FONT_SIZE_MIN,
                      SUBTITLE_STYLE_FONT_SIZE_MAX,
                    ),
                  })
                }
                type="button"
              >
                −
              </button>
              <output data-testid="subtitle-style-font-size-value">
                {style.fontSize}
              </output>
              <button
                aria-label="增大字号"
                data-testid="subtitle-style-font-size-increase"
                disabled={style.fontSize >= SUBTITLE_STYLE_FONT_SIZE_MAX}
                onClick={() =>
                  onUpdate({
                    fontSize: steppedValue(
                      style.fontSize,
                      2,
                      SUBTITLE_STYLE_FONT_SIZE_MIN,
                      SUBTITLE_STYLE_FONT_SIZE_MAX,
                    ),
                  })
                }
                type="button"
              >
                +
              </button>
            </div>
          </div>

          <label className="dialogue-subtitle-style-control-group dialogue-subtitle-style-color-row">
            <span className="dialogue-subtitle-style-label">文字</span>
            <input
              aria-label="文字颜色"
              className="dialogue-subtitle-style-color-input"
              data-testid="subtitle-style-text-color"
              onChange={(event) => onUpdate({ textColor: event.target.value })}
              type="color"
              value={colorInputValue(style.textColor, '#fffdf6')}
            />
          </label>
        </div>

        <div className="dialogue-subtitle-style-row dialogue-subtitle-style-outline-row">
          <span className="dialogue-subtitle-style-label">描边</span>
          <button
            aria-checked={outlineEnabled}
            aria-label="描边"
            className="dialogue-subtitle-style-toggle"
            data-testid="subtitle-style-stroke-toggle"
            onClick={() =>
              onUpdate(
                outlineEnabled
                  ? { strokeWidth: 0 }
                  : {
                      strokeColor:
                        style.strokeColor ?? DEFAULT_SUBTITLE_STROKE_COLOR,
                      strokeWidth: DEFAULT_SUBTITLE_STROKE_WIDTH,
                    },
              )
            }
            role="switch"
            type="button"
          >
            {outlineEnabled ? '开' : '关'}
          </button>

          <div
            aria-disabled={!outlineEnabled}
            className="dialogue-subtitle-style-subordinate"
          >
            <div
              aria-label="描边粗细"
              className="dialogue-subtitle-style-stepper"
              data-testid="subtitle-style-stroke-width-control"
            >
              <button
                aria-label="减小描边粗细"
                data-testid="subtitle-style-stroke-width-decrease"
                disabled={!outlineEnabled || strokeWidth <= 0}
                onClick={() =>
                  onUpdate({
                    strokeWidth: steppedValue(
                      strokeWidth,
                      -1,
                      0,
                      SUBTITLE_STYLE_STROKE_WIDTH_MAX,
                    ),
                  })
                }
                type="button"
              >
                −
              </button>
              <output data-testid="subtitle-style-stroke-width-value">
                {strokeWidth}
              </output>
              <button
                aria-label="增大描边粗细"
                data-testid="subtitle-style-stroke-width-increase"
                disabled={
                  !outlineEnabled ||
                  strokeWidth >= SUBTITLE_STYLE_STROKE_WIDTH_MAX
                }
                onClick={() =>
                  onUpdate({
                    strokeWidth: steppedValue(
                      strokeWidth,
                      1,
                      0,
                      SUBTITLE_STYLE_STROKE_WIDTH_MAX,
                    ),
                  })
                }
                type="button"
              >
                +
              </button>
            </div>

            <label className="dialogue-subtitle-style-color-row">
              <input
                aria-label="描边颜色"
                className="dialogue-subtitle-style-color-input"
                data-testid="subtitle-style-stroke-color"
                disabled={!outlineEnabled}
                onChange={(event) =>
                  onUpdate({ strokeColor: event.target.value })
                }
                type="color"
                value={strokeColor}
              />
            </label>
          </div>
        </div>

        <div className="dialogue-subtitle-style-position-row">
          <span className="dialogue-subtitle-style-label">位置</span>
          <div
            aria-label="字幕位置"
            className="dialogue-subtitle-style-position-control"
            role="group"
          >
            {POSITIONS.map((position) => (
              <button
                aria-pressed={style.position === position}
                data-testid={`subtitle-style-position-${position}`}
                key={position}
                onClick={() => onUpdate({ position })}
                type="button"
              >
                {POSITION_LABELS[position]}
              </button>
            ))}
          </div>
        </div>
      </div>
      {errorMessage ? (
        <p
          className="dialogue-editor-error"
          data-error-scope="style"
          data-testid="subtitle-style-error"
          role="alert"
        >
          {errorMessage}
        </p>
      ) : null}
    </section>
  );
}
