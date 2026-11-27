import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import demo from '../../demo-project/project-v1.example.json';
import {
  addShotCameraOverride,
  evaluateShotCameraOverrideWeight,
  integerFrameSpanMs,
  migrateProject,
  moveShotCameraOverride,
  removeShotCameraOverride,
  setShotCameraKey,
  setShotCameraMode,
  ShotService,
  updateShotCameraOverride,
  type Project,
} from '../../src/domain';
import { previewCameraOverrideDrag } from '../../src/renderer/features/timeline/cameraOverrideGesture';
import { ShotCameraLane } from '../../src/renderer/features/timeline/ShotCameraLane';
import { EditorProjectStore, editorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { resolveSelectedCameraOverride, ShotStore, shotStore } from '../../src/renderer/stores/shotStore';

const OVR_A = '10000000-0000-4000-8000-000000000001';
const OVR_B = '10000000-0000-4000-8000-000000000002';

function buildHybridProject(): Project {
  const base = migrateProject(structuredClone(demo));
  const shotId = base.shots[0]!.id;
  let project = setShotCameraMode(base, shotId, 'hybrid');
  project = setShotCameraKey(project, shotId, 0, { centerX: 960, centerY: 540, zoom: 1, rotationDeg: 0 });
  project = setShotCameraKey(project, shotId, 2_000, { centerX: 700, centerY: 480, zoom: 1.8, rotationDeg: 10 });
  project = addShotCameraOverride(project, shotId, { id: OVR_A, startMs: 500, endMs: 1_000, blendInMs: 100, blendOutMs: 100 });
  project = addShotCameraOverride(project, shotId, { id: OVR_B, startMs: 1_500, endMs: 2_000, blendInMs: 100, blendOutMs: 100 });
  return project;
}

afterEach(() => {
  shotStore.selectCameraOverride(null);
});

describe('OPT-02A (#1395) camera override direct drag & selection sync', () => {
  it('previews body move and edge resize with frame snap, min duration, neighbor and shot bounds', () => {
    const project = buildHybridProject();
    const shot = project.shots[0]!;
    const overrides = shot.camera!.overrides!;
    const first = overrides[0]!;
    const second = overrides[1]!;

    // Move first override right by +250ms (pixelsPerMs = 0.2 => 50px)
    expect(previewCameraOverrideDrag({
      override: first,
      overrides,
      mode: 'move',
      deltaPx: 50,
      pixelsPerMs: 0.2,
      durationMs: shot.durationMs,
    })).toEqual({ startMs: 750, endMs: 1_250 });

    // Move first override past second override -> clamped to touch second.startMs (1500) cleanly
    expect(previewCameraOverrideDrag({
      override: first,
      overrides,
      mode: 'move',
      deltaPx: 400,
      pixelsPerMs: 0.2,
      durationMs: shot.durationMs,
    })).toEqual({ startMs: 1_000, endMs: 1_500 });

    // Move first override past 0 -> clamped to [0, 500)
    expect(previewCameraOverrideDrag({
      override: first,
      overrides,
      mode: 'move',
      deltaPx: -400,
      pixelsPerMs: 0.2,
      durationMs: shot.durationMs,
    })).toEqual({ startMs: 0, endMs: 500 });

    // Resize start of second override past first.endMs -> clamped to adjacent 1000ms
    expect(previewCameraOverrideDrag({
      override: second,
      overrides,
      mode: 'resize-start',
      deltaPx: -400,
      pixelsPerMs: 0.2,
      durationMs: shot.durationMs,
    })).toEqual({ startMs: 1_000, endMs: 2_000 });

    // Resize start past end -> respects minimum 1-frame duration
    const minResizeStart = previewCameraOverrideDrag({
      override: second,
      overrides,
      mode: 'resize-start',
      deltaPx: 400,
      pixelsPerMs: 0.2,
      durationMs: shot.durationMs,
    });
    expect(minResizeStart.endMs).toBe(2_000);
    expect(minResizeStart.endMs - minResizeStart.startMs).toBeGreaterThanOrEqual(integerFrameSpanMs());

    // Resize end of first override past second.startMs -> clamped to adjacent 1500ms
    expect(previewCameraOverrideDrag({
      override: first,
      overrides,
      mode: 'resize-end',
      deltaPx: 400,
      pixelsPerMs: 0.2,
      durationMs: shot.durationMs,
    })).toEqual({ startMs: 500, endMs: 1_500 });

    // Resize end of second override past shot duration -> clamped to shot.durationMs
    expect(previewCameraOverrideDrag({
      override: second,
      overrides,
      mode: 'resize-end',
      deltaPx: 2_000,
      pixelsPerMs: 0.2,
      durationMs: shot.durationMs,
    })).toEqual({ startMs: 1_500, endMs: shot.durationMs });

    // Invalid delta / scale safely returns original range
    expect(previewCameraOverrideDrag({
      override: first,
      overrides,
      mode: 'move',
      deltaPx: Number.NaN,
      pixelsPerMs: 0.2,
      durationMs: shot.durationMs,
    })).toEqual({ startMs: 500, endMs: 1_000 });
  });

  it('keeps global camera keys untouched, recomputes blend weight, and uses a single Undo/Redo entry', () => {
    const editor = new EditorProjectStore();
    const initial = buildHybridProject();
    const shotId = initial.shots[0]!.id;
    const initialKeys = structuredClone(initial.shots[0]!.camera!.keys);
    editor.open('D:/opt02a.pandastage', initial);

    // Move override A to be adjacent to override B: [1000, 1500)
    const moved = moveShotCameraOverride(editor.getSnapshot()!.project, shotId, OVR_A, 1_000);
    editor.updateProject(moved, '移动相机接管段');

    expect(editor.history.getSnapshot().undoCount).toBe(1);
    const movedShot = editor.getSnapshot()!.project.shots[0]!;
    expect(movedShot.camera!.keys).toEqual(initialKeys);
    expect(movedShot.camera!.overrides!.find((o) => o.id === OVR_A)).toMatchObject({ startMs: 1_000, endMs: 1_500 });
    expect(evaluateShotCameraOverrideWeight(movedShot.camera!.overrides, 750)).toBe(0);
    expect(evaluateShotCameraOverrideWeight(movedShot.camera!.overrides, 1_250)).toBe(1);

    // Illegal overlap throws and leaves project unchanged
    expect(() => updateShotCameraOverride(editor.getSnapshot()!.project, shotId, OVR_A, { endMs: 1_600 })).toThrow();

    // Single Undo restores original interval; Redo reapplies it
    expect(editor.undo()).toBe(true);
    expect(editor.getSnapshot()!.project.shots[0]!.camera!.overrides!.find((o) => o.id === OVR_A)).toMatchObject({
      startMs: 500,
      endMs: 1_000,
    });
    expect(editor.redo()).toBe(true);
    expect(editor.getSnapshot()!.project.shots[0]!.camera!.overrides!.find((o) => o.id === OVR_A)).toMatchObject({
      startMs: 1_000,
      endMs: 1_500,
    });
  });

  it('syncs session-only selectedOverrideId without writing Project/History and clears on delete/shot/project switch', () => {
    const editor = new EditorProjectStore();
    const service = new ShotService();
    const store = new ShotStore(editor, service);
    const project = buildHybridProject();
    const shotId = project.shots[0]!.id;
    editor.open('D:/opt02a-sync.pandastage', project);

    const before = editor.getSnapshot()!;
    expect(store.getSelectedCameraOverrideId()).toBeNull();
    // Playhead fallback when unset
    expect(resolveSelectedCameraOverride(before.project.shots[0], null, 750)?.id).toBe(OVR_A);
    expect(resolveSelectedCameraOverride(before.project.shots[0], null, 1_200)).toBeUndefined();

    // Explicit selection takes precedence over playhead and does not mutate project/history
    store.selectCameraOverride(OVR_B);
    expect(store.getSelectedCameraOverrideId()).toBe(OVR_B);
    expect(resolveSelectedCameraOverride(before.project.shots[0], store.getSelectedCameraOverrideId(), 750)?.id).toBe(OVR_B);
    expect(editor.getSnapshot()).toBe(before);
    expect(editor.getSnapshot()).toMatchObject({ revision: 0, dirty: false });
    expect(editor.history.getSnapshot().undoCount).toBe(0);

    // Deleting the selected override clears selectedOverrideId
    editor.updateProject(removeShotCameraOverride(editor.getSnapshot()!.project, shotId, OVR_B), '删除相机接管段');
    expect(store.getSelectedCameraOverrideId()).toBeNull();

    // Switching shots clears selectedOverrideId
    store.selectCameraOverride(OVR_A);
    expect(store.getSelectedCameraOverrideId()).toBe(OVR_A);
    const withSecondShot = service.create(editor.getSnapshot()!.project, { name: 'Shot 2', durationMs: 3_000 });
    editor.updateProject(withSecondShot, 'Create shot');
    store.select(withSecondShot.shots[1]!.id);
    expect(store.getSelectedCameraOverrideId()).toBeNull();

    // Switching back and then switching projects clears selectedOverrideId
    store.select(shotId);
    store.selectCameraOverride(OVR_A);
    expect(store.getSelectedCameraOverrideId()).toBe(OVR_A);
    editor.open('D:/opt02a-other.pandastage', buildHybridProject());
    expect(store.getSelectedCameraOverrideId()).toBeNull();

    store.dispose();
  });

  it('renders override bars with resize handles and synced selection attributes in ShotCameraLane', () => {
    const project = buildHybridProject();
    editorProjectStore.open('D:/opt02a-render.pandastage', project);
    const snapshot = editorProjectStore.getSnapshot()!;
    const shot = snapshot.project.shots[0]!;

    // When unset, playhead inside OVR_A highlights OVR_A
    const markupFallback = renderToStaticMarkup(createElement(ShotCameraLane, {
      snapshot,
      shot,
      currentTimeMs: 750,
      pixelsPerMs: 0.2,
      trackWidth: 1_000,
      disabled: false,
    }));
    expect(markupFallback.match(/data-testid="shot-camera-override"/gu)).toHaveLength(2);
    expect(markupFallback.match(/data-testid="shot-camera-override-handle-start"/gu)).toHaveLength(2);
    expect(markupFallback.match(/data-testid="shot-camera-override-handle-end"/gu)).toHaveLength(2);
    expect(markupFallback).toContain(`data-override-id="${OVR_A}" data-active="true" data-selected="true"`);
    expect(markupFallback).toContain(`data-override-id="${OVR_B}" data-active="false" data-selected="false"`);

    // Explicit selection of OVR_B syncs to ShotCameraLane even while playhead is at 750ms
    shotStore.selectCameraOverride(OVR_B);
    const markupSelected = renderToStaticMarkup(createElement(ShotCameraLane, {
      snapshot,
      shot,
      currentTimeMs: 750,
      pixelsPerMs: 0.2,
      trackWidth: 1_000,
      disabled: false,
    }));
    expect(markupSelected).toContain(`data-override-id="${OVR_A}" data-active="true" data-selected="false"`);
    expect(markupSelected).toContain(`data-override-id="${OVR_B}" data-active="false" data-selected="true"`);
    expect(editorProjectStore.getSnapshot()).toBe(snapshot);
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(0);
  });
});
