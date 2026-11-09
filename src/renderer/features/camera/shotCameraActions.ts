import {
  createShotCameraPreset,
  prepareShotCamera,
  removeShotCameraKeyframe,
  upsertShotCameraKeyframe,
  withShotCameraMode,
  withShotCamera,
  type CameraView,
  type Project,
  type Shot,
  type ShotCameraMode,
  type ShotCameraPreset,
} from '../../../domain';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { shotStore } from '../../stores/shotStore';

/**
 * Every camera edit is exactly one `editorProjectStore.updateProject` call, so
 * one "记录取景" is one Undo/Redo step and the persisted `Shot.camera` stays the
 * only camera truth. Errors surface to the caller instead of being swallowed.
 */
export interface ShotCameraEditTarget {
  readonly project: Project;
  readonly shot: Shot;
}

export function resolveShotCameraTarget(
  project: Project,
  shotId: string | null,
): ShotCameraEditTarget | null {
  const shot = project.shots.find((candidate) => candidate.id === shotId);
  return shot ? { project, shot } : null;
}

function commitCamera(
  target: ShotCameraEditTarget,
  camera: Shot['camera'],
  label: string,
): void {
  editorProjectStore.updateProject(
    withShotCamera(target.project, target.shot.id, camera),
    label,
  );
}

export function setShotCameraMode(
  target: ShotCameraEditTarget,
  mode: ShotCameraMode,
): void {
  if (target.shot.camera.mode === mode) return;
  commitCamera(
    target,
    withShotCameraMode(target.shot.camera, mode),
    mode === 'manual'
      ? '切换为手动运镜'
      : mode === 'speaker-focus'
        ? '切换为自动跟随'
        : '切换为固定全景',
  );
}

export function recordShotCameraKeyframe(
  target: ShotCameraEditTarget,
  view: CameraView,
  timeMs: number,
): void {
  const width = target.project.width;
  const height = target.project.height;
  const next = upsertShotCameraKeyframe(
    withShotCameraMode(target.shot.camera, 'manual'),
    { timeMs, ...view },
    width,
    height,
    target.shot.durationMs,
  );
  commitCamera(target, next, '记录运镜取景');
}

export function deleteShotCameraKeyframe(
  target: ShotCameraEditTarget,
  timeMs: number,
): void {
  commitCamera(
    target,
    removeShotCameraKeyframe(target.shot.camera, timeMs),
    '删除运镜关键点',
  );
}

export function applyShotCameraPreset(
  target: ShotCameraEditTarget,
  preset: ShotCameraPreset,
): void {
  const plan = prepareShotCamera(target.project, target.shot);
  const keyframes = createShotCameraPreset(preset, {
    width: target.project.width,
    height: target.project.height,
    durationMs: target.shot.durationMs,
    base: plan.keyframes.length > 0 ? plan.keyframes[0] : undefined,
  });
  const labels: Record<ShotCameraPreset, string> = {
    'push-in': '运镜预设：推近',
    'pull-out': '运镜预设：拉远',
    pan: '运镜预设：横移',
  };
  commitCamera(
    target,
    { mode: 'manual', keyframes },
    labels[preset],
  );
}

/** Reads the committed target from the live stores; null when nothing is open. */
export function readLiveShotCameraTarget(): ShotCameraEditTarget | null {
  const snapshot = editorProjectStore.getSnapshot();
  if (!snapshot) return null;
  return resolveShotCameraTarget(
    snapshot.project,
    shotStore.getCurrentShotId(),
  );
}
