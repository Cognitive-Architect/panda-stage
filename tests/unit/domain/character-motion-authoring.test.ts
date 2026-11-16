import { describe, expect, it } from 'vitest';
import {
  CharacterMotionService,
  characterCompositeKeyEasing,
  characterCompositeKeyTimes,
  characterMotionValues,
  evaluateShotAtTime,
  hasCompositeKeyOutgoingInterval,
  type AnimationInterpolation,
  type AnimationProperty,
} from '../../../src/domain';
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

  it.each(['imagePartId', 'graphicPartId'] as const)(
    'deletes, retimes without half-moves, pastes 5-channel pose, and edits sparse outgoing easings on %s',
    (partField) => {
      const data = characterPartAnimationFixture();
      const partId = data[partField];
      const baseTarget = { shotId: IDS.shot, layerId: data.layerId, partId };
      let project = service.apply(data.project, { ...baseTarget, timeMs: 500, autoKey: true }, {
        'transform.offsetX': 30,
        'transform.rotationDeg': 45,
      });
      project = service.apply(project, { ...baseTarget, timeMs: 1000, autoKey: true }, {
        'transform.offsetX': 80,
      });
      project = service.apply(project, { ...baseTarget, timeMs: 1500, autoKey: true }, {
        'transform.scaleX': 1.5,
        'transform.scaleY': 1.5,
      });

      const layerOf = (p = project) => p.shots[0]!.layers.find((l) => l.id === data.layerId)!;
      expect(characterCompositeKeyTimes(layerOf(), partId)).toEqual([0, 500, 1000, 1500]);

      // Retime collision (e.g. 500 -> 1000 where offsetX exists, and rotationDeg does not) rejects atomically with zero half-moves.
      expect(() =>
        service.retimeCompositeKey(project, { ...baseTarget, fromTimeMs: 500, toTimeMs: 1000 }),
      ).toThrow();
      expect(() =>
        service.retimeCompositeKey(project, { ...baseTarget, fromTimeMs: 500, toTimeMs: 1250 }),
      ).toThrow(/越过/);
      expect(() =>
        service.retimeCompositeKey(project, { ...baseTarget, fromTimeMs: 0, toTimeMs: 250 }),
      ).toThrow(/0 秒/);
      expect(() =>
        service.retimeCompositeKey(project, { ...baseTarget, fromTimeMs: 500, toTimeMs: 0 }),
      ).toThrow(/0 秒/);
      expect(() =>
        service.retimeCompositeKey(project, { ...baseTarget, fromTimeMs: 500, toTimeMs: 43 }),
      ).toThrow(/帧网格/);
      expect(() =>
        service.retimeCompositeKey(project, { ...baseTarget, fromTimeMs: 1500, toTimeMs: 3500 }),
      ).toThrow(/镜头时长/);

      const retimed = service.retimeCompositeKey(project, { ...baseTarget, fromTimeMs: 500, toTimeMs: 750 });
      expect(characterCompositeKeyTimes(layerOf(retimed), partId)).toEqual([0, 750, 1000, 1500]);
      const retimedRotTrack = layerOf(retimed).animationClip!.tracks.find(
        (t) => t.target.partId === partId && t.property === 'transform.rotationDeg',
      )!;
      expect(retimedRotTrack.keys.map((k) => k.timeMs)).toEqual([0, 750]);

      // Set real outgoing easings at 750ms (offsetX only) without mutating terminal rotationDeg@750 or materializing scale tracks.
      for (const easing of ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'step'] as AnimationInterpolation[]) {
        const eased = service.setCompositeKeyEasing(retimed, {
          ...baseTarget,
          timeMs: 750,
          interpolationToNext: easing,
        });
        expect(characterCompositeKeyEasing(layerOf(eased), partId, 750)).toBe(easing);
      }
      const stepEased = service.setCompositeKeyEasing(retimed, {
        ...baseTarget,
        timeMs: 750,
        interpolationToNext: 'step',
      });
      const stepLayer = layerOf(stepEased);
      const stepRotTrack = stepLayer.animationClip!.tracks.find(
        (t) => t.target.partId === partId && t.property === 'transform.rotationDeg',
      )!;
      expect(stepRotTrack.keys.find((k) => k.timeMs === 750)?.interpolationToNext).toBe('linear');
      for (const prop of ['transform.scaleX', 'transform.scaleY'] as const) {
        const scaleTrack = stepLayer.animationClip!.tracks.find(
          (t) => t.target.partId === partId && t.property === prop,
        )!;
        expect(scaleTrack.keys.some((k) => k.timeMs === 750)).toBe(false);
      }
      const heldLayer = evaluateShotAtTime(stepEased.shots[0]!, 875, stepEased).layers.find(
        (l) => l.id === data.layerId,
      )!;
      expect(heldLayer.animationValues?.find((v) => v.target.partId === partId && v.property === 'transform.offsetX')?.value).toBe(30);
      expect(() =>
        service.setCompositeKeyEasing(stepEased, { ...baseTarget, timeMs: 1500, interpolationToNext: 'linear' }),
      ).toThrow(/没有可修改的补间区间/);

      // Copy pose at 750ms (reads evaluated values across all 5 channels) and paste atomically at 2000ms.
      const copiedPose = characterMotionValues(stepEased, { ...baseTarget, timeMs: 750, autoKey: true });
      expect(copiedPose).toEqual({
        'transform.offsetX': 30,
        'transform.offsetY': 0,
        'transform.rotationDeg': 45,
        'transform.scaleX': 1.25,
        'transform.scaleY': 1.25,
      });
      const pasted = service.pasteCompositePose(stepEased, {
        ...baseTarget,
        targetTimeMs: 2000,
        pose: copiedPose,
      });
      const pastedTracks = layerOf(pasted).animationClip!.tracks.filter((t) => t.target.partId === partId);
      expect(pastedTracks).toHaveLength(5);
      expect(characterMotionValues(pasted, { ...baseTarget, timeMs: 2000, autoKey: true })).toEqual(copiedPose);
      expect(JSON.stringify(pasted)).not.toMatch(/compositeKeys|poseKeys|poseAnimation/);

      // Reject invalid paste targets without mutating.
      expect(() =>
        service.pasteCompositePose(pasted, { ...baseTarget, targetTimeMs: 43, pose: copiedPose }),
      ).toThrow(/有效帧/);
      expect(() =>
        service.pasteCompositePose(pasted, { ...baseTarget, targetTimeMs: 4000, pose: copiedPose }),
      ).toThrow(/有效帧/);

      // Delete non-0ms key removes only keys at that timeMs; 0ms is protected.
      expect(() => service.deleteCompositeKey(pasted, { ...baseTarget, timeMs: 0 })).toThrow(/0 秒/);
      const deleted = service.deleteCompositeKey(pasted, { ...baseTarget, timeMs: 750 });
      expect(characterCompositeKeyTimes(layerOf(deleted), partId)).toEqual([0, 1000, 1500, 2000]);
      expect(
        layerOf(deleted).animationClip!.tracks
          .filter((t) => t.target.partId === partId)
          .every((t) => !t.keys.some((k) => k.timeMs === 750)),
      ).toBe(true);
    },
  );

  it.each(['imagePartId', 'graphicPartId'] as const)(
    'treats only tracks with a key at timeMs and a next key as outgoing easing intervals on %s',
    (partField) => {
      const data = characterPartAnimationFixture();
      const partId = data[partField];
      const baseTarget = { shotId: IDS.shot, layerId: data.layerId, partId };
      const layerOf = (p: typeof data.project) => p.shots[0]!.layers.find((l) => l.id === data.layerId)!;
      const trackOf = (p: typeof data.project, property: AnimationProperty) =>
        layerOf(p).animationClip!.tracks.find((t) => t.target.partId === partId && t.property === property);

      // Case A + Case B:
      // - rotationDeg: 0 -> 500 (terminal key at 500ms with pre-existing 'step')
      // - offsetX: 0 -> 500 -> 1000 (real outgoing interval at 500ms)
      // - scaleX: 0 -> 1500 (spans across 500ms with no key at 500ms)
      let project = service.apply(data.project, { ...baseTarget, timeMs: 500, autoKey: true }, {
        'transform.rotationDeg': 30,
        'transform.offsetX': 20,
      });
      project = service.apply(project, { ...baseTarget, timeMs: 1000, autoKey: true }, {
        'transform.offsetX': 60,
      });
      project = service.apply(project, { ...baseTarget, timeMs: 1500, autoKey: true }, {
        'transform.scaleX': 1.5,
      });
      // Simulate a terminal rotationDeg@500 key carrying a non-linear interpolationToNext.
      const withTerminalStep = structuredClone(project);
      trackOf(withTerminalStep, 'transform.rotationDeg')!.keys.find((k) => k.timeMs === 500)!.interpolationToNext =
        'step';

      expect(hasCompositeKeyOutgoingInterval(layerOf(withTerminalStep), partId, 500)).toBe(true);
      expect(characterCompositeKeyEasing(layerOf(withTerminalStep), partId, 500)).toBe('linear');

      const updated = service.setCompositeKeyEasing(withTerminalStep, {
        ...baseTarget,
        timeMs: 500,
        interpolationToNext: 'ease-in-out',
      });
      expect(trackOf(updated, 'transform.offsetX')!.keys.find((k) => k.timeMs === 500)?.interpolationToNext).toBe(
        'ease-in-out',
      );
      expect(trackOf(updated, 'transform.rotationDeg')!.keys.find((k) => k.timeMs === 500)?.interpolationToNext).toBe(
        'step',
      );
      expect(trackOf(updated, 'transform.scaleX')!.keys.map((k) => k.timeMs)).toEqual([0, 1500]);
      expect(trackOf(updated, 'transform.offsetY')).toBeUndefined();
      expect(trackOf(updated, 'transform.scaleY')).toBeUndefined();

      // No-op when real outgoing intervals already equal the requested interpolation.
      const noop = service.setCompositeKeyEasing(updated, {
        ...baseTarget,
        timeMs: 500,
        interpolationToNext: 'ease-in-out',
      });
      expect(noop).toBe(updated);

      // Mixed outgoing intervals (offsetX='ease-in-out', offsetY='step') aggregate to null.
      let mixed = service.apply(updated, { ...baseTarget, timeMs: 500, autoKey: true }, { 'transform.offsetY': 10 });
      mixed = service.apply(mixed, { ...baseTarget, timeMs: 1000, autoKey: true }, { 'transform.offsetY': 40 });
      trackOf(mixed, 'transform.offsetY')!.keys.find((k) => k.timeMs === 500)!.interpolationToNext = 'step';
      expect(hasCompositeKeyOutgoingInterval(layerOf(mixed), partId, 500)).toBe(true);
      expect(characterCompositeKeyEasing(layerOf(mixed), partId, 500)).toBeNull();

      // Case C: Composite Key exists at 500ms only on terminal rotationDeg (0 -> 500), while offsetX has 0 -> 1000.
      let caseC = service.apply(data.project, { ...baseTarget, timeMs: 500, autoKey: true }, {
        'transform.rotationDeg': 25,
      });
      caseC = service.apply(caseC, { ...baseTarget, timeMs: 1000, autoKey: true }, {
        'transform.offsetX': 50,
      });
      const snapshotBefore = structuredClone(caseC);
      expect(characterCompositeKeyTimes(layerOf(caseC), partId)).toEqual([0, 500, 1000]);
      expect(hasCompositeKeyOutgoingInterval(layerOf(caseC), partId, 500)).toBe(false);
      expect(characterCompositeKeyEasing(layerOf(caseC), partId, 500)).toBeNull();
      expect(() =>
        service.setCompositeKeyEasing(caseC, { ...baseTarget, timeMs: 500, interpolationToNext: 'ease-in' }),
      ).toThrow(/没有可修改的补间区间/);
      expect(caseC).toEqual(snapshotBefore);
    },
  );
});
