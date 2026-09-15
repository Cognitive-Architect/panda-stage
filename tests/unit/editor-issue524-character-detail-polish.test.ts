import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import { migrateProject } from '../../src/domain';
import { CharacterEditor } from '../../src/renderer/features/characters/CharacterEditor';

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

describe('Issue #524 R8 Character Detail visual polish', () => {
  it('keeps the identity anchor compact and removes redundant heading copy', () => {
    const editor = source(
      'src/renderer/features/characters/CharacterEditor.tsx',
    );
    const markup = detailMarkup();
    const identityStart = editor.indexOf(
      '<section className="character-detail-identity">',
    );
    const identityEnd = editor.indexOf('{renameOpen ?', identityStart);

    expect(identityStart).toBeGreaterThanOrEqual(0);
    expect(identityEnd).toBeGreaterThan(identityStart);
    expect(editor.slice(identityStart, identityEnd)).not.toContain(
      '<p className="eyebrow">角色</p>',
    );
    expect(markup).toContain('character-detail-identity-actions');
    expect(markup).toContain('character-identity-overflow');
  });

  it('keeps one clean Expression heading and the workspace action', () => {
    const editor = source(
      'src/renderer/features/characters/ExpressionEditor.tsx',
    );
    const markup = detailMarkup();

    expect(editor).not.toContain('<p className="eyebrow">角色表情</p>');
    expect(editor).not.toContain('在此查看并管理当前角色的表情。');
    expect(markup).toContain('id="character-expression-workspace-heading"');
    expect(markup).toContain('添加表情');
  });

  it('scopes the calmer tab state and compact card footer to landscape Character Detail', () => {
    const styles = source('src/renderer/styles.css');
    const polishStart = styles.indexOf('/* Issue #524:');
    const polish = styles.slice(polishStart);

    expect(polishStart).toBeGreaterThanOrEqual(0);
    expect(polish).toContain('grid-template-columns: 80px minmax(0, 1fr)');
    expect(polish).toContain('background: rgb(45 104 62 / 62%)');
    expect(polish).toContain('align-self: start');
    expect(polish).toContain('height: 84px');
    expect(polish).toContain(
      '.character-settings-workspace\n  > .character-settings-section.character-default-presentation',
    );
    expect(polish).toContain('grid-template-columns: minmax(0, 1fr);');
    expect(polish).toContain(
      'grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 40px',
    );
    expect(polish).toContain('grid-column: auto');
    expect(polish).toContain(
      '.expression-card.expression-default\n  .expression-card-actions',
    );
  });
});
