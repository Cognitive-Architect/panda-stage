import type { ReactNode } from 'react';
import type { EditorProjectSnapshot } from '../stores/EditorProjectStore';
import { validateProjectOpenCandidate } from './projectOpenFlow';

export interface EditorTopBarProps {
  projectSnapshot: EditorProjectSnapshot;
  openCandidatePath: string;
  status: string;
  busy: boolean;
  productPreviewOpen: boolean;
  closeConfirmOpen: boolean;
  recoveryBanner?: ReactNode;
  onOpenCandidatePathChange(value: string): void;
  onChooseProjectDirectory(): Promise<void>;
  onOpenProject(): Promise<void>;
  onOpenProjectCenter?(): void;
  onSaveProject(): Promise<void>;
  onOpenProductPreview(): void;
  onRequestCloseProject(): void;
}

export function EditorTopBar({
  projectSnapshot,
  openCandidatePath,
  status,
  busy,
  productPreviewOpen,
  closeConfirmOpen,
  recoveryBanner,
  onOpenCandidatePathChange,
  onChooseProjectDirectory,
  onOpenProjectCenter = () => undefined,
  onOpenProject,
  onSaveProject,
  onOpenProductPreview,
  onRequestCloseProject,
}: EditorTopBarProps): React.JSX.Element {
  const validation = validateProjectOpenCandidate(
    openCandidatePath,
    projectSnapshot.projectRoot,
  );
  return (
    <section
      aria-labelledby="recovery-heading"
      className="recovery-panel"
      data-testid="editor-top-bar"
    >
      <div className="recovery-heading-row">
        <div>
          <p className="eyebrow">{projectSnapshot.project.name}</p>
          <h2 id="recovery-heading">项目编辑</h2>
        </div>
        <span className={projectSnapshot.dirty ? 'dirty-state' : 'clean-state'}>
          {projectSnapshot.dirty ? '有未保存的更改' : '暂无未保存更改'}
        </span>
      </div>
      <div className="active-project-path" data-testid="active-project-path">
        <span>当前项目文件夹</span>
        <code>{projectSnapshot.projectRoot}</code>
      </div>
      <div className="recovery-open-row">
        <label>
          打开其他 .pandastage 项目文件夹
          <input
            onChange={(event) =>
              onOpenCandidatePathChange(event.target.value)
            }
            placeholder="输入另一个项目文件夹路径"
            value={openCandidatePath}
          />
          <small className="open-path-hint">{validation.message}</small>
        </label>
        <button
          disabled={busy || !validation.valid}
          onClick={() => void onOpenProject()}
          type="button"
        >
          打开项目
        </button>
        <button
          className="choose-project-directory-button"
          data-testid="choose-project-directory"
          disabled={busy}
          onClick={() => void onChooseProjectDirectory()}
          type="button"
        >
          浏览…
        </button>
      </div>
      {recoveryBanner}
      <div className="recovery-status-row">
        <output>{status}</output>
        <button
          className="project-center-button"
          data-testid="open-project-center"
          disabled={busy || closeConfirmOpen}
          onClick={onOpenProjectCenter}
          type="button"
        >
          项目中心
        </button>
        <button
          className="editor-save-button"
          disabled={busy || !projectSnapshot.dirty}
          onClick={() => void onSaveProject()}
          type="button"
        >
          保存整个项目
        </button>
        <button
          className="product-preview-button"
          data-testid="product-preview-open"
          disabled={busy || productPreviewOpen}
          onClick={onOpenProductPreview}
          type="button"
        >
          产品预览
        </button>
        <button
          className="close-project-button"
          data-testid="close-project-open"
          disabled={busy || closeConfirmOpen}
          onClick={onRequestCloseProject}
          type="button"
        >
          关闭当前项目
        </button>
      </div>
    </section>
  );
}
