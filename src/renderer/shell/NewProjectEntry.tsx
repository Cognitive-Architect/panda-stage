import { FolderOpen, Plus } from 'lucide-react';
import { useState } from 'react';
import { DecorativeIcon } from '../ui';
import { validateProjectOpenCandidate } from './projectOpenFlow';

export interface NewProjectEntryProps {
  openCandidatePath: string;
  busy: boolean;
  hasCurrentProject?: boolean;
  newProjectDialogOpen: boolean;
  onOpenCandidatePathChange(value: string): void;
  onChooseProjectDirectory(): Promise<void>;
  onOpenProjectFromChooser?(): Promise<void>;
  onOpenProject(): Promise<void>;
  onRequestNewProject(): void;
}

export function NewProjectEntry({
  openCandidatePath,
  busy,
  hasCurrentProject = false,
  newProjectDialogOpen,
  onOpenCandidatePathChange,
  onChooseProjectDirectory,
  onOpenProjectFromChooser,
  onOpenProject,
  onRequestNewProject,
}: NewProjectEntryProps): React.JSX.Element {
  const validation = validateProjectOpenCandidate(openCandidatePath);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const openProjectFromChooser =
    onOpenProjectFromChooser ?? onChooseProjectDirectory;

  return (
    <>
      <div
        aria-label="项目操作"
        className="project-launcher-actions"
        data-testid="project-launcher-actions"
      >
        <button
          className={`launcher-action-tile launcher-action-new new-project-button task4-hit-target${
            !hasCurrentProject ? ' launcher-action-primary' : ''
          }`}
          data-task4-core="new-project"
          data-testid="new-project-button"
          disabled={busy || newProjectDialogOpen}
          onClick={onRequestNewProject}
          type="button"
        >
          <span aria-hidden="true" className="launcher-action-icon">
            <DecorativeIcon icon={Plus} size={22} strokeWidth={2.1} />
          </span>
          <span className="launcher-action-copy">
            <strong>新建项目</strong>
            <small>从一个空白项目开始</small>
          </span>
        </button>
        <button
          className="launcher-action-tile launcher-action-open launcher-open-project-button task4-hit-target"
          data-task4-core="open-project"
          data-testid="open-project"
          disabled={busy}
          onClick={() => void openProjectFromChooser()}
          type="button"
        >
          <span aria-hidden="true" className="launcher-action-icon">
            <DecorativeIcon icon={FolderOpen} size={22} strokeWidth={1.9} />
          </span>
          <span className="launcher-action-copy">
            <strong>打开项目</strong>
            <small>打开已有 Panda Stage 项目</small>
          </span>
        </button>
      </div>

      <details
        className="launcher-advanced-open"
        data-testid="launcher-advanced-open"
        open={advancedOpen}
        onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
      >
        <summary>更多打开方式</summary>
        <div className="recovery-open-row">
          <label>
            <span className="launcher-advanced-field-label">
              通过项目路径打开
            </span>
            <span className="launcher-advanced-field-note">
              项目文件夹（.pandastage）
            </span>
            <input
              onChange={(event) =>
                onOpenCandidatePathChange(event.target.value)
              }
              placeholder="输入 .pandastage 项目文件夹的完整路径"
              value={openCandidatePath}
            />
            <small className="open-path-hint">{validation.message}</small>
          </label>
          <button
            disabled={busy || !validation.valid}
            className="task4-hit-target"
            data-task4-core="open-project-path"
            data-testid="open-project-path"
            onClick={() => void onOpenProject()}
            type="button"
          >
            打开项目
          </button>
          <button
            className="choose-project-directory-button task4-hit-target"
            data-task4-core="choose-project-directory"
            data-testid="choose-project-directory"
            disabled={busy}
            onClick={() => void onChooseProjectDirectory()}
            type="button"
          >
            浏览…
          </button>
        </div>
      </details>
    </>
  );
}
