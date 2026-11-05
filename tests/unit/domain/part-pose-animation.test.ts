import { describe, expect, it } from 'vitest';
import {
  CharacterService,
  LayerService,
  PartPoseAnimationService,
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

function adaptiveProject(): {
  project: Project;
  layerId: string;
  characterId: string;
} {
  const created = new CharacterService().createAdaptiveParts(buildProject(), {
    name: 'Pose Character',
    sourceRootTransform: adaptivePartsSourceRootTransform(),
    parts: adaptivePartsFixture(IDS.assetChar),
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
        frame: 24,
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
        frame: 0,
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
        frame: 24,
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

  it('inserts and replaces sorted keys, protects frame zero, and rejects keys outside the Shot', () => {
    const { project, layerId } = adaptiveProject();
    const service = new PartPoseAnimationService();
    let next = service.create(project, { shotId: IDS.shot, layerId });
    const track = next.shots[0]!.layers.find(
      (layer) => layer.id === layerId,
    )!.poseAnimation!.tracks[0]!;
    const set = (frame: number, rotationDeg: number) =>
      service.setKeyframe(next, {
        shotId: IDS.shot,
        layerId,
        partId: track.partId,
        keyframe: {
          frame,
          offsetX: 0,
          offsetY: 0,
          rotationDeg,
          scale: 1,
          easingToNext: 'linear',
        },
      });

    next = set(48, 360);
    next = set(24, 90);
    next = set(24, 180);
    expect(
      next.shots[0]!.layers.find((layer) => layer.id === layerId)!
        .poseAnimation!.tracks[0]!.keys.map((key) => [key.frame, key.rotationDeg]),
    ).toEqual([
      [0, 0],
      [24, 180],
      [48, 360],
    ]);
    expect(() => set(0, 30)).toThrow(/frame-zero/u);
    expect(() => set(73, 90)).toThrow(/Shot duration/u);
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
          frame: 24,
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
