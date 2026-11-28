import { describe, expect, it } from 'vitest';
import {
  CHARACTER_VECTOR_SKIN_FAINT_WEIGHT,
  autoVectorSkinInfluences,
  normalizeVectorSkinInfluences,
  pruneCharacterVectorSkins,
  resolveVectorSkinWeights,
  vectorSkinSegmentDistanceSquared,
  type VectorSkinBoneSegment,
  type VectorSkinInfluence,
} from '../../src/domain';
import { VECTOR_SKIN_BONE_A_ID, VECTOR_SKIN_BONE_B_ID } from '../helpers/vectorSkinFixtures';

/** Bone A along y = 20, Bone B along y = 80; both 100 px long. */
const SEGMENTS: VectorSkinBoneSegment[] = [
  { boneId: VECTOR_SKIN_BONE_A_ID, head: { x: 0, y: 20 }, tail: { x: 100, y: 20 } },
  { boneId: VECTOR_SKIN_BONE_B_ID, head: { x: 0, y: 80 }, tail: { x: 100, y: 80 } },
];

function weightOf(influences: readonly VectorSkinInfluence[], boneId: string): number {
  return influences.find((influence) => influence.boneId === boneId)?.weight ?? 0;
}

describe('vector skin segment distance', () => {
  it('measures perpendicular distance, clamps to the segment ends, and handles a point Bone', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 10, y: 0 };
    expect(vectorSkinSegmentDistanceSquared({ x: 5, y: 3 }, a, b)).toBeCloseTo(9, 12);
    // Beyond the end the nearest point is the end itself.
    expect(vectorSkinSegmentDistanceSquared({ x: 20, y: 0 }, a, b)).toBeCloseTo(100, 12);
    // A Bone without length binds as a joint.
    expect(vectorSkinSegmentDistanceSquared({ x: 3, y: 4 }, a, a)).toBeCloseTo(25, 12);
  });
});

describe('automatic inverse-fourth-power weights', () => {
  it('gives the nearest Bone the full share and blends equally on the midline', () => {
    const onA = autoVectorSkinInfluences(SEGMENTS, { x: 50, y: 20 });
    expect(onA).toEqual([{ boneId: VECTOR_SKIN_BONE_A_ID, weight: 1 }]);
    const onB = autoVectorSkinInfluences(SEGMENTS, { x: 50, y: 80 });
    expect(onB).toEqual([{ boneId: VECTOR_SKIN_BONE_B_ID, weight: 1 }]);
    const middle = autoVectorSkinInfluences(SEGMENTS, { x: 50, y: 50 });
    expect(middle).toHaveLength(2);
    expect(weightOf(middle, VECTOR_SKIN_BONE_A_ID)).toBeCloseTo(0.5, 12);
    expect(weightOf(middle, VECTOR_SKIN_BONE_B_ID)).toBeCloseTo(0.5, 12);
    expect(middle.reduce((sum, influence) => sum + influence.weight, 0)).toBeCloseTo(1, 12);
  });

  it('follows the inverse fourth power ordering between two Bones', () => {
    // Distances 20 (A) and 40 (B) -> share ratio (40/20)^4 = 16.
    const influences = autoVectorSkinInfluences(SEGMENTS, { x: 50, y: 40 });
    const a = weightOf(influences, VECTOR_SKIN_BONE_A_ID);
    const b = weightOf(influences, VECTOR_SKIN_BONE_B_ID);
    expect(a / b).toBeCloseTo(16, 9);
    expect(a + b).toBeCloseTo(1, 12);
  });

  it('keeps the two strongest of more Bones and normalizes to 1', () => {
    const segments: VectorSkinBoneSegment[] = [
      { boneId: 'bone-1', head: { x: 0, y: 0 }, tail: { x: 10, y: 0 } },
      { boneId: 'bone-2', head: { x: 0, y: 10 }, tail: { x: 10, y: 10 } },
      { boneId: 'bone-3', head: { x: 0, y: 1_000 }, tail: { x: 10, y: 1_000 } },
    ];
    const influences = autoVectorSkinInfluences(segments, { x: 5, y: 4 });
    expect(influences.map(({ boneId }) => boneId)).toEqual(['bone-1', 'bone-2']);
    expect(influences[0]!.weight).toBeGreaterThan(influences[1]!.weight);
    expect(influences.reduce((sum, influence) => sum + influence.weight, 0)).toBeCloseTo(1, 12);
  });

  it('drops faint shares and produces deterministic values', () => {
    // 25 px from A, 200 px from B: B is far below the faint threshold.
    const influences = autoVectorSkinInfluences(SEGMENTS, { x: 50, y: -5 });
    expect(influences).toEqual([{ boneId: VECTOR_SKIN_BONE_A_ID, weight: 1 }]);
    const again = autoVectorSkinInfluences(SEGMENTS, { x: 50, y: -5 });
    expect(JSON.stringify(again)).toBe(JSON.stringify(influences));

    const farButKept = autoVectorSkinInfluences(SEGMENTS, { x: 50, y: 45 });
    const faint = Math.min(...farButKept.map(({ weight }) => weight));
    expect(faint).toBeGreaterThanOrEqual(CHARACTER_VECTOR_SKIN_FAINT_WEIGHT);
  });

  it('keeps a finite weight for an anchor exactly on a Bone', () => {
    const influences = autoVectorSkinInfluences(SEGMENTS, { x: 10, y: 20 });
    expect(influences[0]).toEqual({ boneId: VECTOR_SKIN_BONE_A_ID, weight: 1 });
    expect(Number.isFinite(influences[0]!.weight)).toBe(true);
  });
});

describe('weight override resolution', () => {
  const overrides = new Map<string, readonly VectorSkinInfluence[]>([
    ['0:0:1', [{ boneId: VECTOR_SKIN_BONE_A_ID, weight: 0.25 }, { boneId: VECTOR_SKIN_BONE_B_ID, weight: 0.75 }]],
    ['0:0:2', [{ boneId: 'not-in-skin', weight: 1 }]],
    ['0:0:3', [{ boneId: VECTOR_SKIN_BONE_A_ID, weight: 0 }]],
  ]);

  it('uses a matching override, and reproduces it deterministically', () => {
    const first = resolveVectorSkinWeights({
      point: { x: 50, y: 20 },
      segments: SEGMENTS,
      overrides,
      anchorKey: '0:0:1',
    });
    expect(first.map(({ boneId }) => boneId)).toEqual([
      VECTOR_SKIN_BONE_B_ID,
      VECTOR_SKIN_BONE_A_ID,
    ]);
    expect(weightOf(first, VECTOR_SKIN_BONE_B_ID)).toBeCloseTo(0.75, 12);
    expect(weightOf(first, VECTOR_SKIN_BONE_A_ID)).toBeCloseTo(0.25, 12);
    const second = resolveVectorSkinWeights({
      point: { x: 50, y: 20 },
      segments: SEGMENTS,
      overrides,
      anchorKey: '0:0:1',
    });
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('falls back to automatic weights for unknown Bones or zero shares', () => {
    const automatic = autoVectorSkinInfluences(SEGMENTS, { x: 50, y: 20 });
    for (const anchorKey of ['0:0:2', '0:0:3', 'does-not-exist']) {
      expect(resolveVectorSkinWeights({
        point: { x: 50, y: 20 },
        segments: SEGMENTS,
        overrides,
        anchorKey,
      })).toEqual(automatic);
    }
  });
});

describe('weight normalization guards', () => {
  it('drops negative and non-finite shares instead of persisting them', () => {
    expect(normalizeVectorSkinInfluences([
      { boneId: 'a', weight: Number.NaN },
      { boneId: 'b', weight: -1 },
      { boneId: 'c', weight: 2 },
      { boneId: 'c', weight: 5 },
      { boneId: 'd', weight: 2 },
    ])).toEqual([
      { boneId: 'c', weight: 0.5 },
      { boneId: 'd', weight: 0.5 },
    ]);
    expect(normalizeVectorSkinInfluences([])).toEqual([]);
  });
});

describe('skin cascade pruning', () => {
  const skins = [{
    id: 'skin-1',
    partId: 'part-1',
    boneIds: ['bone-1', 'bone-2'] as [string, string],
  }, {
    id: 'skin-2',
    partId: 'part-2',
    boneIds: ['bone-2', 'bone-3'] as [string, string],
  }];

  it('keeps valid skins untouched', () => {
    const result = pruneCharacterVectorSkins({ vectorSkins: skins }, {
      partIds: new Set(['part-1', 'part-2']),
      boneIds: new Set(['bone-1', 'bone-2', 'bone-3']),
    });
    expect(result.changed).toBe(false);
    expect(result.skins).toEqual(skins);
  });

  it('drops a skin whose Part or Bone disappeared', () => {
    expect(pruneCharacterVectorSkins({ vectorSkins: skins }, {
      partIds: new Set(['part-1']),
      boneIds: new Set(['bone-1', 'bone-2', 'bone-3']),
    })).toMatchObject({ changed: true, skins: [skins[0]] });
    expect(pruneCharacterVectorSkins({ vectorSkins: skins }, {
      partIds: new Set(['part-1', 'part-2']),
      boneIds: new Set(['bone-1', 'bone-2']),
    })).toMatchObject({ changed: true, skins: [skins[0]] });
    expect(pruneCharacterVectorSkins({}, {
      partIds: new Set(),
      boneIds: new Set(),
    })).toEqual({ changed: false, skins: [] });
  });
});
