import { useState, type FormEvent } from 'react';
import type {
  ActionPresetDefinition,
  CreatePresetEventsParams,
} from '../../../domain';

export interface ExpressionOption {
  id: string;
  name: string;
}

interface PresetParameterFormProps {
  preset: ActionPresetDefinition;
  characterExpressions: readonly ExpressionOption[];
  onApply: (params: CreatePresetEventsParams) => void;
  onCancel: () => void;
}

/**
 * Collects the parameters for a single preset and dispatches them upward.
 * It never touches the DOM/Konva nodes directly — it only emits params that
 * the bridge store turns into timeline events.
 */
export function PresetParameterForm({
  preset,
  characterExpressions,
  onApply,
  onCancel,
}: PresetParameterFormProps): React.JSX.Element {
  const [expressionId, setExpressionId] = useState(
    characterExpressions[0]?.id ?? '',
  );
  const [targetX, setTargetX] = useState('');
  const [targetY, setTargetY] = useState('');
  const [scaleFactor, setScaleFactor] = useState('1.3');
  const [amplitudeX, setAmplitudeX] = useState('24');
  const [amplitudeY, setAmplitudeY] = useState('0');
  const [frequencyHz, setFrequencyHz] = useState('6');
  const [durationMs, setDurationMs] = useState(String(preset.defaultDurationMs));
  const [status, setStatus] = useState('填写参数后点击应用。');

  const buildParams = (): CreatePresetEventsParams => {
    const params: CreatePresetEventsParams = {};
    const duration = Number(durationMs);
    if (Number.isFinite(duration) && duration > 0) {
      params.durationMs = Math.round(duration);
    }
    if (preset.id === 'move-to') {
      const x = Number(targetX);
      const y = Number(targetY);
      if (Number.isFinite(x)) params.targetX = x;
      if (Number.isFinite(y)) params.targetY = y;
    }
    if (preset.id === 'scale-emphasis') {
      const factor = Number(scaleFactor);
      if (Number.isFinite(factor) && factor > 0) params.scaleFactor = factor;
    }
    if (preset.id === 'shake') {
      const ax = Number(amplitudeX);
      const ay = Number(amplitudeY);
      const hz = Number(frequencyHz);
      if (Number.isFinite(ax)) params.amplitudeX = ax;
      if (Number.isFinite(ay)) params.amplitudeY = ay;
      if (Number.isFinite(hz) && hz > 0) params.frequencyHz = hz;
    }
    if (preset.id === 'expression-switch') {
      params.expressionId = expressionId;
    }
    return params;
  };

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    try {
      onApply(buildParams());
      setStatus('已派发应用命令。');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '应用失败。');
    }
  };

  const valueFor = (name: string): string => {
    if (name === 'targetX') return targetX;
    if (name === 'targetY') return targetY;
    if (name === 'scaleFactor') return scaleFactor;
    if (name === 'amplitudeX') return amplitudeX;
    if (name === 'amplitudeY') return amplitudeY;
    if (name === 'frequencyHz') return frequencyHz;
    return durationMs;
  };

  const setValueFor = (name: string, value: string): void => {
    if (name === 'targetX') setTargetX(value);
    else if (name === 'targetY') setTargetY(value);
    else if (name === 'scaleFactor') setScaleFactor(value);
    else if (name === 'amplitudeX') setAmplitudeX(value);
    else if (name === 'amplitudeY') setAmplitudeY(value);
    else if (name === 'frequencyHz') setFrequencyHz(value);
    else setDurationMs(value);
  };

  return (
    <form className="preset-parameter-form" onSubmit={submit}>
      <p className="preset-parameter-title">
        {preset.label} · 参数
      </p>
      {preset.parameterFields.map((field) => {
        if (field.kind === 'expression') {
          return (
            <label key={field.name}>
              {field.label}
              <select
                data-testid={`preset-param-${field.name}`}
                onChange={(event) => setExpressionId(event.target.value)}
                value={expressionId}
              >
                {characterExpressions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </label>
          );
        }
        return (
          <label key={field.name}>
            {field.label}
            <input
              data-testid={`preset-param-${field.name}`}
              inputMode="decimal"
              onChange={(event) => setValueFor(field.name, event.target.value)}
              value={valueFor(field.name)}
            />
          </label>
        );
      })}
      <div className="preset-parameter-actions">
        <button type="submit">应用</button>
        <button type="button" onClick={onCancel}>
          取消
        </button>
      </div>
      <output data-testid="preset-parameter-status">{status}</output>
    </form>
  );
}
