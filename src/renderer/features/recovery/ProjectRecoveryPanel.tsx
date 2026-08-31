import type { EditorProjectSnapshot } from '../../stores/EditorProjectStore';
import {
  RecentProjectsPanel,
  type RecentProjectsPanelPresentation,
} from '../welcome/RecentProjectsPanel';

export interface ProjectRecoveryPanelProps {
  projectSnapshot: EditorProjectSnapshot;
  recentRefreshToken: number;
  presentation?: RecentProjectsPanelPresentation;
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
        presentation={props.presentation}
        refreshToken={props.recentRefreshToken}
      />
    </>
  );
}
