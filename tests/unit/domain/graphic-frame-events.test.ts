import { expect, it } from 'vitest';
import { buildEditorStageRenderModel, clearGraphicFrameAtTime, evaluateShotAtTime, LayerService, listShotGraphicImageAssetsAtTime,
  frameTimeMs, listShotRuntimeImageAssets, migrateProject, ProjectSchema,
  setGraphicFrameAtTime, syncGraphicPlaybackForward, type Project } from '../../../src/domain';
import { evaluateExportShotAtTime } from '../../../src/export-renderer/evaluateExportShotAtTime';
import { planPngSequenceFrames } from '../../../src/shared/export-types';
import { projectProductPreviewDialogue } from '../../../src/renderer/shell/productPreviewModel';
import { buildEditorTemporalCanvasModel } from '../../../src/renderer/features/canvas/editorTemporalCanvasModel';
import { EditorProjectStore } from '../../../src/renderer/stores/EditorProjectStore';
import { FACE_GRAPHIC_ID, graphicFaceProject } from '../../helpers/graphicFaceProject';
import { IDS } from './testProject';

it('keeps Graphic lifetime, hidden gaps and sync endpoints on the same frames in Stage, Preview and PNG', () => {
  const service = new LayerService();
  const { layer, project } = service.createFromAnimation(graphicFaceProject(false), IDS.shot, {
    animationId: FACE_GRAPHIC_ID, startTimeMs: 292, position: { x: 200, y: 100 },
    playback: { mode: 'loop', endBehavior: 'hold' },
  });
  const baseShot = project.shots[0]!;
  const timelineEvents = [{ timeMs: 542, visible: false }, { timeMs: 667, visible: true }].map(({ timeMs, visible }) => ({
    type: 'visibility', id: crypto.randomUUID(), layerId: layer.id, startMs: timeMs, endMs: timeMs, visible,
  }));
  const withGap = ProjectSchema.parse({ ...project, shots: [{ ...baseShot, timelineEvents }] });
  const before = setGraphicFrameAtTime(withGap, baseShot.id, layer.id, FACE_GRAPHIC_ID, 10, 458);
  const sync = (base: Project, start: number, end: number, mode: 'loop' | 'single-frame') =>
    syncGraphicPlaybackForward(base, baseShot.id, layer.id, FACE_GRAPHIC_ID, start, end,
      { firstFrame: 1, range: { firstFrame: 0, lastFrame: 2 }, playback: { mode, endBehavior: 'hold' } });
  const synced = sync(sync(before, 292, 792, 'loop'), 667, 792, 'single-frame');
  const shot = synced.shots[0]!;
  expect(shot.timelineEvents.filter(({ type }) => type === 'graphic-playback')).toMatchObject([
    { startMs: 292, endMs: 542 }, { startMs: 667, endMs: 792 },
  ]);
  const frames = [...planPngSequenceFrames(synced, { shotId: shot.id, transparent: true,
    range: { startMs: 250, endMs: 875 } }).frames()];
  expect(frames.map(({ shotLocalTimeMs }) => shotLocalTimeMs)).toContain(291);
  const projection = (value: ReturnType<typeof evaluateShotAtTime>) => {
    const entry = value.layers.find(({ id }) => id === layer.id)!;
    return { visible: entry.visible, animationFrame: entry.animationFrame };
  };
  const evaluate = (timeMs: number) => evaluateShotAtTime(shot, timeMs, synced);
  const readyAssetIds = new Set(synced.assets.map(({ id }) => id));
  for (const index of [19, 7, 16, 6, 13, 12, 18, 15, 8]) {
    const stageTime = frameTimeMs(index);
    const floor = frames.find(({ timeMs }) => Math.round(timeMs * 24 / 1_000) === index)!;
    const stage = buildEditorTemporalCanvasModel({
      project: synced, shot, currentTimeMs: stageTime, readyAssetIds, previousVisuals: new Map(),
    }).evaluatedShot;
    const preview = projectProductPreviewDialogue(synced, shot, evaluate(stageTime));
    const exported = evaluateExportShotAtTime(synced, shot, floor.shotLocalTimeMs);
    expect(projection(exported), `export ${floor.timeMs} / editor ${stageTime}`).toEqual(projection(preview));
    expect(projection(stage)).toEqual(projection(preview));
  }
  expect(projection(evaluate(250)).visible).toBe(false);
  expect(projection(evaluate(292))).toMatchObject({ visible: true, animationFrame: { frameOrdinal: 1 } });
  expect(projection(evaluate(542)).visible).toBe(false);
  expect(projection(evaluate(667))).toMatchObject({ visible: true, animationFrame: { frameOrdinal: 1 } });
  expect(projection(evaluate(792))).toMatchObject({ visible: true, animationFrame: { frameOrdinal: 3 } });
  expect(projection(evaluate(291)).visible).toBe(false);
  expect(projection(evaluate(541)).visible).toBe(true);
  expect(projection(evaluate(666)).visible).toBe(false);
  expect(projection(evaluate(791)).animationFrame?.frameOrdinal).toBe(1);
});

it('keeps once/hide boundaries exact and leaves unrelated events on the original sample clock', () => {
  const { project, layer } = new LayerService().createFromAnimation(graphicFaceProject(false), IDS.shot, {
    animationId: FACE_GRAPHIC_ID, startTimeMs: 0, position: { x: 200, y: 100 },
    playback: { mode: 'once', endBehavior: 'hide' },
  });
  const shot = project.shots[0]!;
  const otherLayer = shot.layers.find((entry) => entry.id !== layer.id)!;
  const timelineEvents = [{ type: 'visibility', id: crypto.randomUUID(), layerId: otherLayer.id,
    startMs: 167, endMs: 167, visible: false }];
  const withVisibility = ProjectSchema.parse({ ...project, shots: [{ ...shot, timelineEvents }] });
  const synced = syncGraphicPlaybackForward(withVisibility, shot.id, layer.id, FACE_GRAPHIC_ID, 0, 250,
    { firstFrame: 1, range: { firstFrame: 0, lastFrame: 2 }, playback: { mode: 'loop', endBehavior: 'hold' } });
  const syncedShot = synced.shots[0]!;
  expect(syncedShot.timelineEvents.find(({ type }) => type === 'graphic-playback')).toMatchObject({ endMs: 167 });
  const at = (id: string, output: ReturnType<typeof evaluateShotAtTime>) => output.layers.find((entry) => entry.id === id);
  const exact = evaluateShotAtTime(syncedShot, 166, synced);
  const exported = evaluateExportShotAtTime(synced, syncedShot, 166);
  expect(at(layer.id, exact)?.visible).toBe(true);
  expect(at(layer.id, exported)?.visible).toBe(false);
  expect(at(otherLayer.id, exported)).toEqual(at(otherLayer.id, exact));
  expect(at(layer.id, evaluateExportShotAtTime(synced, syncedShot, 166)))
    .toEqual(at(layer.id, evaluateShotAtTime(syncedShot, 167, synced)));
});

it('holds each instance source frame until its next key and preserves same-source playback, history and reopen', () => {
  const layers = new LayerService();
  const placement = { animationId: FACE_GRAPHIC_ID, startTimeMs: 0, position: { x: 200, y: 100 },
    playback: { mode: 'loop' as const, endBehavior: 'hold' as const } };
  const first = layers.createFromAnimation(graphicFaceProject(), IDS.shot, placement);
  const second = layers.createFromAnimation(first.project, IDS.shot, placement);
  const editor = new EditorProjectStore();
  editor.open('D:/graphic-frame-test', second.project);
  const initial = editor.getSnapshot()!;
  const write = (frame: number, time: number) => {
    const current = editor.getSnapshot()!;
    const next = setGraphicFrameAtTime(current.project, IDS.shot, first.layer.id, FACE_GRAPHIC_ID, frame, time);
    if (next !== current.project) editor.updateProject(next, 'Set Graphic frame');
  };
  write(8, 500);
  const firstKeyId = editor.getSnapshot()!.project.shots[0]!.timelineEvents[0]!.id;
  write(10, 500);
  write(9, 1_000);
  write(9, 1_000);
  expect(editor.history.getSnapshot().undoCount).toBe(3);
  expect(editor.getSnapshot()!.project.shots[0]!.timelineEvents).toMatchObject([
    { id: firstKeyId, startMs: 500, sourceFrameIndex: 10 },
    { startMs: 1_000, sourceFrameIndex: 9 },
  ]);
  const completed = editor.getSnapshot()!.project;
  expect(editor.undo()).toBe(true);
  expect(editor.getSnapshot()!.project.shots[0]!.timelineEvents).toHaveLength(1);
  expect(editor.redo()).toBe(true);
  expect(editor.getSnapshot()!.project).toEqual(completed);
  const reopened = migrateProject(JSON.parse(JSON.stringify(completed)));
  const shot = reopened.shots[0]!;
  expect(shot.layers).toEqual(initial.project.shots[0]!.layers);
  for (const [time, ordinal] of [[1_250, 2], [500, 3], [0, 0], [875, 3], [1_000, 2]] as const) {
    const evaluated = evaluateShotAtTime(shot, time, reopened);
    const preview = projectProductPreviewDialogue(reopened, shot, evaluated);
    const output = evaluateExportShotAtTime(reopened, shot, time);
    for (const frame of [evaluated, preview, output]) {
      expect(frame.layers.find((entry) => entry.id === first.layer.id)?.animationFrame?.frameOrdinal).toBe(ordinal);
    }
    const render = buildEditorStageRenderModel(reopened, shot, evaluated);
    expect(render.layers.find((entry) => entry.layer.id === first.layer.id)?.visual.flaGraphic?.frameOrdinal).toBe(ordinal);
    expect(evaluated.layers.find((entry) => entry.id === second.layer.id)?.animationFrame)
      .toEqual(evaluateShotAtTime(initial.project.shots[0]!, time, initial.project).layers.find((entry) => entry.id === second.layer.id)?.animationFrame);
  }
  editor.open('D:/graphic-frame-test', reopened);
  expect(clearGraphicFrameAtTime(reopened, IDS.shot, first.layer.id, FACE_GRAPHIC_ID, 1_000, firstKeyId)).toBe(reopened);
  const cleared = clearGraphicFrameAtTime(reopened, IDS.shot, first.layer.id, FACE_GRAPHIC_ID, 500, firstKeyId);
  const clearedShot = cleared.shots[0]!;
  expect(clearedShot.timelineEvents).toEqual([shot.timelineEvents[1]]);
  editor.updateProject(cleared, 'Clear Graphic frame');
  expect(editor.history.getSnapshot().undoCount).toBe(1);
  expect(editor.undo()).toBe(true);
  expect(editor.getSnapshot()!.project).toEqual(reopened);
  expect(editor.redo()).toBe(true);
  expect(editor.getSnapshot()!.project).toEqual(cleared);
  expect(evaluateShotAtTime(clearedShot, 500, cleared)).toEqual(evaluateShotAtTime(initial.project.shots[0]!, 500, initial.project));
  const afterClear = evaluateShotAtTime(clearedShot, 875, cleared);
  const expected = evaluateShotAtTime(initial.project.shots[0]!, 875, initial.project);
  for (const frame of [afterClear, projectProductPreviewDialogue(cleared, clearedShot, afterClear),
    evaluateExportShotAtTime(cleared, clearedShot, 875)]) {
    expect(frame.layers.map((entry) => entry.animationFrame)).toEqual(expected.layers.map((entry) => entry.animationFrame));
  }
  expect(evaluateShotAtTime(clearedShot, 1_000, cleared)).toEqual(evaluateShotAtTime(shot, 1_000, reopened));
});

it('keeps a keyed Graphic hidden outside its independently authored play window', () => {
  const created = new LayerService().createFromAnimation(graphicFaceProject(), IDS.shot, {
    animationId: FACE_GRAPHIC_ID, startTimeMs: 500, position: { x: 200, y: 100 },
    playback: { mode: 'once', endBehavior: 'hide' },
  });
  const project = setGraphicFrameAtTime(created.project, IDS.shot, created.layer.id, FACE_GRAPHIC_ID, 10, 0);
  const shot = project.shots[0]!;
  const layerAt = (time: number) => evaluateShotAtTime(shot, time, project).layers.find((layer) => layer.id === created.layer.id);
  expect(layerAt(0)?.visible).toBe(false);
  expect(layerAt(500)).toMatchObject({ visible: true, animationFrame: { frameOrdinal: 3 } });
  expect(layerAt(750)?.visible).toBe(false);
});

it('syncs one Graphic across time, preserves the surrounding state, and survives reverse seeks and reopen', () => {
  const layers = new LayerService();
  const placement = { animationId: FACE_GRAPHIC_ID, startTimeMs: 0, position: { x: 200, y: 100 },
    playback: { mode: 'loop' as const, endBehavior: 'hold' as const } };
  const { layer, project: first } = layers.createFromAnimation(graphicFaceProject(), IDS.shot, placement);
  const second = layers.createFromAnimation(first, IDS.shot, placement);
  const keyed = setGraphicFrameAtTime(second.project, IDS.shot, layer.id, FACE_GRAPHIC_ID, 10, 500);
  const old = migrateProject({ ...keyed, schemaVersion: 40 });
  expect(old.shots).toEqual(keyed.shots);
  const editor = new EditorProjectStore();
  editor.open('D:/graphic-sync', old);
  const settings = { firstFrame: 1, range: { firstFrame: 0, lastFrame: 2 }, playback: placement.playback };
  const sync = (project: Project, startMs: number, endMs: number, value = settings) =>
    syncGraphicPlaybackForward(project, IDS.shot, layer.id, FACE_GRAPHIC_ID, startMs, endMs, value);
  const synced = sync(old, 250, 750);
  editor.updateProject(synced, 'Synchronize Graphic');
  expect(editor.history.getSnapshot().undoCount).toBe(1);
  expect(editor.undo()).toBe(true);
  expect(editor.getSnapshot()?.project).toEqual(old);
  expect(editor.redo()).toBe(true);
  expect(editor.getSnapshot()?.project).toEqual(synced);
  expect(sync(synced, 250, 750)).toBe(synced);
  const reopened = migrateProject(JSON.parse(JSON.stringify(synced)));
  expect(reopened).toEqual(synced);
  const shot = reopened.shots[0]!;
  expect(shot.timelineEvents).toMatchObject([
    { type: 'graphic-frame', startMs: 500, sourceFrameIndex: 10 },
    { type: 'graphic-playback', startMs: 250, endMs: 750, firstFrame: 1 },
  ]);
  expect(shot.layers).toEqual(old.shots[0]!.layers);
  expect(reopened.animations).toEqual(old.animations);
  const evaluate = (project: Project, time: number) =>
    evaluateShotAtTime(project.shots[0]!, time, project).layers.find((entry) => entry.id === layer.id);
  for (const [time, ordinal] of [[750, 3], [333, 0], [250, 1], [500, 1], [292, 2], [375, 1]] as const) {
    const evaluated = evaluateShotAtTime(shot, time, reopened);
    for (const sample of [evaluated, projectProductPreviewDialogue(reopened, shot, evaluated),
      evaluateExportShotAtTime(reopened, shot, time)]) {
      expect(sample.layers.find((entry) => entry.id === layer.id)?.animationFrame?.frameOrdinal).toBe(ordinal);
    }
    const rendered = buildEditorStageRenderModel(reopened, shot, evaluated);
    expect(rendered.layers.find((entry) => entry.layer.id === layer.id)?.visual.flaGraphic?.frameOrdinal).toBe(ordinal);
    expect(evaluated.layers.find((entry) => entry.id === second.layer.id)?.animationFrame)
      .toEqual(evaluateShotAtTime(old.shots[0]!, time, old).layers.find((entry) => entry.id === second.layer.id)?.animationFrame);
  }
  for (const time of [0, 249, 750, 1_000]) expect(evaluate(reopened, time)).toEqual(evaluate(old, time));
  expect(evaluateExportShotAtTime(reopened, shot, 291).layers.find((entry) => entry.id === layer.id)?.animationFrame)
    .toEqual(evaluate(reopened, 292)?.animationFrame);

  const replacement = sync(reopened, 375, 583, { ...settings, firstFrame: 2 });
  expect(evaluate(replacement, 375)?.animationFrame?.frameOrdinal).toBe(2);
  for (const time of [300, 583, 670, 750]) expect(evaluate(replacement, time)).toEqual(evaluate(reopened, time));
  const keyedAgain = setGraphicFrameAtTime(replacement, IDS.shot, layer.id, FACE_GRAPHIC_ID, 10, 625);
  expect(evaluate(keyedAgain, 625)?.animationFrame?.frameOrdinal).toBe(3);
  expect(evaluate(keyedAgain, 600)).toEqual(evaluate(replacement, 600));
  const layerBatch = layers.applySourceLoop(reopened, IDS.shot, layer.id, {
    firstFrame: 0, lastFrame: 2, closingReference: true, throughLayerId: second.layer.id,
  }).project.shots[0]!;
  expect(layerBatch.layers.filter(({ id }) => id === layer.id || id === second.layer.id)
    .map(({ animationSourceRange }) => animationSourceRange)).toEqual([
    { firstFrame: 0, lastFrame: 1 }, { firstFrame: 0, lastFrame: 1 },
  ]);
  expect(layerBatch.timelineEvents).toEqual(shot.timelineEvents);
});

it('caps Graphic sync at the first visibility gap and respects the single lifetime of once/hide layers', () => {
  const service = new LayerService();
  const placed = service.createFromAnimation(graphicFaceProject(), IDS.shot, {
    animationId: FACE_GRAPHIC_ID, startTimeMs: 500, position: { x: 200, y: 100 },
    playback: { mode: 'loop', endBehavior: 'hold' },
  });
  const target = placed.layer.id;
  const shot = placed.project.shots[0]!;
  const gaps = [
    { id: crypto.randomUUID(), layerId: target, type: 'visibility', startMs: 1_200, endMs: 1_200, visible: false },
    { id: crypto.randomUUID(), layerId: target, type: 'visibility', startMs: 1_600, endMs: 1_600, visible: true },
  ];
  const project = ProjectSchema.parse({ ...placed.project, shots: [{ ...shot, timelineEvents: gaps }] });
  const sync = (base: Project, startMs: number, endMs: number) => syncGraphicPlaybackForward(
    base, IDS.shot, target, FACE_GRAPHIC_ID, startMs, endMs,
    { firstFrame: 1, range: { firstFrame: 0, lastFrame: 2 }, playback: { mode: 'loop', endBehavior: 'hold' } },
  );
  expect(() => sync(project, 250, 2_000)).toThrow();
  expect(() => sync(project, 1_250, 2_000)).toThrow();
  expect(sync(project, 750, 2_000).shots[0]!.timelineEvents).toMatchObject([
    ...gaps, { type: 'graphic-playback', startMs: 750, endMs: 1_200 },
  ]);
  const once = ProjectSchema.parse({ ...placed.project, shots: [{ ...shot, layers: shot.layers.map((layer) =>
    layer.id === target ? { ...layer, animationPlayback: { mode: 'once', endBehavior: 'hide' } } : layer) }] });
  expect(sync(once, 500, 2_000).shots[0]!.timelineEvents).toMatchObject([
    { type: 'graphic-playback', startMs: 500, endMs: 667 },
  ]);
});

it('requests the target Graphic frame for Stage even when the zero-time assets only include another frame', () => {
  const created = new LayerService().createFromAnimation(graphicFaceProject(false), IDS.shot, {
    animationId: FACE_GRAPHIC_ID, startTimeMs: 0, position: { x: 200, y: 100 },
    playback: { mode: 'loop', endBehavior: 'hold' },
  });
  const project = setGraphicFrameAtTime(created.project, IDS.shot, created.layer.id, FACE_GRAPHIC_ID, 10, 500);
  const shot = project.shots[0]!;
  const frames = project.animations[0]!.frames;
  const initial = listShotRuntimeImageAssets(project, shot).map(({ id }) => id);
  expect(initial).toContain(frames[0]!.assetId);
  expect(initial).not.toContain(frames[3]!.assetId);
  expect(listShotGraphicImageAssetsAtTime(project, shot, 500).map(({ id }) => id)).toEqual([frames[3]!.assetId]);
  const synced = syncGraphicPlaybackForward(project, shot.id, created.layer.id, FACE_GRAPHIC_ID, 250, 750,
    { firstFrame: 1, range: { firstFrame: 0, lastFrame: 2 }, playback: { mode: 'loop', endBehavior: 'hold' } });
  expect(listShotGraphicImageAssetsAtTime(synced, synced.shots[0]!, 292).map(({ id }) => id)).toEqual([frames[2]!.assetId]);

  const hidden = ProjectSchema.parse({ ...project, shots: [{ ...shot, timelineEvents: [
    ...shot.timelineEvents,
    { type: 'visibility', id: crypto.randomUUID(), layerId: created.layer.id, startMs: 500, endMs: 500, visible: false },
  ] }] });
  const scene = { project: hidden, shot: hidden.shots[0]!, readyAssetIds: new Set(initial) };
  const visible = buildEditorTemporalCanvasModel({ ...scene, currentTimeMs: 0, previousVisuals: new Map() });
  const gap = buildEditorTemporalCanvasModel({ ...scene, currentTimeMs: 500, previousVisuals: visible.lastValidVisuals });
  expect(gap.evaluatedShot.layers.find((entry) => entry.id === created.layer.id)?.visible).toBe(false);
  expect(gap.visualsByLayer.get(created.layer.id)).toBeNull();
});
