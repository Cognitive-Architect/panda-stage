import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import { migrateProject } from '../../src/domain';
import { CharacterList } from '../../src/renderer/features/characters/CharacterList';

const noop = () => undefined;

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

describe('Issue #474 landscape Character empty state', () => {
  it('renders a compact, non-interactive two-expression cue', () => {
    const project = migrateProject(exampleProject);
    const imageAssets = project.assets.filter(
      (asset) => asset.kind === 'image',
    );
    const markup = renderToStaticMarkup(
      createElement(CharacterList, {
        characters: [],
        imageAssets,
        mode: 'list',
        onCreate: noop,
        onSelect: noop,
        presentation: 'landscape',
        selectedCharacterId: null,
      }),
    );

    expect(markup).toContain('data-testid="character-empty-state"');
    expect(markup).toContain('还没有角色');
    expect(markup).toContain('先准备 2 张角色图片，就能创建角色了。');
    expect(markup).toContain('class="character-empty-state-anchor"');
    expect(markup).toContain('例如这样的两张图片');
    expect(markup).toContain('alt="普通表情示意图"');
    expect(markup).toContain('alt="生气表情示意图"');
    expect(markup).toContain('<figcaption>普通</figcaption>');
    expect(markup).toContain('<figcaption>生气</figcaption>');
    const imageSources = Array.from(
      markup.matchAll(/<img[^>]+src="([^"]+)"/gu),
      (match) => match[1] ?? '',
    );
    expect(imageSources).toHaveLength(4);
    expect(imageSources.every(Boolean)).toBe(true);
    expect(imageSources).not.toContain('/character-empty-normal.png');
    expect(imageSources).not.toContain('/character-empty-angry.png');
    expect(markup).not.toMatch(
      /character-empty-state[\s\S]*?<button/gu,
    );
  });

  it('keeps the approved list header/action seam and scopes visual treatment', () => {
    const dock = source('src/renderer/shell/ResourceActivityDock.tsx');
    const list = source(
      'src/renderer/features/characters/CharacterList.tsx',
    );
    const styles = source('src/renderer/styles.css');

    expect(dock).toContain('character-list-landscape');
    expect(list).toContain("presentation === 'landscape' && mode === 'list'");
    expect(list).toContain(
      "import characterEmptyNormal from './assets/character-empty-normal.png';",
    );
    expect(list).toContain(
      "import characterEmptyAngry from './assets/character-empty-angry.png';",
    );
    expect(list).not.toContain('src="/character-empty-normal.png"');
    expect(list).not.toContain('src="/character-empty-angry.png"');
    expect(list).toContain('normalAssetId !== angryAssetId');
    expect(list).toContain('onCreate({');
    expect(styles).toContain(
      "data-resource-header-layout='character-list-landscape'",
    );
    expect(styles).toContain('.character-empty-state-anchor');
    expect(styles).toContain('.character-empty-state-bridge');
    expect(styles).toContain('.character-empty-state-examples');
    expect(styles).toContain('.character-empty-state-example img');
    expect(styles).toContain('max-width: 360px');
    expect(styles).toContain('width: 116px');
    expect(styles).toContain('object-fit: contain');
    expect(styles).not.toContain('character-empty-state button');
  });
});
