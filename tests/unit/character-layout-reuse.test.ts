import { describe, expect, it } from 'vitest';
import {
  assessCharacterLayoutReuse,
  buildCharacterLayoutReuseUpdate,
  type CharacterLayoutReuseCandidate,
  type CharacterLayoutReuseImageAsset,
  type CharacterLayoutReuseTarget,
} from '../../src/renderer/features/characters/characterLayoutReuse';

const source: CharacterLayoutReuseCandidate = {
  characterId: 'source-character',
  name: 'Saved source',
  bodyAssetId: 'source-body',
  facePlacement: {
    offsetX: 42,
    offsetY: 186,
    scale: 0.92,
    rotationDeg: 12,
    flipX: true,
  },
  head: {
    assetId: 'source-head',
    placement: {
      offsetX: 6,
      offsetY: -132,
      scale: 0.88,
      rotationDeg: -8,
      flipX: true,
    },
    pivot: { x: 358, y: 452 },
  },
};

const target: CharacterLayoutReuseTarget = {
  characterId: 'target-character',
  name: 'Target character',
  bodyAssetId: 'target-body',
  head: {
    assetId: 'target-head',
    placement: {
      offsetX: -8,
      offsetY: -24,
      scale: 1.15,
      rotationDeg: 0,
      flipX: false,
    },
    pivot: { x: 310, y: 420 },
  },
};

function image(
  id: string,
  width = 720,
  height = 920,
): CharacterLayoutReuseImageAsset {
  return {
    id,
    kind: 'image',
    width,
    height,
    sha256: `${id}-hash`,
    metadata: { status: 'ready' },
  };
}

const assets = [
  image('source-body'),
  image('target-body'),
  image('source-head'),
  image('target-head', 640, 800),
];

const loadedImages = new Map([
  ['source-body', { width: 720, height: 920 }],
  ['target-body', { width: 720, height: 920 }],
  ['source-head', { width: 720, height: 920 }],
  ['target-head', { width: 640, height: 800 }],
]);

function assess(overrides: Partial<Parameters<typeof assessCharacterLayoutReuse>[0]> = {}) {
  return assessCharacterLayoutReuse({
    sourceIsSaved: true,
    source,
    target,
    assets,
    loadedImages,
    missingAssetIds: new Set(),
    ...overrides,
  });
}

function withoutHead<T extends { head?: unknown }>(value: T): Omit<T, 'head'> {
  const copy = { ...value };
  delete copy.head;
  return copy;
}

describe('saved Character layout reuse', () => {
  it('accepts exact Body reference dimensions with the same optional Head structure', () => {
    expect(assess()).toEqual({
      ok: true,
      bodyDimensions: {
        source: { width: 720, height: 920 },
        target: { width: 720, height: 920 },
      },
    });
  });

  it('rejects different Body dimensions even when the aspect ratio is unchanged', () => {
    const result = assess({
      assets: [
        ...assets.filter((asset) => asset.id !== 'target-body'),
        image('target-body', 360, 460),
      ],
      loadedImages: new Map([
        ...loadedImages,
        ['target-body', { width: 360, height: 460 }],
      ]),
    });
    expect(result).toMatchObject({
      ok: false,
      code: 'body-dimensions-mismatch',
    });
    if (!result.ok) expect(result.reason).toContain('不进行比例换算');
  });

  it('rejects different Body ratios and a missing Head counterpart', () => {
    const ratioResult = assess({
      assets: [
        ...assets.filter((asset) => asset.id !== 'target-body'),
        image('target-body', 840, 920),
      ],
      loadedImages: new Map([
        ...loadedImages,
        ['target-body', { width: 840, height: 920 }],
      ]),
    });
    expect(ratioResult).toMatchObject({ ok: false, code: 'body-dimensions-mismatch' });

    const headlessTarget = withoutHead(target);
    const headResult = assess({ target: headlessTarget });
    expect(headResult).toMatchObject({ ok: false, code: 'head-structure-mismatch' });
  });

  it('rejects unsaved sources and unreadable or missing source resources', () => {
    expect(assess({ sourceIsSaved: false })).toMatchObject({
      ok: false,
      code: 'source-unsaved',
    });
    expect(assess({ missingAssetIds: new Set(['source-head']) })).toMatchObject({
      ok: false,
      code: 'resource-missing',
    });
    expect(assess({ loadedImages: new Map() })).toMatchObject({
      ok: false,
      code: 'resource-loading',
    });
  });

  it('rejects self-copy and a source with no saved asset checksum', () => {
    expect(assess({
      target: { ...target, characterId: source.characterId },
    })).toMatchObject({ ok: false, code: 'same-character' });

    expect(assess({
      assets: assets.map((asset) =>
        asset.id === source.bodyAssetId
          ? { id: asset.id, kind: 'image' as const, width: asset.width, height: asset.height }
          : asset,
      ),
    })).toMatchObject({ ok: false, code: 'asset-unverified' });
  });

  it('copies only Face and Head layout numbers while preserving target references', () => {
    const sourceBefore = structuredClone(source);
    const targetBefore = structuredClone(target);
    const update = buildCharacterLayoutReuseUpdate(source, target);

    expect(update).toEqual({
      facePlacement: {
        offsetX: 42,
        offsetY: 186,
        scale: 0.92,
        rotationDeg: 12,
        flipX: true,
      },
      head: {
        assetId: 'target-head',
        placement: {
          offsetX: 6,
          offsetY: -132,
          scale: 0.88,
          rotationDeg: -8,
          flipX: true,
        },
        pivot: { x: 358, y: 452 },
      },
    });
    expect(update).not.toHaveProperty('bodyAssetId');
    expect(update).not.toHaveProperty('expressionAssets');
    expect(source).toEqual(sourceBefore);
    expect(target).toEqual(targetBefore);
  });

  it('supports a matching Body-only pair without inventing a Head', () => {
    const headlessSource = withoutHead(source);
    const headlessTarget = withoutHead(target);
    const result = assess({
      source: headlessSource,
      target: headlessTarget,
    });

    expect(result.ok).toBe(true);
    expect(buildCharacterLayoutReuseUpdate(headlessSource, headlessTarget)).toEqual({
      facePlacement: {
        offsetX: 42,
        offsetY: 186,
        scale: 0.92,
        rotationDeg: 12,
        flipX: true,
      },
    });
  });
});
