import { describe, expect, it } from 'vitest';
import {
  characterPartTransformFromStaticAdjustment,
  type CharacterPartTransform,
} from '../../../src/domain';

function multiply(
  outer: CharacterPartTransform,
  inner: CharacterPartTransform,
): CharacterPartTransform {
  return {
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
    tx: outer.a * inner.tx + outer.c * inner.ty + outer.tx,
    ty: outer.b * inner.tx + outer.d * inner.ty + outer.ty,
  };
}

function expectTransformClose(
  actual: CharacterPartTransform,
  expected: CharacterPartTransform,
): void {
  for (const key of ['a', 'b', 'c', 'd', 'tx', 'ty'] as const) {
    expect(actual[key]).toBeCloseTo(expected[key], 9);
  }
}

describe('Character Part static layout', () => {
  const root: CharacterPartTransform = {
    a: -1.1,
    b: 0.25,
    c: 0.4,
    d: 1.3,
    tx: 790,
    ty: 47.6,
  };
  const sourceRest: CharacterPartTransform = {
    a: 0.92,
    b: 0.2,
    c: -0.12,
    d: 1.05,
    tx: 191.1,
    ty: 424.75,
  };
  const imageMapping = {
    sourceWidth: 640,
    sourceHeight: 640,
    crop: { x: 42, y: 75, width: 320, height: 280 },
    exportScale: 1.5,
  };

  it('preserves the full source affine, crop mapping, reflection and shear for an unchanged adjustment', () => {
    const actual = characterPartTransformFromStaticAdjustment(
      root,
      sourceRest,
      imageMapping,
      { offsetX: 0, offsetY: 0, scale: 1, rotationDeg: 0 },
    );
    expectTransformClose(actual, sourceRest);
  });

  it('applies controls in Character space around the cropped source center', () => {
    const adjustment = { offsetX: 26, offsetY: -11, scale: 1.35, rotationDeg: 31 };
    const actualRest = characterPartTransformFromStaticAdjustment(
      root,
      sourceRest,
      imageMapping,
      adjustment,
    );
    const sourcePose = multiply(root, sourceRest);
    const center = {
      x: imageMapping.crop.x + imageMapping.crop.width / 2,
      y: imageMapping.crop.y + imageMapping.crop.height / 2,
    };
    const centerBefore = {
      x: sourcePose.a * center.x + sourcePose.c * center.y + sourcePose.tx,
      y: sourcePose.b * center.x + sourcePose.d * center.y + sourcePose.ty,
    };
    const radians = adjustment.rotationDeg * Math.PI / 180;
    const cosine = Math.cos(radians) * adjustment.scale;
    const sine = Math.sin(radians) * adjustment.scale;
    const aroundCenter: CharacterPartTransform = {
      a: cosine,
      b: sine,
      c: -sine,
      d: cosine,
      tx: centerBefore.x + adjustment.offsetX - cosine * centerBefore.x + sine * centerBefore.y,
      ty: centerBefore.y + adjustment.offsetY - sine * centerBefore.x - cosine * centerBefore.y,
    };
    expectTransformClose(multiply(root, actualRest), multiply(aroundCenter, sourcePose));
  });

  it('rejects non-finite or out-of-range authoring controls', () => {
    expect(() => characterPartTransformFromStaticAdjustment(
      root,
      sourceRest,
      imageMapping,
      { offsetX: Number.NaN, offsetY: 0, scale: 1, rotationDeg: 0 },
    )).toThrow();
    expect(() => characterPartTransformFromStaticAdjustment(
      root,
      sourceRest,
      imageMapping,
      { offsetX: 0, offsetY: 0, scale: 0, rotationDeg: 0 },
    )).toThrow();
  });
});
