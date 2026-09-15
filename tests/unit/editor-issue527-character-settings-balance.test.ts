import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import {
  migrateProject,
  ProjectSchema,
  type Character,
  type ImageAsset,
} from '../../src/domain';
import { CharacterEditor } from '../../src/renderer/features/characters/CharacterEditor';
import type { ThumbnailState } from '../../src/renderer/features/assets/AssetCard';

const noop = () => undefined;

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

function fixture(withMouth = false): {
  character: Character;
  imageAssets: ImageAsset[];
  thumbnails: Record<string, ThumbnailState>;
} {
  const project = migrateProject(exampleProject);
  const imageAssets = project.assets.filter(
    (asset): asset is ImageAsset => asset.kind === 'image',
  );
  const character = ProjectSchema.parse({
    ...project,
    characters: project.characters.map((candidate, index) =>
      index === 0 && withMouth
        ? { ...candidate, mouthOpenAssetId: imageAssets[0]?.id }
        : candidate,
    ),
  }).characters[0]!;
  const thumbnails = Object.fromEntries(
    imageAssets.map((asset) => [
      asset.id,
      { status: 'ready' as const, dataUrl: 'data:image/png;base64,fixture' },
    ]),
  );
  return { character, imageAssets, thumbnails };
}

function detailMarkup(
  withMouth = false,
  view: 'detail' | 'expression' = 'detail',
): string {
  const { character, imageAssets, thumbnails } = fixture(withMouth);
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
      presentation: 'landscape',
      view,
    }),
  );
}

function settingsMarkup(withMouth = false): string {
  const markup = detailMarkup(withMouth);
  return markup.slice(markup.indexOf('data-workspace="settings"'));
}

describe('Issue #527 Character Settings balance polish', () => {
  it('removes only the redundant arrow from the list back control', () => {
    const detail = detailMarkup();
    const expression = detailMarkup(false, 'expression');

    expect(detail).toContain('返回角色列表');
    expect(detail).not.toContain('← 返回角色列表');
    expect(expression).toContain('← 返回角色详情');
  });

  it('uses a label-free two-half transform control area', () => {
    const settings = settingsMarkup();
    const styles = source('src/renderer/styles.css');
    const polish = styles.slice(styles.indexOf('/* Issue #527:'));

    expect(settings).toContain('character-scale-control-group');
    expect(settings).not.toContain('character-setting-label');
    expect(settings).not.toContain('大小</span>');
    expect(polish).toContain(
      'grid-template-columns: repeat(2, minmax(0, 1fr));',
    );
    expect(polish).toContain(
      'border-left: 1px solid rgb(127 199 148 / 22%);',
    );
  });

  it('promotes the mouth title and keeps clear inside the configured row', () => {
    const cleanSettings = settingsMarkup();
    const configuredSettings = settingsMarkup(true);
    const rowStart = configuredSettings.indexOf(
      'class="image-asset-picker-selected-row"',
    );
    const rowEnd = configuredSettings.indexOf('</div>', rowStart);
    const configuredRow = configuredSettings.slice(rowStart, rowEnd);
    const styles = source('src/renderer/styles.css');
    const polish = styles.slice(styles.indexOf('/* Issue #527:'));

    expect(cleanSettings).not.toContain('character-mouth-clear');
    expect(configuredRow).toContain('更换');
    expect(configuredRow).toContain('character-mouth-clear');
    expect(configuredRow).toContain('清除');
    expect(polish).toContain('.image-asset-picker-selected-row');
    expect(polish).toContain('font-size: 14px;');
    expect(polish).toContain(
      'grid-template-columns: minmax(0, 1fr) max-content;',
    );
  });
});
