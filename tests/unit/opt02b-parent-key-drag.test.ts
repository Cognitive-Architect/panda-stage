import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  evaluateShotAtTime,
  LayerService,
  migrateProject,
  TIMELINE_FPS,
  type Project,
} from '../../src/domain';
import { LayerParentLane } from '../../src/renderer/features/timeline/LayerParentLane';
import { previewPositionKeyTime } from '../../src/renderer/features/timeline/positionKeyGesture';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { buildProject, IDS } from './domain/testProject';

function buildHandoffProject(): { project: Project; shotId: string; parentAId: string; parentBId: string; propId: string } {
  const layerService = new LayerService();
  let project = buildProject();
  const shotId = project.shots[0]!.id;
  const parentAId = IDS.layerChar;
  const propId = IDS.layerAsset;

  const createdB = layerService.createControl(project, shotId);
  project = createdB.project;
  const parentBId = createdB.layer.id;
  project = layerService.updatePosition(project, shotId, parentBId, { x: 800, y: 420 });

  // Static base binding to parentA, then handoff to parentB at 1000ms, then release at 2000ms
  project = layerService.setParent(project, shotId, propId, parentAId, 0);
  project = layerService.setParentKey(project, shotId, propId, 1_000, parentBId);
  project = layerService.setParentKey(project, shotId, propId, 2_000, null);
  return { project, shotId, parentAId, parentBId, propId };
}

describe('OPT-02B (#1396) parentKeys handoff marker direct drag on timeline', () => {
  it('renders static base marker distinctly from dynamic handoff markers and hides for static-only or background layers', () => {
    const { project, shotId, propId } = buildHandoffProject();
    const editor = new EditorProjectStore();
    editor.open('D:/opt02b-render.pandastage', project);
    const snapshot = editor.getSnapshot()!;
    const shot = snapshot.project.shots[0]!;
    const propLayer = shot.layers.find((layer) => layer.id === propId)!;
    const bgLayer = shot.layers.find((layer) => layer.id === shot.backgroundLayerId)!;

    // Background layer -> renders nothing
    expect(renderToStaticMarkup(createElement(LayerParentLane, {
      snapshot,
      shot,
      layer: bgLayer,
      currentTimeMs: 0,
      pixelsPerMs: 0.2,
      trackWidth: 1_000,
      disabled: false,
    }))).toBe('');

    // Static-only parent binding (no parentKeys) -> renders nothing
    const staticOnlyLayer = { ...propLayer, parentKeys: undefined };
    expect(renderToStaticMarkup(createElement(LayerParentLane, {
      snapshot,
      shot,
      layer: staticOnlyLayer,
      currentTimeMs: 0,
      pixelsPerMs: 0.2,
      trackWidth: 1_000,
      disabled: false,
    }))).toBe('');

    // Dynamic handoff layer with static base binding -> renders base marker + 2 handoff markers
    const markup = renderToStaticMarkup(createElement(LayerParentLane, {
      snapshot,
      shot,
      layer: propLayer,
      currentTimeMs: 1_000,
      pixelsPerMs: 0.2,
      trackWidth: 1_000,
      disabled: false,
    }));
    expect(markup).toContain('data-testid="layer-parent-lane"');
    expect(markup).toContain('data-testid="layer-parent-base-marker"');
    expect(markup).toContain('data-kind="base"');
    expect(markup.match(/data-testid="layer-parent-key"/gu)).toHaveLength(2);
    expect(markup.match(/data-kind="handoff"/gu)).toHaveLength(2);
    expect(markup).toContain('data-key-time="1000"');
    expect(markup).toContain('data-key-time="2000"');
    expect(markup).toContain('left:200px');
    expect(markup).toContain('left:400px');

    // Locked layer disables handoff dragging markers
    const lockedMarkup = renderToStaticMarkup(createElement(LayerParentLane, {
      snapshot,
      shot,
      layer: { ...propLayer, locked: true },
      currentTimeMs: 1_000,
      pixelsPerMs: 0.2,
      trackWidth: 1_000,
      disabled: false,
    }));
    expect(lockedMarkup.match(/disabled=""/gu)).toHaveLength(2);
    expect(shotId).toBe(shot.id);
    expect(editor.getSnapshot()).toBe(snapshot);
    expect(editor.history.getSnapshot().undoCount).toBe(0);
  });

  it('snaps drag preview between neighbors, commits via LayerService.moveParentKey with compensation and 1 Undo/Redo, and round-trips', () => {
    const layerService = new LayerService();
    const { project, shotId, propId } = buildHandoffProject();
    const editor = new EditorProjectStore();
    editor.open('D:/opt02b-drag.pandastage', project);

    const shot = editor.getSnapshot()!.project.shots[0]!;
    const propLayer = shot.layers.find((layer) => layer.id === propId)!;
    const keys = propLayer.parentKeys!;

    // Drag first handoff key (1000ms) right by +50px at 0.2 px/ms => +250ms => 1250ms
    const previewTarget = previewPositionKeyTime({
      fromTimeMs: keys[0]!.timeMs,
      deltaPx: 50,
      pixelsPerMs: 0.2,
      previousTimeMs: -1_000 / TIMELINE_FPS,
      nextTimeMs: keys[1]!.timeMs,
      durationMs: shot.durationMs,
    });
    expect(previewTarget).toBe(1_250);

    // Dragging past neighbor (2000ms) clamps 1 frame before 2000ms
    const clampedTarget = previewPositionKeyTime({
      fromTimeMs: keys[0]!.timeMs,
      deltaPx: 500,
      pixelsPerMs: 0.2,
      previousTimeMs: -1_000 / TIMELINE_FPS,
      nextTimeMs: keys[1]!.timeMs,
      durationMs: shot.durationMs,
    });
    expect(clampedTarget).toBeLessThan(keys[1]!.timeMs);

    // Commit via LayerService.moveParentKey
    const beforeMovePose = evaluateShotAtTime(shot, previewTarget, editor.getSnapshot()!.project)
      .layers.find((entry) => entry.id === propId)!;
    const moved = layerService.moveParentKey(editor.getSnapshot()!.project, shotId, propId, 1_000, previewTarget);
    editor.updateProject(moved, '移动父级交接帧');

    expect(editor.history.getSnapshot().undoCount).toBe(1);
    const movedShot = editor.getSnapshot()!.project.shots[0]!;
    const movedProp = movedShot.layers.find((layer) => layer.id === propId)!;
    expect(movedProp.parentKeys!.map((k) => k.timeMs)).toEqual([1_250, 2_000]);

    // Compensation preserves world position at the new handoff boundary
    const afterMovePose = evaluateShotAtTime(movedShot, previewTarget, editor.getSnapshot()!.project)
      .layers.find((entry) => entry.id === propId)!;
    expect(afterMovePose.x).toBeCloseTo(beforeMovePose.x, 3);
    expect(afterMovePose.y).toBeCloseTo(beforeMovePose.y, 3);

    // Save/reopen round-trip preserves exact evaluation
    const reopened = migrateProject(JSON.parse(JSON.stringify(editor.getSnapshot()!.project)));
    const reopenedPose = evaluateShotAtTime(reopened.shots[0]!, previewTarget, reopened)
      .layers.find((entry) => entry.id === propId)!;
    expect(reopenedPose.x).toBeCloseTo(afterMovePose.x, 3);
    expect(reopenedPose.y).toBeCloseTo(afterMovePose.y, 3);

    // Single Undo restores original 1000ms handoff; Redo reapplies 1250ms
    expect(editor.undo()).toBe(true);
    expect(editor.getSnapshot()!.project.shots[0]!.layers.find((l) => l.id === propId)!.parentKeys!.map((k) => k.timeMs))
      .toEqual([1_000, 2_000]);
    expect(editor.redo()).toBe(true);
    expect(editor.getSnapshot()!.project.shots[0]!.layers.find((l) => l.id === propId)!.parentKeys!.map((k) => k.timeMs))
      .toEqual([1_250, 2_000]);
  });

  it('rejects cycles and locked layers without mutating Project/History', () => {
    const layerService = new LayerService();
    const { project, shotId, parentAId, parentBId, propId } = buildHandoffProject();
    // Make parentB become child of prop at 500ms (legal while prop is child of parentA until 1000ms,
    // wait: at 1000ms prop switches to parentB, so parentB->prop at 500ms would overlap [1000, 2000).
    // Instead: parentB becomes child of prop at 2000ms (when prop releases to null -> legal!).
    // Then moving prop's release key (2000ms) to 2500ms overlaps [2000, 2500) where prop->parentB AND parentB->prop => cycle!
    const withReverse = layerService.setParentKey(project, shotId, parentBId, 2_000, propId);
    const editor = new EditorProjectStore();
    editor.open('D:/opt02b-guards.pandastage', withReverse);
    const before = editor.getSnapshot()!;

    expect(() => layerService.moveParentKey(before.project, shotId, propId, 2_000, 2_500)).toThrow(/循环/u);
    expect(editor.getSnapshot()).toBe(before);
    expect(editor.history.getSnapshot().undoCount).toBe(0);

    // Locked layer cannot move parent keys
    const locked = layerService.setLocked(before.project, shotId, propId, true);
    expect(() => layerService.moveParentKey(locked, shotId, propId, 1_000, 1_250)).toThrow();
    expect(parentAId).toBeTruthy();
  });
});
