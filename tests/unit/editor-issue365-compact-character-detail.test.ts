import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import { migrateProject } from '../../src/domain';
import {
  CharacterEditor,
  isDefaultTransformPending,
} from '../../src/renderer/features/characters/CharacterEditor';

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
  return { character, imageAssets };
}

function editorMarkup(
  thumbnails: Record<string, { status: 'ready'; dataUrl: string } | {
    status: 'missing';
    reason: 'source';
  }>,
): string {
  const { character, imageAssets } = fixture();
  return renderToStaticMarkup(
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
      onCloseDrawer: noop,
      onOpenExpressions: noop,
      presentation: 'landscape',
      view: 'detail',
    }),
  );
}

describe('Issue #365 compact landscape Character Detail', () => {
  it('keeps transform draft changes local until the existing apply action', () => {
    const { character } = fixture();

    expect(
      isDefaultTransformPending(
        character,
        character.defaultScale,
        character.defaultFlipX,
      ),
    ).toBe(false);
    expect(
      isDefaultTransformPending(
        character,
        character.defaultScale + 0.1,
        character.defaultFlipX,
      ),
    ).toBe(true);
    expect(
      isDefaultTransformPending(
        character,
        character.defaultScale,
        !character.defaultFlipX,
      ),
    ).toBe(true);
    expect(isDefaultTransformPending(character, Number.NaN, false)).toBe(false);
  });

  it('renders one compact detail header, a stable contained preview, and a quiet apply state', () => {
    const { imageAssets } = fixture();
    const thumbnails = Object.fromEntries(
      imageAssets.map((asset) => [
        asset.id,
        { status: 'ready' as const, dataUrl: `data:image/png;base64,${asset.id}` },
      ]),
    );
    const markup = editorMarkup(thumbnails);

    expect(markup).toContain('character-detail-navigation-title');
    expect(markup).toContain('data-detail-close="true"');
    expect(markup).toContain('data-preview-fit="contain"');
    expect(markup).toContain('data-default-transform-pending="false"');
    expect(markup).toContain('class="character-default-apply" data-pending="false"');
    expect(markup).not.toContain('character-default-pending');
  });

  it('makes missing source thumbnails explicit without changing expression names', () => {
    const { character, imageAssets } = fixture();
    const thumbnails = Object.fromEntries(
      imageAssets.map((asset) => [
        asset.id,
        { status: 'missing' as const, reason: 'source' as const },
      ]),
    );
    const markup = editorMarkup(thumbnails);

    expect(markup).toContain('class="character-thumbnail-fallback"');
    expect(markup).toContain('源文件缺失');
    for (const expression of character.expressions) {
      expect(markup).toContain(`<strong>${expression.name}</strong>`);
    }
  });

  it('keeps the corrective scoped to the existing landscape owners and drawer', () => {
    const editor = source(
      'src/renderer/features/characters/CharacterEditor.tsx',
    );
    const manager = source(
      'src/renderer/features/characters/CharacterManager.tsx',
    );
    const dock = source('src/renderer/shell/ResourceActivityDock.tsx');
    const styles = source('src/renderer/styles.css');

    expect(editor).toContain('character-default-action-row');
    expect(editor).toContain('character-default-revert');
    expect(editor).toContain('onSetDefaultTransform(scale, flipX)');
    expect(manager).toContain('onCloseDrawer={onCloseDrawer}');
    expect(dock).toContain('collapseLandscapeCharacterDetailHeader');
    expect(dock).toContain('onCloseDrawer={() => setDrawerOpen(false)}');
    expect(styles).toContain('/* Issue #365:');
    expect(styles).toContain('.character-detail-navigation-title');
    expect(styles).toContain('.character-thumbnail-fallback');
    expect(styles).toContain('.character-default-pending');
    expect(styles).toContain('object-fit: contain');
  });
});
