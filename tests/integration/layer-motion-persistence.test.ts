import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LayerMotionService,
  LayerService,
  PROJECT_SCHEMA_VERSION,
  ProjectSchema,
  ShotService,
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
import {
  iterateFormalProjectFrameSchedule,
  planPngSequenceFrames,
} from '../../src/shared/export-types';
import { projectProductPreviewDialogue } from '../../src/renderer/shell/productPreviewModel';
import { animationCoreFixture } from '../helpers/animationCoreFixture';
import { FACE_GRAPHIC_ID, graphicFaceProject } from '../helpers/graphicFaceProject';
import { IDS } from '../unit/domain/testProject';

describe('Layer Target V0 Character=0 tracer bullet E2E & persistence (#1140)', () => {
  it('round-trips Wave B tools and matches Stage, Preview and formal Export after manual edits', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'panda-stage-wave-b-'));
    const root = path.join(tempDir, 'wave-b.pandastage');
    try {
      await mkdir(root, { recursive: true });
      const fixture = graphicFaceProject();
      const base = ProjectSchema.parse({
        ...fixture,
        characters: [],
        voiceProfiles: [],
        shots: fixture.shots.map((shot) => ({
          ...shot, durationMs: 2501, dialogues: [], timelineEvents: [],
          layers: shot.layers.filter((layer) => layer.id === shot.backgroundLayerId),
        })),
      });
      const shotId = base.shots[0]!.id;
      const service = new LayerService();
      const template = service.createFromAnimation(base, shotId, {
        animationId: FACE_GRAPHIC_ID, startTimeMs: 0, position: { x: 400, y: 300 },
        playback: { mode: 'single-frame', endBehavior: 'hold' },
      });
      const source = template.project.shots[0]!.layers.find((layer) => layer.id === template.layer.id)!;
      source.scaleX = 3.2;
      source.scaleY = 2;
      const reference = service.createFromAnimation(template.project, shotId, {
        animationId: FACE_GRAPHIC_ID, startTimeMs: 0, position: { x: 960, y: 540 },
      });
      const editor = new EditorProjectStore();
      editor.open(root, reference.project);
      const shots = { getCurrentShotId: () => shotId };
      const selection = new LayerSelectionStore(editor, { ...shots, subscribe: () => () => undefined });
      selection.select(source.id);
      const layers = new LayerStore(editor, shots, service, selection);
      const start = { startFrame: 1, durationFrames: 12 };
      const stagger = { ...start, staggerFrames: 2, count: 4 };
      const generate = [
        () => layers.generateBackgroundTiles(source.id, { mode: 'loop', direction: 'left', periodFrames: 24 }),
        () => layers.generateOrbitFlight(source.id, {
          ...start, count: 1, referenceLayerIds: [reference.layer.id], radiusX: 240, radiusY: 100,
          startAngleDeg: 0, direction: 'clockwise', orientation: 'tangent',
        }),
        () => layers.generateConvergingFlight(source.id, {
          ...stagger, target: { x: 960, y: 540 }, radius: 360, bend: 100, startAngleDeg: 0,
          seed: 42, hideAfterArrival: true, orientation: 'tangent',
        }),
        () => layers.generateDiffusionGhosts(source.id, { ...stagger, maxScale: 1.8, decay: 0.7 }),
      ];
      const baked = generate.map((bake, index) => {
        const before = editor.getSnapshot()!.project;
        const created = bake();
        const after = editor.getSnapshot()!.project;
        expect(editor.history.getSnapshot().undoCount).toBe(index + 1);
        expect(editor.undo()).toBe(true);
        expect(editor.getSnapshot()!.project).toEqual(before);
        expect(editor.redo()).toBe(true);
        expect(editor.getSnapshot()!.project).toEqual(after);
        expect(selection.getSelectedLayerId()).toBe(source.id);
        return created;
      });
      expect(() => layers.generateDiffusionGhosts(source.id, { ...stagger, maxScale: 1.8, decay: 0.7, durationFrames: 1000 })).toThrow();
      expect(editor.getSnapshot()!.revision).toBe(12);
      expect(editor.history.getSnapshot().undoCount).toBe(4);

      const motion = new LayerMotionService();
      const saved = baked.reduce((project, batch) => motion.applyKeys(project, {
        shotId, layerId: batch[0]!.id, timeMs: frameTimeMs(7),
      }, { 'transform.offsetY': 11 }), editor.getSnapshot()!.project);
      await writeFile(path.join(root, 'project.json'), JSON.stringify(reference.project));
      const projects = new ProjectService();
      await projects.save(root, saved, 1);
      const reopened = (await projects.open(root)).project;
      expect(reopened).toEqual(saved);
      expect(reopened.animations).toEqual(base.animations);
      expect(reopened.assets).toEqual(base.assets);
      const shot = reopened.shots[0]!;
      const urls = Object.fromEntries(reopened.assets.map((asset) => [asset.id, `test:${asset.id}`]));
      const schedule = [...iterateFormalProjectFrameSchedule(reopened, 24)];
      expect(schedule[1]!.shotLocalTimeMs).toBe(41);
      const samples = [0, 1, 7, 13, 19, 20, 23, 24, 25, 59].map((frame) =>
        [frameTimeMs(frame), schedule[frame]!.shotLocalTimeMs],
      );
      for (const [stageMs, exportMs] of [...samples, [987, 987], [2501, 2501]]) {
        const stage = evaluateShotAtTime(shot, stageMs!, reopened);
        const exported = evaluateExportShotAtTime(reopened, shot, exportMs!);
        const preview = projectProductPreviewDialogue(reopened, shot, stage);
        for (const evaluated of [preview, exported]) {
          const model = buildStageRenderModel(reopened, evaluated, urls);
          const stageModel = buildStageRenderModel(reopened, stage, urls);
          expect(model.layers.map(({ id, visible, opacity, zIndex, render }) => ({ id, visible, opacity, zIndex, render })))
            .toEqual(stageModel.layers.map(({ id, visible, opacity, zIndex, render }) => ({ id, visible, opacity, zIndex, render })));
        }
      }
      selection.dispose();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

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
      expect(assetId).toBeTruthy();
      expect(scanAssetReferences(library, assetId as string).some((ref) => ref.kind === 'animation-frame')).toBe(true);
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
        const exported = evaluateExportShotAtTime(reopened.project, shot, exportMs);
        const editorModel = buildEditorTemporalCanvasModel({
          project: reopened.project,
          shot,
          currentTimeMs: authoringMs,
          readyAssetIds: new Set(reopened.project.assets.map((a) => a.id)),
          previousVisuals: new Map(),
        });
        const exportModel = buildStageRenderModel(reopened.project, exported, urls);

        const stageLayer = stage.layers.find((l) => l.id === placed.layer.id)!;
        expect(preview.layers.find((l) => l.id === placed.layer.id)).toMatchObject({
          x: stageLayer.x,
          y: stageLayer.y,
        });
        expect(exported.layers.find((l) => l.id === placed.layer.id)!.x).toBeCloseTo(stageLayer.x, 4);
        expect(exported.layers.find((l) => l.id === placed.layer.id)!.y).toBeCloseTo(stageLayer.y, 4);
        expect(editorModel.stageModel.layers.find((l) => l.layer.id === placed.layer.id)!.render).toMatchObject({
          x: stageLayer.x,
          y: stageLayer.y,
        });
        expect(exportModel.layers.find((l) => l.id === placed.layer.id)!.render.x).toBeCloseTo(stageLayer.x, 4);
        expect(exportModel.layers.find((l) => l.id === placed.layer.id)!.render.y).toBeCloseTo(stageLayer.y, 4);
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

  it('aligns fast 1-frame Graphic motion (X=400->1600, 0->42ms) at export frame 1 (41ms) with authoring frame 42ms while keeping arbitrary off-grid & unaligned multi-shot times continuous (#1271 A02 P2-01)', () => {
    const base = graphicFaceProject();
    const layers = new LayerService();
    const motion = new LayerMotionService();
    const placed = layers.createFromAnimation(
      ProjectSchema.parse({
        ...base,
        characters: [],
        voiceProfiles: [],
        shots: base.shots.map((s) => ({
          ...s,
          durationMs: 1_000,
          dialogues: [],
          timelineEvents: [],
          layers: s.layers.filter((l) => l.id === s.backgroundLayerId),
        })),
      }),
      IDS.shot,
      { animationId: FACE_GRAPHIC_ID, startTimeMs: 0, position: { x: 400, y: 300 } },
    );

    // Non-default pivot + rotation/scale + fast 1-frame horizontal curve X=400->1600 (0->42ms).
    let project = motion.recalibratePivot(
      placed.project,
      { shotId: IDS.shot, layerId: placed.layer.id },
      { space: 'target-local', x: 140, y: 110 },
    );
    project = motion.applyKeys(
      project,
      { shotId: IDS.shot, layerId: placed.layer.id, timeMs: frameTimeMs(1) },
      { 'transform.rotationDeg': 45, 'transform.scaleX': 1.5 },
    );
    project = motion.applyCurveMotion(project, {
      shotId: IDS.shot,
      layerId: placed.layer.id,
      startFrame: 0,
      endFrame: 1,
      p1: { x: 800, y: 300 },
      p2: { x: 1200, y: 300 },
      p3: { x: 1600, y: 300 },
      speedMode: 'constant',
    });

    const shot = project.shots[0]!;
    const plannedFrames = [...planPngSequenceFrames(project, { shotId: shot.id, transparent: true }).frames()];
    const exportFrame1 = plannedFrames[1]!;
    expect(exportFrame1.shotLocalTimeMs).toBe(41);

    const authoring42 = evaluateShotAtTime(shot, 42, project);
    const exported41 = evaluateExportShotAtTime(project, shot, exportFrame1.shotLocalTimeMs);
    const urls = Object.fromEntries(project.assets.map((a) => [a.id, `test:${a.id}`]));
    const authoringRender = buildStageRenderModel(project, authoring42, urls).layers.find(
      (l) => l.id === placed.layer.id,
    )!;
    const exportRender = buildStageRenderModel(project, exported41, urls).layers.find(
      (l) => l.id === placed.layer.id,
    )!;

    expect(Math.abs(exported41.layers.find((l) => l.id === placed.layer.id)!.x - 1600)).toBeLessThan(0.1);
    expect(Math.abs(exportRender.render.x - authoringRender.render.x)).toBeLessThan(0.1);
    expect(Math.abs(exportRender.render.y - authoringRender.render.y)).toBeLessThan(0.1);
    expect(exportRender.render.rotationDeg).toBeCloseTo(authoringRender.render.rotationDeg, 4);
    expect(exportRender.render.scaleX).toBeCloseTo(authoringRender.render.scaleX, 4);

    // Arbitrary off-grid time (21ms) and unaligned multi-shot local time (40ms) remain continuous (not snapped to 42ms).
    const offGrid21 = evaluateExportShotAtTime(project, shot, 21).layers.find(
      (l) => l.id === placed.layer.id,
    )!;
    expect(offGrid21.x).toBeGreaterThan(900);
    expect(offGrid21.x).toBeLessThan(1100);
    const unaligned40 = evaluateExportShotAtTime(project, shot, 40).layers.find(
      (l) => l.id === placed.layer.id,
    )!;
    expect(unaligned40.x).toBeLessThan(1580);
  });

  it('persists A03 afterimages + manual replica edit across save/reopen and agrees across Stage, Preview, and real Export frames (#1271 A03)', async () => {
    const parent = await mkdtemp(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-afterimage-'));
    try {
      const root = path.join(parent, 'afterimage.pandastage');
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
      const curved = motion.applyCurveMotion(placed.project, {
        shotId: IDS.shot,
        layerId: placed.layer.id,
        startFrame: 0,
        endFrame: 24,
        p1: { x: 450, y: 80 },
        p2: { x: 850, y: 80 },
        p3: { x: 900, y: 300 },
        speedMode: 'constant',
      });

      const store = new EditorProjectStore();
      store.open(root, curved);
      const shots = { getCurrentShotId: () => IDS.shot };
      const selection = new LayerSelectionStore(store, {
        ...shots,
        subscribe: () => () => undefined,
      });
      selection.select(placed.layer.id);
      const layerStore = new LayerStore(store, shots, layers, selection);
      const created = layerStore.generateAfterimages(placed.layer.id, {
        count: 4,
        delayFrames: 2,
        decay: 0.6,
        startFrame: 0,
        endFrame: 24,
      });
      expect(created).toHaveLength(4);
      expect(store.history.getSnapshot().undoCount).toBe(1);

      // Manually edit closest replica (i=1) at frame 13 (non-integer-ms frame 542ms vs export 541ms).
      const closestId = created[3]!.id;
      const farthestId = created[0]!.id;
      const edited = motion.applyKeys(
        store.getSnapshot()!.project,
        { shotId: IDS.shot, layerId: closestId, timeMs: frameTimeMs(13) },
        { 'transform.offsetY': -140 },
      );
      store.updateProject(edited, '微调残影位置');

      const projectService = new ProjectService();
      await writeFile(path.join(root, 'project.json'), JSON.stringify(curved));
      await projectService.save(root, store.getSnapshot()!.project, 1);

      const reopened = await projectService.open(root);
      expect(reopened.project).toEqual(store.getSnapshot()!.project);
      expect(reopened.project.animations).toEqual(curved.animations);
      expect(reopened.project.assets).toEqual(curved.assets);

      const shot = reopened.project.shots[0]!;
      const urls = Object.fromEntries(reopened.project.assets.map((a) => [a.id, `test:${a.id}`]));
      for (const frame of [1, 2, 13, 24, 25]) {
        const authoringMs = frameTimeMs(frame);
        const exportMs = exportFrameTimeMs(frame);
        const stage = evaluateShotAtTime(shot, authoringMs, reopened.project);
        const preview = projectProductPreviewDialogue(reopened.project, shot, stage);
        const exported = evaluateExportShotAtTime(reopened.project, shot, exportMs);
        const exportModel = buildStageRenderModel(reopened.project, exported, urls);

        for (const repId of [closestId, farthestId]) {
          const sLayer = stage.layers.find((l) => l.id === repId)!;
          const pLayer = preview.layers.find((l) => l.id === repId)!;
          const eLayer = exported.layers.find((l) => l.id === repId)!;
          expect(pLayer.visible).toBe(sLayer.visible);
          expect(eLayer.visible).toBe(sLayer.visible);
          expect(eLayer.opacity).toBeCloseTo(sLayer.opacity, 5);
          expect(Math.abs(eLayer.x - sLayer.x)).toBeLessThan(0.1);
          expect(Math.abs(eLayer.y - sLayer.y)).toBeLessThan(0.1);
          if (sLayer.visible) {
            const renderLayer = exportModel.layers.find((l) => l.id === repId)!;
            expect(Math.abs(renderLayer.render.x - sLayer.x)).toBeLessThan(0.1);
            expect(Math.abs(renderLayer.render.y - sLayer.y)).toBeLessThan(0.1);
            expect(renderLayer.render.opacity).toBeCloseTo(sLayer.opacity, 5);
          }
        }
      }
      selection.dispose();
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it('persists A04 radial burst + manual edit across save/reopen and agrees across Stage, Preview, and real Export frames (#1273 A04)', async () => {
    const parent = await mkdtemp(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-radial-burst-'));
    try {
      const root = path.join(parent, 'radial-burst.pandastage');
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
        position: { x: 960, y: 540 },
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
      const created = layerStore.generateRadialBurst(placed.layer.id, {
        count: 6,
        center: { x: 960, y: 540 },
        radius: 240,
        startAngleDeg: 0,
        maxRotationDeg: 180,
        startFrame: 0,
        durationFrames: 12,
        staggerFrames: 1,
        seed: 42,
        fadeOut: true,
      });
      expect(created).toHaveLength(6);
      expect(store.history.getSnapshot().undoCount).toBe(1);

      // Manually tweak replica 1 at non-integer-ms frame 7 (292ms vs export 291ms).
      const rep1Id = created[1]!.id;
      const rep5Id = created[5]!.id;
      const motion = new LayerMotionService();
      const edited = motion.applyKeys(
        store.getSnapshot()!.project,
        { shotId: IDS.shot, layerId: rep1Id, timeMs: frameTimeMs(7) },
        { 'transform.rotationDeg': 45 },
      );
      store.updateProject(edited, '微调爆炸旋转');

      const projectService = new ProjectService();
      await writeFile(path.join(root, 'project.json'), JSON.stringify(placed.project));
      await projectService.save(root, store.getSnapshot()!.project, 1);

      const reopened = await projectService.open(root);
      expect(reopened.project).toEqual(store.getSnapshot()!.project);
      expect(reopened.project.animations).toEqual(placed.project.animations);
      expect(reopened.project.assets).toEqual(placed.project.assets);

      const shot = reopened.project.shots[0]!;
      const urls = Object.fromEntries(reopened.project.assets.map((a) => [a.id, `test:${a.id}`]));
      for (const frame of [0, 1, 7, 13, 17, 18]) {
        const authoringMs = frameTimeMs(frame);
        const exportMs = exportFrameTimeMs(frame);
        const stage = evaluateShotAtTime(shot, authoringMs, reopened.project);
        const preview = projectProductPreviewDialogue(reopened.project, shot, stage);
        const exported = evaluateExportShotAtTime(reopened.project, shot, exportMs);
        const exportModel = buildStageRenderModel(reopened.project, exported, urls);

        for (const repId of [rep1Id, rep5Id]) {
          const sLayer = stage.layers.find((l) => l.id === repId)!;
          const pLayer = preview.layers.find((l) => l.id === repId)!;
          const eLayer = exported.layers.find((l) => l.id === repId)!;
          expect(pLayer.visible).toBe(sLayer.visible);
          expect(eLayer.visible).toBe(sLayer.visible);
          expect(eLayer.opacity).toBeCloseTo(sLayer.opacity, 5);
          expect(Math.abs(eLayer.x - sLayer.x)).toBeLessThan(0.1);
          expect(Math.abs(eLayer.y - sLayer.y)).toBeLessThan(0.1);
          expect(eLayer.rotationDeg).toBeCloseTo(sLayer.rotationDeg, 4);
          if (sLayer.visible) {
            const rLayer = exportModel.layers.find((l) => l.id === repId)!;
            expect(Math.abs(rLayer.render.x - sLayer.x)).toBeLessThan(0.1);
            expect(Math.abs(rLayer.render.y - sLayer.y)).toBeLessThan(0.1);
            expect(rLayer.render.rotationDeg).toBeCloseTo(sLayer.rotationDeg, 4);
            expect(rLayer.render.opacity).toBeCloseTo(sLayer.opacity, 5);
          }
        }
      }
      selection.dispose();
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it('verifies dual-shot formal export schedule with unaligned Shot 1 (1001ms) vs aligned Shot 1 (1000ms) without false snapping (#1273 P3)', () => {
    const base = graphicFaceProject();
    const layers = new LayerService();
    const motion = new LayerMotionService();
    const shotService = new ShotService();

    const buildDualShot = (shot1DurationMs: number) => {
      const clean = ProjectSchema.parse({
        ...base,
        characters: [],
        voiceProfiles: [],
        shots: base.shots.map((s) => ({
          ...s,
          durationMs: shot1DurationMs,
          dialogues: [],
          timelineEvents: [],
          layers: s.layers.filter((l) => l.id === s.backgroundLayerId),
        })),
      });
      const withShot2 = shotService.create(clean, { name: 'Shot 2', durationMs: 1_000 });
      const shot2Id = withShot2.shots[1]!.id;
      const placed = layers.createFromAnimation(withShot2, shot2Id, {
        animationId: FACE_GRAPHIC_ID,
        startTimeMs: 0,
        position: { x: 400, y: 300 },
      });
      const fastShot2 = motion.applyCurveMotion(placed.project, {
        shotId: shot2Id,
        layerId: placed.layer.id,
        startFrame: 0,
        endFrame: 1,
        p1: { x: 800, y: 300 },
        p2: { x: 1200, y: 300 },
        p3: { x: 1600, y: 300 },
        speedMode: 'constant',
      });
      return { project: fastShot2, shot2Id, layerId: placed.layer.id };
    };

    // Unaligned Shot 1 = 1001ms -> global frame 24 (1000ms) belongs to Shot 1; global frame 25 (1041ms) maps to Shot 2 local 40ms (off-grid!).
    const unaligned = buildDualShot(1_001);
    const unalignedSchedule = [...iterateFormalProjectFrameSchedule(unaligned.project, 24)];
    const f24 = unalignedSchedule[24]!;
    const f25 = unalignedSchedule[25]!;
    expect(f24).toMatchObject({ timeMs: 1_000, shotIndex: 0, shotLocalTimeMs: 1_000 });
    expect(f25).toMatchObject({ timeMs: 1_041, shotIndex: 1, shotId: unaligned.shot2Id, shotStartMs: 1_001, shotLocalTimeMs: 40 });
    const unalignedShot2 = unaligned.project.shots[1]!;
    const unalignedEval = evaluateExportShotAtTime(unaligned.project, unalignedShot2, f25.shotLocalTimeMs);
    const unalignedUrls = Object.fromEntries(unaligned.project.assets.map((a) => [a.id, `test:${a.id}`]));
    const unalignedRender = buildStageRenderModel(unaligned.project, unalignedEval, unalignedUrls).layers.find(
      (l) => l.id === unaligned.layerId,
    )!;
    // Continuous off-grid evaluation at 40ms: 400 + 1200 * (40/42) = 1542.86 (NOT falsely snapped to 42ms / 1600!).
    expect(unalignedRender.render.x).toBeCloseTo(400 + (1_200 * 40) / 42, 2);
    expect(unalignedRender.render.x).toBeLessThan(1_580);

    // Aligned Shot 1 = 1000ms -> global frame 25 (1041ms) maps to Shot 2 local 41ms -> resolves to authoring 42ms (X=1600!).
    const aligned = buildDualShot(1_000);
    const alignedSchedule = [...iterateFormalProjectFrameSchedule(aligned.project, 24)];
    const alignedF25 = alignedSchedule[25]!;
    expect(alignedF25).toMatchObject({ timeMs: 1_041, shotIndex: 1, shotId: aligned.shot2Id, shotStartMs: 1_000, shotLocalTimeMs: 41 });
    const alignedShot2 = aligned.project.shots[1]!;
    const alignedEval = evaluateExportShotAtTime(aligned.project, alignedShot2, alignedF25.shotLocalTimeMs);
    const alignedUrls = Object.fromEntries(aligned.project.assets.map((a) => [a.id, `test:${a.id}`]));
    const alignedRender = buildStageRenderModel(aligned.project, alignedEval, alignedUrls).layers.find(
      (l) => l.id === aligned.layerId,
    )!;
    expect(Math.abs(alignedRender.render.x - 1_600)).toBeLessThan(0.1);
  });

  it('persists B01 radial and along-path arrays + independent replica edit/delete across save/reopen and agrees across Stage, Preview, and Export (#1281 B01)', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'panda-stage-b01-static-arrays-'));
    const root = path.join(tempDir, 'b01.pandastage');
    try {
      await mkdir(root, { recursive: true });
      const projectService = new ProjectService();
      const layerService = new LayerService();
      const base = ProjectSchema.parse({
        ...graphicFaceProject(),
        characters: [],
        voiceProfiles: [],
        shots: graphicFaceProject().shots.map((s) => ({
          ...s,
          durationMs: 2_000,
          dialogues: [],
          timelineEvents: [],
          layers: s.layers.filter((l) => l.id === s.backgroundLayerId),
        })),
      });
      const shotId = base.shots[0]!.id;
      const placed = layerService.createFromAnimation(base, shotId, {
        animationId: FACE_GRAPHIC_ID,
        position: { x: 400, y: 300 },
        startTimeMs: 0,
        playback: { mode: 'loop', endBehavior: 'hold' },
      });
      const sourceWithMotion = new LayerMotionService().applyKeys(
        placed.project,
        { shotId, layerId: placed.layer.id, timeMs: 42 },
        { 'transform.offsetX': 40 },
      );

      const store = new EditorProjectStore();
      store.open(root, sourceWithMotion);
      const shots = { getCurrentShotId: () => shotId };
      const selection = new LayerSelectionStore(store, {
        ...shots,
        subscribe: () => () => undefined,
      });
      selection.select(placed.layer.id);
      const layerStore = new LayerStore(store, shots, layerService, selection);

      // Generate radial array (N=4, align) and along-path array (N=4, align) in 2 atomic commands.
      const radialLayers = layerStore.duplicateAnimationLayerRadial(placed.layer.id, {
        count: 4,
        center: { x: 960, y: 540 },
        radius: 200,
        startAngleDeg: 0,
        orientation: 'align',
      });
      const pathLayers = layerStore.duplicateAnimationLayerAlongPath(placed.layer.id, {
        count: 4,
        curve: {
          p0: { x: 400, y: 300 },
          p1: { x: 500, y: 120 },
          p2: { x: 800, y: 120 },
          p3: { x: 900, y: 300 },
        },
        orientation: 'align',
      });
      expect(radialLayers).toHaveLength(4);
      expect(pathLayers).toHaveLength(4);

      // Independently edit one radial replica & delete one path replica without affecting source/siblings.
      layerStore.updateTransform(radialLayers[0]!.id, {
        x: 1_250,
        y: 520,
        scale: 1,
        rotationDeg: 15,
        opacity: 1,
        flipX: false,
      });
      layerStore.deleteLayer(pathLayers[3]!.id);

      const savedProject = store.getSnapshot()!.project;
      await writeFile(path.join(root, 'project.json'), JSON.stringify(placed.project));
      await projectService.save(root, savedProject, 1);
      const reopened = await projectService.open(root);
      expect(reopened.project).toEqual(savedProject);
      expect(reopened.project.animations).toEqual(placed.project.animations);
      expect(reopened.project.assets).toEqual(placed.project.assets);

      // Verify Stage, Product Preview, and Export Render Model agree on non-integer-ms frame 1 (41ms <-> 42ms).
      const shot = reopened.project.shots[0]!;
      const urls = Object.fromEntries(reopened.project.assets.map((a) => [a.id, `test:${a.id}`]));
      const authoringMs = frameTimeMs(1); // 42ms
      const exportMs = exportFrameTimeMs(1); // 41ms
      const stageEval = evaluateShotAtTime(shot, authoringMs, reopened.project);
      const previewEval = projectProductPreviewDialogue(reopened.project, shot, stageEval);
      const exportEval = evaluateExportShotAtTime(reopened.project, shot, exportMs);
      const stageModel = buildStageRenderModel(reopened.project, stageEval, urls);
      const previewModel = buildStageRenderModel(reopened.project, previewEval, urls);
      const exportModel = buildStageRenderModel(reopened.project, exportEval, urls);

      for (const id of [placed.layer.id, radialLayers[0]!.id, radialLayers[1]!.id, pathLayers[0]!.id, pathLayers[1]!.id]) {
        const sLayer = stageModel.layers.find((l) => l.id === id)!;
        const pLayer = previewModel.layers.find((l) => l.id === id)!;
        const eLayer = exportModel.layers.find((l) => l.id === id)!;
        expect(sLayer.render.x).toBeCloseTo(pLayer.render.x, 4);
        expect(sLayer.render.y).toBeCloseTo(pLayer.render.y, 4);
        expect(sLayer.render.rotationDeg).toBeCloseTo(pLayer.render.rotationDeg, 4);
        expect(Math.abs(eLayer.render.x - sLayer.render.x)).toBeLessThan(0.1);
        expect(Math.abs(eLayer.render.y - sLayer.render.y)).toBeLessThan(0.1);
        expect(Math.abs(eLayer.render.rotationDeg - sLayer.render.rotationDeg)).toBeLessThan(0.1);
      }
      expect(reopened.project.shots[0]!.layers.some((l) => l.id === pathLayers[3]!.id)).toBe(false);
      selection.dispose();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
