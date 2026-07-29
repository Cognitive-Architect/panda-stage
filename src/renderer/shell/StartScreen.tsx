import { RecentProjectsPanel } from '../features/welcome/RecentProjectsPanel';
import { NewProjectEntry } from './NewProjectEntry';

export interface StartScreenProps {
  openCandidatePath: string;
  status: string;
  busy: boolean;
  recentRefreshToken: number;
  onOpenCandidatePathChange(value: string): void;
  onOpenProject(): Promise<void>;
  onOpenRecentProject(
    projectRoot: string,
    expectedProjectId: string,
  ): Promise<void>;
}

export function StartScreen({
  openCandidatePath,
  status,
  busy,
  recentRefreshToken,
  onOpenCandidatePathChange,
  onOpenProject,
  onOpenRecentProject,
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
          onOpenProject={onOpenProject}
          onOpenCandidatePathChange={onOpenCandidatePathChange}
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
