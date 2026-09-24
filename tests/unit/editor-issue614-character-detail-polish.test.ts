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
import { readOrderedStylesheetSource } from '../helpers/read-stylesheet-source';

const noop = () => undefined;

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

function fixture({
  composite = false,
  withMouth = false,
}: { composite?: boolean; withMouth?: boolean } = {}): {
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
            ...(withMouth
              ? { mouthOpenAssetId: imageAssets.at(-1)!.id }
              : { mouthOpenAssetId: undefined }),
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
  withMouth = false,
  withAssemblyDraft = false,
  view = 'detail',
}: {
  composite?: boolean;
  withMouth?: boolean;
  withAssemblyDraft?: boolean;
  view?: 'detail' | 'expression';
} = {}): string {
  const { character, imageAssets, thumbnails } = fixture({ composite, withMouth });
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
      assemblyDraft:
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
          : null,
      onSetAssemblyBodyAsset: noop,
      onSetAssemblyMouthAsset: noop,
      onOpenAssembly: () => true,
      onLeaveAssembly: () => true,
      onSetDefaultTransform: noop,
      onThumbnailError: noop,
      presentation: 'landscape',
      view,
    }),
  );
}

describe('Issue #614 Character Detail polish', () => {
  it('balances the workspace switcher to its two or three destinations', () => {
    const singleImageMarkup = detailMarkup();
    const compositeMarkup = detailMarkup({ composite: true });
    const styles = readOrderedStylesheetSource();

    expect(singleImageMarkup).toContain('data-workspace-count="2"');
    expect(compositeMarkup).toContain('data-workspace-count="3"');
    expect(
      compositeMarkup.match(
        /data-testid="character-workspace-(?:assembly|expressions|settings)-tab"/gu,
      ),
    ).toHaveLength(3);
    expect(styles).toContain(
      ".character-workspace-switcher[data-workspace-count='3']",
    );
    expect(styles).toContain('grid-template-columns: repeat(3, minmax(0, 1fr));');
  });

  it('uses the asset-picker row grammar and keeps Mouth clear in a secondary menu', () => {
    const markup = detailMarkup({ composite: true, withMouth: true });
    const styles = readOrderedStylesheetSource();

    expect(markup).toContain('data-image-asset-picker="身体"');
    expect(markup).toContain('data-testid="character-assembly-default-face-summary"');
    expect(markup).toContain('class="image-asset-picker-selected-copy"');
    expect(markup).toContain('class="image-asset-picker-selected-action">管理</span>');
    expect(markup).toContain('data-image-asset-picker="张嘴脸"');
    expect(markup).toContain('<details class="character-assembly-mouth-overflow">');
    expect(markup).toContain('aria-label="张嘴脸更多操作"');
    expect(markup).toMatch(
      /<details class="character-assembly-mouth-overflow">[\s\S]*?<button[^>]*class="character-mouth-clear"[^>]*>清除<\/button>[\s\S]*?<\/details>/u,
    );
    expect(styles).toContain('.character-assembly-mouth-overflow-menu');
    expect(styles).toContain('min-height: var(--ui-touch-icon);');
    const characterEditor = source(
      'src/renderer/features/characters/CharacterEditor.tsx',
    );
    expect(characterEditor).toContain('!onLeaveAssembly()');
    expect(characterEditor).toContain("switchDetailWorkspace('expressions')");
  });

  it('removes only the redundant embedded Expression heading and uses 表情1 for new composite drafts', () => {
    const detail = detailMarkup({ composite: true });
    const standaloneExpression = detailMarkup({ view: 'expression' });
    const characterList = source(
      'src/renderer/features/characters/CharacterList.tsx',
    );

    expect(detail).toContain(
      '<h4 class="sr-only" id="character-expression-workspace-heading">表情</h4>',
    );
    expect(detail).not.toContain('＋ 添加</button>');
    expect(detail).toContain('＋ 添加表情</button>');
    expect(detail).not.toContain('class="expression-editor-landscape-heading"');
    expect(standaloneExpression).toContain(
      '<h4 id="character-expression-workspace-heading">表情</h4>',
    );
    expect(standaloneExpression).toContain('＋ 添加表情</button>');
    expect(readOrderedStylesheetSource()).toContain(
      '.character-expression-workspace .expression-add-trigger {\n  min-width: 88px;',
    );
    expect(characterList.match(/name: '表情1'/gu)).toHaveLength(2);
    expect(characterList).not.toContain("name: '默认表情'");

    const migrated = migrateProject(exampleProject);
    const expressionNames = migrated.characters.map((character) =>
      character.expressions.map((expression) => expression.name),
    );
    expect(
      migrateProject(migrated).characters.map((character) =>
        character.expressions.map((expression) => expression.name),
      ),
    ).toEqual(expressionNames);
  });

  it('labels the scale as whole-character initial size and gives the stepper breathing room', () => {
    const markup = detailMarkup({ composite: true });
    const settings = markup.slice(markup.indexOf('data-workspace="settings"'));
    const styles = readOrderedStylesheetSource();

    expect(settings).toContain('初始角色大小');
    expect(settings).toContain('水平翻转');
    expect(settings).not.toContain('放入镜头时');
    expect(settings).not.toContain('只影响之后新放入镜头的角色');
    expect(styles).toContain(
      'grid-template-columns: 40px minmax(52px, 1fr) 40px;',
    );
    expect(styles).toContain('column-gap: 10px;');
  });
});

describe('Issue #616 Character Detail assembly visual hierarchy', () => {
  it('keeps navigation and identity light while preserving their actions and touch targets', () => {
    const markup = detailMarkup({ composite: true, withAssemblyDraft: true });
    const styles = readOrderedStylesheetSource();

    expect(markup).toContain('← 角色列表');
    expect(markup).toContain('aria-label="关闭角色抽屉"');
    expect(markup).toContain('aria-label="编辑角色名称"');
    expect(markup).not.toContain('character-identity-overflow');
    expect(markup).toContain('data-testid="character-delete-settings"');
    expect(markup).toContain('data-testid="character-workspace-switcher"');
    expect(markup).toContain(
      'aria-controls="character-workspace-assembly" aria-pressed="true"',
    );
    expect(styles).toContain('grid-template-columns: 56px minmax(0, 1fr);');
    expect(styles).toContain('width: 44px;\n  min-width: 44px;\n  min-height: 44px;');
    expect(styles).toContain(".character-workspace-switcher[data-workspace-count='3']");
    expect(styles).toContain('min-height: 40px;');
  });

  it('leaves one asset surface per group and removes redundant Mouth empty-state copy', () => {
    const markup = detailMarkup({ composite: true });
    const mouthStart = markup.indexOf('<section aria-label="张嘴脸"');
    const mouthEnd = markup.indexOf('</section>', mouthStart);
    const mouthPicker = markup.slice(mouthStart, mouthEnd + '</section>'.length);
    const styles = readOrderedStylesheetSource();
    const rowRule = styles.match(
      /\.character-assembly-drawer-panel \.image-asset-picker-selected-row\s*\{([^}]*)\}/u,
    )?.[1] ?? '';

    expect(mouthPicker).toContain('暂不配置');
    expect(mouthPicker).toContain('>选择</span>');
    expect(mouthPicker).not.toContain('可选');
    expect(mouthPicker).not.toContain('可以稍后再配置。');
    expect(rowRule).toContain('grid-template-columns: minmax(0, 1fr) max-content;');
    expect(rowRule).not.toMatch(/\b(?:border|background)\s*:/u);
    expect(styles).toContain('grid-template-columns: 68px minmax(0, 1fr) auto;');
    expect(styles).toContain('gap: 18px;');
  });

  it('keeps the configured Mouth overflow clear action and assembly navigation guard', () => {
    const markup = detailMarkup({ composite: true, withMouth: true });
    const editor = source('src/renderer/features/characters/CharacterEditor.tsx');

    expect(markup).toContain('<details class="character-assembly-mouth-overflow">');
    expect(markup).toContain('aria-label="张嘴脸更多操作"');
    expect(markup).toContain('data-testid="character-assembly-mouth-clear"');
    expect(markup).toContain('>清除</button>');
    expect(editor).toMatch(
      /nextWorkspace !== 'assembly'[\s\S]*?!onLeaveAssembly\(\)/u,
    );
    expect(editor).toContain("switchDetailWorkspace('assembly')");
  });
});
