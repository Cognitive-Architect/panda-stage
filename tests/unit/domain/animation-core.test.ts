import { describe, expect, it } from 'vitest';
import {
  AnimationClipV0Schema, AnimationKeySchema, AnimationTrackSchema,
  AnimationTargetRefSchema, AnimationPropertySchema, LayerSchema,
  ProjectSchema, ProjectV20Schema, PROJECT_SCHEMA_VERSION,
  evaluateAnimationTrackAtTime, evaluateAnimationClipAtTime, migrateProject,
  editAnimationPropertyKey,
  keySelectedAnimationTargets,
  retimeAnimationPropertyRange,
  type AnimationInterpolation,
} from '../../../src/domain';
import { animationCoreFixture } from '../../helpers/animationCoreFixture';
import { IDS } from './testProject';

describe('Animation Core V0 persisted contract', () => {
  it('moves, scales and extends hold for one property without moving surrounding keys', () => {
    const { project, clip, layerId } = animationCoreFixture();
    const track = clip.tracks[0]!;
    track.keys = [0, 500, 750, 1000, 2000].map((timeMs, index) => ({
      timeMs, value: index * 10, interpolationToNext: 'linear',
    }));
    const layer = project.shots[0]!.layers.find(({ id }) => id === layerId)!;
    layer.animationClip = clip;
    const address = { shotId: IDS.shot, target: track.target, property: track.property };
    const range = { startMs: 500, endMs: 1000 };
    function keys(mode: 'move' | 'scale' | 'hold', frames: number) {
      const edited = retimeAnimationPropertyRange(project, address, { ...range, mode, frames });
      return edited.shots[0]!.layers.find(({ id }) => id === layerId)!.animationClip!.tracks[0]!.keys;
    }
    expect(keys('move', 6).map(({ timeMs }) => timeMs)).toEqual([0, 750, 1000, 1250, 2000]);
    expect(keys('scale', 24).map(({ timeMs }) => timeMs)).toEqual([0, 500, 1000, 1500, 2000]);
    expect(keys('hold', 6).map(({ timeMs, value }) => [timeMs, value])).toEqual([
      [0, 0], [500, 10], [750, 20], [1000, 30], [1250, 30], [2000, 40],
    ]);
    expect(keys('hold', 6)[3]!.interpolationToNext).toBe('step');
    expect(() => keys('scale', 36)).toThrow('遇到其他关键帧');
    expect(track.keys.map(({ timeMs }) => timeMs)).toEqual([0, 500, 750, 1000, 2000]);
  });
  it('inserts one sampled key per selected track while preserving curved and stepped motion', () => {
    const { project, layerId } = animationCoreFixture();
    const layer = project.shots[0]!.layers.find(({ id }) => id === layerId)!;
    const clip = layer.animationClip!;
    const first = clip.tracks[0]!;
    const target = first.target;
    const last = first.keys[1]!.timeMs;
    const at = 250;
    expect(last).toBeGreaterThan(at);
    first.keys[0]!.curveToNext = { bezier: { x1: 0.15, y1: 0.8, x2: 0.65, y2: 0.95 } };
    if (clip.version !== 1 || target.kind !== 'character-part') throw new Error('Expected part clip fixture.');
    clip.tracks.push({ target, property: 'transform.offsetY', keys: [
      { timeMs: 0, value: 15, interpolationToNext: 'step' },
      { timeMs: last, value: 140, interpolationToNext: 'linear' },
    ] });
    const second = { ...target, partId: '71000000-0000-4000-8000-000000000002' };
    clip.targetBases.push({ ...clip.targetBases[0]!, target: second, drawOrder: 1 });
    clip.tracks.push({ ...clip.tracks[0]!, target: second });
    const skipped = { ...target, partId: IDS.layerAsset };
    const result = keySelectedAnimationTargets(project, IDS.shot, layerId, [target, second, skipped], at);
    expect(result).toMatchObject({ inserted: 3, skipped: 1 });
    const edited = result.project.shots[0]!.layers.find(({ id }) => id === layerId)!.animationClip!;
    for (const time of [last, 18, 239, 250, 294, 0, last + 50]) {
      const before = evaluateAnimationClipAtTime(clip, time);
      const after = evaluateAnimationClipAtTime(edited, time);
      before.forEach((entry, index) => expect(after[index]!.value).toBeCloseTo(entry.value, 4));
    }
    expect(keySelectedAnimationTargets(result.project, IDS.shot, layerId, [target, second], at).project).toBe(result.project);
  });
  it('edits one property Bézier, round-trips it and preserves the strict previous schema', () => {
    const { project, clip, layerId } = animationCoreFixture();
    const propertyTrack = clip.tracks[0]!;
    const address = { shotId: IDS.shot, target: propertyTrack.target, property: propertyTrack.property, keyTimeMs: 0 };
    const data = { ...project, schemaVersion: 32 };
    const migrated = migrateProject(data);
    const before = migrated.shots[0]!.layers.find(({ id }) => id === layerId)!.animationClip!;
    expect(before).toEqual(clip);
    const next = editAnimationPropertyKey(migrated, address, {
      curveToNext: { bezier: { x1: 1 / 3, y1: 0, x2: 2 / 3, y2: 1 / 3 } },
    });
    expect(() => migrateProject({ ...next, schemaVersion: 32 })).toThrow();
    const parsed = migrateProject(JSON.parse(JSON.stringify(next)));
    const track = parsed.shots[0]!.layers.find(({ id }) => id === layerId)!.animationClip!.tracks[0]!;
    const keys = track.keys;
    const from = keys[0]!;
    const to = keys[1]!;
    const halfTime = (from.timeMs + to.timeMs) / 2;
    const p = Math.round(halfTime) / (to.timeMs - from.timeMs);
    expect(evaluateAnimationTrackAtTime(track, halfTime)).toBeCloseTo(from.value + (to.value - from.value) * p ** 2, 4);
    expect(track.target).toEqual(propertyTrack.target);
    expect(parsed.shots[0]!.layers.find(({ id }) => id === layerId)!.animationClip!.tracks.slice(1)).toEqual(before.tracks.slice(1));
    expect(() => editAnimationPropertyKey(next, address, { timeMs: 42 })).toThrow('起始键固定');
  });
  it('parses the current Project and preserves the full container through JSON', () => {
    const { project, clip } = animationCoreFixture();
    expect(ProjectSchema.parse(JSON.parse(JSON.stringify(project)))).toEqual(project);
    expect(AnimationClipV0Schema.parse(clip)).toEqual(clip);
    expect(clip.tracks[0]).not.toHaveProperty('id');
    expect(clip.tracks[0]!.keys[0]).not.toHaveProperty('id');
  });
  it('persists a Graphic basis with overrides without image aliases', () => {
    const { clip } = animationCoreFixture();
    clip.targetBases[0]!.visualSource = { kind: 'fla-graphic', animationId: IDS.animation };
    expect(AnimationClipV0Schema.parse(clip)).toEqual(clip);
    expect(clip.targetBases[0]!.visualSource).not.toHaveProperty('imageMapping');
  });
  it.each(['asset', 'animation'])('rejects a clip on a %s layer', kind => {
    const { project, clip, layerId } = animationCoreFixture();
    const layer = project.shots[0]!.layers.find(l => l.id === layerId)!;
    const source = kind === 'asset' ? { kind, assetId: IDS.assetBg } : { kind, animationId: IDS.animation };
    expect(LayerSchema.safeParse({ ...layer, source, animationClip: clip,
      ...(kind === 'animation' ? { startTimeMs: 0, animationPlayback: { mode: 'once', endBehavior: 'hold' } } : {}),
    }).success).toBe(false);
  });
  it('rejects non-Adaptive Character ownership', () => {
    const { project, clip } = animationCoreFixture();
    const layer = project.shots[0]!.layers.find(l => l.id === IDS.layerChar)!;
    const next = structuredClone(project);
    next.shots[0]!.layers.find(l => l.id === layer.id)!.animationClip = {
      ...clip, targetBases: [], tracks: [],
    };
    expect(ProjectSchema.safeParse(next).success).toBe(false);
  });
  it.each(['targetBases', 'tracks'] as const)('rejects foreign owner in %s', collection => {
    const { project, layerId } = animationCoreFixture();
    const layer = project.shots[0]!.layers.find(l => l.id === layerId)!;
    layer.animationClip![collection][0]!.target.layerId = IDS.layerAsset;
    expect(LayerSchema.safeParse(layer).success).toBe(false);
  });
  it.each(['camera', 'layer', 'prop'])('rejects invalid target kind %s with character-part shape', kind => {
    const { clip } = animationCoreFixture();
    expect(AnimationTargetRefSchema.safeParse({ ...clip.tracks[0]!.target, kind }).success).toBe(false);
  });
  it('accepts layer target without partId', () => {
    expect(AnimationTargetRefSchema.parse({ kind: 'layer', layerId: IDS.layerChar })).toEqual({ kind: 'layer', layerId: IDS.layerChar });
  });
  it('retains UUID identity constraints and disallows extra IDs', () => {
    const { clip } = animationCoreFixture();
    const track = clip.tracks[0]!;
    expect(AnimationTargetRefSchema.safeParse({ ...track.target, partId: '0' }).success).toBe(false);
    expect(AnimationTrackSchema.safeParse({ ...track, id: IDS.layerChar }).success).toBe(false);
    expect(AnimationKeySchema.safeParse({ ...track.keys[0], id: IDS.layerChar }).success).toBe(false);
  });
  it.each(['transform.opacity', 'visibility', 'playback', 'anything'])('rejects property %s', property => {
    expect(AnimationPropertySchema.safeParse(property).success).toBe(false);
  });
  it.each(['transform.offsetX', 'transform.offsetY', 'transform.rotationDeg', 'transform.scaleX', 'transform.scaleY'])('allows property %s', property => {
    expect(AnimationPropertySchema.parse(property)).toBe(property);
  });
  it('rejects duplicate tracks/bases and missing bases, allows different properties', () => {
    const { clip } = animationCoreFixture();
    expect(AnimationClipV0Schema.safeParse({ ...clip, tracks: [...clip.tracks, ...clip.tracks] }).success).toBe(false);
    expect(AnimationClipV0Schema.safeParse({ ...clip, targetBases: [...clip.targetBases, ...clip.targetBases] }).success).toBe(false);
    expect(AnimationClipV0Schema.safeParse({ ...clip, targetBases: [] }).success).toBe(false);
    expect(AnimationClipV0Schema.safeParse({ ...clip, tracks: [...clip.tracks, {
      ...clip.tracks[0], property: 'transform.scaleX',
      keys: clip.tracks[0]!.keys.map(key => ({ ...key, value: 1 })),
    }] }).success).toBe(true);
  });
  it.each([[], [500], [0, 0], [0, 1000, 500]])('rejects missing base or unsorted/duplicate keys %j', (...times) => {
    const { clip } = animationCoreFixture();
    const track = clip.tracks[0]!;
    expect(AnimationTrackSchema.safeParse({ ...track, keys: times.map(timeMs => ({ ...track.keys[0], timeMs })) }).success).toBe(false);
  });
  it.each([-1, 43, 43.5, NaN, Infinity])('rejects invalid persisted time %s', timeMs => {
    expect(AnimationKeySchema.safeParse({ timeMs, value: 0, interpolationToNext: 'linear' }).success).toBe(false);
  });
  it.each([0, 42, 83, 250, 500, 1000])('accepts rounded 24fps grid time %s', timeMs => {
    expect(AnimationKeySchema.safeParse({ timeMs, value: 0, interpolationToNext: 'linear' }).success).toBe(true);
  });
  it.each([NaN, Infinity, -Infinity])('rejects non-finite value %s', value => {
    expect(AnimationKeySchema.safeParse({ timeMs: 0, value, interpolationToNext: 'linear' }).success).toBe(false);
  });
  it('enforces Shot duration and permits a non-neutral protected base', () => {
    const { project, layerId } = animationCoreFixture();
    const track = project.shots[0]!.layers.find(l => l.id === layerId)!.animationClip!.tracks[0]!;
    track.keys[0]!.value = 37;
    expect(ProjectSchema.safeParse(project).success).toBe(true);
    track.keys[1]!.timeMs = 4000;
    expect(ProjectSchema.safeParse(project).success).toBe(false);
  });
});

describe('v20 -> v21 migration', () => {
  it('upgrades only the envelope, preserving Character, Graphic and Background data', () => {
    const { project, layerId } = animationCoreFixture();
    delete project.shots[0]!.layers.find(l => l.id === layerId)!.animationClip;
    const historical = { ...project, schemaVersion: 20 };
    const before = structuredClone(historical);
    expect(ProjectV20Schema.parse(historical)).toEqual(historical);
    expect(migrateProject(historical)).toEqual({ ...historical, schemaVersion: PROJECT_SCHEMA_VERSION });
    expect(historical).toEqual(before);
    expect(migrateProject(migrateProject(historical))).toEqual(migrateProject(historical));
  });
  it.each([17, 18, 19, 20])('keeps v%s reader closed to Core and unpublished pose data', schemaVersion => {
    const { project } = animationCoreFixture();
    expect(() => migrateProject({ ...project, schemaVersion })).toThrow();
    project.shots[0]!.layers.forEach(layer => { delete layer.animationClip; });
    Object.assign(project.shots[0]!.layers[0]!, { poseAnimation: { version: 1, tracks: [] } });
    expect(() => migrateProject({ ...project, schemaVersion })).toThrow();
  });
});

describe('pure absolute-time numeric evaluation (#979 port)', () => {
  it.each<[AnimationInterpolation, number, number]>([
    ['linear', 25, 75], ['ease-in', 6.25, 56.25],
    ['ease-out', 43.75, 93.75], ['ease-in-out', 12.5, 87.5], ['step', 0, 0],
  ])('retains %s easing and outgoing-key behavior', (interpolationToNext, quarter, threeQuarter) => {
    const { clip } = animationCoreFixture();
    const track = clip.tracks[0]!;
    track.keys = [{ timeMs: 0, value: 0, interpolationToNext }, { timeMs: 1000, value: 100, interpolationToNext: 'step' }];
    expect(evaluateAnimationTrackAtTime(track, -100)).toBe(0);
    expect(evaluateAnimationTrackAtTime(track, 0)).toBe(0);
    expect(evaluateAnimationTrackAtTime(track, 250)).toBe(quarter);
    expect(evaluateAnimationTrackAtTime(track, 750)).toBe(threeQuarter);
    expect(evaluateAnimationTrackAtTime(track, 1000)).toBe(100);
    expect(evaluateAnimationTrackAtTime(track, 2000)).toBe(100);
  });
  it('interpolates continuous rotation, repeats and seeks out of order without mutation', () => {
    const { clip } = animationCoreFixture();
    const before = structuredClone(clip);
    const track = clip.tracks[0]!;
    Object.freeze(track.keys[0]); Object.freeze(track.keys[1]); Object.freeze(track.keys); Object.freeze(track);
    for (let index = 0; index < 20; index += 1) expect(evaluateAnimationTrackAtTime(track, 500)).toBe(135);
    const first = evaluateAnimationClipAtTime(clip, 900);
    expect(evaluateAnimationTrackAtTime(track, 250)).toBe(67.5);
    expect(evaluateAnimationClipAtTime(clip, 900)).toEqual(first);
    expect(first).toEqual([{ target: track.target, property: track.property, value: 243 }]);
    expect(clip).toEqual(before);
    if (first[0]!.target.kind === 'character-part') {
      first[0]!.target.partId = IDS.layerChar;
    }
    expect(clip).toEqual(before);
  });
  it('holds single-key tracks and returns one result per track', () => {
    const { clip } = animationCoreFixture();
    clip.tracks[0]!.keys = [{ timeMs: 0, value: -360, interpolationToNext: 'linear' }];
    clip.tracks.push({ ...clip.tracks[0]!, property: 'transform.scaleY' });
    expect(evaluateAnimationClipAtTime(clip, 10000).map(v => v.value)).toEqual([-360, -360]);
    expect(evaluateAnimationClipAtTime({ ...clip, tracks: [] }, 100)).toEqual([]);
  });
});
