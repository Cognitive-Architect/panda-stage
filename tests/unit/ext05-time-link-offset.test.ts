import { describe, expect, it } from 'vitest';
import {
  evaluateShotAtTime,
  FlaGraphicDefinitionSchema,
  LayerService,
  PROJECT_SCHEMA_VERSION,
  ProjectSchema,
  ProjectV45Schema,
  resolveLayerAnimationTimeLink,
  setLayerAnimationTimeLink,
  ShotService,
  signedFrameOffsetMs,
  snapSignedFrameOffsetMs,
  stepSignedFrameOffsetMs,
  type Layer,
  type Project,
} from '../../src/domain';
import { collectExportPreparationMedia } from '../../src/domain/export-preparation';
import { evaluateExportShotAtTime } from '../../src/export-renderer/evaluateExportShotAtTime';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { buildProjectWithAnimation, IDS } from './domain/testProject';

const ACTION_ID = '81000000-0000-4000-8000-000000000001';
const ACTION_EVENT_1 = '81000000-0000-4000-8000-000000000011';
const ACTION_EVENT_2 = '81000000-0000-4000-8000-000000000012';
const FRAME_ASSET_0 = '11000000-0000-4000-8000-000000000100';
const FRAME_ASSET_1 = '11000000-0000-4000-8000-000000000101';
const FRAME_ASSET_2 = '11000000-0000-4000-8000-000000000102';
const FRAME_ASSET_3 = '11000000-0000-4000-8000-000000000103';
const FRAME_SHA = 'b'.repeat(64);

function makeFrameAsset(id: string, name: string, flaGraphicOrdinal?: number) {
  return {
    id,
    kind: 'image' as const,
    name,
    relativePath: flaGraphicOrdinal !== undefined ? `assets/${name}.svg` : `assets/${name}.png`,
    mimeType: flaGraphicOrdinal !== undefined ? 'image/svg+xml' : 'image/png',
    sha256: FRAME_SHA,
    width: 256,
    height: 256,
    usage: 'uncategorized' as const,
    keywords: [],
    ...(flaGraphicOrdinal !== undefined
      ? {
          flaGraphicFrame: {
            definitionId: IDS.animation,
            ordinal: flaGraphicOrdinal,
          },
        }
      : {}),
  };
}

function buildOffsetProject(options?: {
  flaGraphic?: boolean;
  layerPatch?: Partial<Layer>;
  shotDurationMs?: number;
  event1?: { startMs: number; endMs: number };
  event2?: { startMs: number; endMs: number };
}): Project {
  const base = buildProjectWithAnimation();
  const frameAssets = [
    makeFrameAsset(FRAME_ASSET_0, 'fx-0', options?.flaGraphic ? 0 : undefined),
    makeFrameAsset(FRAME_ASSET_1, 'fx-1', options?.flaGraphic ? 1 : undefined),
    makeFrameAsset(FRAME_ASSET_2, 'fx-2', options?.flaGraphic ? 2 : undefined),
    makeFrameAsset(FRAME_ASSET_3, 'fx-3', options?.flaGraphic ? 3 : undefined),
  ];
  const frameDurationMs = 250;
  const frames = frameAssets.map((asset, ordinal) => ({
    ordinal,
    sourceFrameIndex: ordinal,
    assetId: asset.id,
    sha256: FRAME_SHA,
    offset: { x: 0, y: 0 },
    sourceViewport: { x: 0, y: 0, width: 256, height: 256 },
    startMs: ordinal * frameDurationMs,
    durationMs: frameDurationMs,
    createdBySequenceImport: !options?.flaGraphic,
  }));

  const baseSource = {
    ...base.animations[0]!.source,
    sourceFps: 4,
    startFrameIndex: 0,
    endFrameIndex: 3,
    canvas: { width: 256, height: 256 },
    documentCanvas: { width: 256, height: 256 },
    anchor: { x: 0, y: 0 },
  };
  const animation = options?.flaGraphic
    ? FlaGraphicDefinitionSchema.parse({
        id: IDS.animation,
        kind: 'fla-graphic',
        name: '剑光 Graphic',
        durationMs: 1_000,
        source: baseSource,
        frames,
      })
    : {
        ...base.animations[0]!,
        id: IDS.animation,
        name: '剑光序列',
        durationMs: 1_000,
        source: baseSource,
        frames,
      };

  const baseShot = base.shots[0]!;
  const baseCharacter = base.characters[0]!;
  const animationLayer: Layer = {
    id: IDS.animationLayer,
    name: '剑光特效',
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
    startTimeMs: 250,
    animationPlayback: { mode: 'once', endBehavior: 'hold' },
    ...options?.layerPatch,
  };

  return ProjectSchema.parse({
    ...base,
    assets: [...base.assets, ...frameAssets],
    animations: [animation],
    characters: [
      {
        ...baseCharacter,
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
        ...baseShot,
        durationMs: options?.shotDurationMs ?? 6_000,
        layers: [...baseShot.layers, animationLayer],
        timelineEvents: [
          {
            id: ACTION_EVENT_1,
            layerId: IDS.layerChar,
            type: 'character-action',
            actionId: ACTION_ID,
            startMs: options?.event1?.startMs ?? 1_000,
            endMs: options?.event1?.endMs ?? 2_000,
          },
          {
            id: ACTION_EVENT_2,
            layerId: IDS.layerChar,
            type: 'character-action',
            actionId: ACTION_ID,
            startMs: options?.event2?.startMs ?? 4_000,
            endMs: options?.event2?.endMs ?? 5_000,
          },
        ],
      },
    ],
  });
}

function evalAnim(project: Project, timeMs: number) {
  const shot = project.shots[0]!;
  return evaluateShotAtTime(shot, timeMs, project).layers.find((l) => l.id === IDS.animationLayer)!;
}

describe('EXT-05 signed offsetMs on LayerAnimationTimeLink (#1403)', () => {
  it('supports signed author-frame stepping without clamping negative values to 0', () => {
    expect(signedFrameOffsetMs(0)).toBe(0);
    expect(signedFrameOffsetMs(1)).toBe(42);
    expect(signedFrameOffsetMs(-1)).toBe(-42);
    expect(signedFrameOffsetMs(-2)).toBe(-83);
    expect(signedFrameOffsetMs(-24)).toBe(-1_000);
    expect(signedFrameOffsetMs(24)).toBe(1_000);

    expect(stepSignedFrameOffsetMs(0, -1)).toBe(-42);
    expect(stepSignedFrameOffsetMs(-42, -1)).toBe(-83);
    expect(stepSignedFrameOffsetMs(-83, 2)).toBe(0);
    expect(stepSignedFrameOffsetMs(0, 1)).toBe(42);

    expect(snapSignedFrameOffsetMs(-40)).toBe(-42);
    expect(snapSignedFrameOffsetMs(40)).toBe(42);
  });

  it('shifts [s, e) to [s+delta, e+delta) preserving duration and advancing clock from new window start', () => {
    const base = buildOffsetProject();

    // Positive offset +200ms: [1000, 2000) -> [1200, 2200)
    const delayed = setLayerAnimationTimeLink(base, IDS.shot, IDS.animationLayer, {
      kind: 'character-action',
      sourceLayerId: IDS.layerChar,
      eventId: ACTION_EVENT_1,
      offsetMs: 200,
    });
    const delayedLayer = delayed.shots[0]!.layers.find((l) => l.id === IDS.animationLayer)!;
    expect(resolveLayerAnimationTimeLink(delayed.shots[0]!, delayedLayer)).toMatchObject({
      status: 'active',
      offsetMs: 200,
      sourceStartMs: 1_000,
      sourceEndMs: 2_000,
      startMs: 1_200,
      endMs: 2_200,
      visibleStartMs: 1_200,
      visibleEndMs: 2_200,
      outOfShotBounds: false,
    });
    expect(evalAnim(delayed, 1_199).visible).toBe(false);
    expect(evalAnim(delayed, 1_200)).toMatchObject({ visible: true, assetId: FRAME_ASSET_0 });
    expect(evalAnim(delayed, 1_450)).toMatchObject({ visible: true, assetId: FRAME_ASSET_1 });
    expect(evalAnim(delayed, 1_950)).toMatchObject({ visible: true, assetId: FRAME_ASSET_3 });
    expect(evalAnim(delayed, 2_200).visible).toBe(false);

    // Negative offset -200ms: [1000, 2000) -> [800, 1800)
    const early = setLayerAnimationTimeLink(base, IDS.shot, IDS.animationLayer, {
      kind: 'character-action',
      sourceLayerId: IDS.layerChar,
      eventId: ACTION_EVENT_1,
      offsetMs: -200,
    });
    expect(evalAnim(early, 799).visible).toBe(false);
    expect(evalAnim(early, 800)).toMatchObject({ visible: true, assetId: FRAME_ASSET_0 });
    expect(evalAnim(early, 1_050)).toMatchObject({ visible: true, assetId: FRAME_ASSET_1 });
    expect(evalAnim(early, 1_799)).toMatchObject({ visible: true, assetId: FRAME_ASSET_3 });
    expect(evalAnim(early, 1_800).visible).toBe(false);

    // Offset 0 normalizes cleanly and matches unshifted window [1000, 2000)
    const zero = setLayerAnimationTimeLink(early, IDS.shot, IDS.animationLayer, {
      kind: 'character-action',
      sourceLayerId: IDS.layerChar,
      eventId: ACTION_EVENT_1,
      offsetMs: 0,
    });
    const zeroLayer = zero.shots[0]!.layers.find((l) => l.id === IDS.animationLayer)!;
    expect(zeroLayer.animationTimeLink).toEqual({
      kind: 'character-action',
      sourceLayerId: IDS.layerChar,
      eventId: ACTION_EVENT_1,
    });
    expect(evalAnim(zero, 1_000)).toMatchObject({ visible: true, assetId: FRAME_ASSET_0 });
  });

  it('clips visibility when crossing t=0 without resetting elapsed clock, and treats completely out-of-bounds as valid+invisible (not broken)', () => {
    // Event [500, 1500) with offsetMs = -1000 -> shifted [-500, 500)
    const crossZeroBase = buildOffsetProject({ event1: { startMs: 500, endMs: 1_500 } });
    const crossZero = setLayerAnimationTimeLink(crossZeroBase, IDS.shot, IDS.animationLayer, {
      kind: 'character-action',
      sourceLayerId: IDS.layerChar,
      eventId: ACTION_EVENT_1,
      offsetMs: -1_000,
    });
    const crossLayer = crossZero.shots[0]!.layers.find((l) => l.id === IDS.animationLayer)!;
    expect(resolveLayerAnimationTimeLink(crossZero.shots[0]!, crossLayer)).toMatchObject({
      status: 'active',
      startMs: -500,
      endMs: 500,
      visibleStartMs: 0,
      visibleEndMs: 500,
      outOfShotBounds: false,
    });
    // At t=0: elapsedMs = 0 - (-500) = 500ms -> frame 2 (NOT frame 0!)
    expect(evalAnim(crossZero, 0)).toMatchObject({ visible: true, assetId: FRAME_ASSET_2 });
    expect(evalAnim(crossZero, 250)).toMatchObject({ visible: true, assetId: FRAME_ASSET_3 });
    expect(evalAnim(crossZero, 500).visible).toBe(false);

    // Completely before shot start: [500, 1500) with offsetMs = -2000 -> [-1500, -500)
    const beforeShot = setLayerAnimationTimeLink(crossZeroBase, IDS.shot, IDS.animationLayer, {
      kind: 'character-action',
      sourceLayerId: IDS.layerChar,
      eventId: ACTION_EVENT_1,
      offsetMs: -2_000,
    });
    const beforeLayer = beforeShot.shots[0]!.layers.find((l) => l.id === IDS.animationLayer)!;
    expect(resolveLayerAnimationTimeLink(beforeShot.shots[0]!, beforeLayer)).toMatchObject({
      status: 'active',
      outOfShotBounds: true,
    });
    // Must stay invisible (must NOT fall back to independent startTimeMs=250!)
    expect(evalAnim(beforeShot, 0).visible).toBe(false);
    expect(evalAnim(beforeShot, 250).visible).toBe(false);
    expect(evalAnim(beforeShot, 500).visible).toBe(false);

    // Completely after shot end: [4000, 5000) on 6000ms shot with offsetMs = +2500 -> [6500, 7500)
    const afterShot = setLayerAnimationTimeLink(crossZeroBase, IDS.shot, IDS.animationLayer, {
      kind: 'character-action',
      sourceLayerId: IDS.layerChar,
      eventId: ACTION_EVENT_2,
      offsetMs: 2_500,
    });
    const afterLayer = afterShot.shots[0]!.layers.find((l) => l.id === IDS.animationLayer)!;
    expect(resolveLayerAnimationTimeLink(afterShot.shots[0]!, afterLayer)).toMatchObject({
      status: 'active',
      outOfShotBounds: true,
    });
    expect(evalAnim(afterShot, 250).visible).toBe(false);
    expect(evalAnim(afterShot, 5_999).visible).toBe(false);
  });

  it('collects shifted export preparation media for delayed first appearance and cross-zero windows, and matches 60fps export', () => {
    // 1) Delayed beyond original event: event [4000, 5000) + 500ms -> [4500, 5500)
    const delayed = setLayerAnimationTimeLink(
      buildOffsetProject({ flaGraphic: true, layerPatch: { startTimeMs: 0 } }),
      IDS.shot,
      IDS.animationLayer,
      {
        kind: 'character-action',
        sourceLayerId: IDS.layerChar,
        eventId: ACTION_EVENT_2,
        offsetMs: 500,
      },
    );
    const collected = new Set(collectExportPreparationMedia(delayed).map((e) => e.asset.id));
    expect(collected.has(FRAME_ASSET_0)).toBe(true);
    expect(collected.has(FRAME_ASSET_1)).toBe(true);
    expect(collected.has(FRAME_ASSET_2)).toBe(true);
    expect(collected.has(FRAME_ASSET_3)).toBe(true);

    // 60fps export sampling respects 24fps authoring grid against shifted start 4500ms
    expect(
      evaluateExportShotAtTime(delayed, delayed.shots[0]!, 4_483).layers.find((l) => l.id === IDS.animationLayer)!.visible,
    ).toBe(false);
    expect(
      evaluateExportShotAtTime(delayed, delayed.shots[0]!, 4_517).layers.find((l) => l.id === IDS.animationLayer),
    ).toMatchObject({ visible: true, assetId: FRAME_ASSET_0 });

    // 2) Cross-zero window [-500, 500) still collects media
    const crossZero = setLayerAnimationTimeLink(
      buildOffsetProject({
        flaGraphic: true,
        layerPatch: { startTimeMs: 3_000 },
        event1: { startMs: 500, endMs: 1_500 },
      }),
      IDS.shot,
      IDS.animationLayer,
      {
        kind: 'character-action',
        sourceLayerId: IDS.layerChar,
        eventId: ACTION_EVENT_1,
        offsetMs: -1_000,
      },
    );
    const crossZeroMedia = new Set(collectExportPreparationMedia(crossZero).map((e) => e.asset.id));
    expect(crossZeroMedia.has(FRAME_ASSET_2)).toBe(true);
    expect(crossZeroMedia.has(FRAME_ASSET_3)).toBe(true);

    // 3) Completely out-of-bounds [6500, 7500) does not falsely trigger independent playback
    const oob = setLayerAnimationTimeLink(
      buildOffsetProject({ flaGraphic: true, layerPatch: { startTimeMs: 0 } }),
      IDS.shot,
      IDS.animationLayer,
      {
        kind: 'character-action',
        sourceLayerId: IDS.layerChar,
        eventId: ACTION_EVENT_2,
        offsetMs: 2_500,
      },
    );
    expect(
      evaluateExportShotAtTime(oob, oob.shots[0]!, 0).layers.find((l) => l.id === IDS.animationLayer)!.visible,
    ).toBe(false);
  });

  it('preserves valid offset link on same-shot duplicate, remaps on whole-shot duplicate, clears cross-shot, and supports save/Undo-Redo on v46', () => {
    const linked = setLayerAnimationTimeLink(buildOffsetProject(), IDS.shot, IDS.animationLayer, {
      kind: 'character-action',
      sourceLayerId: IDS.layerChar,
      eventId: ACTION_EVENT_1,
      offsetMs: -250,
    });
    expect(linked.schemaVersion).toBe(46);
    expect(linked.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);

    // Frozen v45 rejects animationTimeLink with offsetMs
    expect(ProjectV45Schema.safeParse({ ...linked, schemaVersion: 45 }).success).toBe(false);

    // Same-shot layer duplicate preserves valid ref + offsetMs
    const layerService = new LayerService();
    const sameShotDup = layerService.duplicateLayer(linked, IDS.shot, IDS.animationLayer);
    expect(sameShotDup.layer.animationTimeLink).toEqual({
      kind: 'character-action',
      sourceLayerId: IDS.layerChar,
      eventId: ACTION_EVENT_1,
      offsetMs: -250,
    });

    // Whole-shot duplicate remaps sourceLayerId/eventId and preserves offsetMs
    const shotService = new ShotService();
    const shotDup = shotService.duplicate(linked, IDS.shot);
    const copiedShot = shotDup.shots[1]!;
    const copiedAnim = copiedShot.layers.find((l) => l.source.kind === 'animation')!;
    const copiedChar = copiedShot.layers.find((l) => l.source.kind === 'character')!;
    expect(copiedAnim.animationTimeLink?.sourceLayerId).toBe(copiedChar.id);
    expect(copiedAnim.animationTimeLink?.eventId).not.toBe(ACTION_EVENT_1);
    expect(copiedAnim.animationTimeLink?.offsetMs).toBe(-250);
    expect(resolveLayerAnimationTimeLink(copiedShot, copiedAnim)).toMatchObject({
      status: 'active',
      offsetMs: -250,
      startMs: 750,
      endMs: 1_750,
    });

    // Cross-shot layer duplicate clears animationTimeLink
    const crossShotDup = layerService.duplicateLayer(shotDup, IDS.shot, IDS.animationLayer, copiedShot.id);
    expect(crossShotDup.layer.animationTimeLink).toBeUndefined();

    // Save/reopen & Undo/Redo
    const store = new EditorProjectStore();
    store.open('D:/PandaStage-Acceptance/ext05-test', buildOffsetProject());
    store.updateProject(linked, '设置动作联动时间偏移');
    const reopened = ProjectSchema.parse(JSON.parse(JSON.stringify(store.getSnapshot()!.project)));
    expect(reopened.shots[0]!.layers.find((l) => l.id === IDS.animationLayer)!.animationTimeLink?.offsetMs).toBe(-250);
    expect(store.undo()).toBe(true);
    expect(store.getSnapshot()!.project.shots[0]!.layers.find((l) => l.id === IDS.animationLayer)!.animationTimeLink).toBeUndefined();
    expect(store.redo()).toBe(true);
    expect(store.getSnapshot()!.project.shots[0]!.layers.find((l) => l.id === IDS.animationLayer)!.animationTimeLink?.offsetMs).toBe(-250);
  });
});
