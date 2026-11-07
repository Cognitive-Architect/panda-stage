import { useSyncExternalStore } from 'react';
import {
  isFullStageCamera,
  prepareShotCamera,
  resolveShotCamera,
  SHOT_CAMERA_MODES,
  type ShotCameraMode,
  type ShotCameraPreset,
} from '../../../domain';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { shotStore } from '../../stores/shotStore';
import { useTimelineUi } from '../timeline/timelineUiStore';
import { cameraToolStore, useCameraTool } from './cameraToolStore';
import {
  applyShotCameraPreset,
  deleteShotCameraKeyframe,
  readLiveShotCameraTarget,
  recordShotCameraKeyframe,
  resolveShotCameraTarget,
  setShotCameraMode,
  type ShotCameraEditTarget,
} from './shotCameraActions';

const MODE_LABELS: Record<ShotCameraMode, string> = {
  static: '固定全景',
  'speaker-focus': '自动跟随',
  manual: '手动',
};

const PRESETS: readonly { preset: ShotCameraPreset; label: string }[] = [
  { preset: 'push-in', label: '推近' },
  { preset: 'pull-out', label: '拉远' },
  { preset: 'pan', label: '横移' },
];

function formatSeconds(timeMs: number): string {
  return `${(timeMs / 1_000).toFixed(2)}s`;
}

/**
 * 工具 → 运镜. One Shot's persisted camera mode plus its small keyframe list.
 * The panel never stores a camera of its own: every control writes
 * `Shot.camera` through one History command.
 */
export function ShotCameraPanel(): React.JSX.Element {
  const snapshot = useSyncExternalStore(
    editorProjectStore.subscribe,
    editorProjectStore.getSnapshot,
  );
  const currentShotId = useSyncExternalStore(
    shotStore.subscribe,
    shotStore.getCurrentShotId,
  );
  const timelineUi = useTimelineUi();
  const tool = useCameraTool();
  const target = snapshot
    ? resolveShotCameraTarget(snapshot.project, currentShotId)
    : null;
  const timeMs = timelineUi.currentTimeMs;

  if (!target) {
    return (
      <section
        className="shot-camera-panel"
        data-testid="shot-camera-panel"
      >
        <p className="shot-camera-hint">先选择一个镜头再设置运镜。</p>
      </section>
    );
  }

  const camera = target.shot.camera;
  const plan = prepareShotCamera(target.project, target.shot);
  const presentedView = resolveShotCamera(target.project, target.shot, timeMs);
  const draftView = tool.draft ?? presentedView;
  const fullStage = isFullStageCamera(
    draftView,
    target.project.width,
    target.project.height,
  );

  const commit = (action: (editTarget: ShotCameraEditTarget) => void): void => {
    const live = readLiveShotCameraTarget();
    if (!live) return;
    action(live);
  };

  return (
    <section
      className="shot-camera-panel"
      data-camera-mode={camera.mode}
      data-testid="shot-camera-panel"
    >
      <div
        aria-label="运镜模式"
        className="shot-camera-modes project-tools-view-mode-segmented shot-camera-modes--three"
        role="group"
      >
        {SHOT_CAMERA_MODES.map((mode) => (
          <button
            aria-pressed={camera.mode === mode}
            data-testid={`camera-mode-${mode}`}
            key={mode}
            onClick={() => commit((entry) => setShotCameraMode(entry, mode))}
            type="button"
          >
            {MODE_LABELS[mode]}
          </button>
        ))}
      </div>

      {camera.mode === 'manual' ? (
        <>
          <div className="shot-camera-framing">
            <button
              aria-pressed={tool.active}
              data-testid="camera-framing-toggle"
              onClick={() => cameraToolStore.setActive(!tool.active)}
              type="button"
            >
              {tool.active ? '收起取景框' : '打开取景框'}
            </button>
            <button
              aria-pressed={tool.previewing}
              data-testid="camera-preview-toggle"
              disabled={!tool.active}
              onClick={() => cameraToolStore.setPreviewing(!tool.previewing)}
              type="button"
            >
              {tool.previewing ? '退出取景预览' : '取景预览'}
            </button>
          </div>

          {tool.active ? (
            <div
              className="shot-camera-draft"
              data-testid="camera-draft-view"
              data-draft-full-stage={String(fullStage)}
            >
              <span>取景框中心 {Math.round(draftView.centerX)},{' '}
                {Math.round(draftView.centerY)}</span>
              <span>倍率 {draftView.zoom.toFixed(2)}×</span>
              <span>时间点 {formatSeconds(timeMs)}</span>
            </div>
          ) : null}

          <button
            className="shot-camera-record"
            data-testid="camera-record-keyframe"
            onClick={() =>
              commit((entry) =>
                recordShotCameraKeyframe(
                  entry,
                  cameraToolStore.getSnapshot().draft ??
                    resolveShotCamera(entry.project, entry.shot, timeMs),
                  timeMs,
                ),
              )
            }
            type="button"
          >
            记录取景
          </button>

          <div className="shot-camera-presets">
            {PRESETS.map(({ preset, label }) => (
              <button
                data-testid={`camera-preset-${preset}`}
                key={preset}
                onClick={() =>
                  commit((entry) => applyShotCameraPreset(entry, preset))
                }
                type="button"
              >
                {label}
              </button>
            ))}
          </div>

          {plan.keyframes.length === 0 ? (
            <p className="shot-camera-hint">
              还没有关键点，当前是全片固定全景。
            </p>
          ) : (
            <ul
              aria-label="运镜关键点"
              className="shot-camera-keyframes"
              data-testid="camera-keyframe-list"
            >
              {plan.keyframes.map((keyframe) => (
                <li
                  data-time-ms={keyframe.timeMs}
                  key={keyframe.timeMs}
                >
                  <span>{formatSeconds(keyframe.timeMs)}</span>
                  <span>{keyframe.zoom.toFixed(2)}×</span>
                  <button
                    aria-label={`删除 ${formatSeconds(keyframe.timeMs)} 的关键点`}
                    className="shot-camera-keyframe-delete"
                    onClick={() =>
                      commit((entry) =>
                        deleteShotCameraKeyframe(entry, keyframe.timeMs),
                      )
                    }
                    type="button"
                  >
                    删除
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="shot-camera-hint">
          {camera.mode === 'static'
            ? '整片保持全景构图。'
            : '镜头跟随当前说话人自动聚焦。'}
        </p>
      )}
    </section>
  );
}
