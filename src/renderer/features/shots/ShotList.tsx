import type { Shot } from '../../../domain';
import { ShotCreateForm } from './ShotCreateForm';
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
  onBack?: () => void;
  showCreateForm?: boolean;
}

export function ShotList({
  disabled = false,
  selectedShotId,
  shots,
  onCreate,
  onMove,
  onSelect,
  onBack = () => undefined,
  showCreateForm = true,
}: ShotListProps): React.JSX.Element {
  const suggestedName = nextAvailableShotName(shots);

  return (
    <aside className="shot-list" data-testid="shot-list-view">
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
      {showCreateForm ? (
        <ShotCreateForm
          disabled={disabled}
          onBack={onBack}
          onCreate={onCreate}
          suggestedName={suggestedName}
        />
      ) : null}
    </aside>
  );
}
