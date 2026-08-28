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
        auxiliaryContent={shellMode === 'landscape' ? undefined : projectUtilities}
        activeActivity={activeActivity}
        drawerOpen={drawerOpen}
        onDrawerOpenChange={onDrawerOpenChange}
        compact={
          shellMode === undefined ? undefined : shellMode === 'landscape'
        }
        presentation={shellMode === 'landscape' ? 'landscape' : 'default'}
        key={`resource:${projectSnapshot.projectRoot}`}
        onActiveActivityChange={onActiveActivityChange}
        hideSectionLabels={shellMode === 'portrait'}
        snapshot={projectSnapshot}
      />
      {shellMode === 'landscape' ? (
        <details
          className="landscape-project-tools"
          data-testid="landscape-project-tools"
        >
          <summary>项目工具</summary>
          <div className="landscape-project-tools-body">
            {projectUtilities}
          </div>
        </details>
      ) : null}
    </aside>
  );
}
