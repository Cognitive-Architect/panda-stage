import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import {
  CharacterService,
  ProjectSchema,
  migrateProject,
  type Project,
} from '../../src/domain';
import { CharacterEditor } from '../../src/renderer/features/characters/CharacterEditor';
import { CharacterList } from '../../src/renderer/features/characters/CharacterList';
import {
  CharacterManager,
  reconcileCharacterThumbnailEntries,
  visibleCharacterThumbnails,
} from '../../src/renderer/features/characters/CharacterManager';
import { ImageAssetPicker } from '../../src/renderer/features/characters/ImageAssetPicker';

const noop = () => undefined;

function projectWithWarning(): Project {
  const project = migrateProject(exampleProject);
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
  it('keeps ready thumbnails for unchanged id/hash across Project revisions', () => {
    const assets = migrateProject(exampleProject).assets.filter(
      (asset) => asset.kind === 'image',
    );
    const first = reconcileCharacterThumbnailEntries({}, 'project-1', 'D:\\one', assets);
    const ready = {
      ...first,
      [assets[0]!.id]: {
        ...first[assets[0]!.id]!,
        state: { status: 'ready' as const, dataUrl: 'data:image/png;base64,ready' },
      },
    };

    const replay = reconcileCharacterThumbnailEntries(
      ready, 'project-1', 'D:\\one', [...assets],
    );
    expect(replay).toBe(ready);
    expect(visibleCharacterThumbnails(replay, 'project-1', 'D:\\one', assets)[assets[0]!.id])
      .toEqual(ready[assets[0]!.id]!.state);

    const changed = assets.map((asset, index) => index === 0
      ? { ...asset, sha256: 'changed-hash' }
      : asset);
    const next = reconcileCharacterThumbnailEntries(
      ready, 'project-1', 'D:\\one', changed,
    );
    expect(next[assets[0]!.id]!.state).toEqual({ status: 'loading' });
    expect(next[assets[1]!.id]).toBe(ready[assets[1]!.id]);
    expect(visibleCharacterThumbnails(ready, 'project-1', 'D:\\one', changed)[assets[0]!.id])
      .toEqual({ status: 'loading' });
  });

  it('does not expose thumbnails from another project context and prunes removed assets', () => {
    const assets = migrateProject(exampleProject).assets.filter(
      (asset) => asset.kind === 'image',
    );
    const prior = reconcileCharacterThumbnailEntries({}, 'project-1', 'D:\\one', assets);
    const switched = reconcileCharacterThumbnailEntries(
      prior, 'project-2', 'D:\\two', assets.slice(0, 1),
    );
    expect(visibleCharacterThumbnails(prior, 'project-2', 'D:\\two', assets)[assets[0]!.id])
      .toEqual({ status: 'loading' });
    expect(switched[assets[0]!.id]!.resourceKey).not.toBe(prior[assets[0]!.id]!.resourceKey);
    expect(Object.keys(switched)).toEqual([assets[0]!.id]);
  });

  it('preserves a missing result for an unchanged resource but retries a changed hash', () => {
    const asset = migrateProject(exampleProject).assets.find(
      (candidate) => candidate.kind === 'image',
    )!;
    const loading = reconcileCharacterThumbnailEntries({}, 'project-1', 'D:\\one', [asset]);
    const missing = {
      [asset.id]: {
        ...loading[asset.id]!,
        state: { status: 'missing' as const, reason: 'source' as const },
      },
    };
    expect(reconcileCharacterThumbnailEntries(missing, 'project-1', 'D:\\one', [asset]))
      .toBe(missing);
    expect(reconcileCharacterThumbnailEntries(
      missing, 'project-1', 'D:\\one', [{ ...asset, sha256: 'new-hash' }],
    )[asset.id]!.state).toEqual({ status: 'loading' });
  });

  it('renders the manager and creation form without duplicating the global save action', () => {
    const project = migrateProject(exampleProject);
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
    expect(markup.indexOf('character-create-name')).toBeLessThan(
      markup.indexOf('character-create-mode-switch'),
    );
    expect(markup).not.toMatch(/<button[^>]*>保存整个项目/u);
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

    expect(markup.match(/<img/g)).toHaveLength(
      character.expressions.length +
        (character.mouthOpenAssetId ? 1 : 0) +
        (imageAssets.length > 0 ? 1 : 0),
    );
    expect(markup).toContain('默认表情');
    expect(markup).toContain('请先选择替代表情，再删除默认表情。');
    expect(markup).toContain('图片尺寸差异超过 30%');
    expect(markup).toContain('中心位置 保持不变');
  });

  it('renders a selected image card with supporting metadata and an explicit optional empty state', () => {
    const project = migrateProject(exampleProject);
    const imageAssets = project.assets.filter(
      (asset) => asset.kind === 'image',
    );
    const selected = imageAssets[0]!;
    const markup = renderToStaticMarkup(
      createElement(ImageAssetPicker, {
        assets: imageAssets,
        emptyOption: {
          description: '创建后也可以在角色详情中配置。',
          label: '暂不配置',
          optional: true,
        },
        label: '张嘴图（可选）',
        onChange: noop,
        onThumbnailError: noop,
        selectedAssetId: selected.id,
        testId: 'character-mouth-picker',
        thumbnails: {
          [selected.id]: {
            dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',
            status: 'ready',
          },
        },
      }),
    );

    expect(markup).toContain('data-image-asset-picker="张嘴图（可选）"');
    expect(markup).toContain(selected.name);
    expect(markup).toContain(`${selected.width}×${selected.height}`);
    expect(markup).toContain('更换');
    expect(markup).not.toContain('<select');

    const fallbackMarkup = renderToStaticMarkup(
      createElement(ImageAssetPicker, {
        assets: imageAssets,
        emptyOption: {
          description: '创建后也可以在角色详情中配置。',
          label: '暂不配置',
          optional: true,
        },
        label: '张嘴图（可选）',
        onChange: noop,
        onThumbnailError: noop,
        selectedAssetId: null,
        thumbnails: {},
      }),
    );
    expect(fallbackMarkup).toContain('暂不配置');
    expect(fallbackMarkup).toContain('创建后也可以在角色详情中配置。');
    expect(fallbackMarkup).toContain(
      'image-asset-picker-neutral-empty-thumbnail',
    );
  });

  it('gives an explicit empty state when fewer than two images can define normal and angry', () => {
    const project = migrateProject(exampleProject);
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

    expect(markup).toContain('还没有角色');
    expect(markup).toContain('先准备 2 张角色图片，就能创建角色了。');
    expect(markup).toContain('至少需要两张不同的项目图片素材');
    expect(markup).toContain('disabled=""');

    const noImageMarkup = renderToStaticMarkup(
      createElement(CharacterList, {
        characters: [],
        imageAssets: [],
        selectedCharacterId: null,
        onCreate: noop,
        onSelect: noop,
      }),
    );
    expect(noImageMarkup).toContain('请选择图片');
    expect(noImageMarkup).toContain('请选择不同图片');
  });
});
