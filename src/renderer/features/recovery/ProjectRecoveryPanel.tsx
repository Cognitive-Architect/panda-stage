import type { EditorProjectSnapshot } from '../../stores/EditorProjectStore';
import { RecentProjectsPanel } from '../welcome/RecentProjectsPanel';

export interface ProjectRecoveryPanelProps {
  projectSnapshot: EditorProjectSnapshot;
  recentRefreshToken: number;
  onOpenRecentProject(
    projectRoot: string,
    expectedProjectId: string,
  ): Promise<void>;
}

export function ProjectRecoveryPanel(
  props: ProjectRecoveryPanelProps,
): React.JSX.Element {
  return (
    <>
      <RecentProjectsPanel
        onOpenProject={props.onOpenRecentProject}
        refreshToken={props.recentRefreshToken}
      />
    </>
  );
}
