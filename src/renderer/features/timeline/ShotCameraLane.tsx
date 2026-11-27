import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Plus } from 'lucide-react';
import {
  canEditLayerDepth, moveLayerDepthKey, moveShotCameraKey, moveShotCameraOverride,
  removeLayerDepthKey, removeShotCameraKey, removeShotCameraOverride, resolveTimelineFrameTime,
  setLayerDepthKey, setShotCameraKey, TIMELINE_FPS, updateShotCameraOverride,
  type Layer, type Project, type Shot, type ShotCameraOverride,
} from '../../../domain';
import { editorProjectStore, type EditorProjectSnapshot } from '../../stores/EditorProjectStore';
import { resolveSelectedCameraOverride, shotStore } from '../../stores/shotStore';
import {
  OVERRIDE_DRAG_THRESHOLD_PX,
  previewCameraOverrideDrag,
  type CameraOverrideDraftRange,
  type CameraOverrideDragMode,
} from './cameraOverrideGesture';
import { previewPositionKeyTime } from './positionKeyGesture';
import { formatTimecode, timeToPx } from './timeGeometry';
import { timelineUiStore } from './timelineUiStore';

interface OverrideDragState {
  pointer: number;
  id: string;
  mode: CameraOverrideDragMode;
  startX: number;
  moved: boolean;
  snapshot: EditorProjectSnapshot;
  shotId: string;
}

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
  const overrides = !depthLayer && shot.camera?.mode === 'hybrid' ? (shot.camera.overrides ?? []) : [];
  const label = depthLayer ? '深度' : '相机';
  const testId = depthLayer ? 'layer-depth' : 'shot-camera';
  const inactive = disabled || (depthLayer !== undefined && !canEditLayerDepth(depthLayer, shot));
  const time = resolveTimelineFrameTime(currentTimeMs, shot.durationMs);
  const selectedOverrideId = useSyncExternalStore(
    shotStore.subscribe,
    shotStore.getSelectedCameraOverrideId,
    shotStore.getSelectedCameraOverrideId,
  );
  const effectiveSelectedOverrideId = !depthLayer
    ? (resolveSelectedCameraOverride(shot, selectedOverrideId, time)?.id ?? null)
    : null;

  const drag = useRef<{ pointer: number; time: number; x: number; snapshot: EditorProjectSnapshot } | null>(null);
  const [draft, setDraft] = useState<number | null>(null);
  const overrideDrag = useRef<OverrideDragState | null>(null);
  const [overrideDraft, setOverrideDraft] = useState<({ id: string } & CameraOverrideDraftRange) | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    overrideDrag.current = null;
    setOverrideDraft(null);
  }, [snapshot, shot.id, inactive]);

  useEffect(() => {
    if (!overrideDraft) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !overrideDrag.current) return;
      overrideDrag.current = null;
      setOverrideDraft(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [overrideDraft]);

  function commit(operation: (project: Project) => Project, actionLabel: string) {
    if (inactive || editorProjectStore.getSnapshot() !== snapshot || shotStore.getCurrentShotId() !== shot.id) return;
    try {
      const next = operation(snapshot.project);
      if (next !== snapshot.project) editorProjectStore.updateProject(next, actionLabel);
      setError(false);
    } catch {
      setError(true);
    }
  }

  function cancelOverrideDrag() {
    overrideDrag.current = null;
    setOverrideDraft(null);
  }

  function startOverrideDrag(
    event: React.PointerEvent<HTMLElement>,
    override: ShotCameraOverride,
    mode: CameraOverrideDragMode,
  ) {
    event.stopPropagation();
    if (inactive || event.button !== 0) return;
    shotStore.selectCameraOverride(override.id);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    overrideDrag.current = {
      pointer: event.pointerId,
      id: override.id,
      mode,
      startX: event.clientX,
      moved: false,
      snapshot,
      shotId: shot.id,
    };
  }

  function moveOverrideDrag(event: React.PointerEvent<HTMLElement>, override: ShotCameraOverride) {
    const active = overrideDrag.current;
    if (!active || active.pointer !== event.pointerId || active.id !== override.id) return;
    if (
      inactive ||
      active.snapshot !== snapshot ||
      editorProjectStore.getSnapshot() !== snapshot ||
      shotStore.getCurrentShotId() !== active.shotId
    ) {
      cancelOverrideDrag();
      return;
    }
    const deltaPx = event.clientX - active.startX;
    if (!active.moved && Math.abs(deltaPx) < OVERRIDE_DRAG_THRESHOLD_PX) return;
    active.moved = true;
    const preview = previewCameraOverrideDrag({
      override,
      overrides,
      mode: active.mode,
      deltaPx,
      pixelsPerMs,
      durationMs: shot.durationMs,
    });
    setOverrideDraft({ id: override.id, ...preview });
  }

  function endOverrideDrag(event: React.PointerEvent<HTMLElement>, override: ShotCameraOverride) {
    event.stopPropagation();
    const active = overrideDrag.current;
    if (!active || active.pointer !== event.pointerId || active.id !== override.id) return;
    overrideDrag.current = null;
    setOverrideDraft(null);
    if (
      inactive ||
      active.snapshot !== snapshot ||
      editorProjectStore.getSnapshot() !== snapshot ||
      shotStore.getCurrentShotId() !== active.shotId
    ) {
      return;
    }
    if (!active.moved) {
      shotStore.selectCameraOverride(override.id);
      timelineUiStore.seek(override.startMs, shot.durationMs);
      return;
    }
    const target = previewCameraOverrideDrag({
      override,
      overrides,
      mode: active.mode,
      deltaPx: event.clientX - active.startX,
      pixelsPerMs,
      durationMs: shot.durationMs,
    });
    if (target.startMs === override.startMs && target.endMs === override.endMs) return;
    if (active.mode === 'move') {
      commit((project) => moveShotCameraOverride(project, shot.id, override.id, target.startMs), '移动相机接管段');
    } else if (active.mode === 'resize-start') {
      commit((project) => updateShotCameraOverride(project, shot.id, override.id, { startMs: target.startMs }), '调整相机接管段');
    } else {
      commit((project) => updateShotCameraOverride(project, shot.id, override.id, { endMs: target.endMs }), '调整相机接管段');
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
        {overrides.map((override) => {
          const isDragging = overrideDraft?.id === override.id;
          const displayStartMs = isDragging ? overrideDraft.startMs : override.startMs;
          const displayEndMs = isDragging ? overrideDraft.endMs : override.endMs;
          const active = time >= displayStartMs && time < displayEndMs;
          const selected = effectiveSelectedOverrideId === override.id;
          return (
            <div
              key={override.id}
              role="button"
              tabIndex={inactive ? -1 : 0}
              aria-disabled={inactive || undefined}
              className="shot-camera-override-bar"
              data-testid="shot-camera-override"
              data-override-id={override.id}
              data-active={active}
              data-selected={selected}
              data-dragging={isDragging}
              data-start-ms={displayStartMs}
              data-end-ms={displayEndMs}
              style={{
                left: timeToPx(displayStartMs, pixelsPerMs),
                width: Math.max(6, timeToPx(displayEndMs - displayStartMs, pixelsPerMs)),
              }}
              aria-label={`手工接管 ${formatTimecode(displayStartMs)}–${formatTimecode(displayEndMs)}`}
              title={`手工接管 ${formatTimecode(displayStartMs)}–${formatTimecode(displayEndMs)}`}
              onClick={(event) => {
                event.stopPropagation();
                if (inactive) return;
                if (event.detail === 0) {
                  shotStore.selectCameraOverride(override.id);
                  timelineUiStore.seek(override.startMs, shot.durationMs);
                }
              }}
              onPointerDown={(event) => startOverrideDrag(event, override, 'move')}
              onPointerMove={(event) => moveOverrideDrag(event, override)}
              onPointerUp={(event) => endOverrideDrag(event, override)}
              onPointerCancel={cancelOverrideDrag}
              onLostPointerCapture={cancelOverrideDrag}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && overrideDrag.current?.id === override.id) {
                  event.stopPropagation();
                  event.preventDefault();
                  cancelOverrideDrag();
                  return;
                }
                if (event.key === 'Enter' || event.key === ' ') {
                  if (inactive) return;
                  event.stopPropagation();
                  event.preventDefault();
                  shotStore.selectCameraOverride(override.id);
                  timelineUiStore.seek(override.startMs, shot.durationMs);
                  return;
                }
                if (event.key !== 'Delete' && event.key !== 'Backspace') return;
                event.stopPropagation();
                event.preventDefault();
                commit((project) => removeShotCameraOverride(project, shot.id, override.id), '删除相机接管段');
              }}
            >
              <span
                className="shot-camera-override-handle shot-camera-override-handle-start"
                data-testid="shot-camera-override-handle-start"
                aria-hidden="true"
                onPointerDown={(event) => startOverrideDrag(event, override, 'resize-start')}
                onPointerMove={(event) => moveOverrideDrag(event, override)}
                onPointerUp={(event) => endOverrideDrag(event, override)}
                onPointerCancel={cancelOverrideDrag}
                onLostPointerCapture={cancelOverrideDrag}
              />
              <span
                className="shot-camera-override-handle shot-camera-override-handle-end"
                data-testid="shot-camera-override-handle-end"
                aria-hidden="true"
                onPointerDown={(event) => startOverrideDrag(event, override, 'resize-end')}
                onPointerMove={(event) => moveOverrideDrag(event, override)}
                onPointerUp={(event) => endOverrideDrag(event, override)}
                onPointerCancel={cancelOverrideDrag}
                onLostPointerCapture={cancelOverrideDrag}
              />
            </div>
          );
        })}
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
