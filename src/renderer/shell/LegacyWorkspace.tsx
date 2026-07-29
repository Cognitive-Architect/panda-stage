import { ActionPresetPanel } from '../features/actions/ActionPresetPanel';
import { CanvasStage } from '../features/canvas/CanvasStage';
import { ProjectRecoveryPanel } from '../features/recovery/ProjectRecoveryPanel';
import type { EditorProjectSnapshot } from '../stores/EditorProjectStore';

export interface LegacyWorkspaceProps {
  projectSnapshot: EditorProjectSnapshot;
  recentRefreshToken: number;
  onOpenRecentProject(
    projectRoot: string,
    expectedProjectId: string,
  ): Promise<void>;
}

export function LegacyWorkspace({
  projectSnapshot,
  recentRefreshToken,
  onOpenRecentProject,
}: LegacyWorkspaceProps): React.JSX.Element {
  return (
    <div
      aria-label="Legacy editor workspace"
      className="legacy-workspace"
      data-testid="legacy-workspace-scroll"
    >
      <section
        className="day25-action-shell"
        aria-label="Day 25 动作预设"
      >
        <ActionPresetPanel />
      </section>
      <section
        className="day25-editor-shell"
        aria-label="Day 25 编辑外壳"
      >
        <CanvasStage />
      </section>
      <ProjectRecoveryPanel
        onOpenRecentProject={onOpenRecentProject}
        projectSnapshot={projectSnapshot}
        recentRefreshToken={recentRefreshToken}
      />
    </div>
  );
}
