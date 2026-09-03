import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { StartScreen } from '../../src/renderer/shell/StartScreen';

function renderStartScreen(
  currentProject: {
    projectRoot: string;
    project: { name: string };
    dirty: boolean;
  } | null = null,
): string {
  return renderToStaticMarkup(
    createElement(StartScreen, {
      busy: false,
      currentProject,
      newProjectDialogOpen: false,
      onChooseProjectDirectory: vi.fn(async () => undefined),
      onOpenCandidatePathChange: vi.fn(),
      onOpenProject: vi.fn(async () => undefined),
      onOpenProjectFromChooser: vi.fn(async () => undefined),
      onOpenRecentProject: vi.fn(async () => undefined),
      onRequestNewProject: vi.fn(),
      onReturnToEditor: vi.fn(),
      openCandidatePath: '',
      recentRefreshToken: 0,
      status: '',
    }),
  );
}

describe('Issue #410 Project Launcher presentation', () => {
  it('makes Continue Creating the focal action for an open clean project', () => {
    const markup = renderStartScreen({
      projectRoot: 'D:\\projects\\story.pandastage',
      project: { name: 'Story Project' },
      dirty: false,
    });

    expect(markup).toContain('data-project-launcher-state="current-project"');
    expect(markup).toContain('欢迎回来');
    expect(markup).toContain('继续你的创作');
    expect(markup).toContain('Story Project');
    expect(markup).toContain('已保存');
    expect(markup).toContain('class="launcher-continue-button task4-hit-target"');
    expect(markup).toContain('继续创作');
    expect(markup).not.toContain('返回编辑器');
    expect(markup).not.toContain('当前项目仍保持打开');
    expect(markup).not.toContain('project-launcher-welcome');
  });

  it('keeps a dirty state truthful while retaining the same launcher hierarchy', () => {
    const markup = renderStartScreen({
      projectRoot: 'D:\\projects\\story.pandastage',
      project: { name: 'Story Project' },
      dirty: true,
    });

    expect(markup).toContain('有未保存更改');
    expect(markup).toContain('继续创作');
    expect(markup).toContain('class="dirty-state"');
  });

  it('makes the no-project state a lightweight start surface without a fake current card', () => {
    const markup = renderStartScreen();

    expect(markup).toContain('data-project-launcher-state="no-project"');
    expect(markup).toContain('开始创作');
    expect(markup).toContain('新建一个项目，或继续最近的工作');
    expect(markup).toContain('data-testid="project-launcher-welcome"');
    expect(markup).toContain('从这里开始你的新项目');
    expect(markup).not.toContain('data-testid="project-center-current-project"');
    expect(markup).not.toContain('继续创作');
    expect(markup).not.toContain('当前项目仍保持打开');
    expect(markup).toContain('data-testid="open-project"');
    expect(markup).toContain('data-testid="new-project-button"');
    expect(markup).toContain('更多打开方式');
    expect(markup).not.toContain('<details open=""');
  });

  it('keeps native chooser opening in the shell and leaves manual path entry advanced', () => {
    const shell = readFileSync(
      'src/renderer/shell/EditorShell.tsx',
      'utf8',
    );
    const entry = readFileSync(
      'src/renderer/shell/NewProjectEntry.tsx',
      'utf8',
    );

    expect(shell).toContain('onOpenProjectFromChooser={openProjectFromChooser}');
    expect(shell).toContain('await switchToProject(response.projectRoot);');
    expect(entry).toContain('data-testid="open-project"');
    expect(entry).toContain('onClick={() => void openProjectFromChooser()}');
    expect(entry).toContain('className="launcher-advanced-open"');
    expect(entry).toContain('data-testid="open-project-path"');
    expect(entry).not.toContain('window.pandaStage');
  });

  it('uses one launcher presentation of Recent Projects while preserving the existing owner', () => {
    const recent = readFileSync(
      'src/renderer/features/welcome/RecentProjectsPanel.tsx',
      'utf8',
    );

    expect(recent).toContain("| 'launcher'");
    expect(recent).toContain("data-presentation={presentation}");
    expect(recent).toContain('找不到项目');
    expect(recent).toContain('项目身份不匹配');
    expect(recent).toContain('项目文件无效');
    expect(recent).toContain('从最近项目移除，不会删除磁盘上的项目。');
    expect(recent).toContain('data-task4-core="recent-relocate"');
  });
});
