import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { migrateProject } from '../../src/domain';
import { getEditorWindowTitle } from '../../src/renderer/shell/EditorShell';
import exampleProject from '../../demo-project/project-v1.example.json';
import { renderWorkbenchCommands } from '../helpers/render-workbench-commands';

const project = migrateProject(exampleProject);
const snapshot = { projectRoot: 'D:/PandaStage-Acceptance/commands.pandastage', project, dirty: false, revision: 0 };
const source = (path: string) => readFileSync(path, 'utf8');

describe('Workbench command ownership', () => {
  it('uses one two-row command bar with accessible real editing actions', () => {
    const markup = renderWorkbenchCommands(snapshot);
    expect(markup.match(/data-testid="workbench-command-bar"/gu)).toHaveLength(1);
    expect(markup).toContain('class="workbench-menu-bar"');
    expect(markup).toContain('class="workbench-command-row"');
    expect(markup).toContain('aria-label="切换镜头"');
    expect(markup).toContain('aria-label="撤销"');
    expect(markup).toContain('aria-label="重做"');
    expect(markup).toContain('aria-label="预览当前镜头"');
    expect(markup).toContain('导出视频');
    expect(markup).toContain(project.name);
    expect(markup).not.toContain(snapshot.projectRoot);
  });

  it('derives the native title from the current formal project', () => {
    expect(getEditorWindowTitle(null)).toBe('Panda Stage');
    expect(getEditorWindowTitle(snapshot)).toBe(`Panda Stage（${project.name}）`);
    expect(source('src/renderer/shell/EditorShell.tsx')).toContain('document.title = getEditorWindowTitle(projectSnapshot);');
  });

  it('leaves persistence and preview lifetime with their existing owners', () => {
    const bar = source('src/renderer/shell/WorkbenchCommandBar.tsx');
    const preview = source('src/renderer/shell/ProductPreviewOverlay.tsx');
    expect(bar).not.toContain('editorProjectStore');
    expect(bar).not.toContain('updateProject');
    expect(bar).toContain('useHistoryCommands(blocked)');
    expect(preview).toContain('autoPlay = false');
    expect(preview).toContain("initialRange = 'project'");
    expect(source('src/renderer/shell/EditorShell.tsx')).toContain('initialRange="shot"');
    expect(preview).toContain('durationMs: projectDurationMs(project)');
  });
});
