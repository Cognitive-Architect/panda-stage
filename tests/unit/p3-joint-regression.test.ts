import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  addShotCameraOverride,
  buildEditorStageRenderModel,
  evaluatedLayerWorldMatrix,
  LayerMotionService,
  LayerService,
  migrateProject,
  prepareShotCamera,
  ProjectSchema,
  resolveLayerCameraTransform,
  setLayerAnimationTimeLink,
  setLayerDepth,
  setShotCameraKey,
  setShotCameraMode,
  ShotService,
  type Character,
  type TimelineEvent,
} from '../../src/domain';
import { collectExportPreparationMedia } from '../../src/domain/export-preparation';
import { evaluateExportShotAtTime, selectExportDrawingLayers } from '../../src/export-renderer/evaluateExportShotAtTime';
import type { AffineMatrix2D } from '../../src/shared/affine-matrix';
import { buildStageRenderModel } from '../../src/shared/stage/render-model';
import { characterActionGraphicFixture } from '../helpers/characterActionGraphicFixture';
import { IDS } from './domain/testProject';

function expectMatrixClose(actual: AffineMatrix2D, expected: AffineMatrix2D, digits = 5) {
  for (const key of ['a', 'b', 'c', 'd', 'tx', 'ty'] as const) {
    expect(actual[key]).toBeCloseTo(expected[key], digits);
  }
}

describe('JOINT-01 P3 combined regression (#1378, #1379, #1380)', () => {
  it('combines hybrid camera overrides, dynamic pickup/handoff/drop, action-linked animation, depth parallax, screen HUD, hidden/control parents, and glue seams', () => {
    const base = characterActionGraphicFixture();
    const layerService = new LayerService();
    const motionService = new LayerMotionService();
    const shotService = new ShotService();

    // Extend shot duration to 3500ms and add a second character B so A & B can converse.
    const charA = base.characters[0]!;
    const charBId = randomUUID();
    const voiceBId = randomUUID();
    const charB: Character = {
      ...structuredClone(charA),
      id: charBId,
      name: '角色 B',
      defaultVoiceProfileId: voiceBId,
    };
    const voiceB = {
      ...structuredClone(base.voiceProfiles[0]!),
      id: voiceBId,
      characterId: charBId,
      name: '角色 B 音色',
    };
    const charALayer = base.shots[0]!.layers.find(({ source }) => source.kind === 'character')!;
    const charALayerId = charALayer.id;
    const charBLayerId = randomUUID();
    let project = ProjectSchema.parse({
      ...base,
      characters: [...base.characters, charB],
      voiceProfiles: [...base.voiceProfiles, voiceB],
      shots: base.shots.map((s) =>
        s.id === IDS.shot
          ? {
              ...s,
              durationMs: 3_500,
              layers: [
                ...s.layers,
                {
                  ...structuredClone(charALayer),
                  id: charBLayerId,
                  name: '角色 B 图层',
                  source: {
                    kind: 'character' as const,
                    characterId: charBId,
                    expressionId: charALayer.source.kind === 'character' ? charALayer.source.expressionId : undefined,
                  },
                  x: 1_040,
                  y: 560,
                  rotationDeg: 0,
                  flipX: false,
                  zIndex: s.layers.length,
                },
              ],
            }
          : s,
      ),
    });

    const propLayerId = IDS.layerAsset;

    // Add a dynamic-only carrier for B (no static parentLayerId)
    // to verify resolve-speaker-focus-camera & stageRenderModel detect parentKeys-only layers.
    const carrierB = layerService.createControl(project, IDS.shot);
    project = carrierB.project;
    project = setLayerDepth(project, IDS.shot, carrierB.layer.id, -200);
    project = motionService.applyTransform(
      project,
      { shotId: IDS.shot, layerId: carrierB.layer.id, timeMs: 0, autoKey: true },
      { x: 1_040, y: 560 },
    );
    project = motionService.applyTransform(
      project,
      { shotId: IDS.shot, layerId: carrierB.layer.id, timeMs: 3_000, autoKey: true },
      { x: 1_220, y: 520 },
    );
    // Bind B dynamically at t=0 via parentKeys only (static parentLayerId stays undefined).
    project = layerService.setParentKey(project, IDS.shot, charBLayerId, 0, carrierB.layer.id, { depthMode: 'inherit' });

    // Character A moves across the stage via a standard move timeline event so prop pickup follows A.
    const charAMoveEvent: TimelineEvent = {
      id: randomUUID(),
      layerId: charALayerId,
      type: 'move',
      startMs: 0,
      endMs: 1_750,
      from: { x: 520, y: 560 },
      to: { x: 760, y: 540 },
      easing: 'linear',
    };

    // 3-layer parallax + hidden intermediate parent + empty control layer + fixed screen HUD.
    const fgControl = layerService.createControl(project, IDS.shot);
    const hiddenCarrier = layerService.duplicateLayer(fgControl.project, IDS.shot, propLayerId);
    const fgBadge = layerService.duplicateLayer(hiddenCarrier.project, IDS.shot, propLayerId);
    const hud = layerService.duplicateLayer(fgBadge.project, IDS.shot, propLayerId);
    project = hud.project;

    const actionEventId = randomUUID();
    const bgId = project.shots[0]!.backgroundLayerId;
    if (bgId) {
      project = setLayerDepth(project, IDS.shot, bgId, 700);
    }

    const existingAction = project.shots[0]!.timelineEvents.find((e) => e.type === 'character-action');
    const actionId = existingAction && existingAction.type === 'character-action' ? existingAction.actionId : randomUUID();
    const actionEvent: TimelineEvent = {
      id: actionEventId,
      layerId: charALayerId,
      type: 'character-action',
      actionId,
      startMs: 750,
      endMs: 1_500,
    };

    project = ProjectSchema.parse({
      ...project,
      shots: project.shots.map((s) =>
        s.id === IDS.shot
          ? {
              ...s,
              layers: s.layers.map((l) => (l.id === hiddenCarrier.layer.id ? { ...l, visible: false } : l)),
              dialogues: [
                {
                  id: randomUUID(),
                  characterId: charA.id,
                  voiceProfileId: charA.defaultVoiceProfileId,
                  subtitleStyleId: s.defaultSubtitleStyleId,
                  text: 'A 拾取道具并挥动',
                  startMs: 0,
                  endMs: 1_250,
                },
                {
                  id: randomUUID(),
                  characterId: charB.id,
                  voiceProfileId: charB.defaultVoiceProfileId,
                  subtitleStyleId: s.defaultSubtitleStyleId,
                  text: 'B 接过道具继续说话',
                  startMs: 2_000,
                  endMs: 3_500,
                },
              ],
              timelineEvents: [
                ...s.timelineEvents.filter((e) => e.type !== 'character-action'),
                charAMoveEvent,
                actionEvent,
              ],
            }
          : s,
      ),
    });

    project = setLayerDepth(project, IDS.shot, fgControl.layer.id, -400);
    project = layerService.setParent(project, IDS.shot, hiddenCarrier.layer.id, fgControl.layer.id, 0);
    project = layerService.setParent(project, IDS.shot, fgBadge.layer.id, hiddenCarrier.layer.id, 0);
    project = motionService.applyTransform(
      project,
      { shotId: IDS.shot, layerId: fgControl.layer.id, timeMs: 1_500, autoKey: true },
      { x: 1_120, y: 540 },
    );
    project = layerService.setCameraAttachment(project, IDS.shot, hud.layer.id, true);

    // PARENT-06: create an animation effect layer linked to Character A's action event [750, 1500).
    const fxPlaced = layerService.createFromAnimation(project, IDS.shot, {
      animationId: project.animations[0]!.id,
      startTimeMs: 0,
      position: { x: 700, y: 480 },
    });
    const fxLayerId = fxPlaced.layer.id;
    project = setLayerAnimationTimeLink(fxPlaced.project, IDS.shot, fxLayerId, {
      kind: 'character-action',
      sourceLayerId: charALayerId,
      eventId: actionEventId,
    });

    // PARENT-05: prop starts independent on table [0, 500), A picks up at 500ms, hands off to B at 1750ms, drops at 2750ms.
    project = setLayerDepth(project, IDS.shot, propLayerId, 0);
    const worldPropBeforePickup = evaluatedLayerWorldMatrix(
      evaluateExportShotAtTime(project, project.shots[0]!, 500).layers.find(({ id }) => id === propLayerId)!,
    );
    project = layerService.setParentKey(project, IDS.shot, propLayerId, 500, charALayerId);
    const worldPropAtPickup = evaluatedLayerWorldMatrix(
      evaluateExportShotAtTime(project, project.shots[0]!, 500).layers.find(({ id }) => id === propLayerId)!,
    );
    expectMatrixClose(worldPropAtPickup, worldPropBeforePickup);

    const worldPropBeforeHandoff = evaluatedLayerWorldMatrix(
      evaluateExportShotAtTime(project, project.shots[0]!, 1_750).layers.find(({ id }) => id === propLayerId)!,
    );
    project = layerService.setParentKey(project, IDS.shot, propLayerId, 1_750, charBLayerId, { depthMode: 'inherit' });
    const worldPropAtHandoff = evaluatedLayerWorldMatrix(
      evaluateExportShotAtTime(project, project.shots[0]!, 1_750).layers.find(({ id }) => id === propLayerId)!,
    );
    expectMatrixClose(worldPropAtHandoff, worldPropBeforeHandoff);

    const worldPropBeforeDrop = evaluatedLayerWorldMatrix(
      evaluateExportShotAtTime(project, project.shots[0]!, 2_750).layers.find(({ id }) => id === propLayerId)!,
    );
    project = layerService.setParentKey(project, IDS.shot, propLayerId, 2_750, null);
    const worldPropAtDrop = evaluatedLayerWorldMatrix(
      evaluateExportShotAtTime(project, project.shots[0]!, 2_750).layers.find(({ id }) => id === propLayerId)!,
    );
    expectMatrixClose(worldPropAtDrop, worldPropBeforeDrop);

    // CAMERA-05: hybrid mode with auto speaker-focus + manual override [1250, 2250) (wide pan/zoom for handoff).
    project = setShotCameraMode(project, IDS.shot, 'hybrid');
    project = addShotCameraOverride(project, IDS.shot, {
      startMs: 1_250,
      endMs: 2_250,
      blendInMs: 250,
      blendOutMs: 250,
    });
    project = setShotCameraKey(project, IDS.shot, 1_750, {
      centerX: 960,
      centerY: 540,
      zoom: 0.85,
      rotationDeg: 6,
    });

    // Save/reopen round-trip.
    const reopened = migrateProject(JSON.parse(JSON.stringify(project)));
    const shot = reopened.shots[0]!;
    expect(shot.camera?.mode).toBe('hybrid');

    // Verify glue hook #2: buildEditorStageRenderModel evaluates parentKeys-only layers at t=0.
    const stageAt0 = buildEditorStageRenderModel(reopened, shot);
    expect(stageAt0.layers.find(({ layer }) => layer.id === charBLayerId)?.evaluated.effectiveDepth).toBe(-200);

    // Verify glue hook #3: same-shot duplicateLayer preserves animationTimeLink, cross-shot clears it.
    const sameShotFxCopy = layerService.duplicateLayer(reopened, IDS.shot, fxLayerId, IDS.shot, 1_000);
    expect(sameShotFxCopy.layer.animationTimeLink).toEqual({
      kind: 'character-action',
      sourceLayerId: charALayerId,
      eventId: actionEventId,
    });
    const withSecondShot = shotService.create(reopened, { name: '目标镜头', durationMs: 3_500 });
    const destShotId = withSecondShot.shots.at(-1)!.id;
    const crossShotFxCopy = layerService.duplicateLayer(withSecondShot, IDS.shot, fxLayerId, destShotId, 1_000);
    expect(crossShotFxCopy.layer.animationTimeLink).toBeUndefined();

    // Verify hybrid camera timeline: auto A (500) -> manual wide override (1750) -> auto B following dynamic parentKeys (2750).
    const cameraAt = prepareShotCamera(reopened, shot, 'static');
    const camAutoA = cameraAt(500)!;
    const camManual = cameraAt(1_750)!;
    const camAutoB = cameraAt(2_750)!;
    expect(camAutoA.zoom).toBeCloseTo(1.5, 4);
    expect(camAutoA.centerX).toBeLessThan(960);
    expect(camManual).toMatchObject({ centerX: 960, centerY: 540, zoom: 0.85, rotationDeg: 6 });
    expect(camAutoB.zoom).toBeCloseTo(1.5, 4);
    expect(camAutoB.centerX).toBeGreaterThan(960);

    // Verify glue hook #1: auto speaker-focus on B reflects B's dynamic-only parentKeys depth/position at 2750ms.
    const shotWithoutBParentKeys = ProjectSchema.parse({
      ...reopened,
      shots: reopened.shots.map((s) =>
        s.id === IDS.shot
          ? { ...s, layers: s.layers.map((l) => (l.id === charBLayerId ? { ...l, parentKeys: undefined } : l)) }
          : s,
      ),
    });
    const camAutoBWithoutParent = prepareShotCamera(shotWithoutBParentKeys, shotWithoutBParentKeys.shots[0]!, 'static')(2_750)!;
    expect(camAutoB.centerX).not.toBeCloseTo(camAutoBWithoutParent.centerX, 1);

    // Verify action-linked FX active window [750, 1500) and hidden outside.
    const fxDrawnAt = (t: number) =>
      selectExportDrawingLayers(evaluateExportShotAtTime(reopened, shot, t)).layers.some(({ id }) => id === fxLayerId);
    expect(fxDrawnAt(500)).toBe(false);
    expect(fxDrawnAt(1_000)).toBe(true);
    expect(fxDrawnAt(1_500)).toBe(false);

    // Verify prop follows A after pickup, B after handoff, and stays frozen in world after drop.
    const propAt = (t: number) =>
      evaluateExportShotAtTime(reopened, shot, t).layers.find(({ id }) => id === propLayerId)!;
    expect(evaluatedLayerWorldMatrix(propAt(1_000)).tx).toBeGreaterThan(worldPropAtPickup.tx);
    expect(propAt(2_000).effectiveDepth).toBe(-200);
    expect(propAt(3_000).effectiveDepth).toBe(-200);
    expectMatrixClose(evaluatedLayerWorldMatrix(propAt(3_250)), evaluatedLayerWorldMatrix(propAt(2_750)));
    const propCopy = layerService.duplicateLayer(withSecondShot, IDS.shot, propLayerId, destShotId, 2_000);
    const copiedShot = propCopy.project.shots.find(({ id }) => id === destShotId)!;
    const exportedCopy = evaluateExportShotAtTime(propCopy.project, copiedShot, 0).layers.find(({ id }) => id === propCopy.layer.id)!;
    expect(propCopy.layer.parentKeys).toBeUndefined();
    expect(exportedCopy.effectiveDepth).toBe(-200);
    expect(resolveLayerCameraTransform(exportedCopy, camManual, 1920, 1080))
      .toEqual(resolveLayerCameraTransform(propAt(2_000), camManual, 1920, 1080));

    // Verify export drawing layers, parallax magnification, and fixed HUD at t=1000ms.
    const formal1000 = evaluateExportShotAtTime(reopened, shot, 1_000);
    const drawn1000 = selectExportDrawingLayers(formal1000);
    const drawnIds1000 = drawn1000.layers.map(({ id }) => id);
    expect(drawnIds1000).not.toContain(fgControl.layer.id);
    expect(drawnIds1000).not.toContain(carrierB.layer.id);
    expect(drawnIds1000).not.toContain(hiddenCarrier.layer.id);
    expect(drawnIds1000).toContain(fgBadge.layer.id);
    expect(drawnIds1000).toContain(fxLayerId);
    expect(drawnIds1000).toContain(hud.layer.id);

    const urls = Object.fromEntries(collectExportPreparationMedia(reopened).map(({ asset }) => [asset.id, `asset:${asset.id}`]));
    const cam1000 = cameraAt(1_000)!;
    const renderModel = buildStageRenderModel(reopened, drawn1000, urls, undefined, { camera: cam1000 });
    expect(renderModel.layers.at(-1)?.id).toBe(hud.layer.id);
    expect(resolveLayerCameraTransform(renderModel.layers.at(-1)!, cam1000, 1920, 1080)).toEqual({
      x: 960,
      y: 540,
      offsetX: 960,
      offsetY: 540,
      scaleX: 1,
      scaleY: 1,
      rotation: -0,
    });
    const fgRender = renderModel.layers.find(({ id }) => id === fgBadge.layer.id)!;
    const propRender = renderModel.layers.find(({ id }) => id === propLayerId)!;
    expect(resolveLayerCameraTransform(fgRender, cam1000, 1920, 1080)!.scaleX).toBeGreaterThan(
      resolveLayerCameraTransform(propRender, cam1000, 1920, 1080)!.scaleX,
    );

    // Random seek === sequential playback for both shot evaluation and hybrid camera.
    const sampleTimes = [0, 500, 1_000, 1_500, 1_750, 2_250, 2_750, 3_250];
    const seqShots = sampleTimes.map((t) => evaluateExportShotAtTime(reopened, shot, t));
    const seqCams = sampleTimes.map((t) => cameraAt(t));
    const randomOrder = [5, 1, 7, 3, 0, 6, 2, 4];
    for (const idx of randomOrder) {
      const t = sampleTimes[idx]!;
      expect(evaluateExportShotAtTime(reopened, shot, t)).toEqual(seqShots[idx]);
      expect(cameraAt(t)).toEqual(seqCams[idx]);
    }

    // Selected-object export isolates only the target layer with null background.
    const isolated = evaluateExportShotAtTime(reopened, shot, 1_000, undefined, undefined, propLayerId);
    expect(isolated.backgroundLayerId).toBeNull();
    expect(isolated.layers.map(({ id }) => id)).toEqual([propLayerId]);
  });
});
