import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addShotCameraOverride,
  cameraLayerTransform,
  evaluateShotAtTime,
  evaluatedLayerWorldMatrix,
  inspectAnimationCurve,
  isFlaGraphicDefinition,
  LayerService,
  moveShotCameraOverride,
  prepareShotCamera,
  PROJECT_SCHEMA_VERSION,
  projectShotDialogueVisual,
  ProjectSchema,
  resolveLayerAnimationTimeLink,
  sampleAnimationEaseCurve,
  setLayerAnimationTimeLink,
  setLayerDepth,
  setShotCameraKey,
  setShotCameraMode,
  ShotService,
  signedFrameOffsetMs,
  type Layer,
  type LayerAttachmentTarget,
  type Project,
} from '../../src/domain';
import * as characterPartAnimationModule from '../../src/domain/character-part-animation';
import * as evaluateFlaGraphicModule from '../../src/domain/evaluate-fla-graphic';
import * as evaluateShotModule from '../../src/domain/evaluate-shot-at-time';
import { evaluateFormalExportFrame } from '../../src/export-renderer/evaluateExportShotAtTime';
import { buildParentChainViewModel } from '../../src/renderer/features/properties/parentChainModel';
import { previewCameraOverrideDrag } from '../../src/renderer/features/timeline/cameraOverrideGesture';
import { DepthPreviewStore } from '../../src/renderer/stores/depthPreviewStore';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { LayerStore } from '../../src/renderer/stores/layerStore';
import { LayerSelectionStore } from '../../src/renderer/stores/selectionStore';
import { resolveSelectedCameraOverride, ShotStore } from '../../src/renderer/stores/shotStore';
import { buildDialogueSubtitleCues } from '../../src/shared/preview/dialogue-subtitle';
import { characterActionGraphicFixture } from '../helpers/characterActionGraphicFixture';
import { addTestAnimation, characterPartAnimationFixture } from '../helpers/characterPartAnimationFixture';
import { IDS } from './domain/testProject';

function buildJointFixture() {
  const base = characterActionGraphicFixture(false);
  const graphic = base.animations[0]!;
  if (!isFlaGraphicDefinition(graphic) || !graphic.structure) {
    throw new Error('Expected structured Graphic fixture.');
  }

  const identity = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
  const translate = (tx: number, ty: number) => ({ a: 1, b: 0, c: 0, d: 1, tx, ty });
  const baseFrame = graphic.frames[0]!;
  const frameDurationMs = 250;
  graphic.source.sourceFps = 4;
  graphic.source.startFrameIndex = 0;
  graphic.source.endFrameIndex = 3;
  graphic.durationMs = frameDurationMs * 4;
  graphic.frames = [0, 1, 2, 3].map((ordinal) => ({
    ...baseFrame,
    ordinal,
    sourceFrameIndex: ordinal,
    startMs: ordinal * frameDurationMs,
    durationMs: frameDurationMs,
  }));
  graphic.structure.symbolDefinitions = {
    'arm-def': {
      symbolRef: 'Arm',
      sourceFrameCount: 1,
      children: [
        {
          type: 'bitmap',
          id: 'hand',
          sourceAddress: 'Arm/hand',
          bitmapRef: 'Hand',
          assetId: IDS.assetChar2,
          drawOrder: 0,
          localTransform: identity,
        },
      ],
    },
  };
  graphic.structure.frames = [0, 1, 2, 3].map((ordinal) => ({
    ordinal,
    layers: [
      {
        name: 'Rig',
        nodes: [
          {
            type: 'symbol',
            id: `f${ordinal}-left`,
            sourceAddress: 'Rig/LeftArm',
            symbolRef: 'Arm',
            nestedDefinitionId: 'arm-def',
            drawOrder: 0,
            localTransform: translate(100 + ordinal * 40, 120),
          },
          {
            type: 'bitmap',
            id: `f${ordinal}-badge`,
            sourceAddress: 'Rig/Badge',
            bitmapRef: 'Badge',
            assetId: IDS.assetChar2,
            drawOrder: 1,
            localTransform: translate(260 + ordinal * 20, 80),
          },
        ],
      },
    ],
  }));

  const layerService = new LayerService();
  const placedGraphic = layerService.createFromAnimation(base, IDS.shot, {
    animationId: graphic.id,
    startTimeMs: 0,
    position: { x: 960, y: 540 },
  });
  const placedLinkedFx = layerService.createFromAnimation(placedGraphic.project, IDS.shot, {
    animationId: graphic.id,
    startTimeMs: 0,
    position: { x: 1200, y: 480 },
  });

  const actorLayerId = placedLinkedFx.project.shots[0]!.layers.find(
    (layer) => layer.source.kind === 'character',
  )!.id;
  const character = placedLinkedFx.project.characters[0]!;
  const imageAsset = placedLinkedFx.project.assets.find((asset) => asset.kind === 'image')!;

  const makeAssetLayer = (name: string, zIndex: number, x: number, y: number, extra: Partial<Layer> = {}): Layer => ({
    id: randomUUID(),
    name,
    source: { kind: 'asset', assetId: imageAsset.id },
    anchor: 'center',
    x,
    y,
    scaleX: 1,
    scaleY: 1,
    rotationDeg: 0,
    opacity: 1,
    zIndex,
    locked: false,
    visible: true,
    flipX: false,
    ...extra,
  });

  const propA = makeAssetLayer('道具A', 10, 800, 500, { depth: 120 });
  const propB = makeAssetLayer('道具B', 11, 1080, 520, { depth: -80 });
  const hudLayer = makeAssetLayer('HUD字幕框', 20, 960, 120, { cameraSpace: 'screen' });

  const dialogueId = randomUUID();
  const shot0 = placedLinkedFx.project.shots[0]!;
  const existingActionEvent = shot0.timelineEvents.find((event) => event.type === 'character-action')!;
  const project: Project = ProjectSchema.parse({
    ...placedLinkedFx.project,
    shots: placedLinkedFx.project.shots.map((shot) =>
      shot.id === IDS.shot
        ? {
            ...shot,
            durationMs: 2_500,
            layers: [...shot.layers, propA, propB, hudLayer],
            dialogues: [
              {
                id: dialogueId,
                characterId: character.id,
                voiceProfileId: character.defaultVoiceProfileId,
                text: '联合回归台词',
                startMs: 100,
                endMs: 900,
                subtitleStyleId: shot.defaultSubtitleStyleId,
              },
            ],
          }
        : shot,
    ),
  });

  return {
    project,
    shotId: shot0.id,
    actorLayerId,
    graphicLayerId: placedGraphic.layer.id,
    linkedFxLayerId: placedLinkedFx.layer.id,
    propAId: propA.id,
    propBId: propB.id,
    hudLayerId: hudLayer.id,
    actionEventId: existingActionEvent.id,
    actionEventStartMs: existingActionEvent.startMs,
    dialogueId,
  };
}

describe('Native Opt & Ext (#1393-#1403) joint regression', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('composes all 11 slices cleanly with seam integrity, v46 persistence, Undo/Redo, and random seek', () => {
    const fixture = buildJointFixture();
    const editorStore = new EditorProjectStore();
    editorStore.open('D:/joint-native-opt-ext.pandastage', fixture.project);
    const shotService = new ShotService();
    const layerService = new LayerService();
    const shotStore = new ShotStore(editorStore, shotService);
    shotStore.select(fixture.shotId);
    const selectionStore = new LayerSelectionStore(editorStore, shotStore);
    const layerStore = new LayerStore(editorStore, shotStore, layerService, selectionStore);
    const depthPreviewStore = new DepthPreviewStore({
      editorStore,
      shotSelection: shotStore,
      layerSelection: selectionStore,
      timeline: {
        getSnapshot: () => ({ currentTimeMs: 0 }),
        subscribe: () => () => {},
      },
    });

    const currentProject = () => editorStore.getSnapshot()!.project;
    const currentShot = () => currentProject().shots.find((s) => s.id === fixture.shotId)!;

    // 1. OPT-01 (#1393): Attach propA & propB to two nodes of the same Graphic -> 1 Graphic eval per owner
    const targetHand: LayerAttachmentTarget = {
      kind: 'graphic-node',
      identityPath: ['addr:Rig/LeftArm', 'addr:Arm/hand'],
    };
    const targetBadge: LayerAttachmentTarget = {
      kind: 'graphic-node',
      identityPath: ['addr:Rig/Badge'],
    };
    let p = layerService.setParent(currentProject(), fixture.shotId, fixture.propAId, fixture.graphicLayerId, 0, targetHand);
    p = layerService.setParent(p, fixture.shotId, fixture.propBId, fixture.graphicLayerId, 0, targetBadge);
    editorStore.updateProject(p, 'Attach props to Graphic nodes');

    const graphicSpy = vi.spyOn(evaluateFlaGraphicModule, 'evaluateFlaGraphicVisual');
    const evalAt250 = evaluateShotAtTime(currentShot(), 250, currentProject());
    expect(graphicSpy).toHaveBeenCalledTimes(1); // 1 Graphic attachment owner evaluated once for both children
    expect(evalAt250.layers.find((l) => l.id === fixture.propAId)?.parentSpace).toBeTruthy();
    expect(evalAt250.layers.find((l) => l.id === fixture.propBId)?.parentSpace).toBeTruthy();
    graphicSpy.mockRestore();

    // 2. EXT-01 (#1399) + OPT-02B (#1396) + EXT-02 (#1401): Batch create controller & bind + dynamic handoff + parent chain view
    const revBeforeBatch = editorStore.getSnapshot()!.revision;
    const controller = layerStore.createControllerAndBindLayers([fixture.propAId, fixture.propBId], 0);
    expect(editorStore.getSnapshot()!.revision).toBe(revBeforeBatch + 1);
    expect(controller.source).toEqual({ kind: 'control' });

    // Add a dynamic parent handoff on propA at 500ms to actorLayerId, then move it to 750ms (OPT-02B)
    const withHandoff = layerService.setParentKey(currentProject(), fixture.shotId, fixture.propAId, 500, fixture.actorLayerId);
    editorStore.updateProject(withHandoff, 'Add parent handoff');
    const movedHandoff = layerService.moveParentKey(currentProject(), fixture.shotId, fixture.propAId, 500, 750);
    editorStore.updateProject(movedHandoff, 'Move parent handoff');

    const revBeforeChain = editorStore.getSnapshot()!.revision;
    const chainAt250 = buildParentChainViewModel(currentShot(), 250, fixture.propAId);
    const chainAt1000 = buildParentChainViewModel(currentShot(), 1_000, fixture.propAId);
    expect(editorStore.getSnapshot()!.revision).toBe(revBeforeChain); // Strictly read-only
    expect(chainAt250.rows.find((r) => r.layer.id === fixture.propAId)?.activeParentId).toBe(controller.id);
    expect(chainAt1000.rows.find((r) => r.layer.id === fixture.propAId)?.activeParentId).toBe(fixture.actorLayerId);

    // 3. OPT-03 (#1397): Depth preview store & committed depth parallax vs HUD screen-space invariance
    const depthUpdated = setLayerDepth(currentProject(), fixture.shotId, fixture.propBId, 300);
    editorStore.updateProject(depthUpdated, 'Adjust depth');
    selectionStore.select(fixture.propBId);
    const depthHandle = depthPreviewStore.begin(fixture.propBId, 300);
    expect(depthHandle).not.toBeNull();
    expect(depthHandle!.setDepth(450)).toBe(true);
    expect(depthPreviewStore.getSnapshot()?.depth).toBe(450);
    depthHandle!.cancel();
    expect(depthPreviewStore.getSnapshot()).toBeNull();
    depthPreviewStore.dispose();

    // 4. EXT-04 (#1402) + EXT-03 (#1400) + Seam: Hybrid autoFraming preserved across camera motion preset
    const hybridMode = setShotCameraMode(currentProject(), fixture.shotId, 'hybrid');
    const withAutoFraming = shotService.setCameraAutoFraming(hybridMode, fixture.shotId, {
      zoom: 1.45,
      targetU: 0.42,
      targetV: 0.38,
    });
    editorStore.updateProject(withAutoFraming, 'Configure Hybrid autoFraming');

    const presetOverrideId = randomUUID();
    const withPreset = shotService.applyCameraMotionPreset(currentProject(), fixture.shotId, {
      preset: 'push-in',
      startTimeMs: 1_000,
      durationMs: 500,
      amplitude: 1.3,
      easing: 'ease-in-out',
      hybridAction: 'create-override',
      overrideId: presetOverrideId,
    });
    editorStore.updateProject(withPreset, 'Apply camera preset');

    // Seam verification: autoFraming MUST be preserved after applyCameraMotionPreset!
    expect(currentShot().camera?.autoFraming).toEqual({ zoom: 1.45, targetU: 0.42, targetV: 0.38 });
    expect(currentShot().camera?.overrides?.some((o) => o.id === presetOverrideId)).toBe(true);

    // 5. OPT-02A (#1395) + Seam: ShotStore override selection + direct drag gesture
    shotStore.selectCameraOverride(presetOverrideId);
    expect(shotStore.getSelectedCameraOverrideId()).toBe(presetOverrideId);
    const resolvedOverride = resolveSelectedCameraOverride(currentShot(), shotStore.getSelectedCameraOverrideId(), 0);
    expect(resolvedOverride?.id).toBe(presetOverrideId);

    const dragged = previewCameraOverrideDrag({
      override: resolvedOverride!,
      overrides: currentShot().camera!.overrides!,
      mode: 'move',
      deltaPx: 25,
      pixelsPerMs: 0.1, // +250ms
      durationMs: currentShot().durationMs,
    });
    const keysBeforeMove = currentShot().camera!.keys;
    const movedOverride = moveShotCameraOverride(
      currentProject(),
      fixture.shotId,
      presetOverrideId,
      dragged.startMs,
    );
    editorStore.updateProject(movedOverride, 'Move camera override');
    expect(currentShot().camera!.keys).toEqual(keysBeforeMove); // Global camera keys untouched

    // 6. OPT-04 (#1398): Curve inspection & custom bezier edit on camera segment
    const presetStartKey = currentShot().camera!.keys.find((k) => k.timeMs === 1_000)!;
    const withCustomCurve = setShotCameraKey(currentProject(), fixture.shotId, presetStartKey.timeMs, {
      curveToNext: { bezier: { x1: 0.2, y1: 0.1, x2: 0.8, y2: 0.9 } },
    });
    editorStore.updateProject(withCustomCurve, 'Edit camera easing curve');
    const updatedKey = currentShot().camera!.keys.find((k) => k.timeMs === 1_000)!;
    const inspected = inspectAnimationCurve(updatedKey.interpolationToNext, updatedKey.curveToNext);
    expect(inspected.canDragHandles).toBe(true);
    const sampled = sampleAnimationEaseCurve(updatedKey.interpolationToNext, updatedKey.curveToNext, 16);
    expect(sampled.length).toBe(17);

    // 7. EXT-05 (#1403): Signed offsetMs on animationTimeLink
    const signedOffset = signedFrameOffsetMs(-3); // -125ms
    const withTimeLink = setLayerAnimationTimeLink(currentProject(), fixture.shotId, fixture.linkedFxLayerId, {
      kind: 'character-action',
      sourceLayerId: fixture.actorLayerId,
      eventId: fixture.actionEventId,
      offsetMs: signedOffset,
    });
    editorStore.updateProject(withTimeLink, 'Bind signed time-link offset');
    const resolvedLink = resolveLayerAnimationTimeLink(
      currentShot(),
      currentShot().layers.find((l) => l.id === fixture.linkedFxLayerId)!,
    );
    expect(resolvedLink).toMatchObject({
      status: 'active',
      offsetMs: signedOffset,
      startMs: fixture.actionEventStartMs + signedOffset,
    });

    // 8. OPT-01B (#1394): Single-pass formal export evaluation
    const evalSpy = vi.spyOn(evaluateShotModule, 'evaluateShotAtTime');
    const cues = buildDialogueSubtitleCues(currentShot().dialogues);
    const exportFrame = evaluateFormalExportFrame(currentProject(), currentShot(), 250, cues);
    expect(evalSpy).toHaveBeenCalledTimes(1);
    expect(exportFrame.subtitle?.id).toBe(fixture.dialogueId);
    evalSpy.mockRestore();

    // 9. Save/Reopen v46 parse round-trip
    const serialized = JSON.stringify(currentProject());
    const reopened = ProjectSchema.parse(JSON.parse(serialized));
    expect(reopened.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(reopened.shots[0]!.camera?.autoFraming).toEqual({ zoom: 1.45, targetU: 0.42, targetV: 0.38 });
    expect(
      reopened.shots[0]!.layers.find((l) => l.id === fixture.linkedFxLayerId)?.animationTimeLink?.offsetMs,
    ).toBe(signedOffset);

    // 10. Undo / Redo consistency
    const revBeforeUndo = editorStore.getSnapshot()!.revision;
    editorStore.undo();
    expect(editorStore.getSnapshot()!.revision).toBe(revBeforeUndo + 1);
    expect(
      currentShot().layers.find((l) => l.id === fixture.linkedFxLayerId)?.animationTimeLink,
    ).toBeUndefined();
    editorStore.redo();
    expect(
      currentShot().layers.find((l) => l.id === fixture.linkedFxLayerId)?.animationTimeLink?.offsetMs,
    ).toBe(signedOffset);

    // 11. Random seek determinism & HUD screen-space projection invariance
    const cameraPlan = prepareShotCamera(reopened, reopened.shots[0]!, 'speaker-focus');
    const seekTimes = [1_750, 0, 1_250, 250, 2_200, 500, 1_000];
    for (const t of seekTimes) {
      const evaluated = evaluateShotAtTime(reopened.shots[0]!, t, reopened);
      const view = cameraPlan(t);
      expect(view).toBeDefined();
      const hudEval = evaluated.layers.find((l) => l.id === fixture.hudLayerId)!;
      const hudProj = cameraLayerTransform(view, reopened.width, reopened.height, hudEval.effectiveDepth ?? 0, 'screen');
      expect(hudProj).toEqual({
        x: reopened.width / 2,
        y: reopened.height / 2,
        offsetX: reopened.width / 2,
        offsetY: reopened.height / 2,
        scaleX: 1,
        scaleY: 1,
        rotation: -0,
      });
      for (const layer of evaluated.layers) {
        const m = evaluatedLayerWorldMatrix(layer);
        expect(Number.isFinite(m.tx) && Number.isFinite(m.ty)).toBe(true);
      }
    }

    // Add an extra override and confirm ShotStore auto-clears selected override when switching away from hybrid
    const withSecondOverride = addShotCameraOverride(currentProject(), fixture.shotId, {
      id: randomUUID(),
      startMs: 0,
      endMs: 400,
    });
    editorStore.updateProject(withSecondOverride, 'Add second override');
    const switchedToStatic = setShotCameraMode(currentProject(), fixture.shotId, 'static');
    editorStore.updateProject(switchedToStatic, 'Switch camera to static');
    expect(shotStore.getSelectedCameraOverrideId()).toBeNull();
  });

  it('preserves #1389 head-motion attachment cache isolation with 1 part-clip eval per owner', () => {
    const data = characterPartAnimationFixture();
    const service = new LayerService();
    const dialogueId = randomUUID();
    const animated = addTestAnimation(data.project, data.layerId, data.imagePartId, 'transform.offsetX', 80);
    const prop1 = service.updatePosition(animated, IDS.shot, IDS.layerAsset, { x: 500, y: 600 });
    const prop2 = service.duplicateLayer(prop1, IDS.shot, IDS.layerAsset);
    const voiceId = prop2.project.characters.find(({ id }) => id === data.characterId)!.defaultVoiceProfileId;
    let project = ProjectSchema.parse({
      ...prop2.project,
      characters: prop2.project.characters.map((character) =>
        character.id === data.characterId && character.mode === 'adaptive-parts'
          ? {
              ...character,
              headMotionBinding: { partIds: [data.imagePartId] },
              talkingHeadMotionIntensityPercent: 100,
            }
          : character,
      ),
      shots: prop2.project.shots.map((shot) =>
        shot.id === IDS.shot
          ? {
              ...shot,
              dialogues: [
                {
                  id: dialogueId,
                  characterId: data.characterId,
                  voiceProfileId: voiceId,
                  text: '头部跟随测试',
                  startMs: 0,
                  endMs: 1_000,
                  subtitleStyleId: shot.defaultSubtitleStyleId,
                },
              ],
            }
          : shot,
      ),
    });

    const headTarget: LayerAttachmentTarget = { kind: 'character-part', partId: data.imagePartId };
    project = service.setParent(project, IDS.shot, IDS.layerAsset, data.layerId, 625, headTarget);
    project = service.setParent(project, IDS.shot, prop2.layer.id, data.layerId, 625, headTarget);

    const partComposeSpy = vi.spyOn(characterPartAnimationModule, 'composeAnimatedCharacterPartTransform');
    const shot = project.shots[0]!;
    const character = project.characters.find(({ id }) => id === data.characterId)!;
    const partCount = character.mode === 'adaptive-parts' ? character.parts.length : 0;

    const baseEval = evaluateShotAtTime(shot, 625, project);
    expect(partComposeSpy).toHaveBeenCalledTimes(partCount);
    partComposeSpy.mockClear();

    const withHeadMotion = projectShotDialogueVisual(project, shot, baseEval, dialogueId);
    expect(partComposeSpy).toHaveBeenCalledTimes(partCount);
    const baseWorld = evaluatedLayerWorldMatrix(baseEval.layers.find((l) => l.id === IDS.layerAsset)!);
    const headWorld = evaluatedLayerWorldMatrix(withHeadMotion.layers.find((l) => l.id === IDS.layerAsset)!);
    expect(Math.hypot(headWorld.tx - baseWorld.tx, headWorld.ty - baseWorld.ty)).toBeGreaterThan(0.1);
  });
});
