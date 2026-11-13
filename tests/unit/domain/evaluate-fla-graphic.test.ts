import { describe, expect, it } from 'vitest';
import {
  evaluateFlaGraphicVisual,
  FlaGraphicDefinitionSchema,
  resolveLayerVisualParts,
  type FlaGraphicStructureFrame,
} from '../../../src/domain';
import type { AffineMatrix2D } from '../../../src/shared/affine-matrix';
import { buildProjectWithAnimation } from './testProject';

const identity: AffineMatrix2D = {
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  tx: 0,
  ty: 0,
};
const matrix = (tx: number, ty = 0): AffineMatrix2D => ({ ...identity, tx, ty });
const frameIds = [
  'a1000000-0000-4000-8000-000000000000',
  'a1000000-0000-4000-8000-000000000001',
];
const bitmapAssetId = '10000000-0000-4000-8000-000000000003';
const fallbackAssetId = '10000000-0000-4000-8000-000000000004';

function structureFrame0(): FlaGraphicStructureFrame {
  return {
    ordinal: 0,
    layers: [{
      name: 'main',
      nodes: [{
        type: 'group',
        id: 'group',
        drawOrder: 0,
        localTransform: matrix(10),
        groupId: 'group-ref',
        children: [
          {
            type: 'bitmap',
            id: 'bitmap',
            drawOrder: 0,
            localTransform: matrix(4),
            bitmapRef: 'bitmap-ref',
            assetId: bitmapAssetId,
            clipPaths: [{
              shapes: [{
                shapeId: 'mask-shape',
                worldTransform: matrix(12),
                parentLocalTransform: matrix(2),
                pathData: ['M0 0L10 0L10 10Z'],
              }],
            }],
          },
          {
            type: 'opaque',
            id: 'frame-crop',
            drawOrder: 1,
            localTransform: identity,
            opaqueKind: 'shape',
            fallbackScope: 'frame-crop',
            fallbackAssetId,
            fallbackViewBox: { x: 20, y: 5, width: 12, height: 9 },
          },
          {
            type: 'opaque',
            id: 'unsafe',
            drawOrder: 2,
            localTransform: identity,
            opaqueKind: 'filter',
          },
        ],
      }],
    }],
  };
}

function definition() {
  const frameDuration = 1_000 / 24;
  return FlaGraphicDefinitionSchema.parse({
    id: 'a0000000-0000-4000-8000-000000000001',
    kind: 'fla-graphic',
    name: 'Test Graphic',
    source: {
      basename: 'test.fla',
      sha256: 'a'.repeat(64),
      renderTargetId: 'test-target',
      targetKind: 'graphic-symbol',
      targetName: 'Walk',
      startFrameIndex: 0,
      endFrameIndex: 1,
      sourceFps: 24,
      canvas: { width: 100, height: 100 },
      anchor: { x: 10, y: 10 },
      documentCanvas: { width: 100, height: 100 },
    },
    durationMs: frameDuration * 2,
    frames: frameIds.map((assetId, ordinal) => ({
      ordinal,
      sourceFrameIndex: ordinal,
      assetId,
      sha256: ordinal === 0 ? 'b'.repeat(64) : 'c'.repeat(64),
      sourceViewport: { x: 10, y: 10, width: 100, height: 100 },
      offset: { x: 0, y: 0 },
      startMs: ordinal * frameDuration,
      durationMs: frameDuration,
      createdBySequenceImport: false,
    })),
    structure: {
      version: 1,
      frames: [
        structureFrame0(),
        {
          ordinal: 1,
          layers: [{
            name: 'second frame',
            nodes: [{
              type: 'bitmap',
              id: 'second-frame-bitmap',
              drawOrder: 0,
              localTransform: matrix(50),
              bitmapRef: 'bitmap-ref-2',
              assetId: bitmapAssetId,
            }],
          }],
        },
      ],
    },
  });
}

describe('evaluateFlaGraphicVisual', () => {
  it('selects one exact frame and keeps Definition mode independent of instance overrides', () => {
    const source = definition();
    const instanceTransformOverrides = {
      '0': {
        '["group"]': matrix(30),
        '["group","bitmap"]': matrix(7),
        '["group","stale-node"]': matrix(90),
      },
    };

    const definitionVisual = evaluateFlaGraphicVisual({
      definition: source,
      frameOrdinal: 0,
      mode: 'definition',
      instanceTransformOverrides,
    });
    const instanceVisual = evaluateFlaGraphicVisual({
      definition: source,
      frameOrdinal: 0,
      mode: 'instance',
      instanceTransformOverrides,
    });
    const secondFrameVisual = evaluateFlaGraphicVisual({
      definition: source,
      frameOrdinal: 1,
      mode: 'instance',
      instanceTransformOverrides,
    });

    expect(definitionVisual?.frameAssetId).toBe(frameIds[0]);
    expect(definitionVisual?.layers?.[0]?.nodes[0]?.worldTransform.tx).toBe(10);
    expect(definitionVisual?.layers?.[0]?.nodes[0]?.children[0]?.worldTransform.tx).toBe(14);
    expect(instanceVisual?.frameOrdinal).toBe(0);
    expect(instanceVisual?.layers?.[0]?.nodes[0]?.worldTransform.tx).toBe(30);
    expect(instanceVisual?.layers?.[0]?.nodes[0]?.children[0]?.worldTransform.tx).toBe(37);
    expect(secondFrameVisual?.frameAssetId).toBe(frameIds[1]);
    expect(secondFrameVisual?.structureFrame?.layers[0]?.nodes[0]?.id).toBe('second-frame-bitmap');
    expect(secondFrameVisual?.resourceAssetIds).toEqual([bitmapAssetId]);
  });

  it('keeps mask geometry in parent-local space and anchors a frame crop to the authored parent', () => {
    const visual = evaluateFlaGraphicVisual({
      definition: definition(),
      frameOrdinal: 0,
      mode: 'instance',
      instanceTransformOverrides: { '0': { '["group"]': matrix(30) } },
    });
    const group = visual?.layers?.[0]?.nodes[0];
    const bitmap = group?.children[0];
    const frameCrop = group?.children[1];
    const unsafeOpaque = group?.children[2];

    expect(bitmap?.worldTransform.tx).toBe(34);
    expect(bitmap?.clipPaths[0]?.shapes[0]?.worldTransform.tx).toBe(32);
    expect(frameCrop?.authoredLocalTransform.tx).toBe(10);
    expect(frameCrop?.worldTransform.tx).toBe(40);
    expect(frameCrop?.renderable).toBe(true);
    expect(unsafeOpaque?.renderable).toBe(false);
    expect(visual?.resourceAssetIds).toEqual(
      expect.arrayContaining([bitmapAssetId, fallbackAssetId]),
    );
    expect(visual?.resourceAssetIds).not.toContain(frameIds[0]);
  });

  it('rejects invalid ordinals and leaves missing structure as a baked-frame fallback', () => {
    const source = definition();
    expect(evaluateFlaGraphicVisual({
      definition: source,
      frameOrdinal: -1,
      mode: 'definition',
    })).toBeNull();
    const withoutStructure = { ...source };
    delete withoutStructure.structure;
    const fallback = evaluateFlaGraphicVisual({
      definition: withoutStructure,
      frameOrdinal: 1,
      mode: 'definition',
    });
    expect(fallback).toMatchObject({
      frameOrdinal: 1,
      frameAssetId: frameIds[1],
      structureFrame: null,
      layers: null,
      resourceAssetIds: [frameIds[1]],
    });

    const partiallyStructured = {
      ...source,
      structure: {
        ...source.structure!,
        frames: source.structure!.frames.filter((frame) => frame.ordinal === 0),
      },
    };
    const mixedFrameFallback = evaluateFlaGraphicVisual({
      definition: partiallyStructured,
      frameOrdinal: 1,
      mode: 'instance',
    });
    expect(mixedFrameFallback).toMatchObject({
      frameOrdinal: 1,
      frameAssetId: frameIds[1],
      structureFrame: null,
      layers: null,
      resourceAssetIds: [frameIds[1]],
    });
  });

  it('reuses immutable Definition and no-override Instance evaluations per frame', () => {
    const source = definition();
    const firstDefinitionEvaluation = evaluateFlaGraphicVisual({
      definition: source,
      frameOrdinal: 0,
      mode: 'definition',
    });
    const secondDefinitionEvaluation = evaluateFlaGraphicVisual({
      definition: source,
      frameOrdinal: 0,
      mode: 'definition',
    });
    const firstInstanceEvaluation = evaluateFlaGraphicVisual({
      definition: source,
      frameOrdinal: 0,
      mode: 'instance',
    });
    const secondInstanceEvaluation = evaluateFlaGraphicVisual({
      definition: source,
      frameOrdinal: 0,
      mode: 'instance',
    });

    expect(secondDefinitionEvaluation).toBe(firstDefinitionEvaluation);
    expect(secondInstanceEvaluation).toBe(firstInstanceEvaluation);
    expect(firstInstanceEvaluation).not.toBe(firstDefinitionEvaluation);
  });

  it('keeps override evaluations isolated by immutable Layer override objects', () => {
    const source = definition();
    const overrideA = { '0': { '["group","bitmap"]': matrix(40) } };
    const overrideB = { '0': { '["group","bitmap"]': matrix(60) } };
    const firstA = evaluateFlaGraphicVisual({
      definition: source,
      frameOrdinal: 0,
      mode: 'instance',
      instanceTransformOverrides: overrideA,
    });
    const secondA = evaluateFlaGraphicVisual({
      definition: source,
      frameOrdinal: 0,
      mode: 'instance',
      instanceTransformOverrides: overrideA,
    });
    const instanceB = evaluateFlaGraphicVisual({
      definition: source,
      frameOrdinal: 0,
      mode: 'instance',
      instanceTransformOverrides: overrideB,
    });

    expect(secondA).toBe(firstA);
    expect(firstA?.layers?.[0]?.nodes[0]?.children[0]?.worldTransform.tx).toBe(50);
    expect(instanceB?.layers?.[0]?.nodes[0]?.children[0]?.worldTransform.tx).toBe(70);
  });

  it('resolves a structured frame even when its baked frame asset is missing from project.assets (#1082 F5)', () => {
    const source = definition();
    const base = buildProjectWithAnimation();
    const project = {
      ...base,
      assets: [
        {
          id: bitmapAssetId,
          name: 'bmp',
          kind: 'image' as const,
          relativePath: 'assets/bmp.png',
          mimeType: 'image/png',
          sha256: '1'.repeat(64),
          width: 10,
          height: 10,
          usage: 'uncategorized' as const,
          keywords: [],
        },
        {
          id: fallbackAssetId,
          name: 'fallback',
          kind: 'image' as const,
          relativePath: 'assets/fallback.svg',
          mimeType: 'image/svg+xml',
          sha256: '2'.repeat(64),
          width: 100,
          height: 100,
          usage: 'uncategorized' as const,
          keywords: [],
        },
      ],
      animations: [source],
      shots: [{
        ...base.shots[0]!,
        layers: [{
          ...base.shots[0]!.layers[0]!,
          source: { kind: 'animation' as const, animationId: source.id },
        }],
      }],
    };
    const shot = project.shots[0]!;
    const layer = shot.layers[0]!;
    const resolved = resolveLayerVisualParts(project, shot, {
      id: layer.id,
      anchor: layer.anchor,
      visible: true,
      zIndex: 0,
      assetId: frameIds[0]!,
      animationFrame: {
        animationId: source.id,
        frameOrdinal: 0,
        offset: { x: 0, y: 0 },
        viewport: { width: 100, height: 100 },
        canvas: { width: 100, height: 100 },
      },
      x: layer.x,
      y: layer.y,
      scaleX: layer.scaleX,
      scaleY: layer.scaleY,
      rotationDeg: layer.rotationDeg,
      flipX: layer.flipX,
      opacity: layer.opacity,
    });
    expect(resolved.kind).toBe('fla-graphic');
    expect(resolved.resources.required.map((r) => r.assetId)).toEqual([bitmapAssetId, fallbackAssetId]);
  });
});
