import { useState } from 'react';
import type { EditorProjectSnapshot } from '../stores/EditorProjectStore';
import { AssetLibrary } from '../features/assets/AssetLibrary';
import { CharacterManager } from '../features/characters/CharacterManager';
import { ShotManager } from '../features/shots/ShotManager';

export type ResourceActivity = 'shots' | 'assets' | 'characters';

export interface ResourceActivityDockProps {
  snapshot: EditorProjectSnapshot;
}

const ACTIVITIES: readonly {
  id: ResourceActivity;
  label: string;
}[] = [
  { id: 'shots', label: '镜头' },
  { id: 'assets', label: '素材' },
  { id: 'characters', label: '角色' },
];

export function ResourceActivityDock({
  snapshot,
}: ResourceActivityDockProps): React.JSX.Element {
  const [activeActivity, setActiveActivity] =
    useState<ResourceActivity>('shots');

  return (
    <section
      aria-labelledby="resource-activity-heading"
      className="resource-activity-dock"
      data-testid="resource-activity-dock"
    >
      <div className="resource-activity-heading">
        <div>
          <p className="eyebrow">编辑资源</p>
          <h2 id="resource-activity-heading">工作区</h2>
        </div>
        <span>一次显示一个活动</span>
      </div>
      <nav
        aria-label="编辑资源活动"
        className="resource-activity-tabs"
        data-testid="resource-activity-tabs"
      >
        {ACTIVITIES.map((activity) => (
          <button
            aria-controls="resource-activity-panel"
            aria-pressed={activeActivity === activity.id}
            className={
              activeActivity === activity.id
                ? 'resource-activity-tab-active'
                : ''
            }
            data-activity={activity.id}
            key={activity.id}
            onClick={() => setActiveActivity(activity.id)}
            type="button"
          >
            {activity.label}
          </button>
        ))}
      </nav>
      <div
        aria-live="polite"
        className="resource-activity-panel"
        data-active-activity={activeActivity}
        id="resource-activity-panel"
      >
        {activeActivity === 'shots' ? (
          <ShotManager snapshot={snapshot} />
        ) : activeActivity === 'assets' ? (
          <AssetLibrary snapshot={snapshot} />
        ) : (
          <CharacterManager snapshot={snapshot} />
        )}
      </div>
    </section>
  );
}
