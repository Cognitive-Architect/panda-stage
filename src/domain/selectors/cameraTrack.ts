/**
 * AUTO-07B: the single per-Shot camera contract.
 *
 * One persisted model (`Shot.camera`), one evaluator, three modes:
 * `static` (full stage), `speaker-focus` (existing automatic follow) and
 * `manual` (user-recorded keyframes). Editor Canvas, Product Preview and the
 * hidden Export renderer all read this module — no session-only camera state
 * and never "move every Character layer" to fake a camera move.
 */
import {
  SHOT_CAMERA_MODES,
  type Project,
  type Shot,
  type ShotCameraMode,
} from '../models';
import {
  clampCamera,
  evaluateSpeakerFocusCamera,
  fullStageCamera,
  prepareSpeakerFocusCamera,
  type CameraView,
  type SpeakerFocusCameraPlan,
} from '../resolve-speaker-focus-camera';

export { SHOT_CAMERA_MODES };
export type { ShotCameraMode };

export const SHOT_CAMERA_PRESETS = ['push-in', 'pull-out', 'pan'] as const;
export type ShotCameraPreset = (typeof SHOT_CAMERA_PRESETS)[number];

export const SHOT_CAMERA_PRESET_ZOOM = 1.6;
export const SHOT_CAMERA_PRESET_PAN_ZOOM = 1.35;

export interface ShotCameraKeyframe extends CameraView {
  readonly timeMs: number;
}

/** The persisted per-Shot camera, exactly as the Project schema stores it. */
export type ShotCamera = Shot['camera'];

export interface ShotCameraPlan {
  readonly shotId: string;
  readonly mode: ShotCameraMode;
  readonly width: number;
  readonly height: number;
  readonly durationMs: number;
  readonly full: CameraView;
  readonly keyframes: readonly ShotCameraKeyframe[];
  readonly speakerPlan: SpeakerFocusCameraPlan | null;
}

/** Sorts by time, keeps the last value per timestamp, and clamps the view. */
export function normalizeShotCameraKeyframes(
  keyframes: readonly ShotCameraKeyframe[],
  width: number,
  height: number,
  durationMs: number,
): ShotCameraKeyframe[] {
  const byTime = new Map<number, ShotCameraKeyframe>();
  for (const keyframe of keyframes) {
    if (!Number.isFinite(keyframe.timeMs)) continue;
    if (!Number.isFinite(keyframe.centerX) || !Number.isFinite(keyframe.centerY)) {
      continue;
    }
    if (!Number.isFinite(keyframe.zoom)) continue;
    const timeMs = Math.min(
      Math.max(0, Math.round(durationMs)),
      Math.max(0, Math.round(keyframe.timeMs)),
    );
    const view = clampCamera(
      { centerX: keyframe.centerX, centerY: keyframe.centerY, zoom: keyframe.zoom },
      width,
      height,
    );
    byTime.set(timeMs, { timeMs, ...view });
  }
  return [...byTime.values()].sort((left, right) => left.timeMs - right.timeMs);
}

/** Deterministic plan preparation; the only holder of the Speaker schedule. */
export function prepareShotCamera(project: Project, shot: Shot): ShotCameraPlan {
  const mode = shot.camera.mode;
  return {
    shotId: shot.id,
    mode,
    width: project.width,
    height: project.height,
    durationMs: shot.durationMs,
    full: fullStageCamera(project.width, project.height),
    keyframes: normalizeShotCameraKeyframes(
      shot.camera.keyframes,
      project.width,
      project.height,
      shot.durationMs,
    ),
    speakerPlan:
      mode === 'speaker-focus' ? prepareSpeakerFocusCamera(project, shot) : null,
  };
}

function interpolateCameraView(
  from: CameraView,
  to: CameraView,
  progress: number,
): CameraView {
  const amount = Math.max(0, Math.min(1, progress));
  const eased =
    amount < 0.5
      ? 2 * amount * amount
      : 1 - Math.pow(-2 * amount + 2, 2) / 2;
  return {
    centerX: from.centerX + (to.centerX - from.centerX) * eased,
    centerY: from.centerY + (to.centerY - from.centerY) * eased,
    zoom: from.zoom + (to.zoom - from.zoom) * eased,
  };
}

/** Manual mode: hold one keyframe, interpolate between many, hold the last. */
export function evaluateManualShotCamera(
  plan: ShotCameraPlan,
  requestedTimeMs: number,
): CameraView {
  const keyframes = plan.keyframes;
  if (keyframes.length === 0) return plan.full;
  const timeMs = Math.max(0, Math.min(plan.durationMs, requestedTimeMs));
  const viewOf = ({ centerX, centerY, zoom }: ShotCameraKeyframe): CameraView => ({
    centerX,
    centerY,
    zoom,
  });
  const first = keyframes[0]!;
  if (keyframes.length === 1 || timeMs <= first.timeMs) return viewOf(first);
  const last = keyframes[keyframes.length - 1]!;
  if (timeMs >= last.timeMs) return viewOf(last);
  for (let index = 1; index < keyframes.length; index += 1) {
    const next = keyframes[index]!;
    if (timeMs > next.timeMs) continue;
    const previous = keyframes[index - 1]!;
    const span = next.timeMs - previous.timeMs;
    if (span <= 0) return viewOf(next);
    return interpolateCameraView(previous, next, (timeMs - previous.timeMs) / span);
  }
  return viewOf(last);
}

/** Shared requested-time evaluation for all three modes. */
export function evaluateShotCamera(
  plan: ShotCameraPlan,
  requestedTimeMs: number,
): CameraView {
  const timeMs = Number.isFinite(requestedTimeMs)
    ? Math.max(0, Math.round(requestedTimeMs))
    : 0;
  if (plan.mode === 'speaker-focus' && plan.speakerPlan) {
    return evaluateSpeakerFocusCamera(plan.speakerPlan, timeMs);
  }
  if (plan.mode === 'manual') return evaluateManualShotCamera(plan, timeMs);
  return plan.full;
}

/** Pure one-shot evaluation for non-playback consumers. */
export function resolveShotCamera(
  project: Project,
  shot: Shot,
  requestedTimeMs: number,
): CameraView {
  return evaluateShotCamera(prepareShotCamera(project, shot), requestedTimeMs);
}

/**
 * One capability hint for the whole Project. The rendered camera always comes
 * from each Shot, so a mixed Project reports its most demanding mode.
 */
export function resolveProjectCameraMode(project: Project): ShotCameraMode {
  const modes = new Set(project.shots.map((shot) => shot.camera.mode));
  if (modes.size === 1) return [...modes][0] ?? 'static';
  if (modes.has('manual')) return 'manual';
  return modes.has('speaker-focus') ? 'speaker-focus' : 'static';
}

/** Full stage means "no visible crop", so callers can skip identity cameras. */
export function isFullStageCamera(
  camera: CameraView,
  width: number,
  height: number,
): boolean {
  return (
    Math.abs(camera.zoom - 1) < 1e-6 &&
    Math.abs(camera.centerX - width / 2) < 1e-6 &&
    Math.abs(camera.centerY - height / 2) < 1e-6
  );
}

/** The recordable view equals the current camera framing for this Shot. */
export function cameraViewFromCenter(
  centerX: number,
  centerY: number,
  zoom: number,
  width: number,
  height: number,
): CameraView {
  return clampCamera({ centerX, centerY, zoom }, width, height);
}

/**
 * Presets only seed editable keyframes; the user can then drag or delete them.
 * They never replace the mode or hide their own numbers.
 */
export function createShotCameraPreset(
  preset: ShotCameraPreset,
  options: {
    width: number;
    height: number;
    durationMs: number;
    base?: CameraView;
  },
): ShotCameraKeyframe[] {
  const { width, height } = options;
  const endMs = Math.max(0, Math.round(options.durationMs));
  const full = fullStageCamera(width, height);
  const base = options.base ? clampCamera(options.base, width, height) : full;
  const start = (view: CameraView): ShotCameraKeyframe => ({
    timeMs: 0,
    ...clampCamera(view, width, height),
  });
  const end = (view: CameraView): ShotCameraKeyframe => ({
    timeMs: endMs,
    ...clampCamera(view, width, height),
  });
  switch (preset) {
    case 'push-in':
      return [start(full), end({ ...base, zoom: SHOT_CAMERA_PRESET_ZOOM })];
    case 'pull-out':
      return [start({ ...base, zoom: SHOT_CAMERA_PRESET_ZOOM }), end(full)];
    case 'pan': {
      const view = { centerY: base.centerY, zoom: SHOT_CAMERA_PRESET_PAN_ZOOM };
      return [
        start({ ...view, centerX: width * 0.25 }),
        end({ ...view, centerX: width * 0.75 }),
      ];
    }
    default:
      return [];
  }
}

/** One "record framing" = one replace of the keyframe at that time. */
export function upsertShotCameraKeyframe(
  camera: ShotCamera,
  keyframe: ShotCameraKeyframe,
  width: number,
  height: number,
  durationMs: number,
): ShotCamera {
  return {
    mode: camera.mode,
    keyframes: normalizeShotCameraKeyframes(
      [...camera.keyframes, keyframe],
      width,
      height,
      durationMs,
    ),
  };
}

export function removeShotCameraKeyframe(
  camera: ShotCamera,
  timeMs: number,
): ShotCamera {
  const target = Math.round(timeMs);
  return {
    mode: camera.mode,
    keyframes: camera.keyframes.filter(
      (keyframe) => Math.round(keyframe.timeMs) !== target,
    ),
  };
}

/** Mode switch is exclusive and keeps the recorded keyframes for later. */
export function withShotCameraMode(
  camera: ShotCamera,
  mode: ShotCameraMode,
): ShotCamera {
  return { mode, keyframes: camera.keyframes };
}

/** Immutable Shot replacement used by every camera Store commit. */
export function withShotCamera(
  project: Project,
  shotId: string,
  camera: ShotCamera,
  options: { mode?: ShotCameraMode } = {},
): Project {
  return {
    ...project,
    shots: project.shots.map((shot) =>
      shot.id === shotId
        ? {
            ...shot,
            camera: {
              mode: options.mode ?? camera.mode,
              keyframes: camera.keyframes,
            },
          }
        : shot,
    ),
  };
}
