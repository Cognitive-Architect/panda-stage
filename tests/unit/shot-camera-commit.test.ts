import { beforeEach, describe, expect, it } from 'vitest';
import {
  editorProjectStore,
} from '../../src/renderer/stores/EditorProjectStore';
import { shotStore } from '../../src/renderer/stores/shotStore';
import {
  applyShotCameraPreset,
  deleteShotCameraKeyframe,
  readLiveShotCameraTarget,
  recordShotCameraKeyframe,
  setShotCameraMode,
} from '../../src/renderer/features/camera/shotCameraActions';
import { buildProject, IDS } from './domain/testProject';

const PROJECT_ROOT = 'D:/camera-commit-fixture.pandastage';

function liveTarget() {
  const target = readLiveShotCameraTarget();
  if (!target) throw new Error('Camera fixture is not open.');
  return target;
}

function currentCamera() {
  return liveTarget().shot.camera;
}

describe('AUTO-07B camera editing commits one history step per action', () => {
  beforeEach(() => {
    editorProjectStore.open(PROJECT_ROOT, buildProject());
    shotStore.select(IDS.shot);
  });

  it('records a framing as exactly one Undo/Redo pair', () => {
    const revision = editorProjectStore.getSnapshot()!.revision;
    recordShotCameraKeyframe(
      liveTarget(),
      { centerX: 900, centerY: 520, zoom: 1.4 },
      1_200,
    );

    const afterRecord = editorProjectStore.getSnapshot()!;
    expect(afterRecord.revision).toBe(revision + 1);
    expect(afterRecord.dirty).toBe(true);
    expect(currentCamera()).toEqual({
      mode: 'manual',
      keyframes: [{ timeMs: 1_200, centerX: 900, centerY: 520, zoom: 1.4 }],
    });

    expect(editorProjectStore.undo()).toBe(true);
    expect(editorProjectStore.getSnapshot()!.project.shots[0]!.camera).toEqual({
      mode: 'static',
      keyframes: [],
    });
    expect(editorProjectStore.redo()).toBe(true);
    expect(currentCamera()).toEqual({
      mode: 'manual',
      keyframes: [{ timeMs: 1_200, centerX: 900, centerY: 520, zoom: 1.4 }],
    });
  });

  it('replaces the keyframe at the same time instead of stacking duplicates', () => {
    recordShotCameraKeyframe(liveTarget(), { centerX: 900, centerY: 520, zoom: 1.4 }, 800);
    recordShotCameraKeyframe(liveTarget(), { centerX: 950, centerY: 560, zoom: 1.8 }, 800);
    expect(currentCamera().keyframes).toEqual([
      { timeMs: 800, centerX: 950, centerY: 560, zoom: 1.8 },
    ]);
  });

  it('keeps keyframes when switching modes and deletes one at a time', () => {
    recordShotCameraKeyframe(liveTarget(), { centerX: 900, centerY: 520, zoom: 1.4 }, 800);
    setShotCameraMode(liveTarget(), 'static');
    expect(currentCamera()).toEqual({
      mode: 'static',
      keyframes: [{ timeMs: 800, centerX: 900, centerY: 520, zoom: 1.4 }],
    });

    setShotCameraMode(liveTarget(), 'manual');
    expect(currentCamera().mode).toBe('manual');
    deleteShotCameraKeyframe(liveTarget(), 800);
    expect(currentCamera().keyframes).toEqual([]);
  });

  it('seeds a preset as editable manual keyframes', () => {
    applyShotCameraPreset(liveTarget(), 'push-in');
    const camera = currentCamera();
    expect(camera.mode).toBe('manual');
    expect(camera.keyframes).toHaveLength(2);
    expect(camera.keyframes[0]!.zoom).toBe(1);
    expect(camera.keyframes[1]!.zoom).toBeGreaterThan(1);
    expect(camera.keyframes[1]!.timeMs).toBe(liveTarget().shot.durationMs);
  });

  it('leaves layers, dialogues and clips untouched', () => {
    const before = editorProjectStore.getSnapshot()!.project.shots[0]!;
    recordShotCameraKeyframe(liveTarget(), { centerX: 900, centerY: 520, zoom: 2 }, 500);
    const after = editorProjectStore.getSnapshot()!.project.shots[0]!;
    expect(after.layers).toEqual(before.layers);
    expect(after.dialogues).toEqual(before.dialogues);
    expect(after.audioClips).toEqual(before.audioClips);
    expect(after.timelineEvents).toEqual(before.timelineEvents);
  });
});
