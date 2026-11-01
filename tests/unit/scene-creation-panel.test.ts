import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import { migrateProject, ShotService } from '../../src/domain';
import { SceneCreationPanel } from '../../src/renderer/features/shots/SceneCreationPanel';
import { ShotCreateForm } from '../../src/renderer/features/shots/ShotCreateForm';
import { ResourceActivityDock } from '../../src/renderer/shell/ResourceActivityDock';

const noop = () => undefined;

function snapshotOf(project: ReturnType<typeof migrateProject>) {
  return {
    projectRoot: 'D:\\PandaStage-Acceptance\\issue-860-ui01.pandastage',
    project,
    dirty: false,
    revision: 0,
  };
}

function multiShotProject() {
  let project = migrateProject(exampleProject);
  const shots = new ShotService();
  project = shots.create(project, {
    name: 'Issue 860 UI01 A',
    durationMs: 3_000,
  });
  return shots.create(project, {
    name: 'Issue 860 UI01 B',
    durationMs: 3_000,
  });
}

describe('Issue #860 automatic scene entry', () => {
  it('shows both list-level routes for empty and multi-shot projects', () => {
    const projects = [
      migrateProject({ ...exampleProject, shots: [] }),
      multiShotProject(),
    ];

    expect(projects[0]?.shots).toHaveLength(0);
    expect(projects[1]?.shots.length).toBeGreaterThan(1);

    for (const project of projects) {
      const markup = renderToStaticMarkup(
        createElement(ResourceActivityDock, {
          activeActivity: 'shots',
          snapshot: snapshotOf(project),
        }),
      );

      const manualEntry = markup.indexOf(
        'data-testid="resource-primary-action"',
      );
      const automaticEntry = markup.indexOf(
        'data-testid="resource-auto-scene-action"',
      );

      expect(manualEntry).toBeGreaterThanOrEqual(0);
      expect(automaticEntry).toBeGreaterThan(manualEntry);
      expect(markup).toContain('data-resource-action="shots-新建镜头"');
      expect(markup).toContain('data-resource-action="shots-auto-scene"');
      expect(markup).toContain('>自动布景</button>');
    }
  });

  it('keeps manual name, duration, submit, and back controls without the old route', () => {
    const markup = renderToStaticMarkup(
      createElement(ShotCreateForm, {
        suggestedName: '镜头 1',
        onBack: noop,
        onCreate: () => false,
      }),
    );

    expect(markup).toContain('data-testid="shot-create-back"');
    expect(markup).toContain('<label>名称<input');
    expect(markup).toContain('时长（毫秒）');
    expect(markup).toContain('创建镜头');
    expect(markup).not.toContain('shot-create-structured-input');
    expect(markup).not.toContain('粘贴结构化输入');
  });

  it('keeps the three-line format as a placeholder and removes retired helper UI', () => {
    const markup = renderToStaticMarkup(
      createElement(SceneCreationPanel, {
        snapshot: null,
        onBack: noop,
      }),
    );

    expect(markup).toContain('<section aria-label="自动布景"');
    expect(markup).not.toContain('scene-creation-heading');
    expect(markup).toContain('粘贴布景信息');
    expect(markup).toMatch(
      /placeholder="格式示例(?:\n|&#10;)镜头：花园相遇(?:\n|&#10;)背景：花园(?:\n|&#10;)出场：张三"/u,
    );
    expect(markup).toContain('rows="5"');
    expect(markup).toContain('data-testid="scene-creation-back"');
    expect(markup).toContain('aria-label="返回镜头列表"');
    expect(markup).toContain('<span aria-hidden="true">←</span>');
    expect(markup).toContain('data-testid="scene-creation-inspect"');
    expect(markup).toContain('>匹配素材</button>');

    const textareaContent = markup.match(
      /<textarea\b[^>]*>([\s\S]*?)<\/textarea>/u,
    )?.[1];
    expect(textareaContent).toBe('');
    expect(markup).not.toContain('粘贴结构化输入');
    expect(markup).not.toContain('按文本布景');
    expect(markup).not.toContain('scene-creation-format');
    expect(markup).not.toContain('格式示例</summary>');
    expect(markup).not.toContain('外部 AI');
    expect(markup).not.toContain('整理提示词');
    expect(markup).not.toContain('scene-creation-copy-prompt');
  });
});
