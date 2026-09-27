import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import { migrateProject, type ImageAsset } from '../../src/domain';
import {
  IMAGE_ASSET_PAGE_SIZE,
  ImageAssetPicker,
  paginateImageAssetCandidates,
} from '../../src/renderer/features/characters/ImageAssetPicker';
import { readOrderedStylesheetSource } from '../helpers/read-stylesheet-source';

const sample = migrateProject(exampleProject).assets.find(
  (asset): asset is ImageAsset => asset.kind === 'image',
)!;

function assets(count: number): ImageAsset[] {
  return Array.from({ length: count }, (_, index) => ({
    ...sample,
    id: `asset-${index + 1}`,
    name: `Image ${index + 1}`,
  }));
}

describe('Issue #637 Expression image search and pagination', () => {
  it('filters names case-insensitively before dividing into 12-item pages', () => {
    const library = assets(105);
    const first = paginateImageAssetCandidates(library, '', 1);
    const middle = paginateImageAssetCandidates(library, '', 5);
    const last = paginateImageAssetCandidates(library, '', 9);
    const beyondLast = paginateImageAssetCandidates(library, '', 100);

    expect(IMAGE_ASSET_PAGE_SIZE).toBe(12);
    expect(first).toMatchObject({ matchCount: 105, page: 1, pageCount: 9 });
    expect(first.assets).toHaveLength(12);
    expect(first.assets[0]?.name).toBe('Image 1');
    expect(middle.assets).toHaveLength(12);
    expect(middle.assets[0]?.name).toBe('Image 49');
    expect(last.assets).toHaveLength(9);
    expect(last.assets.at(-1)?.name).toBe('Image 105');
    expect(beyondLast.page).toBe(9);

    const searched = paginateImageAssetCandidates(library, '  iMaGe 10 ', 1);
    expect(searched.matchCount).toBe(7);
    expect(searched.assets.map((asset) => asset.name)).toEqual([
      'Image 10', 'Image 100', 'Image 101', 'Image 102',
      'Image 103', 'Image 104', 'Image 105',
    ]);
  });

  it('handles zero results and the first/last boundaries without empty phantom pages', () => {
    const library = assets(13);
    expect(paginateImageAssetCandidates(library, '', 0).page).toBe(1);
    expect(paginateImageAssetCandidates(library, '', 1).assets).toHaveLength(12);
    expect(paginateImageAssetCandidates(library, '', 2)).toMatchObject({
      matchCount: 13, page: 2, pageCount: 2,
    });
    expect(paginateImageAssetCandidates(library, '', 2).assets).toHaveLength(1);
    expect(paginateImageAssetCandidates(library.slice(0, 12), '', 1).pageCount).toBe(1);
    expect(paginateImageAssetCandidates(library, 'not found', 2)).toMatchObject({
      assets: [], matchCount: 0, page: 1, pageCount: 1,
    });
  });

  it('keeps selected-image semantics and other picker hosts on their default mode', () => {
    const library = assets(13);
    const selectedAsset = library[12]!;
    const markup = renderToStaticMarkup(createElement(ImageAssetPicker, {
      assets: library,
      label: '张嘴图',
      onChange: () => undefined,
      onThumbnailError: () => undefined,
      selectedAssetId: selectedAsset.id,
      thumbnails: {},
    }));
    const pickerSource = readFileSync(
      'src/renderer/features/characters/ImageAssetPicker.tsx', 'utf8',
    );
    const expressionSource = readFileSync(
      'src/renderer/features/characters/ExpressionEditor.tsx', 'utf8',
    );
    const styles = readOrderedStylesheetSource();

    expect(markup).toContain('data-selected-asset-id="asset-13"');
    expect(markup).toContain('Image 13');
    expect(pickerSource).toContain('searchAndPaginate = false');
    expect(pickerSource).toContain('setSearchQuery(event.currentTarget.value);');
    expect(pickerSource).toContain('setPage(1);');
    expect(pickerSource).toContain('onChange(assetId);');
    expect(pickerSource).toContain('setOpen(false);');
    expect(expressionSource.match(/searchAndPaginate/gu)).toHaveLength(2);
    expect(styles).toContain('.character-expression-workspace');
    expect(styles).toContain('grid-template-columns: repeat(3, minmax(0, 1fr));');
    expect(styles).toContain('.expression-editor .expression-fields .image-asset-picker-candidates');
    expect(styles).toContain('.image-asset-picker-search');
    expect(styles).toContain('.image-asset-picker-pagination');
  });
});
