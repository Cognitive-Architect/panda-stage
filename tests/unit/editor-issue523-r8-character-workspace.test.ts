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
const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';

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
    characters: project.characters.map((candidate) =>
      candidate.id === project.characters[0]?.id && withMouth
        ? { ...candidate, mouthOpenAssetId: imageAssets[0]?.id }
        : candidate,
    ),
  }).characters[0]!;
  const thumbnails = Object.fromEntries(
    imageAssets.map((asset) => [
      asset.id,
      { status: 'ready' as const, dataUrl },
    ]),
  );
  return { character, imageAssets, thumbnails };
}

function editorMarkup(withMouth = false): string {
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

describe('Issue #523 R8 unified Character workspace', () => {
  it('keeps identity permanent and exposes exactly two local workspaces', () => {
    const { character } = fixture();
    const markup = editorMarkup();

    expect(markup).toContain('角色详情');
    expect(markup).toContain(`<h3>${character.name}</h3>`);
    expect(markup).toContain('character-identity-overflow');
    expect(markup).toContain('character-delete-overflow');
    expect(markup.match(/data-workspace="(?:expressions|settings)"/gu)).toHaveLength(2);
    expect(markup).toContain('data-testid="character-workspace-expressions-tab"');
    expect(markup).toContain('data-testid="character-workspace-settings-tab"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('aria-pressed="false"');
    expect(markup).not.toContain('管理全部表情');
    expect(markup).not.toContain('character-danger-zone');
  });

  it('keeps expression recognition and management in the expression workspace', () => {
    const { character } = fixture();
    const markup = editorMarkup();
    const editor = source(
      'src/renderer/features/characters/CharacterEditor.tsx',
    );

    expect(markup).toContain('expression-editor-landscape');
    expect(markup).toContain('expression-card-list');
    expect(markup).toContain('expression-add-trigger');
    expect(markup).toContain('添加表情');
    expect(markup.match(/data-expression-editing="false"/gu)).toHaveLength(
      character.expressions.length,
    );
    expect(markup).toContain('默认 ✓');
    expect(markup).toContain('expression-edit-');
    expect(markup).toContain('expression-delete-');
    expect(editor).toContain('data-workspace="expressions"');
    expect(editor).toContain('setActiveWorkspace(\'expressions\')');
    expect(editor).toContain('hidden={activeWorkspace !== \'expressions\'}');
  });

  it('shows compact settings, conditional transform actions, and mouth states', () => {
    const cleanMarkup = editorMarkup();
    const configured = fixture(true);
    const configuredMarkup = renderToStaticMarkup(
      createElement(CharacterEditor, {
        character: configured.character,
        imageAssets: configured.imageAssets,
        thumbnails: configured.thumbnails,
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
        view: 'detail',
      }),
    );

    expect(cleanMarkup).toContain('默认大小与方向');
    expect(cleanMarkup).toContain('data-default-transform-pending="false"');
    expect(cleanMarkup).not.toContain('character-default-pending');
    expect(cleanMarkup).not.toContain('class="character-default-apply"');
    expect(cleanMarkup).toContain('未设置');
    expect(cleanMarkup).toContain('选择图片');
    expect(cleanMarkup).not.toContain('class="character-mouth-clear"');

    expect(configuredMarkup).toContain(configured.imageAssets[0]!.name);
    expect(configuredMarkup).toContain(
      `${configured.imageAssets[0]!.width}×${configured.imageAssets[0]!.height}`,
    );
    expect(configuredMarkup).toContain('更换');
    expect(configuredMarkup).toContain('class="character-mouth-clear"');
    expect(configuredMarkup).toContain('清除');
  });

  it('retains the existing mutation owners and staged transform seam', () => {
    const editor = source(
      'src/renderer/features/characters/CharacterEditor.tsx',
    );
    const manager = source(
      'src/renderer/features/characters/CharacterManager.tsx',
    );

    expect(editor).toContain('isDefaultTransformPending');
    expect(editor).toContain('onSetDefaultTransform(scale, flipX)');
    expect(editor).toContain('onSetMouthOpenAsset(null)');
    expect(manager).toContain('characterStore.renameExpression');
    expect(manager).toContain('characterStore.setExpressionAsset');
    expect(manager).toContain('characterStore.setDefaultTransform');
    expect(manager).toContain('characterStore.setMouthOpenAsset');
    expect(manager).toContain('characterStore.deleteCharacter');
  });

  it('adds Assembly for composite Characters while keeping Expressions as the default workspace', () => {
    const project = migrateProject(exampleProject);
    const base = project.characters[0]!;
    const body = project.assets.find(
      (asset) => asset.kind === 'image',
    )!;
    const character = ProjectSchema.parse({
      ...project,
      characters: [
        {
          ...base,
          mode: 'composite' as const,
          bodyAssetId: body.id,
          facePlacement: { offsetX: 12, offsetY: -6, scale: 1 },
          mouthOpenAssetId: project.assets.find(
            (asset) => asset.kind === 'image' && asset.id !== body.id,
          )!.id,
        },
      ],
    }).characters[0]!;
    const imageAssets = project.assets.filter(
      (asset): asset is ImageAsset => asset.kind === 'image',
    );
    const thumbnails = Object.fromEntries(
      imageAssets.map((asset) => [asset.id, { status: 'loading' as const }]),
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
        onOpenAssembly: () => true,
        onLeaveAssembly: () => true,
        onSetAssemblyBodyAsset: noop,
        onSetAssemblyMouthAsset: noop,
        presentation: 'landscape',
        view: 'detail',
      }),
    );

    expect(markup).toContain('data-testid="character-workspace-assembly-tab"');
    expect(markup.match(/data-workspace="(?:assembly|expressions|settings)"/gu)).toHaveLength(3);
    expect(markup).toMatch(
      /data-workspace="expressions"[^>]*id="character-workspace-expressions"/u,
    );
    expect(markup).toContain('data-testid="character-assembly-body-picker"');
    expect(markup).toContain('data-testid="character-assembly-mouth-picker"');
    expect(markup).not.toContain('character-detail-mouth-visual-picker');
    expect(markup).toContain('aria-pressed="true"');
  });
});
