import { useEffect, useState } from 'react';
import { SHOT_MIN_DURATION_MS, type Shot } from '../../../domain';
import { ShotListItem } from './ShotListItem';

export function nextAvailableShotName(
  shots: readonly Pick<Shot, 'name'>[],
): string {
  const names = new Set(
    shots.map((shot) => shot.name.trim().toLocaleLowerCase()),
  );
  let suffix = shots.length + 1;
  while (names.has(`镜头 ${suffix}`.toLocaleLowerCase())) suffix += 1;
  return `镜头 ${suffix}`;
}

export interface ShotListProps {
  disabled?: boolean;
  selectedShotId: string | null;
  shots: readonly Shot[];
  onCreate: (name: string, durationMs: number) => boolean;
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
  const suggestedName = nextAvailableShotName(shots);
  const [name, setName] = useState(() => suggestedName);
  const [nameEdited, setNameEdited] = useState(false);
  const [durationMs, setDurationMs] = useState(3_000);

  useEffect(() => {
    if (!nameEdited) setName(suggestedName);
  }, [nameEdited, suggestedName]);

  return (
    <aside className="shot-list">
      <div className="shot-list-heading">
        <h3>镜头列表</h3>
        <span>{shots.length} 个镜头</span>
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
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (onCreate(name, durationMs)) setNameEdited(false);
        }}
      >
        <strong>新增镜头</strong>
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
