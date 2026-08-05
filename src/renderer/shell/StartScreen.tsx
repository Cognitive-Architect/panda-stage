import type { ReactNode } from 'react';
import { RecentProjectsPanel } from '../features/welcome/RecentProjectsPanel';
import { NewProjectEntry } from './NewProjectEntry';

export interface ProjectCenterCurrentProject {
  projectRoot: string;
  project: {
    name: string;
  };
  dirty: boolean;
}

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
  currentProject?: ProjectCenterCurrentProject | null;
  onReturnToEditor?(): void;
  recoveryBanner?: ReactNode;
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
  currentProject = null,
  onReturnToEditor,
  recoveryBanner,
}: StartScreenProps): React.JSX.Element {
  return (
    <>
      <section className="recovery-panel" aria-labelledby="recovery-heading">
        <div className="recovery-heading-row">
          <div>
            <p className="eyebrow">Panda Stage</p>
            <h2 id="recovery-heading">项目中心</h2>
          </div>
          <span className="clean-state">
            {currentProject ? '当前项目仍保持打开' : '未打开项目'}
          </span>
        </div>
        {currentProject ? (
          <section
            className="project-center-current-project"
            data-testid="project-center-current-project"
            aria-labelledby="project-center-current-heading"
          >
            <div>
              <p className="eyebrow">当前项目</p>
              <h3 id="project-center-current-heading">
                {currentProject.project.name}
              </h3>
              <code
                className="project-center-current-path"
                title={currentProject.projectRoot}
              >
                {currentProject.projectRoot}
              </code>
              <span
                className={
                  currentProject.dirty ? 'dirty-state' : 'clean-state'
                }
              >
                {currentProject.dirty ? '有未保存更改' : '已保存'}
              </span>
            </div>
            <button
              data-testid="return-to-editor"
              disabled={!onReturnToEditor}
              onClick={onReturnToEditor}
              type="button"
            >
              返回编辑器
            </button>
          </section>
        ) : null}
        <NewProjectEntry
          busy={busy}
          newProjectDialogOpen={newProjectDialogOpen}
          onChooseProjectDirectory={onChooseProjectDirectory}
          onOpenProject={onOpenProject}
          onOpenCandidatePathChange={onOpenCandidatePathChange}
          onRequestNewProject={onRequestNewProject}
          openCandidatePath={openCandidatePath}
        />
        {recoveryBanner}
        <output>{status}</output>
      </section>
      <RecentProjectsPanel
        onOpenProject={onOpenRecentProject}
        refreshToken={recentRefreshToken}
      />
    </>
  );
}
