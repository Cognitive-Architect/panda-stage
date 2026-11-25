import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LayerMotionService,
  LayerService,
  PROJECT_SCHEMA_VERSION,
  ProjectSchema,
  bakeRichEasingToPropertySegments,
  editAnimationPropertyKey,
  evaluateShotAtTime,
  frameTimeMs,
} from '../../src/domain';
import { ProjectService } from '../../src/main/services/ProjectService';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { buildEditorTemporalCanvasModel } from '../../src/renderer/features/canvas/editorTemporalCanvasModel';
import { projectProductPreviewDialogue } from '../../src/renderer/shell/productPreviewModel';
import { evaluateExportShotAtTime } from '../../src/export-renderer/evaluateExportShotAtTime';
import { iterateFormalProjectFrameSchedule } from '../../src/shared/export-types';
import { buildStageRenderModel } from '../../src/shared/stage/render-model';
import { FACE_GRAPHIC_ID, graphicFaceProject } from '../helpers/graphicFaceProject';

describe('Rich Easing persistence and Stage / Preview / Export alignment (#1292 C01)', () => {
  it('round-trips baked back-out overshoot & bounce-out rebound + manual key edit across save/reopen and aligns Stage, Preview, and Export', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'panda-stage-rich-easing-'));
    const root = path.join(tempDir, 'rich-easing.pandastage');
    try {
      await mkdir(root, { recursive: true });
      const base = graphicFaceProject();
      const cleanBase = ProjectSchema.parse({
        ...base,
        characters: [],
        voiceProfiles: [],
        shots: base.shots.map((shot) => ({
          ...shot,
          durationMs: 2_000,
          dialogues: [],
          timelineEvents: [],
          layers: shot.layers.filter((layer) => layer.id === shot.backgroundLayerId),
        })),
      });
      const shotId = cleanBase.shots[0]!.id;
      const placed = new LayerService().createFromAnimation(cleanBase, shotId, {
        animationId: FACE_GRAPHIC_ID,
        position: { x: 400, y: 300 },
        startTimeMs: 0,
        playback: { mode: 'loop', endBehavior: 'hold' },
      });
      const layerId = placed.layer.id;
      const motion = new LayerMotionService();
      let authored = motion.applyKeys(
        placed.project,
        { shotId, layerId, timeMs: 0 },
        { 'transform.offsetX': 0, 'transform.offsetY': 0 },
      );
      authored = motion.applyKeys(
        authored,
        { shotId, layerId, timeMs: 1_000 },
        { 'transform.offsetX': 200, 'transform.offsetY': 120 },
      );

      // Bake back-out on offsetX (produces overshoot > 200) and bounce-out on offsetY (produces rebound).
      const target = { kind: 'layer' as const, layerId };
      const bakedX = bakeRichEasingToPropertySegments(authored, {
        shotId,
        target,
        property: 'transform.offsetX',
        presetId: 'back-out',
        keyTimesMs: [0, 1_000],
      });
      const bakedXY = bakeRichEasingToPropertySegments(bakedX.project, {
        shotId,
        target,
        property: 'transform.offsetY',
        presetId: 'bounce-out',
        keyTimesMs: [0, 1_000],
      });

      // Verify overshoot on offsetX (> 200) and rebound on offsetY before manual edit.
      const bakedLayer = bakedXY.project.shots[0]!.layers.find((l) => l.id === layerId)!;
      const xKeys = bakedLayer.animationClip!.tracks.find((t) => t.property === 'transform.offsetX')!.keys;
      const yKeys = bakedLayer.animationClip!.tracks.find((t) => t.property === 'transform.offsetY')!.keys;
      const overshootKey = xKeys.find((k) => k.value > 200);
      expect(overshootKey).toBeDefined();
      const reboundIndex = yKeys.findIndex((k, idx) => idx > 0 && idx < yKeys.length - 1 && k.value < yKeys[idx - 1]!.value);
      expect(reboundIndex).toBeGreaterThan(0);

      // Commit via EditorProjectStore in one History entry, verify Undo/Redo.
      const store = new EditorProjectStore();
      store.open(root, authored);
      store.updateProject(bakedXY.project, '应用丰富缓动');
      expect(store.history.getSnapshot().undoCount).toBe(1);
      expect(store.undo()).toBe(true);
      expect(store.getSnapshot()!.project).toEqual(authored);
      expect(store.redo()).toBe(true);
      expect(store.getSnapshot()!.project).toEqual(bakedXY.project);

      // Manually edit one baked keyframe after baking and confirm it persists without re-baking.
      const manualKeyTime = frameTimeMs(6);
      const manuallyEdited = editAnimationPropertyKey(
        store.getSnapshot()!.project,
        { shotId, target, property: 'transform.offsetX', keyTimeMs: manualKeyTime },
        { value: 111.5 },
      );

      // Save and Reopen through formal Main ProjectService.
      await writeFile(path.join(root, 'project.json'), JSON.stringify(authored));
      const projectService = new ProjectService();
      await projectService.save(root, manuallyEdited, 1);
      const reopened = await projectService.open(root);
      expect(reopened.sourceVersion).toBe(PROJECT_SCHEMA_VERSION);
      expect(reopened.migrated).toBe(false);
      expect(reopened.project).toEqual(manuallyEdited);

      const reopenedShot = reopened.project.shots[0]!;
      const reopenedLayer = reopenedShot.layers.find((l) => l.id === layerId)!;
      expect(
        reopenedLayer.animationClip!.tracks
          .find((t) => t.property === 'transform.offsetX')!
          .keys.find((k) => k.timeMs === manualKeyTime)?.value,
      ).toBe(111.5);

      // Check Stage, Product Preview, and formal Export alignment across start, frame 1 (41/42ms), manual edit, overshoot, rebound, and end.
      const schedule = [...iterateFormalProjectFrameSchedule(reopened.project, 24)];
      expect(schedule[1]!.shotLocalTimeMs).toBe(41);
      const urls = Object.fromEntries(reopened.project.assets.map((asset) => [asset.id, `test:${asset.id}`]));
      const readyAssetIds = new Set(reopened.project.assets.map((asset) => asset.id));

      const sampleFrames = [
        0,
        1,
        6,
        Math.round((overshootKey!.timeMs * 24) / 1_000),
        Math.round((yKeys[reboundIndex]!.timeMs * 24) / 1_000),
        12,
        24,
      ];
      for (const frame of sampleFrames) {
        const stageMs = frameTimeMs(frame);
        const exportMs = schedule[frame]!.shotLocalTimeMs;
        const stageEval = evaluateShotAtTime(reopenedShot, stageMs, reopened.project);
        const previewEval = projectProductPreviewDialogue(reopened.project, reopenedShot, stageEval);
        const exportEval = evaluateExportShotAtTime(reopened.project, reopenedShot, exportMs);

        const stageLayer = stageEval.layers.find((l) => l.id === layerId)!;
        const previewLayer = previewEval.layers.find((l) => l.id === layerId)!;
        const exportLayer = exportEval.layers.find((l) => l.id === layerId)!;
        expect(previewLayer).toEqual(stageLayer);
        expect(exportLayer.x).toBeCloseTo(stageLayer.x, 6);
        expect(exportLayer.y).toBeCloseTo(stageLayer.y, 6);
        expect(exportLayer.scaleX).toBeCloseTo(stageLayer.scaleX, 6);
        expect(exportLayer.scaleY).toBeCloseTo(stageLayer.scaleY, 6);
        expect(exportLayer.rotationDeg).toBeCloseTo(stageLayer.rotationDeg, 6);
        expect(exportLayer.opacity).toBeCloseTo(stageLayer.opacity, 6);

        const editorModel = buildEditorTemporalCanvasModel({
          project: reopened.project,
          shot: reopenedShot,
          currentTimeMs: stageMs,
          readyAssetIds,
          previousVisuals: new Map(),
        });
        const exportModel = buildStageRenderModel(reopened.project, exportEval, urls);
        const editorRender = editorModel.stageModel.layers.find((l) => l.layer.id === layerId)!.render;
        const exportRender = exportModel.layers.find((l) => l.id === layerId)!.render;
        expect(exportRender.x).toBeCloseTo(editorRender.x, 6);
        expect(exportRender.y).toBeCloseTo(editorRender.y, 6);
        expect(exportRender.rotationDeg).toBeCloseTo(editorRender.rotationDeg, 6);
        expect(exportRender.scaleX).toBeCloseTo(editorRender.scaleX, 6);
        expect(exportRender.scaleY).toBeCloseTo(editorRender.scaleY, 6);
      }

      // Explicitly verify the overshoot frame renders x > 600 (base 400 + offset > 200).
      const atOvershoot = evaluateShotAtTime(reopenedShot, overshootKey!.timeMs, reopened.project)
        .layers.find((l) => l.id === layerId)!;
      expect(atOvershoot.x).toBeGreaterThan(600);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
