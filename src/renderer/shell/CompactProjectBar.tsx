import { useEffect, useId, useState } from 'react';
import { HistoryControls } from '../features/editor/HistoryControls';
import type { EditorProjectSnapshot } from '../stores/EditorProjectStore';
import { IconButton, PanelSurface } from '../ui';
import {
  FolderOpen,
  Home,
  LoaderCircle,
  Play,
  Save,
  X,
} from 'lucide-react';
import type { EditorShellLayoutMode } from './adaptiveEditorShell';

export type CompactProjectSaveState =
  | 'saved'
  | 'dirty'
  | 'saving'
  | 'failed';

export function shouldRenderRestSaveState(
  expanded: boolean,
  saveState: CompactProjectSaveState,
): boolean {
  return !expanded && (saveState === 'saving' || saveState === 'failed');
}

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
  presentation?: EditorShellLayoutMode;
}

// Keep the existing four-state vocabulary for shell/static contracts; only
// saving and failed are rendered as standalone labels in the drawer.
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

/**
 * The top editor action owner. The legacy file name is retained for the
 * existing shell seam, but its user-facing presentation is now the
 * Issue #454 Quick Action Drawer rather than the old project bar/menu.
 */
export function QuickActionDrawer({
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
  presentation = 'landscape',
}: CompactProjectBarProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const panelId = `quick-action-drawer-panel-${useId()}`;
  const statusText = status.trim();
  const showFeedback =
    saveState === 'failed' ||
    (Boolean(statusText) && !QUIET_STATUS_MESSAGES.has(statusText));
  const saveDisabled =
    busy || saveState === 'saving' || !projectSnapshot.dirty;
  const saveStateLabel =
    saveState === 'saving' || saveState === 'failed'
      ? SAVE_STATE_LABELS[saveState]
      : null;
  const saveTitle =
    saveState === 'saving'
      ? '保存中'
      : saveState === 'failed'
        ? statusText || '保存失败'
        : projectSnapshot.dirty
          ? '保存项目'
          : '保存项目（已保存）';

  const showRestSaveState = shouldRenderRestSaveState(expanded, saveState);

  useEffect(() => {
    // Switching projects remounts this presentation in EditorShell, and this
    // guard also keeps the UI-only state correct for direct callers.
    setExpanded(false);
  }, [projectSnapshot.projectRoot]);

  useEffect(() => {
    if (!expanded) return undefined;

    const collapseOnEscape = (event: KeyboardEvent): void => {
      if (
        event.key !== 'Escape' ||
        event.defaultPrevented ||
        productPreviewOpen ||
        closeConfirmOpen
      ) {
        return;
      }
      event.preventDefault();
      setExpanded(false);
    };

    document.addEventListener('keydown', collapseOnEscape);
    return () => document.removeEventListener('keydown', collapseOnEscape);
  }, [closeConfirmOpen, expanded, productPreviewOpen]);

  return (
    <section
      aria-label="快捷操作抽屉"
      className="quick-action-drawer"
      data-expanded={String(expanded)}
      data-presentation={presentation}
      data-save-state={saveState}
      data-testid="quick-action-drawer"
    >
      <PanelSurface
        aria-hidden={!expanded}
        className="quick-action-drawer-surface"
        data-testid="quick-action-drawer-surface"
        inert={!expanded ? true : undefined}
        id={panelId}
      >
        <div className="quick-action-drawer-actions">
          <IconButton
            aria-label="打开项目中心"
            className="quick-action-drawer-action"
            data-task4-core="project-center"
            data-quick-action="home"
            data-testid="quick-action-home"
            disabled={busy}
            icon={
              <Home
                aria-hidden="true"
                className="ui-icon"
                focusable="false"
                size={18}
              />
            }
            onClick={onOpenProjectCenter}
            title="打开项目中心"
            variant="secondary"
          />
          <IconButton
            aria-label="打开项目文件夹"
            className="quick-action-drawer-action"
            data-task4-core="menu-open-folder"
            data-quick-action="folder"
            data-testid="quick-action-folder"
            disabled={busy}
            icon={
              <FolderOpen
                aria-hidden="true"
                className="ui-icon"
                focusable="false"
                size={18}
              />
            }
            onClick={() => void onOpenProjectFolder()}
            title="打开项目文件夹"
            variant="secondary"
          />
          <IconButton
            aria-label="保存项目"
            aria-busy={saveState === 'saving'}
            className={`quick-action-drawer-action quick-action-drawer-save quick-action-drawer-save-${saveState}`}
            data-quick-action="save"
            data-save-state={saveState}
            data-task4-core="save-project"
            data-testid="quick-action-save"
            disabled={saveDisabled}
            icon={
              saveState === 'saving' ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="ui-icon quick-action-drawer-spinner"
                  focusable="false"
                  size={18}
                />
              ) : (
                <Save
                  aria-hidden="true"
                  className="ui-icon"
                  focusable="false"
                  size={18}
                />
              )
            }
            onClick={() => void onSaveProject()}
            title={saveTitle}
            variant="secondary"
          />
          <IconButton
            aria-label="预览当前镜头"
            aria-pressed={productPreviewOpen}
            className="quick-action-drawer-action quick-action-drawer-play"
            data-quick-action="play"
            data-task4-core="product-preview"
            data-testid="quick-action-play"
            disabled={busy || productPreviewOpen}
            icon={
              <Play
                aria-hidden="true"
                className="ui-icon"
                focusable="false"
                size={18}
              />
            }
            onClick={onOpenProductPreview}
            title="预览当前镜头"
            variant="primary"
          />
          <div
            className="quick-action-drawer-history"
            data-testid="quick-action-history"
          >
            <HistoryControls presentation="compact" />
          </div>
          <IconButton
            aria-label="关闭当前项目"
            className="quick-action-drawer-action quick-action-drawer-close"
            data-quick-action="close"
            data-task4-core="close-project"
            data-testid="quick-action-close"
            disabled={busy || closeConfirmOpen}
            icon={
              <X
                aria-hidden="true"
                className="ui-icon"
                focusable="false"
                size={18}
              />
            }
            onClick={onRequestCloseProject}
            title="关闭当前项目"
            variant="secondary"
          />
        </div>
        {saveStateLabel ? (
          <span
            aria-live="polite"
            className={`quick-action-drawer-save-state quick-action-drawer-save-state-${saveState}`}
            data-testid="project-save-state"
            title={saveState === 'failed' ? statusText || '保存失败' : undefined}
          >
            {saveStateLabel}
          </span>
        ) : null}
        {showFeedback ? (
          <output
            aria-live="polite"
            className="quick-action-drawer-feedback"
            data-testid="editor-action-status"
            role="status"
          >
            {statusText || '保存失败，请重试。'}
          </output>
        ) : null}
      </PanelSurface>
      {showRestSaveState ? (
        <span
          aria-live="polite"
          className={`quick-action-drawer-rest-state quick-action-drawer-rest-state-${saveState}`}
          data-save-state={saveState}
          data-testid="project-save-state-rest"
          title={saveState === 'failed' ? statusText || '保存失败' : undefined}
        >
          {saveStateLabel}
        </span>
      ) : null}
      <button
        aria-controls={panelId}
        aria-expanded={expanded}
        aria-label={expanded ? '收起快捷操作' : '展开快捷操作'}
        className="quick-action-drawer-handle"
        data-testid="quick-action-drawer-handle"
        onClick={() => setExpanded((current) => !current)}
        title={expanded ? '收起快捷操作' : '展开快捷操作'}
        type="button"
      >
        <span
          aria-hidden="true"
          className="timeline-resize-grip quick-action-drawer-grip"
        />
      </button>
    </section>
  );
}

/** Compatibility export for existing shell/test imports. */
export const CompactProjectBar = QuickActionDrawer;
