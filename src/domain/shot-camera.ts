import { evaluateAnimationEase, sliceAnimationCurve } from './evaluate-animation-core';
import { PROJECT_HEIGHT, PROJECT_WIDTH } from './constants';
import { ProjectSchema, type Project, type Shot } from './models';
import type { ManualCameraPose, ShotCameraKey, ShotCameraMode } from './models/shotCamera';
import {
  evaluateSpeakerFocusCamera,
  fullStageCamera,
  prepareSpeakerFocusCamera,
  type CameraView,
} from './resolve-speaker-focus-camera';
import { resolveTimelineFrameTime } from './timeline/frame-grid';

export function evaluateManualCamera(shot: Shot, requestedTimeMs: number): ManualCameraPose {
  const keys = shot.camera?.keys ?? [];
  if (!keys.length) return { ...fullStageCamera(PROJECT_WIDTH, PROJECT_HEIGHT), rotationDeg: 0 };
  const timeMs = Number.isFinite(requestedTimeMs) ? requestedTimeMs : 0;
  const right = keys.findIndex((key) => key.timeMs >= timeMs);
  const from = keys[right < 0 ? keys.length - 1 : Math.max(0, right - 1)]!;
  const to = keys[right] ?? from;
  if (from === to || timeMs === to.timeMs) {
    return { centerX: to.centerX, centerY: to.centerY, zoom: to.zoom, rotationDeg: to.rotationDeg };
  }
  const progress = evaluateAnimationEase(
    (timeMs - from.timeMs) / (to.timeMs - from.timeMs),
    from.interpolationToNext,
    from.curveToNext,
  );
  const lerp = (a: number, b: number) => (1 - progress) * a + progress * b;
  return {
    centerX: lerp(from.centerX, to.centerX),
    centerY: lerp(from.centerY, to.centerY),
    zoom: lerp(from.zoom, to.zoom),
    // Degrees are continuous, as on Layer tracks: 350 → 370 crosses the seam,
    // and 0 → 720 makes two full turns.
    rotationDeg: lerp(from.rotationDeg, to.rotationDeg),
  };
}

export function prepareShotCamera(project: Project, shot: Shot, legacyMode: 'static' | 'speaker-focus') {
  const mode = shot.camera?.mode ?? legacyMode;
  const speakerFocus = mode === 'speaker-focus' ? prepareSpeakerFocusCamera(project, shot) : null;
  return (timeMs: number): CameraView | undefined => {
    if (mode === 'manual') return evaluateManualCamera(shot, timeMs);
    return speakerFocus ? evaluateSpeakerFocusCamera(speakerFocus, timeMs) : undefined;
  };
}

export function cameraWorldTransform(camera: CameraView | undefined, width: number, height: number) {
  return {
    x: width / 2,
    y: height / 2,
    offsetX: camera?.centerX ?? width / 2,
    offsetY: camera?.centerY ?? height / 2,
    scaleX: camera?.zoom ?? 1,
    scaleY: camera?.zoom ?? 1,
    rotation: -(camera?.rotationDeg ?? 0) % 360,
  };
}

function editCamera(project: Project, shotId: string, edit: (shot: Shot) => Shot['camera']): Project {
  const shot = project.shots.find((entry) => entry.id === shotId);
  if (!shot) throw new Error('找不到当前镜头。');
  return ProjectSchema.parse({
    ...project,
    shots: project.shots.map((entry) => entry === shot ? { ...shot, camera: edit(shot) } : entry),
  });
}

export function setShotCameraMode(project: Project, shotId: string, mode: ShotCameraMode): Project {
  return editCamera(project, shotId, (shot) => ({ mode, keys: shot.camera?.keys ?? [] }));
}

export function setShotCameraKey(
  project: Project,
  shotId: string,
  requestedTimeMs: number,
  changes: Partial<Omit<ShotCameraKey, 'timeMs'>> = {},
): Project {
  return editCamera(project, shotId, (shot) => {
    const timeMs = resolveTimelineFrameTime(requestedTimeMs, shot.durationMs);
    const keys = [...(shot.camera?.keys ?? [])];
    const next = keys.findIndex((key) => key.timeMs >= timeMs);
    if (keys[next]?.timeMs === timeMs) {
      keys[next] = { ...keys[next]!, ...changes };
    } else {
      const key: ShotCameraKey = {
        ...evaluateManualCamera(shot, timeMs), timeMs, interpolationToNext: 'linear',
      };
      const previous = keys[next - 1];
      if (previous && keys[next]) {
        const split = (timeMs - previous.timeMs) / (keys[next]!.timeMs - previous.timeMs);
        key.interpolationToNext = previous.interpolationToNext;
        key.curveToNext = sliceAnimationCurve(previous.curveToNext, split, 1);
        keys[next - 1] = { ...previous, curveToNext: sliceAnimationCurve(previous.curveToNext, 0, split) };
      }
      keys.splice(next < 0 ? keys.length : next, 0, { ...key, ...changes });
    }
    return { mode: 'manual', keys };
  });
}

export function removeShotCameraKey(project: Project, shotId: string, requestedTimeMs: number): Project {
  return editCamera(project, shotId, (shot) => shot.camera && {
    ...shot.camera,
    keys: shot.camera.keys.filter((key) => key.timeMs !== resolveTimelineFrameTime(requestedTimeMs, shot.durationMs)),
  });
}

/** Retime adjacent segments in place, keeping their normalized easing shapes. */
export function moveShotCameraKey(project: Project, shotId: string, timeMs: number, requestedTimeMs: number): Project {
  const shot = project.shots.find(({ id }) => id === shotId);
  const camera = shot?.camera;
  const index = camera?.keys.findIndex((key) => key.timeMs === timeMs) ?? -1;
  if (!shot || camera?.mode !== 'manual' || index < 0) return project;
  const nextTime = resolveTimelineFrameTime(requestedTimeMs, shot.durationMs);
  const previous = camera.keys[index - 1];
  const next = camera.keys[index + 1];
  if (nextTime === timeMs || (previous && nextTime <= previous.timeMs) || (next && nextTime >= next.timeMs)) {
    return project;
  }
  return editCamera(project, shotId, () => ({
    ...camera, keys: camera.keys.map((key, i) => i === index ? { ...key, timeMs: nextTime } : key),
  }));
}
