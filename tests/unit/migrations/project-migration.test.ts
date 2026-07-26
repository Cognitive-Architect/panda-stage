import { describe, expect, it } from 'vitest';
import {
  ProjectSchema,
  UnsupportedSchemaVersionError,
  detectSchemaVersion,
  inferLegacyBackgroundLayerId,
  migrateProject,
} from '../../../src/domain';
import { PROBE_PROJECT } from '../../../src/shared/probe/probe-project';
import exampleProject from '../../../demo-project/project-v1.example.json';

function createV0Fixture(): unknown {
  return { ...structuredClone(PROBE_PROJECT), schemaVersion: 0 };
}

function createLegacyBackgroundCandidate(
  width: number,
  height: number,
  input?: {
    assetId?: string;
    layerId?: string;
    name?: string;
    zIndex?: number;
  },
) {
  const project = ProjectSchema.parse(exampleProject);
  const asset = project.assets[0]!;
  const layer = project.shots[0]!.layers[0]!;
  if (asset.kind !== 'image' || layer.source.kind !== 'asset') {
    throw new Error('Expected direct image background fixture.');
  }
  const assetId = input?.assetId ?? asset.id;
  return {
    asset: {
      ...asset,
      id: assetId,
      width,
      height,
    },
    layer: {
      ...layer,
      id: input?.layerId ?? layer.id,
      name: input?.name ?? layer.name,
      source: { kind: 'asset' as const, assetId },
      scaleX: 1,
      scaleY: 1,
      zIndex: input?.zIndex ?? layer.zIndex,
    },
  };
}

describe('legacy background candidate inference', () => {
  it.each([
    { label: 'narrow portrait', width: 200, height: 1000 },
    { label: 'narrow landscape', width: 1600, height: 200 },
  ])('does not infer a $label from one large axis', ({ width, height }) => {
    const candidate = createLegacyBackgroundCandidate(width, height);

    expect(
      inferLegacyBackgroundLayerId(
        [candidate.asset],
        [candidate.layer],
      ),
    ).toBeNull();
  });

  it('infers one centered direct image when both axes meet the threshold', () => {
    const candidate = createLegacyBackgroundCandidate(1600, 900);

    expect(
      inferLegacyBackgroundLayerId(
        [candidate.asset],
        [candidate.layer],
      ),
    ).toBe(candidate.layer.id);
  });

  it('returns null when multiple images meet both axis thresholds', () => {
    const first = createLegacyBackgroundCandidate(1600, 900);
    const second = createLegacyBackgroundCandidate(1920, 1080, {
      assetId: '10000000-0000-4000-8000-000000000006',
      layerId: '60000000-0000-4000-8000-000000000003',
    });

    expect(
      inferLegacyBackgroundLayerId(
        [first.asset, second.asset],
        [first.layer, second.layer],
      ),
    ).toBeNull();
  });

  it('ignores background-like names and zIndex zero when an axis is too small', () => {
    const english = createLegacyBackgroundCandidate(1600, 200, {
      name: 'background banner',
      zIndex: 0,
    });
    const chinese = createLegacyBackgroundCandidate(200, 1000, {
      assetId: '10000000-0000-4000-8000-000000000006',
      layerId: '60000000-0000-4000-8000-000000000003',
      name: '背景装饰',
      zIndex: 0,
    });

    expect(
      inferLegacyBackgroundLayerId(
        [english.asset, chinese.asset],
        [english.layer, chinese.layer],
      ),
    ).toBeNull();
  });
});

describe('project migration framework', () => {
  it('detects explicit v0 through v4 envelopes', () => {
    expect(detectSchemaVersion(createV0Fixture())).toBe(0);
    expect(detectSchemaVersion(PROBE_PROJECT)).toBe(1);
    expect(detectSchemaVersion({ schemaVersion: 2 })).toBe(2);
    expect(detectSchemaVersion({ schemaVersion: 3 })).toBe(3);
    expect(detectSchemaVersion({ schemaVersion: 4 })).toBe(4);
  });

  it.each([
    { schemaVersion: 5 },
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
      schemaVersion: 4,
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
      locked: false,
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

  it('migrates a formal v1 project to v4 with character defaults and explicit background', () => {
    const snapshot = structuredClone(exampleProject);
    const migrated = migrateProject(exampleProject);
    const character = migrated.characters[0]!;

    expect(exampleProject).toEqual(snapshot);
    expect(migrated.schemaVersion).toBe(4);
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
    expect(
      migrated.shots[0]!.layers.every(
        (layer) => layer.locked === false,
      ),
    ).toBe(true);
  });

  it('migrates v2 to an explicit background without name or zIndex runtime inference', () => {
    const current = ProjectSchema.parse(exampleProject);
    const version2 = {
      ...current,
      schemaVersion: 2 as const,
      shots: current.shots.map(({ backgroundLayerId, ...shot }) => {
        void backgroundLayerId;
        return {
          ...shot,
          layers: shot.layers.map(({ locked, ...layer }) => {
            void locked;
            return layer;
          }),
        };
      }),
    };
    const migrated = migrateProject(version2);

    expect(migrated.schemaVersion).toBe(4);
    expect(migrated.shots[0]!.backgroundLayerId).toBe(
      migrated.shots[0]!.layers[0]!.id,
    );
    expect(
      migrated.shots[0]!.layers.every(
        (layer) => layer.locked === false,
      ),
    ).toBe(true);
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
          ].map(({ locked, ...layer }) => {
            void locked;
            return layer;
          }),
          timelineEvents: [],
          };
        },
      ),
    };

    expect(migrateProject(contentOnly).shots[0]!.backgroundLayerId).toBeNull();
  });

  it('migrates strict v3 layers to v4 with locked=false', () => {
    const current = ProjectSchema.parse(exampleProject);
    const version3 = {
      ...current,
      schemaVersion: 3 as const,
      shots: current.shots.map((shot) => ({
        ...shot,
        layers: shot.layers.map(({ locked, ...layer }) => {
          void locked;
          return layer;
        }),
      })),
    };

    const migrated = migrateProject(version3);

    expect(migrated.schemaVersion).toBe(4);
    expect(
      migrated.shots.flatMap((shot) => shot.layers)
        .every((layer) => layer.locked === false),
    ).toBe(true);
  });

  it('requires locked in v4 and rejects v3 files that smuggle it in', () => {
    const current = ProjectSchema.parse(exampleProject);
    const missingLocked = {
      ...current,
      shots: current.shots.map((shot) => ({
        ...shot,
        layers: shot.layers.map(({ locked, ...layer }) => {
          void locked;
          return layer;
        }),
      })),
    };
    const v3WithLocked = { ...current, schemaVersion: 3 };

    expect(() => ProjectSchema.parse(missingLocked)).toThrow();
    expect(() => migrateProject(v3WithLocked)).toThrow();
  });

  it('preserves explicit locked values in an existing v4 project', () => {
    const current = ProjectSchema.parse(exampleProject);
    const version4 = ProjectSchema.parse({
      ...current,
      shots: current.shots.map((shot, shotIndex) => ({
        ...shot,
        layers: shot.layers.map((layer, layerIndex) => ({
          ...layer,
          locked: shotIndex === 0 && layerIndex === 1,
        })),
      })),
    });

    expect(migrateProject(version4)).toEqual(version4);
    expect(version4.shots[0]!.layers.map((layer) => layer.locked))
      .toEqual([false, true]);
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
