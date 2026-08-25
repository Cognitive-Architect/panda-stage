import type { EditorProjectSnapshot } from '../stores/EditorProjectStore';
import { ProjectRecoveryPanel } from '../features/recovery/ProjectRecoveryPanel';
import { ResourceActivityDock } from './ResourceActivityDock';
import type { ResourceActivity } from './ResourceActivityDock';
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
  onOpenRecentProject,
}: LeftWorkspaceProps): React.JSX.Element {
  return (
    <aside
      aria-label="左侧工作区"
      className="left-workspace"
      data-testid="left-workspace-scroll"
    >
      <ResourceActivityDock
        auxiliaryContent={
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
        }
        activeActivity={activeActivity}
        drawerOpen={drawerOpen}
        onDrawerOpenChange={onDrawerOpenChange}
        compact={
          shellMode === undefined ? undefined : shellMode === 'landscape'
        }
        key={`resource:${projectSnapshot.projectRoot}`}
        onActiveActivityChange={onActiveActivityChange}
        snapshot={projectSnapshot}
      />
    </aside>
  );
}
