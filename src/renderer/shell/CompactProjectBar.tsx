import { useEffect, useRef, useState } from 'react';
import { HistoryControls } from '../features/editor/HistoryControls';
import type { EditorProjectSnapshot } from '../stores/EditorProjectStore';
import { Button, PanelSurface } from '../ui';
import { MoreHorizontal, Save } from 'lucide-react';
import {
  EDITOR_DEVICE_MODE_OPTIONS,
  type EditorDeviceMode,
  type EditorShellLayoutMode,
} from './adaptiveEditorShell';

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
  deviceMode: EditorDeviceMode;
  onDeviceModeChange(mode: EditorDeviceMode): void;
  presentation?: EditorShellLayoutMode;
}

const SAVE_STATE_LABELS: Record<CompactProjectSaveState, string> = {
  saved: '已保存',
  dirty: '有未保存更改',
  saving: '保存中',
  failed: '保存失败',
};

const QUIET_STATUS_MESSAGES = new Set([
  'Ready',
  '项目已打开，暂无未保存更改。',
  '已从最近项目打开，暂无未保存更改。',
  '新项目已创建并打开，暂无未保存更改。',
  '已返回编辑器，当前镜头与编辑状态保持不变。',
  '已打开项目文件夹。',
  '项目已保存。',
  '已取消关闭，当前项目保持打开。',
  '已忽略本次恢复内容，恢复文件仍保留。',
]);

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
  deviceMode,
  onDeviceModeChange,
  presentation = 'landscape',
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
  const isPortrait = presentation === 'portrait';
  const showFeedback =
    Boolean(status.trim()) && !QUIET_STATUS_MESSAGES.has(status.trim());

  return (
    <PanelSurface
      aria-label="当前项目状态"
      className="compact-project-bar"
      data-presentation={presentation}
      data-save-state={saveState}
      data-testid="compact-project-bar"
    >
      <div className="compact-project-identity">
        <div
          className="compact-project-details"
          title={!isPortrait ? projectSnapshot.projectRoot : undefined}
        >
          <strong
            className="compact-project-name"
            title={projectSnapshot.project.name}
          >
            {projectSnapshot.project.name}
          </strong>
          {!isPortrait ? (
            <span
              aria-label="Project path"
              className="compact-project-path-visually-hidden"
              data-testid="active-project-path"
            >
              <code>{projectSnapshot.projectRoot}</code>
            </span>
          ) : null}
        </div>
      </div>

      <div className="compact-project-controls recovery-status-row">
        <HistoryControls presentation="compact" />
        {!isPortrait || saveState !== 'saved' ? (
          <span
            aria-live="polite"
            className={`compact-project-save-state compact-project-save-state-${saveState} ${saveStateSemanticClass}`}
            data-testid="project-save-state"
            title={showFeedback ? status : undefined}
          >
            {saveStateLabel}
          </span>
        ) : null}
        {showFeedback ? (
          <output
            aria-live="polite"
            className="compact-project-feedback"
            data-testid="editor-action-status"
            title={status}
          >
            {status}
          </output>
        ) : null}
        <Button
          variant="primary"
          aria-label="保存整个项目"
          className="editor-save-button"
          data-task4-core="save-project"
          data-testid="compact-project-save"
          disabled={saveDisabled}
          onClick={() => void onSaveProject()}
          type="button"
        >
          <Save aria-hidden="true" className="ui-icon" focusable="false" size={18} />
          <span>保存</span>
        </Button>
        <div className="compact-project-menu-wrap" ref={menuRef}>
          <Button
            variant="secondary"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            className="compact-project-more-button task4-hit-target"
            data-task4-core="more-menu"
            data-testid="compact-project-more"
            disabled={busy}
            onClick={() => setMenuOpen((open) => !open)}
            type="button"
          >
            <MoreHorizontal aria-hidden="true" className="ui-icon" focusable="false" size={18} />
            <span>更多</span>
          </Button>
          {menuOpen ? (
            <div
              aria-label="项目操作"
              className="compact-project-menu"
              data-testid="compact-project-menu"
              role="menu"
            >
              <Button
                variant="secondary"
                className="task4-hit-target"
                data-task4-core="project-center"
                data-testid="menu-open-project-center"
                onClick={() => {
                  closeMenu();
                  onOpenProjectCenter();
                }}
                role="menuitem"
                type="button"
              >
                打开项目中心
              </Button>
              <Button
                variant="secondary"
                className="task4-hit-target"
                data-task4-core="menu-open-folder"
                data-testid="menu-open-project-folder"
                onClick={() => {
                  closeMenu();
                  void onOpenProjectFolder();
                }}
                role="menuitem"
                type="button"
              >
                打开项目文件夹
              </Button>
              <Button
                variant="secondary"
                className="task4-hit-target"
                data-task4-core="product-preview"
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
              </Button>
              <div
                aria-label="Editor device mode"
                className="compact-project-device-mode"
                data-testid="editor-device-mode-selector"
                role="group"
              >
                <span className="compact-project-device-mode-label">
                  Editor device mode
                </span>
                {EDITOR_DEVICE_MODE_OPTIONS.map((option) => (
                  <Button
                    aria-checked={deviceMode === option.value}
                    className={
                      deviceMode === option.value
                        ? 'compact-project-device-mode-option is-selected'
                        : 'compact-project-device-mode-option'
                    }
                    data-device-mode={option.value}
                    data-testid={`editor-device-mode-${option.value}`}
                    key={option.value}
                    onClick={() => onDeviceModeChange(option.value)}
                    role="menuitemradio"
                    variant="secondary"
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
              <Button
                variant="danger"
                className="task4-hit-target"
                data-task4-core="close-project"
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
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </PanelSurface>
  );
}
