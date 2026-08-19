import { useEffect, useState, type ReactNode } from 'react';
import type { EditorProjectSnapshot } from '../stores/EditorProjectStore';
import { AssetLibrary } from '../features/assets/AssetLibrary';
import type { AssetWorkspaceView } from '../features/assets/AssetLibrary';
import { CharacterManager } from '../features/characters/CharacterManager';
import type { CharacterWorkspaceView } from '../features/characters/CharacterManager';
import { ShotManager } from '../features/shots/ShotManager';
import type { ShotWorkspaceView } from '../features/shots/ShotManager';

export type ResourceActivity = 'shots' | 'assets' | 'characters';

export interface ResourceActivityDockProps {
  snapshot: EditorProjectSnapshot;
  auxiliaryContent?: ReactNode;
}

const ACTIVITIES: readonly {
  id: ResourceActivity;
  label: string;
}[] = [
  { id: 'shots', label: '镜头' },
  { id: 'assets', label: '素材' },
  { id: 'characters', label: '角色' },
];

export function isNarrowViewport(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(max-width: 1100px)').matches;
}

export function useNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(isNarrowViewport);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const media = window.matchMedia('(max-width: 1100px)');
    const update = (): void => setNarrow(media.matches);
    update();
    media.addEventListener?.('change', update);
    media.addListener?.(update);
    return () => {
      media.removeEventListener?.('change', update);
      media.removeListener?.(update);
    };
  }, []);

  return narrow;
}

export function ResourceActivityDock({
  snapshot,
  auxiliaryContent,
}: ResourceActivityDockProps): React.JSX.Element {
  const [activeActivity, setActiveActivity] =
    useState<ResourceActivity>('shots');
  const [shotView, setShotView] = useState<ShotWorkspaceView>('list');
  const [assetView, setAssetView] =
    useState<AssetWorkspaceView>('browser');
  const [characterView, setCharacterView] =
    useState<CharacterWorkspaceView>('list');
  const [assetImportRequest, setAssetImportRequest] = useState(0);
  const [assetReviewCloseRequest, setAssetReviewCloseRequest] = useState(0);
  const narrow = useNarrowViewport();
  const [drawerOpen, setDrawerOpen] = useState(() => !isNarrowViewport());

  useEffect(() => {
    setDrawerOpen(!narrow);
  }, [narrow]);

  useEffect(() => {
    if (!narrow) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [narrow]);

  const activeLabel =
    ACTIVITIES.find((activity) => activity.id === activeActivity)?.label ??
    '资源';

  const primaryAction =
    activeActivity === 'shots'
      ? shotView === 'create'
        ? {
            label: '返回镜头列表',
            onClick: () => setShotView('list'),
          }
        : {
            label: '新建镜头',
            onClick: () => setShotView('create'),
          }
      : activeActivity === 'assets'
        ? assetView === 'details'
          ? {
              label: '返回素材库',
              onClick: () => setAssetView('browser'),
            }
          : {
              label: '导入素材',
              onClick: () => setAssetImportRequest((value) => value + 1),
            }
        : characterView === 'create'
          ? {
              label: '返回角色列表',
              onClick: () => setCharacterView('list'),
            }
          : {
              label: '新建角色',
              onClick: () => setCharacterView('create'),
            };

  const selectActivity = (activity: ResourceActivity): void => {
    if (narrow && activity === activeActivity) {
      setDrawerOpen(false);
      return;
    }
    setActiveActivity(activity);
    setDrawerOpen(true);
  };

  return (
    <section
      aria-labelledby="resource-activity-heading"
      className={`resource-activity-dock${drawerOpen ? ' resource-activity-dock-open' : ''}`}
      data-resource-drawer-open={drawerOpen}
      data-resource-mode={narrow ? 'narrow' : 'wide'}
      data-testid="resource-activity-dock"
    >
      <button
        aria-controls="resource-activity-drawer"
        aria-expanded={drawerOpen}
        aria-label={drawerOpen ? '收起资源工作区' : '打开资源工作区'}
        className="resource-workspace-handle"
        data-testid="resource-workspace-handle"
        onClick={() => setDrawerOpen((open) => !open)}
        type="button"
      >
        <span>{drawerOpen ? '‹' : '›'}</span>
        <strong>资源</strong>
      </button>
      <div
        className="resource-activity-surface"
        data-testid="resource-activity-drawer"
        id="resource-activity-drawer"
      >
        <div className="resource-activity-header">
          <div className="resource-activity-heading">
            <div>
              <p className="eyebrow">编辑资源</p>
              <h2 id="resource-activity-heading">{activeLabel}工作区</h2>
            </div>
            <div className="resource-activity-header-actions">
              <button
                className="resource-activity-primary-action"
                data-resource-action={`${activeActivity}-${assetView === 'details' ? 'back' : primaryAction.label}`}
                data-testid="resource-primary-action"
                onClick={primaryAction.onClick}
                type="button"
              >
                {primaryAction.label}
              </button>
              <button
                aria-label="关闭资源工作区"
                className="resource-activity-close"
                data-testid="resource-activity-close"
                onClick={() => {
                  if (activeActivity === 'assets') {
                    setAssetReviewCloseRequest((value) => value + 1);
                  }
                  setDrawerOpen(false);
                }}
                type="button"
              >
                关闭
              </button>
            </div>
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
                onClick={() => selectActivity(activity.id)}
                type="button"
              >
                {activity.label}
              </button>
            ))}
          </nav>
        </div>
        <div className="resource-activity-body">
          <div
            aria-live="polite"
            className="resource-activity-panel"
            data-active-activity={activeActivity}
            data-active-subview={
              activeActivity === 'shots'
                ? shotView
                : activeActivity === 'assets'
                  ? assetView
                  : characterView
            }
            data-testid="resource-activity-panel"
            id="resource-activity-panel"
          >
            {activeActivity === 'shots' ? (
              <ShotManager
                onViewChange={setShotView}
                snapshot={snapshot}
                view={shotView}
              />
            ) : activeActivity === 'assets' ? (
              <AssetLibrary
                closeRequestToken={assetReviewCloseRequest}
                importRequestToken={assetImportRequest}
                onViewChange={setAssetView}
                snapshot={snapshot}
                view={assetView}
              />
            ) : (
              <CharacterManager
                onViewChange={setCharacterView}
                snapshot={snapshot}
                view={characterView}
              />
            )}
          </div>
          {auxiliaryContent ? (
            <div className="resource-activity-auxiliary">
              {auxiliaryContent}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
