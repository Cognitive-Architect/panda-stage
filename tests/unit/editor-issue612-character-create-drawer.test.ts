import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import { migrateProject } from '../../src/domain';
import { CharacterList } from '../../src/renderer/features/characters/CharacterList';
import { CharacterManager } from '../../src/renderer/features/characters/CharacterManager';
import { ImageAssetPicker } from '../../src/renderer/features/characters/ImageAssetPicker';

const noop = () => undefined;

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

describe('Issue #612 compact landscape Create Character drawer', () => {
  it('uses one compact top-level route and a single-row name field in landscape create', () => {
    const project = migrateProject(exampleProject);
    const imageAssets = project.assets.filter((asset) => asset.kind === 'image');
    const markup = renderToStaticMarkup(
      createElement(CharacterList, {
        characters: [],
        imageAssets,
        mode: 'create',
        onBack: noop,
        onCreate: noop,
        onSelect: noop,
        presentation: 'landscape',
        selectedCharacterId: null,
        showHeading: false,
      }),
    );

    expect(markup).toContain('aria-label="创建角色"');
    expect(markup).toContain('data-create-layout="compressed-v2"');
    expect(markup).not.toContain('character-list-heading');
    expect(markup).not.toContain('character-create-back');
    expect(markup).toContain('class="character-create-name-row"');
    expect(markup).toContain('<span>角色名称</span>');
    expect(markup).toContain('<span>整图</span>');
    expect(markup).toContain('<span>身体+脸</span>');
  });

  it('does not add description or optional copy to a composite empty Mouth value', () => {
    const markup = renderToStaticMarkup(
      createElement(ImageAssetPicker, {
        assets: [],
        emptyOption: { label: '暂不配置' },
        label: '张嘴图',
        onChange: noop,
        onThumbnailError: noop,
        selectedAssetId: null,
        testId: 'character-create-mouth-picker',
        thumbnails: {},
      }),
    );

    expect(markup).toContain('data-image-asset-picker="张嘴图"');
    expect(markup).toContain('aria-label="张嘴图：暂不配置"');
    expect(markup).toContain('class="image-asset-picker-selected-action">选择</span>');
    expect(markup).toContain('<strong>暂不配置</strong>');
    expect(markup).not.toContain('可选');
    expect(markup).not.toContain('可以稍后再配置');
    expect(markup).not.toContain('<small></small>');
  });

  it('keeps the compact Create region accessibly named when duplicate headings are suppressed', () => {
    const project = migrateProject(exampleProject);
    const markup = renderToStaticMarkup(
      createElement(CharacterManager, {
        hideHeading: true,
        presentation: 'landscape',
        snapshot: {
          projectRoot: 'D:\\PandaStage-Acceptance\\issue-612.pandastage',
          project,
          dirty: false,
          revision: 0,
        },
        view: 'create',
      }),
    );

    expect(markup).toContain('aria-label="创建角色"');
    expect(markup).not.toContain('aria-labelledby="character-manager-heading"');
    expect(markup).not.toContain('id="character-manager-heading"');
  });

  it('keeps the short landscape hierarchy, touch targets, and native radio semantics local to this surface', () => {
    const characterList = source(
      'src/renderer/features/characters/CharacterList.tsx',
    );
    const picker = source(
      'src/renderer/features/characters/ImageAssetPicker.tsx',
    );
    const workbenchStyles = source(
      'src/renderer/styles/features/characters/assembly/s17-01--character-assembly-workbench.css',
    );

    expect(characterList).toContain("compactLandscapeCreate ? '身体' : '身体图片'");
    expect(characterList).toContain("compactLandscapeCreate ? '默认脸' : '默认表情图片'");
    expect(characterList).toContain("compactLandscapeComposite ? '张嘴图' : '张嘴图（可选）'");
    expect(picker).toContain('emptyOption.description ?');
    expect(workbenchStyles).toContain("data-create-layout='compressed-v2'");
    expect(workbenchStyles).toContain("input[type='radio']");
    expect(workbenchStyles).toContain('clip-path: inset(50%);');
    expect(workbenchStyles).toContain('label:has(input:focus-visible)');
    expect(workbenchStyles).toContain('min-height: var(--ui-touch-icon);');
    expect(workbenchStyles).toContain('.character-create-submit-compact');
    expect(workbenchStyles).toContain('.resource-activity-create-back');
    expect(workbenchStyles).toContain('min-width: var(--ui-touch-icon);');
    expect(workbenchStyles).toContain('.resource-activity-create-close');
  });
});
