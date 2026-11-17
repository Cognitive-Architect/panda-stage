import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, MoreHorizontal, Trash2 } from 'lucide-react';
import {
  frameTimeMs,
  isValidFrameTime,
  TIMELINE_FPS,
  type AnimationInterpolation,
  type Layer,
  type Shot,
} from '../../../domain';
import type { EditorProjectSnapshot } from '../../stores/EditorProjectStore';
import { selectionStore } from '../../stores/selectionStore';
import { shotStore } from '../../stores/shotStore';
import { IconButton } from '../../ui';
import { formatTimecode } from './timeGeometry';
import { timelineUiStore } from './timelineUiStore';
import {
  previewCharacterMotionKeyGroupShift,
  resolveNearestCharacterMotionKey,
} from './characterMotionKeyGesture';

interface KeyDragPreview {
  anchorTimeMs: number;
  previewTimesByOrigin: ReadonlyMap<number, number>;
}

interface KeyDragSession {
  pointerId: number;
  startX: number;
  fromTimesMs: number[];
  unselectedTimesMs: number[];
  anchorTimeMs: number;
  deltaFrames: number;
  anchorPreviewTimeMs: number;
  previewTimesByOrigin: Map<number, number>;
  moved: boolean;
  snapshot: EditorProjectSnapshot;
  instanceId: number | null;
}

type TouchKeySession =
  | {
      kind: 'drag';
      pointerId: number;
      ownerTimeMs: number;
      drag: KeyDragSession;
    }
  | {
      kind: 'tap';
      pointerId: number;
      ownerTimeMs: number;
      shiftKey: boolean;
    }
  | {
      kind: 'blocked-base';
      pointerId: number;
      ownerTimeMs: number;
      startX: number;
    };

export interface MotionKeyLaneControlProps {
  scopeKey: string;
  label: string;
  laneClassName?: string;
  laneTestId: string;
  toolbarTestId: string;
  testIdPrefix: string;
  snapshot: EditorProjectSnapshot;
  instanceId: number | null;
  shot: Shot;
  layer: Layer;
  timesMs: readonly number[];
  pixelsPerMs: number;
  currentTimeMs: number;
  trackWidth: number;
  toolbarHost?: HTMLElement | null;
  productPreviewOpen?: boolean;
  hasClipboard: boolean;
  hasOutgoingInterval: (timeMs: number) => boolean;
  readEasing: (timeMs: number) => AnimationInterpolation | null;
  onRetimeKeys: (
    fromTimesMs: readonly number[],
    deltaFrames: number,
  ) => readonly number[];
  onCopyPose: (timeMs: number) => void;
  onPastePose: (targetTimeMs: number) => void;
  onDeleteKey: (timeMs: number) => void;
  onSetEasing: (timeMs: number, easing: AnimationInterpolation) => void;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败。';
}

function isLiveLayerMotionContext(input: {
  snapshot: EditorProjectSnapshot;
  instanceId: number | null;
  shotId: string;
  layerId: string;
}): boolean {
  return (
    shotStore.getCurrentShotId() === input.shotId &&
    selectionStore.getSelectedLayerId() === input.layerId
  );
}

function prepareKeyDragSession(input: {
  pointerId: number;
  startX: number;
  anchorTimeMs: number;
  selectedTimes: readonly number[];
  allTimesMs: readonly number[];
  snapshot: EditorProjectSnapshot;
  instanceId: number | null;
  shotId: string;
  layerId: string;
}):
  | { kind: 'blocked-base'; pointerId: number; startX: number; ownerTimeMs: number }
  | { kind: 'drag'; session: KeyDragSession }
  | { kind: 'stale' }
  | { kind: 'ignore' } {
  const dragGroup = input.selectedTimes.includes(input.anchorTimeMs)
    ? [...input.selectedTimes]
    : [input.anchorTimeMs];
  if (dragGroup.length > 1 && dragGroup.includes(0)) {
    return {
      kind: 'blocked-base',
      pointerId: input.pointerId,
      startX: input.startX,
      ownerTimeMs: input.anchorTimeMs,
    };
  }
  if (input.anchorTimeMs === 0) {
    return { kind: 'ignore' };
  }
  if (
    !isLiveLayerMotionContext({
      snapshot: input.snapshot,
      instanceId: input.instanceId,
      shotId: input.shotId,
      layerId: input.layerId,
    }) ||
    !dragGroup.every((timeMs) => input.allTimesMs.includes(timeMs))
  ) {
    return { kind: 'stale' };
  }
  return {
    kind: 'drag',
    session: {
      pointerId: input.pointerId,
      startX: input.startX,
      fromTimesMs: dragGroup,
      unselectedTimesMs: input.allTimesMs.filter(
        (candidate) => !dragGroup.includes(candidate),
      ),
      anchorTimeMs: input.anchorTimeMs,
      deltaFrames: 0,
      anchorPreviewTimeMs: input.anchorTimeMs,
      previewTimesByOrigin: new Map(
        dragGroup.map((candidate) => [candidate, candidate]),
      ),
      moved: false,
      snapshot: input.snapshot,
      instanceId: input.instanceId,
    },
  };
}

function stepKeyDragSession(
  drag: KeyDragSession,
  clientX: number,
  pixelsPerMs: number,
  durationMs: number,
): KeyDragPreview | null {
  const deltaPx = clientX - drag.startX;
  if (!drag.moved && Math.abs(deltaPx) < 3) return null;
  drag.moved = true;
  const preview = previewCharacterMotionKeyGroupShift({
    fromTimesMs: drag.fromTimesMs,
    anchorTimeMs: drag.anchorTimeMs,
    unselectedTimesMs: drag.unselectedTimesMs,
    deltaPx,
    pixelsPerMs,
    durationMs,
  });
  drag.deltaFrames = preview.deltaFrames;
  drag.anchorPreviewTimeMs = preview.anchorPreviewTimeMs;
  drag.previewTimesByOrigin = new Map(preview.previewTimesByOrigin);
  return {
    anchorTimeMs: drag.anchorTimeMs,
    previewTimesByOrigin: preview.previewTimesByOrigin,
  };
}

interface MotionKeyMarkerProps {
  allTimesMs: readonly number[];
  current: boolean;
  dragPreviewTimeMs: number | null;
  durationMs: number;
  editable: boolean;
  instanceId: number | null;
  label: string;
  layerId: string;
  pixelsPerMs: number;
  protectedCue: boolean;
  selected: boolean;
  selectedTimesMs: readonly number[];
  shotId: string;
  showDragBubble: boolean;
  snapshot: EditorProjectSnapshot;
  timeMs: number;
  onActivate: (timeMs: number, shiftKey?: boolean) => void;
  onBlockedBaseDrag: () => void;
  onCommitDrag: (
    drag: KeyDragSession,
  ) => void;
  onDragPreview: (preview: KeyDragPreview | null) => void;
  onError: (message: string) => void;
}

function MotionKeyMarker({
  allTimesMs,
  current,
  dragPreviewTimeMs,
  durationMs,
  editable,
  instanceId,
  label,
  layerId,
  pixelsPerMs,
  protectedCue,
  selected,
  selectedTimesMs,
  shotId,
  showDragBubble,
  snapshot,
  timeMs,
  onActivate,
  onBlockedBaseDrag,
  onCommitDrag,
  onDragPreview,
  onError,
}: MotionKeyMarkerProps): React.JSX.Element {
  const dragRef = useRef<KeyDragSession | null>(null);
  const blockedBaseRef = useRef<{ pointerId: number; startX: number } | null>(null);
  const suppressClickRef = useRef(false);
  const displayTime = dragPreviewTimeMs ?? timeMs;

  const cancelDrag = (): void => {
    blockedBaseRef.current = null;
    if (!dragRef.current) return;
    dragRef.current = null;
    onDragPreview(null);
  };

  useEffect(() => {
    const cancelOnBlur = (): void => cancelDrag();
    const cancelOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') cancelDrag();
    };
    window.addEventListener('blur', cancelOnBlur);
    window.addEventListener('keydown', cancelOnEscape);
    return () => {
      window.removeEventListener('blur', cancelOnBlur);
      window.removeEventListener('keydown', cancelOnEscape);
    };
  }, []);

  useEffect(() => {
    const drag = dragRef.current;
    if (
      !editable ||
      (drag &&
        (drag.snapshot !== snapshot ||
          drag.instanceId !== instanceId ||
          shotStore.getCurrentShotId() !== shotId ||
          selectionStore.getSelectedLayerId() !== layerId))
    ) {
      cancelDrag();
    }
  }, [editable, instanceId, layerId, shotId, snapshot]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    event.stopPropagation();
    if (event.button !== 0 || event.pointerType === 'touch') return;
    if (event.shiftKey || !editable) return;
    const prepared = prepareKeyDragSession({
      pointerId: event.pointerId,
      startX: event.clientX,
      anchorTimeMs: timeMs,
      selectedTimes: selected ? selectedTimesMs : [],
      allTimesMs,
      snapshot,
      instanceId,
      shotId,
      layerId,
    });
    if (prepared.kind === 'stale') {
      onError('动作关键帧已变化，请重新选择后再操作。');
      return;
    }
    if (prepared.kind === 'ignore') return;
    if (prepared.kind === 'blocked-base') {
      blockedBaseRef.current = { pointerId: event.pointerId, startX: event.clientX };
      event.currentTarget.setPointerCapture?.(event.pointerId);
      return;
    }
    dragRef.current = prepared.session;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    event.stopPropagation();
    const blocked = blockedBaseRef.current;
    if (blocked && blocked.pointerId === event.pointerId) {
      if (Math.abs(event.clientX - blocked.startX) >= 3) {
        blockedBaseRef.current = null;
        suppressClickRef.current = true;
        onBlockedBaseDrag();
      }
      return;
    }
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const nextPreview = stepKeyDragSession(
      drag,
      event.clientX,
      pixelsPerMs,
      durationMs,
    );
    if (nextPreview) onDragPreview(nextPreview);
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    event.stopPropagation();
    const blocked = blockedBaseRef.current;
    if (blocked && blocked.pointerId === event.pointerId) {
      blockedBaseRef.current = null;
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      return;
    }
    if (suppressClickRef.current) {
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
      return;
    }
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    onDragPreview(null);
    if (!drag.moved) return;
    suppressClickRef.current = true;
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
    onCommitDrag(drag);
  };

  const handleCancel = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    event.stopPropagation();
    if (blockedBaseRef.current?.pointerId === event.pointerId) {
      blockedBaseRef.current = null;
    }
    if (suppressClickRef.current) {
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    }
    if (dragRef.current?.pointerId === event.pointerId) cancelDrag();
  };

  return (
    <>
      <button
        type="button"
        data-time-ms={timeMs}
        data-selected={selected ? 'true' : 'false'}
        data-current={current ? 'true' : 'false'}
        data-dragging={dragPreviewTimeMs === null ? 'false' : 'true'}
        data-protected={protectedCue ? 'true' : undefined}
        aria-label={`${label} 关键帧 ${timeMs}ms`}
        aria-pressed={selected}
        aria-current={current ? 'true' : undefined}
        style={{ left: displayTime * pixelsPerMs }}
        title={`${formatTimecode(timeMs)}${timeMs === 0 ? ' · 基础姿势' : ''} · Shift 多选`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handleCancel}
        onLostPointerCapture={handleCancel}
        onDoubleClick={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          if (suppressClickRef.current && event.detail !== 0) {
            suppressClickRef.current = false;
            return;
          }
          onActivate(timeMs, event.shiftKey);
        }}
      >
        ◆
      </button>
      {showDragBubble && dragPreviewTimeMs !== null ? (
        <span
          aria-hidden="true"
          className="character-motion-key-time-bubble"
          style={{ left: displayTime * pixelsPerMs }}
        >
          {formatTimecode(dragPreviewTimeMs)}
        </span>
      ) : null}
    </>
  );
}

export function MotionKeyLaneControl({
  scopeKey,
  label,
  laneClassName = '',
  laneTestId,
  toolbarTestId,
  testIdPrefix,
  snapshot,
  instanceId,
  shot,
  layer,
  timesMs,
  pixelsPerMs,
  currentTimeMs,
  trackWidth,
  toolbarHost = null,
  productPreviewOpen = false,
  hasClipboard,
  hasOutgoingInterval,
  readEasing,
  onRetimeKeys,
  onCopyPose,
  onPastePose,
  onDeleteKey,
  onSetEasing,
}: MotionKeyLaneControlProps): React.JSX.Element {
  const [selectedTimes, setSelectedTimes] = useState<number[]>([]);
  const [dragPreview, setDragPreview] = useState<KeyDragPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [protectedCue, setProtectedCue] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [actionsPosition, setActionsPosition] = useState<{ top: number; left: number } | null>(null);
  const actionsRef = useRef<HTMLDetailsElement>(null);
  const touchKeySessionRef = useRef<TouchKeySession | null>(null);
  const suppressTouchClickRef = useRef(false);

  useEffect(() => {
    setSelectedTimes([]);
    setDragPreview(null);
    setError(null);
    setProtectedCue(false);
    setActionsOpen(false);
    touchKeySessionRef.current = null;
    suppressTouchClickRef.current = false;
  }, [scopeKey]);

  const validSelectedTimes = selectedTimes
    .filter((timeMs) => timesMs.includes(timeMs))
    .sort((left, right) => left - right);
  const singleSelectedKeyTime =
    validSelectedTimes.length === 1 ? validSelectedTimes[0]! : null;
  const previousKeyTime = [...timesMs].reverse().find((timeMs) => timeMs < currentTimeMs);
  const followingKeyTime = timesMs.find((timeMs) => timeMs > currentTimeMs);
  const canEditKeys = !layer.locked && !productPreviewOpen;
  const validPasteTime =
    isValidFrameTime(currentTimeMs) &&
    currentTimeMs >= 0 &&
    currentTimeMs <= shot.durationMs;
  const showOutgoingInterval =
    singleSelectedKeyTime !== null && hasOutgoingInterval(singleSelectedKeyTime);
  const selectedEasing =
    singleSelectedKeyTime !== null ? readEasing(singleSelectedKeyTime) : null;

  useLayoutEffect(() => {
    if (!actionsOpen) {
      setActionsPosition(null);
      return;
    }
    const details = actionsRef.current;
    const summary = details?.querySelector<HTMLElement>('.character-motion-key-overflow-trigger');
    const panel = details?.querySelector<HTMLElement>('.character-motion-key-overflow-content');
    if (!details || !summary || !panel) return;
    const positionPanel = (): void => {
      const anchor = summary.getBoundingClientRect();
      const panelWidth = Math.max(panel.getBoundingClientRect().width, panel.scrollWidth, 140);
      const panelHeight = Math.max(panel.getBoundingClientRect().height, panel.scrollHeight, 44);
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const left = Math.max(8, Math.min(anchor.right - panelWidth, viewportWidth - panelWidth - 8));
      const preferBelow =
        anchor.bottom + 4 + panelHeight <= viewportHeight - 8 || anchor.top < panelHeight + 12;
      const top = preferBelow
        ? Math.max(8, Math.min(anchor.bottom + 4, viewportHeight - panelHeight - 8))
        : Math.max(8, anchor.top - panelHeight - 4);
      setActionsPosition((current) =>
        current && current.top === top && current.left === left ? current : { top, left },
      );
    };
    positionPanel();
    window.addEventListener('resize', positionPanel);
    return () => window.removeEventListener('resize', positionPanel);
  }, [actionsOpen, showOutgoingInterval, validSelectedTimes.length]);

  useEffect(() => {
    if (!actionsOpen) return;
    const closeOnPointerDown = (event: globalThis.PointerEvent): void => {
      if (event.target instanceof Node && actionsRef.current?.contains(event.target)) return;
      if (actionsRef.current) actionsRef.current.open = false;
      setActionsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      if (actionsRef.current) actionsRef.current.open = false;
      setActionsOpen(false);
    };
    window.addEventListener('pointerdown', closeOnPointerDown, true);
    window.addEventListener('keydown', closeOnEscape, true);
    return () => {
      window.removeEventListener('pointerdown', closeOnPointerDown, true);
      window.removeEventListener('keydown', closeOnEscape, true);
    };
  }, [actionsOpen]);

  const activateKey = (timeMs: number, shiftKey = false): void => {
    setError(null);
    setProtectedCue(false);
    if (shiftKey) {
      setSelectedTimes((current) =>
        current.includes(timeMs)
          ? current.filter((candidate) => candidate !== timeMs)
          : [...current, timeMs].sort((left, right) => left - right),
      );
      return;
    }
    setSelectedTimes([timeMs]);
    timelineUiStore.seek(timeMs, shot.durationMs);
  };

  const triggerBlockedBaseDrag = (): void => {
    setError('基础姿势不能批量移动');
    setProtectedCue(true);
  };

  const commitDrag = (drag: KeyDragSession): void => {
    if (
      drag.snapshot !== snapshot ||
      drag.instanceId !== instanceId ||
      !isLiveLayerMotionContext({
        snapshot,
        instanceId,
        shotId: shot.id,
        layerId: layer.id,
      })
    ) {
      setError('动作关键帧已变化，请重新选择后再操作。');
      return;
    }
    if (drag.deltaFrames === 0) return;
    try {
      setError(null);
      setProtectedCue(false);
      const nextTimes = onRetimeKeys(drag.fromTimesMs, drag.deltaFrames);
      const deltaMs = frameTimeMs(
        Math.round((drag.anchorTimeMs * TIMELINE_FPS) / 1_000) + drag.deltaFrames,
      );
      const anchorNext = Math.max(0, Math.min(shot.durationMs, deltaMs));
      setSelectedTimes([...nextTimes].sort((left, right) => left - right));
      timelineUiStore.seek(anchorNext, shot.durationMs);
    } catch (operationError) {
      setError(errorText(operationError));
    }
  };

  const spanStart = timesMs.length >= 2 ? timesMs[0]! : null;
  const spanEnd = timesMs.length >= 2 ? timesMs[timesMs.length - 1]! : null;

  return (
    <>
      {toolbarHost && canEditKeys
        ? createPortal(
            <div
              aria-label="对象动作关键帧操作"
              className="character-motion-toolbar"
              data-testid={toolbarTestId}
              role="group"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              <IconButton
                aria-label="上一个动作关键帧"
                className="character-motion-key-control"
                data-testid={`${testIdPrefix}-prev-key`}
                disabled={previousKeyTime === undefined}
                icon={<ChevronLeft aria-hidden="true" size={14} />}
                onClick={() => {
                  if (previousKeyTime !== undefined) {
                    activateKey(previousKeyTime);
                  }
                }}
                title="上一个关键帧"
                variant="secondary"
              />
              <IconButton
                aria-label="下一个动作关键帧"
                className="character-motion-key-control"
                data-testid={`${testIdPrefix}-next-key`}
                disabled={followingKeyTime === undefined}
                icon={<ChevronRight aria-hidden="true" size={14} />}
                onClick={() => {
                  if (followingKeyTime !== undefined) {
                    activateKey(followingKeyTime);
                  }
                }}
                title="下一个关键帧"
                variant="secondary"
              />
              {validSelectedTimes.length >= 2 ? (
                <span
                  aria-live="polite"
                  className="character-motion-selection-count"
                  data-testid={`${testIdPrefix}-selection-count`}
                  role="status"
                  title={`已选择 ${validSelectedTimes.length} 个关键帧 · 拖动任意一个可整体移动`}
                >
                  <span aria-hidden="true">◈</span>
                  <span>已选 {validSelectedTimes.length} 个关键帧</span>
                </span>
              ) : null}
              <details
                className="character-motion-key-overflow"
                data-testid={`${testIdPrefix}-key-actions`}
                onToggle={(event) => setActionsOpen(event.currentTarget.open)}
                ref={actionsRef}
              >
                <summary
                  aria-label="更多动作关键帧操作"
                  className="character-motion-key-overflow-trigger"
                  title="更多关键帧操作"
                >
                  <MoreHorizontal aria-hidden="true" size={16} />
                </summary>
                <div
                  aria-label="动作关键帧编辑"
                  className="character-motion-key-overflow-content"
                  data-positioned={actionsPosition ? 'true' : 'false'}
                  role="group"
                  style={actionsPosition ?? undefined}
                >
                  <button
                    aria-label="复制姿势"
                    className="character-motion-key-text-control"
                    data-testid={`${testIdPrefix}-copy-pose`}
                    disabled={singleSelectedKeyTime === null}
                    onClick={() => {
                      if (singleSelectedKeyTime === null) return;
                      try {
                        setError(null);
                        onCopyPose(singleSelectedKeyTime);
                      } catch (operationError) {
                        setError(errorText(operationError));
                      }
                    }}
                    title="复制姿势"
                    type="button"
                  >
                    复制姿势
                  </button>
                  <button
                    aria-label="粘贴姿势"
                    className="character-motion-key-text-control"
                    data-testid={`${testIdPrefix}-paste-pose`}
                    disabled={!hasClipboard || !validPasteTime}
                    onClick={() => {
                      if (!hasClipboard || !validPasteTime) return;
                      try {
                        setError(null);
                        onPastePose(currentTimeMs);
                        setSelectedTimes([currentTimeMs]);
                      } catch (operationError) {
                        setError(errorText(operationError));
                      }
                    }}
                    title="粘贴姿势"
                    type="button"
                  >
                    粘贴姿势
                  </button>
                  <IconButton
                    aria-label="删除动作关键帧"
                    className="character-motion-key-control"
                    data-testid={`${testIdPrefix}-delete-key`}
                    disabled={
                      singleSelectedKeyTime === null || singleSelectedKeyTime === 0
                    }
                    icon={<Trash2 aria-hidden="true" size={13} />}
                    onClick={() => {
                      if (
                        singleSelectedKeyTime === null ||
                        singleSelectedKeyTime === 0
                      ) {
                        return;
                      }
                      try {
                        setError(null);
                        onDeleteKey(singleSelectedKeyTime);
                        setSelectedTimes([]);
                      } catch (operationError) {
                        setError(errorText(operationError));
                      }
                    }}
                    title="删除关键帧"
                    variant="secondary"
                  />
                  {showOutgoingInterval && singleSelectedKeyTime !== null ? (
                    <select
                      aria-label="到下个关键帧的补间"
                      className="character-motion-key-easing"
                      data-testid={`${testIdPrefix}-easing`}
                      value={selectedEasing ?? ''}
                      onChange={(event) => {
                        const nextEasing = event.currentTarget
                          .value as AnimationInterpolation;
                        try {
                          setError(null);
                          onSetEasing(singleSelectedKeyTime, nextEasing);
                        } catch (operationError) {
                          setError(errorText(operationError));
                        }
                      }}
                    >
                      {selectedEasing === null ? (
                        <option disabled value="">
                          混合补间
                        </option>
                      ) : null}
                      <option value="linear">匀速</option>
                      <option value="ease-in">缓入</option>
                      <option value="ease-out">缓出</option>
                      <option value="ease-in-out">平滑</option>
                      <option value="step">保持</option>
                    </select>
                  ) : null}
                </div>
              </details>
            </div>,
            toolbarHost,
          )
        : null}

      <div
        aria-label={label}
        className={`timeline-lane character-motion-lane ${laneClassName}`.trim()}
        data-testid={laneTestId}
        role="group"
      >
        <span className="timeline-lane-label" title={label}>
          <span className="timeline-lane-label-text">{label}</span>
        </span>
        <div
          className="timeline-lane-content character-motion-keys"
          style={{ width: `${trackWidth}px` }}
          onPointerDownCapture={(event) => {
            if (event.pointerType !== 'touch' || event.button !== 0) return;
            const nearestTime = resolveNearestCharacterMotionKey({
              pointerX: event.clientX,
              trackLeft: event.currentTarget.getBoundingClientRect().left,
              pixelsPerMs,
              timesMs,
            });
            if (nearestTime === null) return;
            event.stopPropagation();
            if (touchKeySessionRef.current) return;
            event.currentTarget.setPointerCapture?.(event.pointerId);
            if (event.shiftKey || !canEditKeys) {
              touchKeySessionRef.current = {
                kind: 'tap',
                pointerId: event.pointerId,
                ownerTimeMs: nearestTime,
                shiftKey: event.shiftKey,
              };
              return;
            }
            const prepared = prepareKeyDragSession({
              pointerId: event.pointerId,
              startX: event.clientX,
              anchorTimeMs: nearestTime,
              selectedTimes: validSelectedTimes.includes(nearestTime)
                ? validSelectedTimes
                : [],
              allTimesMs: timesMs,
              snapshot,
              instanceId,
              shotId: shot.id,
              layerId: layer.id,
            });
            if (prepared.kind === 'stale') {
              setError('动作关键帧已变化，请重新选择后再操作。');
              return;
            }
            if (prepared.kind === 'ignore') {
              touchKeySessionRef.current = {
                kind: 'tap',
                pointerId: event.pointerId,
                ownerTimeMs: nearestTime,
                shiftKey: false,
              };
              return;
            }
            if (prepared.kind === 'blocked-base') {
              touchKeySessionRef.current = {
                kind: 'blocked-base',
                pointerId: event.pointerId,
                ownerTimeMs: nearestTime,
                startX: event.clientX,
              };
              return;
            }
            touchKeySessionRef.current = {
              kind: 'drag',
              pointerId: event.pointerId,
              ownerTimeMs: nearestTime,
              drag: prepared.session,
            };
          }}
          onPointerMoveCapture={(event) => {
            const session = touchKeySessionRef.current;
            if (!session || session.pointerId !== event.pointerId) return;
            event.stopPropagation();
            if (session.kind === 'tap') return;
            if (session.kind === 'blocked-base') {
              if (Math.abs(event.clientX - session.startX) >= 3) {
                touchKeySessionRef.current = null;
                suppressTouchClickRef.current = true;
                triggerBlockedBaseDrag();
              }
              return;
            }
            if (!canEditKeys || session.drag.snapshot !== snapshot) {
              touchKeySessionRef.current = null;
              setDragPreview(null);
              return;
            }
            const nextPreview = stepKeyDragSession(
              session.drag,
              event.clientX,
              pixelsPerMs,
              shot.durationMs,
            );
            if (nextPreview) setDragPreview(nextPreview);
          }}
          onPointerUpCapture={(event) => {
            if (suppressTouchClickRef.current) {
              event.stopPropagation();
              if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
              window.setTimeout(() => {
                suppressTouchClickRef.current = false;
              }, 0);
              return;
            }
            const session = touchKeySessionRef.current;
            if (!session || session.pointerId !== event.pointerId) return;
            event.stopPropagation();
            touchKeySessionRef.current = null;
            if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
            suppressTouchClickRef.current = true;
            window.setTimeout(() => {
              suppressTouchClickRef.current = false;
            }, 0);
            if (session.kind === 'tap' || session.kind === 'blocked-base') {
              activateKey(
                session.ownerTimeMs,
                session.kind === 'tap' ? session.shiftKey : false,
              );
              return;
            }
            setDragPreview(null);
            if (!session.drag.moved) {
              activateKey(session.ownerTimeMs, false);
              return;
            }
            commitDrag(session.drag);
          }}
          onPointerCancelCapture={(event) => {
            if (touchKeySessionRef.current?.pointerId === event.pointerId) {
              touchKeySessionRef.current = null;
              setDragPreview(null);
            }
            if (suppressTouchClickRef.current) {
              window.setTimeout(() => {
                suppressTouchClickRef.current = false;
              }, 0);
            }
          }}
          onLostPointerCapture={(event) => {
            if (touchKeySessionRef.current?.pointerId === event.pointerId) {
              touchKeySessionRef.current = null;
              setDragPreview(null);
            }
          }}
          onClickCapture={(event) => {
            if (!suppressTouchClickRef.current) return;
            event.stopPropagation();
            suppressTouchClickRef.current = false;
          }}
        >
          {spanStart !== null && spanEnd !== null ? (
            <span
              aria-hidden="true"
              className="character-motion-span-line"
              style={{
                left: spanStart * pixelsPerMs,
                width: Math.max(0, (spanEnd - spanStart) * pixelsPerMs),
              }}
            />
          ) : null}
          {timesMs.map((timeMs) => (
            <MotionKeyMarker
              key={timeMs}
              allTimesMs={timesMs}
              current={timeMs === currentTimeMs}
              dragPreviewTimeMs={dragPreview?.previewTimesByOrigin.get(timeMs) ?? null}
              durationMs={shot.durationMs}
              editable={canEditKeys}
              instanceId={instanceId}
              label={label}
              layerId={layer.id}
              pixelsPerMs={pixelsPerMs}
              protectedCue={timeMs === 0 && protectedCue}
              selected={validSelectedTimes.includes(timeMs)}
              selectedTimesMs={validSelectedTimes}
              shotId={shot.id}
              showDragBubble={dragPreview?.anchorTimeMs === timeMs}
              snapshot={snapshot}
              timeMs={timeMs}
              onActivate={activateKey}
              onBlockedBaseDrag={triggerBlockedBaseDrag}
              onCommitDrag={commitDrag}
              onDragPreview={setDragPreview}
              onError={setError}
            />
          ))}
        </div>
      </div>
      {error ? (
        <div className="character-motion-error" role="alert">
          {error}
        </div>
      ) : null}
    </>
  );
}
