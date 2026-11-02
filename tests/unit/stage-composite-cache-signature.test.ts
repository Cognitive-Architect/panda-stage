import { describe, expect, it } from 'vitest';
import type {
  LayerVisualHeadGroup,
} from '../../src/domain';
import type { StageRenderPart } from '../../src/shared/stage/render-model';
import {
  createStageCompositeCacheSignature,
  shouldReuseStageCompositeCache,
  type StageCompositeCacheSignatureInput,
} from '../../src/renderer/stage/compositeCacheSignature';

function part(
  id: string,
  slot: StageRenderPart['slot'],
  drawOrder: number,
): StageRenderPart {
  const assetId = id + '-asset';
  return {
    id,
    slot,
    drawOrder,
    asset: {
      id: assetId,
      kind: 'image',
      name: id,
      relativePath: 'assets/' + id + '.png',
      mimeType: 'image/png',
      width: 100,
      height: 120,
    },
    sourceUrl: 'blob:' + id + ':v1',
    render: {
      id,
      assetId,
      isBackground: false,
      listening: false,
      x: 10,
      y: 20,
      width: 100,
      height: 120,
      offsetX: 50,
      offsetY: 60,
      scaleX: 1,
      scaleY: 1,
      rotationDeg: 0,
      opacity: 1,
      visible: true,
      zIndex: drawOrder,
      coverScale: null,
    },
  };
}

function headGroup(): LayerVisualHeadGroup {
  return {
    id: 'head-group',
    pivot: { x: 40, y: 50 },
    partIds: ['head-part', 'face-part'],
    transform: {
      translateX: 0,
      translateY: 0,
      scaleX: 1,
      scaleY: 1,
      rotationDeg: 0,
    },
  };
}

function baseInput(): StageCompositeCacheSignatureInput {
  return {
    ownerLayerId: 'character-layer',
    composite: true,
    complete: true,
    visualBounds: { x: 0, y: 0, width: 200, height: 240 },
    headGroup: headGroup(),
    orderedParts: [
      part('body-part', 'body', 0),
      part('head-part', 'head', 1),
      part('face-part', 'face', 2),
    ],
    images: new Map([
      ['body-part', {}],
      ['head-part', {}],
      ['face-part', {}],
    ]),
  };
}

function signature(input: StageCompositeCacheSignatureInput): string {
  return createStageCompositeCacheSignature(input);
}

function withPart(
  input: StageCompositeCacheSignatureInput,
  partId: string,
  update: (current: StageRenderPart) => StageRenderPart,
): StageCompositeCacheSignatureInput {
  return {
    ...input,
    orderedParts: input.orderedParts.map((item) =>
      item.id === partId ? update(item) : item,
    ),
  };
}

function withRender(
  input: StageCompositeCacheSignatureInput,
  partId: string,
  update: (render: StageRenderPart['render']) => StageRenderPart['render'],
): StageCompositeCacheSignatureInput {
  return withPart(input, partId, (current) => ({
    ...current,
    render: update(current.render),
  }));
}

function equivalentFreshInput(
  input: StageCompositeCacheSignatureInput,
): StageCompositeCacheSignatureInput {
  return {
    ...input,
    visualBounds: { ...input.visualBounds },
    headGroup: input.headGroup
      ? {
          ...input.headGroup,
          pivot: { ...input.headGroup.pivot },
          partIds: [...input.headGroup.partIds],
          transform: { ...input.headGroup.transform },
        }
      : null,
    orderedParts: input.orderedParts.map((item) => ({
      ...item,
      asset: { ...item.asset },
      render: { ...item.render },
    })),
    images: new Map(input.images),
  };
}

describe('stage composite cache signature', () => {
  it('stays stable when equivalent render objects are recreated', () => {
    const input = baseInput();

    expect(signature(equivalentFreshInput(input))).toBe(signature(input));
  });

  it.each([
    ['owner layer identity', (input: StageCompositeCacheSignatureInput) => ({
      ...input,
      ownerLayerId: 'another-layer',
    })],
    ['composite mode', (input: StageCompositeCacheSignatureInput) => ({
      ...input,
      composite: false,
    })],
    ['frame completeness', (input: StageCompositeCacheSignatureInput) => ({
      ...input,
      complete: false,
    })],
    ['visual bounds', (input: StageCompositeCacheSignatureInput) => ({
      ...input,
      visualBounds: { ...input.visualBounds, width: input.visualBounds.width + 1 },
    })],
    ['visual bounds origin', (input: StageCompositeCacheSignatureInput) => ({
      ...input,
      visualBounds: { ...input.visualBounds, x: input.visualBounds.x + 1 },
    })],
    ['head group identity', (input: StageCompositeCacheSignatureInput) => ({
      ...input,
      headGroup: { ...input.headGroup!, id: 'replacement-head-group' },
    })],
    ['head group part membership', (input: StageCompositeCacheSignatureInput) => ({
      ...input,
      headGroup: {
        ...input.headGroup!,
        partIds: ['head-part'],
      },
    })],
    ['head transform', (input: StageCompositeCacheSignatureInput) => ({
      ...input,
      headGroup: {
        ...input.headGroup!,
        transform: { ...input.headGroup!.transform, translateX: 4 },
      },
    })],
    ['head pivot', (input: StageCompositeCacheSignatureInput) => ({
      ...input,
      headGroup: {
        ...input.headGroup!,
        pivot: { ...input.headGroup!.pivot, x: input.headGroup!.pivot.x + 1 },
      },
    })],
    ['ordered part sequence', (input: StageCompositeCacheSignatureInput) => ({
      ...input,
      orderedParts: [...input.orderedParts].reverse(),
    })],
    ['source asset identity', (input: StageCompositeCacheSignatureInput) =>
      withPart(input, 'face-part', (current) => ({
        ...current,
        asset: { ...current.asset, id: 'replacement-asset' },
      }))],
    ['asset dimensions', (input: StageCompositeCacheSignatureInput) =>
      withPart(input, 'face-part', (current) => ({
        ...current,
        asset: { ...current.asset, width: current.asset.width! + 1 },
      }))],
    ['source URL', (input: StageCompositeCacheSignatureInput) =>
      withPart(input, 'face-part', (current) => ({
        ...current,
        sourceUrl: 'blob:face-part:v2',
      }))],
    ['draw order', (input: StageCompositeCacheSignatureInput) =>
      withPart(input, 'face-part', (current) => ({
        ...current,
        drawOrder: current.drawOrder + 1,
      }))],
    ['part position', (input: StageCompositeCacheSignatureInput) =>
      withRender(input, 'head-part', (render) => ({
        ...render,
        x: render.x + 1,
      }))],
    ['part size', (input: StageCompositeCacheSignatureInput) =>
      withRender(input, 'head-part', (render) => ({
        ...render,
        width: render.width + 1,
      }))],
    ['part pivot', (input: StageCompositeCacheSignatureInput) =>
      withRender(input, 'head-part', (render) => ({
        ...render,
        offsetX: render.offsetX + 1,
      }))],
    ['part flip', (input: StageCompositeCacheSignatureInput) =>
      withRender(input, 'head-part', (render) => ({
        ...render,
        scaleX: -render.scaleX,
      }))],
    ['part rotation', (input: StageCompositeCacheSignatureInput) =>
      withRender(input, 'head-part', (render) => ({
        ...render,
        rotationDeg: render.rotationDeg + 1,
      }))],
    ['part opacity', (input: StageCompositeCacheSignatureInput) =>
      withRender(input, 'head-part', (render) => ({
        ...render,
        opacity: 0.5,
      }))],
    ['part visibility', (input: StageCompositeCacheSignatureInput) =>
      withRender(input, 'head-part', (render) => ({
        ...render,
        visible: false,
      }))],
    ['part z index', (input: StageCompositeCacheSignatureInput) =>
      withRender(input, 'head-part', (render) => ({
        ...render,
        zIndex: render.zIndex + 1,
      }))],
    ['decoded resource readiness', (input: StageCompositeCacheSignatureInput) => ({
      ...input,
      images: new Map([...input.images].filter(([id]) => id !== 'face-part')),
    })],
  ] as const)('invalidates when %s changes', (_label, change) => {
    const input = baseInput();

    expect(signature(change(input))).not.toBe(signature(input));
  });

  it('reuses only the same eligible cache unless forced', () => {
    expect(
      shouldReuseStageCompositeCache({
        forceRebuild: false,
        previousSignature: 'same',
        inputSignature: 'same',
        cacheEligible: true,
        previouslyCached: true,
      }),
    ).toBe(true);

    expect(
      shouldReuseStageCompositeCache({
        forceRebuild: true,
        previousSignature: 'same',
        inputSignature: 'same',
        cacheEligible: true,
        previouslyCached: true,
      }),
    ).toBe(false);

    expect(
      shouldReuseStageCompositeCache({
        forceRebuild: false,
        previousSignature: 'previous',
        inputSignature: 'current',
        cacheEligible: true,
        previouslyCached: true,
      }),
    ).toBe(false);

    expect(
      shouldReuseStageCompositeCache({
        forceRebuild: false,
        previousSignature: 'same',
        inputSignature: 'same',
        cacheEligible: true,
        previouslyCached: false,
      }),
    ).toBe(false);
  });

  it('clears a previously cached visual when it becomes ineligible', () => {
    expect(
      shouldReuseStageCompositeCache({
        forceRebuild: false,
        previousSignature: 'same',
        inputSignature: 'same',
        cacheEligible: false,
        previouslyCached: true,
      }),
    ).toBe(false);
  });

  it('builds a newly eligible visual when no Konva cache exists yet', () => {
    expect(
      shouldReuseStageCompositeCache({
        forceRebuild: false,
        previousSignature: 'same',
        inputSignature: 'same',
        cacheEligible: true,
        previouslyCached: false,
      }),
    ).toBe(false);
  });
});
