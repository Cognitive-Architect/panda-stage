import { describe, expect, it } from 'vitest';
import {
  ProjectSchema,
  UnsupportedSchemaVersionError,
  detectSchemaVersion,
  migrateProject,
} from '../../../src/domain';
import { PROBE_PROJECT } from '../../../src/shared/probe/probe-project';

function createV0Fixture(): unknown {
  return { ...structuredClone(PROBE_PROJECT), schemaVersion: 0 };
}

describe('project migration framework', () => {
  it('detects explicit v0 and v1 envelopes', () => {
    expect(detectSchemaVersion(createV0Fixture())).toBe(0);
    expect(detectSchemaVersion(PROBE_PROJECT)).toBe(1);
  });

  it.each([
    { schemaVersion: 2 },
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
      schemaVersion: 1,
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
