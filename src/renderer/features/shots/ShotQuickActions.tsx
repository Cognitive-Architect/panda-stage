import { useEffect, useState } from 'react';
import { SHOT_MIN_DURATION_MS, type Shot } from '../../../domain';
import {
  Check,
  Clock3,
  Copy,
  MoreHorizontal,
  Pencil,
  Trash2,
  X,
} from 'lucide-react';

type QuickEditor = 'rename' | 'duration' | null;

function parseDurationInput(value: string): number {
  const seconds = Number(value);
  return Number.isFinite(seconds) ? Math.round(seconds * 1_000) : Number.NaN;
}

export interface ShotQuickActionsProps {
  disabled?: boolean;
  index: number;
  shot: Shot;
  onDuplicate: () => void;
  onRemove: () => void;
  onRename: (name: string) => void;
  onSetDuration: (durationMs: number) => void;
}

/**
 * A presentation-only selected-Shot action strip for the landscape drawer.
 * Mutations stay in ShotManager and continue through shotStore.
 */
export function ShotQuickActions({
  disabled = false,
  index,
  shot,
  onDuplicate,
  onRemove,
  onRename,
  onSetDuration,
}: ShotQuickActionsProps): React.JSX.Element {
  const [activeEditor, setActiveEditor] = useState<QuickEditor>(null);
  const [nameInput, setNameInput] = useState(shot.name);
  const [durationInput, setDurationInput] = useState(
    (shot.durationMs / 1_000).toFixed(1),
  );

  useEffect(() => {
    setActiveEditor(null);
    setNameInput(shot.name);
    setDurationInput((shot.durationMs / 1_000).toFixed(1));
  }, [shot.id, shot.name, shot.durationMs]);

  const durationMs = parseDurationInput(durationInput);
  const durationValid =
    Number.isInteger(durationMs) && durationMs >= SHOT_MIN_DURATION_MS;
  const nameValid =
    Boolean(nameInput.trim()) && nameInput.trim() !== shot.name;

  return (
    <section
      aria-label={`镜头 ${index + 1} 快捷操作`}
      className="shot-quick-actions"
      data-shot-id={shot.id}
      data-testid="shot-quick-actions"
    >
      <div className="shot-quick-actions-bar">
        <span className="shot-quick-actions-label">
          已选镜头 {String(index + 1).padStart(2, '0')}
        </span>
        <div className="shot-quick-actions-buttons">
          <button
            aria-expanded={activeEditor === 'rename'}
            className="shot-quick-action"
            data-testid="shot-quick-rename"
            disabled={disabled}
            onClick={() => setActiveEditor('rename')}
            type="button"
          >
            <Pencil aria-hidden="true" className="ui-icon" focusable="false" size={16} />
            <span>重命名</span>
          </button>
          <button
            aria-expanded={activeEditor === 'duration'}
            className="shot-quick-action"
            data-testid="shot-quick-duration"
            disabled={disabled}
            onClick={() => setActiveEditor('duration')}
            type="button"
          >
            <Clock3 aria-hidden="true" className="ui-icon" focusable="false" size={16} />
            <span>时长</span>
          </button>
          <details className="shot-quick-more">
            <summary
              aria-label="更多镜头操作"
              className="shot-quick-action"
              data-testid="shot-quick-more"
            >
              <MoreHorizontal aria-hidden="true" className="ui-icon" focusable="false" size={16} />
              <span>更多</span>
            </summary>
            <div className="shot-quick-more-menu">
              <button
                className="shot-quick-action"
                data-testid="shot-quick-duplicate"
                disabled={disabled}
                onClick={onDuplicate}
                type="button"
              >
                <Copy aria-hidden="true" className="ui-icon" focusable="false" size={16} />
                <span>复制镜头</span>
              </button>
              <button
                className="shot-quick-action shot-quick-delete"
                data-testid="shot-quick-delete"
                disabled={disabled}
                onClick={onRemove}
                type="button"
              >
                <Trash2 aria-hidden="true" className="ui-icon" focusable="false" size={16} />
                <span>移除镜头</span>
              </button>
            </div>
          </details>
        </div>
      </div>
      {activeEditor === 'rename' ? (
        <form
          className="shot-quick-edit-form"
          data-testid="shot-quick-rename-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!nameValid) return;
            onRename(nameInput);
            setActiveEditor(null);
          }}
        >
          <label>
            <span>镜头名称</span>
            <input
              aria-label="镜头名称"
              autoFocus
              disabled={disabled}
              maxLength={200}
              onChange={(event) => setNameInput(event.target.value)}
              value={nameInput}
            />
          </label>
          <div className="shot-quick-edit-buttons">
            <button
              className="shot-quick-apply"
              data-testid="shot-quick-rename-apply"
              disabled={disabled || !nameValid}
              type="submit"
            >
              <Check aria-hidden="true" className="ui-icon" focusable="false" size={16} />
              <span>应用</span>
            </button>
            <button
              className="shot-quick-cancel"
              data-testid="shot-quick-rename-cancel"
              onClick={() => setActiveEditor(null)}
              type="button"
            >
              <X aria-hidden="true" className="ui-icon" focusable="false" size={16} />
              <span>取消</span>
            </button>
          </div>
        </form>
      ) : null}
      {activeEditor === 'duration' ? (
        <form
          className="shot-quick-edit-form"
          data-testid="shot-quick-duration-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!durationValid) return;
            onSetDuration(durationMs);
            setActiveEditor(null);
          }}
        >
          <label>
            <span>时长（秒）</span>
            <input
              aria-label="镜头时长（秒）"
              aria-invalid={durationInput !== '' && !durationValid}
              autoFocus
              disabled={disabled}
              min={SHOT_MIN_DURATION_MS / 1_000}
              onChange={(event) => setDurationInput(event.target.value)}
              step="0.1"
              type="number"
              value={durationInput}
            />
          </label>
          <span className="shot-quick-edit-hint">
            最短 {SHOT_MIN_DURATION_MS / 1_000} 秒
          </span>
          <div className="shot-quick-edit-buttons">
            <button
              className="shot-quick-apply"
              data-testid="shot-quick-duration-apply"
              disabled={disabled || !durationValid || durationMs === shot.durationMs}
              type="submit"
            >
              <Check aria-hidden="true" className="ui-icon" focusable="false" size={16} />
              <span>应用</span>
            </button>
            <button
              className="shot-quick-cancel"
              data-testid="shot-quick-duration-cancel"
              onClick={() => setActiveEditor(null)}
              type="button"
            >
              <X aria-hidden="true" className="ui-icon" focusable="false" size={16} />
              <span>取消</span>
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
