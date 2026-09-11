import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import { migrateProject } from '../../src/domain';
import { ShotCreateForm } from '../../src/renderer/features/shots/ShotCreateForm';
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
    expect(markup).toContain(
      '<strong>还没有镜头，</strong>先新建一个吧。',
    );
    expect(styles).toContain('.shot-list-empty-inline-copy');
    expect(styles).toContain(
      'grid-template-columns: minmax(0, 1fr);',
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

  it('removes the visible landscape form heading while preserving an accessible form name', () => {
    const markup = renderToStaticMarkup(
      createElement(ShotCreateForm, {
        onBack: noop,
        onCreate: () => true,
        presentation: 'landscape',
        suggestedName: '镜头 1',
      }),
    );

    expect(markup).toContain('aria-label="新建镜头"');
    expect(markup).not.toContain(
      '<h3 id="shot-create-heading">新建镜头</h3>',
    );
    expect(markup).not.toContain('shot-create-heading-landscape');
    expect(markup).toContain('data-testid="shot-create-name"');
    expect(markup).toContain('data-testid="shot-create-submit"');
  });

  it('keeps the enabled create action white while retaining a distinct disabled state', () => {
    const styles = source('src/renderer/styles.css');

    expect(styles).toMatch(
      /\.shot-create-primary-action \{[\s\S]*?color: var\(--ui-color-text-primary, #eef6f0\);[\s\S]*?background: var\(--ui-color-action-primary, #8ed9a2\);/u,
    );
    expect(styles).toContain('.shot-create-primary-action:disabled');
    expect(styles).toContain(
      'color: var(--ui-color-disabled-text, #84958b);',
    );
  });
});
