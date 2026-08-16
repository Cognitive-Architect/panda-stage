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
  const project = PROBE_PROJECT;
  return {
    schemaVersion: 0,
    id: project.id,
    name: project.name,
    width: project.width,
    height: project.height,
    fps: project.fps,
    assets: project.assets.map((asset) => ({ ...asset })),
    shots: project.shots.map((shot) => ({
      id: shot.id,
      name: shot.name,
      durationMs: shot.durationMs,
      backgroundLayerId: shot.backgroundLayerId,
      layers: shot.layers.map((layer) => {
        if (layer.source.kind !== 'asset') {
          throw new Error('v0 fixture 仅支持 asset 图层。');
        }
        return {
          id: layer.id,
          assetId: layer.source.assetId,
          name: layer.name,
          anchor: layer.anchor,
          x: layer.x,
          y: layer.y,
          scaleX: layer.scaleX,
          scaleY: layer.scaleY,
          rotationDeg: layer.rotationDeg,
          opacity: layer.opacity,
          visible: layer.visible,
          zIndex: layer.zIndex,
        };
      }),
      timelineEvents: shot.timelineEvents
        .filter(
          (event): event is Extract<typeof event, { type: 'move' }> =>
            event.type === 'move',
        )
        .map((event) => ({
          id: event.id,
          type: 'move' as const,
          layerId: event.layerId,
          startMs: event.startMs,
          durationMs: event.endMs - event.startMs,
          from: event.from,
          to: event.to,
          easing: event.easing,
        })),
    })),
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
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
  const project = migrateProject(exampleProject);
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
  it('detects explicit v0 through v5 envelopes', () => {
    expect(detectSchemaVersion(createV0Fixture())).toBe(0);
    expect(detectSchemaVersion(PROBE_PROJECT)).toBe(6);
    expect(detectSchemaVersion({ schemaVersion: 2 })).toBe(2);
    expect(detectSchemaVersion({ schemaVersion: 3 })).toBe(3);
    expect(detectSchemaVersion({ schemaVersion: 4 })).toBe(4);
    expect(detectSchemaVersion({ schemaVersion: 5 })).toBe(5);
  });

  it.each([
    { schemaVersion: 7 },
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
      schemaVersion: 6,
      id: PROBE_PROJECT.id,
      name: PROBE_PROJECT.name,
      createdAt: PROBE_PROJECT.createdAt,
      updatedAt: PROBE_PROJECT.updatedAt,
    });
    expect(migrated.assets).toEqual(PROBE_PROJECT.assets);
    const legacyLayer = PROBE_PROJECT.shots[0]!.layers[0]!;
    if (legacyLayer.source.kind !== 'asset') {
      throw new Error('Probe 首图层应为 asset 图层。');
    }
    expect(migrated.shots[0]!.layers[0]).toMatchObject({
      id: legacyLayer.id,
      name: legacyLayer.name,
      source: { kind: 'asset', assetId: legacyLayer.source.assetId },
      anchor: legacyLayer.anchor,
      x: legacyLayer.x,
      y: legacyLayer.y,
      scaleX: legacyLayer.scaleX,
      scaleY: legacyLayer.scaleY,
      rotationDeg: legacyLayer.rotationDeg,
      opacity: legacyLayer.opacity,
      visible: legacyLayer.visible,
      locked: false,
      flipX: false,
      zIndex: legacyLayer.zIndex,
    });
    const legacyEvent = PROBE_PROJECT.shots[0]!.timelineEvents[0]!;
    if (legacyEvent.type !== 'move') {
      throw new Error('Probe 首事件应为 move 事件。');
    }
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

  it('preserves flip from the current shared probe v1 during migration', () => {
    const flippedProbe = structuredClone(PROBE_PROJECT);
    flippedProbe.shots[0]!.layers[1]!.flipX = true;

    const migrated = migrateProject(flippedProbe);

    expect(migrated.shots[0]!.layers[1]!.flipX).toBe(true);
  });

  it('migrates a formal v1 project to v6 with character defaults and explicit background', () => {
    const snapshot = structuredClone(exampleProject);
    const migrated = migrateProject(exampleProject);
    const character = migrated.characters[0]!;

    expect(exampleProject).toEqual(snapshot);
    expect(migrated.schemaVersion).toBe(6);
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
        (layer) => layer.locked === false && layer.flipX === false,
      ),
    ).toBe(true);
  });

  it('migrates v2 to an explicit background without name or zIndex runtime inference', () => {
    const current = migrateProject(exampleProject);
    const version2 = {
      ...current,
      schemaVersion: 2 as const,
      shots: current.shots.map(({ backgroundLayerId, ...shot }) => {
        void backgroundLayerId;
        return {
          ...shot,
          layers: shot.layers.map(({ locked, flipX, ...layer }) => {
            void locked;
            void flipX;
            return layer;
          }),
        };
      }),
    };
    const migrated = migrateProject(version2);

    expect(migrated.schemaVersion).toBe(6);
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
    const current = migrateProject(exampleProject);
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
          ].map(({ locked, flipX, ...layer }) => {
            void locked;
            void flipX;
            return layer;
          }),
          timelineEvents: [],
          };
        },
      ),
    };

    expect(migrateProject(contentOnly).shots[0]!.backgroundLayerId).toBeNull();
  });

  it('migrates strict v3 layers to v6 with locked=false and flipX=false', () => {
    const current = migrateProject(exampleProject);
    const version3 = {
      ...current,
      schemaVersion: 3 as const,
      shots: current.shots.map((shot) => ({
        ...shot,
        layers: shot.layers.map(({ locked, flipX, ...layer }) => {
          void locked;
          void flipX;
          return layer;
        }),
      })),
    };

    const migrated = migrateProject(version3);

    expect(migrated.schemaVersion).toBe(6);
    expect(
      migrated.shots.flatMap((shot) => shot.layers)
        .every(
          (layer) => layer.locked === false && layer.flipX === false,
        ),
    ).toBe(true);
  });

  it('requires flipX in the current v6 schema and rejects v4 files that smuggle it in', () => {
    const current = migrateProject(exampleProject);
    const missingFlip = {
      ...current,
      shots: current.shots.map((shot) => ({
        ...shot,
        layers: shot.layers.map(({ flipX, ...layer }) => {
          void flipX;
          return layer;
        }),
      })),
    };
    const v4WithFlip = { ...current, schemaVersion: 4 };

    expect(() => ProjectSchema.parse(missingFlip)).toThrow();
    expect(() => migrateProject(v4WithFlip)).toThrow();
  });

  it('migrates v4 to v6, preserving locked and adding flipX=false', () => {
    const current = migrateProject(exampleProject);
    const version4 = {
      ...current,
      schemaVersion: 4 as const,
      shots: current.shots.map((shot, shotIndex) => ({
        ...shot,
        layers: shot.layers.map(
          ({ flipX, ...layer }, layerIndex) => {
            void flipX;
            return {
              ...layer,
              locked: shotIndex === 0 && layerIndex === 1,
            };
          },
        ),
      })),
    };

    const migrated = migrateProject(version4);
    expect(migrated.schemaVersion).toBe(6);
    expect(migrated.shots[0]!.layers.map((layer) => layer.locked))
      .toEqual([false, true]);
    expect(migrated.shots[0]!.layers.map((layer) => layer.flipX))
      .toEqual([false, false]);
  });

  it('preserves explicit flip values in an existing v5 project', () => {
    const current = migrateProject(exampleProject);
    const version5 = ProjectSchema.parse({
      ...current,
      shots: current.shots.map((shot, shotIndex) => ({
        ...shot,
        layers: shot.layers.map((layer, layerIndex) => ({
          ...layer,
          flipX: shotIndex === 0 && layerIndex === 1,
        })),
      })),
    });

    expect(migrateProject(version5)).toEqual(version5);
    expect(version5.shots[0]!.layers.map((layer) => layer.flipX))
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
