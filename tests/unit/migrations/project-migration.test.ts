import { describe, expect, it } from 'vitest';
import {
  ProjectSchema,
  UnsupportedSchemaVersionError,
  detectSchemaVersion,
  migrateProject,
} from '../../../src/domain';
import { PROBE_PROJECT } from '../../../src/shared/probe/probe-project';
import exampleProject from '../../../demo-project/project-v1.example.json';

function createV0Fixture(): unknown {
  return { ...structuredClone(PROBE_PROJECT), schemaVersion: 0 };
}

describe('project migration framework', () => {
  it('detects explicit v0, v1, v2, and v3 envelopes', () => {
    expect(detectSchemaVersion(createV0Fixture())).toBe(0);
    expect(detectSchemaVersion(PROBE_PROJECT)).toBe(1);
    expect(detectSchemaVersion({ schemaVersion: 2 })).toBe(2);
    expect(detectSchemaVersion({ schemaVersion: 3 })).toBe(3);
  });

  it.each([
    { schemaVersion: 4 },
    { schemaVersion: 99 },
    {},
  ])('rejects unknown or missing schema versions', (input) => {
    expect(() => detectSchemaVersion(input)).toThrow(
      UnsupportedSchemaVersionError,
    );
  });

  it('migrates a v0 fixture without mutating or losing probe fields', () => {
    const input = createV0Fixture();
    const snapshot = structuredClone(input);
    const migrated = migrateProject(input);

    expect(input).toEqual(snapshot);
    expect(ProjectSchema.parse(migrated)).toEqual(migrated);
    expect(migrated).toMatchObject({
      schemaVersion: 3,
      id: PROBE_PROJECT.id,
      name: PROBE_PROJECT.name,
      createdAt: PROBE_PROJECT.createdAt,
      updatedAt: PROBE_PROJECT.updatedAt,
    });
    expect(migrated.assets).toEqual(PROBE_PROJECT.assets);
    const legacyLayer = PROBE_PROJECT.shots[0]!.layers[0]!;
    expect(migrated.shots[0]!.layers[0]).toMatchObject({
      id: legacyLayer.id,
      name: legacyLayer.name,
      source: { kind: 'asset', assetId: legacyLayer.assetId },
      anchor: legacyLayer.anchor,
      x: legacyLayer.x,
      y: legacyLayer.y,
      scaleX: legacyLayer.scaleX,
      scaleY: legacyLayer.scaleY,
      rotationDeg: legacyLayer.rotationDeg,
      opacity: legacyLayer.opacity,
      visible: legacyLayer.visible,
      zIndex: legacyLayer.zIndex,
    });
    const legacyEvent = PROBE_PROJECT.shots[0]!.timelineEvents[0]!;
    expect(migrated.shots[0]!.timelineEvents[0]).toMatchObject({
      id: legacyEvent.id,
      type: 'move',
      layerId: legacyEvent.layerId,
      startMs: 0,
      endMs: 3000,
      from: legacyEvent.from,
      to: legacyEvent.to,
      easing: legacyEvent.easing,
    });
  });

  it('explicitly migrates the legacy probe schemaVersion 1 collision', () => {
    const migrated = migrateProject(PROBE_PROJECT);

    expect(ProjectSchema.parse(migrated)).toEqual(migrated);
    expect(migrated.assets).toEqual(PROBE_PROJECT.assets);
    expect(migrated.characters).toEqual([]);
    expect(migrated.voiceProfiles).toEqual([]);
    expect(migrated.subtitleStyles).toHaveLength(1);
  });

  it('migrates a formal v1 project to v3 with character defaults and explicit background', () => {
    const snapshot = structuredClone(exampleProject);
    const migrated = migrateProject(exampleProject);
    const character = migrated.characters[0]!;

    expect(exampleProject).toEqual(snapshot);
    expect(migrated.schemaVersion).toBe(3);
    expect(character.defaultExpressionId).toBe(
      character.expressions[0]!.id,
    );
    expect(character.baseAssetId).toBe(
      character.expressions[0]!.assetId,
    );
    expect(character.defaultScale).toBe(1);
    expect(character.defaultFlipX).toBe(false);
    expect(character.mouthOpenAssetId).toBeUndefined();
    expect(migrated.shots[0]!.backgroundLayerId).toBe(
      migrated.shots[0]!.layers[0]!.id,
    );
  });

  it('migrates v2 to an explicit background without name or zIndex runtime inference', () => {
    const current = ProjectSchema.parse(exampleProject);
    const version2 = {
      ...current,
      schemaVersion: 2 as const,
      shots: current.shots.map(({ backgroundLayerId, ...shot }) => {
        void backgroundLayerId;
        return { ...shot };
      }),
    };
    const migrated = migrateProject(version2);

    expect(migrated.schemaVersion).toBe(3);
    expect(migrated.shots[0]!.backgroundLayerId).toBe(
      migrated.shots[0]!.layers[0]!.id,
    );
  });

  it('leaves an ordinary small zIndex-0 asset layer as content during migration', () => {
    const current = ProjectSchema.parse(exampleProject);
    const contentOnly = {
      ...current,
      schemaVersion: 2 as const,
      shots: current.shots.map(
        ({ backgroundLayerId, ...shot }) => {
          void backgroundLayerId;
          return {
          ...shot,
          layers: [
            {
              ...shot.layers[1]!,
              name: 'background sticker',
              source: {
                kind: 'asset' as const,
                assetId: current.characters[0]!.baseAssetId,
              },
              x: 960,
              y: 540,
              zIndex: 0,
            },
          ],
          timelineEvents: [],
          };
        },
      ),
    };

    expect(migrateProject(contentOnly).shots[0]!.backgroundLayerId).toBeNull();
  });

  it('is deterministic and has no external-state-dependent output', () => {
    const input = createV0Fixture();

    expect(migrateProject(input)).toEqual(migrateProject(input));
  });

  it('rejects unknown v0 fields rather than silently dropping them', () => {
    const fixture = createV0Fixture();
    if (typeof fixture !== 'object' || fixture === null) {
      throw new Error('Invalid test fixture.');
    }
    const input = { ...fixture, unknownLegacyField: 'keep me' };

    expect(() => migrateProject(input)).toThrow();
  });

  it('rejects unknown legacy event types rather than dropping them', () => {
    const input = structuredClone(createV0Fixture());
    if (
      typeof input !== 'object' ||
      input === null ||
      !('shots' in input) ||
      !Array.isArray(input.shots)
    ) {
      throw new Error('Invalid test fixture.');
    }
    const firstShot = input.shots[0];
    if (
      typeof firstShot !== 'object' ||
      firstShot === null ||
      !('timelineEvents' in firstShot) ||
      !Array.isArray(firstShot.timelineEvents)
    ) {
      throw new Error('Invalid test fixture shot.');
    }
    Object.assign(firstShot.timelineEvents[0], { type: 'teleport' });

    expect(() => migrateProject(input)).toThrow();
  });
});
