import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { migrateProject } from '../../src/domain';
import {
  getEditorWindowTitle,
} from '../../src/renderer/shell/EditorShell';
import {
  CompactProjectBar,
  type CompactProjectSaveState,
} from '../../src/renderer/shell/CompactProjectBar';
import type { EditorProjectSnapshot } from '../../src/renderer/stores/EditorProjectStore';
import exampleProject from '../../demo-project/project-v1.example.json';

function source(path: string): string {
  return readFileSync(path, 'utf8').replace(/\r\n/gu, '\n');
}

const project = migrateProject(exampleProject);
const snapshot: EditorProjectSnapshot = {
  projectRoot: 'D:\\PandaStage-Acceptance\\issue-454.pandastage',
  project,
  dirty: false,
  revision: 0,
};

function renderDrawer(
  saveState: CompactProjectSaveState = 'saved',
  status = 'Ready',
): string {
  return renderToStaticMarkup(
    createElement(CompactProjectBar, {
      busy: false,
      closeConfirmOpen: false,
      onOpenProductPreview: () => undefined,
      onOpenProjectCenter: () => undefined,
      onOpenProjectFolder: async () => undefined,
      onRequestCloseProject: () => undefined,
      onSaveProject: async () => undefined,
      presentation: 'landscape',
      productPreviewOpen: false,
      projectSnapshot: {
        ...snapshot,
        dirty: saveState !== 'saved',
      },
      saveState,
      status,
    }),
  );
}

describe('Issue #454 Quick Action Drawer', () => {
  it('starts collapsed with only the centered handle visible', () => {
    const markup = renderDrawer();

    expect(markup).toContain('data-testid="quick-action-drawer"');
    expect(markup).toContain('data-expanded="false"');
    expect(markup).toContain('data-testid="quick-action-drawer-handle"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('class="timeline-resize-grip quick-action-drawer-grip"');
    expect(markup).not.toContain(project.name);
    expect(markup).not.toContain(snapshot.projectRoot);
  });

  it('renders the exact seven icon actions in order without the old More menu', () => {
    const markup = renderDrawer();
    const sourceText = source('src/renderer/shell/CompactProjectBar.tsx');
    const orderedTestIds = [
      'quick-action-home',
      'quick-action-folder',
      'quick-action-save',
      'quick-action-play',
      'quick-action-history',
      'quick-action-close',
    ];
    let previousIndex = -1;
    for (const testId of orderedTestIds) {
      const index = markup.indexOf(`data-testid="${testId}"`);
      expect(index).toBeGreaterThan(previousIndex);
      previousIndex = index;
    }

    for (const label of [
      '打开项目中心',
      '打开项目文件夹',
      '预览当前镜头',
      '关闭当前项目',
    ]) {
      expect(markup).toContain(`aria-label="${label}"`);
      expect(markup).toContain(`title="${label}"`);
    }
    expect(markup).toContain('aria-label="撤销"');
    expect(markup).toContain('aria-label="重做"');
    expect(markup).toContain('title="没有可撤销的操作"');
    expect(markup).toContain('title="没有可重做的操作"');
    expect(markup).toContain('aria-label="保存项目"');
    expect(markup).toContain('title="保存项目（已保存）"');
    expect(sourceText).toContain('Home');
    expect(sourceText).toContain('FolderOpen');
    expect(sourceText).toContain('Play');
    expect(sourceText).toContain('Save');
    expect(sourceText).toContain('X');
    expect(sourceText).not.toContain('MoreHorizontal');
    expect(sourceText).not.toContain('compact-project-menu');
    expect(sourceText).not.toContain('compact-project-more');
    expect(sourceText).toContain('<HistoryControls presentation="compact" />');
  });

  it('keeps save state and readable failure feedback in the compact surface', () => {
    const clean = renderDrawer('saved');
    const dirty = renderDrawer('dirty');
    const saving = renderDrawer('saving');
    const failed = renderDrawer('failed', '保存失败：磁盘不可用。');

    expect(clean).toContain('data-save-state="saved"');
    expect(clean).toContain('data-testid="quick-action-save" disabled');
    expect(clean).not.toContain('data-testid="project-save-state"');
    expect(clean).not.toContain('data-testid="project-save-state-rest"');
    expect(dirty).toContain('data-save-state="dirty"');
    expect(dirty).toContain('有未保存更改');
    expect(dirty).toContain('data-testid="project-save-state-rest"');
    expect(dirty).not.toContain('data-testid="quick-action-save" disabled');
    expect(saving).toContain('data-save-state="saving"');
    expect(saving).toContain('保存中');
    expect(saving).toContain('data-testid="project-save-state-rest"');
    expect(saving).toContain('quick-action-drawer-spinner');
    expect(saving).toContain('data-testid="quick-action-save" disabled');
    expect(failed).toContain('data-save-state="failed"');
    expect(failed).toContain('保存失败');
    expect(failed).toContain('data-testid="project-save-state-rest"');
    expect(failed).toContain('保存失败：磁盘不可用。');
    expect(failed).toContain('data-testid="editor-action-status"');
  });

  it('derives the native title from the one formal project snapshot', () => {
    expect(getEditorWindowTitle(null)).toBe('Panda Stage');
    expect(getEditorWindowTitle(snapshot)).toBe(`Panda Stage（${project.name}）`);

    const shell = source('src/renderer/shell/EditorShell.tsx');
    const drawer = source('src/renderer/shell/CompactProjectBar.tsx');
    expect(shell).toContain('document.title = getEditorWindowTitle(projectSnapshot);');
    expect(shell).toContain('autoPlay');
    expect(drawer).not.toContain('compact-project-name');
    expect(drawer).not.toContain('projectSnapshot.project.name');
  });

  it('keeps the drawer UI-only and gives the existing Timeline grip language back to the shell', () => {
    const drawer = source('src/renderer/shell/CompactProjectBar.tsx');
    const styles = source('src/renderer/styles.css');
    const preview = source('src/renderer/shell/ProductPreviewOverlay.tsx');

    expect(drawer).not.toContain('editorProjectStore');
    expect(drawer).not.toContain('updateProject');
    expect(drawer).toContain('setExpanded(false)');
    expect(drawer).toContain("event.key !== 'Escape'");
    expect(styles).toMatch(
      /\.quick-action-drawer-surface\s*\{[\s\S]*?width:\s*fit-content;[\s\S]*?max-height:\s*180px;/u,
    );
    expect(styles).toContain('flex-wrap: nowrap;');
    expect(styles).toContain("data-expanded='false'");
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(preview).toContain('autoPlay = false');
    expect(preview).toContain('setPlaying(autoPlay && durationMs > 0);');
  });
});
