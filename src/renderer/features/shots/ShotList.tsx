import { useState } from 'react';
import { SHOT_MIN_DURATION_MS, type Shot } from '../../../domain';
import { ShotListItem } from './ShotListItem';

export interface ShotListProps {
  disabled?: boolean;
  selectedShotId: string | null;
  shots: readonly Shot[];
  onCreate: (name: string, durationMs: number) => void;
  onMove: (shotId: string, targetIndex: number) => void;
  onSelect: (shotId: string) => void;
}

export function ShotList({
  disabled = false,
  selectedShotId,
  shots,
  onCreate,
  onMove,
  onSelect,
}: ShotListProps): React.JSX.Element {
  const [name, setName] = useState(`镜头 ${shots.length + 1}`);
  const [durationMs, setDurationMs] = useState(3_000);

  return (
    <aside className="shot-list">
      <div className="shot-list-heading">
        <h3>镜头列表</h3>
        <span>{shots.length}/5 验收样例</span>
      </div>
      {shots.length === 0 ? (
        <div className="shot-list-empty">
          <strong>项目还没有镜头</strong>
          <p>在下方创建第一个镜头；当前选择将自动指向它。</p>
        </div>
      ) : (
        <ol>
          {shots.map((shot, index) => (
            <ShotListItem
              disabled={disabled}
              index={index}
              key={shot.id}
              onDropShot={onMove}
              onSelect={onSelect}
              selected={shot.id === selectedShotId}
              shot={shot}
            />
          ))}
        </ol>
      )}
      <form
        className="shot-create-form"
        onSubmit={(event) => {
          event.preventDefault();
          onCreate(name, durationMs);
          setName(`镜头 ${shots.length + 2}`);
        }}
      >
        <strong>新增镜头</strong>
        <label>
          名称
          <input
            disabled={disabled}
            maxLength={200}
            onChange={(event) => setName(event.target.value)}
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
        <button
          disabled={disabled || !name.trim() || !Number.isInteger(durationMs)}
          type="submit"
        >
          创建镜头
        </button>
      </form>
    </aside>
  );
}
