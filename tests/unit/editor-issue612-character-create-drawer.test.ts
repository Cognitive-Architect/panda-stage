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

describe('Issue #613 compact landscape Create Character polish', () => {
  it('uses concise single-image labels and one compact Return/Create row', () => {
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
    expect(markup).toContain('data-testid="character-create-back"');
    expect(markup).toContain('aria-label="返回角色列表"');
    expect(markup).toContain('class="character-create-actions"');
    expect(markup).toContain('data-ui-variant="secondary"');
    expect(markup).toContain('data-ui-variant="primary"');
    expect(markup).toContain('class="character-create-name-row"');
    expect(markup).toContain('<span>角色名称</span>');
    expect(markup).toContain('<span>整图</span>');
    expect(markup).toContain('<span>身体+脸</span>');
    expect(markup).toContain('data-image-asset-picker="普通表情"');
    expect(markup).toContain('data-image-asset-picker="生气表情"');
    expect(markup).toContain('data-image-asset-picker="张嘴图"');
    expect(markup).not.toContain('>可选</small>');
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
          projectRoot: 'D:\\PandaStage-Acceptance\\issue-613.pandastage',
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
    const resourceDock = source(
      'src/renderer/shell/ResourceActivityDock.tsx',
    );
    const picker = source(
      'src/renderer/features/characters/ImageAssetPicker.tsx',
    );
    const workbenchStyles = source(
      'src/renderer/styles/features/characters/assembly/s17-01--character-assembly-workbench.css',
    );

    expect(characterList).toContain("compactLandscapeCreate ? '身体' : '身体图片'");
    expect(characterList).toContain("compactLandscapeCreate ? '默认脸' : '默认表情图片'");
    expect(characterList).toContain("compactLandscapeCreate ? '张嘴图' : '张嘴图（可选）'");
    expect(characterList).toContain("compactLandscapeCreate ? '普通表情' : '普通表情图片'");
    expect(characterList).toContain("compactLandscapeCreate ? '生气表情' : '生气表情图片'");
    expect(characterList).toContain('createPortal(modeSwitch, modeSwitchTarget)');
    expect(resourceDock).toContain('character-create-mode-switch-slot');
    expect(resourceDock).toContain('modeSwitchTarget={');
    expect(resourceDock).not.toContain('resource-activity-create-back');
    expect(picker).toContain('emptyOption.description ?');
    expect(workbenchStyles).toContain("data-create-layout='compressed-v2'");
    expect(workbenchStyles).toContain('.character-create-mode-switch-slot');
    expect(workbenchStyles).toContain('.character-create-actions');
    expect(workbenchStyles).toContain('.image-asset-picker-heading');
    expect(workbenchStyles).toContain('font-weight: 600;');
    expect(workbenchStyles).toContain("input[type='radio']");
    expect(workbenchStyles).toContain('clip-path: inset(50%);');
    expect(workbenchStyles).toContain('label:has(input:focus-visible)');
    expect(workbenchStyles).toContain('min-height: var(--ui-touch-icon);');
    expect(workbenchStyles).toContain('.character-create-submit-compact');
    expect(workbenchStyles).toContain('min-width: var(--ui-touch-icon);');
    expect(workbenchStyles).toContain('.resource-activity-create-close');
  });
});
