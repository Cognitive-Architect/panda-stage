import { useEffect, useState } from 'react';
import { SHOT_MIN_DURATION_MS } from '../../../domain';
import { CirclePlus } from 'lucide-react';

export type ShotCreatePresentation = 'default' | 'landscape';

export const SHOT_CREATE_DEFAULT_DURATION_MS = 3_000;
export const SHOT_CREATE_DURATION_STEP_MS = 500;
export const SHOT_CREATE_DURATION_PRESETS_MS = [
  1_000,
  3_000,
  5_000,
  10_000,
] as const;

export function formatShotCreateDuration(durationMs: number): string {
  return (durationMs / 1_000).toFixed(1);
}

export function parseShotCreateDuration(value: string): number {
  if (value.trim() === '') return Number.NaN;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? Math.round(seconds * 1_000) : Number.NaN;
}

export function isShotCreateDurationValid(durationMs: number): boolean {
  return Number.isInteger(durationMs) && durationMs >= SHOT_MIN_DURATION_MS;
}

export function stepShotCreateDuration(
  durationMs: number,
  deltaMs: number,
): number {
  return Math.max(SHOT_MIN_DURATION_MS, durationMs + deltaMs);
}

export function canSubmitShotCreate(
  name: string,
  durationMs: number,
  disabled = false,
): boolean {
  return !disabled && Boolean(name.trim()) && isShotCreateDurationValid(durationMs);
}

export function getShotCreateDurationError(
  value: string,
  touched: boolean,
): string | null {
  if (!touched) return null;
  if (value.trim() === '') return '请输入时长。';
  if (!isShotCreateDurationValid(parseShotCreateDuration(value))) {
    return `最短 ${(SHOT_MIN_DURATION_MS / 1_000).toFixed(1)} 秒。`;
  }
  return null;
}

export interface ShotCreateFormProps {
  disabled?: boolean;
  presentation?: ShotCreatePresentation;
  suggestedName: string;
  onBack: () => void;
  onCreate: (name: string, durationMs: number) => boolean;
}

export function ShotCreateForm({
  disabled = false,
  presentation = 'default',
  suggestedName,
  onBack,
  onCreate,
}: ShotCreateFormProps): React.JSX.Element {
  const [name, setName] = useState(suggestedName);
  const [nameEdited, setNameEdited] = useState(false);
  const [durationMs, setDurationMs] = useState(
    SHOT_CREATE_DEFAULT_DURATION_MS,
  );
  const [durationInput, setDurationInput] = useState(
    formatShotCreateDuration(SHOT_CREATE_DEFAULT_DURATION_MS),
  );
  const [durationTouched, setDurationTouched] = useState(false);

  useEffect(() => {
    if (!nameEdited) setName(suggestedName);
  }, [nameEdited, suggestedName]);

  const landscapeDurationMs = parseShotCreateDuration(durationInput);
  const landscapeDurationValid = isShotCreateDurationValid(landscapeDurationMs);
  const durationError = getShotCreateDurationError(
    durationInput,
    durationTouched,
  );

  const adjustDuration = (deltaMs: number): void => {
    const currentDurationMs = landscapeDurationValid
      ? landscapeDurationMs
      : SHOT_CREATE_DEFAULT_DURATION_MS;
    setDurationInput(
      formatShotCreateDuration(
        stepShotCreateDuration(currentDurationMs, deltaMs),
      ),
    );
    setDurationTouched(true);
  };

  const selectPreset = (presetMs: number): void => {
    setDurationInput(formatShotCreateDuration(presetMs));
    setDurationTouched(false);
  };

  const landscape = presentation === 'landscape';
  const viewClassName = landscape
    ? 'shot-create-view shot-create-view-landscape'
    : 'shot-create-view';

  return (
    <section
      aria-labelledby="shot-create-heading"
      className={viewClassName}
      data-shot-create-presentation={presentation}
      data-testid="shot-create-view"
    >
      {landscape ? (
        <div className="shot-create-heading shot-create-heading-landscape">
          <h3 id="shot-create-heading">新建镜头</h3>
        </div>
      ) : (
        <div className="shot-create-heading">
          <div>
            <p className="eyebrow">镜头管理</p>
            <h3 id="shot-create-heading">新建镜头</h3>
          </div>
          <button
            data-testid="shot-create-back"
            onClick={onBack}
            type="button"
          >
            返回镜头列表
          </button>
        </div>
      )}
      {landscape ? (
        <form
          className="shot-create-form shot-create-form-landscape"
          data-testid="shot-create-landscape-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSubmitShotCreate(name, landscapeDurationMs, disabled)) {
              setDurationTouched(true);
              return;
            }
            if (onCreate(name, landscapeDurationMs)) onBack();
          }}
        >
          <label className="shot-create-field">
            <span className="shot-create-field-label">名称</span>
            <input
              data-testid="shot-create-name"
              disabled={disabled}
              maxLength={200}
              onChange={(event) => {
                setName(event.target.value);
                setNameEdited(true);
              }}
              value={name}
            />
          </label>
          <div
            className={
              durationError
                ? 'shot-create-duration-field shot-create-field-invalid'
                : 'shot-create-duration-field'
            }
          >
            <span
              className="shot-create-field-label"
              id="shot-create-duration-label"
            >
              时长
            </span>
            <div
              aria-labelledby="shot-create-duration-label"
              className="shot-create-duration-control"
              role="group"
            >
              <button
                aria-label="减少新镜头时长"
                className="shot-create-duration-stepper"
                data-testid="shot-create-duration-decrease"
                disabled={
                  disabled ||
                  (landscapeDurationValid &&
                    landscapeDurationMs <= SHOT_MIN_DURATION_MS)
                }
                onClick={() => adjustDuration(-SHOT_CREATE_DURATION_STEP_MS)}
                type="button"
              >
                −
              </button>
              <label className="shot-create-duration-input">
                <input
                  aria-describedby={
                    durationError ? 'shot-create-duration-error' : undefined
                  }
                  aria-invalid={durationError ? 'true' : 'false'}
                  aria-label="新镜头时长（秒）"
                  data-testid="shot-create-duration-input"
                  disabled={disabled}
                  inputMode="decimal"
                  min={SHOT_MIN_DURATION_MS / 1_000}
                  onChange={(event) => {
                    setDurationInput(event.target.value);
                    setDurationTouched(true);
                  }}
                  required
                  step="0.1"
                  type="number"
                  value={durationInput}
                />
                <span aria-hidden="true">秒</span>
              </label>
              <button
                aria-label="增加新镜头时长"
                className="shot-create-duration-stepper"
                data-testid="shot-create-duration-increase"
                disabled={disabled}
                onClick={() => adjustDuration(SHOT_CREATE_DURATION_STEP_MS)}
                type="button"
              >
                +
              </button>
            </div>
            <div
              aria-label="时长预设"
              className="shot-create-presets"
              role="group"
            >
              {SHOT_CREATE_DURATION_PRESETS_MS.map((presetMs) => {
                const selected =
                  landscapeDurationValid && landscapeDurationMs === presetMs;
                return (
                  <button
                    aria-pressed={selected}
                    className={
                      selected ? 'shot-create-preset-selected' : undefined
                    }
                    data-testid={`shot-create-preset-${presetMs / 1_000}`}
                    disabled={disabled}
                    key={presetMs}
                    onClick={() => selectPreset(presetMs)}
                    type="button"
                  >
                    {presetMs / 1_000} 秒
                  </button>
                );
              })}
            </div>
            {durationError ? (
              <p
                className="shot-create-duration-error"
                id="shot-create-duration-error"
                role="alert"
              >
                {durationError}
              </p>
            ) : null}
          </div>
          <button
            className="shot-create-primary-action ui-icon-label"
            data-testid="shot-create-submit"
            disabled={!canSubmitShotCreate(name, landscapeDurationMs, disabled)}
            type="submit"
          >
            <CirclePlus
              aria-hidden="true"
              className="ui-icon"
              focusable="false"
              size={18}
            />
            <span>创建镜头</span>
          </button>
        </form>
      ) : (
        <form
          className="shot-create-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (onCreate(name, durationMs)) onBack();
          }}
        >
          <label>
            名称
            <input
              disabled={disabled}
              maxLength={200}
              onChange={(event) => {
                setName(event.target.value);
                setNameEdited(true);
              }}
              value={name}
            />
          </label>
          <label>
            时长（毫秒）
            <input
              disabled={disabled}
              min={SHOT_MIN_DURATION_MS}
              onChange={(event) => setDurationMs(event.target.valueAsNumber)}
              step="1"
              type="number"
              value={Number.isNaN(durationMs) ? '' : durationMs}
            />
          </label>
          <p className="shot-create-hint">
            时长必须是整数，且不少于 {SHOT_MIN_DURATION_MS}ms。
          </p>
          <button
            className="ui-icon-label"
            disabled={disabled || !name.trim() || !Number.isInteger(durationMs)}
            type="submit"
          >
            <CirclePlus
              aria-hidden="true"
              className="ui-icon"
              focusable="false"
              size={18}
            />
            <span>创建镜头</span>
          </button>
        </form>
      )}
    </section>
  );
}
