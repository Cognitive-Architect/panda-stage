import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  MessageCircleMore,
  SlidersHorizontal,
  Video,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { DecorativeIcon } from '../ui';
import { editorProjectStore } from '../stores/EditorProjectStore';
import { shotStore } from '../stores/shotStore';
import { DialogueAuthoringDraft } from '../features/dialogue/dialogueAuthoringDraft';
import { DialogueSheet } from '../features/dialogue/DialogueSheet';
import {
  EMPTY_SCENE_CREATION_DRAFT,
  type SceneCreationCanvasPreview,
  type SceneCreationCanvasPreviewStatus,
  type SceneCreationDraft,
} from '../features/shots/createSceneFromStructuredInput';
import { usePendingDialoguePlacement } from '../features/timeline/PendingDialoguePlacement';
import { ProjectToolsDrawer, type ProjectToolsView } from './ProjectToolsDrawer';
import { RightInspector } from './RightInspector';

export interface SceneBackgroundImportResult {
  token: number;
  backgroundAssetId: string | null;
}

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
  autoCameraEnabled: boolean;
  onAutoCameraChange(enabled: boolean): void;
  sceneCanvasPreviewStatus?: SceneCreationCanvasPreviewStatus | null;
  onSceneCanvasPreviewChange?(
    preview: SceneCreationCanvasPreview | null,
  ): void;
  sceneBackgroundImportResult?: SceneBackgroundImportResult | null;
  onRequestSceneBackgroundImport?(): void;
  onRequestSceneCharacterLibrary?(): void;
}

export function RightWorkspace({
  autoCameraEnabled,
  onAutoCameraChange,
  sceneCanvasPreviewStatus = null,
  onSceneCanvasPreviewChange,
  sceneBackgroundImportResult = null,
  onRequestSceneBackgroundImport,
  onRequestSceneCharacterLibrary,
}: RightWorkspaceProps): React.JSX.Element {
  const projectSnapshot = useSyncExternalStore(
    editorProjectStore.subscribe,
    editorProjectStore.getSnapshot,
  );
  const currentShotId = useSyncExternalStore(
    shotStore.subscribe,
    shotStore.getCurrentShotId,
  );
  const [autoSubtitleDraft] = useState(() => new DialogueAuthoringDraft());
  const [autoSubtitleDraftResetNotice, setAutoSubtitleDraftResetNotice] =
    useState<string | null>(null);
  const [autoSubtitleGeneratedNotice, setAutoSubtitleGeneratedNotice] =
    useState<string | null>(null);
  const autoSubtitleGeneratedNoticeTimerRef = useRef<number | null>(null);
  const autoSubtitleIdentityRef = useRef<{
    projectRoot: string;
    shotId: string | null;
  } | null>(null);
  const projectRoot = projectSnapshot?.projectRoot ?? '';

  useLayoutEffect(() => {
    const nextIdentity = {
      projectRoot,
      shotId: currentShotId ?? null,
    };
    const previousIdentity = autoSubtitleIdentityRef.current;
    const draft = autoSubtitleDraft.getSnapshot();
    const hasDraft = Boolean(
      draft.batchRaw.trim() ||
        Object.keys(draft.batchMapping).length ||
        Object.keys(draft.batchAudioSelections).length,
    );
    const reset = autoSubtitleDraft.bindIdentity(nextIdentity);
    if (previousIdentity && reset && hasDraft) {
      setAutoSubtitleDraftResetNotice(
        previousIdentity.projectRoot !== nextIdentity.projectRoot
          ? '工程已切换，未提交的自动字幕草稿已清空。'
          : '镜头已切换，未提交的自动字幕草稿已清空。',
      );
    }
    if (
      previousIdentity &&
      (previousIdentity.projectRoot !== nextIdentity.projectRoot ||
        previousIdentity.shotId !== nextIdentity.shotId)
    ) {
      setAutoSubtitleGeneratedNotice(null);
    }
    autoSubtitleIdentityRef.current = nextIdentity;
  }, [autoSubtitleDraft, currentShotId, projectRoot]);

  useEffect(() => () => {
    if (autoSubtitleGeneratedNoticeTimerRef.current !== null) {
      window.clearTimeout(autoSubtitleGeneratedNoticeTimerRef.current);
    }
  }, []);

  const pendingPlacement = usePendingDialoguePlacement();
  const [activeActivity, setActiveActivity] =
    useState<RightActivity | null>(null);
  // Scene creation is a tool draft, not Project or History state. It survives
  // closing and reopening Project Tools for the same project session only; the
  // shell remounts this workspace when the project changes.
  const [toolsView, setToolsView] = useState<ProjectToolsView>('home');
  const [sceneCreationDraft, setSceneCreationDraft] = useState<SceneCreationDraft>(
    EMPTY_SCENE_CREATION_DRAFT,
  );
  const handledSceneImportTokenRef = useRef(0);
  const triggerRefs = useRef<Partial<Record<RightActivity, HTMLButtonElement>>>({});
  const surfaceRef = useRef<HTMLDivElement>(null);
  const previousActivityRef = useRef<RightActivity | null>(null);

  useLayoutEffect(() => {
    if (
      !sceneBackgroundImportResult ||
      sceneBackgroundImportResult.token === handledSceneImportTokenRef.current
    ) {
      return;
    }
    handledSceneImportTokenRef.current = sceneBackgroundImportResult.token;
    if (sceneBackgroundImportResult.backgroundAssetId) {
      const backgroundAssetId = sceneBackgroundImportResult.backgroundAssetId;
      setSceneCreationDraft((current) => ({
        ...current,
        backgroundAssetId,
      }));
    }
    // Return the user to Auto Scene inside the same tools surface they left.
    setToolsView('auto-scene');
    setActiveActivity('tools');
  }, [sceneBackgroundImportResult]);

  // Closing the surface returns the drawer to its home page, matching the
  // existing Auto Subtitles contract. Tool drafts stay with the workspace.
  const closeSurface = (): void => {
    setActiveActivity(null);
    setToolsView('home');
  };

  const handleAutoSubtitleGenerated = (generatedCount: number): void => {
    autoSubtitleDraft.clear();
    setAutoSubtitleDraftResetNotice(null);
    setAutoSubtitleGeneratedNotice(`已生成 ${generatedCount} 条字幕与配音`);
    setActiveActivity('subtitles');
    if (autoSubtitleGeneratedNoticeTimerRef.current !== null) {
      window.clearTimeout(autoSubtitleGeneratedNoticeTimerRef.current);
    }
    autoSubtitleGeneratedNoticeTimerRef.current = window.setTimeout(() => {
      autoSubtitleGeneratedNoticeTimerRef.current = null;
      setAutoSubtitleGeneratedNotice(null);
    }, 3_500);
  };

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
    // Leaving the tools surface returns it to the home page, so a later visit
    // never resumes a half-finished tool page by surprise.
    if (activity !== 'tools' || activeActivity === 'tools') setToolsView('home');
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
            <>
              {autoSubtitleGeneratedNotice ? (
                <p
                  className="auto-subtitle-generated-notice"
                  data-testid="auto-subtitle-generated-notice"
                  role="status"
                >
                  {autoSubtitleGeneratedNotice}
                </p>
              ) : null}
              <DialogueSheet
                onClose={closeSurface}
                pendingDragDialogueId={pendingPlacement.drag?.dialogueId ?? null}
                pendingTrayInteraction={pendingPlacement.interaction}
                presentation="right-workspace"
                unifiedTaskTray
              />
            </>
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
              autoSubtitleDraft={autoSubtitleDraft}
              autoSubtitleDraftResetNotice={autoSubtitleDraftResetNotice}
              onDismissAutoSubtitleDraftResetNotice={() =>
                setAutoSubtitleDraftResetNotice(null)
              }
              onAutoSubtitleGenerated={handleAutoSubtitleGenerated}
              onClose={closeSurface}
              onAutoSceneCommitted={closeSurface}
              onRequestSceneBackgroundImport={onRequestSceneBackgroundImport}
              onRequestSceneCharacterLibrary={onRequestSceneCharacterLibrary}
              onSceneCanvasPreviewChange={onSceneCanvasPreviewChange}
              onSceneCreationDraftChange={setSceneCreationDraft}
              onViewChange={setToolsView}
              sceneCanvasPreviewStatus={sceneCanvasPreviewStatus}
              sceneCreationDraft={sceneCreationDraft}
              scenePreviewActive={
                activeActivity === 'tools' && toolsView === 'auto-scene'
              }
              sceneSnapshot={projectSnapshot}
              view={toolsView}
            />
          )}
        </div>
      ) : null}
      <div className="right-rail-stack">
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
        <div aria-label="预览模式" className="right-mode-group" role="group">
          <button
            aria-label="自动运镜"
            aria-pressed={autoCameraEnabled}
            data-testid="right-mode-auto-camera"
            onClick={() => onAutoCameraChange(!autoCameraEnabled)}
            type="button"
          >
            <DecorativeIcon icon={Video} size={20} />
            <strong aria-hidden="true" className="right-mode-label">
              <span>自动</span>
              <span>运镜</span>
            </strong>
          </button>
        </div>
      </div>
    </aside>
  );
}
