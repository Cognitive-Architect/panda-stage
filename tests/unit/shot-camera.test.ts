import { describe, expect, it } from 'vitest';
import demo from '../../demo-project/project-v1.example.json';
import {
  cameraWorldTransform, evaluateManualCamera, migrateProject, prepareShotCamera, removeShotCameraKey,
  setShotCameraKey, setShotCameraMode, ShotService,
} from '../../src/domain';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';

describe('Shot camera', () => {
  it('keeps old fallback modes and round-trips a three-key move with actor data intact', () => {
    const original = migrateProject(demo);
    const old = migrateProject({ ...original, schemaVersion: 42 });
    const shot = old.shots[0]!;
    expect(shot.camera).toBeUndefined();
    expect(prepareShotCamera(old, shot, 'static')(0)).toBeUndefined();
    expect(prepareShotCamera(old, shot, 'speaker-focus')(0)).toMatchObject({ zoom: 1 });

    const enabled = setShotCameraMode(old, shot.id, 'manual');
    expect(evaluateManualCamera(enabled.shots[0]!, 80)).toEqual({
      centerX: 960, centerY: 540, zoom: 1, rotationDeg: 0,
    });
    let project = setShotCameraKey(enabled, shot.id, 0, {
      zoom: 0.75, rotationDeg: 350, interpolationToNext: 'ease-in',
    });
    project = setShotCameraKey(project, shot.id, 1_000, {
      centerX: 400, centerY: 450, zoom: 2, rotationDeg: 370,
    });
    project = setShotCameraKey(project, shot.id, 2_000, {
      centerX: 2_100, centerY: 600, zoom: 1.25, rotationDeg: 1090,
    });
    const saved = migrateProject(JSON.parse(JSON.stringify(project)));
    const reopened = saved.shots[0]!;
    const camera = prepareShotCamera(saved, reopened, 'speaker-focus');
    expect(camera(-10)).toEqual({ centerX: 960, centerY: 540, zoom: 0.75, rotationDeg: 350 });
    expect(camera(500)).toEqual({ centerX: 820, centerY: 517.5, zoom: 1.0625, rotationDeg: 355 });
    expect(camera(1_500)).toMatchObject({ centerX: 1250, rotationDeg: 730 });
    expect(camera(3_000)).toEqual(camera(2_000));
    expect(camera(500)).toEqual(evaluateManualCamera(reopened, 500));
    expect(cameraWorldTransform(camera(1_500), 1920, 1080)).toMatchObject({
      x: 960, y: 540, offsetX: 1250, scaleX: 1.625, rotation: -10,
    });
    expect(reopened.layers).toEqual(shot.layers);
    expect(() => setShotCameraKey(project, shot.id, 1_000, { zoom: 0 })).toThrow();
    expect(() => new ShotService().setDuration(project, shot.id, 1_800)).toThrow();
  });

  it('splits a nonlinear segment at the playhead and replays edits with project history', () => {
    const original = migrateProject(demo);
    const id = original.shots[0]!.id;
    const from = setShotCameraKey(original, id, 0, {
      zoom: 1,
      curveToNext: { bezier: { x1: 0.2, y1: 0, x2: 0.7, y2: 1 } },
    });
    const full = setShotCameraKey(from, id, 2_000, { zoom: 3, rotationDeg: 720 });
    const split = setShotCameraKey(full, id, 750);
    for (const time of [0, 250, 749, 750, 751, 1_500, 2_000]) {
      const before = evaluateManualCamera(full.shots[0]!, time);
      const after = evaluateManualCamera(split.shots[0]!, time);
      expect(after.zoom).toBeCloseTo(before.zoom, 7);
      expect(after.rotationDeg).toBeCloseTo(before.rotationDeg, 7);
    }
    const store = new EditorProjectStore();
    store.open('D:/shot-camera.pandastage', full);
    store.updateProject(split, 'Insert camera key');
    expect(store.undo()).toBe(true);
    expect(store.getSnapshot()?.project.shots[0]?.camera).toEqual(full.shots[0]!.camera);
    expect(store.redo()).toBe(true);
    expect(store.getSnapshot()?.project.shots[0]?.camera).toEqual(split.shots[0]!.camera);
    expect(removeShotCameraKey(split, id, 750).shots[0]?.camera?.keys.map(({ timeMs }) => timeMs)).toEqual([0, 2_000]);
  });
});
