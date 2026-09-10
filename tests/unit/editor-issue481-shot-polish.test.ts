import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import { migrateProject } from '../../src/domain';
import { ShotList } from '../../src/renderer/features/shots/ShotList';

const noop = () => undefined;

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

describe('Issue #481 Shot polish', () => {
  it('keeps the landscape empty copy inline while preserving natural narrow wrapping', () => {
    const project = migrateProject({
      ...exampleProject,
      shots: [],
    });
    const markup = renderToStaticMarkup(
      createElement(ShotList, {
        inlineEmptyCopy: true,
        onCreate: () => false,
        onMove: noop,
        onSelect: noop,
        selectedShotId: null,
        shots: project.shots,
        showCreateForm: false,
        showStoryboardCue: true,
      }),
    );
    const styles = source('src/renderer/styles.css');

    expect(markup).toContain(
      'shot-list-empty shot-list-empty-inline-copy',
    );
    expect(markup).toContain('还没有镜头');
    expect(markup).toContain('先新建一个吧。');
    expect(styles).toContain('.shot-list-empty-inline-copy');
    expect(styles).toContain(
      'grid-template-columns: minmax(0, max-content) minmax(0, max-content);',
    );
    expect(styles).toContain('grid-column: 1 / -1;');
    expect(styles).toContain('min-width: 0;');
  });

  it('removes only the landscape Shot create resource heading and keeps direct labeling and compact actions', () => {
    const dock = source('src/renderer/shell/ResourceActivityDock.tsx');
    const styles = source('src/renderer/styles.css');

    expect(dock).toContain(
      "const useDirectLandscapeShotWorkspaceLabel =\n    landscapePresentation &&\n    activeActivity === 'shots';",
    );
    expect(dock).toContain("'shot-create-landscape'");
    expect(dock).toContain(
      'useDirectLandscapeShotWorkspaceLabel ||\n            useDirectCharacterWorkspaceLabel ? null : (',
    );
    expect(dock).toContain('data-testid="resource-primary-action"');
    expect(dock).toContain('data-testid="resource-activity-close"');
    expect(dock).toContain('? activeLabel');
    expect(styles).toContain(
      "data-resource-action-group='shot-create-landscape'",
    );
    expect(styles).toContain('grid-template-columns: minmax(0, 1fr) 44px;');
    expect(styles).toContain('width: auto;');
  });
});
