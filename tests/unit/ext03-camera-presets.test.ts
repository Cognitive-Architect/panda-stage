import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import demo from '../../demo-project/project-v1.example.json';
import {
  addShotCameraOverride,
  applyCameraMotionPreset,
  cameraLayerTransform,
  evaluateManualCamera,
  evaluateShotAtTime,
  findFreeCameraPresetStartMs,
  isValidFrameTime,
  migrateProject,
  moveShotCameraKey,
  planCameraMotionPreset,
  prepareShotCamera,
  setShotCameraKey,
  setShotCameraMode,
  ShotService,
  type Project,
} from '../../src/domain';
import { evaluateExportShotAtTime } from '../../src/export-renderer/evaluateExportShotAtTime';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';

function createBaseShotProject(): {
  project: Project;
  shotId: string;
  actorAId: string;
  actorBId: string;
  hudId: string;
} {
  const base = migrateProject(demo);
  const shot = base.shots[0]!;
  const templateLayer = shot.layers.find((layer) => layer.id !== shot.backgroundLayerId)!;
  const carrierId = randomUUID();
  const actorAId = randomUUID();
  const actorBId = randomUUID();
  const hudId = randomUUID();
  const identity = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

  const project = migrateProject({
    ...base,
    shots: [{
      ...shot,
      durationMs: 4_000,
      layers: [
        ...shot.layers.filter((layer) => layer.id === shot.backgroundLayerId),
        {
          ...templateLayer,
          id: carrierId,
          name: 'Carrier',
          x: 200,
          y: 100,
          depth: 500,
          visible: true,
          zIndex: 5,
        },
        {
          ...templateLayer,
          id: actorAId,
          name: 'Actor A',
          parentLayerId: carrierId,
          parentSpaceOffset: identity,
          x: 300,
          y: 400,
          visible: true,
          zIndex: 10,
        },
        {
          ...templateLayer,
          id: actorBId,
          name: 'Actor B',
          x: 1_450,
          y: 360,
          depth: -200,
          visible: true,
          zIndex: 11,
        },
        {
          ...templateLayer,
          id: hudId,
          name: 'HUD Badge',
          cameraSpace: 'screen',
          x: 120,
          y: 80,
          visible: true,
          zIndex: 20,
        },
      ],
      timelineEvents: [],
    }],
  });
  return { project, shotId: shot.id, actorAId, actorBId, hudId };
}

describe('EXT-03 editable camera motion presets generating ordinary ShotCameraKeys', () => {
  it('generates push-in, pull-out, pan-horizontal, pan-vertical, a-to-b, and return-to-full-stage keys on author-frame grid while preserving rotation', () => {
    const { project: base, shotId, actorAId, actorBId } = createBaseShotProject();
    let project = setShotCameraMode(base, shotId, 'manual');
    // Start with a non-default rotated framing at 0ms.
    project = setShotCameraKey(project, shotId, 0, {
      centerX: 800,
      centerY: 500,
      zoom: 1.2,
      rotationDeg: 35,
    });

    // 1. Push-in from rotated framing on a free range [500, 1500].
    const pushed = applyCameraMotionPreset(project, shotId, {
      preset: 'push-in',
      startTimeMs: 503, // snaps to author frame grid
      durationMs: 1_000,
      amplitude: 1.5,
      easing: 'ease-out',
    });
    const pushedKeys = pushed.shots[0]!.camera!.keys;
    expect(pushedKeys).toHaveLength(3);
    for (const key of pushedKeys) expect(isValidFrameTime(key.timeMs)).toBe(true);
    expect(pushedKeys[1]!.zoom).toBeCloseTo(1.2, 6);
    expect(pushedKeys[2]!.zoom).toBeCloseTo(1.8, 6);
    expect(pushedKeys[1]!.rotationDeg).toBe(35);
    expect(pushedKeys[2]!.rotationDeg).toBe(35);
    expect(pushedKeys[1]!.interpolationToNext).toBe('ease-out');
    // End pose holds naturally to shot end.
    const heldEnd = evaluateManualCamera(pushed.shots[0]!, 3_500);
    expect(heldEnd.zoom).toBeCloseTo(1.8, 6);
    expect(heldEnd.rotationDeg).toBe(35);

    // 2. Pull-out from pushed pose.
    const pulled = applyCameraMotionPreset(pushed, shotId, {
      preset: 'pull-out',
      startTimeMs: 2_000,
      durationMs: 500,
      amplitude: 1.5,
    });
    const pulledEnd = pulled.shots[0]!.camera!.keys.at(-1)!;
    expect(pulledEnd.zoom).toBeCloseTo(1.2, 6);
    expect(pulledEnd.rotationDeg).toBe(35);

    // 3. Pan horizontal & pan vertical (including negative amplitude).
    const pannedH = applyCameraMotionPreset(project, shotId, {
      preset: 'pan-horizontal',
      startTimeMs: 500,
      durationMs: 500,
      amplitude: -300,
    });
    expect(pannedH.shots[0]!.camera!.keys.at(-1)).toMatchObject({
      centerX: 500,
      centerY: 500,
      zoom: 1.2,
      rotationDeg: 35,
    });

    const pannedV = applyCameraMotionPreset(project, shotId, {
      preset: 'pan-vertical',
      startTimeMs: 500,
      durationMs: 500,
      amplitude: 160,
    });
    expect(pannedV.shots[0]!.camera!.keys.at(-1)).toMatchObject({
      centerX: 800,
      centerY: 660,
      zoom: 1.2,
      rotationDeg: 35,
    });

    // 4. A -> B framing sampling parented+depth Actor A at start and negative-depth Actor B at end.
    const aToB = applyCameraMotionPreset(setShotCameraMode(base, shotId, 'manual'), shotId, {
      preset: 'a-to-b',
      startTimeMs: 250,
      durationMs: 1_000,
      startTargetLayerId: actorAId,
      targetLayerId: actorBId,
      targetZoom: 1.6,
      startPose: { zoom: 1.4, rotationDeg: 350 },
      endPose: { rotationDeg: 370 }, // continuous unwrapped rotation
    });
    const abShot = aToB.shots[0]!;
    const abKeys = abShot.camera!.keys;
    expect(abKeys).toHaveLength(2);
    expect(abKeys[0]!.rotationDeg).toBe(350);
    expect(abKeys[1]!.rotationDeg).toBe(370);
    // Verify Actor B projects directly to stage center (960, 540) at endTimeMs!
    const evalEnd = evaluateShotAtTime(abShot, abKeys[1]!.timeMs, aToB, { includeShake: false })
      .layers.find((layer) => layer.id === actorBId)!;
    const projB = cameraLayerTransform(abKeys[1]!, aToB.width, aToB.height, evalEnd.effectiveDepth ?? 0, 'world')!;
    expect(projB.offsetX).toBeCloseTo(evalEnd.x, 4);
    expect(projB.offsetY).toBeCloseTo(evalEnd.y, 4);

    // 5. Return to full stage preserves rotation when unspecified.
    const returned = applyCameraMotionPreset(pushed, shotId, {
      preset: 'return-to-full-stage',
      startTimeMs: 2_000,
      durationMs: 500,
    });
    expect(returned.shots[0]!.camera!.keys.at(-1)).toMatchObject({
      centerX: 960,
      centerY: 540,
      zoom: 1,
      rotationDeg: 35,
    });

    // Generated keys are ordinary ShotCameraKeys editable by existing camera key operations.
    const moved = moveShotCameraKey(pushed, shotId, pushedKeys[2]!.timeMs, 1_750);
    expect(moved.shots[0]!.camera!.keys[2]!.timeMs).toBe(1_750);
  });

  it('rejects invalid zoom, screen-space target layers, and never silently switches pure auto/static shots to manual', () => {
    const { project: base, shotId, hudId } = createBaseShotProject();

    // Unset camera (default) and explicit auto/static must NOT be silently switched to manual.
    expect(() => applyCameraMotionPreset(base, shotId, {
      preset: 'push-in',
      startTimeMs: 0,
      durationMs: 1_000,
    })).toThrow();
    const autoProject = setShotCameraMode(base, shotId, 'speaker-focus');
    expect(() => applyCameraMotionPreset(autoProject, shotId, {
      preset: 'push-in',
      startTimeMs: 0,
      durationMs: 1_000,
    })).toThrow();
    expect(autoProject.shots[0]!.camera?.mode).toBe('speaker-focus');

    const staticProject = setShotCameraMode(base, shotId, 'static');
    expect(() => applyCameraMotionPreset(staticProject, shotId, {
      preset: 'push-in',
      startTimeMs: 0,
      durationMs: 1_000,
    })).toThrow();

    // Screen-space HUD target and non-positive zoom rejected.
    const manualProject = setShotCameraMode(base, shotId, 'manual');
    expect(() => applyCameraMotionPreset(manualProject, shotId, {
      preset: 'a-to-b',
      startTimeMs: 0,
      durationMs: 1_000,
      targetLayerId: hudId,
    })).toThrow();
    expect(() => applyCameraMotionPreset(manualProject, shotId, {
      preset: 'push-in',
      startTimeMs: 0,
      durationMs: 1_000,
      targetZoom: 0,
    })).toThrow();
  });

  it('checks conflicts, suggests free ranges, requires explicit overwrite, preserves adjacent curves, and supports explicit return key', () => {
    const { project: base, shotId } = createBaseShotProject();
    let project = setShotCameraMode(base, shotId, 'manual');
    const origCurve = { bezier: { x1: 0.2, y1: 0, x2: 0.8, y2: 1 } };
    project = setShotCameraKey(project, shotId, 0, { zoom: 1, curveToNext: origCurve });
    project = setShotCameraKey(project, shotId, 3_000, { zoom: 2 });

    // Free interior range [1000, 2000] succeeds without overwrite and preserves [0, 1000] and [2000, 3000] curves!
    const interior = applyCameraMotionPreset(project, shotId, {
      preset: 'push-in',
      startTimeMs: 1_000,
      durationMs: 1_000,
      amplitude: 1.5,
      easing: 'ease-in-out',
    });
    const interiorKeys = interior.shots[0]!.camera!.keys;
    expect(interiorKeys.map((k) => k.timeMs)).toEqual([0, 1_000, 2_000, 3_000]);
    expect(interiorKeys[0]!.curveToNext?.window?.[0]).toBeCloseTo(0, 6);
    expect(interiorKeys[0]!.curveToNext?.window?.[1]).toBeCloseTo(1 / 3, 6);
    expect(interiorKeys[2]!.curveToNext?.window?.[0]).toBeCloseTo(2 / 3, 6);
    expect(interiorKeys[2]!.curveToNext?.window?.[1]).toBeCloseTo(1, 6);

    // Conflict at [1000, 2000] blocks without overwriteExisting and suggests a free start.
    const conflictPlan = planCameraMotionPreset(interior, shotId, {
      preset: 'pan-horizontal',
      startTimeMs: 1_000,
      durationMs: 500,
      amplitude: 200,
    });
    expect(conflictPlan.conflictingKeyTimes).toEqual([1_000]);
    expect(conflictPlan.suggestedFreeStartMs).not.toBeNull();
    expect(findFreeCameraPresetStartMs(interior.shots[0]!, 500, 1_000)).toBe(conflictPlan.suggestedFreeStartMs);
    expect(() => applyCameraMotionPreset(interior, shotId, {
      preset: 'pan-horizontal',
      startTimeMs: 1_000,
      durationMs: 500,
      amplitude: 200,
    })).toThrow();

    // Explicit overwrite succeeds and replaces keys in [1000, 2000].
    const overwritten = applyCameraMotionPreset(interior, shotId, {
      preset: 'pan-horizontal',
      startTimeMs: 1_000,
      durationMs: 1_000,
      amplitude: 200,
      overwriteExisting: true,
    });
    expect(overwritten.shots[0]!.camera!.keys.map((k) => k.timeMs)).toEqual([0, 1_000, 2_000, 3_000]);
    expect(overwritten.shots[0]!.camera!.keys[2]!.centerX).toBeCloseTo(960 + 200, 4);

    // Explicit returnToStart adds a third key restoring startPose.
    const withReturn = applyCameraMotionPreset(setShotCameraMode(base, shotId, 'manual'), shotId, {
      preset: 'push-in',
      startTimeMs: 500,
      durationMs: 500,
      amplitude: 1.5,
      returnToStart: true,
      returnDurationMs: 500,
    });
    const returnKeys = withReturn.shots[0]!.camera!.keys;
    expect(returnKeys.map((k) => k.timeMs)).toEqual([500, 1_000, 1_500]);
    expect(returnKeys[0]!.zoom).toBeCloseTo(1, 6);
    expect(returnKeys[1]!.zoom).toBeCloseTo(1.5, 6);
    expect(returnKeys[2]!.zoom).toBeCloseTo(1, 6);
  });

  it('reuses selected override or explicitly creates override in Hybrid mode in a single Undo/Redo transaction with save/reopen & export parity', () => {
    const { project: base, shotId } = createBaseShotProject();
    const shotService = new ShotService();
    let project = setShotCameraMode(base, shotId, 'hybrid');

    // Without an override, reuse fails cleanly.
    expect(() => shotService.applyCameraMotionPreset(project, shotId, {
      preset: 'push-in',
      startTimeMs: 500,
      durationMs: 1_000,
      hybridAction: 'use-selected-override',
    })).toThrow();

    // Explicit create-override generates keys + override in ONE Undoable transaction.
    const store = new EditorProjectStore();
    store.open('D:/ext03-hybrid.pandastage', project);
    const createdOverrideId = randomUUID();
    const created = shotService.applyCameraMotionPreset(store.getSnapshot()!.project, shotId, {
      preset: 'push-in',
      startTimeMs: 500,
      durationMs: 1_000,
      amplitude: 1.5,
      hybridAction: 'create-override',
      overrideId: createdOverrideId,
    });
    store.updateProject(created, '应用运镜预设：推近');

    const afterCreate = store.getSnapshot()!.project.shots[0]!;
    expect(afterCreate.camera?.mode).toBe('hybrid');
    expect(afterCreate.camera?.overrides).toHaveLength(1);
    expect(afterCreate.camera?.overrides?.[0]).toMatchObject({
      id: createdOverrideId,
      startMs: 500,
      endMs: 1_500,
    });
    expect(afterCreate.camera?.keys.map((k) => k.timeMs)).toEqual([500, 1_500]);

    // Single Undo restores empty hybrid shot; single Redo restores both keys and override.
    expect(store.undo()).toBe(true);
    expect(store.getSnapshot()!.project.shots[0]!.camera?.overrides ?? []).toHaveLength(0);
    expect(store.getSnapshot()!.project.shots[0]!.camera?.keys).toHaveLength(0);
    expect(store.redo()).toBe(true);
    expect(store.getSnapshot()!.project.shots[0]!.camera?.overrides).toHaveLength(1);
    expect(store.getSnapshot()!.project.shots[0]!.camera?.keys).toHaveLength(2);

    // Reusing an existing selected override does NOT create a second override.
    const existingOverrideId = randomUUID();
    project = addShotCameraOverride(project, shotId, {
      id: existingOverrideId,
      startMs: 1_000,
      endMs: 3_000,
    });
    const reused = shotService.applyCameraMotionPreset(project, shotId, {
      preset: 'pan-horizontal',
      startTimeMs: 1_500,
      durationMs: 1_000,
      amplitude: 180,
      hybridAction: 'use-selected-override',
      selectedOverrideId: existingOverrideId,
    });
    expect(reused.shots[0]!.camera?.overrides).toHaveLength(1);
    expect(reused.shots[0]!.camera?.mode).toBe('hybrid');

    // Save/reopen & preview/export parity.
    const reopened = migrateProject(JSON.parse(JSON.stringify(reused)));
    const camPlan = prepareShotCamera(reopened, reopened.shots[0]!, 'static');
    expect(camPlan(2_000)).toEqual(prepareShotCamera(reused, reused.shots[0]!, 'static')(2_000));
    expect(evaluateExportShotAtTime(reopened, reopened.shots[0]!, 2_000).layers.length).toBe(
      evaluateExportShotAtTime(reused, reused.shots[0]!, 2_000).layers.length,
    );
  });
});
