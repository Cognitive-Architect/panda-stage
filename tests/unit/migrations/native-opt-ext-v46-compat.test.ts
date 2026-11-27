import { describe, expect, it } from 'vitest';
import {
  LayerService,
  LayerV45Schema,
  migrateProject,
  PROJECT_SCHEMA_VERSION,
  ProjectSchema,
  ProjectV45Schema,
  resolveLayerAnimationTimeLink,
  resolveShotAutoFraming,
  setLayerAnimationTimeLink,
  setShotCameraAutoFraming,
  setShotCameraMode,
  ShotCameraV45Schema,
  ShotService,
  type Layer,
  type Project,
} from '../../../src/domain';
import { buildProjectWithAnimation, IDS } from '../domain/testProject';

const ACTION_ID = '82000000-0000-4000-8000-000000000001';
const ACTION_EVENT_1 = '82000000-0000-4000-8000-000000000011';
const ACTION_EVENT_2 = '82000000-0000-4000-8000-000000000012';
const NEG_LINK_LAYER_ID = '82000000-0000-4000-8000-000000000021';

/**
 * Minimal legacy v46 fixture (pre-#1405): no `ShotCamera.autoFraming` and no
 * `LayerAnimationTimeLink.offsetMs`.
 */
export function createLegacyV46ProjectFixture(): Project {
  const base = buildProjectWithAnimation();
  const shot = base.shots[0]!;
  const character = base.characters[0]!;
  const animLayer: Layer = {
    id: IDS.animationLayer,
    name: '传统联动动画',
    source: { kind: 'animation', animationId: IDS.animation },
    anchor: 'center',
    x: 960,
    y: 540,
    scaleX: 1,
    scaleY: 1,
    rotationDeg: 0,
    opacity: 1,
    visible: true,
    zIndex: 3,
    locked: false,
    flipX: false,
    startTimeMs: 0,
    animationPlayback: { mode: 'once', endBehavior: 'hold' },
    animationTimeLink: {
      kind: 'character-action',
      sourceLayerId: IDS.layerChar,
      eventId: ACTION_EVENT_1,
    },
  };

  return ProjectSchema.parse({
    ...base,
    characters: [
      {
        ...character,
        actions: [
          {
            id: ACTION_ID,
            name: '挥拳',
            animationId: IDS.animation,
            placement: { offsetX: 0, offsetY: 0, scale: 1 },
          },
        ],
      },
    ],
    shots: [
      {
        ...shot,
        durationMs: 4_000,
        camera: {
          mode: 'hybrid',
          keys: [
            {
              timeMs: 0,
              centerX: 960,
              centerY: 540,
              zoom: 1,
              rotationDeg: 0,
              interpolationToNext: 'linear',
            },
          ],
          overrides: [],
        },
        layers: [...shot.layers, animLayer],
        timelineEvents: [
          {
            id: ACTION_EVENT_1,
            layerId: IDS.layerChar,
            type: 'character-action',
            actionId: ACTION_ID,
            startMs: 500,
            endMs: 1_500,
          },
          {
            id: ACTION_EVENT_2,
            layerId: IDS.layerChar,
            type: 'character-action',
            actionId: ACTION_ID,
            startMs: 2_000,
            endMs: 3_000,
          },
        ],
      },
    ],
  });
}

/**
 * Minimal extended v46 fixture (#1405): carries non-default `ShotCamera.autoFraming`
 * (zoom + 1/3 normalized target) and both positive (+42ms / +1 frame) and
 * negative (-200ms) `LayerAnimationTimeLink.offsetMs` values.
 *
 * Compatibility direction & AN #1265 handoff note (P2-04):
 * - Verified on this branch (#1405, v46):
 *   1. Legacy v46 projects (without autoFraming / offsetMs) load cleanly with defaults.
 *   2. Extended v46 projects round-trip cleanly through ProjectSchema, migrateProject,
 *      JSON save/reopen, LayerService.duplicateLayer, and ShotService.duplicate.
 *   3. Frozen v45 readers remain strict and reject both new fields.
 * - Pending authorized AN #1265 integration (NOT verified cross-branch here):
 *   AN #1265 (Draft v47, bf5576f0) currently strict-parses v46 via LayerV46Schema and
 *   ShotCameraSchema without `autoFraming?` / `offsetMs?`. When OWNER authorizes merging
 *   AN #1265 with #1405, this fixture must be accepted by AN's v46 reader, preserved
 *   through v46 -> v47 migration alongside AN visualEffects and #1389, and retained in
 *   v47 save/duplicate paths.
 */
export function createExtendedV46ProjectFixture(): Project {
  const legacy = createLegacyV46ProjectFixture();
  const baseShot = legacy.shots[0]!;
  const negLayer: Layer = {
    ...baseShot.layers.find((layer) => layer.id === IDS.animationLayer)!,
    id: NEG_LINK_LAYER_ID,
    name: '负偏移剑光',
    zIndex: 4,
    animationTimeLink: undefined,
  };
  let project = ProjectSchema.parse({
    ...legacy,
    shots: [
      {
        ...baseShot,
        layers: [...baseShot.layers, negLayer],
      },
    ],
  });
  project = setShotCameraMode(project, IDS.shot, 'hybrid');
  project = setShotCameraAutoFraming(project, IDS.shot, {
    zoom: 1.85,
    targetU: 1 / 3,
    targetV: 0.45,
  });
  project = setLayerAnimationTimeLink(project, IDS.shot, IDS.animationLayer, {
    kind: 'character-action',
    sourceLayerId: IDS.layerChar,
    eventId: ACTION_EVENT_1,
    offsetMs: 42,
  });
  project = setLayerAnimationTimeLink(project, IDS.shot, NEG_LINK_LAYER_ID, {
    kind: 'character-action',
    sourceLayerId: IDS.layerChar,
    eventId: ACTION_EVENT_2,
    offsetMs: -200,
  });
  return project;
}

describe('P2-04 (#1402/#1403) v46 compatibility fixtures & round-trip contract', () => {
  it('reads legacy v46 projects without autoFraming or offsetMs using exact defaults', () => {
    const legacy = createLegacyV46ProjectFixture();
    const rawJson = JSON.parse(JSON.stringify(legacy)) as Record<string, unknown>;
    expect(rawJson.schemaVersion).toBe(46);
    expect(PROJECT_SCHEMA_VERSION).toBe(46);

    const parsed = ProjectSchema.parse(rawJson);
    const migrated = migrateProject(rawJson);
    for (const candidate of [parsed, migrated]) {
      const shot = candidate.shots[0]!;
      expect(shot.camera?.autoFraming).toBeUndefined();
      expect(resolveShotAutoFraming(shot)).toEqual({
        zoom: 1.5,
        targetU: 0.5,
        targetV: 0.5,
      });
      const animLayer = shot.layers.find((layer) => layer.id === IDS.animationLayer)!;
      expect(animLayer.animationTimeLink?.offsetMs).toBeUndefined();
      expect(resolveLayerAnimationTimeLink(shot, animLayer)).toMatchObject({
        status: 'active',
        offsetMs: 0,
        startMs: 500,
        endMs: 1_500,
      });
    }
  });

  it('preserves extended v46 autoFraming and positive/negative offsetMs through parse, migrate, duplicate, and keeps frozen v45 strict', () => {
    const extended = createExtendedV46ProjectFixture();
    expect(extended.schemaVersion).toBe(46);

    // JSON save/reopen + migrateProject round-trip preserves exact precision (including 1/3)
    const rawJson = JSON.parse(JSON.stringify(extended)) as Record<string, unknown>;
    const reopened = ProjectSchema.parse(rawJson);
    const migrated = migrateProject(rawJson);
    for (const candidate of [reopened, migrated]) {
      const shot = candidate.shots[0]!;
      expect(shot.camera?.autoFraming).toEqual({
        zoom: 1.85,
        targetU: 1 / 3,
        targetV: 0.45,
      });
      const posLayer = shot.layers.find((layer) => layer.id === IDS.animationLayer)!;
      const negLayer = shot.layers.find((layer) => layer.id === NEG_LINK_LAYER_ID)!;
      expect(posLayer.animationTimeLink?.offsetMs).toBe(42);
      expect(negLayer.animationTimeLink?.offsetMs).toBe(-200);
    }

    // Whole-shot duplicate remaps references while preserving autoFraming and signed offsetMs
    const shotService = new ShotService();
    const withCopiedShot = shotService.duplicate(reopened, IDS.shot);
    const copiedShot = withCopiedShot.shots[1]!;
    expect(copiedShot.camera?.autoFraming).toEqual({
      zoom: 1.85,
      targetU: 1 / 3,
      targetV: 0.45,
    });
    const copiedOffsets = copiedShot.layers
      .filter((layer) => layer.source.kind === 'animation')
      .map((layer) => layer.animationTimeLink?.offsetMs)
      .sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(copiedOffsets).toEqual([-200, 42]);

    // Same-shot duplicate preserves signed offsetMs; cross-shot duplicate clears link
    const layerService = new LayerService();
    const sameShotDup = layerService.duplicateLayer(withCopiedShot, IDS.shot, NEG_LINK_LAYER_ID);
    expect(sameShotDup.layer.animationTimeLink?.offsetMs).toBe(-200);
    const crossShotDup = layerService.duplicateLayer(withCopiedShot, IDS.shot, NEG_LINK_LAYER_ID, copiedShot.id);
    expect(crossShotDup.layer.animationTimeLink).toBeUndefined();

    // Frozen v45 readers remain strict and reject both new optional fields
    expect(
      ShotCameraV45Schema.safeParse({
        mode: 'hybrid',
        keys: [],
        autoFraming: { zoom: 1.85, targetU: 1 / 3, targetV: 0.45 },
      }).success,
    ).toBe(false);
    expect(
      LayerV45Schema.safeParse(extended.shots[0]!.layers.find((layer) => layer.id === IDS.animationLayer)!).success,
    ).toBe(false);
    expect(
      ProjectV45Schema.safeParse({ ...extended, schemaVersion: 45 }).success,
    ).toBe(false);
  });
});
