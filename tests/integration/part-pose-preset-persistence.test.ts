import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CharacterService,
  LayerService,
  PartPoseActionPresetService,
  PartPoseAnimationService,
  ProjectSchema,
  ShotService,
  evaluatePartPoseAnimationAtTime,
  type Project,
} from '../../src/domain';
import { ProjectService } from '../../src/main/services/ProjectService';
import { adaptivePartsFixture } from '../helpers/adaptivePartsFixtures';
import { buildProject, IDS } from '../unit/domain/testProject';

const temporaryParents: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryParents.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

function authoredArmRotation(
  project: Project,
  shotId: string,
  layerId: string,
  timeMs: number,
): number {
  const layer = project.shots
    .find((candidate) => candidate.id === shotId)!
    .layers.find((candidate) => candidate.id === layerId)!;
  const animation = layer.poseAnimation!;
  const arm = animation.tracks.find((track) => track.keys.length > 1)!;
  return evaluatePartPoseAnimationAtTime(animation, timeMs).find(
    (pose) => pose.partId === arm.partId,
  )!.rotationDeg;
}

describe('Part pose action preset persistence', () => {
  it('saves a preset, applies it to another instance, and survives save/reopen with an independent trajectory', async () => {
    const parent = await mkdtemp(
      path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-pose-preset-'),
    );
    temporaryParents.push(parent);
    const projectRoot = path.join(parent, 'Pose Preset.pandastage');
    const projectService = new ProjectService();
    const created = await projectService.create(projectRoot, {
      name: 'Pose Preset',
    });
    let project = ProjectSchema.parse({
      ...buildProject(),
      id: created.project.id,
      name: created.project.name,
      createdAt: created.project.createdAt,
      updatedAt: created.project.updatedAt,
    });
    project = new CharacterService().createAdaptiveParts(project, {
      name: 'Preset Character',
      sourceRootTransform: {
        a: -1,
        b: 0.15,
        c: 0.25,
        d: 1,
        tx: 790,
        ty: 47.6,
      },
      parts: adaptivePartsFixture(IDS.assetChar),
    });
    const character = project.characters.at(-1)!;
    if (character.mode !== 'adaptive-parts') {
      throw new Error('Expected an Adaptive Parts Character.');
    }
    const sourcePlaced = new LayerService().createFromAdaptiveCharacter(
      project,
      IDS.shot,
      character.id,
      { x: 960, y: 540 },
    );
    project = sourcePlaced.project;

    // Author 0 -> raise -> lower on the source instance.
    const poses = new PartPoseAnimationService();
    const arm = character.parts[0]!.partId;
    project = poses.create(project, {
      shotId: IDS.shot,
      layerId: sourcePlaced.layer.id,
    });
    project = poses.setKeyframe(project, {
      shotId: IDS.shot,
      layerId: sourcePlaced.layer.id,
      partId: arm,
      keyframe: {
        timeMs: 1_000,
        offsetX: 0,
        offsetY: 0,
        rotationDeg: 90,
        scale: 1,
        easingToNext: 'ease-in-out',
      },
    });

    const presets = new PartPoseActionPresetService();
    project = presets.save(project, {
      shotId: IDS.shot,
      layerId: sourcePlaced.layer.id,
      name: '抬手',
    });
    expect(project.partPosePresets).toHaveLength(1);

    // Second instance of the same Character in a new Shot applies the preset.
    project = new ShotService().create(project, {
      name: '镜头二',
      durationMs: 3_000,
    });
    const secondShot = project.shots.at(-1)!;
    const targetPlaced = new LayerService().createFromAdaptiveCharacter(
      project,
      secondShot.id,
      character.id,
      { x: 960, y: 540 },
    );
    project = targetPlaced.project;
    const presetId = project.partPosePresets![0]!.id;
    project = presets.apply(project, {
      shotId: secondShot.id,
      layerId: targetPlaced.layer.id,
      presetId,
    });
    const sourceRotationAt500 = authoredArmRotation(
      project,
      IDS.shot,
      sourcePlaced.layer.id,
      500,
    );
    expect(authoredArmRotation(project, secondShot.id, targetPlaced.layer.id, 500)).toBe(
      sourceRotationAt500,
    );

    // The applied trajectory stays independently editable after reopening.
    await projectService.save(projectRoot, project, 1);
    const reopened = await projectService.open(projectRoot);
    expect(reopened.project.schemaVersion).toBe(project.schemaVersion);
    expect(reopened.project.partPosePresets).toEqual(project.partPosePresets);
    expect(
      authoredArmRotation(reopened.project, secondShot.id, targetPlaced.layer.id, 500),
    ).toBe(sourceRotationAt500);

    const edited = poses.setKeyframe(reopened.project, {
      shotId: secondShot.id,
      layerId: targetPlaced.layer.id,
      partId: arm,
      keyframe: {
        timeMs: 1_000,
        offsetX: 0,
        offsetY: 0,
        rotationDeg: 30,
        scale: 1,
        easingToNext: 'ease-in-out',
      },
    });
    expect(
      authoredArmRotation(edited, secondShot.id, targetPlaced.layer.id, 500),
    ).not.toBe(
      authoredArmRotation(edited, IDS.shot, sourcePlaced.layer.id, 500),
    );
    // The reopened source instance and the preset remain untouched.
    expect(
      authoredArmRotation(edited, IDS.shot, sourcePlaced.layer.id, 500),
    ).toBe(sourceRotationAt500);
    expect(edited.partPosePresets).toEqual(reopened.project.partPosePresets);
  });
});
