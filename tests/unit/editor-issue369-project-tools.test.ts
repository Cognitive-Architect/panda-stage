import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(path, 'utf8').replace(/\r\n/gu, '\n');
}

describe('Issue #369 landscape Project Tools launcher', () => {
  it('keeps Project Tools content while relocating it to the unified right host', () => {
    const left = source('src/renderer/shell/LeftWorkspace.tsx');
    const dock = source('src/renderer/shell/ResourceActivityDock.tsx');
    const right = source('src/renderer/shell/RightWorkspace.tsx');
    const drawer = source('src/renderer/shell/ProjectToolsDrawer.tsx');
    const styles = source('src/renderer/styles.css');

    expect(left).not.toContain('<ProjectToolsDrawer');
    expect(left).not.toContain('<details');
    expect(left).not.toContain('landscape-project-tools');
    expect(dock).not.toContain('resource-activity-rail-project-tools');
    expect(right).toContain('<ProjectToolsDrawer');
    expect(right).toContain("{ id: 'tools', label: '工具', icon: Wrench }");
    expect(drawer).toContain('data-testid="project-tools-drawer"');
    expect(drawer).toContain('data-testid="project-tools-close"');
    expect(drawer).toContain('presentation="compact"');
    expect(styles).toContain('Issue #426 R1');
    expect(styles).toContain("grid-template-rows: repeat(3, minmax(72px, 1fr));");
  });

  it('keeps the home view task-focused and the ActionPreset owner second-level', () => {
    const drawer = source('src/renderer/shell/ProjectToolsDrawer.tsx');
    const recent = source(
      'src/renderer/features/welcome/RecentProjectsPanel.tsx',
    );
    const legacy = source('src/renderer/shell/LegacyWorkspace.tsx');

    expect(drawer).toContain('编辑辅助');
    expect(drawer).toContain('动作预设');
    expect(drawer).toContain('打开动作预设');
    expect(drawer).toContain('data-testid="project-tools-action-presets"');
    expect(drawer).toContain('data-testid="project-tools-back"');
    expect(drawer).toContain('<ProjectRecoveryPanel');
    expect(drawer).toContain('<LegacyWorkspace');
    expect(drawer).not.toContain('兼容编辑工具');
    expect(recent).toContain("presentation?: RecentProjectsPanelPresentation");
    expect(recent).toContain('data-testid="recent-project-more"');
    expect(recent).toContain('data-testid="recent-project-maintenance-menu"');
    expect(legacy).toContain('<ActionPresetPanel');
  });

  it('preserves recent-project relocation and record-only removal contracts', () => {
    const recent = source(
      'src/renderer/features/welcome/RecentProjectsPanel.tsx',
    );

    expect(recent).toContain('data-task4-core="recent-relocate"');
    expect(recent).toContain('data-task4-core="recent-remove"');
    expect(recent).toContain('recentProjects.relocate');
    expect(recent).toContain('recentProjects.remove');
    expect(recent).toContain('不会删除磁盘上的项目');
    expect(recent).toContain("entry.status === 'missing'");
    expect(recent).toContain('找不到项目');
    expect(recent).not.toContain('projectRoot}</span>');
  });

  it('keeps Project Tools navigation out of Project and History ownership', () => {
    const drawer = source('src/renderer/shell/ProjectToolsDrawer.tsx');
    const right = source('src/renderer/shell/RightWorkspace.tsx');

    for (const sourceText of [drawer, right]) {
      expect(sourceText).not.toContain('updateProject');
      expect(sourceText).not.toContain('editorProjectStore');
      expect(sourceText).not.toContain('HistoryControls');
    }
  });
});
