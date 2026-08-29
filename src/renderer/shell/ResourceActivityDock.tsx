import { useEffect, useState, type ReactNode } from 'react';
import type { EditorProjectSnapshot } from '../stores/EditorProjectStore';
import { AssetLibrary } from '../features/assets/AssetLibrary';
import type { AssetWorkspaceView } from '../features/assets/AssetLibrary';
import { CharacterManager } from '../features/characters/CharacterManager';
import type { CharacterWorkspaceView } from '../features/characters/CharacterManager';
import { ShotManager } from '../features/shots/ShotManager';
import type {
  ShotEditorPresentation,
  ShotWorkspaceView,
} from '../features/shots/ShotManager';
import {
  Clapperboard,
  CirclePlus,
  FileArchive,
  Images,
  Smile,
  Upload,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { DecorativeIcon } from '../ui';

export type ResourceActivity = 'shots' | 'assets' | 'characters';

export type ResourceActivityPresentation = 'default' | 'landscape';

export interface ResourceActivityDockProps {
  snapshot: EditorProjectSnapshot;
  auxiliaryContent?: ReactNode;
  /** Force the existing resource owner into the landscape drawer contract. */
  compact?: boolean;
  /** Re-slot the same owners into the persistent landscape rail + drawer. */
  presentation?: ResourceActivityPresentation;
  /** Optional controlled drawer state for a portrait Canvas-context surface. */
  drawerOpen?: boolean;
  onDrawerOpenChange?(open: boolean): void;
  /** Optional portrait workspace request; the resource owner remains single. */
  activeActivity?: ResourceActivity;
  onActiveActivityChange?(activity: ResourceActivity): void;
  /** Hide redundant section labels only for portrait resource surfaces. */
  hideSectionLabels?: boolean;
}

const ACTIVITIES: readonly {
  id: ResourceActivity;
  label: string;
  icon: LucideIcon;
}[] = [
  { id: 'shots', label: '镜头', icon: Clapperboard },
  { id: 'assets', label: '素材', icon: Images },
  { id: 'characters', label: '角色', icon: Smile },
];

export function isNarrowViewport(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(max-width: 1100px)').matches;
}

export type NarrowViewportMode = 'auto' | 'compact' | 'expanded';

export function useNarrowViewport(
  mode: NarrowViewportMode = 'auto',
): boolean {
  const [narrow, setNarrow] = useState(() =>
    mode === 'compact' ? true : mode === 'expanded' ? false : isNarrowViewport(),
  );

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    if (mode === 'compact') {
      setNarrow(true);
      return undefined;
    }
    if (mode === 'expanded') {
      setNarrow(false);
      return undefined;
    }
    const media = window.matchMedia('(max-width: 1100px)');
    const update = (): void => setNarrow(media.matches);
    update();
    media.addEventListener?.('change', update);
    media.addListener?.(update);
    return () => {
      media.removeEventListener?.('change', update);
      media.removeListener?.(update);
    };
  }, [mode]);

  return mode === 'compact' ? true : mode === 'expanded' ? false : narrow;
}

export function ResourceActivityDock({
  snapshot,
  auxiliaryContent,
  compact,
  presentation = 'default',
  drawerOpen: requestedDrawerOpen,
  onDrawerOpenChange,
  activeActivity: requestedActivity,
  onActiveActivityChange,
  hideSectionLabels = false,
}: ResourceActivityDockProps): React.JSX.Element {
  const landscapePresentation = presentation === 'landscape';
  const [internalActivity, setInternalActivity] =
    useState<ResourceActivity>('shots');
  const activeActivity = requestedActivity ?? internalActivity;
  const [shotView, setShotView] = useState<ShotWorkspaceView>('list');
  const [assetView, setAssetView] =
    useState<AssetWorkspaceView>('browser');
  const [characterView, setCharacterView] =
    useState<CharacterWorkspaceView>('list');
  const [assetImportRequest, setAssetImportRequest] = useState(0);
  const [assetFlaReviewRequest, setAssetFlaReviewRequest] = useState(0);
  const [assetReviewCloseRequest, setAssetReviewCloseRequest] = useState(0);
  const narrow = useNarrowViewport(
    compact === undefined ? 'auto' : compact ? 'compact' : 'expanded',
  );
  const [internalDrawerOpen, setInternalDrawerOpen] = useState(() => !narrow);
  const drawerOpen = requestedDrawerOpen ?? internalDrawerOpen;

  const setDrawerOpen = (open: boolean): void => {
    if (requestedDrawerOpen === undefined) {
      setInternalDrawerOpen(open);
    }
    onDrawerOpenChange?.(open);
  };

  useEffect(() => {
    if (requestedDrawerOpen === undefined) {
      setInternalDrawerOpen(!narrow);
    }
  }, [narrow, requestedDrawerOpen]);

  useEffect(() => {
    if (!narrow) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [narrow]);

  const activeLabel =
    landscapePresentation && activeActivity === 'assets'
      ? '素材库'
      : ACTIVITIES.find((activity) => activity.id === activeActivity)?.label ??
        '资源';
  const hideLocalActivityTabs =
    landscapePresentation ||
    (hideSectionLabels &&
      (activeActivity === 'shots' || activeActivity === 'assets'));
  const hidePortraitAssetsChrome =
    hideSectionLabels && activeActivity === 'assets';
  const showPortraitAssetActionGroup =
    hidePortraitAssetsChrome && assetView === 'browser';
  const showLandscapeAssetActionGroup =
    landscapePresentation &&
    activeActivity === 'assets' &&
    assetView === 'browser';
  const hideLandscapeCharacterPrimaryAction =
    landscapePresentation &&
    activeActivity === 'characters' &&
    (characterView === 'detail' || characterView === 'expression');
  const collapseLandscapeCharacterDetailHeader =
    landscapePresentation &&
    activeActivity === 'characters' &&
    (characterView === 'detail' || characterView === 'expression');
  const hidePortraitShotChrome =
    hideSectionLabels && activeActivity === 'shots' && !landscapePresentation;
  const shotEditorPresentation: ShotEditorPresentation =
    hidePortraitShotChrome ? 'portrait' : 'default';

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
    if (narrow && drawerOpen && activity === activeActivity) {
      setDrawerOpen(false);
      return;
    }
    setInternalActivity(activity);
    onActiveActivityChange?.(activity);
    setDrawerOpen(true);
  };

  return (
    <section
      aria-label={
        hidePortraitShotChrome || collapseLandscapeCharacterDetailHeader
          ? activeLabel
          : undefined
      }
      aria-labelledby={
        hidePortraitShotChrome || collapseLandscapeCharacterDetailHeader
          ? undefined
          : 'resource-activity-heading'
      }
      className={`resource-activity-dock${drawerOpen ? ' resource-activity-dock-open' : ''}${landscapePresentation ? ' resource-activity-dock-landscape' : ''}`}
      data-resource-drawer-open={drawerOpen}
      data-resource-mode={narrow ? 'narrow' : 'wide'}
      data-resource-presentation={presentation}
      data-resource-shot-view={activeActivity === 'shots' ? shotView : undefined}
      data-active-activity={activeActivity}
      data-testid="resource-activity-dock"
    >
      {landscapePresentation ? (
        <nav
          aria-label="资源类型"
          className="resource-activity-rail"
          data-testid="resource-activity-rail"
        >
          {ACTIVITIES.map((activity) => {
            const active = activity.id === activeActivity;
            return (
              <button
                aria-controls="resource-activity-drawer"
                aria-expanded={active && drawerOpen}
                aria-label={`${active && drawerOpen ? '关闭' : '打开'}${activity.label}抽屉`}
                aria-pressed={active}
                className={active ? 'resource-activity-rail-active' : ''}
                data-activity={activity.id}
                data-testid={`resource-activity-rail-${activity.id}`}
                onClick={() => selectActivity(activity.id)}
                type="button"
              >
                <DecorativeIcon icon={activity.icon} size={20} />
                <strong>{activity.label}</strong>
              </button>
            );
          })}
        </nav>
      ) : (
        <button
          aria-controls="resource-activity-drawer"
          aria-expanded={drawerOpen}
          aria-label={drawerOpen ? '收起资源工作区' : '打开资源工作区'}
          className="resource-workspace-handle"
          data-testid="resource-workspace-handle"
          onClick={() => setDrawerOpen(!drawerOpen)}
          type="button"
        >
          <span>{drawerOpen ? '‹' : '›'}</span>
          <strong>资源</strong>
        </button>
      )}
      <div
        className="resource-activity-surface"
        data-testid="resource-activity-drawer"
        id="resource-activity-drawer"
      >
        {!collapseLandscapeCharacterDetailHeader ? (
          <div className="resource-activity-header">
          <div className="resource-activity-heading">
            {hidePortraitShotChrome ? null : (
              <div>
                {hideSectionLabels || landscapePresentation ? (
                  <h2 id="resource-activity-heading">{activeLabel}</h2>
                ) : (
                  <>
                    <p className="eyebrow">编辑资源</p>
                    <h2 id="resource-activity-heading">{activeLabel}工作区</h2>
                  </>
                )}
              </div>
            )}
            <div
              className="resource-activity-header-actions"
              data-resource-action-group={
                showLandscapeAssetActionGroup
                  ? 'asset-browser-landscape'
                  : hideLandscapeCharacterPrimaryAction
                    ? 'character-detail-landscape'
                  : showPortraitAssetActionGroup
                    ? 'asset-browser-portrait'
                    : undefined
              }
            >
              {hideLandscapeCharacterPrimaryAction ? null : (
                <button
                  className="resource-activity-primary-action"
                  data-resource-action={`${activeActivity}-${assetView === 'details' ? 'back' : primaryAction.label}`}
                  data-resource-action-layout={
                    showLandscapeAssetActionGroup
                      ? 'asset-browser-landscape'
                      : showPortraitAssetActionGroup
                        ? 'asset-browser'
                        : undefined
                  }
                  data-testid="resource-primary-action"
                  onClick={primaryAction.onClick}
                  type="button"
                >
                  {activeActivity === 'shots' && shotView !== 'create' ? (
                    <DecorativeIcon icon={CirclePlus} size={18} />
                  ) : null}
                  {activeActivity === 'assets' && assetView === 'browser' ? (
                    <DecorativeIcon icon={Upload} size={18} />
                  ) : null}
                  <span>{primaryAction.label}</span>
                </button>
              )}
              {showLandscapeAssetActionGroup ? (
                <button
                  aria-label="导入 FLA"
                  className="resource-activity-fla-action"
                  data-resource-action="assets-import-fla"
                  data-testid="resource-asset-import-fla"
                  onClick={() =>
                    setAssetFlaReviewRequest((value) => value + 1)
                  }
                  type="button"
                >
                  <DecorativeIcon icon={FileArchive} size={18} />
                  <span>导入 FLA</span>
                </button>
              ) : null}
              {showPortraitAssetActionGroup ? (
                <button
                  aria-label="导入 FLA"
                  className="resource-activity-fla-action"
                  data-resource-action="assets-import-fla"
                  data-testid="resource-asset-import-fla"
                  onClick={() =>
                    setAssetFlaReviewRequest((value) => value + 1)
                  }
                  type="button"
                >
                  <DecorativeIcon icon={FileArchive} size={18} />
                  <span>导入 FLA</span>
                </button>
              ) : null}
              {hidePortraitAssetsChrome ? null : hidePortraitShotChrome ? null : (
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
                  {landscapePresentation ? '×' : '关闭'}
                </button>
              )}
            </div>
          </div>
          {hideLocalActivityTabs ? null : (
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
          )}
          </div>
        ) : null}
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
                hideHeading={hideLocalActivityTabs}
                onViewChange={setShotView}
                presentation={
                  landscapePresentation ? 'landscape' : 'default'
                }
                shotEditorPresentation={shotEditorPresentation}
                snapshot={snapshot}
                view={shotView}
              />
            ) : activeActivity === 'assets' ? (
              <AssetLibrary
                closeRequestToken={assetReviewCloseRequest}
                flaReviewRequestToken={assetFlaReviewRequest}
                hideHeading={hideLocalActivityTabs}
                importRequestToken={assetImportRequest}
                onViewChange={setAssetView}
                presentation={
                  landscapePresentation
                    ? 'landscape'
                    : hidePortraitAssetsChrome
                      ? 'portrait'
                      : 'default'
                }
                snapshot={snapshot}
                view={assetView}
                showFlaAction={
                  !hidePortraitAssetsChrome && !landscapePresentation
                }
              />
            ) : (
              <CharacterManager
                hideHeading={landscapePresentation}
                onViewChange={setCharacterView}
                presentation={
                  landscapePresentation ? 'landscape' : 'default'
                }
                snapshot={snapshot}
                view={characterView}
                onCloseDrawer={() => setDrawerOpen(false)}
              />
            )}
          </div>
          {!landscapePresentation && auxiliaryContent ? (
            <div className="resource-activity-auxiliary">
              {auxiliaryContent}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
