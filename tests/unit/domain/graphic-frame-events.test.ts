import { expect, it } from 'vitest';
import { buildEditorStageRenderModel, clearGraphicFrameAtTime, evaluateShotAtTime, LayerService, migrateProject, setGraphicFrameAtTime } from '../../../src/domain';
import { evaluateExportShotAtTime } from '../../../src/export-renderer/evaluateExportShotAtTime';
import { projectProductPreviewDialogue } from '../../../src/renderer/shell/productPreviewModel';
import { EditorProjectStore } from '../../../src/renderer/stores/EditorProjectStore';
import { FACE_GRAPHIC_ID, graphicFaceProject } from '../../helpers/graphicFaceProject';
import { IDS } from './testProject';

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
