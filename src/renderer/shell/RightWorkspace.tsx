import {
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  MessageCircleMore,
  SlidersHorizontal,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { EditorProjectSnapshot } from '../stores/EditorProjectStore';
import { DecorativeIcon } from '../ui';
import { DialogueSheet } from '../features/dialogue/DialogueSheet';
import { usePendingDialoguePlacement } from '../features/timeline/PendingDialoguePlacement';
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

export function RightWorkspace({
  projectSnapshot,
  recentRefreshToken,
  onOpenRecentProject,
}: RightWorkspaceProps): React.JSX.Element {
  const pendingPlacement = usePendingDialoguePlacement();
  const [activeActivity, setActiveActivity] =
    useState<RightActivity | null>(null);
  const triggerRefs = useRef<Partial<Record<RightActivity, HTMLButtonElement>>>({});
  const surfaceRef = useRef<HTMLDivElement>(null);
  const previousActivityRef = useRef<RightActivity | null>(null);

  const closeSurface = (): void => setActiveActivity(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (
        event.key === 'Escape' &&
        !event.defaultPrevented &&
        activeActivity
      ) closeSurface();
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
          data-active-activity={activeActivity}
          data-testid="right-workspace-surface"
          id="right-workspace-surface"
          tabIndex={-1}
        >
          {activeActivity === 'subtitles' ? (
            <DialogueSheet
              onClose={closeSurface}
              pendingDragDialogueId={pendingPlacement.drag?.dialogueId ?? null}
              pendingTrayInteraction={pendingPlacement.interaction}
              presentation="right-workspace"
              unifiedTaskTray
            />
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
