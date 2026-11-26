import type { EvaluatedLayer } from './evaluate-shot-at-time';
import { evaluateAnimationEase, sliceAnimationCurve } from './evaluate-animation-core';
import { PROJECT_HEIGHT, PROJECT_WIDTH } from './constants';
import { ProjectSchema, type Project, type Shot } from './models';
import type { AnimationCurve, AnimationInterpolation } from './models/animationCore';
import type { ManualCameraPose, ShotCameraKey, ShotCameraMode, ShotCameraOverride } from './models/shotCamera';
import {
  cameraLayerTransform,
  cameraWorldTransform,
  solveCameraCenterForWorldPoint,
  type CameraView,
} from './camera-projection';
import {
  evaluateSpeakerFocusCamera,
  fullStageCamera,
  prepareSpeakerFocusCamera,
} from './resolve-speaker-focus-camera';
import { resolveTimelineFrameTime } from './timeline/frame-grid';

export { cameraLayerTransform, cameraWorldTransform, solveCameraCenterForWorldPoint };

export const DEFAULT_CAMERA_OVERRIDE_BLEND_MS = 250;

export interface AddShotCameraOverrideInput {
  id?: string;
  startMs: number;
  endMs: number;
  blendInMs?: number;
  blendOutMs?: number;
  easingIn?: AnimationInterpolation;
  easingOut?: AnimationInterpolation;
  curveIn?: AnimationCurve;
  curveOut?: AnimationCurve;
}

export type UpdateShotCameraOverrideInput = Partial<Omit<ShotCameraOverride, 'id'>>;

function shortestAngleDeltaDeg(fromDeg: number, toDeg: number): number {
  return ((((toDeg - fromDeg) % 360) + 540) % 360) - 180;
}

/**
 * Compute the active manual override weight in [0, 1] for half-open intervals [startMs, endMs).
 * When blendInMs + blendOutMs exceeds the interval length, both are compressed proportionally.
 */
export function evaluateShotCameraOverrideWeight(
  overrides: readonly ShotCameraOverride[] | undefined,
  requestedTimeMs: number,
): number {
  return evaluateOverrideBlend(overrides, requestedTimeMs)?.weight ?? 0;
}

function evaluateOverrideBlend(overrides: readonly ShotCameraOverride[] | undefined, requestedTimeMs: number) {
  const timeMs = Number.isFinite(requestedTimeMs) ? requestedTimeMs : 0;
  const active = overrides?.find((override) => timeMs >= override.startMs && timeMs < override.endMs);
  if (!active) return undefined;

  const length = active.endMs - active.startMs;

  const rawIn = Math.max(0, active.blendInMs);
  const rawOut = Math.max(0, active.blendOutMs);
  const totalBlend = rawIn + rawOut;
  const scale = totalBlend > length ? length / totalBlend : 1;
  const blendInMs = rawIn * scale;
  const blendOutMs = rawOut * scale;

  const weightIn = blendInMs <= 0
    ? 1
    : evaluateAnimationEase(
        Math.max(0, Math.min(1, (timeMs - active.startMs) / blendInMs)),
        active.easingIn ?? 'ease-in-out',
        active.curveIn,
      );
  const weightOut = blendOutMs <= 0
    ? 1
    : 1 - evaluateAnimationEase(
        Math.max(0, Math.min(1, (timeMs - (active.endMs - blendOutMs)) / blendOutMs)),
        active.easingOut ?? 'ease-in-out',
        active.curveOut,
      );

  return {
    weight: Math.max(0, Math.min(1, Math.min(weightIn, weightOut))),
    anchorTimeMs: timeMs < active.startMs + blendInMs ? active.startMs : active.endMs,
  };
}

function blendCameraViews(
  autoView: CameraView,
  manualPose: ManualCameraPose,
  weight: number,
  anchorAutoRotation: number,
  anchorManualRotation: number,
): CameraView {
  const autoRotation = autoView.rotationDeg ?? 0;
  // Pick the nearest branch at the automatic end of each transition, then
  // follow the authored unwrapped angles. The two branches agree visually at weight 1.
  const rotationDelta = shortestAngleDeltaDeg(anchorAutoRotation, anchorManualRotation)
    + (manualPose.rotationDeg - anchorManualRotation) - (autoRotation - anchorAutoRotation);
  return {
    centerX: autoView.centerX + (manualPose.centerX - autoView.centerX) * weight,
    centerY: autoView.centerY + (manualPose.centerY - autoView.centerY) * weight,
    zoom: Math.max(1e-4, autoView.zoom + (manualPose.zoom - autoView.zoom) * weight),
    rotationDeg: autoRotation + rotationDelta * weight,
  };
}

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
  const speakerFocus = mode === 'speaker-focus' || mode === 'hybrid'
    ? prepareSpeakerFocusCamera(project, shot)
    : null;
  const overrides = mode === 'hybrid' ? (shot.camera?.overrides ?? []) : [];
  const evaluateAutoView = (timeMs: number) => speakerFocus
    ? evaluateSpeakerFocusCamera(speakerFocus, timeMs)
    : fullStageCamera(project.width, project.height);
  return (timeMs: number): CameraView | undefined => {
    if (mode === 'manual') return evaluateManualCamera(shot, timeMs);
    if (mode === 'hybrid') {
      const autoView = evaluateAutoView(timeMs);
      const blend = evaluateOverrideBlend(overrides, timeMs);
      if (!blend || blend.weight <= 0) return autoView;
      const manualPose = evaluateManualCamera(shot, timeMs);
      if (blend.weight >= 1) return manualPose;
      return blendCameraViews(
        autoView,
        manualPose,
        blend.weight,
        evaluateAutoView(blend.anchorTimeMs).rotationDeg ?? 0,
        evaluateManualCamera(shot, blend.anchorTimeMs).rotationDeg,
      );
    }
    return speakerFocus ? evaluateSpeakerFocusCamera(speakerFocus, timeMs) : undefined;
  };
}

type CameraDrawingLayer = Pick<EvaluatedLayer, 'effectiveCameraSpace' | 'effectiveDepth' | 'zIndex'>;

export function compareCameraDrawingLayers(a: CameraDrawingLayer, b: CameraDrawingLayer): number {
  const aScreen = a.effectiveCameraSpace === 'screen';
  const bScreen = b.effectiveCameraSpace === 'screen';
  if (aScreen !== bScreen) return aScreen ? 1 : -1;
  return (aScreen ? 0 : (b.effectiveDepth ?? 0) - (a.effectiveDepth ?? 0)) || a.zIndex - b.zIndex;
}

export function resolveLayerCameraTransform(
  layer: CameraDrawingLayer,
  camera: CameraView | undefined,
  width: number,
  height: number,
): ReturnType<typeof cameraLayerTransform> {
  return cameraLayerTransform(camera, width, height, layer.effectiveDepth ?? 0, layer.effectiveCameraSpace ?? 'world');
}

function editCamera(project: Project, shotId: string, edit: (shot: Shot) => Shot['camera']): Project {
  const shot = project.shots.find((entry) => entry.id === shotId);
  if (!shot) throw new Error('找不到当前镜头。');
  return ProjectSchema.parse({
    ...project,
    shots: project.shots.map((entry) => entry === shot ? { ...shot, camera: edit(shot) } : entry),
  });
}

function preserveOverrides(camera: Shot['camera']): { overrides?: ShotCameraOverride[] } {
  return camera?.overrides?.length ? { overrides: camera.overrides } : {};
}

function assertValidOverrideRange(
  startMs: number,
  endMs: number,
  durationMs: number,
  existing: readonly ShotCameraOverride[],
  ignoreId?: string,
): void {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    throw new Error('接管区间时间必须是有效数值。');
  }
  if (startMs < 0 || endMs > durationMs) {
    throw new Error('接管区间超出镜头时长范围。');
  }
  if (endMs <= startMs) {
    throw new Error('接管区间结束时间必须大于开始时间。');
  }
  for (const other of existing) {
    if (other.id === ignoreId) continue;
    if (startMs < other.endMs && other.startMs < endMs) {
      throw new Error('接管区间不能与已有区间重叠。');
    }
  }
}

function insertManualKeyIfMissing(keys: ShotCameraKey[], timeMs: number, pose: ManualCameraPose): void {
  const next = keys.findIndex((key) => key.timeMs >= timeMs);
  if (keys[next]?.timeMs === timeMs) return;
  const key: ShotCameraKey = {
    ...pose,
    timeMs,
    interpolationToNext: 'linear',
  };
  const previous = keys[next - 1];
  if (previous && keys[next]) {
    const split = (timeMs - previous.timeMs) / (keys[next]!.timeMs - previous.timeMs);
    key.interpolationToNext = previous.interpolationToNext;
    key.curveToNext = sliceAnimationCurve(previous.curveToNext, split, 1);
    keys[next - 1] = { ...previous, curveToNext: sliceAnimationCurve(previous.curveToNext, 0, split) };
  }
  keys.splice(next < 0 ? keys.length : next, 0, key);
}

function toManualPose(view: CameraView | undefined, width: number, height: number): ManualCameraPose {
  const resolved = view ?? fullStageCamera(width, height);
  return {
    centerX: resolved.centerX,
    centerY: resolved.centerY,
    zoom: resolved.zoom,
    rotationDeg: resolved.rotationDeg ?? 0,
  };
}

export function setShotCameraMode(project: Project, shotId: string, mode: ShotCameraMode): Project {
  return editCamera(project, shotId, (shot) => ({
    mode,
    keys: shot.camera?.keys ?? [],
    ...preserveOverrides(shot.camera),
  }));
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
    return {
      mode: shot.camera?.mode === 'hybrid' ? 'hybrid' : 'manual',
      keys,
      ...preserveOverrides(shot.camera),
    };
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
  if (!shot || (camera?.mode !== 'manual' && camera?.mode !== 'hybrid') || index < 0) return project;
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

export function addShotCameraOverride(
  project: Project,
  shotId: string,
  input: AddShotCameraOverrideInput,
): Project {
  return editCamera(project, shotId, (shot) => {
    if (!Number.isFinite(input.startMs) || !Number.isFinite(input.endMs)) {
      throw new Error('接管区间时间必须是有效数值。');
    }
    if (input.startMs < 0 || input.endMs > shot.durationMs) {
      throw new Error('接管区间超出镜头时长范围。');
    }
    const startMs = resolveTimelineFrameTime(input.startMs, shot.durationMs);
    const endMs = Math.round(input.endMs);
    const existing = shot.camera?.overrides ?? [];
    assertValidOverrideRange(startMs, endMs, shot.durationMs, existing);

    const id = input.id ?? crypto.randomUUID();
    if (existing.some((override) => override.id === id)) {
      throw new Error('接管区间标识重复。');
    }

    const sampledCamera = prepareShotCamera(project, shot, 'speaker-focus');
    const keys = [...(shot.camera?.keys ?? [])];
    const startPose = toManualPose(sampledCamera(startMs), project.width, project.height);
    const endKeyTime = resolveTimelineFrameTime(endMs, shot.durationMs);
    const endPose = toManualPose(sampledCamera(endKeyTime), project.width, project.height);
    insertManualKeyIfMissing(keys, startMs, startPose);
    if (endKeyTime !== startMs) {
      insertManualKeyIfMissing(keys, endKeyTime, endPose);
    }

    const override: ShotCameraOverride = {
      id,
      startMs,
      endMs,
      blendInMs: Math.round(input.blendInMs ?? DEFAULT_CAMERA_OVERRIDE_BLEND_MS),
      blendOutMs: Math.round(input.blendOutMs ?? DEFAULT_CAMERA_OVERRIDE_BLEND_MS),
      ...(input.easingIn !== undefined ? { easingIn: input.easingIn } : {}),
      ...(input.easingOut !== undefined ? { easingOut: input.easingOut } : {}),
      ...(input.curveIn !== undefined ? { curveIn: input.curveIn } : {}),
      ...(input.curveOut !== undefined ? { curveOut: input.curveOut } : {}),
    };
    const overrides = [...existing, override].sort((a, b) => a.startMs - b.startMs);
    return {
      mode: 'hybrid',
      keys,
      overrides,
    };
  });
}

export function updateShotCameraOverride(
  project: Project,
  shotId: string,
  overrideId: string,
  changes: UpdateShotCameraOverrideInput,
): Project {
  return editCamera(project, shotId, (shot) => {
    const existing = shot.camera?.overrides ?? [];
    const current = existing.find((override) => override.id === overrideId);
    if (!current) throw new Error('找不到指定的相机接管区间。');

    const rawStart = changes.startMs !== undefined ? changes.startMs : current.startMs;
    const rawEnd = changes.endMs !== undefined ? changes.endMs : current.endMs;
    if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) {
      throw new Error('接管区间时间必须是有效数值。');
    }
    if (rawStart < 0 || rawEnd > shot.durationMs) {
      throw new Error('接管区间超出镜头时长范围。');
    }
    const startMs = changes.startMs !== undefined
      ? resolveTimelineFrameTime(rawStart, shot.durationMs)
      : current.startMs;
    const endMs = Math.round(rawEnd);
    assertValidOverrideRange(startMs, endMs, shot.durationMs, existing, overrideId);

    const updated: ShotCameraOverride = {
      ...current,
      ...changes,
      id: current.id,
      startMs,
      endMs,
      blendInMs: Math.round(changes.blendInMs ?? current.blendInMs),
      blendOutMs: Math.round(changes.blendOutMs ?? current.blendOutMs),
    };
    if (updated.easingIn === undefined) delete updated.easingIn;
    if (updated.easingOut === undefined) delete updated.easingOut;
    if (updated.curveIn === undefined) delete updated.curveIn;
    if (updated.curveOut === undefined) delete updated.curveOut;

    const overrides = existing
      .map((override) => override.id === overrideId ? updated : override)
      .sort((a, b) => a.startMs - b.startMs);

    return {
      mode: shot.camera?.mode ?? 'hybrid',
      keys: shot.camera?.keys ?? [],
      overrides,
    };
  });
}

export function moveShotCameraOverride(
  project: Project,
  shotId: string,
  overrideId: string,
  requestedStartMs: number,
): Project {
  const shot = project.shots.find(({ id }) => id === shotId);
  if (!shot) throw new Error('找不到当前镜头。');
  const current = shot.camera?.overrides?.find((override) => override.id === overrideId);
  if (!current) throw new Error('找不到指定的相机接管区间。');
  if (!Number.isFinite(requestedStartMs) || requestedStartMs < 0) {
    throw new Error('接管区间超出镜头时长范围。');
  }
  const length = current.endMs - current.startMs;
  const startMs = resolveTimelineFrameTime(requestedStartMs, shot.durationMs);
  const endMs = startMs + length;
  if (endMs > shot.durationMs) {
    throw new Error('接管区间超出镜头时长范围。');
  }
  return updateShotCameraOverride(project, shotId, overrideId, { startMs, endMs });
}

export function removeShotCameraOverride(
  project: Project,
  shotId: string,
  overrideId: string,
): Project {
  return editCamera(project, shotId, (shot) => {
    if (!shot.camera) return shot.camera;
    const overrides = (shot.camera.overrides ?? []).filter((override) => override.id !== overrideId);
    return {
      mode: shot.camera.mode,
      keys: shot.camera.keys,
      ...(overrides.length ? { overrides } : {}),
    };
  });
}
