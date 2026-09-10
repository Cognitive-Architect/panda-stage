import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import { migrateProject } from '../../src/domain';
import { CharacterList } from '../../src/renderer/features/characters/CharacterList';
import { ResourceActivityDock } from '../../src/renderer/shell/ResourceActivityDock';

const noop = () => undefined;

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

describe('Issue #478 Character header and create-view trim', () => {
  it('removes redundant create-view copy without changing the form rule', () => {
    const project = migrateProject(exampleProject);
    const imageAssets = project.assets.filter(
      (asset) => asset.kind === 'image',
    );
    const markup = renderToStaticMarkup(
      createElement(CharacterList, {
        characters: [],
        imageAssets: imageAssets.slice(0, 1),
        mode: 'create',
        onCreate: noop,
        onSelect: noop,
        presentation: 'landscape',
        selectedCharacterId: null,
        showHeading: false,
      }),
    );

    expect(markup).toContain('角色名称');
    expect(markup).toContain('普通表情图片');
    expect(markup).toContain('生气表情图片');
    expect(markup).toContain('张嘴图（可选）');
    expect(markup).not.toContain('创建含普通 / 生气表情的角色');
    expect(markup).not.toContain('至少需要两张不同的项目图片素材。');
    expect(markup).toContain('disabled=""');
  });

  it('keeps the approved Character actions and accessibility seam while moving actions left', () => {
    const dock = source('src/renderer/shell/ResourceActivityDock.tsx');
    const styles = source('src/renderer/styles.css');
    const list = source('src/renderer/features/characters/CharacterList.tsx');

    expect(dock).toContain('hideLandscapeCharacterListTitle');
    expect(dock).toContain(
      "'resource-activity-heading-sr-only'",
    );
    expect(dock).toContain('icon={CirclePlus}');
    expect(dock).toContain('icon={ArrowLeft}');
    expect(dock).toContain("label: '新建角色'");
    expect(dock).toContain("label: '返回角色列表'");
    expect(styles).toContain(
      ".resource-activity-header-actions[data-resource-action-group='character-list-landscape']",
    );
    expect(styles).toContain('width: 100%;');
    expect(styles).toContain('justify-content: space-between;');
    expect(list).not.toContain('character-empty-state-anchor');
    expect(list).toContain('normalAssetId !== angryAssetId');
    expect(list).toContain('onCreate({');
  });

  it('renders the landscape list action row without a visible duplicate title', () => {
    const project = migrateProject(exampleProject);
    const markup = renderToStaticMarkup(
      createElement(ResourceActivityDock, {
        activeActivity: 'characters',
        presentation: 'landscape',
        snapshot: {
          projectRoot: 'D:\\PandaStage-Acceptance\\issue-478.pandastage',
          project,
          dirty: false,
          revision: 0,
        },
      }),
    );

    expect(markup).toContain(
      'resource-activity-heading resource-activity-heading-sr-only',
    );
    expect(markup).toContain(
      '<h2 id="resource-activity-heading">角色</h2>',
    );
    const actionIndex = markup.indexOf(
      'data-testid="resource-primary-action"',
    );
    const closeIndex = markup.indexOf(
      'data-testid="resource-activity-close"',
    );
    expect(actionIndex).toBeGreaterThan(-1);
    expect(closeIndex).toBeGreaterThan(actionIndex);
    expect(markup).toContain('data-resource-action="characters-新建角色"');
    expect(markup).toContain('data-resource-action-group="character-list-landscape"');
  });
});
