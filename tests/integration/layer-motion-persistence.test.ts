import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LayerMotionService,
  LayerService,
  PROJECT_SCHEMA_VERSION,
  ProjectSchema,
  editAnimationPropertyKey,
  evaluateShotAtTime,
  exportFrameTimeMs,
  frameTimeMs,
  layerCompositeKeyEasing,
  layerCompositeKeyTimes,
  migrateProject,
  recognizePositionChain,
  scanAssetReferences,
  smoothAudioMotionLevels,
  type FlaGraphicDefinition,
  type Project,
  type TimelineEvent,
} from '../../src/domain';
import { ProjectService } from '../../src/main/services/ProjectService';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { LayerStore } from '../../src/renderer/stores/layerStore';
import { LayerSelectionStore } from '../../src/renderer/stores/selectionStore';
import { buildEditorTemporalCanvasModel } from '../../src/renderer/features/canvas/editorTemporalCanvasModel';
import { buildStageRenderModel } from '../../src/shared/stage/render-model';
import { evaluateExportShotAtTime } from '../../src/export-renderer/evaluateExportShotAtTime';
import { projectProductPreviewDialogue } from '../../src/renderer/shell/productPreviewModel';
import { animationCoreFixture } from '../helpers/animationCoreFixture';
import { FACE_GRAPHIC_ID, graphicFaceProject } from '../helpers/graphicFaceProject';
import { IDS } from '../unit/domain/testProject';

describe('Layer Target V0 Character=0 tracer bullet E2E & persistence (#1140)', () => {
  it('skips a reference closing frame and synchronizes only consecutive editable source instances', async () => {
    const layers = new LayerService();
    let project = graphicFaceProject();
    const ids: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      const placed = layers.createFromAnimation(project, IDS.shot, {
        animationId: FACE_GRAPHIC_ID, startTimeMs: 0, position: { x: 550 + index * 125, y: 450 },
      });
      ids.push(placed.layer.id);
      project = placed.project;
    }
    const shot = project.shots[0]!;
    const blocked = shot.layers.find(({ id }) => id === ids[2])!;
    blocked.locked = true;
    const result = layers.applySourceLoop(project, IDS.shot, ids[0]!, {
      firstFrame: 0, lastFrame: 3, closingReference: true, throughLayerId: ids[3]!,
    });
    expect(result.stoppedAt).toBe(blocked.name);
    const edited = result.project.shots[0]!;
    expect(edited.layers.find(({ id }) => id === ids[1])?.animationSourceRange).toEqual({ firstFrame: 0, lastFrame: 2 });
    expect(edited.layers.find(({ id }) => id === ids[3])?.animationSourceRange).toBeUndefined();
    const live = edited.layers.find(({ id }) => id === ids[1])!;
    const independent = layers.updateAnimationPlayback(result.project, IDS.shot, ids[0]!, { mode: 'once' });
    expect(independent.shots[0]!.layers.find(({ id }) => id === ids[1])).toEqual(live);
    const reopened = migrateProject(JSON.parse(JSON.stringify(result.project)));
    for (const [time, ordinal] of [[125, 0], [42, 1], [83, 2], [0, 0], [167, 1]] as const) {
      const reopenedShot = reopened.shots[0]!;
      const stage = evaluateShotAtTime(reopenedShot, time, reopened);
      for (const output of [stage, projectProductPreviewDialogue(reopened, reopenedShot, stage), evaluateExportShotAtTime(reopened, reopenedShot, time)]) {
        expect(output.layers.find(({ id }) => id === ids[0])?.animationFrame?.frameOrdinal).toBe(ordinal);
      }
    }
  });
  it('writes audio energy as one editable key range while preserving untouched curves and silent sections', async () => {
    const parent = await mkdtemp(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-audio-motion-'));
    try {
      const root = path.join(parent, 'audio-motion.pandastage');
      await mkdir(root);
      const placed = new LayerService().createFromAnimation(graphicFaceProject(), IDS.shot, {
        animationId: FACE_GRAPHIC_ID, startTimeMs: 0, position: { x: 550, y: 450 },
      });
      const motion = new LayerMotionService();
      const target = { shotId: IDS.shot, layerId: placed.layer.id };
      let project = placed.project;
      for (const [timeMs, y] of [[500, 20], [750, 30], [1_500, 20], [2_000, 40]] as const) {
        project = motion.applyKeys(project, { ...target, timeMs }, { 'transform.offsetY': y });
      }
      project = editAnimationPropertyKey(project, {
        shotId: target.shotId, target: { kind: 'layer', layerId: target.layerId },
        property: 'transform.offsetY', keyTimeMs: 1_500,
      }, { interpolationToNext: 'step', curveToNext: {
        bezier: { x1: 0.25, y1: 0, x2: 0.8, y2: 0.2 }, window: [0.1, 0.8],
      } });
      const levels = smoothAudioMotionLevels([
        { timeMs: 625, level: 0.01 }, { timeMs: 750, level: 0.6 },
        { timeMs: 875, level: 0.01 }, { timeMs: 1_250, level: 0.55 },
      ]);
      const range = { startMs: 500, endMs: 1_500, property: 'vertical' as const, strength: 0.5, levels };
      expect(() => motion.applyAudioMotion(project, target, { ...range, replaceExisting: false })).toThrow('手工关键帧');
      expect(() => motion.applyAudioMotion(project, target, { ...range, startMs: 542, replaceExisting: true })).toThrow('穿过已有缓动');
      const draft = motion.applyAudioMotion(project, target, { ...range, replaceExisting: true });
      expect(() => motion.applyAudioMotion(project, target, {
        ...range, startMs: 1_583, endMs: 1_917, levels: [{ timeMs: 1_750, level: 1 }], replaceExisting: true,
      })).toThrow('穿过已有缓动');
      const oldShot = project.shots[0]!;
      const newShot = draft.shots[0]!;
      const layerAt = (snapshot: Project, time: number) => evaluateShotAtTime(snapshot.shots[0]!, time, snapshot)
        .layers.find(({ id }) => id === placed.layer.id)!;
      for (const time of [2_700, 1_917, 1_750, 1_583, 250, 500, 0, 875, 1_500]) {
        expect(layerAt(draft, time)).toEqual(layerAt(project, time));
      }
      expect(layerAt(draft, 750).y).toBeLessThan(layerAt(project, 750).y);
      const edited = motion.applyKeys(draft, { ...target, timeMs: 750 }, { 'transform.offsetY': 12 });
      expect(layerAt(edited, 750).y).toBe(462);
      expect(newShot.timelineEvents).toEqual(oldShot.timelineEvents);
      expect(newShot.layers.filter(({ id }) => id !== placed.layer.id)).toEqual(oldShot.layers.filter(({ id }) => id !== placed.layer.id));
      expect(newShot.audioClips).toEqual(oldShot.audioClips);
      expect(newShot.dialogues).toEqual(oldShot.dialogues);
      const editor = new EditorProjectStore();
      editor.open(root, project);
      editor.updateProject(draft, '生成音量动作');
      expect(editor.history.getSnapshot().undoCount).toBe(1);
      expect(editor.undo()).toBe(true);
      expect(editor.getSnapshot()!.project).toEqual(project);
      expect(editor.redo()).toBe(true);
      await writeFile(path.join(root, 'project.json'), JSON.stringify(project));
      const projects = new ProjectService();
      await projects.save(root, draft);
      const reopened = (await projects.open(root)).project;
      expect(reopened).toEqual(draft);
      for (const time of [1_250, 0, 750, 875]) {
        const shot = reopened.shots[0]!;
        const stage = evaluateShotAtTime(shot, time, reopened);
        expect(projectProductPreviewDialogue(reopened, shot, stage).layers).toEqual(stage.layers);
        expect(evaluateExportShotAtTime(reopened, shot, time).layers).toEqual(stage.layers);
      }
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it('keeps named reusable segments bounded to the stored source range in Stage, Preview and Export', async () => {
    const parent = await mkdtemp(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-animation-segment-'));
    try {
      const root = path.join(parent, 'animation-segment.pandastage');
      await mkdir(root);
      const projects = new ProjectService();
      const layers = new LayerService();
      const prior = { ...graphicFaceProject(), schemaVersion: 30 };
      await writeFile(path.join(root, 'project.json'), JSON.stringify(prior));
      const migrated = await projects.open(root);
      expect(migrated.sourceVersion).toBe(30);
      expect(migrated.project.animationSegments).toBeUndefined();
      const options = {
        name: '局部特效', animationId: FACE_GRAPHIC_ID, range: { firstFrame: 1, lastFrame: 2 },
        playback: { mode: 'loop' as const, endBehavior: 'hold' as const }, position: { x: 700, y: 500 },
      };
      const library = layers.saveAnimationSegment(migrated.project, options);
      expect(library.animations).toEqual(migrated.project.animations);
      expect(library.assets).toEqual(migrated.project.assets);
      const assetId = library.animations[0]!.frames[1]!.assetId;
      expect(scanAssetReferences(library, assetId).some((ref) => ref.kind === 'animation-frame')).toBe(true);
      const segmentId = library.animationSegments![0]!.id;
      const loop = layers.placeAnimationSegment(library, IDS.shot, segmentId, 500);
      const updated = layers.saveAnimationSegment(loop.project, {
        ...options, playback: { mode: 'once', endBehavior: 'hide' }, replaceId: segmentId,
      });
      expect(updated.shots).toEqual(loop.project.shots);
      const once = layers.placeAnimationSegment(updated, IDS.shot, segmentId, 1_000);
      expect(once.layer.x).toBe(700);
      await projects.save(root, once.project);
      const reopened = (await projects.open(root)).project;
      const shot = reopened.shots[0]!;
      for (const [at, loopOrdinal, onceVisible] of [
        [1_125, 2, false], [500, 1, false], [1_042, 2, true], [583, 1, false], [542, 2, false], [1_000, 1, true],
      ] as const) {
        const stage = evaluateShotAtTime(shot, at, reopened);
        for (const frame of [stage, projectProductPreviewDialogue(reopened, shot, stage), evaluateExportShotAtTime(reopened, shot, at)]) {
          expect(frame.layers.find(({ id }) => id === loop.layer.id)?.animationFrame?.frameOrdinal).toBe(loopOrdinal);
          expect(frame.layers.find(({ id }) => id === once.layer.id)?.visible).toBe(onceVisible);
        }
      }
      const orphan = ProjectSchema.parse({ ...library, animations: [], assets: migrated.project.assets.filter((asset) => !(asset.kind === 'image' && asset.flaGraphicFrame)) });
      expect(() => layers.placeAnimationSegment(orphan, IDS.shot, segmentId, 500)).toThrow('Animation definition is unavailable');
      expect(layers.saveAnimationSegment(ProjectSchema.parse({ ...library, animationSegments: orphan.animationSegments }),
        { ...options, replaceId: segmentId }).animationSegments).toHaveLength(1);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it('reuses a captured motion on another Graphic relative to its own basis and keeps the application editable', async () => {
    const parent = await mkdtemp(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-user-motion-'));
    try {
      const root = path.join(parent, 'motion-preset.pandastage');
      await mkdir(root);
      const layers = new LayerService();
      const motion = new LayerMotionService();
      const source = layers.createFromAnimation(graphicFaceProject(), IDS.shot, {
        animationId: FACE_GRAPHIC_ID, position: { x: 100, y: 150 }, startTimeMs: 0,
      });
      const destination = layers.createFromAnimation(source.project, IDS.shot, {
        animationId: FACE_GRAPHIC_ID, position: { x: 600, y: 500 }, startTimeMs: 0,
      });
      const from = { shotId: IDS.shot, layerId: source.layer.id };
      const target = { shotId: IDS.shot, layerId: destination.layer.id };
      const legacy = { ...destination.project, schemaVersion: 29 };
      const migrated = migrateProject(legacy);
      expect(migrated).toEqual(destination.project);
      let project = motion.applyKeys(migrated, { ...from, timeMs: 500 }, { 'transform.offsetX': 40, 'transform.scaleX': 1.3 });
      project = motion.applyKeys(project, { ...from, timeMs: 1_000 }, { 'transform.offsetX': 0, 'transform.scaleX': 1 });
      project = motion.setKeyEasing(project, { ...from, timeMs: 500 }, 'ease-in-out');
      project = motion.applyKeys(project, { ...target, timeMs: 500 }, { 'transform.offsetY': 30 });
      project = motion.applyKeys(project, { ...target, timeMs: 750 }, { 'transform.offsetX': 25, 'transform.scaleX': 1.5 });
      const captured = motion.saveUserMotionPreset(project, { ...from, name: '抖一下再回稳', startMs: 0, endMs: 1_000 });
      const [preset] = captured.userMotionPresets!;
      expect(preset?.durationFrames).toBe(24);
      expect(JSON.stringify(preset)).not.toContain(source.layer.id);
      expect(JSON.stringify(preset)).not.toContain(destination.layer.id);
      expect(() => migrateProject({ ...captured, schemaVersion: 29 })).toThrow();
      expect(() => motion.applyUserMotionPreset(captured, { ...target, timeMs: 500 }, preset!.id)).toThrow('水平位置');
      const before = new EditorProjectStore();
      before.open(root, captured);
      const applied = motion.applyUserMotionPreset(captured, { ...target, timeMs: 1_000 }, preset!.id);
      expect(before.getSnapshot()!.project).toEqual(captured);
      before.updateProject(applied, '应用运动预设');
      expect(before.history.getSnapshot().undoCount).toBe(1);
      expect(before.undo()).toBe(true);
      expect(before.getSnapshot()!.project).toEqual(captured);
      expect(before.redo()).toBe(true);
      expect(before.getSnapshot()!.project).toEqual(applied);
      const scopedLayer = (snapshot: Project, at: number) =>
        evaluateShotAtTime(snapshot.shots[0]!, at, snapshot).layers.find((layer) => layer.id === target.layerId)!;
      for (const at of [750, 1_000, 2_125, 2_700, 0]) {
        expect(scopedLayer(applied, at)).toEqual(scopedLayer(captured, at));
      }
      expect(scopedLayer(applied, 1_500)).toMatchObject({ x: 665, y: 530 });
      expect(scopedLayer(applied, 1_500).scaleX).toBeCloseTo(1.95);
      const draftTrack = applied.shots[0]!.layers.find((layer) => layer.id === target.layerId)!;
      expect(layerCompositeKeyTimes(draftTrack)).toContain(1_500);
      expect(scopedLayer(motion.applyKeys(applied, { ...target, timeMs: 1_500 }, { 'transform.offsetX': 70 }), 1_500).x).toBe(670);
      const updated = motion.saveUserMotionPreset(applied, { ...from, name: '另一段', startMs: 500, endMs: 1_000, replaceId: preset!.id });
      expect(updated.shots).toEqual(applied.shots);
      expect(updated.userMotionPresets).toHaveLength(1);
      await writeFile(path.join(root, 'project.json'), JSON.stringify(legacy));
      const projects = new ProjectService();
      await projects.save(root, updated);
      const reopened = (await projects.open(root)).project;
      expect(reopened).toEqual(updated);
      const shot = reopened.shots[0]!;
      for (const at of [1_700, 1_500, 1_250, 2_125]) {
        const stage = evaluateShotAtTime(shot, at, reopened);
        const preview = projectProductPreviewDialogue(reopened, shot, stage);
        const exported = evaluateExportShotAtTime(reopened, shot, at);
        for (const result of [preview, exported]) {
          expect(result.layers.find((layer) => layer.id === target.layerId)).toEqual(scopedLayer(reopened, at));
        }
      }
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

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

  it('persists a duplicated FLA Graphic v2 Clip layer across save/reopen and agrees across Stage, Preview, and Export', async () => {
    const parent = await mkdtemp(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-dup-clip-'));
    try {
      const root = path.join(parent, 'dup-clip.pandastage');
      await mkdir(root);
      const base = graphicFaceProject();
      const emptyProject = ProjectSchema.parse({
        ...base,
        characters: [],
        voiceProfiles: [],
        shots: base.shots.map((s) => ({
          ...s,
          durationMs: 2_000,
          dialogues: [],
          timelineEvents: [],
          layers: s.layers.filter((l) => l.id === s.backgroundLayerId),
        })),
      });
      const layers = new LayerService();
      const placed = layers.createFromAnimation(emptyProject, IDS.shot, {
        animationId: FACE_GRAPHIC_ID,
        startTimeMs: 0,
        position: { x: 500, y: 300 },
      });
      const motion = new LayerMotionService();
      let authored = motion.recalibratePivot(
        placed.project,
        { shotId: IDS.shot, layerId: placed.layer.id },
        { space: 'target-local', x: 120, y: 100 },
      );
      authored = motion.applyKeys(
        authored,
        { shotId: IDS.shot, layerId: placed.layer.id, timeMs: 0 },
        { 'transform.offsetX': 0, 'transform.offsetY': 0 },
      );
      authored = motion.applyKeys(
        authored,
        { shotId: IDS.shot, layerId: placed.layer.id, timeMs: 500 },
        { 'transform.offsetX': 140, 'transform.offsetY': -40, 'transform.rotationDeg': 30 },
      );
      authored = motion.applyKeys(
        authored,
        { shotId: IDS.shot, layerId: placed.layer.id, timeMs: 1_000 },
        { 'transform.offsetX': 280, 'transform.offsetY': 20, 'transform.rotationDeg': 90 },
      );
      authored = motion.setKeyEasing(
        authored,
        { shotId: IDS.shot, layerId: placed.layer.id, timeMs: 500 },
        'ease-in-out',
      );
      authored = editAnimationPropertyKey(
        authored,
        {
          shotId: IDS.shot,
          target: { kind: 'layer', layerId: placed.layer.id },
          property: 'transform.offsetX',
          keyTimeMs: 500,
        },
        {
          interpolationToNext: 'ease-in-out',
          curveToNext: {
            bezier: { x1: 0.25, y1: 0, x2: 0.8, y2: 0.2 },
            window: [0.1, 0.8],
          },
        },
      );

      const moveEvent: TimelineEvent = {
        id: '93000000-0000-4000-8000-000000000701',
        type: 'move',
        layerId: placed.layer.id,
        startMs: 0,
        endMs: 1_000,
        from: { x: 500, y: 300 },
        to: { x: 650, y: 380 },
        easing: 'linear',
      };
      const opacityLow: TimelineEvent = {
        id: '93000000-0000-4000-8000-000000000702',
        type: 'opacity',
        layerId: placed.layer.id,
        startMs: 250,
        endMs: 750,
        from: 1,
        to: 0.2,
        easing: 'linear',
      };
      const opacityHigh: TimelineEvent = {
        id: '93000000-0000-4000-8000-000000000703',
        type: 'opacity',
        layerId: placed.layer.id,
        startMs: 250,
        endMs: 750,
        from: 1,
        to: 0.8,
        easing: 'linear',
      };
      authored = ProjectSchema.parse({
        ...authored,
        shots: authored.shots.map((s) =>
          s.id === IDS.shot
            ? { ...s, timelineEvents: [moveEvent, opacityLow, opacityHigh] }
            : s,
        ),
      });

      const store = new EditorProjectStore();
      store.open(root, authored);
      const shots = { getCurrentShotId: () => IDS.shot };
      const selection = new LayerSelectionStore(store, {
        ...shots,
        subscribe: () => () => undefined,
      });
      const descendingIds = [
        'f3000000-0000-4000-8000-000000000099',
        'f3000000-0000-4000-8000-000000000009',
        'f3000000-0000-4000-8000-000000000008',
        'f3000000-0000-4000-8000-000000000007',
      ];
      let nextId = 0;
      const descendingLayers = new LayerService({
        createId: () => descendingIds[nextId++]!,
      });
      const layerStore = new LayerStore(store, shots, descendingLayers, selection);
      const duplicated = layerStore.duplicateAnimationLayer(placed.layer.id);
      expect(store.history.getSnapshot().undoCount).toBe(1);

      const projectService = new ProjectService();
      await writeFile(path.join(root, 'project.json'), JSON.stringify(authored));
      await projectService.save(root, store.getSnapshot()!.project, 1);

      const reopened = await projectService.open(root);
      expect(reopened.project).toEqual(store.getSnapshot()!.project);
      expect(reopened.project.animations).toEqual(authored.animations);
      expect(reopened.project.assets).toEqual(authored.assets);

      const shot = reopened.project.shots[0]!;
      const sourceLayer = shot.layers.find((l) => l.id === placed.layer.id)!;
      const dupLayer = shot.layers.find((l) => l.id === duplicated.id)!;
      expect(dupLayer.source).toEqual(sourceLayer.source);
      expect(dupLayer.animationClip?.version).toBe(2);
      expect(dupLayer.animationClip?.targetBases[0]?.target.layerId).toBe(duplicated.id);
      expect(dupLayer.animationClip?.tracks.every((t) => t.target.layerId === duplicated.id)).toBe(true);
      expect(layerCompositeKeyTimes(dupLayer)).toEqual([0, 500, 1_000]);
      expect(layerCompositeKeyEasing(dupLayer, 500)).toBe('ease-in-out');
      expect(
        dupLayer.animationClip?.tracks
          .find((t) => t.property === 'transform.offsetX')
          ?.keys.find((k) => k.timeMs === 500)?.curveToNext,
      ).toEqual({
        bezier: { x1: 0.25, y1: 0, x2: 0.8, y2: 0.2 },
        window: [0.1, 0.8],
      });
      expect(recognizePositionChain({ shot, layer: dupLayer }).status).toBe('editable');
      expect(
        shot.timelineEvents.find((e) => e.layerId === duplicated.id && e.type === 'move'),
      ).toMatchObject({
        from: { x: 524, y: 324 },
        to: { x: 674, y: 404 },
      });

      const urls = Object.fromEntries(reopened.project.assets.map((a) => [a.id, `test:${a.id}`]));
      for (const timeMs of [0, 500, 750, 1_000, 1_500]) {
        const stage = evaluateShotAtTime(shot, timeMs, reopened.project);
        const preview = projectProductPreviewDialogue(reopened.project, shot, stage);
        const exported = evaluateExportShotAtTime(reopened.project, shot, timeMs);
        const editorModel = buildEditorTemporalCanvasModel({
          project: reopened.project,
          shot,
          currentTimeMs: timeMs,
          readyAssetIds: new Set(reopened.project.assets.map((a) => a.id)),
          previousVisuals: new Map(),
        });
        const exportModel = buildStageRenderModel(reopened.project, exported, urls);

        const stageSrc = stage.layers.find((l) => l.id === placed.layer.id)!;
        const stageDup = stage.layers.find((l) => l.id === duplicated.id)!;
        expect(stageDup.x).toBeCloseTo(stageSrc.x + 24);
        expect(stageDup.y).toBeCloseTo(stageSrc.y + 24);
        expect(stageDup.rotationDeg).toBeCloseTo(stageSrc.rotationDeg);
        expect(stageDup.opacity).toBeCloseTo(stageSrc.opacity);

        expect(preview.layers.find((l) => l.id === duplicated.id)).toMatchObject({
          x: stageDup.x,
          y: stageDup.y,
          rotationDeg: stageDup.rotationDeg,
          opacity: stageDup.opacity,
        });
        expect(exported.layers.find((l) => l.id === duplicated.id)).toMatchObject({
          x: stageDup.x,
          y: stageDup.y,
          rotationDeg: stageDup.rotationDeg,
          opacity: stageDup.opacity,
        });
        expect(editorModel.stageModel.layers.find((l) => l.layer.id === duplicated.id)!.render).toMatchObject({
          x: stageDup.x,
          y: stageDup.y,
          rotationDeg: stageDup.rotationDeg,
          opacity: stageDup.opacity,
        });
        expect(exportModel.layers.find((l) => l.id === duplicated.id)!.render).toMatchObject({
          x: stageDup.x,
          y: stageDup.y,
          rotationDeg: stageDup.rotationDeg,
          opacity: stageDup.opacity,
        });
      }
      selection.dispose();
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it('persists a 3x4 grid array with v2 Clip, MoveEvent, and same-startMs OpacityEvents across save/reopen and Stage/Preview/Export (#1268 A01)', async () => {
    const parent = await mkdtemp(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-grid-array-'));
    try {
      const root = path.join(parent, 'grid-array.pandastage');
      await mkdir(root);
      const base = graphicFaceProject();
      const emptyProject = ProjectSchema.parse({
        ...base,
        characters: [],
        voiceProfiles: [],
        shots: base.shots.map((s) => ({
          ...s,
          durationMs: 2_000,
          dialogues: [],
          timelineEvents: [],
          layers: s.layers.filter((l) => l.id === s.backgroundLayerId),
        })),
      });
      const layers = new LayerService();
      const placed = layers.createFromAnimation(emptyProject, IDS.shot, {
        animationId: FACE_GRAPHIC_ID,
        startTimeMs: 0,
        position: { x: 400, y: 300 },
      });
      const motion = new LayerMotionService();
      let authored = motion.applyKeys(
        placed.project,
        { shotId: IDS.shot, layerId: placed.layer.id, timeMs: 0 },
        { 'transform.offsetX': 0, 'transform.offsetY': 0 },
      );
      authored = motion.applyKeys(
        authored,
        { shotId: IDS.shot, layerId: placed.layer.id, timeMs: 500 },
        { 'transform.offsetX': 50, 'transform.offsetY': -20, 'transform.rotationDeg': 30 },
      );
      authored = motion.applyKeys(
        authored,
        { shotId: IDS.shot, layerId: placed.layer.id, timeMs: 1_000 },
        { 'transform.offsetX': 100, 'transform.offsetY': 0, 'transform.rotationDeg': 60 },
      );
      const moveEvent: TimelineEvent = {
        id: '93000000-0000-4000-8000-000000000751',
        type: 'move',
        layerId: placed.layer.id,
        startMs: 0,
        endMs: 1_000,
        from: { x: 400, y: 300 },
        to: { x: 520, y: 340 },
        easing: 'linear',
      };
      const opacityLow: TimelineEvent = {
        id: '93000000-0000-4000-8000-000000000752',
        type: 'opacity',
        layerId: placed.layer.id,
        startMs: 250,
        endMs: 750,
        from: 1,
        to: 0.2,
        easing: 'linear',
      };
      const opacityHigh: TimelineEvent = {
        id: '93000000-0000-4000-8000-000000000753',
        type: 'opacity',
        layerId: placed.layer.id,
        startMs: 250,
        endMs: 750,
        from: 1,
        to: 0.85,
        easing: 'linear',
      };
      authored = ProjectSchema.parse({
        ...authored,
        shots: authored.shots.map((s) =>
          s.id === IDS.shot ? { ...s, timelineEvents: [moveEvent, opacityLow, opacityHigh] } : s,
        ),
      });

      const store = new EditorProjectStore();
      store.open(root, authored);
      const shots = { getCurrentShotId: () => IDS.shot };
      const selection = new LayerSelectionStore(store, {
        ...shots,
        subscribe: () => () => undefined,
      });
      selection.select(placed.layer.id);
      let seq = 999_999;
      const gridService = new LayerService({
        createId: () => `f3000000-0000-4000-8000-${String(seq--).padStart(12, '0')}`,
      });
      const layerStore = new LayerStore(store, shots, gridService, selection);
      const created = layerStore.duplicateAnimationLayerGrid(placed.layer.id, {
        rows: 3,
        cols: 4,
        spacingX: 100,
        spacingY: 80,
      });
      expect(created).toHaveLength(11);
      expect(store.history.getSnapshot().undoCount).toBe(1);
      expect(selection.getSelectedLayerId()).toBe(placed.layer.id);

      const projectService = new ProjectService();
      await writeFile(path.join(root, 'project.json'), JSON.stringify(authored));
      await projectService.save(root, store.getSnapshot()!.project, 1);

      const reopened = await projectService.open(root);
      expect(reopened.project).toEqual(store.getSnapshot()!.project);
      expect(reopened.project.animations).toEqual(authored.animations);
      expect(reopened.project.assets).toEqual(authored.assets);

      const shot = reopened.project.shots[0]!;
      const cellTopRight = created[2]!; // (700, 300) => +300, +0
      const cellBottomRight = created[10]!; // (700, 460) => +300, +160
      expect(
        recognizePositionChain({
          shot,
          layer: shot.layers.find((l) => l.id === cellBottomRight.id)!,
        }).status,
      ).toBe('editable');

      const urls = Object.fromEntries(reopened.project.assets.map((a) => [a.id, `test:${a.id}`]));
      for (const timeMs of [0, 500, 1_000, 1_500]) {
        const stage = evaluateShotAtTime(shot, timeMs, reopened.project);
        const preview = projectProductPreviewDialogue(reopened.project, shot, stage);
        const exported = evaluateExportShotAtTime(reopened.project, shot, timeMs);
        const editorModel = buildEditorTemporalCanvasModel({
          project: reopened.project,
          shot,
          currentTimeMs: timeMs,
          readyAssetIds: new Set(reopened.project.assets.map((a) => a.id)),
          previousVisuals: new Map(),
        });
        const exportModel = buildStageRenderModel(reopened.project, exported, urls);

        const stageSrc = stage.layers.find((l) => l.id === placed.layer.id)!;
        for (const [replicaId, dx, dy] of [
          [cellTopRight.id, 300, 0],
          [cellBottomRight.id, 300, 160],
        ] as const) {
          const stageRep = stage.layers.find((l) => l.id === replicaId)!;
          expect(stageRep.x).toBeCloseTo(stageSrc.x + dx);
          expect(stageRep.y).toBeCloseTo(stageSrc.y + dy);
          expect(stageRep.rotationDeg).toBeCloseTo(stageSrc.rotationDeg);
          expect(stageRep.opacity).toBeCloseTo(stageSrc.opacity);

          expect(preview.layers.find((l) => l.id === replicaId)).toMatchObject({
            x: stageRep.x,
            y: stageRep.y,
            rotationDeg: stageRep.rotationDeg,
            opacity: stageRep.opacity,
          });
          expect(exported.layers.find((l) => l.id === replicaId)).toMatchObject({
            x: stageRep.x,
            y: stageRep.y,
            rotationDeg: stageRep.rotationDeg,
            opacity: stageRep.opacity,
          });
          expect(editorModel.stageModel.layers.find((l) => l.layer.id === replicaId)!.render).toMatchObject({
            x: stageRep.x,
            y: stageRep.y,
            rotationDeg: stageRep.rotationDeg,
            opacity: stageRep.opacity,
          });
          expect(exportModel.layers.find((l) => l.id === replicaId)!.render).toMatchObject({
            x: stageRep.x,
            y: stageRep.y,
            rotationDeg: stageRep.rotationDeg,
            opacity: stageRep.opacity,
          });
        }
      }
      selection.dispose();
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it('persists baked curve motion + manual key edit across save/reopen and agrees across Stage, Preview, and Export including non-integer-ms frame mappings (#1269 A02)', async () => {
    const parent = await mkdtemp(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-curve-motion-'));
    try {
      const root = path.join(parent, 'curve-motion.pandastage');
      await mkdir(root);
      const base = graphicFaceProject();
      const emptyProject = ProjectSchema.parse({
        ...base,
        characters: [],
        voiceProfiles: [],
        shots: base.shots.map((s) => ({
          ...s,
          durationMs: 2_000,
          dialogues: [],
          timelineEvents: [],
          layers: s.layers.filter((l) => l.id === s.backgroundLayerId),
        })),
      });
      const layers = new LayerService();
      const placed = layers.createFromAnimation(emptyProject, IDS.shot, {
        animationId: FACE_GRAPHIC_ID,
        startTimeMs: 0,
        position: { x: 400, y: 300 },
      });

      const store = new EditorProjectStore();
      store.open(root, placed.project);
      const shots = { getCurrentShotId: () => IDS.shot };
      const selection = new LayerSelectionStore(store, {
        ...shots,
        subscribe: () => () => undefined,
      });
      selection.select(placed.layer.id);
      const layerStore = new LayerStore(store, shots, layers, selection);

      layerStore.applyCurveMotion(placed.layer.id, {
        startFrame: 0,
        endFrame: 24,
        p1: { x: 450, y: 80 },
        p2: { x: 850, y: 80 },
        p3: { x: 900, y: 300 },
        speedMode: 'constant',
      });
      expect(store.history.getSnapshot().undoCount).toBe(1);

      // Manually edit one generated key at frame 12 (500ms) via native LayerMotionService.
      const motion = new LayerMotionService();
      const handEdited = motion.applyKeys(
        store.getSnapshot()!.project,
        { shotId: IDS.shot, layerId: placed.layer.id, timeMs: frameTimeMs(12) },
        { 'transform.offsetY': -180 },
      );
      store.updateProject(handEdited, '微调曲线关键帧');

      const projectService = new ProjectService();
      await writeFile(path.join(root, 'project.json'), JSON.stringify(placed.project));
      await projectService.save(root, store.getSnapshot()!.project, 1);

      const reopened = await projectService.open(root);
      expect(reopened.project).toEqual(store.getSnapshot()!.project);
      expect(reopened.project.animations).toEqual(placed.project.animations);
      expect(reopened.project.assets).toEqual(placed.project.assets);

      const shot = reopened.project.shots[0]!;
      const urls = Object.fromEntries(reopened.project.assets.map((a) => [a.id, `test:${a.id}`]));
      // Check integer-ms frames (0, 12, 24) and non-integer-ms export frames (frame 1 -> 41ms vs 42ms, frame 13 -> 541ms vs 542ms).
      for (const frame of [0, 1, 12, 13, 24]) {
        const authoringMs = frameTimeMs(frame);
        const exportMs = exportFrameTimeMs(frame);
        const stage = evaluateShotAtTime(shot, authoringMs, reopened.project);
        const preview = projectProductPreviewDialogue(reopened.project, shot, stage);
        const exportedAtAuthoring = evaluateExportShotAtTime(reopened.project, shot, authoringMs);
        const exportedAtExportMs = evaluateExportShotAtTime(reopened.project, shot, exportMs);
        const editorModel = buildEditorTemporalCanvasModel({
          project: reopened.project,
          shot,
          currentTimeMs: authoringMs,
          readyAssetIds: new Set(reopened.project.assets.map((a) => a.id)),
          previousVisuals: new Map(),
        });
        const exportModel = buildStageRenderModel(reopened.project, exportedAtAuthoring, urls);

        const stageLayer = stage.layers.find((l) => l.id === placed.layer.id)!;
        expect(preview.layers.find((l) => l.id === placed.layer.id)).toMatchObject({
          x: stageLayer.x,
          y: stageLayer.y,
        });
        expect(exportedAtAuthoring.layers.find((l) => l.id === placed.layer.id)).toMatchObject({
          x: stageLayer.x,
          y: stageLayer.y,
        });
        expect(editorModel.stageModel.layers.find((l) => l.layer.id === placed.layer.id)!.render).toMatchObject({
          x: stageLayer.x,
          y: stageLayer.y,
        });
        expect(exportModel.layers.find((l) => l.id === placed.layer.id)!.render).toMatchObject({
          x: stageLayer.x,
          y: stageLayer.y,
        });
        // Non-integer-ms export frame time stays within 1ms linear interpolation of authoring frame.
        const exportSample = exportedAtExportMs.layers.find((l) => l.id === placed.layer.id)!;
        expect(Math.abs(exportSample.x - stageLayer.x)).toBeLessThan(1.5);
        expect(Math.abs(exportSample.y - stageLayer.y)).toBeLessThan(1.5);
      }
      // Manual edit at frame 12 (500ms) persisted cleanly: y = 300 - 180 = 120.
      expect(
        evaluateShotAtTime(shot, frameTimeMs(12), reopened.project).layers.find(
          (l) => l.id === placed.layer.id,
        )!.y,
      ).toBeCloseTo(120);
      selection.dispose();
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
