import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import {
  CharacterService,
  ProjectSchema,
  type Project,
} from '../../src/domain';
import { CharacterEditor } from '../../src/renderer/features/characters/CharacterEditor';
import { CharacterList } from '../../src/renderer/features/characters/CharacterList';
import { CharacterManager } from '../../src/renderer/features/characters/CharacterManager';

const noop = () => undefined;

function projectWithWarning(): Project {
  const project = ProjectSchema.parse(exampleProject);
  const character = project.characters[0]!;
  const secondExpression = character.expressions[1]!;
  return ProjectSchema.parse({
    ...project,
    assets: project.assets.map((asset) =>
      asset.id === secondExpression.assetId && asset.kind === 'image'
        ? { ...asset, width: 1_000, height: 320 }
        : asset,
    ),
  });
}

describe('character management components', () => {
  it('renders the manager, two-expression creation form, and project-save action', () => {
    const project = ProjectSchema.parse(exampleProject);
    const markup = renderToStaticMarkup(
      createElement(CharacterManager, {
        snapshot: {
          projectRoot: 'D:\\角色 项目.pandastage',
          project,
          dirty: true,
          revision: 4,
        },
      }),
    );

    expect(markup).toContain('角色与表情');
    expect(markup).toContain('创建含普通 / 生气表情的角色');
    expect(markup).toContain('张嘴图（可选）');
    expect(markup).toContain('保存整个项目');
    expect(markup).toContain('默认表情');
    expect(markup).toContain('语音配置仅保留最小项目数据');
    expect(markup).not.toContain('声音克隆按钮');
  });

  it('shows expression thumbnails, a default marker, protected deletion, and understandable size warnings', () => {
    const project = projectWithWarning();
    const character = project.characters[0]!;
    const imageAssets = project.assets.filter(
      (asset) => asset.kind === 'image',
    );
    const dataUrl =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';
    const thumbnails = Object.fromEntries(
      imageAssets.map((asset) => [
        asset.id,
        { status: 'ready' as const, dataUrl },
      ]),
    );
    const warnings = new CharacterService().dimensionWarnings(
      project,
      character.id,
    );
    const markup = renderToStaticMarkup(
      createElement(CharacterEditor, {
        character,
        imageAssets,
        thumbnails,
        warnings,
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
      }),
    );

    expect(markup.match(/<img/g)).toHaveLength(character.expressions.length);
    expect(markup).toContain('默认表情');
    expect(markup).toContain('请先选择替代表情，再删除默认表情。');
    expect(markup).toContain('图片尺寸差异超过 30%');
    expect(markup).toContain('中心位置 保持不变');
  });

  it('gives an explicit empty state when fewer than two images can define normal and angry', () => {
    const project = ProjectSchema.parse(exampleProject);
    const oneImage = project.assets.filter(
      (asset) => asset.kind === 'image',
    ).slice(0, 1);
    const markup = renderToStaticMarkup(
      createElement(CharacterList, {
        characters: [],
        imageAssets: oneImage,
        selectedCharacterId: null,
        onCreate: noop,
        onSelect: noop,
      }),
    );

    expect(markup).toContain('至少需要两张不同的项目图片素材');
    expect(markup).toContain('disabled=""');
  });
});
