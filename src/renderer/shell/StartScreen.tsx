import { RecentProjectsPanel } from '../features/welcome/RecentProjectsPanel';
import { NewProjectEntry } from './NewProjectEntry';

export interface StartScreenProps {
  openCandidatePath: string;
  status: string;
  busy: boolean;
  recentRefreshToken: number;
  newProjectDialogOpen: boolean;
  onOpenCandidatePathChange(value: string): void;
  onChooseProjectDirectory(): Promise<void>;
  onOpenProject(): Promise<void>;
  onOpenRecentProject(
    projectRoot: string,
    expectedProjectId: string,
  ): Promise<void>;
  onRequestNewProject(): void;
}

export function StartScreen({
  openCandidatePath,
  status,
  busy,
  recentRefreshToken,
  newProjectDialogOpen,
  onOpenCandidatePathChange,
  onChooseProjectDirectory,
  onOpenProject,
  onOpenRecentProject,
  onRequestNewProject,
}: StartScreenProps): React.JSX.Element {
  return (
    <>
      <section className="recovery-panel" aria-labelledby="recovery-heading">
        <div className="recovery-heading-row">
          <div>
            <p className="eyebrow">Panda Stage</p>
            <h2 id="recovery-heading">打开项目</h2>
          </div>
          <span className="clean-state">未打开项目</span>
        </div>
        <NewProjectEntry
          busy={busy}
          newProjectDialogOpen={newProjectDialogOpen}
          onChooseProjectDirectory={onChooseProjectDirectory}
          onOpenProject={onOpenProject}
          onOpenCandidatePathChange={onOpenCandidatePathChange}
          onRequestNewProject={onRequestNewProject}
          openCandidatePath={openCandidatePath}
        />
        <output>{status}</output>
      </section>
      <RecentProjectsPanel
        onOpenProject={onOpenRecentProject}
        refreshToken={recentRefreshToken}
      />
    </>
  );
}
