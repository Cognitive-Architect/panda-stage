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

function detailMarkup(withMouth = false): string {
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
      view: 'detail',
    }),
  );
}

function settingsMarkup(withMouth = false): string {
  const markup = detailMarkup(withMouth);
  return markup.slice(markup.indexOf('data-workspace="settings"'));
}

describe('Issue #526 Character Settings visual polish', () => {
  it('keeps the expression count dynamic and removes redundant settings copy', () => {
    const { character } = fixture();
    const markup = detailMarkup();
    const settings = settingsMarkup();

    expect(markup).toContain('class="character-workspace-tab-count"');
    expect(markup).toContain(`>${character.expressions.length}</span>`);
    expect(settings).toContain('默认大小与方向');
    expect(settings).not.toContain('角色设置');
    expect(settings).not.toContain('嘴型');
    expect(settings).not.toContain('可选');
    expect(settings).toContain('张嘴图');
  });

  it('keeps configured and unconfigured mouth actions in distinct states', () => {
    const cleanSettings = settingsMarkup();
    const configuredSettings = settingsMarkup(true);

    expect(cleanSettings).toContain('data-mouth-configured="false"');
    expect(cleanSettings).not.toContain('class="character-mouth-clear"');
    expect(configuredSettings).toContain('data-mouth-configured="true"');
    expect(configuredSettings).toContain('更换');
    expect(configuredSettings).toContain('class="character-mouth-clear"');
    expect(configuredSettings).toContain('清除');
  });

  it('scopes the header, rename, badge, transform, and mouth layout rules', () => {
    const editor = source(
      'src/renderer/features/characters/CharacterEditor.tsx',
    );
    const styles = source('src/renderer/styles.css');
    const polishStart = styles.indexOf('/* Issue #526:');
    const polish = styles.slice(polishStart);

    expect(polishStart).toBeGreaterThanOrEqual(0);
    expect(polish).toContain('padding: 8px 0 0;');
    expect(polish).toContain('border-bottom: 0;');
    expect(polish).toContain('background: #0b140e;');
    expect(polish).toContain('color-scheme: dark;');
    expect(polish).toContain('border-radius: 999px;');
    expect(polish).toContain(
      'grid-template-columns: minmax(0, 1fr) max-content;',
    );
    expect(polish).toContain('justify-content: flex-start;');
    expect(polish).toContain('.character-mouth-state.is-configured');
    expect(polish).toContain(
      '.character-mouth-state:not(.is-configured)',
    );
    expect(editor).toContain('onSetMouthOpenAsset(null)');
    expect(editor).toContain('onSetDefaultTransform(scale, flipX)');
  });
});
