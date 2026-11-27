import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import demo from '../../demo-project/project-v1.example.json';
import {
  addShotCameraOverride,
  DEFAULT_ANIMATION_BEZIER,
  evaluateAnimationEase,
  evaluateManualCamera,
  extractEquivalentCubicBezier,
  inspectAnimationCurve,
  migrateProject,
  prepareShotCamera,
  sampleAnimationEaseCurve,
  setShotCameraKey,
  setShotCameraMode,
  sliceAnimationCurve,
  type AnimationCurve,
} from '../../src/domain';
import { resolveActiveShotCameraCurveDraft } from '../../src/renderer/features/canvas/ShotCameraCurveDraft';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';

describe('OPT-04 camera easing curve visualization & cubic handle editing', () => {
  it('samples linear, ease, cubic, step, and windowed curves faithfully via evaluateAnimationEase', () => {
    const cubic: AnimationCurve = { bezier: { x1: 0.2, y1: 0, x2: 0.7, y2: 1 } };
    const windowedCubic = sliceAnimationCurve(cubic, 0.25, 0.75);
    const windowedEaseInOut = sliceAnimationCurve(undefined, 0.1, 0.9);

    const cases = [
      { interpolation: 'linear' as const, curve: undefined },
      { interpolation: 'ease-in' as const, curve: undefined },
      { interpolation: 'ease-out' as const, curve: undefined },
      { interpolation: 'ease-in-out' as const, curve: undefined },
      { interpolation: 'step' as const, curve: undefined },
      { interpolation: 'linear' as const, curve: cubic },
      { interpolation: 'linear' as const, curve: windowedCubic },
      { interpolation: 'ease-in-out' as const, curve: windowedEaseInOut },
    ];

    for (const entry of cases) {
      const sampled = sampleAnimationEaseCurve(entry.interpolation, entry.curve, 32);
      expect(sampled).toHaveLength(33);
      for (const point of sampled) {
        expect(point.y).toBeCloseTo(evaluateAnimationEase(point.x, entry.interpolation, entry.curve), 10);
      }
    }
  });

  it('extracts exact equivalent normalized cubic handles for convertible windowed curves and rejects non-equivalent shapes', () => {
    const baseBezier = { x1: 0.2, y1: 0, x2: 0.7, y2: 1 };
    const leftWindow = sliceAnimationCurve({ bezier: baseBezier }, 0, 0.375);
    const rightWindow = sliceAnimationCurve({ bezier: baseBezier }, 0.375, 1);

    for (const windowed of [leftWindow, rightWindow]) {
      const inspected = inspectAnimationCurve('linear', windowed);
      expect(inspected.hasWindow).toBe(true);
      expect(inspected.isDirectCubic).toBe(false);
      expect(inspected.canDragHandles).toBe(true);
      expect(inspected.equivalentBezier).not.toBeNull();

      const equivalent = inspected.equivalentBezier!;
      expect(equivalent.x1).toBeGreaterThanOrEqual(0);
      expect(equivalent.x2).toBeLessThanOrEqual(1);
      expect(equivalent.x1).toBeLessThanOrEqual(equivalent.x2);
      expect(equivalent.y1).toBeGreaterThanOrEqual(0);
      expect(equivalent.y2).toBeLessThanOrEqual(1);

      for (const progress of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
        expect(evaluateAnimationEase(progress, 'linear', { bezier: equivalent })).toBeCloseTo(
          evaluateAnimationEase(progress, 'linear', windowed),
          4,
        );
      }
    }

    // Windowed ease-in-out crossing the 0.5 inflection point is piecewise quadratic, not a single cubic.
    const nonCubicWindow = sliceAnimationCurve(undefined, 0.1, 0.9);
    const nonCubicInspected = inspectAnimationCurve('ease-in-out', nonCubicWindow);
    expect(nonCubicInspected.hasWindow).toBe(true);
    expect(nonCubicInspected.equivalentBezier).toBeNull();
    expect(nonCubicInspected.canDragHandles).toBe(false);

    // Step curve has no cubic handles.
    expect(extractEquivalentCubicBezier('step')).toBeNull();
    expect(inspectAnimationCurve('step', sliceAnimationCurve(undefined, 0.2, 0.8)).canDragHandles).toBe(false);

    // Pure ease-in / ease-out sub-segments are exact quadratics -> exact cubics.
    const easeInSub = sliceAnimationCurve(undefined, 0.2, 0.8);
    const easeInHandles = extractEquivalentCubicBezier('ease-in', easeInSub);
    expect(easeInHandles).not.toBeNull();
    for (const progress of [0.15, 0.5, 0.85]) {
      expect(evaluateAnimationEase(progress, 'linear', { bezier: easeInHandles! })).toBeCloseTo(
        evaluateAnimationEase(progress, 'ease-in', easeInSub),
        4,
      );
    }
  });

  it('invalidates stale camera curve drafts on revision, instance, shot, or blocked-mode changes', () => {
    const base = migrateProject(demo);
    const shotId = base.shots[0]!.id;
    const draft = {
      project: base,
      projectInstanceId: 7,
      revision: 3,
      shotId,
      keyTimeMs: 0,
      timeMs: 500,
    };

    expect(resolveActiveShotCameraCurveDraft(draft, { projectInstanceId: 7, revision: 3, shotId })).toBe(draft);
    expect(resolveActiveShotCameraCurveDraft(draft, { projectInstanceId: 7, revision: 4, shotId })).toBeNull();
    expect(resolveActiveShotCameraCurveDraft(draft, { projectInstanceId: 8, revision: 3, shotId })).toBeNull();
    expect(resolveActiveShotCameraCurveDraft(draft, { projectInstanceId: 7, revision: 3, shotId: 'other' })).toBeNull();
    expect(resolveActiveShotCameraCurveDraft(draft, { projectInstanceId: 7, revision: 3, shotId, blocked: true })).toBeNull();
  });

  it('previews cubic handle drags via draft without creating revision, commits once with Undo/Redo, and preserves window/rotation/hybrid', () => {
    const base = migrateProject(demo);
    const shotId = base.shots[0]!.id;
    let project = setShotCameraMode(base, shotId, 'hybrid');
    project = addShotCameraOverride(project, shotId, {
      id: randomUUID(),
      startMs: 0,
      endMs: 2_000,
      blendInMs: 0,
      blendOutMs: 0,
    });
    project = setShotCameraKey(project, shotId, 0, {
      centerX: 960,
      centerY: 540,
      zoom: 1,
      rotationDeg: 0,
      curveToNext: { bezier: { x1: 0.2, y1: 0, x2: 0.7, y2: 1 } },
    });
    project = setShotCameraKey(project, shotId, 2_000, {
      centerX: 1_200,
      centerY: 480,
      zoom: 2.5,
      rotationDeg: 720,
    });
    // Insert a mid-key at 750ms -> creates curve.window on both [0, 750] and [750, 2000].
    const split = setShotCameraKey(project, shotId, 750);

    const store = new EditorProjectStore();
    store.open('D:/opt04-camera-curve.pandastage', split);
    const initialRevision = store.getSnapshot()!.revision;
    const originalWindowKey = store.getSnapshot()!.project.shots[0]!.camera!.keys[0]!;
    expect(originalWindowKey.curveToNext?.window).toBeDefined();

    // Viewing / inspecting windowed curve creates NO revision and leaves window untouched.
    const inspected = inspectAnimationCurve(originalWindowKey.interpolationToNext, originalWindowKey.curveToNext);
    expect(inspected.hasWindow).toBe(true);
    expect(inspected.equivalentBezier).not.toBeNull();
    expect(store.getSnapshot()!.revision).toBe(initialRevision);
    expect(store.getSnapshot()!.project.shots[0]!.camera!.keys[0]!.curveToNext?.window).toEqual(
      originalWindowKey.curveToNext?.window,
    );

    // Simulate live drag draft preview (does NOT touch store revision or history).
    const draggedHandles = { x1: 0.1, y1: 0.85, x2: 0.4, y2: 0.95 };
    const draftProject = setShotCameraKey(store.getSnapshot()!.project, shotId, 0, {
      curveToNext: { bezier: draggedHandles },
    });
    const draftShot = draftProject.shots[0]!;
    expect(store.getSnapshot()!.revision).toBe(initialRevision);
    expect(store.undo()).toBe(false);

    // Stage preview through draft camera differs from original at mid-segment time (375ms).
    const beforeCam = prepareShotCamera(split, split.shots[0]!, 'speaker-focus')(375)!;
    const draftCam = prepareShotCamera(draftProject, draftShot, 'speaker-focus')(375)!;
    expect(draftCam.zoom).not.toBeCloseTo(beforeCam.zoom, 3);
    expect(draftCam.rotationDeg).not.toBeCloseTo(beforeCam.rotationDeg ?? 0, 2);

    // Commit drag once -> single Undo/Redo, preserves Hybrid, overrides, other keys, and 720° multi-turn rotation.
    store.updateProject(draftProject, '调整相机缓动曲线');
    expect(store.getSnapshot()!.revision).toBe(initialRevision + 1);
    const committedShot = store.getSnapshot()!.project.shots[0]!;
    expect(committedShot.camera?.mode).toBe('hybrid');
    expect(committedShot.camera?.overrides).toHaveLength(1);
    expect(committedShot.camera?.keys[0]?.curveToNext).toEqual({ bezier: draggedHandles });
    expect(committedShot.camera?.keys[1]?.curveToNext?.window).toEqual(split.shots[0]!.camera!.keys[1]!.curveToNext?.window);
    expect(committedShot.camera?.keys[2]?.rotationDeg).toBe(720);

    // Round-trip save/reopen matches formal evaluation.
    const reopened = migrateProject(JSON.parse(JSON.stringify(store.getSnapshot()!.project)));
    expect(prepareShotCamera(reopened, reopened.shots[0]!, 'speaker-focus')(375)).toEqual(
      evaluateManualCamera(committedShot, 375),
    );

    // Single Undo restores original windowed curve completely; Redo restores dragged curve.
    expect(store.undo()).toBe(true);
    expect(store.getSnapshot()!.project.shots[0]!.camera).toEqual(split.shots[0]!.camera);
    expect(store.undo()).toBe(false);
    expect(store.redo()).toBe(true);
    expect(store.getSnapshot()!.project.shots[0]!.camera?.keys[0]?.curveToNext).toEqual({ bezier: draggedHandles });

    // Explicit replacement of a non-equivalent windowed curve (ease-in-out [0.1, 0.9]) works via setShotCameraKey.
    const nonEquiv = setShotCameraKey(
      setShotCameraKey(setShotCameraMode(base, shotId, 'manual'), shotId, 0, {
        interpolationToNext: 'ease-in-out',
        curveToNext: sliceAnimationCurve(undefined, 0.1, 0.9),
      }),
      shotId,
      1_000,
      { zoom: 2 },
    );
    expect(inspectAnimationCurve('ease-in-out', nonEquiv.shots[0]!.camera!.keys[0]!.curveToNext).canDragHandles).toBe(false);
    const replaced = setShotCameraKey(nonEquiv, shotId, 0, { curveToNext: { bezier: DEFAULT_ANIMATION_BEZIER } });
    expect(replaced.shots[0]!.camera!.keys[0]!.curveToNext).toEqual({ bezier: DEFAULT_ANIMATION_BEZIER });
  });
});
