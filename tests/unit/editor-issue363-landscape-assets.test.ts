import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import { migrateProject } from '../../src/domain';
import { AssetCard } from '../../src/renderer/features/assets/AssetCard';
import { AssetLibrary } from '../../src/renderer/features/assets/AssetLibrary';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

const noop = () => undefined;

describe('Issue #363 landscape Asset Library presentation', () => {
  it('marks the landscape library and keeps FLA out of the duplicated import panel', () => {
    const project = migrateProject(exampleProject);
    const markup = renderToStaticMarkup(
      createElement(AssetLibrary, {
        hideHeading: true,
        presentation: 'landscape',
        showFlaAction: false,
        snapshot: {
          projectRoot: 'D:\\project.pandastage',
          project,
          dirty: false,
          revision: 0,
        },
      }),
    );

    expect(markup).toContain('data-asset-library-presentation="landscape"');
    expect(markup).toContain('asset-library-presentation-landscape');
    expect(markup).toContain('asset-library-search-control');
    expect(markup).toContain('asset-category-tabs');
    expect(markup).not.toContain('data-testid="asset-import-fla"');
  });

  it('keeps media kind and existing asset interaction hooks on cards', () => {
    const project = migrateProject(exampleProject);
    const audio = project.assets.find((asset) => asset.kind === 'audio')!;
    const markup = renderToStaticMarkup(
      createElement(AssetCard, {
        asset: audio,
        category: 'audio',
        contextLabel: '音频',
        dragging: false,
        dropPayload: {
          version: 2 as const,
          type: 'audio' as const,
          assetId: audio.id,
        },
        onDragEnd: noop,
        onDragStart: noop,
        onRebuildThumbnail: noop,
        onSelect: noop,
        onThumbnailError: noop,
        selected: true,
        thumbnail: { status: 'loading' },
      }),
    );

    expect(markup).toContain(`data-asset-kind="${audio.kind}"`);
    expect(markup).toContain('data-media-kind="audio"');
    expect(markup).toContain('asset-card-audio-placeholder');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('draggable="true"');
  });

  it('scopes the visual polish to landscape without changing the existing owners', () => {
    const dock = source('src/renderer/shell/ResourceActivityDock.tsx');
    const library = source('src/renderer/features/assets/AssetLibrary.tsx');
    const styles = source('src/renderer/styles.css');

    expect(dock).toContain('showLandscapeAssetActionGroup');
    expect(dock).toContain("data-resource-action-group=");
    expect(dock).toContain('setAssetFlaReviewRequest');
    expect(dock).toContain('importRequestToken={assetImportRequest}');
    expect(dock).toContain('showFlaAction=');
    expect(library).toContain('filterAssetLibraryEntries(entries, searchQuery)');
    expect(library).toContain('paginateAssetLibraryEntries(visibleEntries, currentPage)');
    expect(styles).toContain("data-asset-library-presentation='landscape'");
    expect(styles).toContain('background: #0b120e;');
    expect(styles).toContain('.asset-card-audio-placeholder::before');
    expect(styles).toContain('.asset-card-selected::after');
    expect(styles).toContain('.asset-library-pagination');
  });
});
