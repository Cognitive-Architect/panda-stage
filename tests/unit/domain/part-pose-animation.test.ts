import { describe, expect, it } from 'vitest';
import {
  CharacterService,
  LayerService,
  PartPoseAnimationService,
  PartPoseKeyframeSchema,
  PartPoseTrackSchema,
  ProjectSchema,
  evaluateShotAtTime,
  resolveLayerVisualParts,
  scanAssetReferences,
  transformPointByVisualPart,
  type Project,
} from '../../../src/domain';
import {
  adaptivePartsFixture,
  adaptivePartsSourceRootTransform,
} from '../../helpers/adaptivePartsFixtures';
import { buildProject, IDS } from './testProject';

function adaptiveProject(withExternalCroppedPivot = false): {
  project: Project;
  layerId: string;
  characterId: string;
} {
  const parts = adaptivePartsFixture(IDS.assetChar).map((part, index) =>
    withExternalCroppedPivot && index === 0
      ? {
          ...part,
          restTransform: { ...part.restTransform, b: 0.1, c: 0.25 },
          imageMapping: {
            ...part.imageMapping,
            sourceHeight: 800,
            crop: { x: 0, y: 80, width: 640, height: 640 },
          },
        }
      : part,
  );
  const created = new CharacterService().createAdaptiveParts(buildProject(), {
    name: 'Pose Character',
    sourceRootTransform: withExternalCroppedPivot
      ? { a: -1, b: 0.15, c: 0.25, d: 1, tx: 790, ty: 47.6 }
      : adaptivePartsSourceRootTransform(),
    parts,
  });
  const character = created.characters.at(-1)!;
  if (character.mode !== 'adaptive-parts') {
    throw new Error('Expected an Adaptive Parts Character.');
  }
  const placed = new LayerService().createFromAdaptiveCharacter(
    created,
    IDS.shot,
    character.id,
    { x: 960, y: 540 },
  );
  return {
    project: placed.project,
    layerId: placed.layer.id,
    characterId: character.id,
  };
}

function poseAt(project: Project, layerId: string, timeMs: number) {
  const shot = project.shots.find((candidate) => candidate.id === IDS.shot)!;
  const evaluated = evaluateShotAtTime(shot, timeMs, project).layers.find(
    (layer) => layer.id === layerId,
  )!;
  return { shot, evaluated, visual: resolveLayerVisualParts(project, shot, evaluated) };
}

function partById(
  parts: ReturnType<typeof poseAt>['visual']['parts'],
  partId: string,
) {
  return parts.find(
    (part) =>
      part.source.kind === 'adaptive-part' &&
      part.source.characterPartId === partId,
  )!;
}

describe('formal Part pose animation', () => {
  it('accepts a source-space pivot outside crop under mirrored, sheared transforms', () => {
    const { project, layerId, characterId } = adaptiveProject(true);
    const character = project.characters.find(
      (candidate) => candidate.id === characterId,
    );
    if (!character || character.mode !== 'adaptive-parts') {
      throw new Error('Expected an Adaptive Parts Character.');
    }
    const partId = character.parts[0]!.partId;
    const pivotSource = { x: 320, y: 20 };
    const service = new PartPoseAnimationService();
    const captured = service.create(project, {
      shotId: IDS.shot,
      layerId,
      pivotSourceByPartId: { [partId]: pivotSource },
    });
    const track = captured.shots[0]!.layers.find(
      (layer) => layer.id === layerId,
    )!.poseAnimation!.tracks[0]!;
    expect(track.imageMapping.crop).toEqual({
      x: 0,
      y: 80,
      width: 640,
      height: 640,
    });
    expect(pivotSource.y).toBeLessThan(track.imageMapping.crop.y);
    expect(track.pivotSource).toEqual(pivotSource);

    const animated = service.setKeyframe(captured, {
      shotId: IDS.shot,
      layerId,
      partId,
      keyframe: {
        timeMs: 1_000,
        offsetX: 0,
        offsetY: 0,
        rotationDeg: 90,
        scale: 1,
        easingToNext: 'linear',
      },
    });
    const pointInCroppedAsset = {
      x: (pivotSource.x - track.imageMapping.crop.x) * track.imageMapping.exportScale,
      y: (pivotSource.y - track.imageMapping.crop.y) * track.imageMapping.exportScale,
    };
    const before = transformPointByVisualPart(
      pointInCroppedAsset,
      partById(poseAt(captured, layerId, 0).visual.parts, partId),
    );
    const during = transformPointByVisualPart(
      pointInCroppedAsset,
      partById(poseAt(animated, layerId, 500).visual.parts, partId),
    );
    expect(during.x).toBeCloseTo(before.x, 8);
    expect(during.y).toBeCloseTo(before.y, 8);

    expect(() =>
      service.create(project, {
        shotId: IDS.shot,
        layerId,
        pivotSourceByPartId: { [partId]: { x: 641, y: 20 } },
      }),
    ).toThrow(/uncropped source image bounds/u);
    expect(() =>
      service.create(project, {
        shotId: IDS.shot,
        layerId,
        pivotSourceByPartId: { [partId]: { x: Number.POSITIVE_INFINITY, y: 20 } },
      }),
    ).toThrow();
  });

  it('persists only unique integer timeMs values on the 24 FPS grid', () => {
    const { project, layerId } = adaptiveProject();
    const captured = new PartPoseAnimationService().create(project, {
      shotId: IDS.shot,
      layerId,
    });
    const track = captured.shots[0]!.layers.find(
      (layer) => layer.id === layerId,
    )!.poseAnimation!.tracks[0]!;
    const keyframe = (timeMs: number) => ({
      timeMs,
      offsetX: 0,
      offsetY: 0,
      rotationDeg: 0,
      scale: 1,
      easingToNext: 'linear' as const,
    });

    expect([0, 250, 500, 750, 1_000].map((timeMs) =>
      PartPoseKeyframeSchema.parse(keyframe(timeMs)).timeMs,
    )).toEqual([0, 250, 500, 750, 1_000]);
    for (const timeMs of [43, 43.5, -1]) {
      expect(PartPoseKeyframeSchema.safeParse(keyframe(timeMs)).success).toBe(false);
    }
    expect(
      PartPoseKeyframeSchema.safeParse({ ...keyframe(0), frame: 0 }).success,
    ).toBe(false);
    expect(
      PartPoseTrackSchema.safeParse({
        ...track,
        keys: [{ ...track.keys[0]!, timeMs: 42 }],
      }).success,
    ).toBe(false);
    expect(
      PartPoseTrackSchema.safeParse({
        ...track,
        keys: [track.keys[0]!, { ...track.keys[0]! }],
      }).success,
    ).toBe(false);
  });

  it('captures a static Adaptive Parts snapshot and resolves continuous 0-to-270 degree rotation', () => {
    const { project: base, layerId } = adaptiveProject();
    const initial = poseAt(base, layerId, 0).visual;
    const service = new PartPoseAnimationService();
    const captured = service.create(base, { shotId: IDS.shot, layerId });
    const capturedVisual = poseAt(captured, layerId, 0).visual;
    expect(capturedVisual.parts.map((part) => part.imageTransform)).toEqual(
      initial.parts.map((part) => part.imageTransform),
    );

    const track = captured.shots[0]!.layers.find(
      (layer) => layer.id === layerId,
    )!.poseAnimation!.tracks[0]!;
    const animated = service.setKeyframe(captured, {
      shotId: IDS.shot,
      layerId,
      partId: track.partId,
      keyframe: {
        timeMs: 1_000,
        offsetX: 0,
        offsetY: 0,
        rotationDeg: 270,
        scale: 1,
        easingToNext: 'linear',
      },
    });

    const atZero = poseAt(animated, layerId, 0).visual;
    const halfway = poseAt(animated, layerId, 500).visual;
    const atKey = poseAt(animated, layerId, 1_000).visual;
    const startPart = partById(atZero.parts, track.partId);
    const halfwayPart = partById(halfway.parts, track.partId);
    const keyPart = partById(atKey.parts, track.partId);
    expect(halfwayPart.imageTransform!.a).toBeCloseTo(Math.cos((135 * Math.PI) / 180), 8);
    expect(halfwayPart.imageTransform!.b).toBeCloseTo(Math.sin((135 * Math.PI) / 180), 8);
    expect(keyPart.imageTransform!.a).toBeCloseTo(0, 8);
    expect(keyPart.imageTransform!.b).toBeCloseTo(-1, 8);
    expect(startPart.imageTransform).toEqual(partById(initial.parts, track.partId).imageTransform);
    expect(poseAt(animated, layerId, 500).visual).toEqual(halfway);

    const pivot = {
      x: track.imageMapping.crop.width / 2,
      y: track.imageMapping.crop.height / 2,
    };
    const startPivot = transformPointByVisualPart(pivot, startPart);
    const halfwayPivot = transformPointByVisualPart(pivot, halfwayPart);
    expect(halfwayPivot.x).toBeCloseTo(startPivot.x, 8);
    expect(halfwayPivot.y).toBeCloseTo(startPivot.y, 8);
  });

  it('uses the captured source snapshot and fixed center after the Character changes', () => {
    const { project: base, layerId, characterId } = adaptiveProject();
    const service = new PartPoseAnimationService();
    const captured = service.create(base, { shotId: IDS.shot, layerId });
    const before = poseAt(captured, layerId, 0).visual;
    const changedCharacter = ProjectSchema.parse({
      ...captured,
      characters: captured.characters.map((character) =>
        character.id !== characterId || character.mode !== 'adaptive-parts'
          ? character
          : {
              ...character,
              sourceRootTransform: {
                ...character.sourceRootTransform,
                tx: character.sourceRootTransform.tx + 900,
              },
              parts: character.parts.map((part, index) =>
                index === 0
                  ? {
                      ...part,
                      restTransform: {
                        ...part.restTransform,
                        tx: part.restTransform.tx + 500,
                      },
                    }
                  : part,
              ),
            },
      ),
    });

    expect(poseAt(changedCharacter, layerId, 0).visual.parts).toEqual(
      before.parts,
    );
  });

  it('fails closed when a pose Layer receives an incomplete runtime evaluation', () => {
    const { project, layerId } = adaptiveProject();
    const captured = new PartPoseAnimationService().create(project, {
      shotId: IDS.shot,
      layerId,
    });
    const shot = captured.shots[0]!;
    const evaluated = evaluateShotAtTime(shot, 500, captured).layers.find(
      (layer) => layer.id === layerId,
    )!;

    expect(() =>
      resolveLayerVisualParts(captured, shot, {
        ...evaluated,
        partPoses: [],
      }),
    ).toThrow(/incomplete/u);
  });

  it('applies outgoing easing deterministically and keeps the Layer center fixed', () => {
    const { project: base, layerId } = adaptiveProject();
    const service = new PartPoseAnimationService();
    let project = service.create(base, { shotId: IDS.shot, layerId });
    const track = project.shots[0]!.layers.find(
      (layer) => layer.id === layerId,
    )!.poseAnimation!.tracks[0]!;
    project = service.setKeyframe(project, {
      shotId: IDS.shot,
      layerId,
      partId: track.partId,
      keyframe: {
        timeMs: 0,
        offsetX: 0,
        offsetY: 0,
        rotationDeg: 0,
        scale: 1,
        easingToNext: 'ease-in-out',
      },
    });
    project = service.setKeyframe(project, {
      shotId: IDS.shot,
      layerId,
      partId: track.partId,
      keyframe: {
        timeMs: 1_000,
        offsetX: 100,
        offsetY: 0,
        rotationDeg: 270,
        scale: 1,
        easingToNext: 'linear',
      },
    });

    const start = poseAt(project, layerId, 0);
    const quarter = poseAt(project, layerId, 250);
    const midpoint = poseAt(project, layerId, 500);
    const end = poseAt(project, layerId, 1_000);
    const quarterPose = quarter.evaluated.partPoses!.find(
      (pose) => pose.partId === track.partId,
    )!;
    const middlePose = midpoint.evaluated.partPoses!.find(
      (pose) => pose.partId === track.partId,
    )!;
    expect(quarterPose.offsetX).toBeCloseTo(12.5, 8);
    expect(quarterPose.rotationDeg).toBeCloseTo(33.75, 8);
    expect(middlePose.offsetX).toBeCloseTo(50, 8);
    expect(middlePose.rotationDeg).toBeCloseTo(135, 8);
    expect(quarter.visual.ownerTransform.x).toBe(start.visual.ownerTransform.x);
    expect(quarter.visual.ownerTransform.y).toBe(start.visual.ownerTransform.y);
    expect(midpoint.visual.ownerTransform.x).toBe(start.visual.ownerTransform.x);
    expect(midpoint.visual.ownerTransform.y).toBe(start.visual.ownerTransform.y);
    expect(end.evaluated.partPoses!.find((pose) => pose.partId === track.partId))
      .toMatchObject({ offsetX: 100, rotationDeg: 270 });
    expect(poseAt(project, layerId, 250).evaluated.partPoses).toEqual(
      quarter.evaluated.partPoses,
    );
  });

  it('holds every pose component until a step key boundary and holds the last key', () => {
    const { project: base, layerId } = adaptiveProject();
    const service = new PartPoseAnimationService();
    let project = service.create(base, { shotId: IDS.shot, layerId });
    const track = project.shots[0]!.layers.find(
      (layer) => layer.id === layerId,
    )!.poseAnimation!.tracks[0]!;
    project = service.setKeyframe(project, {
      shotId: IDS.shot,
      layerId,
      partId: track.partId,
      keyframe: {
        timeMs: 0,
        offsetX: 10,
        offsetY: -20,
        rotationDeg: 30,
        scale: 1.25,
        easingToNext: 'step',
      },
    });
    project = service.setKeyframe(project, {
      shotId: IDS.shot,
      layerId,
      partId: track.partId,
      keyframe: {
        timeMs: 500,
        offsetX: 100,
        offsetY: 200,
        rotationDeg: 270,
        scale: 2,
        easingToNext: 'linear',
      },
    });

    const poseAtTime = (timeMs: number) =>
      poseAt(project, layerId, timeMs).evaluated.partPoses!.find(
        (pose) => pose.partId === track.partId,
      )!;
    const held = {
      offsetX: 10,
      offsetY: -20,
      rotationDeg: 30,
      scale: 1.25,
    };
    const switched = {
      offsetX: 100,
      offsetY: 200,
      rotationDeg: 270,
      scale: 2,
    };
    for (const timeMs of [0, 1, 250, 499]) {
      expect(poseAtTime(timeMs)).toMatchObject(held);
    }
    expect(poseAtTime(500)).toMatchObject(switched);
    expect(poseAtTime(1_000)).toMatchObject(switched);
    expect(poseAtTime(250)).toEqual(poseAtTime(0));
    expect(poseAtTime(0)).toEqual(poseAtTime(499));
  });

  it('inserts and replaces sorted timeMs keys, allows a non-neutral 0 ms key, and enforces Shot duration', () => {
    const { project, layerId } = adaptiveProject();
    const service = new PartPoseAnimationService();
    let next = service.create(project, { shotId: IDS.shot, layerId });
    const track = next.shots[0]!.layers.find(
      (layer) => layer.id === layerId,
    )!.poseAnimation!.tracks[0]!;
    const set = (timeMs: number, rotationDeg: number) =>
      service.setKeyframe(next, {
        shotId: IDS.shot,
        layerId,
        partId: track.partId,
        keyframe: {
          timeMs,
          offsetX: 0,
          offsetY: 0,
          rotationDeg,
          scale: 1,
          easingToNext: 'linear',
        },
      });

    next = set(2_000, 360);
    next = set(1_000, 90);
    next = set(1_000, 180);
    expect(
      next.shots[0]!.layers.find((layer) => layer.id === layerId)!
        .poseAnimation!.tracks[0]!.keys.map((key) => [key.timeMs, key.rotationDeg]),
    ).toEqual([
      [0, 0],
      [1_000, 180],
      [2_000, 360],
    ]);
    next = set(0, 30);
    expect(
      next.shots[0]!.layers.find((layer) => layer.id === layerId)!
        .poseAnimation!.tracks[0]!.keys[0],
    ).toMatchObject({ timeMs: 0, rotationDeg: 30 });
    expect(() => set(3_042, 90)).toThrow(/Shot duration/u);
  });

  it('tracks snapshot assets so they remain in project reference scans', () => {
    const { project, layerId } = adaptiveProject();
    const captured = new PartPoseAnimationService().create(project, {
      shotId: IDS.shot,
      layerId,
    });
    expect(
      scanAssetReferences(captured, IDS.assetChar).map((reference) => reference.kind),
    ).toContain('pose-animation-part');
  });

  it('rejects a key scale that would make the composed source matrix degenerate', () => {
    const base = buildProject();
    const root = { a: 1e-5, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
    const parts = adaptivePartsFixture(IDS.assetChar).map((part) => ({
      ...part,
      restTransform: { ...part.restTransform, a: 1e-5, d: 1 },
      sourceRestTransform: { ...part.restTransform, a: 1e-5, d: 1 },
    }));
    const created = new CharacterService().createAdaptiveParts(base, {
      name: 'Degenerate Pose Character',
      sourceRootTransform: root,
      parts,
    });
    const character = created.characters.at(-1)!;
    if (character.mode !== 'adaptive-parts') {
      throw new Error('Expected an Adaptive Parts Character.');
    }
    const placed = new LayerService().createFromAdaptiveCharacter(
      created,
      IDS.shot,
      character.id,
      { x: 960, y: 540 },
    );
    const service = new PartPoseAnimationService();
    const captured = service.create(placed.project, {
      shotId: IDS.shot,
      layerId: placed.layer.id,
    });
    const partId = captured.shots[0]!.layers.find(
      (layer) => layer.id === placed.layer.id,
    )!.poseAnimation!.tracks[0]!.partId;
    expect(() =>
      service.setKeyframe(captured, {
        shotId: IDS.shot,
        layerId: placed.layer.id,
        partId,
        keyframe: {
          timeMs: 1_000,
          offsetX: 0,
          offsetY: 0,
          rotationDeg: 0,
          scale: 0.05,
          easingToNext: 'linear',
        },
      }),
    ).toThrow(/degenerate affine transform/u);
  });
});
