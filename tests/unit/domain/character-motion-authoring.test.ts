import { describe, expect, it } from 'vitest';
import {
  CharacterMotionService,
  LayerService,
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

  it.each(['imagePartId', 'graphicPartId'] as const)(
    'plans and atomically shifts multiple Composite Keys on %s preserving spacing, values, easings, sparse tracks, and isolation (#1131)',
    (partField) => {
      const data = characterPartAnimationFixture();
      const placed = new LayerService().createFromAdaptiveCharacter(
        data.project,
        IDS.shot,
        data.characterId,
        { x: 500, y: 500 },
      );
      const partId = data[partField];
      const baseTarget = { shotId: IDS.shot, layerId: data.layerId, partId };
      const layerOf = (project: typeof data.project, layerId = data.layerId) =>
        project.shots[0]!.layers.find((l) => l.id === layerId)!;
      const trackOf = (project: typeof data.project, property: AnimationProperty) =>
        layerOf(project).animationClip!.tracks.find((t) => t.target.partId === partId && t.property === property);

      // Author sparse keys at [0, 500, 1000, 1500, 2500] within a 3000ms Shot.
      let project = service.apply(placed.project, { ...baseTarget, timeMs: 500, autoKey: true }, {
        'transform.offsetX': 20,
        'transform.rotationDeg': 30,
      });
      project = service.apply(project, { ...baseTarget, timeMs: 1000, autoKey: true }, {
        'transform.offsetX': 50,
      });
      project = service.apply(project, { ...baseTarget, timeMs: 1500, autoKey: true }, {
        'transform.rotationDeg': 60,
        'transform.offsetX': 90,
      });
      project = service.apply(project, { ...baseTarget, timeMs: 2500, autoKey: true }, {
        'transform.offsetX': 120,
      });
      project = service.setCompositeKeyEasing(project, {
        ...baseTarget,
        timeMs: 500,
        interpolationToNext: 'ease-in-out',
      });
      project = service.setCompositeKeyEasing(project, {
        ...baseTarget,
        timeMs: 1000,
        interpolationToNext: 'step',
      });

      const snapshotBefore = structuredClone(project);
      expect(characterCompositeKeyTimes(layerOf(project), partId)).toEqual([0, 500, 1000, 1500, 2500]);

      // Shift [500, 1000, 1500] by +250ms -> [750, 1250, 1750], preserving spacing, values, easings, sparse tracks.
      const shiftedForward = service.retimeCompositeKeys(project, {
        ...baseTarget,
        fromTimesMs: [1500, 500, 1000],
        deltaMs: 250,
      });
      expect(characterCompositeKeyTimes(layerOf(shiftedForward), partId)).toEqual([0, 750, 1250, 1750, 2500]);
      expect(trackOf(shiftedForward, 'transform.offsetX')!.keys.map((k) => [k.timeMs, k.value, k.interpolationToNext])).toEqual([
        [0, 0, 'linear'],
        [750, 20, 'ease-in-out'],
        [1250, 50, 'step'],
        [1750, 90, 'linear'],
        [2500, 120, 'linear'],
      ]);
      expect(trackOf(shiftedForward, 'transform.rotationDeg')!.keys.map((k) => [k.timeMs, k.value, k.interpolationToNext])).toEqual([
        [0, 0, 'linear'],
        [750, 30, 'ease-in-out'],
        [1750, 60, 'linear'],
      ]);
      // Unauthored scale/offsetY tracks remain absent (no sparse materialization).
      expect(trackOf(shiftedForward, 'transform.offsetY')).toBeUndefined();
      expect(trackOf(shiftedForward, 'transform.scaleX')).toBeUndefined();
      expect(trackOf(shiftedForward, 'transform.scaleY')).toBeUndefined();
      // Second instance sharing the same Character Definition stays completely untouched.
      expect(layerOf(shiftedForward, placed.layer.id)).toEqual(layerOf(snapshotBefore, placed.layer.id));
      expect(shiftedForward.characters).toEqual(snapshotBefore.characters);

      // Shift backward -125ms -> [625, 1125, 1625].
      const shiftedBack = service.retimeCompositeKeys(shiftedForward, {
        ...baseTarget,
        fromTimesMs: [750, 1250, 1750],
        deltaMs: -125,
      });
      expect(characterCompositeKeyTimes(layerOf(shiftedBack), partId)).toEqual([0, 625, 1125, 1625, 2500]);

      // Frame-based shift preserves 24fps grid & exact frame spacing even at odd-ms adjacent frames [42, 83].
      let fineProject = service.apply(data.project, { ...baseTarget, timeMs: 42, autoKey: true }, { 'transform.offsetX': 5 });
      fineProject = service.apply(fineProject, { ...baseTarget, timeMs: 83, autoKey: true }, { 'transform.offsetX': 10 });
      const shiftedOneFrame = service.retimeCompositeKeys(fineProject, {
        ...baseTarget,
        fromTimesMs: [42, 83],
        deltaFrames: 1,
      });
      expect(characterCompositeKeyTimes(layerOf(shiftedOneFrame), partId)).toEqual([0, 83, 125]);

      // No-op returns exact identical project reference.
      expect(service.planCompositeKeysRetime(project, { ...baseTarget, fromTimesMs: [500, 1000], deltaMs: 0 }).changed).toBe(false);
      expect(service.retimeCompositeKeys(project, { ...baseTarget, fromTimesMs: [500, 1000], deltaMs: 0 })).toBe(project);
      expect(service.retimeCompositeKeys(project, { ...baseTarget, fromTimesMs: [500, 1000], deltaFrames: 0 })).toBe(project);

      // Whole-batch atomic rejections: any single invalid candidate rejects the whole batch with Project untouched.
      const rejectingInputs = [
        { fromTimesMs: [], deltaMs: 250, match: /选择/ },
        { fromTimesMs: [500, 500], deltaMs: 250, match: /重复/ },
        { fromTimesMs: [0, 500], deltaMs: 250, match: /0 秒/ },
        { fromTimesMs: [500, 1000], deltaMs: -500, match: /0 秒/ },
        { fromTimesMs: [500, 1000], deltaMs: 100, match: /帧网格/ },
        { fromTimesMs: [500, 1000], deltaMs: 500, match: /目标时间已存在动作关键帧/ },
        { fromTimesMs: [500, 1500], deltaMs: 500, match: /目标时间已存在动作关键帧/ },
        { fromTimesMs: [500, 1000], deltaMs: 1500, match: /越过/ },
        { fromTimesMs: [1500, 2500], deltaMs: 750, match: /镜头时长/ },
        { fromTimesMs: [500, 750], deltaMs: 250, match: /找不到/ },
      ] as const;
      for (const bad of rejectingInputs) {
        expect(() => service.retimeCompositeKeys(project, { ...baseTarget, ...bad })).toThrow(bad.match);
      }
      expect(project).toEqual(snapshotBefore);
    },
  );
});
