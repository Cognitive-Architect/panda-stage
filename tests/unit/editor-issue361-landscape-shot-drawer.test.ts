import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import { migrateProject } from '../../src/domain';
import { ShotManager } from '../../src/renderer/features/shots/ShotManager';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

describe('Issue #361 landscape Shot drawer corrective polish', () => {
  it('keeps project tools out of the resource drawer and relocates its entry', () => {
    const left = source('src/renderer/shell/LeftWorkspace.tsx');
    const dock = source('src/renderer/shell/ResourceActivityDock.tsx');
    const right = source('src/renderer/shell/RightWorkspace.tsx');
    const styles = source('src/renderer/styles.css');

    expect(dock).toContain(
      '!landscapePresentation && auxiliaryContent ? (',
    );
    expect(dock).not.toContain('resource-activity-secondary-tools');
    expect(styles).not.toContain('resource-activity-secondary-tools');
    expect(left).not.toContain('<ProjectToolsDrawer');
    expect(dock).not.toContain('resource-activity-rail-project-tools');
    expect(right).toContain('<ProjectToolsDrawer');
    expect(right).toContain("{ id: 'tools', label: '工具', icon: Wrench }");
    expect(left).toContain('<ProjectRecoveryPanel');
    expect(left).toContain('<LegacyCompatibilityActivity');
  });

  it('keeps the selected card compact and quiet in landscape', () => {
    const manager = source('src/renderer/features/shots/ShotManager.tsx');
    const item = source('src/renderer/features/shots/ShotListItem.tsx');
    const quickActions = source(
      'src/renderer/features/shots/ShotQuickActions.tsx',
    );
    const styles = source('src/renderer/styles.css');
    const project = migrateProject(exampleProject);
    const markup = renderToStaticMarkup(
      createElement(ShotManager, {
        presentation: 'landscape',
        snapshot: {
          projectRoot: 'D:\\issue-361.pandastage',
          project,
          dirty: false,
          revision: 0,
        },
      }),
    );

    expect(item).toContain('className="shot-list-item-actions"');
    expect(item).not.toContain('shot-list-item-context');
    expect(quickActions).not.toContain('已选镜头');
    expect(quickActions).toContain('className="shot-quick-edit-field"');
    expect(quickActions).toContain('durationTouched');
    expect(quickActions).toContain('shot-quick-edit-error');
    expect(manager).toContain(
      "presentation === 'landscape' ? '' : SHOT_STATUS_GUIDANCE",
    );
    expect(manager).toMatch(
      /presentation === 'landscape'\s+\? success\s+:/u,
    );
    expect(markup).toContain('data-testid="shot-selected-actions"');
    expect(markup).not.toContain('已选镜头');
    expect(markup).not.toContain('局部修改会先应用到当前项目');
    expect(styles).toContain('shot-list-item-actions');
    expect(styles).not.toContain('border-left: 2px solid rgb(131 211 154 / 62%)');
  });

  it('preserves existing mutation owners and portrait ShotEditor behavior', () => {
    const manager = source('src/renderer/features/shots/ShotManager.tsx');
    const quickActions = source(
      'src/renderer/features/shots/ShotQuickActions.tsx',
    );
    const styles = source('src/renderer/styles.css');

    for (const mutation of [
      'shotStore.create',
      'shotStore.select',
      'shotStore.move',
      'shotStore.rename',
      'shotStore.setDuration',
      'shotStore.duplicate',
      'shotStore.remove',
    ]) {
      expect(manager).toContain(mutation);
    }
    expect(manager).toContain("presentation === 'landscape' ? null");
    expect(manager).toContain('<ShotEditor');
    expect(quickActions).toContain('onRename(nameInput)');
    expect(quickActions).toContain('onSetDuration(durationMs)');
    expect(quickActions).toContain('setActiveEditor(null)');
    expect(styles).toContain(
      ".editor-layout[data-shell-mode='landscape']",
    );
    expect(styles).toContain('min-height: 44px;');
  });
});
