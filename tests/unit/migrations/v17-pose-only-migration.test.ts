import { describe, expect, it } from 'vitest';
import {
  CharacterService,
  LayerService,
  PROJECT_SCHEMA_VERSION,
  PartPoseAnimationService,
  ProjectSchema,
  ProjectV17Schema,
  migrateProject,
  type Project,
} from '../../../src/domain';
import { adaptivePartsFixture, adaptivePartsSourceRootTransform } from '../../helpers/adaptivePartsFixtures';
import { IDS, buildProject, legacyShots } from '../domain/testProject';

const STATIC_CAMERA = { mode: 'static', keyframes: [] };

/**
 * Builds a real Adaptive Parts Character with an authored Part pose track so
 * the v17 fixture below carries the C5-KF increment rather than a hand-written
 * shape that could drift from the service contract.
 */
function projectWithPartPose(): { project: Project; layerId: string } {
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
  const posed = new PartPoseAnimationService().create(placed.project, {
    shotId: IDS.shot,
    layerId: placed.layer.id,
    pivotSourceByPartId: {
      [character.parts[0]!.partId]: { x: 36, y: 36 },
    },
  });
  return { project: posed, layerId: placed.layer.id };
}

function poseAnimationOf(project: Project, layerId: string) {
  const shot = project.shots.find((candidate) => candidate.id === IDS.shot)!;
  return shot.layers.find((layer) => layer.id === layerId)!.poseAnimation!;
}

describe('v17 envelopes from two independent branches both reach v18', () => {
  it('upgrades a pose-only v17 project without losing the pose track', () => {
    const { project, layerId } = projectWithPartPose();
    const originalPose = poseAnimationOf(project, layerId);

    // The C5-KF v17 envelope predates the project-local Shot template list, so
    // the key is absent rather than empty.
    const {
      shotTemplates: _shotTemplates,
      partPosePresets: _partPosePresets,
      ...poseOnlyV17
    } = project;
    void _shotTemplates;
    void _partPosePresets;

    const version17 = {
      ...poseOnlyV17,
      schemaVersion: 17 as const,
      shots: legacyShots(project.shots),
    };
    expect('shotTemplates' in version17).toBe(false);

    const migrated = migrateProject(version17);

    expect(migrated.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(migrated.shotTemplates).toEqual([]);
    expect(migrated.partPosePresets).toBeUndefined();
    expect(poseAnimationOf(migrated, layerId)).toEqual(originalPose);
    expect(
      migrated.shots.find((shot) => shot.id === IDS.shot)!.camera,
    ).toEqual(STATIC_CAMERA);
    expect(ProjectSchema.parse(migrated)).toEqual(migrated);
  });

  it('upgrades a template-only v17 project without losing its templates', () => {
    const current = buildProject();
    const source = current.shots[0]!;
    const template = {
      id: '90000000-0000-4000-8000-0000000000a1',
      name: '双人对话模板',
      createdAt: '2026-01-02T00:00:00.000Z',
      durationMs: 3_000,
      defaultSubtitleStyleId: source.defaultSubtitleStyleId,
      layers: source.layers,
      backgroundLayerId: source.backgroundLayerId,
      timelineEvents: [],
    };
    const version17 = {
      ...current,
      schemaVersion: 17 as const,
      shots: legacyShots(current.shots),
      shotTemplates: [template],
    };
    expect(ProjectV17Schema.safeParse(version17).success).toBe(true);

    const migrated = migrateProject(version17);

    expect(migrated.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(migrated.shotTemplates).toEqual([template]);
    expect(migrated.shots[0]!.camera).toEqual(STATIC_CAMERA);
    expect(ProjectSchema.parse(migrated)).toEqual(migrated);
  });

  it('still rejects a malformed v17 envelope instead of completing it', () => {
    const current = buildProject();
    const malformed = {
      ...current,
      schemaVersion: 17 as const,
      shots: legacyShots(current.shots).map((shot) => ({
        ...shot,
        smuggle: 'not a v17 field',
      })),
    };

    expect(() => migrateProject(malformed)).toThrow();
  });

  it('rejects a v17 envelope whose Shot template list is not an array', () => {
    const current = buildProject();
    const malformed = {
      ...current,
      schemaVersion: 17 as const,
      shots: legacyShots(current.shots),
      shotTemplates: 'not-a-list',
    };

    expect(() => migrateProject(malformed)).toThrow();
  });
});
