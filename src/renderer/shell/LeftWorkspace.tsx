import type { EditorProjectSnapshot } from '../stores/EditorProjectStore';
import { ProjectRecoveryPanel } from '../features/recovery/ProjectRecoveryPanel';
import { ResourceActivityDock } from './ResourceActivityDock';
import type { ResourceActivity } from './ResourceActivityDock';
import type {
  SceneCreationCanvasPreview,
  SceneCreationCanvasPreviewStatus,
} from '../features/shots/createSceneFromStructuredInput';
import { LegacyCompatibilityActivity } from './LegacyCompatibilityActivity';
import type { EditorShellLayoutMode } from './adaptiveEditorShell';

export interface LeftWorkspaceProps {
  projectSnapshot: EditorProjectSnapshot;
  recentRefreshToken: number;
  shellMode?: EditorShellLayoutMode;
  drawerOpen?: boolean;
  onDrawerOpenChange?(open: boolean): void;
  activeActivity?: ResourceActivity;
  onActiveActivityChange?(activity: ResourceActivity): void;
  projectSessionIdentity?: string;
  onSceneBackgroundImportComplete?(importedAssetIds: readonly string[]): string | null;
  sceneCanvasPreviewStatus?: SceneCreationCanvasPreviewStatus | null;
  onSceneCanvasPreviewChange?: (
    preview: SceneCreationCanvasPreview | null,
  ) => void;
  onOpenRecentProject(
    projectRoot: string,
    expectedProjectId: string,
  ): Promise<void>;
}

export function LeftWorkspace({
  projectSnapshot,
  recentRefreshToken,
  shellMode,
  drawerOpen,
  onDrawerOpenChange,
  activeActivity,
  onActiveActivityChange,
  projectSessionIdentity,
  onSceneBackgroundImportComplete,
  sceneCanvasPreviewStatus,
  onSceneCanvasPreviewChange,
  onOpenRecentProject,
}: LeftWorkspaceProps): React.JSX.Element {
  const projectUtilities = (
    <>
      <ProjectRecoveryPanel
        onOpenRecentProject={onOpenRecentProject}
        projectSnapshot={projectSnapshot}
        recentRefreshToken={recentRefreshToken}
      />
      <LegacyCompatibilityActivity
        key={`compatibility:${projectSnapshot.projectRoot}`}
        projectRoot={projectSnapshot.projectRoot}
      />
    </>
  );

  return (
    <aside
      aria-label="左侧工作区"
      className="left-workspace"
      data-testid="left-workspace-scroll"
    >
      <ResourceActivityDock
        activeActivity={activeActivity}
        auxiliaryContent={shellMode === 'landscape' ? undefined : projectUtilities}
        compact={
          shellMode === undefined ? undefined : shellMode === 'landscape'
        }
        drawerOpen={drawerOpen}
        hideSectionLabels={shellMode === 'portrait'}
        key={`resource:${projectSnapshot.projectRoot}`}
        onActiveActivityChange={onActiveActivityChange}
        onDrawerOpenChange={onDrawerOpenChange}
        projectSessionIdentity={projectSessionIdentity}
        onSceneBackgroundImportComplete={onSceneBackgroundImportComplete}
        sceneCanvasPreviewStatus={sceneCanvasPreviewStatus}
        onSceneCanvasPreviewChange={onSceneCanvasPreviewChange}
        presentation={shellMode === 'landscape' ? 'landscape' : 'default'}
        snapshot={projectSnapshot}
      />
    </aside>
  );
}
