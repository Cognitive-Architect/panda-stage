import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import {
  CharacterService,
  ProjectSchema,
  migrateProject,
  type CharacterDimensionWarning,
} from '../../src/domain';
import type { ThumbnailState } from '../../src/renderer/features/assets/AssetCard';
import { CharacterEditor } from '../../src/renderer/features/characters/CharacterEditor';
import { expressionRenameValue } from '../../src/renderer/features/characters/ExpressionEditor';

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
  const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';
  const thumbnails: Record<string, ThumbnailState> = Object.fromEntries(
    imageAssets.map((asset) => [asset.id, { status: 'ready', dataUrl }]),
  );
  return { character, imageAssets, project, thumbnails };
}

function expressionMarkup(
  warnings: readonly CharacterDimensionWarning[] = [],
): string {
  const { character, imageAssets, thumbnails } = fixture();
  return renderToStaticMarkup(
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
      onBackToDetail: noop,
      onCloseDrawer: noop,
      onOpenExpressions: noop,
      presentation: 'landscape',
      view: 'expression',
    }),
  );
}

describe('Issue #366 Cloud Touch landscape Expression Management', () => {
  it('renders visual cards, a top add action, and no permanently open form', () => {
    const { character } = fixture();
    const markup = expressionMarkup();

    expect(markup).toContain('← 返回角色详情');
    expect(markup).toContain(`${character.name} · 表情管理`);
    expect(markup).toContain('表情管理');
    expect(markup).toContain('＋ 添加表情');
    expect(markup).toContain('data-expression-editor-presentation="landscape"');
    expect(markup.match(/data-expression-editing="false"/gu)).toHaveLength(
      character.expressions.length,
    );
    expect(markup).toContain('Panda neutral · 640×640');
    expect(markup).toContain('默认 ✓');
    expect(markup).not.toContain('expression-add-form-landscape');
    expect(markup).not.toContain('<select');
    expect(markup).not.toContain('删除角色');
  });

  it('associates dimension warnings with the affected card and keeps the anchor copy', () => {
    const { character, project } = fixture();
    const affected = character.expressions[1]!;
    const warnedProject = ProjectSchema.parse({
      ...project,
      assets: project.assets.map((asset) =>
        asset.id === affected.assetId && asset.kind === 'image'
          ? { ...asset, width: 1_000, height: 320 }
          : asset,
      ),
    });
    const warnings = new CharacterService().dimensionWarnings(
      warnedProject,
      character.id,
    );
    const markup = expressionMarkup(warnings);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.expressionId).toBe(affected.id);
    expect(markup).toContain('尺寸差异警告');
    expect(markup).not.toContain('character-size-warning');
    expect(source('src/renderer/features/characters/ExpressionEditor.tsx')).toContain(
      'data-warning-expression-id={warning.expressionId}',
    );
    expect(source('src/renderer/features/characters/ExpressionEditor.tsx')).toContain(
      '切换表情时保持角色中心位置不变。',
    );
  });

  it('keeps expression names and metadata visible when the existing thumbnail state is missing', () => {
    const { character, imageAssets } = fixture();
    const thumbnails: Record<string, ThumbnailState> = Object.fromEntries(
      imageAssets.map((asset) => [
        asset.id,
        { status: 'missing' as const, reason: 'source' as const },
      ]),
    );
    const markup = renderToStaticMarkup(
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
        presentation: 'landscape',
        view: 'expression',
      }),
    );

    expect(markup).toContain('class="expression-thumbnail-fallback"');
    expect(markup).toContain('源文件缺失');
    expect(markup).not.toContain('<img');
    for (const expression of character.expressions) {
      expect(markup).toContain(`<strong>${expression.name}</strong>`);
    }
    expect(source('src/renderer/features/characters/ExpressionEditor.tsx')).toContain(
      "thumbnail?.status === 'missing' ? thumbnail.reason : undefined",
    );
  });

  it('uses explicit rename apply/cancel semantics and never commits on blur in the landscape editor', () => {
    expect(expressionRenameValue(' Happy ', 'Happy')).toBeNull();
    expect(expressionRenameValue(' Happy ', 'Neutral')).toBe('Happy');
    expect(expressionRenameValue('   ', 'Neutral')).toBeNull();

    const editor = source(
      'src/renderer/features/characters/ExpressionEditor.tsx',
    );
    const landscapeEditor = editor.slice(
      editor.indexOf('function LandscapeExpressionEditor'),
    );
    expect(landscapeEditor).toContain('editingExpressionId');
    expect(landscapeEditor).toContain('setEditingExpressionId(expression.id)');
    expect(landscapeEditor).toContain('onRename(expression.id, nextName)');
    expect(landscapeEditor).toContain('expression-cancel-${expression.id}');
    expect(landscapeEditor).toContain('expression-apply-${expression.id}');
    expect(landscapeEditor).not.toContain('onBlur');
  });

  it('keeps only one editing card, reveals the existing asset select on demand, and protects default deletion', () => {
    const { character } = fixture();
    const markup = expressionMarkup();
    const defaultExpression = character.expressions.find(
      (expression) => expression.id === character.defaultExpressionId,
    )!;
    const otherExpression = character.expressions.find(
      (expression) => expression.id !== character.defaultExpressionId,
    )!;

    expect(markup).toContain(
      `data-testid="expression-delete-${defaultExpression.id}"`,
    );
    expect(markup).toContain('请先选择替代表情，再删除默认表情。');
    expect(markup).toContain(
      `data-testid="expression-delete-${otherExpression.id}"`,
    );
    expect(markup).toContain('设为默认');

    const editor = source(
      'src/renderer/features/characters/ExpressionEditor.tsx',
    );
    expect(editor).toContain('expression-asset-picker-${expression.id}');
    expect(editor).toContain('更换素材会立即应用；名称修改请点击应用。');
    expect(editor).toContain('setEditingExpressionId(expression.id)');
    expect(editor).toContain('setEditingName(expression.name)');
    expect(editor).toContain('onSetAsset(expression.id, event.target.value)');
    expect(editor).toContain('cardWarnings.map');
  });

  it('keeps the existing default/portrait ExpressionEditor path and scopes the new header to landscape', () => {
    const { character, imageAssets, thumbnails } = fixture();
    const legacyMarkup = renderToStaticMarkup(
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
        presentation: 'default',
        view: 'full',
      }),
    );

    expect(legacyMarkup).toContain('class="expression-add-form"');
    expect(legacyMarkup).toContain('图片素材');
    expect(legacyMarkup).not.toContain('expression-editor-landscape');

    const editor = source(
      'src/renderer/features/characters/CharacterEditor.tsx',
    );
    const dock = source('src/renderer/shell/ResourceActivityDock.tsx');
    expect(editor).toContain('landscapeExpression');
    expect(editor).toContain('landscapeExpression ? onBackToDetail : onBackToList');
    expect(dock).toContain(
      "(characterView === 'detail' || characterView === 'expression')",
    );
  });
});
