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
    expect(markup).toContain('src="/character-empty-normal.png"');
    expect(markup).toContain('src="/character-empty-angry.png"');
    expect(markup).toContain('alt="普通表情示意图"');
    expect(markup).toContain('alt="生气表情示意图"');
    expect(markup).toContain('<figcaption>普通</figcaption>');
    expect(markup).toContain('<figcaption>生气</figcaption>');
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
    expect(list).toContain('normalAssetId !== angryAssetId');
    expect(list).toContain('onCreate({');
    expect(styles).toContain(
      "data-resource-header-layout='character-list-landscape'",
    );
    expect(styles).toContain('.character-empty-state-examples');
    expect(styles).toContain('.character-empty-state-example img');
    expect(styles).not.toContain('character-empty-state button');
  });
});
