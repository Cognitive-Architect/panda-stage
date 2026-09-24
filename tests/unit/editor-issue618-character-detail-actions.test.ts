import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import {
  migrateProject,
  ProjectSchema,
  type Character,
  type CompositeCharacterDefinition,
  type ImageAsset,
} from '../../src/domain';
import { CharacterEditor } from '../../src/renderer/features/characters/CharacterEditor';
import { ExpressionEditor } from '../../src/renderer/features/characters/ExpressionEditor';
import type { ThumbnailState } from '../../src/renderer/features/assets/AssetCard';
import { readOrderedStylesheetSource } from '../helpers/read-stylesheet-source';

const noop = () => undefined;

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

function fixture(composite = false): {
  character: Character;
  imageAssets: ImageAsset[];
  thumbnails: Record<string, ThumbnailState>;
} {
  const project = migrateProject(exampleProject);
  const imageAssets = project.assets.filter(
    (asset): asset is ImageAsset => asset.kind === 'image',
  );
  const base = project.characters[0]!;
  const character = composite
    ? ProjectSchema.parse({
        ...project,
        characters: [
          {
            ...base,
            mode: 'composite' as const,
            bodyAssetId: imageAssets[0]!.id,
            facePlacement: { offsetX: 0, offsetY: 0, scale: 1 },
          },
        ],
      }).characters[0]!
    : base;
  const thumbnails: Record<string, ThumbnailState> = Object.fromEntries(
    imageAssets.map((asset) => [
      asset.id,
      { status: 'ready' as const, dataUrl: 'data:image/png;base64,fixture' },
    ]),
  );
  return { character, imageAssets, thumbnails };
}

function detailMarkup({
  composite = false,
  withAssemblyDraft = false,
}: { composite?: boolean; withAssemblyDraft?: boolean } = {}): string {
  const { character, imageAssets, thumbnails } = fixture(composite);
  const assemblyDraft: CompositeCharacterDefinition | null =
    withAssemblyDraft && character.mode === 'composite'
      ? {
          bodyAssetId: character.bodyAssetId,
          facePlacement: character.facePlacement,
          expressionAssets: character.expressions.map((expression) => ({
            expressionId: expression.id,
            assetId: expression.assetId,
          })),
          mouthOpenAssetId: character.mouthOpenAssetId ?? null,
        }
      : null;

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
      assemblyDraft,
      onOpenAssembly: () => true,
      onLeaveAssembly: () => true,
      presentation: 'landscape',
      view: 'detail',
    }),
  );
}

function expressionMarkup(isAddOpen: boolean): string {
  const { character, imageAssets, thumbnails } = fixture();
  return renderToStaticMarkup(
    createElement(ExpressionEditor, {
      character,
      imageAssets,
      thumbnails,
      warnings: [],
      disabled: false,
      isAddOpen,
      onAddOpenChange: noop,
      onAdd: noop,
      onRename: noop,
      onSetAsset: noop,
      onRemove: noop,
      onSetDefault: noop,
      onThumbnailError: noop,
      presentation: 'landscape',
    }),
  );
}

describe('Issue #618 Character Detail actions', () => {
  it('places rename before the name and shows the expanded-aware add action in identity', () => {
    const { character } = fixture();
    const markup = detailMarkup();
    const identityStart = markup.indexOf(
      '<section class="character-detail-identity">',
    );
    const identityEnd = markup.indexOf('</section>', identityStart);
    const renameIndex = markup.indexOf('data-testid="character-rename-trigger"');
    const nameIndex = markup.indexOf(`<h3>${character.name}</h3>`);
    const addIndex = markup.indexOf('data-testid="expression-add-trigger"');
    const expressionPanel = markup.slice(
      markup.indexOf('data-testid="character-expression-workspace"'),
      markup.indexOf('data-testid="character-settings-workspace"'),
    );

    expect(renameIndex).toBeGreaterThan(identityStart);
    expect(renameIndex).toBeLessThan(nameIndex);
    expect(addIndex).toBeGreaterThan(nameIndex);
    expect(addIndex).toBeLessThan(identityEnd);
    expect(markup).toContain('aria-label="编辑角色名称"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('＋ 添加表情</button>');
    expect(expressionPanel).toContain(
      '<h4 class="sr-only" id="character-expression-workspace-heading">表情</h4><ul class="expression-card-list">',
    );
    expect(expressionPanel).not.toContain('expression-add-trigger');
    expect(markup).not.toContain('character-identity-overflow');
    expect(markup).not.toContain('character-delete-overflow');
  });

  it('shows the same Settings delete action for single-image and composite Characters', () => {
    for (const composite of [false, true]) {
      const markup = detailMarkup({ composite });
      const settingsStart = markup.indexOf(
        'data-testid="character-settings-workspace"',
      );
      const deleteIndex = markup.indexOf(
        'data-testid="character-delete-settings"',
      );

      expect(markup).toContain(
        `data-workspace-count="${composite ? 3 : 2}"`,
      );
      expect(markup).toContain('data-testid="character-danger-zone"');
      expect(deleteIndex).toBeGreaterThan(settingsStart);
      expect(markup).toContain('aria-labelledby="character-danger-zone-heading"');
      expect(markup).toContain('data-testid="expression-delete-');
    }
  });

  it('keeps the add form controlled and preserves toggle, submit, cancel, and reset behavior', () => {
    const editor = source(
      'src/renderer/features/characters/CharacterEditor.tsx',
    );
    const expressionEditor = source(
      'src/renderer/features/characters/ExpressionEditor.tsx',
    );
    const openMarkup = expressionMarkup(true);
    const closedMarkup = expressionMarkup(false);

    expect(editor).toContain(
      'const [expressionAddOpen, setExpressionAddOpen] = useState(false);',
    );
    expect(editor).toContain(
      'onClick={() =>\n                    setExpressionAddOpen((isOpen) => !isOpen)',
    );
    expect(editor).toContain('if (activeWorkspace === \'expressions\') setExpressionAddOpen(false);');
    expect(openMarkup).toContain('aria-expanded="true"');
    expect(openMarkup).toContain('data-testid="expression-add-form"');
    expect(closedMarkup).not.toContain('data-testid="expression-add-form"');
    expect(expressionEditor).toContain('onClick={() => onAddOpenChange(!isAddOpen)}');
    expect(expressionEditor).toContain('onAdd(newName.trim(), newAssetId);');
    expect(expressionEditor).toContain('onAddOpenChange(false);');
    expect(expressionEditor).toContain('data-testid="expression-add-cancel"');
    expect(expressionEditor).toContain("setNewName('');");
    expect(expressionEditor).toContain('setNewAssetId(imageAssets[0]?.id ?? \'\');');
    expect(expressionEditor).toContain('disabled={disabled || !newName.trim() || !newAssetId}');
  });

  it('keeps the standalone Expression workspace add control and scopes final styling', () => {
    const markup = expressionMarkup(false);
    const styles = readOrderedStylesheetSource();
    const issue618Start = styles.lastIndexOf('/* Issue #618:');

    expect(markup).toContain('id="character-expression-workspace-heading"');
    expect(markup).toContain('＋ 添加表情</button>');
    expect(styles).toContain('.character-detail-identity-title-row');
    expect(styles).toContain('flex: 0 0 44px;');
    expect(styles).toContain('.character-delete-settings-action');
    expect(issue618Start).toBeGreaterThanOrEqual(0);
  });
});
