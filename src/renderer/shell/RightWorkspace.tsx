import {
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  MessageCircleMore,
  SlidersHorizontal,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { EditorProjectSnapshot } from '../stores/EditorProjectStore';
import { DecorativeIcon } from '../ui';
import { ProjectToolsDrawer } from './ProjectToolsDrawer';
import { RightInspector } from './RightInspector';

export type RightActivity = 'subtitles' | 'properties' | 'tools';

const RIGHT_ACTIVITIES: readonly {
  id: RightActivity;
  label: string;
  icon: LucideIcon;
}[] = [
  { id: 'subtitles', label: '字幕', icon: MessageCircleMore },
  { id: 'properties', label: '属性', icon: SlidersHorizontal },
  { id: 'tools', label: '工具', icon: Wrench },
];

export function getNextRightActivity(
  current: RightActivity | null,
  requested: RightActivity,
): RightActivity | null {
  return current === requested ? null : requested;
}

export interface RightWorkspaceProps {
  projectSnapshot: EditorProjectSnapshot;
  recentRefreshToken: number;
  onOpenRecentProject(
    projectRoot: string,
    expectedProjectId: string,
  ): Promise<void>;
}

function SubtitleWorkspacePlaceholder({
  onClose,
}: {
  onClose(): void;
}): React.JSX.Element {
  return (
    <section
      aria-labelledby="subtitle-workspace-heading"
      className="subtitle-workspace-placeholder"
      data-testid="subtitle-workspace-placeholder"
    >
      <header className="right-workspace-content-header">
        <div>
          <p className="eyebrow">右侧工作区</p>
          <h2 id="subtitle-workspace-heading">字幕</h2>
        </div>
        <button
          aria-label="关闭字幕"
          className="right-workspace-close"
          data-testid="subtitle-workspace-close"
          onClick={onClose}
          type="button"
        >
          <DecorativeIcon icon={X} size={20} />
        </button>
      </header>
      <div className="subtitle-workspace-placeholder-body">
        <DecorativeIcon icon={MessageCircleMore} size={34} strokeWidth={1.6} />
        <strong>字幕工作区</strong>
        <p>本阶段仅建立统一入口；字幕创建与待安排队列将在下一阶段迁入。</p>
      </div>
    </section>
  );
}

export function RightWorkspace({
  projectSnapshot,
  recentRefreshToken,
  onOpenRecentProject,
}: RightWorkspaceProps): React.JSX.Element {
  const [activeActivity, setActiveActivity] =
    useState<RightActivity | null>(null);
  const triggerRefs = useRef<Partial<Record<RightActivity, HTMLButtonElement>>>({});
  const surfaceRef = useRef<HTMLDivElement>(null);
  const previousActivityRef = useRef<RightActivity | null>(null);

  const closeSurface = (): void => setActiveActivity(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && activeActivity) closeSurface();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeActivity]);

  useEffect(() => {
    const previousActivity = previousActivityRef.current;
    if (activeActivity) {
      surfaceRef.current?.focus();
    } else if (previousActivity) {
      triggerRefs.current[previousActivity]?.focus();
    }
    previousActivityRef.current = activeActivity;
  }, [activeActivity]);

  const selectActivity = (activity: RightActivity): void => {
    setActiveActivity((current) => getNextRightActivity(current, activity));
  };

  return (
    <aside
      aria-label="右侧工作区"
      className="right-workspace"
      data-active-activity={activeActivity ?? 'none'}
      data-surface-open={String(activeActivity !== null)}
      data-testid="right-workspace"
    >
      {activeActivity ? (
        <div
          ref={surfaceRef}
          aria-label={`${RIGHT_ACTIVITIES.find((item) => item.id === activeActivity)?.label ?? ''}工作区`}
          className="right-workspace-surface"
          data-testid="right-workspace-surface"
          id="right-workspace-surface"
          tabIndex={-1}
        >
          {activeActivity === 'subtitles' ? (
            <SubtitleWorkspacePlaceholder onClose={closeSurface} />
          ) : activeActivity === 'properties' ? (
            <RightInspector
              drawerOpen
              embedded
              onDrawerOpenChange={(open) => {
                if (!open) closeSurface();
              }}
              shellMode="landscape"
            />
          ) : (
            <ProjectToolsDrawer
              onClose={closeSurface}
              onOpenRecentProject={onOpenRecentProject}
              projectSnapshot={projectSnapshot}
              recentRefreshToken={recentRefreshToken}
            />
          )}
        </div>
      ) : null}
      <nav
        aria-label="右侧活动"
        className="right-activity-rail"
        data-testid="right-activity-rail"
      >
        {RIGHT_ACTIVITIES.map((activity) => {
          const active = activity.id === activeActivity;
          return (
            <button
              ref={(node) => {
                if (node) triggerRefs.current[activity.id] = node;
              }}
              aria-controls="right-workspace-surface"
              aria-expanded={active}
              aria-label={`${active ? '关闭' : '打开'}${activity.label}工作区`}
              aria-pressed={active}
              className={active ? 'right-activity-rail-active' : ''}
              data-activity={activity.id}
              data-testid={`right-activity-rail-${activity.id}`}
              onClick={() => selectActivity(activity.id)}
              type="button"
            >
              <DecorativeIcon icon={activity.icon} size={20} />
              <strong>{activity.label}</strong>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
