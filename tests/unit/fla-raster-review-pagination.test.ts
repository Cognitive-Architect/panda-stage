import { describe, expect, it } from 'vitest';
import type { AnimationImportIR } from '../../src/shared/fla-import-api';
import {
  allFlaReviewMediaIds,
  filterFlaReviewMedia,
  flaReviewPageCount,
  FLA_RASTER_REVIEW_PAGE_SIZES,
  paginateFlaReviewMedia,
  reviewMedia,
} from '../../src/renderer/fla-import/fla-review';

function fixture(count = 158): AnimationImportIR {
  return {
    source: {
      format: 'fla',
      basename: 'sample.fla',
      byteLength: 10_000,
      sha256: 'a'.repeat(64),
      parser: {
        package: 'lifeart/fla-viewer',
        entrypoint: 'FLAParser.parse',
        commit: '048000ccab67469980b8dedd1fc2b65a02d2b164',
      },
    },
    document: {
      width: 1920,
      height: 1080,
      frameRate: 30,
      backgroundColor: '#000000',
    },
    media: Array.from({ length: count }, (_, index) => {
      const name = `pose-${String(index + 1).padStart(3, '0')}.png`;
      return {
        id: `fla-media-${String(index + 1).padStart(8, '0')}`,
        name,
        sourceReference: `LIBRARY/${name}`,
        bitmapDataReference: `bin/${name}.dat`,
        sourceFormat: 'png' as const,
        width: 320,
        height: 240,
        payload: {
          mimeType: 'image/png' as const,
          width: 320,
          height: 240,
          bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
          alpha: {
            kind: 'opaque' as const,
            zeroAlphaPixels: 0,
            partialAlphaPixels: 0,
          },
        },
      };
    }),
    timelines: [],
    compatibility: [],
    summary: { placedInstanceCount: 0, libraryOnlyMediaCount: count },
  };
}

describe('Issue #392 raster review browsing model', () => {
  it('uses 16 as the default page size and offers the three supported sizes', () => {
    const items = reviewMedia(fixture());

    expect(FLA_RASTER_REVIEW_PAGE_SIZES).toEqual([16, 32, 64]);
    expect(flaReviewPageCount(items.length, FLA_RASTER_REVIEW_PAGE_SIZES[0])).toBe(10);
    expect(paginateFlaReviewMedia(items, 1, 16)).toHaveLength(16);
    expect(paginateFlaReviewMedia(items, 10, 16)).toHaveLength(14);
  });

  it('keeps selected IDs authoritative while pages and visible filters change', () => {
    const items = reviewMedia(fixture());
    const selected = new Set([items[0]!.media.id, items[17]!.media.id]);
    const selectedBefore = [...selected];

    expect(paginateFlaReviewMedia(items, 2, 16).some(({ media }) => selected.has(media.id))).toBe(true);
    expect(filterFlaReviewMedia(items, 'selected', '', selected).map(({ media }) => media.id)).toEqual(
      selectedBefore,
    );
    expect(filterFlaReviewMedia(items, 'unselected', '', selected)).toHaveLength(156);
    expect(filterFlaReviewMedia(items, 'all', 'pose-018', selected).map(({ media }) => media.id)).toEqual([
      items[17]!.media.id,
    ]);
    expect([...selected]).toEqual(selectedBefore);
  });

  it('derives global select-all from the complete collection, not the current page', () => {
    const items = reviewMedia(fixture());
    const allIds = allFlaReviewMediaIds(items);
    const firstPageIds = new Set(
      paginateFlaReviewMedia(items, 1, 16).map(({ media }) => media.id),
    );

    expect(allIds).toHaveLength(158);
    expect([...firstPageIds].every((id) => allIds.has(id))).toBe(true);
    expect(allIds.size).toBeGreaterThan(firstPageIds.size);
    expect(new Set<string>()).toHaveLength(0);
  });

  it('returns one valid page for an empty result and normalizes a low page number', () => {
    expect(flaReviewPageCount(0, 16)).toBe(1);
    expect(paginateFlaReviewMedia([], 4, 16)).toEqual([]);
    expect(paginateFlaReviewMedia(['a', 'b'], -2, 16)).toEqual(['a', 'b']);
    expect(paginateFlaReviewMedia(['a', 'b'], 1, 16)).toEqual(['a', 'b']);
  });
});
