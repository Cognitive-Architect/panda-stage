import { useState } from 'react';
import { SHOT_MIN_DURATION_MS, type Shot } from '../../../domain';
import { ShotThumbnailPlaceholder } from './ShotThumbnailPlaceholder';

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
  const [durationMs, setDurationMs] = useState(
    shot?.durationMs ?? SHOT_MIN_DURATION_MS,
  );

  if (!shot) {
    return (
      <div className="shot-editor shot-editor-empty">
        <strong>请选择或创建镜头</strong>
        <p>镜头选择只属于当前编辑会话，不会写入 project.json。</p>
      </div>
    );
  }

  return (
    <article className="shot-editor" data-current-shot-id={shot.id}>
      <div className="shot-editor-heading">
        <div>
          <p className="eyebrow">Shot {index + 1}</p>
          <h3>{shot.name}</h3>
        </div>
        <div className="shot-editor-actions">
          <button disabled={disabled} onClick={onDuplicate} type="button">
            复制镜头
          </button>
          <button
            className="shot-delete-button"
            disabled={disabled}
            onClick={onRemove}
            type="button"
          >
            移除镜头
          </button>
        </div>
      </div>
      <div className="shot-editor-body">
        <ShotThumbnailPlaceholder index={index} name={shot.name} />
        <div className="shot-fields">
          <label>
            镜头名称
            <span>
              <input
                disabled={disabled}
                maxLength={200}
                onChange={(event) => setName(event.target.value)}
                value={name}
              />
              <button
                disabled={disabled || !name.trim() || name.trim() === shot.name}
                onClick={() => onRename(name)}
                type="button"
              >
                保存名称
              </button>
            </span>
          </label>
          <label>
            时长（毫秒）
            <span>
              <input
                disabled={disabled}
                min={SHOT_MIN_DURATION_MS}
                onChange={(event) =>
                  setDurationMs(event.target.valueAsNumber)
                }
                step="1"
                type="number"
                value={Number.isNaN(durationMs) ? '' : durationMs}
              />
              <button
                disabled={
                  disabled ||
                  !Number.isInteger(durationMs) ||
                  durationMs === shot.durationMs
                }
                onClick={() => onSetDuration(durationMs)}
                type="button"
              >
                保存时长
              </button>
            </span>
          </label>
          <p>
            必须为整数且不少于 {SHOT_MIN_DURATION_MS}ms；不能短于镜头内已有内容。
          </p>
        </div>
      </div>
      <dl className="shot-entity-summary">
        <div><dt>图层</dt><dd>{shot.layers.length}</dd></div>
        <div><dt>音频</dt><dd>{shot.audioClips.length}</dd></div>
        <div><dt>对白</dt><dd>{shot.dialogues.length}</dd></div>
        <div><dt>事件</dt><dd>{shot.timelineEvents.length}</dd></div>
      </dl>
    </article>
  );
}
