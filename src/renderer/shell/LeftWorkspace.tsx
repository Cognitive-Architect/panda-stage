import type { EditorProjectSnapshot } from '../stores/EditorProjectStore';
import { ProjectRecoveryPanel } from '../features/recovery/ProjectRecoveryPanel';
import { ResourceActivityDock } from './ResourceActivityDock';

export interface LeftWorkspaceProps {
  projectSnapshot: EditorProjectSnapshot;
  recentRefreshToken: number;
  onOpenRecentProject(
    projectRoot: string,
    expectedProjectId: string,
  ): Promise<void>;
}

export function LeftWorkspace({
  projectSnapshot,
  recentRefreshToken,
  onOpenRecentProject,
}: LeftWorkspaceProps): React.JSX.Element {
  return (
    <aside
      aria-label="左侧工作区"
      className="left-workspace"
      data-testid="left-workspace-scroll"
    >
      <ProjectRecoveryPanel
        onOpenRecentProject={onOpenRecentProject}
        projectSnapshot={projectSnapshot}
        recentRefreshToken={recentRefreshToken}
      />
      <ResourceActivityDock
        key={projectSnapshot.projectRoot}
        snapshot={projectSnapshot}
      />
    </aside>
  );
}
