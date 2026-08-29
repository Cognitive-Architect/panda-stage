import { useEffect, useState } from 'react';
import type { EditorProjectSnapshot } from '../stores/EditorProjectStore';
import { ProjectRecoveryPanel } from '../features/recovery/ProjectRecoveryPanel';
import { ResourceActivityDock } from './ResourceActivityDock';
import type { ResourceActivity } from './ResourceActivityDock';
import { LegacyCompatibilityActivity } from './LegacyCompatibilityActivity';
import type { EditorShellLayoutMode } from './adaptiveEditorShell';
import { ProjectToolsDrawer } from './ProjectToolsDrawer';

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
  const [projectToolsOpen, setProjectToolsOpen] = useState(false);

  useEffect(() => {
    setProjectToolsOpen(false);
  }, [projectSnapshot.projectRoot]);

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
        onProjectToolsOpenChange={setProjectToolsOpen}
        presentation={shellMode === 'landscape' ? 'landscape' : 'default'}
        projectToolsContent={
          shellMode === 'landscape' ? (
            <ProjectToolsDrawer
              key={`project-tools:${projectSnapshot.projectRoot}`}
              onClose={() => setProjectToolsOpen(false)}
              onOpenRecentProject={onOpenRecentProject}
              projectSnapshot={projectSnapshot}
              recentRefreshToken={recentRefreshToken}
            />
          ) : undefined
        }
        projectToolsOpen={shellMode === 'landscape' && projectToolsOpen}
        snapshot={projectSnapshot}
      />
    </aside>
  );
}
