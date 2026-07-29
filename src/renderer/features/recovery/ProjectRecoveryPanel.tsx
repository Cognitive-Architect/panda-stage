import type { EditorProjectSnapshot } from '../../stores/EditorProjectStore';
import { RecentProjectsPanel } from '../welcome/RecentProjectsPanel';
import { AssetLibrary } from '../assets/AssetLibrary';
import { CharacterManager } from '../characters/CharacterManager';
import { ShotManager } from '../shots/ShotManager';
import { CanvasStage } from '../canvas/CanvasStage';

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
      <AssetLibrary snapshot={props.projectSnapshot} />
      <CharacterManager snapshot={props.projectSnapshot} />
      <ShotManager snapshot={props.projectSnapshot} />
      <CanvasStage />
    </>
  );
}
