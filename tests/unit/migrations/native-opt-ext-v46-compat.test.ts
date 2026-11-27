import { describe, expect, it } from 'vitest';
import {
  detectSchemaVersion,
  LayerService,
  LayerV45Schema,
  migrateProject,
  PROJECT_SCHEMA_VERSION,
  ProjectSchema,
  ProjectV45Schema,
  ProjectV46Schema,
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
import { ProjectDocumentSchema } from '../../../src/shared/project-api';
import { buildProjectWithAnimation, IDS } from '../domain/testProject';

const ACTION_ID = '82000000-0000-4000-8000-000000000001';
const ACTION_EVENT_1 = '82000000-0000-4000-8000-000000000011';
const ACTION_EVENT_2 = '82000000-0000-4000-8000-000000000012';
const NEG_LINK_LAYER_ID = '82000000-0000-4000-8000-000000000021';

/**
 * Minimal legacy v46 fixture (pre-#1405): no `ShotCamera.autoFraming`,
 * no `LayerAnimationTimeLink.offsetMs`, and no v47 `visualEffects`.
 */
export function createLegacyV46ProjectFixture(): Record<string, unknown> {
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

  const v46 = ProjectV46Schema.parse({
    ...base,
    schemaVersion: 46,
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

  return JSON.parse(JSON.stringify(v46)) as Record<string, unknown>;
}

/**
 * Minimal extended v46 fixture (#1405 pre-AN merge): schemaVersion 46 carrying
 * non-default `ShotCamera.autoFraming` (zoom + 1/3 normalized target) and both
 * positive (+42ms / +1 frame) and negative (-200ms) `LayerAnimationTimeLink.offsetMs`.
 */
export function createExtendedV46ProjectFixture(): Record<string, unknown> {
  const legacyV47 = migrateProject(createLegacyV46ProjectFixture());
  const baseShot = legacyV47.shots[0]!;
  const negLayer: Layer = {
    ...baseShot.layers.find((layer) => layer.id === IDS.animationLayer)!,
    id: NEG_LINK_LAYER_ID,
    name: '负偏移剑光',
    zIndex: 4,
    animationTimeLink: undefined,
  };
  let project: Project = ProjectSchema.parse({
    ...legacyV47,
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

  const v46 = ProjectV46Schema.parse({
    ...project,
    schemaVersion: 46,
  });
  return JSON.parse(JSON.stringify(v46)) as Record<string, unknown>;
}

describe('P2-04 (#1402/#1403 + AN #1265 v47) v46 -> v47 compatibility fixtures & migration contract', () => {
  it('migrates legacy v46 projects without autoFraming or offsetMs to v47 with exact defaults', () => {
    const rawV46 = createLegacyV46ProjectFixture();
    expect(detectSchemaVersion(rawV46)).toBe(46);
    expect(PROJECT_SCHEMA_VERSION).toBe(47);
    expect(ProjectV46Schema.safeParse(rawV46).success).toBe(true);

    const migrated = migrateProject(rawV46);
    expect(migrated.schemaVersion).toBe(47);
    expect(ProjectSchema.parse(migrated)).toEqual(migrated);

    const shot = migrated.shots[0]!;
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
  });

  it('migrates extended v46 autoFraming + signed offsetMs to v47 alongside AN visualEffects, preserves across duplicate/save, and keeps frozen v45/v46 strict', () => {
    const rawExtendedV46 = createExtendedV46ProjectFixture();
    expect(detectSchemaVersion(rawExtendedV46)).toBe(46);
    expect(ProjectV46Schema.safeParse(rawExtendedV46).success).toBe(true);

    // v46 -> v47 migration preserves exact autoFraming (including 1/3) and signed offsetMs (+42, -200)
    const migrated = migrateProject(rawExtendedV46);
    expect(migrated.schemaVersion).toBe(47);
    expect(
      ProjectDocumentSchema.safeParse({
        projectRoot: 'D:/p204-v46-to-v47.pandastage',
        projectFilePath: 'D:/p204-v46-to-v47.pandastage/project.json',
        project: migrated,
        migrated: true,
        sourceVersion: 46,
      }).success,
    ).toBe(true);

    // Coexists cleanly with AN #1265 formal v47 visualEffects on the same migrated layer
    const layerService = new LayerService();
    const effectsValue = {
      blend: 'screen' as const,
      blur: 3,
      glow: { radius: 4, color: '#ffff00' },
      outline: { radius: 2, color: '#00ffff' },
      feather: 1,
    };
    const withEffects = layerService.setVisualEffects(migrated, IDS.shot, IDS.animationLayer, effectsValue);

    const reopened = ProjectSchema.parse(JSON.parse(JSON.stringify(withEffects)));
    const shot = reopened.shots[0]!;
    expect(shot.camera?.autoFraming).toEqual({
      zoom: 1.85,
      targetU: 1 / 3,
      targetV: 0.45,
    });
    const posLayer = shot.layers.find((layer) => layer.id === IDS.animationLayer)!;
    const negLayer = shot.layers.find((layer) => layer.id === NEG_LINK_LAYER_ID)!;
    expect(posLayer.animationTimeLink?.offsetMs).toBe(42);
    expect(posLayer.visualEffects).toEqual(effectsValue);
    expect(negLayer.animationTimeLink?.offsetMs).toBe(-200);

    // Whole-shot duplicate remaps references while preserving autoFraming, signed offsetMs, and visualEffects
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
    expect(
      copiedShot.layers.some((layer) => layer.visualEffects?.blend === 'screen'),
    ).toBe(true);

    // Same-shot duplicate preserves signed offsetMs; cross-shot duplicate clears link
    const sameShotDup = layerService.duplicateLayer(withCopiedShot, IDS.shot, NEG_LINK_LAYER_ID);
    expect(sameShotDup.layer.animationTimeLink?.offsetMs).toBe(-200);
    const crossShotDup = layerService.duplicateLayer(withCopiedShot, IDS.shot, NEG_LINK_LAYER_ID, copiedShot.id);
    expect(crossShotDup.layer.animationTimeLink).toBeUndefined();

    // Frozen v45 rejects autoFraming & offsetMs; frozen v46 rejects v47 visualEffects
    expect(
      ShotCameraV45Schema.safeParse({
        mode: 'hybrid',
        keys: [],
        autoFraming: { zoom: 1.85, targetU: 1 / 3, targetV: 0.45 },
      }).success,
    ).toBe(false);
    expect(LayerV45Schema.safeParse(posLayer).success).toBe(false);
    expect(ProjectV45Schema.safeParse({ ...rawExtendedV46, schemaVersion: 45 }).success).toBe(false);
    expect(ProjectV46Schema.safeParse({ ...reopened, schemaVersion: 46 }).success).toBe(false);
  });
});
