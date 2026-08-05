import { useEffect, useRef, useState } from 'react';
import type { EditorProjectSnapshot } from '../stores/EditorProjectStore';

export type CompactProjectSaveState =
  | 'saved'
  | 'dirty'
  | 'saving'
  | 'failed';

export interface CompactProjectBarProps {
  projectSnapshot: EditorProjectSnapshot;
  saveState: CompactProjectSaveState;
  status: string;
  busy: boolean;
  productPreviewOpen: boolean;
  closeConfirmOpen: boolean;
  onOpenProjectCenter(): void;
  onOpenProjectFolder(): Promise<void>;
  onSaveProject(): Promise<void>;
  onOpenProductPreview(): void;
  onRequestCloseProject(): void;
}

const SAVE_STATE_LABELS: Record<CompactProjectSaveState, string> = {
  saved: '已保存',
  dirty: '有未保存更改',
  saving: '保存中',
  failed: '保存失败',
};

export function CompactProjectBar({
  projectSnapshot,
  saveState,
  status,
  busy,
  productPreviewOpen,
  closeConfirmOpen,
  onOpenProjectCenter,
  onOpenProjectFolder,
  onSaveProject,
  onOpenProductPreview,
  onRequestCloseProject,
}: CompactProjectBarProps): React.JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return undefined;

    const closeOnOutsidePointer = (event: PointerEvent): void => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [menuOpen]);

  const closeMenu = (): void => setMenuOpen(false);
  const saveDisabled =
    busy || saveState === 'saving' || !projectSnapshot.dirty;
  const saveStateLabel = SAVE_STATE_LABELS[saveState];
  const saveStateSemanticClass =
    saveState === 'saved' ? 'clean-state' : 'dirty-state';

  return (
    <section
      aria-label="当前项目状态"
      className="compact-project-bar"
      data-save-state={saveState}
      data-testid="compact-project-bar"
    >
      <div className="compact-project-identity">
        <button
          className="compact-project-center-button"
          data-testid="open-project-center"
          disabled={busy || closeConfirmOpen}
          onClick={onOpenProjectCenter}
          type="button"
        >
          项目中心
        </button>
        <div className="compact-project-details">
          <span className="eyebrow">当前项目</span>
          <strong
            className="compact-project-name"
            title={projectSnapshot.project.name}
          >
            {projectSnapshot.project.name}
          </strong>
          <span
            className="compact-project-path"
            data-testid="active-project-path"
            title={projectSnapshot.projectRoot}
          >
            <code>{projectSnapshot.projectRoot}</code>
          </span>
        </div>
      </div>

      <div className="compact-project-controls recovery-status-row">
        <span
          aria-live="polite"
          className={`compact-project-save-state compact-project-save-state-${saveState} ${saveStateSemanticClass}`}
          data-testid="project-save-state"
          title={status}
        >
          {saveStateLabel}
        </span>
        <output
          aria-live="polite"
          className="compact-project-feedback"
          data-testid="editor-action-status"
          title={status}
        >
          {status}
        </output>
        <button
          aria-label="保存整个项目"
          className="editor-save-button"
          data-testid="compact-project-save"
          disabled={saveDisabled}
          onClick={() => void onSaveProject()}
          type="button"
        >
          保存
        </button>
        <div className="compact-project-menu-wrap" ref={menuRef}>
          <button
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            className="compact-project-more-button"
            data-testid="compact-project-more"
            disabled={busy}
            onClick={() => setMenuOpen((open) => !open)}
            type="button"
          >
            更多 <span aria-hidden="true">⋯</span>
          </button>
          {menuOpen ? (
            <div
              aria-label="项目操作"
              className="compact-project-menu"
              data-testid="compact-project-menu"
              role="menu"
            >
              <button
                data-testid="menu-open-project-center"
                onClick={() => {
                  closeMenu();
                  onOpenProjectCenter();
                }}
                role="menuitem"
                type="button"
              >
                打开项目中心
              </button>
              <button
                data-testid="menu-open-project-folder"
                onClick={() => {
                  closeMenu();
                  void onOpenProjectFolder();
                }}
                role="menuitem"
                type="button"
              >
                打开项目文件夹
              </button>
              <button
                data-testid="menu-open-product-preview"
                disabled={productPreviewOpen}
                onClick={() => {
                  closeMenu();
                  onOpenProductPreview();
                }}
                role="menuitem"
                type="button"
              >
                产品预览
              </button>
              <button
                data-testid="menu-close-project"
                disabled={closeConfirmOpen}
                onClick={() => {
                  closeMenu();
                  onRequestCloseProject();
                }}
                role="menuitem"
                type="button"
              >
                关闭当前项目
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
