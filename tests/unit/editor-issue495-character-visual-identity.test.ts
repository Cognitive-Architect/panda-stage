import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import { migrateProject } from '../../src/domain';
import { CharacterEditor } from '../../src/renderer/features/characters/CharacterEditor';
import {
  CharacterAvatar,
  CharacterIdentityPicker,
  getCharacterDefaultExpression,
} from '../../src/renderer/features/characters/CharacterIdentity';
import { CharacterList } from '../../src/renderer/features/characters/CharacterList';

const noop = () => undefined;
const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

function fixture() {
  const project = migrateProject(exampleProject);
  const character = project.characters[0]!;
  const imageAssets = project.assets.filter((asset) => asset.kind === 'image');
  const defaultExpression = getCharacterDefaultExpression(character)!;
  const thumbnails = {
    [defaultExpression.assetId]: { status: 'ready' as const, dataUrl },
  };
  return { character, defaultExpression, imageAssets, thumbnails };
}

describe('Issue #495 Character visual identity parity', () => {
  it('derives the avatar strictly from the Character default expression', () => {
    const { character, defaultExpression } = fixture();

    expect(defaultExpression.id).toBe(character.defaultExpressionId);
    expect(getCharacterDefaultExpression(character)?.assetId).toBe(
      defaultExpression.assetId,
    );
    expect(
      getCharacterDefaultExpression({
        defaultExpressionId: 'missing-expression',
        expressions: [defaultExpression],
      }),
    ).toEqual(defaultExpression);
  });

  it('renders a compact selected Character identity picker with bounded options', () => {
    const { character, defaultExpression, thumbnails } = fixture();
    const secondCharacter = {
      ...character,
      id: '20000000-0000-4000-8000-000000000099',
      name: '另一个角色',
    };
    const markup = renderToStaticMarkup(
      createElement(CharacterIdentityPicker, {
        characters: [character, secondCharacter],
        'data-testid': 'dialogue-add-speaker',
        defaultOpen: true,
        onSelect: noop,
        selectedCharacterId: character.id,
        thumbnails,
      }),
    );

    expect(markup).toContain('data-testid="dialogue-add-speaker"');
    expect(markup).toContain('role="radiogroup"');
    expect(markup.match(/role="radio"/gu)).toHaveLength(2);
    expect(markup).toContain(`data-character-id="${character.id}"`);
    expect(markup).toContain(
      `data-character-id="${secondCharacter.id}"`,
    );
    expect(markup).toContain('aria-checked="true"');
    expect(markup).toContain('aria-checked="false"');
    expect(markup).toContain(character.name);
    expect(markup).toContain(defaultExpression.name);
    expect(markup).toContain('character-identity-options');
    expect(markup).toContain('character-identity-avatar');
    expect(markup).toContain(dataUrl);
  });

  it('keeps list and default detail surfaces on Character identity while exposing thumbnail fallback', () => {
    const { character, defaultExpression, imageAssets, thumbnails } = fixture();
    const listMarkup = renderToStaticMarkup(
      createElement(CharacterList, {
        characters: [character],
        imageAssets,
        mode: 'list',
        onCreate: noop,
        onSelect: noop,
        selectedCharacterId: character.id,
        thumbnails,
      }),
    );
    expect(listMarkup).toContain('character-list-avatar');
    expect(listMarkup).toContain('character-list-copy');
    expect(listMarkup).toContain(`${character.expressions.length} 个表情`);
    expect(listMarkup).toContain(defaultExpression.name);
    expect(listMarkup).toContain(dataUrl);

    const detailMarkup = renderToStaticMarkup(
      createElement(CharacterEditor, {
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
        presentation: 'default',
        thumbnails,
        view: 'detail',
        warnings: [],
      }),
    );
    expect(detailMarkup).toContain('character-expression-summary-preview');
    expect(detailMarkup).toContain('data-expression-default="true"');
    expect(detailMarkup).toContain('默认表情');
    expect(detailMarkup).toContain(dataUrl);

    const missingMarkup = renderToStaticMarkup(
      createElement(CharacterAvatar, {
        character,
        thumbnail: { reason: 'source', status: 'missing' },
      }),
    );
    expect(missingMarkup).toContain('data-thumbnail-status="missing"');
    expect(missingMarkup).toContain('源文件缺失');
    expect(missingMarkup).toContain(character.name);
  });

  it('wires A07-A11 through the existing Character and characterId owners', () => {
    const sheet = source('src/renderer/features/dialogue/DialogueSheet.tsx');
    const batch = source(
      'src/renderer/features/dialogue/DialogueBatchPaste.tsx',
    );
    const inspector = source(
      'src/renderer/features/dialogue/DialogueInspector.tsx',
    );
    const identity = source(
      'src/renderer/features/characters/CharacterIdentity.tsx',
    );

    expect(sheet).toContain('CharacterIdentityPicker');
    expect(sheet).toContain('useCharacterAvatarThumbnails');
    expect(sheet).toContain('data-testid="dialogue-add-speaker"');
    expect(sheet).toContain('draft.setSingleCharacterId(characterId)');
    expect(sheet).not.toContain('<select');

    expect(batch).toContain('CharacterIdentityPicker');
    expect(batch).toContain('useCharacterAvatarThumbnails');
    expect(batch).toContain(
      'data-testid={`dialogue-batch-map-${line.lineNumber}`}',
    );
    expect(batch).toContain(
      'draft.setBatchMapping(line.lineNumber, characterId)',
    );
    expect(batch).not.toContain('<select');

    expect(inspector.match(/<CharacterIdentityPicker/gu)).toHaveLength(4);
    expect(inspector).toContain('useCharacterAvatarThumbnails');
    expect(inspector).toContain('characterId,');
    expect(inspector).toContain('CharacterAvatar');
    expect(inspector).not.toContain('assetId: characterId');

    expect(identity).toContain('readThumbnail');
    expect(identity).toContain('assetId: asset.id');
    expect(identity).not.toContain('avatarAssetId:');
  });
});
