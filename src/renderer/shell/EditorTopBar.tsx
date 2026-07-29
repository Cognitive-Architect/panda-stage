import type { ReactNode } from 'react';
import type { EditorProjectSnapshot } from '../stores/EditorProjectStore';

export interface EditorTopBarProps {
  projectSnapshot: EditorProjectSnapshot;
  projectRootInput: string;
  status: string;
  busy: boolean;
  recoveryBanner?: ReactNode;
  onProjectRootInputChange(value: string): void;
  onOpenProject(): Promise<void>;
  onSaveProject(): Promise<void>;
}

export function EditorTopBar({
  projectSnapshot,
  projectRootInput,
  status,
  busy,
  recoveryBanner,
  onProjectRootInputChange,
  onOpenProject,
  onSaveProject,
}: EditorTopBarProps): React.JSX.Element {
  return (
    <section
      aria-labelledby="recovery-heading"
      className="recovery-panel"
      data-testid="editor-top-bar"
    >
      <div className="recovery-heading-row">
        <div>
          <p className="eyebrow">{projectSnapshot.project.name}</p>
          <h2 id="recovery-heading">Crash recovery</h2>
        </div>
        <span className={projectSnapshot.dirty ? 'dirty-state' : 'clean-state'}>
          {projectSnapshot.dirty ? 'Unsaved recovered changes' : 'Clean'}
        </span>
      </div>
      <div className="recovery-open-row">
        <label>
          Project directory
          <input
            onChange={(event) =>
              onProjectRootInputChange(event.target.value)
            }
            placeholder="D:\Projects\story.pandastage"
            value={projectRootInput}
          />
        </label>
        <button
          disabled={busy || !projectRootInput.trim()}
          onClick={() => void onOpenProject()}
          type="button"
        >
          Open and check recovery
        </button>
      </div>
      {recoveryBanner}
      <div className="recovery-status-row">
        <output>{status}</output>
        <button
          className="editor-save-button"
          disabled={busy || !projectSnapshot.dirty}
          onClick={() => void onSaveProject()}
          type="button"
        >
          Save recovered project
        </button>
        <button
          data-testid="product-preview-placeholder"
          disabled
          type="button"
        >
          产品预览（后续阶段启用）
        </button>
      </div>
    </section>
  );
}
