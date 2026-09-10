import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import { migrateProject } from '../../src/domain';
import { ShotList } from '../../src/renderer/features/shots/ShotList';
import { ResourceActivityDock } from '../../src/renderer/shell/ResourceActivityDock';

const noop = () => undefined;

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

function emptyProject() {
  return migrateProject({
    ...exampleProject,
    shots: [],
  });
}

describe('Issue #480 landscape Shot empty-state visual pass', () => {
  it('renders a compact, decorative three-frame storyboard cue with final copy', () => {
    const project = emptyProject();
    const markup = renderToStaticMarkup(
      createElement(ShotList, {
        compactDuration: true,
        onCreate: () => false,
        onMove: noop,
        onSelect: noop,
        selectedShotId: null,
        shots: project.shots,
        showCreateForm: false,
        inlineEmptyCopy: true,
        showStoryboardCue: true,
      }),
    );

    expect(markup).toContain('data-testid="shot-empty-storyboard"');
    expect(markup).toContain('data-shot-empty-frame="1"');
    expect(markup).toContain('data-shot-empty-frame="2"');
    expect(markup).toContain('data-shot-empty-frame="3"');
    expect(markup).toContain('镜头 1');
    expect(markup).toContain('镜头 2');
    expect(markup).toContain('镜头 3');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('还没有镜头');
    expect(markup).toContain('先新建一个吧。');
    expect(markup).not.toContain('先新建一个，我们从第一幕开始。');
  });

  it('removes only the landscape Shot list heading while keeping its action row visible', () => {
    const project = emptyProject();
    const markup = renderToStaticMarkup(
      createElement(ResourceActivityDock, {
        activeActivity: 'shots',
        presentation: 'landscape',
        snapshot: {
          projectRoot: 'D:\\PandaStage-Acceptance\\issue-480.pandastage',
          project,
          dirty: false,
          revision: 0,
        },
      }),
    );

    expect(markup).toContain('<section aria-label="镜头"');
    expect(markup).not.toContain('aria-labelledby="resource-activity-heading"');
    expect(markup).not.toContain(
      '<h2 id="resource-activity-heading">镜头</h2>',
    );
    expect(markup).toContain(
      'data-resource-header-layout="shot-list-landscape"',
    );
    expect(markup).toContain(
      'data-resource-action-group="shot-list-landscape"',
    );
    expect(markup).toContain('data-resource-action="shots-新建镜头"');
    expect(markup).toContain('data-testid="resource-activity-close"');
    expect(markup).toContain('data-testid="shot-empty-storyboard"');
  });

  it('suppresses landscape success receipts without silencing errors or default feedback', () => {
    const manager = source('src/renderer/features/shots/ShotManager.tsx');
    const styles = source('src/renderer/styles.css');

    expect(manager).toMatch(
      /const createShot[\s\S]*?if \(next && presentation === 'landscape'\) setStatus\(''\);/u,
    );
    expect(manager).toMatch(
      /if \(next\?\.shots\.length === 0\) \{\s+if \(presentation === 'landscape'\) \{\s+setStatus\(''\);/u,
    );
    expect(manager).toContain(
      'error instanceof ShotServiceError || error instanceof Error',
    );
    expect(manager).toMatch(
      /presentation === 'landscape'\s+\?\s+success/u,
    );
    expect(manager).not.toContain('最后一个镜头已移除，请创建新镜头。');
    expect(styles).toContain('.shot-empty-storyboard');
    expect(styles).toContain('shot-empty-storyboard-card-muted');
    expect(styles).toContain('shot-empty-storyboard-card-faded');
  });
});
