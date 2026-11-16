import { describe, expect, it } from 'vitest';
import {
  AnimationTrackSchema, ProjectSchema, evaluateAnimationClipAtTime,
  composeAnimatedCharacterPartTransform, type AnimationProperty,
} from '../../../src/domain';
import { animationCoreFixture } from '../../helpers/animationCoreFixture';

describe.each(['transform.scaleX', 'transform.scaleY'] as const)('%s persisted contract (#1125)', property => {
  describe.each([0, 1])('key index %s', keyIndex => {
    it.each([0, -1, 0.001, 0.049, 20.001, 100])('rejects value %s at Track and Project boundaries', value => {
      const { project, layerId } = animationCoreFixture();
      const track = project.shots[0]!.layers.find(layer => layer.id === layerId)!.animationClip!.tracks[0]!;
      track.property = property;
      track.keys.forEach(key => { key.value = 1; });
      track.keys[keyIndex]!.value = value;
      const result = AnimationTrackSchema.safeParse(track);
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues).toContainEqual(expect.objectContaining({ path: ['keys', keyIndex, 'value'] }));
      expect(ProjectSchema.safeParse(project).success).toBe(false);
    });
  });

  it.each([0.05, 1, 20])('accepts value %s through persisted parsing, evaluation and runtime composition', value => {
    const { project, layerId } = animationCoreFixture();
    const clip = project.shots[0]!.layers.find(layer => layer.id === layerId)!.animationClip!;
    clip.tracks[0]!.property = property;
    clip.tracks[0]!.keys.forEach(key => { key.value = value; });
    const parsed = ProjectSchema.parse(JSON.parse(JSON.stringify(project)));
    const persisted = parsed.shots[0]!.layers.find(layer => layer.id === layerId)!.animationClip!;
    for (const timeMs of [0, 500, 1000]) {
      const values = evaluateAnimationClipAtTime(persisted, timeMs);
      const matrix = composeAnimatedCharacterPartTransform(persisted.targetBases[0]!, persisted.fixedCharacterCenter, values);
      expect(values[0]!.value).toBe(value);
      expect(matrix.a).toBeCloseTo(property === 'transform.scaleX' ? value : 1);
      expect(matrix.d).toBeCloseTo(property === 'transform.scaleY' ? value : 1);
      expect(Object.values(matrix).every(Number.isFinite)).toBe(true);
    }
  });
});

describe('non-scale Animation Core properties', () => {
  it.each<AnimationProperty>(['transform.offsetX', 'transform.offsetY', 'transform.rotationDeg'])('retains finite-only values on %s', property => {
    const { clip } = animationCoreFixture();
    const track = clip.tracks[0]!;
    track.property = property;
    for (const value of [-1_000_000, 0, 1_000_000]) {
      track.keys.forEach(key => { key.value = value; });
      expect(AnimationTrackSchema.parse(track)).toEqual(track);
    }
    for (const value of [NaN, Infinity, -Infinity]) {
      track.keys[0]!.value = value;
      expect(AnimationTrackSchema.safeParse(track).success).toBe(false);
    }
  });
});
