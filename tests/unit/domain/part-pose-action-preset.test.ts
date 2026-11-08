import { describe, expect, it } from 'vitest';
import {
  CharacterService,
  LayerService,
  PartPoseActionPresetService,
  PartPoseAnimationService,
  ProjectSchema,
  ShotService,
  evaluatePartPoseAnimationAtTime,
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
    name: 'Preset Character',
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

function secondInstanceOfSameCharacter(
  project: Project,
  characterId: string,
  durationMs = 3_000,
): { project: Project; layerId: string; shotId: string } {
  const shots = new ShotService();
  const withShot = shots.create(project, {
    name: '镜头二',
    durationMs,
  });
  const shot = withShot.shots.at(-1)!;
  const placed = new LayerService().createFromAdaptiveCharacter(
    withShot,
    shot.id,
    characterId,
    { x: 960, y: 540 },
  );
  return { project: placed.project, layerId: placed.layer.id, shotId: shot.id };
}

function authoredMotion(
  project: Project,
  shotId: string,
  layerId: string,
): Project {
  const pose = new PartPoseAnimationService();
  const captured = pose.create(project, { shotId, layerId });
  const arm = captured.characters
    .find((character) => character.mode === 'adaptive-parts')!
    .parts.map((part) => part.partId)[0]!;
  const withKey = pose.setKeyframe(captured, {
    shotId,
    layerId,
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
  return pose.setKeyframe(withKey, {
    shotId,
    layerId,
    partId: arm,
    keyframe: {
      timeMs: 2_000,
      offsetX: 0,
      offsetY: 0,
      rotationDeg: 0,
      scale: 1,
      easingToNext: 'linear',
    },
  });
}

function authoredPartId(project: Project): string {
  return project.characters
    .find((character) => character.mode === 'adaptive-parts')!
    .parts.map((part) => part.partId)[0]!;
}

function rotationAt(
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

describe('PartPoseActionPresetService', () => {
  it('refuses to save before any Part pose is authored and refuses duplicate names', () => {
    const service = new PartPoseActionPresetService();
    const { project, layerId } = adaptiveProject();
    const captured = new PartPoseAnimationService().create(project, {
      shotId: IDS.shot,
      layerId,
    });

    expect(() =>
      service.save(captured, {
        shotId: IDS.shot,
        layerId,
        name: '抬手',
      }),
    ).toThrow(/Author at least one Part keyframe/);

    const animated = authoredMotion(project, IDS.shot, layerId);
    const saved = service.save(animated, {
      shotId: IDS.shot,
      layerId,
      name: '抬手',
    });
    expect(() =>
      service.save(saved, {
        shotId: IDS.shot,
        layerId,
        name: ' 抬手 ',
      }),
    ).toThrow(/already exists/);
    expect(() =>
      service.save(animated, {
        shotId: IDS.shot,
        layerId,
        name: '   ',
      }),
    ).toThrow(/must not be empty/);
    expect(saved.partPosePresets).toHaveLength(1);
    expect(saved.partPosePresets![0]!.name).toBe('抬手');
  });

  it('captures relative motion, applies it to another instance as an independent editable trajectory, and keeps the source untouched', () => {
    const service = new PartPoseActionPresetService();
    const { project, layerId: sourceLayerId, characterId } = adaptiveProject();
    const animated = authoredMotion(project, IDS.shot, sourceLayerId);
    const saved = service.save(animated, {
      shotId: IDS.shot,
      layerId: sourceLayerId,
      name: '抬手',
    });
    const preset = saved.partPosePresets![0]!;
    expect(preset.characterId).toBe(characterId);
    expect(preset.durationMs).toBe(2_000);
    const armPreset = preset.tracks.find(
      (track) => track.partId === authoredPartId(saved),
    )!;
    expect(armPreset.keys.map((key) => key.timeMs)).toEqual([0, 1_000, 2_000]);
    // Only references and parameters are stored; no image or FLA frame data.
    expect(armPreset).not.toHaveProperty('source');
    expect(armPreset).not.toHaveProperty('imageMapping');

    const target = secondInstanceOfSameCharacter(saved, characterId);
    const applied = service.apply(target.project, {
      shotId: target.shotId,
      layerId: target.layerId,
      presetId: preset.id,
    });
    const targetLayer = applied.shots
      .find((candidate) => candidate.id === target.shotId)!
      .layers.find((candidate) => candidate.id === target.layerId)!;
    const targetArm = targetLayer.poseAnimation!.tracks.find(
      (track) => track.partId === armPreset.partId,
    )!;
    expect(targetArm.keys).toEqual(armPreset.keys);
    expect(targetArm.pivotSource).toEqual(armPreset.pivotSource);
    // The trajectory is the target's own snapshot: fresh object identity.
    expect(targetArm.sourceRestTransform).toEqual(armPreset.sourceRestTransform);

    // Same relative moment, same pose on both instances.
    expect(
      rotationAt(applied, target.shotId, target.layerId, 1_000),
    ).toBe(rotationAt(saved, IDS.shot, sourceLayerId, 1_000));

    // Editing the applied trajectory does not touch the source instance or preset.
    const pose = new PartPoseAnimationService();
    const edited = pose.setKeyframe(applied, {
      shotId: target.shotId,
      layerId: target.layerId,
      partId: armPreset.partId,
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
      rotationAt(edited, target.shotId, target.layerId, 1_000),
    ).not.toBe(rotationAt(edited, IDS.shot, sourceLayerId, 1_000));
    const sourceArm = edited.shots
      .find((candidate) => candidate.id === IDS.shot)!
      .layers.find((candidate) => candidate.id === sourceLayerId)!
      .poseAnimation!.tracks.find(
        (track) => track.partId === armPreset.partId,
      )!;
    expect(
      sourceArm.keys.find((key) => key.timeMs === 1_000)!.rotationDeg,
    ).toBe(90);
    expect(edited.partPosePresets).toEqual(applied.partPosePresets);

    // Undoing the apply (reverting the Project) restores the target exactly.
    const reverted = ProjectSchema.parse(target.project);
    expect(
      reverted.shots
        .find((candidate) => candidate.id === target.shotId)!
        .layers.find((candidate) => candidate.id === target.layerId)!
        .poseAnimation,
    ).toBeUndefined();
  });

  it('refuses the whole apply for foreign characters, existing poses, short shots, missing parts and changed rest poses', () => {
    const service = new PartPoseActionPresetService();
    const { project, layerId: sourceLayerId, characterId } = adaptiveProject();
    const animated = authoredMotion(project, IDS.shot, sourceLayerId);
    const saved = service.save(animated, {
      shotId: IDS.shot,
      layerId: sourceLayerId,
      name: '抬手',
    });
    const preset = saved.partPosePresets![0]!;

    // A different Adaptive Parts Character instance.
    const other = new CharacterService().createAdaptiveParts(saved, {
      name: '其他人物',
      sourceRootTransform: adaptivePartsSourceRootTransform(),
      parts: adaptivePartsFixture(IDS.assetChar).slice(0, 1),
    });
    const otherCharacter = other.characters.at(-1)!;
    if (otherCharacter.mode !== 'adaptive-parts') {
      throw new Error('Expected an Adaptive Parts Character.');
    }
    const otherPlaced = new LayerService().createFromAdaptiveCharacter(
      other,
      IDS.shot,
      otherCharacter.id,
      { x: 480, y: 540 },
    );
    expect(() =>
      service.apply(otherPlaced.project, {
        shotId: IDS.shot,
        layerId: otherPlaced.layer.id,
        presetId: preset.id,
      }),
    ).toThrow(/different Character/);

    // Target already carries pose animation.
    const sameAgain = secondInstanceOfSameCharacter(saved, characterId);
    const posed = new PartPoseAnimationService().create(sameAgain.project, {
      shotId: sameAgain.shotId,
      layerId: sameAgain.layerId,
    });
    expect(() =>
      service.apply(posed, {
        shotId: sameAgain.shotId,
        layerId: sameAgain.layerId,
        presetId: preset.id,
      }),
    ).toThrow(/already has Part pose animation/);

    // Shot too short for the relative motion.
    const shortShot = secondInstanceOfSameCharacter(saved, characterId, 1_000);
    expect(() =>
      service.apply(shortShot.project, {
        shotId: shortShot.shotId,
        layerId: shortShot.layerId,
        presetId: preset.id,
      }),
    ).toThrow(/shorter than the preset motion/);

    // Preset references a Part the Character no longer has.
    const missingPartPreset = {
      ...preset,
      tracks: [
        {
          ...preset.tracks[0]!,
          partId: 'vanished-part',
        },
      ],
    };
    const missingPart = ProjectSchema.parse({
      ...saved,
      partPosePresets: [missingPartPreset],
    });
    const missingTarget = secondInstanceOfSameCharacter(
      missingPart,
      characterId,
    );
    expect(() =>
      service.apply(missingTarget.project, {
        shotId: missingTarget.shotId,
        layerId: missingTarget.layerId,
        presetId: preset.id,
      }),
    ).toThrow(/missing Part/);

    // The rest pose the deltas were authored against has changed.
    const driftedPreset = {
      ...preset,
      tracks: preset.tracks.map((track) => ({
        ...track,
        sourceRestTransform: {
          ...track.sourceRestTransform,
          tx: track.sourceRestTransform.tx + 12,
        },
      })),
    };
    const drifted = ProjectSchema.parse({
      ...saved,
      partPosePresets: [driftedPreset],
    });
    const driftedTarget = secondInstanceOfSameCharacter(drifted, characterId);
    expect(() =>
      service.apply(driftedTarget.project, {
        shotId: driftedTarget.shotId,
        layerId: driftedTarget.layerId,
        presetId: preset.id,
      }),
    ).toThrow(/rest pose changed/);

    // Nothing above mutated the stored presets.
    expect(otherPlaced.project.partPosePresets).toEqual(saved.partPosePresets);
  });

  it('deletes presets and refuses unknown ids', () => {
    const service = new PartPoseActionPresetService();
    const { project, layerId } = adaptiveProject();
    const animated = authoredMotion(project, IDS.shot, layerId);
    const saved = service.save(animated, {
      shotId: IDS.shot,
      layerId,
      name: '抬手',
    });
    const preset = saved.partPosePresets![0]!;
    const removed = service.delete(saved, { presetId: preset.id });
    expect(removed.partPosePresets).toEqual([]);
    // delete is a pure function: the unknown-id refusal must be observed on
    // the project that no longer carries the preset.
    expect(() => service.delete(removed, { presetId: preset.id })).toThrow(
      /no longer exists/,
    );
  });
});
