import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CharacterMotionService,
  CharacterService,
  LayerService,
  ProjectSchema,
  characterCompositeKeyEasing,
  characterCompositeKeyTimes,
  characterMotionValues,
  evaluateShotAtTime,
  projectShotDialogueVisual,
  resolveLayerVisualParts,
  type FlaGraphicDefinition,
} from '../../src/domain';
import { evaluateExportShotAtTime } from '../../src/export-renderer/evaluateExportShotAtTime';
import { ProjectService } from '../../src/main/services/ProjectService';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { CharacterMotionGesture } from '../../src/renderer/features/canvas/characterMotionGesture';
import { buildEditorTemporalCanvasModel } from '../../src/renderer/features/canvas/editorTemporalCanvasModel';
import { buildProductPreviewImagePlan } from '../../src/renderer/shell/productPreviewModel';
import { buildStageRenderModel } from '../../src/shared/stage/render-model';
import { adaptivePartsFixture } from '../helpers/adaptivePartsFixtures';
import { characterPartAnimationFixture } from '../helpers/characterPartAnimationFixture';
import { FACE_GRAPHIC_ID, graphicFaceProject } from '../helpers/graphicFaceProject';
import { IDS } from '../unit/domain/testProject';

describe('Character Motion authoring integration', () => {
  it('keeps shared Definition playback and the second instance intact through author/Undo/Redo', () => {
    const fixture = characterPartAnimationFixture();
    const placed = new LayerService().createFromAdaptiveCharacter(fixture.project, IDS.shot, fixture.characterId, { x: 400, y: 400 });
    const editor = new EditorProjectStore(); editor.open('D:/test-motion-integration', placed.project);
    const before = editor.getSnapshot()!.project;
    const visual = (layerId: string, timeMs: number) => {
      const project = editor.getSnapshot()!.project, shot = project.shots[0]!;
      return resolveLayerVisualParts(project, shot, evaluateShotAtTime(shot, timeMs, project).layers.find(l => l.id === layerId)!, timeMs);
    };
    const secondVisual = visual(placed.layer.id, 500);
    new CharacterMotionGesture(editor, { shotId: IDS.shot, layerId: fixture.layerId, partId: fixture.graphicPartId, timeMs: 500, autoKey: true }, () => true).commit({ 'transform.rotationDeg': 90 });
    const after = editor.getSnapshot()!.project;
    expect(after.animations).toEqual(before.animations);
    expect(after.characters).toEqual(before.characters);
    expect(after.shots[0]!.layers.find(l => l.id === placed.layer.id)).toEqual(before.shots[0]!.layers.find(l => l.id === placed.layer.id));
    expect(visual(placed.layer.id, 500)).toEqual(secondVisual);
    expect([0, 250, 500].map(time => visual(fixture.layerId, time).parts[1]!.flaGraphic!.frameOrdinal)).toEqual([0, 1, 2]);
    const authoredVisual = visual(fixture.layerId, 500);
    expect(authoredVisual.parts[1]!.imageTransform!.a).toBeCloseTo(0);
    editor.undo(); expect(editor.getSnapshot()!.project).toEqual(before);
    editor.redo(); expect(editor.getSnapshot()!.project).toEqual(after);
    expect(visual(fixture.layerId, 500)).toEqual(authoredVisual);
  });

  it('completes 3-Part ~3s UAT authoring flow (multi-key batch shift, copy/paste, easing, Undo/Redo, Save/Reopen, Stage/Preview/Export agreement) (#1131)', async () => {
    const initial = graphicFaceProject();
    const definition = initial.animations[0] as FlaGraphicDefinition;
    definition.source.sourceFps = 4;
    definition.durationMs = 1000;
    definition.frames = definition.frames.map((frame, index) => ({ ...frame, startMs: index * 250, durationMs: 250 }));
    const baseParts = adaptivePartsFixture(IDS.assetChar);
    const parts = [
      { ...baseParts[0]!, displayName: '右手' },
      {
        ...baseParts[1]!,
        displayName: '头',
        assetId: undefined,
        imageMapping: undefined,
        visualSource: { kind: 'fla-graphic' as const, animationId: FACE_GRAPHIC_ID },
      },
      { ...baseParts[2]!, displayName: '左手' },
    ];
    const withChar = new CharacterService().createAdaptiveParts(ProjectSchema.parse(initial), {
      name: 'V1 Three Part Character',
      sourceRootTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
      parts,
    });
    const characterId = withChar.characters.at(-1)!.id;
    const firstLayer = new LayerService().createFromAdaptiveCharacter(withChar, IDS.shot, characterId, { x: 800, y: 500 });
    const secondLayer = new LayerService().createFromAdaptiveCharacter(firstLayer.project, IDS.shot, characterId, { x: 1300, y: 500 });
    const [rightHandId, headId, leftHandId] = parts.map((p) => p.partId) as [string, string, string];

    const editor = new EditorProjectStore();
    editor.open('D:/test-v1-uat-3s', secondLayer.project);
    const motion = new CharacterMotionService();
    const layerId = firstLayer.layer.id;
    const layerOf = (project = editor.getSnapshot()!.project, targetLayerId = layerId) =>
      project.shots[0]!.layers.find((l) => l.id === targetLayerId)!;

    // 1. Auto-key 500ms pose on Right Hand + Head + Left Hand; copy/paste hold at 1500ms; return at 2500ms; stray key at 2000ms.
    new CharacterMotionGesture(editor, { shotId: IDS.shot, layerId, partId: rightHandId, timeMs: 500, autoKey: true }, () => true)
      .commit({ 'transform.offsetX': 25, 'transform.offsetY': -40, 'transform.rotationDeg': -45 });
    new CharacterMotionGesture(editor, { shotId: IDS.shot, layerId, partId: headId, timeMs: 500, autoKey: true }, () => true)
      .commit({ 'transform.rotationDeg': 18 });
    new CharacterMotionGesture(editor, { shotId: IDS.shot, layerId, partId: leftHandId, timeMs: 500, autoKey: true }, () => true)
      .commit({ 'transform.offsetY': 12 });

    const pose500 = characterMotionValues(editor.getSnapshot()!.project, { shotId: IDS.shot, layerId, partId: rightHandId, timeMs: 500, autoKey: true });
    editor.updateProject(motion.pasteCompositePose(editor.getSnapshot()!.project, { shotId: IDS.shot, layerId, partId: rightHandId, targetTimeMs: 1500, pose: pose500 }), 'Paste hold');
    editor.updateProject(motion.apply(editor.getSnapshot()!.project, { shotId: IDS.shot, layerId, partId: rightHandId, timeMs: 2500, autoKey: true }, { 'transform.offsetX': 0, 'transform.offsetY': 0, 'transform.rotationDeg': 0 }), 'Return hand');
    editor.updateProject(motion.apply(editor.getSnapshot()!.project, { shotId: IDS.shot, layerId, partId: rightHandId, timeMs: 2000, autoKey: true }, { 'transform.offsetX': 99 }), 'Mistake key');
    editor.updateProject(motion.deleteCompositeKey(editor.getSnapshot()!.project, { shotId: IDS.shot, layerId, partId: rightHandId, timeMs: 2000 }), 'Delete mistake');

    // 2. Batch shift [500, 1500] by +250ms -> [750, 1750] as ONE History command, then tune easing.
    const beforeBatch = editor.getSnapshot()!.project;
    editor.updateProject(motion.retimeCompositeKeys(beforeBatch, { shotId: IDS.shot, layerId, partId: rightHandId, fromTimesMs: [500, 1500], deltaMs: 250 }), 'Batch shift');
    expect(characterCompositeKeyTimes(layerOf(), rightHandId)).toEqual([0, 750, 1750, 2500]);
    editor.updateProject(motion.setCompositeKeyEasing(editor.getSnapshot()!.project, { shotId: IDS.shot, layerId, partId: rightHandId, timeMs: 750, interpolationToNext: 'ease-in-out' }), 'Set easing');
    expect(characterCompositeKeyEasing(layerOf(), rightHandId, 750)).toBe('ease-in-out');

    // Undo / Redo easing + batch shift.
    const afterAll = editor.getSnapshot()!.project;
    editor.undo();
    editor.undo();
    expect(editor.getSnapshot()!.project).toEqual(beforeBatch);
    editor.redo();
    editor.redo();
    expect(editor.getSnapshot()!.project).toEqual(afterAll);
    expect(layerOf(afterAll, secondLayer.layer.id)).toEqual(secondLayer.layer);

    // 3. Minimal Save / Reopen / Editor Stage / Product Preview / Export agreement.
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'panda-v103-uat-'));
    try {
      const root = path.join(tempDir, 'uat.pandastage');
      await mkdir(root);
      await writeFile(path.join(root, 'project.json'), JSON.stringify(secondLayer.project));
      await new ProjectService().save(root, afterAll, 1);
      const reopened = (await new ProjectService().open(root)).project;
      expect(reopened).toEqual(afterAll);

      const shot = reopened.shots[0]!;
      const readyAssets = new Set(reopened.assets.map((asset) => asset.id));
      const assetUrls = Object.fromEntries(reopened.assets.map((asset) => [asset.id, `test:${asset.id}`]));
      for (const sampleTimeMs of [0, 500, 750, 1250, 1750, 2500]) {
        const editorModel = buildEditorTemporalCanvasModel({
          project: reopened,
          shot,
          currentTimeMs: sampleTimeMs,
          readyAssetIds: readyAssets,
          previousVisuals: new Map(),
        });
        const previewShot = projectShotDialogueVisual(reopened, shot, evaluateShotAtTime(shot, sampleTimeMs, reopened), null);
        expect(() => buildProductPreviewImagePlan(reopened, shot, previewShot)).not.toThrow();
        const previewModel = buildStageRenderModel(reopened, previewShot, assetUrls);
        const exportModel = buildStageRenderModel(reopened, evaluateExportShotAtTime(reopened, shot, sampleTimeMs), assetUrls);
        expect(previewModel.layers.map((l) => l.visual)).toEqual(editorModel.stageModel.layers.map((l) => l.visual));
        expect(exportModel.layers.map((l) => l.visual)).toEqual(previewModel.layers.map((l) => l.visual));
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
