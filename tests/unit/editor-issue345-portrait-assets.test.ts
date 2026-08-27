import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import { migrateProject } from '../../src/domain';
import { AssetCard } from '../../src/renderer/features/assets/AssetCard';
import {
  assetLibraryPageCount,
  paginateAssetLibraryEntries,
} from '../../src/renderer/features/assets/assetLibraryPagination';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

function directPayload(assetId: string) {
  return {
    version: 2 as const,
    type: 'asset-image' as const,
    assetId,
  };
}

describe('Issue #345 portrait Assets interaction and pagination', () => {
  it('paginates 22 filtered entries as 8 / 8 / 6', () => {
    const entries = Array.from({ length: 22 }, (_, index) => `asset-${index + 1}`);

    expect(assetLibraryPageCount(entries.length)).toBe(3);
    expect(paginateAssetLibraryEntries(entries, 1)).toHaveLength(8);
    expect(paginateAssetLibraryEntries(entries, 2)).toHaveLength(8);
    expect(paginateAssetLibraryEntries(entries, 3)).toHaveLength(6);
    expect(paginateAssetLibraryEntries(entries, 1)[0]).toBe('asset-1');
    expect(paginateAssetLibraryEntries(entries, 3)[5]).toBe('asset-22');
    expect(paginateAssetLibraryEntries(entries, 4)).toEqual([]);
  });

  it('keeps pagination after category/search filtering and wires reset rules', () => {
    const library = source(
      'src/renderer/features/assets/AssetLibrary.tsx',
    );

    expect(library).toContain('filterAssetLibraryEntries(entries, searchQuery)');
    expect(library).toContain('paginateAssetLibraryEntries(visibleEntries, currentPage)');
    expect(library).toContain('entries={pageEntries}');
    expect(library).toContain('setPage(1)');
    expect(library).toContain('const selectCategory');
    expect(library).toContain('const updateSearchQuery');
    expect(library).toContain('closeSelectedDetails(false)');
    expect(library).toContain('data-testid="asset-library-pagination"');
    expect(library).toContain('aria-label="上一页"');
    expect(library).toContain('aria-label="下一页"');
  });

  it('uses a transient accessible overlay and removes the old in-flow inspector', () => {
    const library = source(
      'src/renderer/features/assets/AssetLibrary.tsx',
    );
    const styles = source('src/renderer/styles.css');

    expect(library).not.toContain('asset-selected-inspector');
    expect(library).not.toContain('asset-selected-summary');
    expect(library).toContain(
      'hideHeading && selectedAsset && selectedDetailsOpen',
    );
    expect(library).toContain('data-testid="asset-details-overlay"');
    expect(library).toContain('role="dialog"');
    expect(library).toContain('aria-modal="true"');
    expect(library).toContain("event.key !== 'Escape'");
    expect(library).toContain('data-testid="asset-details-close"');
    expect(library).toContain('focusAssetCard');
    expect(styles).toContain('.asset-details-overlay {');
    expect(styles).toContain('.asset-library-pagination {');
    expect(styles).not.toContain('.asset-selected-summary');
  });

  it('keeps card keyboard activation, rebuild isolation, and drag isolation', () => {
    const project = migrateProject(exampleProject);
    const asset = project.assets.find((candidate) => candidate.kind === 'image')!;
    const onSelect = vi.fn();
    const onDragStart = vi.fn();
    const onDragEnd = vi.fn();
    const card = AssetCard({
      asset,
      category: 'background',
      contextLabel: '图片',
      dragging: false,
      dropPayload: directPayload(asset.id),
      onDragEnd,
      onDragStart,
      onRebuildThumbnail: vi.fn(),
      onSelect,
      onThumbnailError: vi.fn(),
      selected: false,
      thumbnail: { status: 'loading' },
    });
    const props = card.props as {
      onClick: (event: { currentTarget: HTMLElement }) => void;
      onDragEnd: (event: { currentTarget: HTMLElement }) => void;
      onDragStart: (event: {
        currentTarget: HTMLElement;
        dataTransfer: { setData(type: string, value: string): void };
      }) => void;
      onKeyDown: (event: {
        currentTarget: HTMLElement;
        key: string;
        preventDefault(): void;
        target: EventTarget;
      }) => void;
    };
    const cardElement = {} as HTMLElement;

    props.onClick({ currentTarget: cardElement });
    expect(onSelect).toHaveBeenCalledWith(asset.id);

    onSelect.mockClear();
    props.onKeyDown({
      currentTarget: cardElement,
      key: 'Enter',
      preventDefault: vi.fn(),
      target: cardElement,
    });
    expect(onSelect).toHaveBeenCalledWith(asset.id);

    onSelect.mockClear();
    props.onKeyDown({
      currentTarget: cardElement,
      key: 'Enter',
      preventDefault: vi.fn(),
      target: {} as EventTarget,
    });
    expect(onSelect).not.toHaveBeenCalled();

    props.onDragStart({
      currentTarget: cardElement,
      dataTransfer: { setData: vi.fn() },
    });
    expect(onDragStart).toHaveBeenCalledWith(asset.id);
    props.onClick({ currentTarget: cardElement });
    expect(onSelect).not.toHaveBeenCalled();
    props.onDragEnd({ currentTarget: cardElement });
    expect(onDragEnd).toHaveBeenCalled();
  });
});
