import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import { migrateProject } from '../../src/domain';
import { CharacterEditor } from '../../src/renderer/features/characters/CharacterEditor';
import { CharacterList } from '../../src/renderer/features/characters/CharacterList';
import { CharacterManager } from '../../src/renderer/features/characters/CharacterManager';

const noop = () => undefined;

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

function fixture() {
  const project = migrateProject(exampleProject);
  const character = project.characters[0]!;
  const imageAssets = project.assets.filter(
    (asset) => asset.kind === 'image',
  );
  const thumbnails = Object.fromEntries(
    imageAssets.map((asset) => [
      asset.id,
      {
        status: 'ready' as const,
        dataUrl: `data:image/png;base64,${asset.id}`,
      },
    ]),
  );
  return { project, character, imageAssets, thumbnails };
}

describe('Issue #364 Cloud Touch landscape Character workspace', () => {
  it('renders visual-first Character cards from the existing thumbnail state', () => {
    const { character, imageAssets, thumbnails } = fixture();
    const markup = renderToStaticMarkup(
      createElement(CharacterList, {
        characters: [character],
        imageAssets,
        selectedCharacterId: character.id,
        onCreate: noop,
        onSelect: noop,
        onThumbnailError: noop,
        presentation: 'landscape',
        thumbnails,
        mode: 'list',
      }),
    );
    const defaultExpression = character.expressions.find(
      (expression) => expression.id === character.defaultExpressionId,
    )!;

    expect(markup).toContain('data-character-list-presentation="landscape"');
    expect(markup).toContain(`${character.name} 默认表情`);
    expect(markup).toContain(
      `${character.expressions.length} 个表情 · 默认 ${defaultExpression.name}`,
    );
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('character-list-selected-badge');
    expect(markup).toContain('当前选择');
  });

  it('renders identity, visual expressions, compact defaults, mouth state and danger area', () => {
    const { character, imageAssets, thumbnails } = fixture();
    const markup = renderToStaticMarkup(
      createElement(CharacterEditor, {
        character,
        imageAssets,
        thumbnails,
        warnings: [],
        onRenameCharacter: noop,
        onDeleteCharacter: noop,
        onAddExpression: noop,
        onRenameExpression: noop,
        onSetExpressionAsset: noop,
        onRemoveExpression: noop,
        onSetDefaultExpression: noop,
        onSetMouthOpenAsset: noop,
        onSetDefaultTransform: noop,
        onThumbnailError: noop,
        onBackToList: noop,
        onOpenExpressions: noop,
        presentation: 'landscape',
        view: 'detail',
      }),
    );

    expect(markup).toContain('data-testid="character-detail-back"');
    expect(markup).toContain('← 角色列表');
    expect(markup).toContain('character-detail-identity');
    expect(markup).toContain(`${character.name} 默认表情`);
    expect(markup.match(/character-expression-preview/gu)).toHaveLength(
      character.expressions.length,
    );
    expect(markup).toContain('data-expression-default="true"');
    expect(markup).toContain('管理全部表情');
    expect(markup).toContain(`${character.defaultScale.toFixed(1)}×`);
    expect(markup).toContain('role="switch"');
    expect(markup).toContain('水平翻转');
    expect(markup).toContain('嘴型');
    expect(markup).toContain('未配置');
    expect(markup).toContain('危险操作');
    expect(markup).toContain('删除角色');
    expect(markup).not.toContain('未配置（安全降级为闭嘴）');
  });

  it('keeps navigation and mutations on the existing owners and quiets only landscape idle status', () => {
    const { project } = fixture();
    const markup = renderToStaticMarkup(
      createElement(CharacterManager, {
        snapshot: {
          projectRoot: 'D:\\PandaStage-Acceptance\\issue-364.pandastage',
          project,
          dirty: false,
          revision: 12,
        },
        presentation: 'landscape',
        view: 'detail',
      }),
    );
    const manager = source(
      'src/renderer/features/characters/CharacterManager.tsx',
    );
    const dock = source('src/renderer/shell/ResourceActivityDock.tsx');

    expect(markup).not.toContain(
      '局部修改会先应用到当前项目；请使用“保存整个项目”写入磁盘。',
    );
    expect(manager).toContain("onBackToList={() => onViewChange('list')}");
    expect(manager).toContain('presentation={presentation}');
    expect(manager).toContain('thumbnails={thumbnails}');
    expect(manager).toContain('characterStore.setDefaultTransform');
    expect(manager).toContain('characterStore.setMouthOpenAsset');
    expect(manager).toContain('characterStore.deleteCharacter');
    expect(dock).toContain('hideLandscapeCharacterPrimaryAction');
    expect(dock).toContain("? 'character-detail-landscape'");
    expect(dock).toContain(
      "landscapePresentation ? 'landscape' : 'default'",
    );
  });

  it('scopes Character workbench styling to landscape presentation', () => {
    const styles = source('src/renderer/styles.css');
    const scope =
      ".resource-activity-dock-landscape[data-active-activity='characters']";

    expect(styles).toContain(scope);
    expect(styles).toContain(
      ".character-manager[data-character-presentation='landscape']",
    );
    expect(styles).toContain('.character-list-avatar');
    expect(styles).toContain('.character-detail-avatar');
    expect(styles).toContain('.character-expression-visual-list');
    expect(styles).toContain('.character-scale-stepper');
    expect(styles).toContain('.character-flip-switch');
    expect(styles).toContain('.character-mouth-state');
    expect(styles).toContain('.character-danger-zone');
  });
});
