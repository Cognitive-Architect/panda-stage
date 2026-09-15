import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import { migrateProject } from '../../src/domain';
import {
  characterRenameValue,
  CharacterEditor,
} from '../../src/renderer/features/characters/CharacterEditor';
import { readOrderedStylesheetSource } from '../helpers/read-stylesheet-source';

const noop = () => undefined;

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

function detailMarkup(): string {
  const project = migrateProject(exampleProject);
  const character = project.characters[0]!;
  const imageAssets = project.assets.filter((asset) => asset.kind === 'image');
  const thumbnails = Object.fromEntries(
    imageAssets.map((asset) => [
      asset.id,
      { status: 'ready' as const, dataUrl: 'data:image/png;base64,fixture' },
    ]),
  );

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

describe('Issue #525 Character Detail header and inline rename', () => {
  it('removes duplicated identity count while preserving accessible detail context', () => {
    const markup = detailMarkup();
    const identityStart = markup.indexOf('character-detail-identity');
    const identityEnd = markup.indexOf('</section>', identityStart);
    const identity = markup.slice(identityStart, identityEnd);

    expect(markup).toContain('返回角色列表');
    expect(markup).not.toContain('← 返回角色列表');
    expect(markup).toContain('character-detail-navigation-detail');
    expect(markup).toContain(
      'class="sr-only character-detail-navigation-title"',
    );
    expect(markup).toContain('id="character-detail-title"');
    expect(identity).not.toContain('个表情');
    expect(markup).toContain('character-workspace-expressions-tab');
  });

  it('keeps rename inside the identity region with explicit cancel/save controls', () => {
    const editor = source(
      'src/renderer/features/characters/CharacterEditor.tsx',
    );
    const detailSectionStart = editor.indexOf('{landscapeDetail ? (');
    const legacySectionStart = editor.indexOf(
      "{view !== 'expression' && !landscapeDetail ?",
    );
    const detailSection = editor.slice(detailSectionStart, legacySectionStart);

    expect(detailSection).toContain('character-inline-rename-form');
    expect(detailSection).toContain('character-inline-rename-input');
    expect(detailSection).toContain('character-inline-rename-cancel');
    expect(detailSection).toContain('character-inline-rename-save');
    expect(detailSection).not.toContain('character-rename-form');
    expect(detailSection).toContain('onRenameCharacter(nextRenameValue)');
    expect(detailSection).toContain('setName(character.name);');
    expect(detailSection).toContain('setRenameOpen(true);');
    expect(detailSection).toContain('data-detail-close="true"');
    expect(editor).toContain(
      'landscapeExpression ? onBackToDetail : onBackToList',
    );
  });

  it('preserves trim, empty, unchanged, and valid rename semantics', () => {
    expect(characterRenameValue('   ', '左蓝毛')).toBeNull();
    expect(characterRenameValue(' 左蓝毛 ', '左蓝毛')).toBeNull();
    expect(characterRenameValue(' 新名字 ', '左蓝毛')).toBe('新名字');
  });

  it('scopes the compact back button and inline form fallback to landscape Character Detail', () => {
    const styles = readOrderedStylesheetSource();
    const polishStart = styles.indexOf('/* Issue #525:');
    const polish = styles.slice(polishStart);

    expect(polishStart).toBeGreaterThanOrEqual(0);
    expect(polish).toContain(
      'grid-template-columns: max-content minmax(0, 1fr);',
    );
    expect(polish).toContain('justify-self: end');
    expect(polish).toContain('border: 1px solid rgb(127 199 148 / 34%)');
    expect(polish).toContain('border-radius: var(--ui-radius-medium, 8px)');
    expect(polish).toContain('.character-inline-rename-form');
    expect(polish).toContain('.character-detail-identity-copy.is-renaming');
    expect(polish).toContain('@media (max-width: 360px)');
    expect(polish).toContain("grid-template-areas:\n      'rename'");
  });
});
