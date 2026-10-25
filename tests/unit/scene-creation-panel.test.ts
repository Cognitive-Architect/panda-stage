import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import { migrateProject, ShotService } from '../../src/domain';
import {
  EXTERNAL_SCENE_ORGANIZATION_PROMPT,
  SceneCreationPanel,
} from '../../src/renderer/features/shots/SceneCreationPanel';
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

  it('keeps the three-line format and one progressive external-AI helper', () => {
    const markup = renderToStaticMarkup(
      createElement(SceneCreationPanel, {
        snapshot: null,
        onBack: noop,
      }),
    );

    expect(markup).toContain('<h3 id="scene-creation-heading">自动布景</h3>');
    expect(markup).toContain('粘贴布景信息');
    expect(markup).toMatch(
      /placeholder="镜头：花园相遇(?:\n|&#10;)背景：花园(?:\n|&#10;)出场：张三"/u,
    );
    expect(markup).toContain('<summary>格式示例</summary>');
    expect(markup).toContain(
      '<pre id="scene-creation-format">镜头：花园相遇\n背景：花园\n出场：张三</pre>',
    );
    expect(markup).not.toContain('粘贴结构化输入');
    expect(markup).not.toContain('按文本布景');

    const helperStart = markup.indexOf(
      '<details class="scene-creation-prompt-details">',
    );
    const helperEnd = markup.indexOf('</details>', helperStart);
    const helperMarkup = markup.slice(helperStart, helperEnd);

    expect(helperMarkup).toContain('<summary>用外部 AI 整理文本</summary>');
    expect(helperMarkup).toContain('Panda Stage 不会调用 AI');
    expect(helperMarkup).toContain(EXTERNAL_SCENE_ORGANIZATION_PROMPT);
    expect(helperMarkup).toContain('data-testid="scene-creation-copy-prompt"');
    expect(markup.match(/data-testid="scene-creation-copy-prompt"/gu)).toHaveLength(1);
    expect(markup).not.toContain('复制整理提示词');
    expect(markup).not.toContain('查看整理提示词');
  });
});
