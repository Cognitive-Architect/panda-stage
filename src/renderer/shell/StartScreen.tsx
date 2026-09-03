import type { ReactNode } from 'react';
import { ArrowRight, Box, Check } from 'lucide-react';
import { RecentProjectsPanel } from '../features/welcome/RecentProjectsPanel';
import { DecorativeIcon } from '../ui';
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
  onOpenProjectFromChooser?(): Promise<void>;
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
  onOpenProjectFromChooser,
  onOpenProject,
  onOpenRecentProject,
  onRequestNewProject,
  currentProject = null,
  onReturnToEditor,
  recoveryBanner,
}: StartScreenProps): React.JSX.Element {
  const openProjectFromChooser =
    onOpenProjectFromChooser ?? onChooseProjectDirectory;

  return (
    <>
      <section
        aria-labelledby="recovery-heading"
        className="recovery-panel"
        data-project-launcher-panel="true"
        data-project-launcher-state={
          currentProject ? 'current-project' : 'no-project'
        }
      >
        <header className="project-launcher-header">
          <div className="project-launcher-identity">
            <p className="eyebrow">PANDA STAGE</p>
            <p className="project-launcher-lede" id="recovery-heading">
              <span className="project-launcher-state-copy">
                {currentProject ? '欢迎回来，' : '开始创作，'}
              </span>
              <span>
                {currentProject
                  ? '继续你的创作'
                  : '新建一个项目，或继续最近的工作'}
              </span>
            </p>
          </div>
        </header>

        {recoveryBanner}

        {currentProject ? (
          <section
            aria-labelledby="project-center-current-heading"
            className="project-center-current-project launcher-current-project"
            data-testid="project-center-current-project"
          >
            <div className="launcher-current-project-copy">
              <p className="eyebrow launcher-current-project-label">
                <span
                  aria-hidden="true"
                  className="launcher-current-project-glyph"
                >
                  <DecorativeIcon icon={Box} size={14} strokeWidth={1.9} />
                </span>
                <span>当前项目</span>
              </p>
              <h3 id="project-center-current-heading">
                {currentProject.project.name}
              </h3>
              <div className="launcher-current-project-meta">
                {currentProject.dirty ? (
                  <span
                    className="dirty-state"
                    data-testid="project-center-save-state"
                  >
                    有未保存更改
                  </span>
                ) : (
                  <span
                    className="clean-state"
                    data-testid="project-center-save-state"
                  >
                    <DecorativeIcon
                      className="launcher-save-state-icon"
                      icon={Check}
                      size={13}
                      strokeWidth={2.5}
                    />
                    <span>已保存</span>
                  </span>
                )}
                <code
                  className="project-center-current-path"
                  title={currentProject.projectRoot}
                >
                  {currentProject.projectRoot}
                </code>
              </div>
            </div>
            <button
              className="launcher-continue-button task4-hit-target"
              data-task4-core="return-to-editor"
              data-testid="return-to-editor"
              disabled={!onReturnToEditor}
              onClick={onReturnToEditor}
              type="button"
            >
              <span>继续创作</span>
              <DecorativeIcon icon={ArrowRight} size={19} strokeWidth={2.2} />
            </button>
          </section>
        ) : (
          <div
            aria-hidden="true"
            className="project-launcher-banner"
            data-testid="project-launcher-banner"
          />
        )}

        <NewProjectEntry
          busy={busy}
          hasCurrentProject={Boolean(currentProject)}
          newProjectDialogOpen={newProjectDialogOpen}
          onChooseProjectDirectory={onChooseProjectDirectory}
          onOpenProjectFromChooser={openProjectFromChooser}
          onOpenProject={onOpenProject}
          onOpenCandidatePathChange={onOpenCandidatePathChange}
          onRequestNewProject={onRequestNewProject}
          openCandidatePath={openCandidatePath}
        />
        <output
          aria-live="polite"
          className="project-launcher-status"
          data-testid="project-launcher-status"
        >
          {status}
        </output>
      </section>
      <RecentProjectsPanel
        onOpenProject={onOpenRecentProject}
        presentation="launcher"
        refreshToken={recentRefreshToken}
      />
    </>
  );
}
