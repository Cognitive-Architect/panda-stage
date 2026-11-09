import { describe, expect, it } from 'vitest';
import {
  PROJECT_SCHEMA_VERSION,
  ProjectSchema,
  ProjectV13Schema,
  ProjectV14Schema,
  ProjectV15Schema,
  ProjectV15AdaptiveSchema,
  ProjectV16Schema,
  migrateProject,
  type Project,
} from '../../../src/domain';
import {
  adaptivePartsFixture,
  adaptivePartsSourceRootTransform,
} from '../../helpers/adaptivePartsFixtures';
import {
  IDS,
  buildProject,
  buildProjectWithAnimation,
  legacyShot,
  legacyShots,
} from '../domain/testProject';

/**
 * Legacy envelopes predate the project-local Shot template list (v17) and the
 * user Part pose presets (v18), so every downgraded fixture drops them before
 * the strict per-version parse runs.
 */
function withVersion<
  T extends {
    shotTemplates?: unknown;
    partPosePresets?: unknown;
    schemaVersion?: number;
  },
>(
  project: T,
  schemaVersion: number,
): Omit<T, 'shotTemplates' | 'partPosePresets' | 'schemaVersion'> & {
  schemaVersion: number;
} {
  const {
    shotTemplates: _shotTemplates,
    partPosePresets: _partPosePresets,
    schemaVersion: _schemaVersion,
    ...rest
  } = project;
  void _shotTemplates;
  void _partPosePresets;
  void _schemaVersion;
  return { ...rest, schemaVersion };
}

const STATIC_CAMERA = { mode: 'static', keyframes: [] };

/**
 * Every pre-v18 upgrade destination shares one narrow completion point, so the
 * assertions below are deliberately identical across versions: the picture,
 * the layer stack, the background assignment, the subtitle binding and the
 * audio/dialogue/event payload must all survive, and only the camera track is
 * added.
 */
function expectMigratedShotKeepsItsContent(
  migrated: Project,
  expected: Project,
): void {
  expect(migrated.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
  expect(migrated.shots).toHaveLength(expected.shots.length);
  for (const [index, shot] of migrated.shots.entries()) {
    const source = expected.shots[index]!;
    expect(shot.camera).toEqual(STATIC_CAMERA);
    expect(legacyShot(shot)).toEqual(legacyShot(source));
  }
  expect(migrated.shotTemplates).toEqual([]);
  expect(migrated.partPosePresets).toBeUndefined();
  // Re-validating the migrated object proves it is a genuine current project.
  expect(ProjectSchema.parse(migrated)).toEqual(migrated);
}

/** A real v1 envelope with a populated Shot, layers and a background. */
function legacyV1(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: '10000000-0000-4000-8000-0000000000a1',
    name: '旧版项目',
    width: 1920,
    height: 1080,
    fps: 24,
    assets: [
      {
        id: '10000000-0000-4000-8000-0000000000b1',
        kind: 'image',
        name: '背景',
        relativePath: 'bg.png',
        mimeType: 'image/png',
        width: 1920,
        height: 1080,
      },
      {
        id: '10000000-0000-4000-8000-0000000000b2',
        kind: 'image',
        name: '前景',
        relativePath: 'fg.png',
        mimeType: 'image/png',
        width: 640,
        height: 640,
      },
    ],
    characters: [],
    voiceProfiles: [],
    subtitleStyles: [
      {
        id: '40000000-0000-4000-8000-0000000000a1',
        name: '字幕',
        fontFamily: 'Arial',
        fontSize: 44,
        textColor: '#ffffff',
        backgroundColor: '#000000',
        position: 'bottom',
        align: 'center',
        maxWidth: 1600,
      },
    ],
    shots: [
      {
        id: '50000000-0000-4000-8000-0000000000a1',
        name: '镜头一',
        durationMs: 2_400,
        defaultSubtitleStyleId: '40000000-0000-4000-8000-0000000000a1',
        dialogues: [],
        audioClips: [],
        layers: [
          {
            id: '60000000-0000-4000-8000-0000000000a1',
            name: '背景层',
            source: {
              kind: 'asset',
              assetId: '10000000-0000-4000-8000-0000000000b1',
            },
            anchor: 'center',
            x: 960,
            y: 540,
            scaleX: 1,
            scaleY: 1,
            rotationDeg: 0,
            opacity: 1,
            visible: true,
            zIndex: 0,
          },
          {
            id: '60000000-0000-4000-8000-0000000000a2',
            name: '前景层',
            source: {
              kind: 'asset',
              assetId: '10000000-0000-4000-8000-0000000000b2',
            },
            anchor: 'center',
            x: 400,
            y: 300,
            scaleX: 0.5,
            scaleY: 0.5,
            rotationDeg: 12,
            opacity: 0.8,
            visible: true,
            zIndex: 1,
          },
        ],
        timelineEvents: [
          {
            id: '70000000-0000-4000-8000-0000000000a1',
            type: 'move',
            layerId: '60000000-0000-4000-8000-0000000000a2',
            startMs: 200,
            endMs: 1_000,
            from: { x: 400, y: 300 },
            to: { x: 700, y: 300 },
            easing: 'linear',
          },
        ],
      },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('legacy projects reach v18 with the historical static camera', () => {
  it('migrates a populated v1 project without losing its picture', () => {
    const migrated = migrateProject(legacyV1());

    expect(migrated.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(migrated.shots).toHaveLength(1);
    const shot = migrated.shots[0]!;
    expect(shot.camera).toEqual(STATIC_CAMERA);
    expect(shot.name).toBe('镜头一');
    expect(shot.durationMs).toBe(2_400);
    expect(shot.layers).toHaveLength(2);
    expect(shot.layers[1]).toMatchObject({
      name: '前景层',
      x: 400,
      y: 300,
      rotationDeg: 12,
      opacity: 0.8,
    });
    expect(shot.backgroundLayerId).toBe('60000000-0000-4000-8000-0000000000a1');
    expect(shot.timelineEvents).toHaveLength(1);
    expect(ProjectSchema.parse(migrated)).toEqual(migrated);
  });

  it('migrates a populated v13 project', () => {
    // v13 predates the animation definition list, so the fixture is built from
    // the animation-free project and drops `animations` too.
    const current = buildProject();
    const { animations: _animations, ...withoutAnimations } = current;
    void _animations;
    const legacyV13 = {
      ...withVersion(withoutAnimations, 13),
      shots: legacyShots(current.shots),
    };
    expect(ProjectV13Schema.parse(legacyV13)).toEqual(legacyV13);

    expectMigratedShotKeepsItsContent(migrateProject(legacyV13), current);
  });

  it('migrates a populated v14 project', () => {
    const current = buildProjectWithAnimation();
    const legacyV14 = {
      ...withVersion(current, 14),
      shots: legacyShots(current.shots),
    };
    expect(ProjectV14Schema.parse(legacyV14)).toEqual(legacyV14);

    const migrated = migrateProject(legacyV14);
    expect(migrated.animations).toEqual(current.animations);
    expectMigratedShotKeepsItsContent(migrated, current);
  });

  it('migrates a populated v15 animation project', () => {
    const current = buildProjectWithAnimation();
    const shot = legacyShot(current.shots[0]!);
    const animationLayer = {
      id: IDS.animationLayer,
      name: 'walk instance',
      source: { kind: 'animation' as const, animationId: IDS.animation },
      startTimeMs: 1_234,
      anchor: 'center' as const,
      x: 510,
      y: 520,
      scaleX: 1.25,
      scaleY: 1.25,
      rotationDeg: 0,
      opacity: 1,
      visible: true,
      locked: false,
      flipX: false,
      zIndex: 3,
    };
    const legacyV15 = {
      ...withVersion(current, 15),
      shots: [{ ...shot, layers: [...shot.layers, animationLayer] }],
    };
    expect(ProjectV15Schema.parse(legacyV15)).toEqual(legacyV15);

    const migrated = migrateProject(legacyV15);
    expect(migrated.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    const migratedShot = migrated.shots[0]!;
    expect(migratedShot.camera).toEqual(STATIC_CAMERA);
    expect(migratedShot.layers).toHaveLength(shot.layers.length + 1);
    expect(migratedShot.layers.at(-1)).toMatchObject({
      id: IDS.animationLayer,
      startTimeMs: 1_234,
      x: 510,
      y: 520,
      animationPlayback: { mode: 'once', endBehavior: 'hold' },
    });
    expect(migratedShot.backgroundLayerId).toBe(shot.backgroundLayerId);
    expect(ProjectSchema.parse(migrated)).toEqual(migrated);
  });

  it('migrates a populated v15 Adaptive Parts project', () => {
    const current = buildProject();
    const characterId = '30000000-0000-4000-8000-0000000000a1';
    const voiceProfileId = '30000000-0000-4000-8000-0000000000a2';
    const shot = legacyShot(current.shots[0]!);
    const legacyV15 = {
      ...withVersion(current, 15),
      characters: [
        ...current.characters,
        {
          id: characterId,
          name: 'Adaptive v15 Character',
          mode: 'adaptive-parts' as const,
          defaultVoiceProfileId: voiceProfileId,
          defaultScale: 1,
          defaultFlipX: false,
          sourceRootTransform: adaptivePartsSourceRootTransform(),
          parts: adaptivePartsFixture(IDS.assetChar),
        },
      ],
      voiceProfiles: [
        ...current.voiceProfiles,
        {
          id: voiceProfileId,
          name: 'Adaptive v15 Voice',
          characterId,
          locale: 'en-US',
          rate: 1,
          pitch: 0,
        },
      ],
      shots: [
        {
          ...shot,
          layers: [
            ...shot.layers,
            {
              id: '60000000-0000-4000-8000-0000000000a9',
              name: 'Adaptive v15 layer',
              source: { kind: 'character' as const, characterId },
              anchor: 'center' as const,
              x: 960,
              y: 540,
              scaleX: 1,
              scaleY: 1,
              rotationDeg: 0,
              opacity: 1,
              visible: true,
              locked: false,
              flipX: false,
              zIndex: 2,
            },
          ],
        },
      ],
    };
    expect(ProjectV15AdaptiveSchema.parse(legacyV15)).toEqual(legacyV15);

    const migrated = migrateProject(legacyV15);
    expect(migrated.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    const migratedShot = migrated.shots[0]!;
    expect(migratedShot.camera).toEqual(STATIC_CAMERA);
    expect(migratedShot.layers.at(-1)).toMatchObject({
      name: 'Adaptive v15 layer',
      source: { kind: 'character', characterId },
      x: 960,
      y: 540,
    });
    expect(
      migrated.characters.some((candidate) => candidate.id === characterId),
    ).toBe(true);
    expect(ProjectSchema.parse(migrated)).toEqual(migrated);
  });

  it('migrates a populated v16 project', () => {
    const current = buildProject();
    const legacyV16 = {
      ...withVersion(current, 16),
      shots: legacyShots(current.shots),
    };
    expect(ProjectV16Schema.parse(legacyV16)).toEqual(legacyV16);

    expectMigratedShotKeepsItsContent(migrateProject(legacyV16), current);
  });

  it('does not overwrite a camera that already exists in the input', () => {
    const current = buildProject();
    const withAuthoredCamera = ProjectSchema.parse({
      ...current,
      shots: current.shots.map((shot) => ({
        ...shot,
        camera: {
          mode: 'manual',
          keyframes: [
            { timeMs: 0, centerX: 960, centerY: 540, zoom: 2 },
          ],
        },
      })),
    });

    const migrated = migrateProject(withAuthoredCamera);
    expect(migrated.shots[0]!.camera).toEqual({
      mode: 'manual',
      keyframes: [{ timeMs: 0, centerX: 960, centerY: 540, zoom: 2 }],
    });
  });
});
