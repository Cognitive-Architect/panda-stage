import { describe, expect, it } from 'vitest';
import { migrateProject } from '../../src/domain';
import type { ProjectSaveState } from '../../src/renderer/shell/WorkbenchCommandBar';
import exampleProject from '../../demo-project/project-v1.example.json';
import { renderWorkbenchCommands } from '../helpers/render-workbench-commands';

const project = migrateProject(exampleProject);

function render(saveState: ProjectSaveState, status = 'Ready'): string {
  return renderWorkbenchCommands({
    projectRoot: 'D:/PandaStage-Acceptance/commands.pandastage',
    project,
    dirty: saveState !== 'saved',
    revision: 0,
  }, { saveState, status });
}

describe('Workbench save command', () => {
  it('disables a saved project and activates Save for a dirty project', () => {
    const blocked = /<button(?=[^>]*data-testid="quick-action-save")(?=[^>]*disabled="")[^>]*>/u;
    expect(render('saved')).toMatch(blocked);
    expect(render('dirty')).not.toMatch(blocked);
    expect(render('dirty')).toContain('aria-label="保存项目（有未保存更改）"');
    expect(render('saved', '项目已保存。')).not.toContain('data-testid="editor-action-status"');
  });

  it('shows progress, prevents a duplicate save, and reports a retryable failure', () => {
    const saving = render('saving');
    const failed = render('failed', '保存失败：磁盘不可用。');
    expect(saving).toMatch(/<button(?=[^>]*data-testid="quick-action-save")(?=[^>]*disabled="")(?=[^>]*aria-busy="true")[^>]*>/u);
    expect(saving).toContain('role="status">保存中</output>');
    expect(failed).toContain('aria-label="保存失败，重试保存"');
    expect(failed).toContain('role="status">保存失败：磁盘不可用。</output>');
    expect(failed).not.toMatch(/<button(?=[^>]*data-testid="quick-action-save")(?=[^>]*disabled="")[^>]*>/u);
  });
});
