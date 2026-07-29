import { RecentProjectsPanel } from '../features/welcome/RecentProjectsPanel';
import { NewProjectEntry } from './NewProjectEntry';

export interface StartScreenProps {
  projectRootInput: string;
  status: string;
  busy: boolean;
  recentRefreshToken: number;
  onProjectRootInputChange(value: string): void;
  onOpenProject(): Promise<void>;
  onOpenRecentProject(
    projectRoot: string,
    expectedProjectId: string,
  ): Promise<void>;
}

export function StartScreen({
  projectRootInput,
  status,
  busy,
  recentRefreshToken,
  onProjectRootInputChange,
  onOpenProject,
  onOpenRecentProject,
}: StartScreenProps): React.JSX.Element {
  return (
    <>
      <section className="recovery-panel" aria-labelledby="recovery-heading">
        <div className="recovery-heading-row">
          <div>
            <p className="eyebrow">Panda Stage project</p>
            <h2 id="recovery-heading">Crash recovery</h2>
          </div>
          <span className="clean-state">Clean</span>
        </div>
        <NewProjectEntry
          busy={busy}
          onOpenProject={onOpenProject}
          onProjectRootInputChange={onProjectRootInputChange}
          projectRootInput={projectRootInput}
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
