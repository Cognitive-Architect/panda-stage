import { useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { canEditLayerDepth, moveLayerDepthKey, moveShotCameraKey, removeLayerDepthKey, removeShotCameraKey, resolveTimelineFrameTime, setLayerDepthKey, setShotCameraKey, TIMELINE_FPS, type Layer, type Project, type Shot } from '../../../domain';
import { editorProjectStore, type EditorProjectSnapshot } from '../../stores/EditorProjectStore';
import { shotStore } from '../../stores/shotStore';
import { previewPositionKeyTime } from './positionKeyGesture';
import { formatTimecode, timeToPx } from './timeGeometry';
import { timelineUiStore } from './timelineUiStore';

export function ShotCameraLane({ snapshot, shot, currentTimeMs, pixelsPerMs, trackWidth, disabled, depthLayer }: {
  snapshot: EditorProjectSnapshot;
  shot: Shot;
  currentTimeMs: number;
  pixelsPerMs: number;
  trackWidth: number;
  disabled: boolean;
  depthLayer?: Layer;
}): React.JSX.Element {
  const layerId = depthLayer?.id;
  const keys = (depthLayer ? depthLayer.depthKeys : shot.camera?.keys) ?? [];
  const label = depthLayer ? '深度' : '相机';
  const testId = depthLayer ? 'layer-depth' : 'shot-camera';
  const inactive = disabled || (depthLayer !== undefined && !canEditLayerDepth(depthLayer, shot));
  const time = resolveTimelineFrameTime(currentTimeMs, shot.durationMs);
  const drag = useRef<{ pointer: number; time: number; x: number; snapshot: EditorProjectSnapshot } | null>(null);
  const [draft, setDraft] = useState<number | null>(null);
  const [error, setError] = useState(false);

  function commit(operation: (project: Project) => Project, label: string) {
    if (inactive || editorProjectStore.getSnapshot() !== snapshot || shotStore.getCurrentShotId() !== shot.id) return;
    try {
      const next = operation(snapshot.project);
      if (next !== snapshot.project) editorProjectStore.updateProject(next, label);
      setError(false);
    } catch {
      setError(true);
    }
  }

  return (
    <div className="timeline-lane timeline-position-lane" data-testid={testId + "-lane"} role="group" aria-label={label}>
      <span className="timeline-lane-label" data-track-label={depthLayer ? "depth" : "camera"}>
        <span className="timeline-lane-label-text">{label}</span>
        <button type="button" aria-label={`添加${label}关键帧`} title={`添加${label}关键帧`} data-ui-button data-ui-size="icon"
          disabled={inactive || keys.some((key) => key.timeMs === time)}
          onClick={() => commit((project) => layerId ? setLayerDepthKey(project, shot.id, layerId, time) : setShotCameraKey(project, shot.id, time), `添加${label}关键帧`)}>
          <Plus size={14} aria-hidden="true" />
        </button>
      </span>
      <div className="timeline-lane-content position-lane-content" style={{ width: trackWidth }}>
        {keys.map((key, index) => {
          const moving = drag.current?.time === key.timeMs && draft !== null;
          const previewTime = (x: number) => previewPositionKeyTime({
            fromTimeMs: key.timeMs, deltaPx: x - (drag.current?.x ?? x), pixelsPerMs,
            previousTimeMs: keys[index - 1]?.timeMs ?? -1000 / TIMELINE_FPS,
            nextTimeMs: keys[index + 1]?.timeMs ?? null, durationMs: shot.durationMs,
          });
          return (
            <button key={key.timeMs} type="button" className="position-key-marker"
              disabled={inactive} data-testid={testId + "-key"} data-key-time={key.timeMs}
              data-current={time === key.timeMs} data-dragging={moving}
              style={{ left: timeToPx(moving ? draft : key.timeMs, pixelsPerMs) }}
              aria-label={`${label}关键帧 ${formatTimecode(key.timeMs)}`}
              onClick={(event) => {
                event.stopPropagation();
                if (event.detail === 0) timelineUiStore.seek(key.timeMs, shot.durationMs);
              }}
              onPointerDown={(event) => {
                event.stopPropagation();
                if (event.button !== 0) return;
                event.currentTarget.setPointerCapture(event.pointerId);
                drag.current = { pointer: event.pointerId, time: key.timeMs, x: event.clientX, snapshot };
              }}
              onPointerMove={(event) => {
                const active = drag.current;
                if (active?.pointer !== event.pointerId || active.time !== key.timeMs) return;
                setDraft(previewTime(event.clientX));
              }}
              onPointerUp={(event) => {
                event.stopPropagation();
                const active = drag.current;
                if (active?.pointer !== event.pointerId || active.time !== key.timeMs) return;
                const target = previewTime(event.clientX);
                drag.current = null;
                setDraft(null);
                if (active.snapshot !== snapshot || editorProjectStore.getSnapshot() !== snapshot) return;
                commit((project) => layerId ? moveLayerDepthKey(project, shot.id, layerId, key.timeMs, target) : moveShotCameraKey(project, shot.id, key.timeMs, target), `移动${label}关键帧`);
                timelineUiStore.seek(target, shot.durationMs);
              }}
              onLostPointerCapture={() => { drag.current = null; setDraft(null); }}
              onKeyDown={(event) => {
                if (event.key !== 'Delete' && event.key !== 'Backspace') return;
                event.stopPropagation();
                event.preventDefault();
                commit((project) => layerId ? removeLayerDepthKey(project, shot.id, layerId, key.timeMs) : removeShotCameraKey(project, shot.id, key.timeMs), `删除${label}关键帧`);
              }}>
              <span aria-hidden="true" className="position-key-diamond" />
            </button>
          );
        })}
      </div>
      {error ? <span role="alert">无法修改{label}关键帧。</span> : null}
    </div>
  );
}
