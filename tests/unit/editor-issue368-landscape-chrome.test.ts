import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import { migrateProject } from '../../src/domain';
import { CompactProjectBar } from '../../src/renderer/shell/CompactProjectBar';
import type { EditorProjectSnapshot } from '../../src/renderer/stores/EditorProjectStore';

function source(path: string): string {
  return readFileSync(path, 'utf8').replace(/\r\n/gu, '\n');
}

const project = migrateProject(exampleProject);
const snapshot: EditorProjectSnapshot = {
  projectRoot: 'D:\\PandaStage-Acceptance\\issue-368.pandastage',
  project,
  dirty: false,
  revision: 0,
};

function renderBar(
  status = 'Ready',
  saveState: 'saved' | 'dirty' | 'saving' | 'failed' = 'saved',
): string {
  return renderToStaticMarkup(
    createElement(CompactProjectBar, {
      projectSnapshot: snapshot,
      saveState,
      status,
      busy: false,
      productPreviewOpen: false,
      closeConfirmOpen: false,
      onOpenProjectCenter: vi.fn(),
      onOpenProjectFolder: vi.fn(async () => undefined),
      onSaveProject: vi.fn(async () => undefined),
      onOpenProductPreview: vi.fn(),
      onRequestCloseProject: vi.fn(),
      presentation: 'landscape',
    }),
  );
}

describe('Issue #368 landscape editor chrome', () => {
  it('keeps the top drawer compact, ordered, and free of persistent project chrome', () => {
    const markup = renderBar();

    expect(markup).toContain('data-testid="quick-action-drawer"');
    expect(markup).toContain('data-expanded="false"');
    expect(markup).toContain('data-history-presentation="compact"');
    expect(markup).not.toContain('active-project-path');
    expect(markup).not.toContain('compact-project-name');
    expect(markup).not.toContain(snapshot.projectRoot);
    expect(markup).not.toContain('data-testid="editor-action-status"');
    expect(markup).not.toContain('data-testid="project-save-state"');
    expect(markup).not.toContain('data-testid="project-save-state"');

    const actionIds = [
      'quick-action-home',
      'quick-action-folder',
      'quick-action-save',
      'quick-action-play',
      'quick-action-history',
      'quick-action-close',
    ];
    let previousIndex = -1;
    for (const id of actionIds) {
      const index = markup.indexOf(`data-testid="${id}"`);
      expect(index).toBeGreaterThan(previousIndex);
      previousIndex = index;
    }

    const bar = source('src/renderer/shell/CompactProjectBar.tsx');
    expect(bar).toContain('<HistoryControls presentation="compact" />');
    expect(bar).toContain('data-testid="quick-action-home"');
    expect(bar).not.toContain('MoreHorizontal');
  });

  it('keeps actionable feedback while suppressing ordinary success copy', () => {
    const quietMarkup = renderBar('Ready');
    const dirtyMarkup = renderBar('Ready', 'dirty');
    const savingMarkup = renderBar('Ready', 'saving');
    const actionableMarkup = renderBar('Actionable save failure', 'failed');

    expect(quietMarkup).not.toContain('data-testid="editor-action-status"');
    expect(dirtyMarkup).not.toContain('data-testid="project-save-state"');
    expect(dirtyMarkup).not.toContain('有未保存更改');
    expect(savingMarkup).toContain('data-testid="project-save-state"');
    expect(savingMarkup).toContain('保存中');
    expect(actionableMarkup).toContain('data-testid="editor-action-status"');
    expect(actionableMarkup).toContain('data-testid="project-save-state"');
    expect(actionableMarkup).toContain('保存失败');
    expect(actionableMarkup).toContain('Actionable save failure');
  });

  it('uses icon-over-label controls and restrained landscape selection styling', () => {
    const dock = source('src/renderer/shell/ResourceActivityDock.tsx');
    const left = source('src/renderer/shell/LeftWorkspace.tsx');
    const right = source('src/renderer/shell/RightWorkspace.tsx');
    const projectTools = source('src/renderer/shell/ProjectToolsDrawer.tsx');
    const styles = source('src/renderer/styles.css');

    for (const icon of ['Clapperboard', 'Images', 'Smile']) {
      expect(dock).toContain(icon);
    }
    expect(dock).toContain('DecorativeIcon icon={activity.icon}');
    expect(right).toContain("{ id: 'tools', label: '工具', icon: Wrench }");
    expect(left).not.toContain('<ProjectToolsDrawer');
    expect(right).toContain('<ProjectToolsDrawer');
    expect(projectTools).toContain('data-testid="project-tools-action-preset-card"');
    const inspector = source('src/renderer/shell/RightInspector.tsx');
    expect(inspector).toContain('SlidersHorizontal');
    expect(inspector).toContain('className="inspector-rail-icon"');
    expect(inspector).toContain('className="inspector-rail-label"');
    expect(inspector).toContain('className="inspector-rail-chevron"');
    expect(styles).toContain('Issue #368');
    expect(styles).toContain('Issue #417');
    expect(styles).toContain('align-content: center;');
    expect(styles).toContain('writing-mode: horizontal-tb;');
    expect(styles).toContain('background: rgb(45 104 62 / 28%);');
    expect(styles).toContain('min-width: 44px;');
    expect(styles).toContain(".history-controls[data-history-presentation='compact']");
  });

  it('mounts one History owner in the top drawer and removes landscape headings/history', () => {
    const shell = source('src/renderer/shell/EditorShell.tsx');
    const bottom = source('src/renderer/shell/BottomWorkspace.tsx');

    expect(shell).toContain('showHeading={false}');
    expect(shell).toContain('showHistoryControls={false}');
    expect(shell).not.toContain('showHistoryControls={!isPortrait}');
    expect(bottom).toContain("showHistoryControls = presentation !== 'landscape'");
    expect(bottom).toContain('<HistoryControls presentation="bottom" />');
  });
});
