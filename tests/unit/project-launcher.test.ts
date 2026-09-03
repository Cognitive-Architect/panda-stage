import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  NewProjectDialog,
  type NewProjectDialogProps,
} from '../../src/renderer/shell/NewProjectDialog';
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

function renderNewProjectDialog(
  overrides: Partial<NewProjectDialogProps> = {},
): string {
  return renderToStaticMarkup(
    createElement(NewProjectDialog, {
      busy: false,
      onCancel: vi.fn(),
      onChooseParentDirectory: vi.fn(async () => undefined),
      onCreateProject: vi.fn(async () => undefined),
      onParentDirectoryChange: vi.fn(),
      onProjectNameChange: vi.fn(),
      parentDirectory: '',
      projectName: '',
      status: '',
      ...overrides,
    }),
  );
}

describe('Issue #414 Project Launcher visual refinement presentation', () => {
  it('makes Continue Creating the focal action for an open clean project', () => {
    const markup = renderStartScreen({
      projectRoot: 'D:\\projects\\story.pandastage',
      project: { name: 'Story Project' },
      dirty: false,
    });

    expect(markup).toContain('data-project-launcher-state="current-project"');
    expect(markup).toContain('id="recovery-heading"');
    expect(markup).not.toContain('<h1');
    expect(markup).not.toContain('>项目</h1>');
    expect(markup).toContain('欢迎回来');
    expect(markup).toContain('继续你的创作');
    expect(markup).toContain('Story Project');
    expect(markup).toContain('class="clean-state"');
    expect(markup).toContain('launcher-save-state-icon');
    expect(markup).toContain('class="launcher-current-project-glyph"');
    expect(markup).toContain('D:\\projects\\story.pandastage');
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

  it('uses a local atmospheric Banner and removes the duplicate no-project Hero copy', () => {
    const markup = renderStartScreen();

    expect(markup).toContain('data-project-launcher-state="no-project"');
    expect(markup).toContain('id="recovery-heading"');
    expect(markup).not.toContain('<h1');
    expect(markup).not.toContain('>项目</h1>');
    expect(markup).toContain('开始创作');
    expect(markup).toContain('新建一个项目，或继续最近的工作');
    expect(markup).toContain('data-testid="project-launcher-banner"');
    expect(markup).toContain('class="project-launcher-banner"');
    expect(markup).not.toContain('data-testid="project-center-current-project"');
    expect(markup).not.toContain('继续创作');
    expect(markup).not.toContain('当前项目仍保持打开');
    expect(markup).not.toContain('project-launcher-welcome');
    expect(markup).toContain('data-testid="open-project"');
    expect(markup).toContain('data-testid="new-project-button"');
    expect(markup).toContain('从一个空白项目开始');
    expect(markup).toContain('打开已有 Panda Stage 项目');
    expect(markup).not.toContain('更多打开方式');
    expect(markup).not.toContain('从这里开始你的新项目');
    expect(markup).not.toContain('<details open=""');
  });

  it('keeps native chooser opening in the shell and preserves lifecycle contracts off-surface', () => {
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
    expect(shell).not.toContain('项目中心已打开，当前项目与编辑状态保持不变。');
    expect(shell).not.toContain('已取消选择，当前项目与编辑状态保持不变。');
    expect(entry).toContain('data-testid="open-project"');
    expect(entry).toContain('onClick={() => void openProjectFromChooser()}');
    expect(entry).toContain('className="launcher-legacy-open-compat"');
    expect(entry).toContain('data-testid="open-project-path"');
    expect(entry).not.toContain('更多打开方式');
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
    expect(recent).toContain('recent-project-launcher-glyph');
    expect(recent).toContain('recent-project-launcher-path');
    expect(recent).toContain('data-task4-core="recent-relocate"');
    expect(recent).toContain(
      '!launcher ? <p className="eyebrow">项目入口</p> : null',
    );
  });
});

describe('Issue #415 Project Launcher copy cleanup', () => {
  it('does not render the passive no-project status instruction by default', () => {
    const markup = renderStartScreen();

    expect(markup).not.toContain('请选择一个 .pandastage 项目文件夹。');
    expect(markup).not.toContain('project-launcher-status">请选择');
  });

  it('keeps the initial New Project dialog quiet while naming the directory field accessibly', () => {
    const markup = renderNewProjectDialog();

    expect(markup).toContain('role="group"');
    expect(markup).toContain('id="new-project-parent-field-label"');
    expect(markup).toContain(
      '<span class="sr-only" id="new-project-parent-field-label">存放文件夹</span>',
    );
    expect(markup).toContain('aria-labelledby="new-project-parent-field-label"');
    expect(markup).not.toContain('<div class="new-project-field">存放文件夹');
    expect(markup).not.toContain('请先选择新项目的存放文件夹。');
    expect(markup).not.toContain('请输入项目名称。');
    expect(markup).not.toContain('请选择存放文件夹并填写项目名称。');
    expect(markup).not.toContain('new-project-hint');
    expect(markup).toMatch(
      /data-testid="new-project-confirm"[^>]*disabled=""/u,
    );
  });

  it('retains invalid gating and actionable runtime status presentation', () => {
    const invalidMarkup = renderNewProjectDialog({
      parentDirectory: 'D:\\作品',
      projectName: '短片?',
    });
    const runtimeError = renderNewProjectDialog({
      status: '该文件夹中已存在同名项目，请换一个项目名称。',
    });

    expect(invalidMarkup).toMatch(
      /data-testid="new-project-confirm"[^>]*disabled=""/u,
    );
    expect(runtimeError).toContain('该文件夹中已存在同名项目，请换一个项目名称。');
  });
});
