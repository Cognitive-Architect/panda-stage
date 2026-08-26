import { useEffect, useState } from 'react';
import { SHOT_MIN_DURATION_MS, type Shot } from '../../../domain';
import { ShotThumbnailPlaceholder } from './ShotThumbnailPlaceholder';
import {
  Copy,
  Layers3,
  MessageSquareText,
  Music2,
  Trash2,
  Zap,
} from 'lucide-react';

const SHOT_DURATION_STEP_MS = 100;

function formatDurationInput(durationMs: number): string {
  return (durationMs / 1_000).toFixed(3);
}

export function formatShotDuration(durationMs: number): string {
  return `${formatDurationInput(durationMs)} 秒`;
}

function parseShotDurationInput(value: string): number {
  const seconds = Number(value);
  return Number.isFinite(seconds) ? Math.round(seconds * 1_000) : Number.NaN;
}

export interface ShotEditorProps {
  disabled?: boolean;
  index: number;
  shot: Shot | null;
  onDuplicate: () => void;
  onRemove: () => void;
  onRename: (name: string) => void;
  onSetDuration: (durationMs: number) => void;
}

export function ShotEditor({
  disabled = false,
  index,
  shot,
  onDuplicate,
  onRemove,
  onRename,
  onSetDuration,
}: ShotEditorProps): React.JSX.Element {
  const [name, setName] = useState(shot?.name ?? '');
  const [durationInput, setDurationInput] = useState(() =>
    formatDurationInput(shot?.durationMs ?? SHOT_MIN_DURATION_MS),
  );
  const [durationTouched, setDurationTouched] = useState(false);

  useEffect(() => {
    setName(shot?.name ?? '');
    setDurationInput(
      formatDurationInput(shot?.durationMs ?? SHOT_MIN_DURATION_MS),
    );
    setDurationTouched(false);
  }, [shot?.id, shot?.name, shot?.durationMs]);

  if (!shot) {
    return (
      <div className="shot-editor shot-editor-empty">
        <strong>请选择或创建镜头</strong>
        <p>镜头选择只属于当前编辑会话，不会写入 project.json。</p>
      </div>
    );
  }

  const durationMs = parseShotDurationInput(durationInput);
  const durationValid =
    Number.isInteger(durationMs) && durationMs >= SHOT_MIN_DURATION_MS;
  const durationChanged = durationValid && durationMs !== shot.durationMs;
  const durationHelpVisible = durationTouched && !durationValid;

  const adjustDuration = (deltaMs: number): void => {
    const currentDurationMs = durationValid ? durationMs : shot.durationMs;
    const nextDurationMs = Math.max(
      SHOT_MIN_DURATION_MS,
      currentDurationMs + deltaMs,
    );
    setDurationInput(formatDurationInput(nextDurationMs));
    setDurationTouched(true);
  };

  const normalizeDurationInput = (): void => {
    if (durationValid) {
      setDurationInput(formatDurationInput(durationMs));
    }
  };

  return (
    <article
      className="shot-editor"
      data-current-shot-id={shot.id}
      data-testid="shot-editor"
    >
      <div className="shot-editor-heading">
        <div className="shot-editor-title">
          <span aria-hidden="true" className="shot-editor-index">
            镜头 {index + 1} ·
          </span>
          <h3 aria-label={`镜头 ${index + 1} · ${shot.name}`}>{shot.name}</h3>
        </div>
        <div className="shot-editor-actions">
          <button
            className="shot-duplicate-button"
            disabled={disabled}
            onClick={onDuplicate}
            type="button"
          >
            <Copy aria-hidden="true" className="ui-icon" focusable="false" size={18} />
            <span>复制镜头</span>
          </button>
          <button
            className="shot-delete-button"
            disabled={disabled}
            onClick={onRemove}
            type="button"
          >
            <Trash2 aria-hidden="true" className="ui-icon" focusable="false" size={18} />
            <span>移除镜头</span>
          </button>
        </div>
      </div>
      <div className="shot-editor-body">
        <ShotThumbnailPlaceholder index={index} name={shot.name} />
        <div className="shot-fields">
          <label className="shot-field">
            <span className="shot-field-label">镜头名称</span>
            <span className="shot-field-control">
              <input
                aria-label="镜头名称"
                disabled={disabled}
                maxLength={200}
                onChange={(event) => setName(event.target.value)}
                value={name}
              />
              <button
                aria-label="应用名称修改"
                className="shot-compact-apply"
                disabled={disabled || !name.trim() || name.trim() === shot.name}
                onClick={() => onRename(name)}
                type="button"
                title="应用名称修改"
              >
                应用
              </button>
            </span>
          </label>
          <div
            className={
              durationHelpVisible
                ? 'shot-field shot-duration-field shot-field-invalid'
                : 'shot-field shot-duration-field'
            }
          >
            <span className="shot-field-label" id="shot-duration-label">
              时长
            </span>
            <div
              aria-labelledby="shot-duration-label"
              className="shot-duration-control"
              role="group"
            >
              <button
                aria-label="减少镜头时长"
                className="shot-duration-stepper"
                data-testid="shot-duration-decrease"
                disabled={
                  disabled || (durationValid && durationMs <= SHOT_MIN_DURATION_MS)
                }
                onClick={() => adjustDuration(-SHOT_DURATION_STEP_MS)}
                type="button"
              >
                −
              </button>
              <label className="shot-duration-input">
                <input
                  aria-describedby="shot-duration-help"
                  aria-invalid={durationTouched && !durationValid}
                  aria-label="镜头时长（秒）"
                  disabled={disabled}
                  inputMode="decimal"
                  onBlur={normalizeDurationInput}
                  onChange={(event) => {
                    setDurationInput(event.target.value);
                    setDurationTouched(true);
                  }}
                  value={durationInput}
                />
                <span aria-hidden="true">秒</span>
              </label>
              <button
                aria-label="增加镜头时长"
                className="shot-duration-stepper"
                data-testid="shot-duration-increase"
                disabled={disabled}
                onClick={() => adjustDuration(SHOT_DURATION_STEP_MS)}
                type="button"
              >
                +
              </button>
              <button
                aria-label="应用时长修改"
                className="shot-compact-apply"
                disabled={disabled || !durationChanged}
                onClick={() => onSetDuration(durationMs)}
                type="button"
                title="应用时长修改"
              >
                应用
              </button>
            </div>
            <details
              className="shot-duration-help"
              open={durationHelpVisible ? true : undefined}
            >
              <summary>时长要求</summary>
              <p id="shot-duration-help">
                最短 {formatShotDuration(SHOT_MIN_DURATION_MS)}；不能短于镜头内已有内容。
              </p>
            </details>
          </div>
        </div>
      </div>
      <dl aria-label="镜头内容统计" className="shot-entity-summary">
        <div><dt className="ui-icon-label"><Layers3 aria-hidden="true" className="ui-icon" focusable="false" size={16} /><span>图层</span></dt><dd>{shot.layers.length}</dd></div>
        <div><dt className="ui-icon-label"><Music2 aria-hidden="true" className="ui-icon" focusable="false" size={16} /><span>音频</span></dt><dd>{shot.audioClips.length}</dd></div>
        <div><dt className="ui-icon-label"><MessageSquareText aria-hidden="true" className="ui-icon" focusable="false" size={16} /><span>对白</span></dt><dd>{shot.dialogues.length}</dd></div>
        <div><dt className="ui-icon-label"><Zap aria-hidden="true" className="ui-icon" focusable="false" size={16} /><span>事件</span></dt><dd>{shot.timelineEvents.length}</dd></div>
      </dl>
    </article>
  );
}
