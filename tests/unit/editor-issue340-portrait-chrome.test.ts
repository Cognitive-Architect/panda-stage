import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { migrateProject } from '../../src/domain';
import { CompactProjectBar } from '../../src/renderer/shell/CompactProjectBar';
import type { EditorProjectSnapshot } from '../../src/renderer/stores/EditorProjectStore';
import exampleProject from '../../demo-project/project-v1.example.json';
import { readFileSync } from 'node:fs';

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
  return renderToStaticMarkup(
    createElement(CompactProjectBar, {
      busy: false,
      closeConfirmOpen: false,
      deviceMode: 'cloud-touch',
      onDeviceModeChange: () => undefined,
      onOpenProductPreview: () => undefined,
      onOpenProjectCenter: () => undefined,
      onOpenProjectFolder: async () => undefined,
      onRequestCloseProject: () => undefined,
      onSaveProject: async () => undefined,
      presentation: 'portrait',
      productPreviewOpen: false,
      projectSnapshot: { ...snapshot, dirty: saveState !== 'saved' },
      saveState,
      status,
    }),
  );
}

describe('Issue #340 Cloud Touch portrait chrome', () => {
  it('keeps CanvasToolbar on the single Canvas owner behind a presentation seam', () => {
    const canvasStage = source('src/renderer/features/canvas/CanvasStage.tsx');
    const canvasWorkspace = source('src/renderer/shell/CanvasWorkspace.tsx');
    const shell = source('src/renderer/shell/EditorShell.tsx');

    expect(canvasStage).toContain('showToolbar?: boolean');
    expect(canvasStage).toMatch(
      /\{showToolbar \? \([\s\S]*?<CanvasToolbar[\s\S]*?\) : null\}/u,
    );
    expect(canvasWorkspace).toContain('showToolbar?: boolean');
    expect(canvasWorkspace).toContain(
      '<CanvasStage showHeading={showHeading} showToolbar={showToolbar} />',
    );
    expect(shell).toContain(
      "const canvasToolbarVisible =\n    !isPortrait || portraitWorkspace === 'canvas';",
    );
    expect(shell).toContain('showToolbar={canvasToolbarVisible}');
    expect(shell).toContain('<CanvasWorkspace');
    expect(shell).not.toContain('canvasViewportStore');
  });

  it('renders one HistoryControls presentation per layout and preserves shortcuts', () => {
    const bar = source('src/renderer/shell/CompactProjectBar.tsx');
    const bottom = source('src/renderer/shell/BottomWorkspace.tsx');
    const history = source('src/renderer/features/editor/HistoryControls.tsx');
    const shell = source('src/renderer/shell/EditorShell.tsx');
    const shortcuts = source(
      'src/renderer/features/editor/useHistoryShortcuts.ts',
    );

    expect(bar).toContain('<HistoryControls presentation="compact" />');
    expect(bottom).toContain(
      '<HistoryControls presentation="bottom" />',
    );
    expect(bottom).toContain('showHistoryControls?: boolean');
    expect(bottom).toContain(
      '{showHistoryControls ? <HistoryControls presentation="bottom" /> : null}',
    );
    expect(shell).toContain('showHistoryControls={!isPortrait}');
    expect(shell).toContain('presentation={layoutMode}');
    expect(history).toContain('presentation?: HistoryControlsPresentation');
    expect(history).toContain('useHistoryShortcuts(undo, redo)');
    expect(history).toContain('data-history-presentation={presentation}');
    expect(history).toContain('aria-label="撤销"');
    expect(history).toContain('aria-label="重做"');
    expect(shortcuts).toContain("key === 'z'");
    expect(shortcuts).toContain("key === 'y'");
  });

  it('keeps the portrait header quiet while retaining menu capabilities and meaningful feedback', () => {
    const bar = source('src/renderer/shell/CompactProjectBar.tsx');
    const markup = renderBar();
    const failedMarkup = renderBar('保存失败：磁盘不可用。', 'failed');

    expect(markup).toContain('data-presentation="portrait"');
    expect(markup).toContain('data-history-presentation="compact"');
    expect(markup).not.toContain('data-testid="open-project-center"');
    expect(markup).not.toContain('data-testid="active-project-path"');
    expect(markup).not.toContain('data-testid="project-save-state"');
    expect(markup).not.toContain(snapshot.projectRoot);
    expect(markup).not.toContain('已保存');
    expect(failedMarkup).toContain('data-testid="project-save-state"');
    expect(failedMarkup).toContain('data-testid="editor-action-status"');
    expect(failedMarkup).toContain('保存失败：磁盘不可用。');
    expect(bar).toContain('data-testid="menu-open-project-center"');
    expect(bar).toContain('data-testid="menu-open-project-folder"');
    expect(bar).toContain('onOpenProjectCenter();');
    expect(bar).toContain('onOpenProjectFolder();');
  });

  it('scopes the header relocation and quiet state to Cloud Touch portrait', () => {
    const styles = source('src/renderer/styles.css');
    const scope =
      ".editor-shell[data-editor-device-mode='cloud-touch'][data-editor-shell-layout='portrait']";

    expect(styles).toContain(
      `${scope}\n  .compact-project-bar[data-presentation='portrait']`,
    );
    expect(styles).toContain(
      "  .history-controls[data-history-presentation='compact']",
    );
    expect(styles).toContain('clip: rect(0 0 0 0);');
    expect(styles).toContain(
      '.compact-project-bar[data-presentation=\'portrait\']',
    );
  });

  it('does not add project or history mutation ownership to the presentation seam', () => {
    const shell = source('src/renderer/shell/EditorShell.tsx');
    const bar = source('src/renderer/shell/CompactProjectBar.tsx');
    const canvas = source('src/renderer/features/canvas/CanvasStage.tsx');

    expect(bar).not.toContain('updateProject');
    expect(canvas).not.toContain('updateProject');
    expect(shell).not.toContain('historyStore');
  });
});
