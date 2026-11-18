import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LayerMotionService,
  LayerService,
  PROJECT_SCHEMA_VERSION,
  ProjectSchema,
  evaluateShotAtTime,
  layerCompositeKeyEasing,
  layerCompositeKeyTimes,
  type FlaGraphicDefinition,
  type Project,
} from '../../src/domain';
import { ProjectService } from '../../src/main/services/ProjectService';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { buildEditorTemporalCanvasModel } from '../../src/renderer/features/canvas/editorTemporalCanvasModel';
import { buildStageRenderModel } from '../../src/shared/stage/render-model';
import { evaluateExportShotAtTime } from '../../src/export-renderer/evaluateExportShotAtTime';
import { animationCoreFixture } from '../helpers/animationCoreFixture';
import { FACE_GRAPHIC_ID, graphicFaceProject } from '../helpers/graphicFaceProject';
import { IDS } from '../unit/domain/testProject';

describe('Layer Target V0 Character=0 tracer bullet E2E & persistence (#1140)', () => {
  it('runs Graphic Layer -> LayerMotionService -> Clip v2 -> Single History -> Save/Reopen -> Evaluate(500ms) with Character=0', async () => {
    const parent = await mkdtemp(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-layer-v2-'));
    try {
      const root = path.join(parent, 'layer-v0.pandastage');
      await mkdir(root);

      const base = graphicFaceProject();
      const definition = base.animations[0] as FlaGraphicDefinition;
      definition.source.sourceFps = 4;
      definition.durationMs = 1_000;
      definition.frames = definition.frames.map((frame, ordinal) => ({
        ...frame,
        startMs: ordinal * 250,
        durationMs: 250,
      }));
      const emptyProject: Project = ProjectSchema.parse({
        ...base,
        characters: [],
        voiceProfiles: [],
        shots: base.shots.map((shot) => ({
          ...shot,
          dialogues: [],
          timelineEvents: [],
          layers: shot.layers.filter((l) => l.id === shot.backgroundLayerId),
        })),
      });

      const placed = new LayerService().createFromAnimation(emptyProject, IDS.shot, {
        animationId: FACE_GRAPHIC_ID,
        position: { x: 500, y: 400 },
        startTimeMs: 0,
        playback: { mode: 'loop', endBehavior: 'hold' },
      });
      const layerId = placed.layer.id;

      // Hook into the existing EditorProjectStore + ProjectCommand single-History transaction seam.
      const store = new EditorProjectStore();
      store.open(root, placed.project);
      const motionService = new LayerMotionService();

      const beforeProject = store.getSnapshot()!.project;
      let afterProject = motionService.applyKeys(
        beforeProject,
        { shotId: IDS.shot, layerId, timeMs: 500 },
        {
          'transform.offsetX': 140,
          'transform.offsetY': -60,
          'transform.rotationDeg': 90,
          'transform.scaleX': 1.5,
          'transform.scaleY': 2,
        },
      );
      afterProject = motionService.applyKeys(
        afterProject,
        { shotId: IDS.shot, layerId, timeMs: 1_000 },
        { 'transform.offsetX': 280 },
      );
      afterProject = motionService.setKeyEasing(
        afterProject,
        { shotId: IDS.shot, layerId, timeMs: 500 },
        'ease-in-out',
      );

      store.updateProject(afterProject, '对象关键帧动作');
      expect(store.history.getSnapshot().undoCount).toBe(1);
      expect(store.history.undo()).toBe(true);
      expect(store.getSnapshot()!.project).toEqual(beforeProject);
      expect(store.history.redo()).toBe(true);
      expect(store.getSnapshot()!.project).toEqual(afterProject);

      const authoredProject = store.getSnapshot()!.project;
      expect(authoredProject.characters).toHaveLength(0);
      expect(authoredProject.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);

      // Save and Reopen via the single formal Main ProjectService seam.
      const projectService = new ProjectService();
      await writeFile(path.join(root, 'project.json'), JSON.stringify(emptyProject));
      await projectService.save(root, authoredProject, 1);

      const rawPersisted = JSON.parse(await readFile(path.join(root, 'project.json'), 'utf8'));
      expect(rawPersisted.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);

      const reopened = await projectService.open(root);
      expect(reopened.sourceVersion).toBe(PROJECT_SCHEMA_VERSION);
      expect(reopened.migrated).toBe(false);
      expect(reopened.project).toEqual(authoredProject);

      const authoredLayer = reopened.project.shots[0]!.layers.find((l) => l.id === layerId)!;
      expect(authoredLayer.animationClip?.version).toBe(2);
      expect(layerCompositeKeyTimes(authoredLayer)).toEqual([0, 500, 1_000]);
      expect(layerCompositeKeyEasing(authoredLayer, 500)).toBe('ease-in-out');

      // Single Shot evaluator at 500ms & 750ms (easing preserved!) matches before and after reopen.
      const shotBefore = authoredProject.shots[0]!;
      const shotAfter = reopened.project.shots[0]!;
      for (const timeMs of [0, 500, 750, 1_000]) {
        expect(evaluateShotAtTime(shotAfter, timeMs, reopened.project)).toEqual(
          evaluateShotAtTime(shotBefore, timeMs, authoredProject),
        );
      }
      const at500 = evaluateShotAtTime(shotAfter, 500, reopened.project).layers.find(
        (l) => l.id === layerId,
      )!;
      expect(at500).toMatchObject({
        x: 640,
        y: 340,
        scaleX: 1.5,
        scaleY: 2,
        rotationDeg: 90,
      });
      // At 750ms (halfway between 500ms ease-in-out 140 and 1000ms 280), ease-in-out(0.5) = 0.5 => offsetX = 210 => x = 710.
      const at750 = evaluateShotAtTime(shotAfter, 750, reopened.project).layers.find(
        (l) => l.id === layerId,
      )!;
      expect(at750.x).toBeCloseTo(710);

      // Verify Stage Render Model / Export consume the exact evaluated transform at 500ms.
      const urls = Object.fromEntries(reopened.project.assets.map((a) => [a.id, `test:${a.id}`]));
      const editorModel = buildEditorTemporalCanvasModel({
        project: reopened.project,
        shot: shotAfter,
        currentTimeMs: 500,
        readyAssetIds: new Set(reopened.project.assets.map((a) => a.id)),
        previousVisuals: new Map(),
      });
      const exportModel = buildStageRenderModel(
        reopened.project,
        evaluateExportShotAtTime(reopened.project, shotAfter, 500),
        urls,
      );
      const editorLayer = editorModel.stageModel.layers.find((l) => l.layer.id === layerId)!;
      const exportLayer = exportModel.layers.find((l) => l.id === layerId)!;
      expect(editorLayer.visual).toEqual(exportLayer.visual);
      expect(editorLayer.render).toMatchObject({ x: 640, y: 340, scaleX: 1.5, scaleY: 2, rotationDeg: 90 });
      expect(exportLayer.render).toMatchObject({ x: 640, y: 340, scaleX: 1.5, scaleY: 2, rotationDeg: 90 });
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it('upgrades a persisted v21 Character Clip v1 file on disk cleanly to the current version', async () => {
    const parent = await mkdtemp(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-v21-layer-'));
    try {
      const root = path.join(parent, 'v21.pandastage');
      await mkdir(root);
      const { project, clip, layerId } = animationCoreFixture();
      const v21OnDisk = { ...project, schemaVersion: 21 };
      await writeFile(path.join(root, 'project.json'), JSON.stringify(v21OnDisk));

      const opened = await new ProjectService().open(root);
      expect(opened.sourceVersion).toBe(21);
      expect(opened.migrated).toBe(true);
      expect(opened.project.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
      expect(opened.project.shots[0]!.layers.find((l) => l.id === layerId)!.animationClip).toEqual(clip);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
