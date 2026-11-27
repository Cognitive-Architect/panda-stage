import { useEffect, useRef, useState } from 'react';
import {
  LayerService,
  resolveTimelineFrameTime,
  TIMELINE_FPS,
  type Layer,
  type Project,
  type Shot,
} from '../../../domain';
import { editorProjectStore, type EditorProjectSnapshot } from '../../stores/EditorProjectStore';
import { shotStore } from '../../stores/shotStore';
import { previewPositionKeyTime } from './positionKeyGesture';
import { formatTimecode, timeToPx } from './timeGeometry';
import { timelineUiStore } from './timelineUiStore';

const DRAG_THRESHOLD_PX = 4;
const layerService = new LayerService();

interface ParentKeyDragState {
  pointer: number;
  fromTimeMs: number;
  startX: number;
  moved: boolean;
  snapshot: EditorProjectSnapshot;
  shotId: string;
  layerId: string;
}

export function LayerParentLane({
  snapshot,
  shot,
  layer,
  currentTimeMs,
  pixelsPerMs,
  trackWidth,
  disabled,
}: {
  snapshot: EditorProjectSnapshot;
  shot: Shot;
  layer: Layer;
  currentTimeMs: number;
  pixelsPerMs: number;
  trackWidth: number;
  disabled: boolean;
}): React.JSX.Element | null {
  const parentKeys = layer.parentKeys ?? [];
  const inactive = disabled || layer.locked || shot.backgroundLayerId === layer.id;
  const time = resolveTimelineFrameTime(currentTimeMs, shot.durationMs);
  const drag = useRef<ParentKeyDragState | null>(null);
  const [draft, setDraft] = useState<{ fromTimeMs: number; toTimeMs: number } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    drag.current = null;
    setDraft(null);
  }, [snapshot, shot.id, layer.id, inactive]);

  useEffect(() => {
    if (!draft) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !drag.current) return;
      drag.current = null;
      setDraft(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [draft]);

  if (shot.backgroundLayerId === layer.id || parentKeys.length === 0) return null;

  const baseParent = layer.parentLayerId
    ? shot.layers.find((entry) => entry.id === layer.parentLayerId)
    : undefined;
  const showBaseMarker = Boolean(layer.parentLayerId) && !parentKeys.some((key) => key.timeMs === 0);

  function cancelDrag() {
    drag.current = null;
    setDraft(null);
  }

  function commit(operation: (project: Project) => Project, actionLabel: string): boolean {
    if (inactive || editorProjectStore.getSnapshot() !== snapshot || shotStore.getCurrentShotId() !== shot.id) {
      return false;
    }
    try {
      const next = operation(snapshot.project);
      if (next !== snapshot.project) editorProjectStore.updateProject(next, actionLabel);
      setError('');
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法修改父级交接帧。');
      return false;
    }
  }

  return (
    <div
      className="timeline-lane timeline-position-lane"
      data-testid="layer-parent-lane"
      role="group"
      aria-label="父级交接"
    >
      <span className="timeline-lane-label" data-track-label="parent">
        <span className="timeline-lane-label-text">父级</span>
      </span>
      <div className="timeline-lane-content position-lane-content" style={{ width: trackWidth }}>
        {showBaseMarker ? (
          <button
            type="button"
            className="position-key-marker"
            data-testid="layer-parent-base-marker"
            data-kind="base"
            data-current={time === 0}
            style={{ left: 0 }}
            aria-label={`基础父级 ${baseParent?.name ?? '失效父级'}`}
            title={`基础父级：${baseParent?.name ?? '失效父级'}`}
            onClick={(event) => {
              event.stopPropagation();
              timelineUiStore.seek(0, shot.durationMs);
            }}
          >
            <span aria-hidden="true" className="position-key-diamond">
              <span className="position-key-root" />
            </span>
          </button>
        ) : null}
        {parentKeys.map((key, index) => {
          const moving = draft?.fromTimeMs === key.timeMs;
          const displayTimeMs = moving ? draft.toTimeMs : key.timeMs;
          const targetLayer = key.parentLayerId
            ? shot.layers.find((entry) => entry.id === key.parentLayerId)
            : undefined;
          const targetLabel = key.parentLayerId === null
            ? '独立（解绑）'
            : (targetLayer?.name ?? '失效父级');
          const previewTime = (clientX: number) => previewPositionKeyTime({
            fromTimeMs: key.timeMs,
            deltaPx: clientX - (drag.current?.startX ?? clientX),
            pixelsPerMs,
            previousTimeMs: parentKeys[index - 1]?.timeMs ?? -1000 / TIMELINE_FPS,
            nextTimeMs: parentKeys[index + 1]?.timeMs ?? null,
            durationMs: shot.durationMs,
          });
          return (
            <button
              key={key.timeMs}
              type="button"
              className="position-key-marker"
              disabled={inactive}
              data-testid="layer-parent-key"
              data-kind="handoff"
              data-key-time={displayTimeMs}
              data-original-time={key.timeMs}
              data-current={time === displayTimeMs}
              data-dragging={moving}
              style={{ left: timeToPx(displayTimeMs, pixelsPerMs) }}
              aria-label={`父级交接 ${formatTimecode(displayTimeMs)} · ${targetLabel}`}
              title={`父级交接 ${formatTimecode(displayTimeMs)} · ${targetLabel}`}
              onClick={(event) => {
                event.stopPropagation();
                if (event.detail === 0) timelineUiStore.seek(key.timeMs, shot.durationMs);
              }}
              onPointerDown={(event) => {
                event.stopPropagation();
                if (inactive || event.button !== 0) return;
                event.currentTarget.setPointerCapture?.(event.pointerId);
                drag.current = {
                  pointer: event.pointerId,
                  fromTimeMs: key.timeMs,
                  startX: event.clientX,
                  moved: false,
                  snapshot,
                  shotId: shot.id,
                  layerId: layer.id,
                };
              }}
              onPointerMove={(event) => {
                const active = drag.current;
                if (!active || active.pointer !== event.pointerId || active.fromTimeMs !== key.timeMs) return;
                if (
                  inactive ||
                  active.snapshot !== snapshot ||
                  editorProjectStore.getSnapshot() !== snapshot ||
                  shotStore.getCurrentShotId() !== active.shotId
                ) {
                  cancelDrag();
                  return;
                }
                const deltaPx = event.clientX - active.startX;
                if (!active.moved && Math.abs(deltaPx) < DRAG_THRESHOLD_PX) return;
                active.moved = true;
                setDraft({ fromTimeMs: key.timeMs, toTimeMs: previewTime(event.clientX) });
              }}
              onPointerUp={(event) => {
                event.stopPropagation();
                const active = drag.current;
                if (!active || active.pointer !== event.pointerId || active.fromTimeMs !== key.timeMs) return;
                const moved = active.moved;
                const target = previewTime(event.clientX);
                cancelDrag();
                if (
                  inactive ||
                  active.snapshot !== snapshot ||
                  editorProjectStore.getSnapshot() !== snapshot ||
                  shotStore.getCurrentShotId() !== active.shotId
                ) {
                  return;
                }
                if (!moved) {
                  timelineUiStore.seek(key.timeMs, shot.durationMs);
                  return;
                }
                if (target === key.timeMs) return;
                const ok = commit(
                  (project) => layerService.moveParentKey(project, shot.id, layer.id, key.timeMs, target),
                  '移动父级交接帧',
                );
                if (ok) timelineUiStore.seek(target, shot.durationMs);
              }}
              onPointerCancel={cancelDrag}
              onLostPointerCapture={cancelDrag}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && drag.current?.fromTimeMs === key.timeMs) {
                  event.stopPropagation();
                  event.preventDefault();
                  cancelDrag();
                  return;
                }
                if (event.key !== 'Delete' && event.key !== 'Backspace') return;
                event.stopPropagation();
                event.preventDefault();
                commit(
                  (project) => layerService.removeParentKey(project, shot.id, layer.id, key.timeMs),
                  '删除父级交接帧',
                );
              }}
            >
              <span aria-hidden="true" className="position-key-diamond" />
            </button>
          );
        })}
      </div>
      {error ? <span role="alert">{error}</span> : null}
    </div>
  );
}
