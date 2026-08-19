import { describe, expect, it } from 'vitest';
import type { AnimationImportIR } from '../../src/shared/fla-import-api';
import {
  compatibilityCounts,
  createFlaRasterSelectionIntent,
  reviewMedia,
  toggleFlaMediaSelection,
} from '../../src/renderer/fla-import/fla-review';

function media(index: number, name = `media-${String(index).padStart(3, '0')}.png`): AnimationImportIR['media'][number] {
  const id = `fla-media-${String(index).padStart(8, '0')}`;
  return {
    id,
    name,
    sourceReference: `LIBRARY/${name}`,
    bitmapDataReference: `bin/${name}.dat`,
    sourceFormat: name.endsWith('.jpg') ? 'jpg' : 'png',
    width: index === 1 ? 320 : 500,
    height: 500,
    payload: {
      mimeType: 'image/png',
      width: index === 1 ? 320 : 500,
      height: 500,
      bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      alpha: {
        kind: index === 0 ? 'mixed' : 'opaque',
        zeroAlphaPixels: index === 0 ? 10 : 0,
        partialAlphaPixels: index === 0 ? 2 : 0,
      },
    },
  };
}

function fixture(): AnimationImportIR {
  const mediaItems = Array.from({ length: 158 }, (_, index) =>
    media(index, index === 157 ? '笑.jpg' : undefined),
  );
  return {
    source: {
      format: 'fla',
      basename: '文件.fla',
      byteLength: 10_527_274,
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
      backgroundColor: '#FFFFFF',
    },
    media: mediaItems,
    timelines: [
      {
        id: 'fla-timeline-fixture-0001',
        name: 'Main',
        totalFrames: 1,
        layers: [
          {
            id: 'fla-layer-fixture-0001',
            name: 'Layer 1',
            sourceLayerIndex: 0,
            visible: true,
            locked: false,
            frames: [
              {
                id: 'fla-frame-fixture-0001',
                sourceFrameIndex: 0,
                startFrame: 0,
                duration: 1,
                instances: mediaItems.slice(0, 156).map((item, index) => ({
                  id: `fla-instance-${String(index).padStart(8, '0')}`,
                  mediaId: item.id,
                  sourceLibraryItemName: item.name,
                  matrix: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
                })),
              },
            ],
          },
        ],
      },
    ],
    compatibility: [
      { feature: 'bitmap-media', status: 'exact', reason: 'fixture' },
      { feature: 'timeline-frame-placement', status: 'degraded', reason: 'fixture' },
      { feature: 'vector-shape', status: 'unsupported', reason: 'fixture' },
      { feature: 'symbols', status: 'not-present', reason: 'fixture' },
      { feature: 'unknown-feature', status: 'unknown', reason: 'fixture' },
    ],
    summary: { placedInstanceCount: 156, libraryOnlyMediaCount: 2 },
  };
}

describe('FLA Slice 2 review model', () => {
  it('preserves deterministic 158-item ordering, stable IDs, and 156/2 placement split', () => {
    const ir = fixture();
    const first = reviewMedia(ir);
    const second = reviewMedia(ir);

    expect(first).toHaveLength(158);
    expect(first.map(({ media: item }) => item.id)).toEqual(
      second.map(({ media: item }) => item.id),
    );
    expect(first.filter((item) => item.placed)).toHaveLength(156);
    expect(first.filter((item) => item.libraryOnly)).toHaveLength(2);
    expect(first.find((item) => item.media.name === '笑.jpg')?.name.targetFileName).toBe('笑.png');
    expect(first[0]?.media.payload.alpha.zeroAlphaPixels).toBeGreaterThan(0);
    expect(first[1]?.media.width).toBe(320);
  });

  it('previews Windows normalization, reserved names, duplicate names, and existing collisions', () => {
    const ir = fixture();
    const custom = [
      media(0, 'CON.png'),
      media(1, 'bad:name?.jpg'),
      media(2, 'duplicate.png'),
      media(3, 'duplicate.jpg'),
    ];
    const result = reviewMedia(
      { ...ir, media: custom },
      [{ relativePath: 'assets/duplicate.png' }],
    );
    expect(result.find((item) => item.media.name === 'CON.png')?.name.targetFileName).toBe('_CON.png');
    expect(result.find((item) => item.media.name === 'CON.png')?.warnings).toContain(
      '源名称是 Windows 保留名，已预览安全名称',
    );
    expect(result.find((item) => item.media.name === 'bad:name?.jpg')?.name.targetFileName).toBe('bad_name_.png');
    expect(result.find((item) => item.media.name === 'duplicate.png')?.warnings).toContain(
      '未来目标文件名与现有 Asset 冲突',
    );
    expect(result.find((item) => item.media.name === 'duplicate.jpg')?.warnings).toContain(
      '未来目标文件名与另一个 FLA 媒体项冲突',
    );
  });

  it('counts every Panda-owned compatibility status and creates an ID-keyed intent', () => {
    const ir = fixture();
    expect(compatibilityCounts(ir)).toEqual({
      exact: 1,
      degraded: 1,
      unsupported: 1,
      unknown: 1,
      'not-present': 1,
    });
    const selected = new Set([ir.media[157]!.id, ir.media[0]!.id, ir.media[3]!.id]);
    const intent = createFlaRasterSelectionIntent(
      ir,
      '00000000-0000-4000-8000-000000000253',
      selected,
    );
    expect(intent.selectedCount).toBe(3);
    expect(intent.selectedMediaIds).toEqual([
      ir.media[0]!.id,
      ir.media[3]!.id,
      ir.media[157]!.id,
    ]);
    expect(intent.source.sha256).toBe(ir.source.sha256);
  });

  it('toggles card, thumbnail, and checkbox selections through the same stable media ID operation', () => {
    const mediaId = 'fla-media-00000001';
    const selected = new Set<string>();
    const afterCard = toggleFlaMediaSelection(selected, mediaId);
    const afterThumbnail = toggleFlaMediaSelection(afterCard, mediaId);
    const afterCheckbox = toggleFlaMediaSelection(afterThumbnail, mediaId);

    expect([...afterCard]).toEqual([mediaId]);
    expect([...afterThumbnail]).toEqual([]);
    expect([...afterCheckbox]).toEqual([mediaId]);
    expect(selected).toEqual(new Set());
  });
});
