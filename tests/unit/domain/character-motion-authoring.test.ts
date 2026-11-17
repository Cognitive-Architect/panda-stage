import { describe, expect, it } from 'vitest';
import { CharacterMotionService, characterCompositeKeyTimes, type AnimationProperty } from '../../../src/domain';
import { characterPartAnimationFixture } from '../../helpers/characterPartAnimationFixture';
import { IDS } from './testProject';

const service = new CharacterMotionService();
function fixture() {
  const data = characterPartAnimationFixture();
  return { ...data, input: { shotId: IDS.shot, layerId: data.layerId, partId: data.graphicPartId, timeMs: 500, autoKey: true } };
}
describe('Character Motion Property Track facade', () => {
  it.each<[string, Partial<Record<AnimationProperty, number>>, AnimationProperty[]]>([
    ['drag', { 'transform.offsetX': 10, 'transform.offsetY': 20 }, ['transform.offsetX', 'transform.offsetY']],
    ['rotate', { 'transform.rotationDeg': 270 }, ['transform.rotationDeg']],
    ['scale', { 'transform.scaleX': 2, 'transform.scaleY': 2 }, ['transform.scaleX', 'transform.scaleY']],
  ])('lazy creates only changed properties for %s and updates the same time', (_kind, changes, properties) => {
    const { project, input } = fixture();
    const before = structuredClone(project);
    const next = service.apply(project, input, changes);
    const clip = next.shots[0]!.layers.find(l => l.id === input.layerId)!.animationClip!;
    expect(clip.tracks.map(t => t.property)).toEqual(properties);
    for (const track of clip.tracks) {
      expect(track.keys.map(k => k.timeMs)).toEqual([0, 500]);
      expect(track.keys[0]!.value).toBe(track.property.startsWith('transform.scale') ? 1 : 0);
    }
    const again = service.apply(next, input, Object.fromEntries(properties.map(p => [p, 3])));
    const updated = again.shots[0]!.layers.find(l => l.id === input.layerId)!.animationClip!;
    if (clip.version !== 1 || updated.version !== 1) throw new Error('fixture');
    expect(updated.targetBases).toEqual(clip.targetBases);
    expect(updated.fixedCharacterCenter).toEqual(clip.fixedCharacterCenter);
    expect(updated.tracks.every(t => t.keys.length === 2 && t.keys[1]!.value === 3)).toBe(true);
    expect(project).toEqual(before);
    expect(next.animations).toEqual(before.animations);
    expect(next.characters).toEqual(before.characters);
  });
  it('writes only changed 0ms base keys and does not persist Composite/Pose state', () => {
    const { project, input } = fixture();
    const next = service.apply(project, { ...input, timeMs: 0 }, { 'transform.rotationDeg': 40, 'transform.offsetX': 0 });
    const layer = next.shots[0]!.layers.find(l => l.id === input.layerId)!;
    expect(layer.animationClip!.tracks).toHaveLength(1);
    expect(layer.animationClip!.tracks[0]!.keys).toEqual([{ timeMs: 0, value: 40, interpolationToNext: 'linear' }]);
    expect(characterCompositeKeyTimes(layer, input.partId)).toEqual([0]);
    expect(JSON.stringify(next)).not.toMatch(/compositeKeys|poseKeys|poseAnimation/);
  });
  it('aggregates any property without duplicate markers or private key data', () => {
    const { project, input } = fixture();
    const next = service.apply(service.apply(project, input, { 'transform.offsetX': 20 }), { ...input, timeMs: 1000 }, { 'transform.rotationDeg': 90 });
    const layer = next.shots[0]!.layers.find(l => l.id === input.layerId)!;
    expect(characterCompositeKeyTimes(layer, input.partId)).toEqual([0, 500, 1000]);
    expect(characterCompositeKeyTimes(layer, input.partId).includes(250)).toBe(false);
  });
  it.each(['imagePartId', 'graphicPartId'] as const)('Auto-Key OFF follows static editing on %s without keys, including an existing Clip', field => {
    const data = fixture(), input = { ...data.input, partId: data[field] };
    const staticEdit = service.apply(data.project, { ...input, autoKey: false }, { 'transform.offsetX': 20 });
    expect(staticEdit.shots[0]!.layers.find(l => l.id === input.layerId)!.animationClip).toBeUndefined();
    expect(staticEdit.characters).not.toEqual(data.project.characters);
    const animated = service.apply(data.project, input, { 'transform.rotationDeg': 90 });
    const staticAfter = service.apply(animated, { ...input, autoKey: false }, { 'transform.offsetY': 12 });
    expect(staticAfter.shots).toEqual(animated.shots);
    expect(staticAfter.characters).not.toEqual(animated.characters);
    expect(staticAfter.animations).toEqual(animated.animations);
  });
  it('rejects off-grid/out-of-shot/locked/illegal-scale writes and keeps no-op pristine', () => {
    const { project, input } = fixture();
    expect(service.apply(project, input, { 'transform.offsetX': 0 })).toBe(project);
    for (const timeMs of [43, 4000]) expect(() => service.apply(project, { ...input, timeMs }, { 'transform.offsetX': 1 })).toThrow();
    for (const value of [0, -1, 0.049, 21]) expect(() => service.apply(project, input, { 'transform.scaleX': value })).toThrow();
    project.shots[0]!.layers.find(l => l.id === input.layerId)!.locked = true;
    expect(() => service.apply(project, input, { 'transform.offsetX': 1 })).toThrow(/锁定/);
  });
});
