import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import demo from '../../../demo-project/project-v1.example.json';
import {
  detectSchemaVersion,
  LayerService,
  migrateProject,
  PROJECT_SCHEMA_VERSION,
  ProjectSchema,
  ProjectV43Schema,
  ProjectV44Schema,
  ProjectV45Schema,
  ShotCameraV45Schema,
  type LayerParentKey,
  type ShotCameraOverride,
} from '../../../src/domain';
import { ProjectDocumentSchema } from '../../../src/shared/project-api';
import { characterActionGraphicFixture } from '../../helpers/characterActionGraphicFixture';

function baseV46Project() {
  return migrateProject(demo);
}

function makeAnimationProject() {
  const base = characterActionGraphicFixture();
  const shot = base.shots[0]!;
  const placed = new LayerService().createFromAnimation(base, shot.id, {
    animationId: base.animations[0]!.id,
    startTimeMs: 0,
    position: { x: 960, y: 540 },
  });
  const charLayer = placed.project.shots[0]!.layers.find(({ source }) => source.kind === 'character')
    ?? placed.project.shots[0]!.layers[0]!;
  return {
    project: placed.project,
    animLayerId: placed.layer.id,
    sourceLayerId: charLayer.id,
    eventId: randomUUID(),
  };
}

describe('P3 unified schema v46 and frozen v45 migration', () => {
  it('migrates a valid v45 project to v46 without mutating shot or layer data', () => {
    const v46 = baseV46Project();
    const v45 = {
      ...v46,
      schemaVersion: 45 as const,
      shots: v46.shots.map((shot, index) =>
        index === 0
          ? {
              ...shot,
              camera: {
                mode: 'manual' as const,
                keys: [
                  {
                    timeMs: 0,
                    centerX: 960,
                    centerY: 540,
                    zoom: 1.25,
                    rotationDeg: 0,
                    interpolationToNext: 'linear' as const,
                  },
                ],
              },
            }
          : shot,
      ),
    };

    expect(detectSchemaVersion(v45)).toBe(45);
    expect(ProjectV45Schema.safeParse(v45).success).toBe(true);

    const migrated = migrateProject(v45);
    expect(migrated.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(migrated.schemaVersion).toBe(46);
    expect(migrated.shots).toEqual(v45.shots);
    expect(ProjectSchema.parse(migrated)).toEqual(migrated);

    expect(
      ProjectDocumentSchema.safeParse({
        projectRoot: 'D:\\p3.pandastage',
        projectFilePath: 'D:\\p3.pandastage\\project.json',
        project: migrated,
        migrated: true,
        sourceVersion: 45,
      }).success,
    ).toBe(true);
  });

  it('frozen v43/v44/v45 readers reject v46 camera, parentKeys, and animationTimeLink fields', () => {
    const { project, animLayerId, sourceLayerId, eventId } = makeAnimationProject();
    const shot = project.shots[0]!;
    const override: ShotCameraOverride = {
      id: randomUUID(),
      startMs: 250,
      endMs: 1_000,
      blendInMs: 250,
      blendOutMs: 250,
    };

    expect(ShotCameraV45Schema.safeParse({ mode: 'hybrid', keys: [] }).success).toBe(false);
    expect(ShotCameraV45Schema.safeParse({ mode: 'manual', keys: [], overrides: [override] }).success).toBe(false);

    const withHybridCamera = {
      ...project,
      shots: [{ ...shot, camera: { mode: 'hybrid', keys: [], overrides: [override] } }, ...project.shots.slice(1)],
    };
    const withParentKeys = {
      ...project,
      shots: [
        {
          ...shot,
          layers: shot.layers.map((layer) =>
            layer.id === animLayerId
              ? { ...layer, parentKeys: [{ timeMs: 0, parentLayerId: sourceLayerId }] }
              : layer,
          ),
        },
        ...project.shots.slice(1),
      ],
    };
    const withTimeLink = {
      ...project,
      shots: [
        {
          ...shot,
          layers: shot.layers.map((layer) =>
            layer.id === animLayerId
              ? { ...layer, animationTimeLink: { kind: 'character-action', sourceLayerId, eventId } }
              : layer,
          ),
        },
        ...project.shots.slice(1),
      ],
    };

    expect(ProjectV43Schema.safeParse({ ...withHybridCamera, schemaVersion: 43 }).success).toBe(false);
    expect(ProjectV44Schema.safeParse({ ...withHybridCamera, schemaVersion: 44 }).success).toBe(false);
    expect(ProjectV45Schema.safeParse({ ...withHybridCamera, schemaVersion: 45 }).success).toBe(false);
    expect(ProjectV45Schema.safeParse({ ...withParentKeys, schemaVersion: 45 }).success).toBe(false);
    expect(ProjectV45Schema.safeParse({ ...withTimeLink, schemaVersion: 45 }).success).toBe(false);
    expect(() => migrateProject({ ...withHybridCamera, schemaVersion: 45 })).toThrow();
    expect(() => migrateProject({ ...withParentKeys, schemaVersion: 45 })).toThrow();
    expect(() => migrateProject({ ...withTimeLink, schemaVersion: 45 })).toThrow();
  });

  it('validates v46 hybrid camera overrides (#1378)', () => {
    const project = baseV46Project();
    const shot = project.shots[0]!;
    const id1 = randomUUID();
    const id2 = randomUUID();

    const valid = ProjectSchema.parse({
      ...project,
      shots: [
        {
          ...shot,
          camera: {
            mode: 'hybrid',
            keys: [],
            overrides: [
              { id: id1, startMs: 0, endMs: 500, easingIn: 'ease-in', easingOut: 'ease-out' },
              {
                id: id2,
                startMs: 500,
                endMs: shot.durationMs,
                blendInMs: 0,
                blendOutMs: 125,
                curveIn: { bezier: { x1: 0.2, y1: 0, x2: 0.8, y2: 1 } },
              },
            ],
          },
        },
        ...project.shots.slice(1),
      ],
    });
    expect(valid.shots[0]!.camera?.overrides?.[0]).toMatchObject({ blendInMs: 250, blendOutMs: 250 });

    const withOverrides = (overrides: unknown[]) =>
      ProjectSchema.safeParse({
        ...project,
        shots: [{ ...shot, camera: { mode: 'hybrid', keys: [], overrides } }, ...project.shots.slice(1)],
      });

    // Overlapping intervals
    expect(
      withOverrides([
        { id: id1, startMs: 0, endMs: 750 },
        { id: id2, startMs: 500, endMs: 1_000 },
      ]).success,
    ).toBe(false);
    // Out-of-order intervals
    expect(
      withOverrides([
        { id: id1, startMs: 1_000, endMs: 1_500 },
        { id: id2, startMs: 0, endMs: 500 },
      ]).success,
    ).toBe(false);
    // endMs <= startMs
    expect(withOverrides([{ id: id1, startMs: 500, endMs: 500 }]).success).toBe(false);
    // Exceeds shot.durationMs
    expect(withOverrides([{ id: id1, startMs: 0, endMs: shot.durationMs + 1 }]).success).toBe(false);
    // Duplicate IDs
    expect(
      withOverrides([
        { id: id1, startMs: 0, endMs: 250 },
        { id: id1, startMs: 500, endMs: 750 },
      ]).success,
    ).toBe(false);
    // Off-grid startMs
    expect(withOverrides([{ id: id1, startMs: 13, endMs: 500 }]).success).toBe(false);
  });

  it('validates v46 dynamic parentKeys (#1379) and animationTimeLink (#1380)', () => {
    const { project, animLayerId, sourceLayerId, eventId } = makeAnimationProject();
    const shot = project.shots[0]!;
    const identity = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

    const parentKeys: LayerParentKey[] = [
      {
        timeMs: 250,
        parentLayerId: sourceLayerId,
        parentAttachment: {
          target: { kind: 'character-part', partId: 'hand-right' },
          ownerLocalFallback: identity,
        },
        parentSpaceOffset: identity,
        depthMode: 'inherit',
      },
      {
        timeMs: 1_000,
        parentLayerId: null,
        parentSpaceOffset: identity,
        depthMode: 'preserve',
        depth: -100,
        cameraSpace: 'world',
      },
    ];

    const valid = ProjectSchema.parse({
      ...project,
      shots: [
        {
          ...shot,
          layers: shot.layers.map((layer) =>
            layer.id === animLayerId
              ? {
                  ...layer,
                  parentKeys,
                  animationTimeLink: { kind: 'character-action', sourceLayerId, eventId },
                }
              : layer,
          ),
        },
        ...project.shots.slice(1),
      ],
    });
    const parsedAnim = valid.shots[0]!.layers.find(({ id }) => id === animLayerId)!;
    expect(parsedAnim.parentKeys).toEqual(parentKeys);
    expect(parsedAnim.animationTimeLink).toEqual({ kind: 'character-action', sourceLayerId, eventId });

    // Reject duplicate / unordered / out-of-bounds parentKeys
    const parseParentKeys = (keys: unknown[]) =>
      ProjectSchema.safeParse({
        ...project,
        shots: [
          {
            ...shot,
            layers: shot.layers.map((layer) =>
              layer.id === animLayerId ? { ...layer, parentKeys: keys } : layer,
            ),
          },
          ...project.shots.slice(1),
        ],
      });

    expect(
      parseParentKeys([
        { timeMs: 500, parentLayerId: sourceLayerId },
        { timeMs: 500, parentLayerId: null },
      ]).success,
    ).toBe(false);
    expect(
      parseParentKeys([
        { timeMs: 1_000, parentLayerId: sourceLayerId },
        { timeMs: 500, parentLayerId: null },
      ]).success,
    ).toBe(false);
    expect(
      parseParentKeys([{ timeMs: shot.durationMs + 250, parentLayerId: null }]).success,
    ).toBe(false);

    // Reject animationTimeLink on non-animation layers
    const nonAnimLayer = shot.layers.find(({ source }) => source.kind !== 'animation')!;
    const invalidTimeLink = ProjectSchema.safeParse({
      ...project,
      shots: [
        {
          ...shot,
          layers: shot.layers.map((layer) =>
            layer.id === nonAnimLayer.id
              ? { ...layer, animationTimeLink: { kind: 'character-action', sourceLayerId, eventId } }
              : layer,
          ),
        },
        ...project.shots.slice(1),
      ],
    });
    expect(invalidTimeLink.success).toBe(false);
  });
});
