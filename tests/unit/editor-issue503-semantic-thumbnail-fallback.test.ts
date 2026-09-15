import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import { migrateProject } from '../../src/domain';
import { CharacterAvatar, CharacterExpressionThumbnail, CharacterIdentityPicker } from '../../src/renderer/features/characters/CharacterIdentity';
import { CharacterEditor } from '../../src/renderer/features/characters/CharacterEditor';
import { ImageAssetPicker } from '../../src/renderer/features/characters/ImageAssetPicker';

const noop = () => undefined;
const project = migrateProject(exampleProject);
const character = project.characters[0]!;
const imageAssets = project.assets.filter((asset) => asset.kind === 'image');
const firstAsset = imageAssets[0]!;

function pickerMarkup(
  thumbnail: { status: 'loading' } | { status: 'missing'; reason?: 'cache' | 'source' | 'error' },
  selectedAssetId = firstAsset.id,
): string {
  return renderToStaticMarkup(
    createElement(ImageAssetPicker, {
      assets: imageAssets,
      label: '图片素材',
      onChange: noop,
      onThumbnailError: noop,
      selectedAssetId,
      thumbnails: { [firstAsset.id]: thumbnail },
    }),
  );
}

function editorProps(thumbnails: Record<string, { status: 'missing'; reason: 'source' }>) {
  return {
    character,
    imageAssets,
    onAddExpression: noop,
    onBackToDetail: noop,
    onDeleteCharacter: noop,
    onRenameCharacter: noop,
    onRenameExpression: noop,
    onRemoveExpression: noop,
    onSetDefaultExpression: noop,
    onSetDefaultTransform: noop,
    onSetExpressionAsset: noop,
    onSetMouthOpenAsset: noop,
    onThumbnailError: noop,
    thumbnails,
    view: 'expression' as const,
    presentation: 'landscape' as const,
    warnings: [],
  };
}

describe('Issue #503 semantic R6 thumbnail fallbacks', () => {
  it('maps picker empty, loading, missing, error, and stale states to distinct semantics', () => {
    const emptyMarkup = renderToStaticMarkup(
      createElement(ImageAssetPicker, {
        assets: imageAssets,
        emptyOption: {
          description: '创建后也可以配置。',
          label: '暂不配置',
        },
        label: '张嘴图（可选）',
        onChange: noop,
        onThumbnailError: noop,
        selectedAssetId: null,
        thumbnails: {},
      }),
    );
    expect(emptyMarkup).toContain('data-thumbnail-icon="empty"');
    expect(emptyMarkup).not.toContain('○');

    expect(pickerMarkup({ status: 'loading' })).toContain(
      'data-thumbnail-icon="loading"',
    );
    expect(pickerMarkup({ reason: 'cache', status: 'missing' })).toContain(
      'data-thumbnail-icon="missing"',
    );
    expect(pickerMarkup({ reason: 'source', status: 'missing' })).toContain(
      'data-thumbnail-icon="error"',
    );
    expect(pickerMarkup({ reason: 'error', status: 'missing' })).toContain(
      'data-thumbnail-icon="error"',
    );
    expect(
      pickerMarkup({ status: 'missing' }, 'stale-asset-reference'),
    ).toContain('data-thumbnail-icon="unknown"');
  });

  it('uses a person icon for an unbound Character and semantic avatar states', () => {
    const unboundMarkup = renderToStaticMarkup(
      createElement(CharacterIdentityPicker, {
        characters: [character],
        onSelect: noop,
        selectedCharacterId: null,
        thumbnails: {},
      }),
    );
    expect(unboundMarkup).toContain('data-thumbnail-icon="unbound"');
    expect(unboundMarkup).not.toContain('○');

    const loadingMarkup = renderToStaticMarkup(
      createElement(CharacterAvatar, { character }),
    );
    expect(loadingMarkup).toContain('data-thumbnail-icon="loading"');

    const errorMarkup = renderToStaticMarkup(
      createElement(CharacterExpressionThumbnail, {
        expression: character.expressions[0]!,
        onThumbnailError: noop,
        thumbnail: { reason: 'source', status: 'missing' },
      }),
    );
    expect(errorMarkup).toContain('data-thumbnail-icon="error"');
    expect(errorMarkup).toContain('源文件缺失');
  });

  it('covers the existing Character detail and expression fallback surfaces without literal glyphs', () => {
    const thumbnails = Object.fromEntries(
      imageAssets.map((asset) => [asset.id, { reason: 'source' as const, status: 'missing' as const }]),
    );
    const markup = renderToStaticMarkup(
      createElement(CharacterEditor, editorProps(thumbnails)),
    );

    expect(markup).toContain('expression-thumbnail-fallback');
    expect(markup).toContain('data-thumbnail-icon="error"');
    for (const file of [
      'src/renderer/features/characters/CharacterEditor.tsx',
      'src/renderer/features/characters/CharacterIdentity.tsx',
      'src/renderer/features/characters/ExpressionEditor.tsx',
      'src/renderer/features/characters/ImageAssetPicker.tsx',
    ]) {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toContain('○');
      expect(source).not.toContain('▧');
    }
  });
});
