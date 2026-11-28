import { describe, expect, it } from 'vitest';
import { migrateProject } from '../../src/domain';
import { renderWorkbenchCommands } from '../helpers/render-workbench-commands';
import type { EditorProjectSnapshot } from '../../src/renderer/stores/EditorProjectStore';
import exampleProject from '../../demo-project/project-v1.example.json';
import { readFileSync } from 'node:fs';
import { readOrderedStylesheetSource } from '../helpers/read-stylesheet-source';

function source(path: string): string {
  return readFileSync(path, 'utf8').replace(/\r\n/gu, '\n');
}

const project = migrateProject(exampleProject);
const snapshot: EditorProjectSnapshot = {
  projectRoot: 'D:\\PandaStage-Acceptance\\issue-340.pandastage',
  project,
  dirty: false,
  revision: 0,
};

function renderBar(
  status = '项目已打开，暂无未保存更改。',
  saveState: 'saved' | 'dirty' | 'saving' | 'failed' = 'saved',
): string {
  return renderWorkbenchCommands({ ...snapshot, dirty: saveState !== 'saved' }, { saveState, status });
}

describe('Issue #340 Cloud Touch portrait chrome', () => {
  it('keeps CanvasToolbar on the single Canvas owner behind a presentation seam', () => {
    const canvasStage = source('src/renderer/features/canvas/CanvasStage.tsx');
    const canvasWorkspace = source('src/renderer/shell/CanvasWorkspace.tsx');
    const shell = source('src/renderer/shell/EditorShell.tsx');

    expect(canvasStage).toContain('showToolbar?: boolean');
    expect(canvasStage).toContain('viewportChrome={(');
    expect(canvasStage).toContain('showToolbar || shot || selectedFlaGraphicTarget');
    expect(canvasStage).toContain('<CanvasToolbar');
    expect(canvasStage).toContain('showStatus={showToolbar}');
    expect(canvasWorkspace).toContain('showToolbar?: boolean');
    expect(canvasWorkspace.match(/<CanvasStage\b/gu)).toHaveLength(1);
    expect(canvasWorkspace).toContain('showHeading={showHeading}');
    expect(canvasWorkspace).toContain('showToolbar={showToolbar}');
    expect(canvasWorkspace).not.toContain('flaGroupEditTarget');
    expect(canvasWorkspace).not.toContain('onClearFlaGroupEditTarget');
    expect(shell).toContain('stage: <div className="workbench-stage');
    expect(shell).not.toContain('showToolbar={canvasToolbarVisible}');
    expect(shell).toContain('<CanvasWorkspace');
    expect(shell).toContain('canvasViewportStore.setMode(mode)');
  });

  it('renders one HistoryControls presentation per layout and preserves shortcuts', () => {
    const bar = source('src/renderer/shell/WorkbenchCommandBar.tsx');
    const bottom = source('src/renderer/shell/BottomWorkspace.tsx');
    const history = source('src/renderer/features/editor/HistoryControls.tsx');
    const shell = source('src/renderer/shell/EditorShell.tsx');
    const shortcuts = source(
      'src/renderer/features/editor/useHistoryShortcuts.ts',
    );

    expect(bar).toContain('useHistoryCommands(blocked)');
    expect(bottom).toContain(
      '<HistoryControls presentation="bottom" />',
    );
    expect(bottom).toContain('showHistoryControls?: boolean');
    expect(bottom).toContain(
      '{showHistoryControls ? <HistoryControls presentation="bottom" /> : null}',
    );
    expect(shell).toContain('<WorkbenchCommandBar');
    expect(shell).not.toContain('<BottomWorkspace');
    expect(history).toContain('presentation?: HistoryControlsPresentation');
    expect(history).toContain('useHistoryShortcuts(undo, redo)');
    expect(history).toContain('data-history-presentation={presentation}');
    expect(history).toContain('aria-label="撤销"');
    expect(history).toContain('aria-label="重做"');
    expect(shortcuts).toContain("key === 'z'");
    expect(shortcuts).toContain("key === 'y'");
  });

  it('keeps the portrait drawer quiet while retaining actions and meaningful feedback', () => {
    const bar = source('src/renderer/shell/WorkbenchCommandBar.tsx');
    const markup = renderBar();
    const failedMarkup = renderBar('保存失败：磁盘不可用。', 'failed');

    expect(markup).toContain('data-testid="workbench-command-bar"');
    expect(markup).toContain('data-testid="workbench-file-menu"');
    expect(markup).not.toContain('data-testid="editor-action-status"');
    expect(markup).toContain('data-testid="history-controls"');
    expect(markup).not.toContain('data-testid="project-save-state"');
    expect(markup).not.toContain(snapshot.projectRoot);
    expect(markup).not.toContain('data-testid="project-save-state"');
    expect(failedMarkup).toContain('data-save-state="failed"');
    expect(failedMarkup).toContain('data-testid="editor-action-status"');
    expect(failedMarkup).toContain('保存失败：磁盘不可用。');
    expect(bar).toContain('data-testid="quick-action-home"');
    expect(bar).toContain('data-testid="quick-action-folder"');
    expect(bar).toContain('onProjectCenter');
    expect(bar).toContain('onFolder');
  });

  it('uses the compact command row and narrow workbench treatment', () => {
    const styles = source('src/renderer/styles/shell/layout/editor-workbench.css');
    expect(styles).toContain('.workbench-command-row');
    expect(styles).toContain('@media (max-width: 520px)');
    expect(readOrderedStylesheetSource()).not.toContain('.quick-action-drawer');
  });

  it('does not add project or history mutation ownership to the presentation seam', () => {
    const shell = source('src/renderer/shell/EditorShell.tsx');
    const bar = source('src/renderer/shell/WorkbenchCommandBar.tsx');
    const canvas = source('src/renderer/features/canvas/CanvasStage.tsx');

    expect(bar).not.toContain('updateProject');
    expect(canvas).not.toContain('updateProject');
    expect(shell).not.toContain('historyStore');
  });
});
