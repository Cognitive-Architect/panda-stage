import type { ReactNode } from 'react';
import { ArrowRight, Plus } from 'lucide-react';
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
            <h1 id="recovery-heading">项目</h1>
            <p className="project-launcher-lede">
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
              <p className="eyebrow">当前项目</p>
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
                    已保存
                  </span>
                )}
              </div>
              <code
                className="project-center-current-path"
                title={currentProject.projectRoot}
              >
                {currentProject.projectRoot}
              </code>
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
          <section
            aria-labelledby="project-launcher-welcome-heading"
            className="project-launcher-welcome"
            data-testid="project-launcher-welcome"
          >
            <div aria-hidden="true" className="project-launcher-welcome-mark">
              <DecorativeIcon icon={Plus} size={28} strokeWidth={1.7} />
            </div>
            <div className="project-launcher-welcome-content">
              <p className="eyebrow">从这里开始</p>
              <h2 id="project-launcher-welcome-heading">建立你的下一段故事</h2>
              <p>从这里开始你的新项目。创建一个项目，或打开你最近的工作。</p>
            </div>
          </section>
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
