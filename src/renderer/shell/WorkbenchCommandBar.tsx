import { useEffect, type ReactNode } from 'react';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { Download, LoaderCircle, Play, Redo2, Save, Undo2 } from 'lucide-react';
import { useHistoryCommands } from '../features/editor/HistoryControls';
import { isEditableKeyboardTarget } from '../features/properties/LayerOrderControls';
import { formatTimecode } from '../features/timeline/timeGeometry';
import { useTimelineUi } from '../features/timeline/timelineUiStore';
import type { EditorProjectSnapshot } from '../stores/EditorProjectStore';
import { Button, DecorativeIcon, IconButton } from '../ui';

export type ProjectSaveState = 'saved' | 'dirty' | 'saving' | 'failed';

interface WorkbenchCommandBarProps {
  windowMenu: ReactNode;
  snapshot: EditorProjectSnapshot;
  shotId: string | null;
  busy: boolean;
  navigationBlocked: boolean;
  modalOpen: boolean;
  previewOpen: boolean;
  exportBusy: boolean;
  exportOpen: boolean;
  saveState: ProjectSaveState;
  status: string;
  onShotChange(id: string): void;
  onNew(): void;
  onOpen(): void;
  onSave(): void;
  onClose(): void;
  onProjectCenter(): void;
  onFolder(): void;
  onImport(kind: 'files' | 'fla'): void;
  onPreview(): void;
  onExport(): void;
  onExportSettings(): void;
  onCanvasView(mode: 'fit' | 'actual'): void;
}

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

function CommandMenu({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return <Menu.Root>
    <Menu.Trigger asChild><Button variant="secondary" data-testid={testId}>{label}</Button></Menu.Trigger>
    <Menu.Portal><Menu.Content className="workbench-menu" align="start" sideOffset={4}>
      {children}
    </Menu.Content></Menu.Portal>
  </Menu.Root>;
}

export function WorkbenchCommandBar({
  windowMenu, snapshot, shotId, busy, navigationBlocked, modalOpen, previewOpen,
  exportBusy, exportOpen, saveState, status, onShotChange, onNew, onOpen,
  onSave, onClose, onProjectCenter, onFolder, onImport, onPreview, onExport,
  onExportSettings, onCanvasView,
}: WorkbenchCommandBarProps) {
  const blocked = busy || modalOpen || previewOpen;
  const navigationDisabled = blocked || navigationBlocked;
  const saveDisabled = blocked || saveState === 'saving' || !snapshot.dirty;
  const previewDisabled = blocked || !shotId;
  const settingsDisabled = blocked || exportBusy;
  const { history, undo, redo, status: historyStatus } = useHistoryCommands(blocked);
  const { currentTimeMs } = useTimelineUi();
  const saveTitle = saveState === 'saving' ? '保存中' : saveState === 'failed' ? '保存失败，重试保存' : saveState === 'dirty' ? '保存项目（有未保存更改）' : '保存项目';
  const exportLabel = exportBusy || exportOpen ? '显示导出任务' : ({
    mp4: '导出视频', webm: '导出 WebM', gif: '导出 GIF',
    'png-sequence': '导出 PNG 序列', 'sprite-sheet': '导出精灵图',
  })[snapshot.project.exportPreferences?.format ?? 'mp4'];
  const feedback = status.trim();
  const feedbackVisible = saveState === 'failed' || (Boolean(feedback) && !QUIET_STATUS_MESSAGES.has(feedback));

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.shiftKey || event.repeat ||
        (!event.ctrlKey && !event.metaKey) || isEditableKeyboardTarget(event.target) ||
        event.target instanceof Element && event.target.closest('[role="menu"], [aria-modal="true"]')) return;
      const key = event.key.toLowerCase();
      if (key === 's' && !saveDisabled) {
        event.preventDefault();
        onSave();
      } else if (key === 'm' && !settingsDisabled) {
        event.preventDefault();
        onExportSettings();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onExportSettings, onSave, saveDisabled, settingsDisabled]);

  return <header className="workbench-command-bar" data-testid="workbench-command-bar">
    <div className="workbench-menu-bar">
      <span className="workbench-brand">Panda Stage</span>
      <CommandMenu label="文件" testId="workbench-file-menu">
        <Menu.Item disabled={navigationDisabled} onSelect={onNew}>新建项目…</Menu.Item>
        <Menu.Item disabled={navigationDisabled} onSelect={onOpen}>打开项目…</Menu.Item>
        <Menu.Item disabled={saveDisabled} onSelect={onSave}>保存项目 <kbd>Ctrl+S</kbd></Menu.Item>
        <Menu.Item disabled={blocked} onSelect={onFolder} data-testid="quick-action-folder">打开项目文件夹</Menu.Item>
        <Menu.Separator />
        <Menu.Item disabled={navigationDisabled} onSelect={() => onImport('files')}>导入素材…</Menu.Item>
        <Menu.Item disabled={navigationDisabled} onSelect={() => onImport('fla')}>导入 FLA / XFL…</Menu.Item>
        <Menu.Separator />
        <Menu.Item disabled={settingsDisabled} onSelect={onExportSettings} data-testid="quick-action-export-settings">导出设置… <kbd>Ctrl+M</kbd></Menu.Item>
        <Menu.Item disabled={navigationDisabled} onSelect={onProjectCenter} data-testid="quick-action-home" data-task4-core="project-center">项目中心</Menu.Item>
        <Menu.Item disabled={navigationDisabled} onSelect={onClose} data-testid="quick-action-close" data-task4-core="close-project">关闭当前项目…</Menu.Item>
      </CommandMenu>
      <CommandMenu label="编辑">
        <Menu.Item disabled={blocked || history.undoCount === 0} onSelect={undo}>撤销 <kbd>Ctrl+Z</kbd></Menu.Item>
        <Menu.Item disabled={blocked || history.redoCount === 0} onSelect={redo}>重做 <kbd>Ctrl+Y</kbd></Menu.Item>
      </CommandMenu>
      <CommandMenu label="视图">
        <Menu.Item disabled={blocked} onSelect={() => onCanvasView('fit')}>画布适合窗口</Menu.Item>
        <Menu.Item disabled={blocked} onSelect={() => onCanvasView('actual')}>画布实际大小</Menu.Item>
        <Menu.Item disabled={previewDisabled} onSelect={onPreview}>预览当前镜头</Menu.Item>
      </CommandMenu>
      {windowMenu}
      <span className="workbench-project-name" title={snapshot.project.name}>{snapshot.project.name}</span>
    </div>
    <div className="workbench-command-row">
      <div className="workbench-command-history" data-testid="history-controls" data-undo-count={history.undoCount} data-redo-count={history.redoCount}>
        <IconButton variant="secondary" aria-label="撤销" title={history.nextUndoLabel ? '撤销 · ' + history.nextUndoLabel : '撤销'}
          icon={<DecorativeIcon icon={Undo2} />} disabled={blocked || history.undoCount === 0} onClick={undo} />
        <IconButton variant="secondary" aria-label="重做" title={history.nextRedoLabel ? '重做 · ' + history.nextRedoLabel : '重做'}
          icon={<DecorativeIcon icon={Redo2} />} disabled={blocked || history.redoCount === 0} onClick={redo} />
        <output className="workbench-history-status" aria-live="polite" data-testid="history-status">{historyStatus}</output>
      </div>
      <select aria-label="切换镜头" value={shotId ?? ''} disabled={navigationDisabled}
        onChange={event => onShotChange(event.target.value)}>
        {snapshot.project.shots.map(shot => <option key={shot.id} value={shot.id}>{shot.name}</option>)}
      </select>
      <div className="workbench-command-preview">
        <IconButton variant="secondary" aria-label="预览当前镜头" title="预览当前镜头"
          icon={<DecorativeIcon icon={Play} />} disabled={previewDisabled} onClick={onPreview} aria-pressed={previewOpen} data-task4-core="product-preview" data-testid="quick-action-play" />
        <output aria-label="播放头位置">{formatTimecode(currentTimeMs)}</output>
      </div>
      <div className="workbench-command-output">
        <IconButton variant="secondary" aria-label={saveTitle} title={saveState === 'saved' ? '保存项目（已保存）' : saveTitle} data-task4-core="save-project" aria-busy={saveState === 'saving'}
          icon={<DecorativeIcon icon={saveState === 'saving' ? LoaderCircle : Save} />} disabled={saveDisabled}
          onClick={onSave} data-testid="quick-action-save" data-save-state={saveState} />
        <Button className="ui-icon-label workbench-export" aria-busy={exportBusy} disabled={blocked} onClick={onExport}
          title={exportLabel} data-testid="quick-action-export">
          <DecorativeIcon icon={exportBusy ? LoaderCircle : Download} />{exportLabel}
        </Button>
      </div>
    </div>
    {feedbackVisible ? <output className="workbench-command-feedback" data-testid="editor-action-status" role="status">
      {feedback || '保存失败，请重试。'}
    </output> : saveState === 'saving' ? <output className="workbench-command-feedback" role="status">保存中</output> : null}
  </header>;
}
