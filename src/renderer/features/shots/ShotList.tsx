import type { ReactNode } from 'react';
import { ArrowRight, Clapperboard, PanelsTopLeft, RectangleHorizontal } from 'lucide-react';
import type { Shot } from '../../../domain';
import { ShotCreateForm } from './ShotCreateForm';
import { ShotListItem } from './ShotListItem';
import { DecorativeIcon } from '../../ui';

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
  showHeading?: boolean;
  selectedActions?: ReactNode;
  compactDuration?: boolean;
  showStoryboardCue?: boolean;
  inlineEmptyCopy?: boolean;
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
  showHeading = true,
  selectedActions,
  compactDuration = false,
  showStoryboardCue = false,
  inlineEmptyCopy = false,
}: ShotListProps): React.JSX.Element {
  const suggestedName = nextAvailableShotName(shots);

  return (
    <aside
      aria-label={showHeading ? undefined : '镜头列表'}
      className="shot-list"
      data-testid="shot-list-view"
    >
      <div
        className={
          showHeading
            ? 'shot-list-heading'
            : 'shot-list-heading shot-list-heading-visually-hidden'
        }
      >
        <h3>镜头列表</h3>
        <span>{shots.length} 个镜头</span>
      </div>
      {shots.length === 0 ? (
        <div
          className={
            inlineEmptyCopy
              ? 'shot-list-empty shot-list-empty-inline-copy'
              : 'shot-list-empty'
          }
        >
          {showStoryboardCue ? (
            <div
              aria-hidden="true"
              className="shot-empty-storyboard"
              data-testid="shot-empty-storyboard"
            >
              <div
                className="shot-empty-storyboard-card shot-empty-storyboard-card-primary"
                data-shot-empty-frame="1"
              >
                <DecorativeIcon
                  className="shot-empty-storyboard-icon"
                  icon={Clapperboard}
                  size={26}
                  strokeWidth={1.8}
                />
                <span>镜头 1</span>
              </div>
              <DecorativeIcon
                className="shot-empty-storyboard-arrow"
                icon={ArrowRight}
                size={16}
              />
              <div
                className="shot-empty-storyboard-card shot-empty-storyboard-card-muted"
                data-shot-empty-frame="2"
              >
                <DecorativeIcon
                  className="shot-empty-storyboard-icon"
                  icon={PanelsTopLeft}
                  size={22}
                  strokeWidth={1.8}
                />
                <span>镜头 2</span>
              </div>
              <DecorativeIcon
                className="shot-empty-storyboard-arrow"
                icon={ArrowRight}
                size={16}
              />
              <div
                className="shot-empty-storyboard-card shot-empty-storyboard-card-faded"
                data-shot-empty-frame="3"
              >
                <DecorativeIcon
                  className="shot-empty-storyboard-icon"
                  icon={RectangleHorizontal}
                  size={22}
                  strokeWidth={1.8}
                />
                <span>镜头 3</span>
              </div>
            </div>
          ) : null}
          <strong>还没有镜头</strong>
          <p>先新建一个吧。</p>
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
              selectedActions={
                shot.id === selectedShotId ? selectedActions : undefined
              }
              shot={shot}
              compactDuration={compactDuration}
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
