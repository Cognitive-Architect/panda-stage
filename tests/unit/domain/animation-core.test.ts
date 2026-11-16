import { describe, expect, it } from 'vitest';
import {
  AnimationClipV0Schema, AnimationKeySchema, AnimationTrackSchema,
  AnimationTargetRefSchema, AnimationPropertySchema, LayerSchema,
  ProjectSchema, ProjectV20Schema, PROJECT_SCHEMA_VERSION,
  evaluateAnimationTrackAtTime, evaluateAnimationClipAtTime, migrateProject,
  type AnimationInterpolation,
} from '../../../src/domain';
import { animationCoreFixture } from '../../helpers/animationCoreFixture';
import { IDS } from './testProject';

describe('Animation Core V0 persisted contract', () => {
  it('parses v21 and preserves the full container through JSON', () => {
    const { project, clip } = animationCoreFixture();
    expect(PROJECT_SCHEMA_VERSION).toBe(21);
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
  it.each(['camera', 'layer', 'prop'])('rejects target kind %s', kind => {
    const { clip } = animationCoreFixture();
    expect(AnimationTargetRefSchema.safeParse({ ...clip.tracks[0]!.target, kind }).success).toBe(false);
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
    expect(AnimationClipV0Schema.safeParse({ ...clip, tracks: [...clip.tracks, { ...clip.tracks[0], property: 'transform.scaleX' }] }).success).toBe(true);
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
    expect(migrateProject(historical)).toEqual({ ...historical, schemaVersion: 21 });
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
    first[0]!.target.partId = IDS.layerChar;
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
