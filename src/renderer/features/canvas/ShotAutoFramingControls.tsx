import { useRef } from 'react';
import {
  AUTO_FRAMING_PRESETS,
  DEFAULT_AUTO_FRAMING_TARGET_U,
  DEFAULT_AUTO_FRAMING_TARGET_V,
  resolveShotAutoFraming,
  setShotCameraAutoFraming,
  SPEAKER_FOCUS_ZOOM,
  type AutoFramingPresetId,
  type Project,
  type Shot,
  type ShotCameraAutoFraming,
} from '../../../domain';
import { Button } from '../../ui';

type FramingField = 'zoom' | 'targetU' | 'targetV';

const PRESET_OPTIONS: ReadonlyArray<{ readonly id: AutoFramingPresetId; readonly label: string }> = [
  { id: 'left-third', label: '左三分' },
  { id: 'center', label: '居中' },
  { id: 'right-third', label: '右三分' },
];

function formatCoordinate(value: number): string {
  return String(Number(value.toFixed(3)));
}

function matchesPreset(targetU: number, targetV: number, presetId: AutoFramingPresetId): boolean {
  const preset = AUTO_FRAMING_PRESETS[presetId];
  return Math.abs(targetU - preset.targetU) < 1e-3 && Math.abs(targetV - preset.targetV) < 1e-3;
}

export function ShotAutoFramingControls({
  shot,
  onEdit,
  onError,
}: {
  shot: Shot;
  onEdit: (change: (project: Project) => Project, label: string) => boolean;
  onError: (message: string) => void;
}): React.JSX.Element {
  const canceledFieldRef = useRef<FramingField | null>(null);
  const framing = resolveShotAutoFraming(shot);
  const formattedZoom = formatCoordinate(framing.zoom);
  const formattedU = formatCoordinate(framing.targetU);
  const formattedV = formatCoordinate(framing.targetV);
  const isDefault =
    Math.abs(framing.zoom - SPEAKER_FOCUS_ZOOM) < 1e-9 &&
    Math.abs(framing.targetU - DEFAULT_AUTO_FRAMING_TARGET_U) < 1e-9 &&
    Math.abs(framing.targetV - DEFAULT_AUTO_FRAMING_TARGET_V) < 1e-9;

  function applyFraming(next: ShotCameraAutoFraming | undefined, label: string): void {
    onEdit((project) => setShotCameraAutoFraming(project, shot.id, next), label);
  }

  function handleFieldKeyDown(
    event: React.KeyboardEvent<HTMLInputElement>,
    field: FramingField,
    formattedValue: string,
  ): void {
    if (event.key === 'Enter') {
      canceledFieldRef.current = null;
      event.currentTarget.blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      canceledFieldRef.current = field;
      event.currentTarget.value = formattedValue;
      event.currentTarget.blur();
    }
  }

  function handleFieldBlur(
    input: HTMLInputElement,
    field: FramingField,
    exactValue: number,
    formattedValue: string,
    min: number,
    max: number | null,
    errorMessage: string,
    commitLabel: string,
  ): void {
    if (canceledFieldRef.current === field) {
      canceledFieldRef.current = null;
      input.value = formattedValue;
      return;
    }
    const rawText = input.value.trim();
    if (rawText === formattedValue) {
      input.value = formattedValue;
      return;
    }
    const value = rawText === '' ? Number.NaN : input.valueAsNumber;
    if (!Number.isFinite(value) || value < min || (max !== null && value > max)) {
      input.value = formattedValue;
      onError(errorMessage);
      return;
    }
    if (Math.abs(value - exactValue) < 1e-6 || Math.abs(value - Number(formattedValue)) < 1e-9) {
      input.value = formattedValue;
      return;
    }
    applyFraming(
      {
        zoom: field === 'zoom' ? value : framing.zoom,
        targetU: field === 'targetU' ? value : framing.targetU,
        targetV: field === 'targetV' ? value : framing.targetV,
      },
      commitLabel,
    );
  }

  return (
    <div className="shot-auto-framing-controls" data-testid="shot-auto-framing-controls">
      <div className="shot-camera-actions" role="group" aria-label="自动构图预设">
        {PRESET_OPTIONS.map((preset) => {
          const active = matchesPreset(framing.targetU, framing.targetV, preset.id);
          return (
            <Button
              key={preset.id}
              variant={active ? 'primary' : 'secondary'}
              aria-pressed={active}
              data-testid={`auto-framing-preset-${preset.id}`}
              onClick={() => {
                const coords = AUTO_FRAMING_PRESETS[preset.id];
                if (
                  Math.abs(framing.targetU - coords.targetU) < 1e-9 &&
                  Math.abs(framing.targetV - coords.targetV) < 1e-9
                ) {
                  return;
                }
                applyFraming(
                  { zoom: framing.zoom, targetU: coords.targetU, targetV: coords.targetV },
                  '设置自动构图位置',
                );
              }}
            >
              {preset.label}
            </Button>
          );
        })}
        <Button
          variant="secondary"
          disabled={isDefault}
          data-testid="auto-framing-reset"
          onClick={() => applyFraming(undefined, '重置自动构图')}
        >
          恢复默认
        </Button>
      </div>
      <div className="shot-camera-fields">
        <label>
          跟拍倍率
          <input
            aria-label="自动跟拍倍率"
            data-testid="auto-framing-zoom"
            key={`af-zoom-${framing.zoom}`}
            type="number"
            min={1}
            step="0.1"
            defaultValue={formattedZoom}
            onKeyDown={(event) => handleFieldKeyDown(event, 'zoom', formattedZoom)}
            onBlur={(event) =>
              handleFieldBlur(
                event.currentTarget,
                'zoom',
                framing.zoom,
                formattedZoom,
                1,
                null,
                '自动跟拍倍率不能小于 1。',
                '调整自动跟拍倍率',
              )
            }
          />
        </label>
        <label>
          目标 U
          <input
            aria-label="自动构图水平目标 U"
            data-testid="auto-framing-u"
            key={`af-u-${framing.targetU}`}
            type="number"
            min={0}
            max={1}
            step="0.05"
            defaultValue={formattedU}
            onKeyDown={(event) => handleFieldKeyDown(event, 'targetU', formattedU)}
            onBlur={(event) =>
              handleFieldBlur(
                event.currentTarget,
                'targetU',
                framing.targetU,
                formattedU,
                0,
                1,
                '目标位置 U 须在 0–1 之间。',
                '调整自动构图目标位置',
              )
            }
          />
        </label>
        <label>
          目标 V
          <input
            aria-label="自动构图垂直目标 V"
            data-testid="auto-framing-v"
            key={`af-v-${framing.targetV}`}
            type="number"
            min={0}
            max={1}
            step="0.05"
            defaultValue={formattedV}
            onKeyDown={(event) => handleFieldKeyDown(event, 'targetV', formattedV)}
            onBlur={(event) =>
              handleFieldBlur(
                event.currentTarget,
                'targetV',
                framing.targetV,
                formattedV,
                0,
                1,
                '目标位置 V 须在 0–1 之间。',
                '调整自动构图目标位置',
              )
            }
          />
        </label>
      </div>
    </div>
  );
}
