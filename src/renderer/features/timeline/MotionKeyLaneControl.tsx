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
  lastValidFrameTime,
  TIMELINE_FPS,
  type AnimationInterpolation,
  type Layer,
  type Shot,
} from '../../../domain';
import {
  editorProjectStore,
  type EditorProjectSnapshot,
} from '../../stores/EditorProjectStore';
import { selectionStore } from '../../stores/selectionStore';
import { shotStore } from '../../stores/shotStore';
import { IconButton } from '../../ui';
import { formatTimecode } from './timeGeometry';
import { timelineUiStore } from './timelineUiStore';
import {
  previewCharacterMotionKeyGroupShift,
  resolveNearestCharacterMotionKey,
} from './characterMotionKeyGesture';

export interface MotionKeyDragPreview {
  readonly rowId: string;
  readonly anchorTimeMs: number;
  readonly previewTimesByOrigin: ReadonlyMap<number, number>;
}

interface KeyDragSession {
  pointerId: number;
  startX: number;
  rowId: string;
  fromTimesMs: number[];
  unselectedTimesMs: number[];
  anchorTimeMs: number;
  deltaFrames: number;
  anchorPreviewTimeMs: number;
  previewTimesByOrigin: Map<number, number>;
  moved: boolean;
}

type TouchKeySession =
  | {
      kind: 'drag';
      pointerId: number;
      rowId: string;
      ownerTimeMs: number;
      drag: KeyDragSession;
    }
  | {
      kind: 'tap';
      pointerId: number;
      rowId: string;
      ownerTimeMs: number;
      shiftKey: boolean;
    }
  | {
      kind: 'blocked-base';
      pointerId: number;
      rowId: string;
      ownerTimeMs: number;
      startX: number;
    };

export interface MotionKeyToolbarProps {
  ariaLabel?: string;
  toolbarTestId: string;
  testIdPrefix: string;
  toolbarHost: HTMLElement | null;
  visible: boolean;
  previousKeyTime: number | undefined;
  followingKeyTime: number | undefined;
  selectedCount: number;
  singleSelectedKeyTime: number | null;
  canCopy: boolean;
  canPaste: boolean;
  canDelete: boolean;
  hasOutgoingInterval: boolean;
  selectedEasing: AnimationInterpolation | null;
  onSeekKey: (timeMs: number) => void;
  onCopyPose: () => void;
  onPastePose: () => void;
  onDeleteKey: () => void;
  onSetEasing: (easing: AnimationInterpolation) => void;
}

export interface MotionKeyTrackStripProps {
  rowId: string;
  label: string;
  timesMs: readonly number[];
  selectedTimesMs: readonly number[];
  currentTimeMs: number;
  pixelsPerMs: number;
  durationMs: number;
  trackWidth: number;
  editable: boolean;
  protectedCue: boolean;
  dragPreview: MotionKeyDragPreview | null;
  staleErrorMessage?: string;
  isContextCurrent: (requiredTimesMs: readonly number[]) => boolean;
  markerAriaLabel?: (timeMs: number) => string;
  markerDataAttributes?: (timeMs: number) => Record<string, string | undefined>;
  onPointerDownKeyArea?: () => void;
  onActivateKey: (timeMs: number, shiftKey: boolean) => void;
  onBlockedBaseDrag: () => void;
  onDragPreview: (preview: MotionKeyDragPreview | null) => void;
  onCommitRetime: (
    fromTimesMs: readonly number[],
    deltaFrames: number,
    anchorTimeMs: number,
  ) => void;
  onError: (message: string) => void;
}

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

function prepareKeyDragSession(input: {
  pointerId: number;
  startX: number;
  rowId: string;
  anchorTimeMs: number;
  selectedTimes: readonly number[];
  allTimesMs: readonly number[];
  isContextCurrent: (requiredTimesMs: readonly number[]) => boolean;
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
    !dragGroup.every((timeMs) => input.allTimesMs.includes(timeMs)) ||
    !input.isContextCurrent(dragGroup)
  ) {
    return { kind: 'stale' };
  }
  return {
    kind: 'drag',
    session: {
      pointerId: input.pointerId,
      startX: input.startX,
      rowId: input.rowId,
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
    },
  };
}

function stepKeyDragSession(
  drag: KeyDragSession,
  clientX: number,
  pixelsPerMs: number,
  durationMs: number,
): MotionKeyDragPreview | null {
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
    rowId: drag.rowId,
    anchorTimeMs: drag.anchorTimeMs,
    previewTimesByOrigin: preview.previewTimesByOrigin,
  };
}

interface MotionKeyMarkerProps {
  rowId: string;
  allTimesMs: readonly number[];
  current: boolean;
  dragPreviewTimeMs: number | null;
  durationMs: number;
  editable: boolean;
  ariaLabel: string;
  dataAttributes?: Record<string, string | undefined>;
  pixelsPerMs: number;
  protectedCue: boolean;
  selected: boolean;
  selectedTimesMs: readonly number[];
  showDragBubble: boolean;
  staleErrorMessage: string;
  timeMs: number;
  isContextCurrent: (requiredTimesMs: readonly number[]) => boolean;
  onPointerDownKeyArea?: () => void;
  onActivate: (timeMs: number, shiftKey: boolean) => void;
  onBlockedBaseDrag: () => void;
  onCommitDrag: (drag: KeyDragSession) => void;
  onDragPreview: (preview: MotionKeyDragPreview | null) => void;
  onError: (message: string) => void;
}

function MotionKeyMarker({
  rowId,
  allTimesMs,
  current,
  dragPreviewTimeMs,
  durationMs,
  editable,
  ariaLabel,
  dataAttributes,
  pixelsPerMs,
  protectedCue,
  selected,
  selectedTimesMs,
  showDragBubble,
  staleErrorMessage,
  timeMs,
  isContextCurrent,
  onPointerDownKeyArea,
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
    if (!editable || (drag && !isContextCurrent(drag.fromTimesMs))) {
      cancelDrag();
    }
  }, [allTimesMs, editable, isContextCurrent, rowId]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    event.stopPropagation();
    if (event.button !== 0 || event.pointerType === 'touch') return;
    onPointerDownKeyArea?.();
    if (event.shiftKey || !editable) return;
    const prepared = prepareKeyDragSession({
      pointerId: event.pointerId,
      startX: event.clientX,
      rowId,
      anchorTimeMs: timeMs,
      selectedTimes: selected ? selectedTimesMs : [],
      allTimesMs,
      isContextCurrent,
    });
    if (prepared.kind === 'stale') {
      onError(staleErrorMessage);
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
        {...dataAttributes}
        data-time-ms={timeMs}
        data-selected={selected ? 'true' : 'false'}
        data-current={current ? 'true' : 'false'}
        data-dragging={dragPreviewTimeMs === null ? 'false' : 'true'}
        data-protected={protectedCue ? 'true' : undefined}
        aria-label={ariaLabel}
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

/** Shared Composite Key action toolbar portal (Prev/Next, Multi-select count, Copy/Paste/Delete/Easing). */
export function MotionKeyToolbar({
  ariaLabel = '动作关键帧操作',
  toolbarTestId,
  testIdPrefix,
  toolbarHost,
  visible,
  previousKeyTime,
  followingKeyTime,
  selectedCount,
  canCopy,
  canPaste,
  canDelete,
  hasOutgoingInterval,
  selectedEasing,
  onSeekKey,
  onCopyPose,
  onPastePose,
  onDeleteKey,
  onSetEasing,
}: MotionKeyToolbarProps): React.JSX.Element | null {
  const [actionsOpen, setActionsOpen] = useState(false);
  const [actionsPosition, setActionsPosition] = useState<{ top: number; left: number } | null>(null);
  const actionsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (!visible) setActionsOpen(false);
  }, [visible]);

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
    const frame = window.requestAnimationFrame?.(positionPanel);
    window.addEventListener('resize', positionPanel);
    window.addEventListener('scroll', positionPanel, true);
    return () => {
      if (frame !== undefined) window.cancelAnimationFrame?.(frame);
      window.removeEventListener('resize', positionPanel);
      window.removeEventListener('scroll', positionPanel, true);
    };
  }, [actionsOpen, hasOutgoingInterval, selectedCount]);

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

  if (!toolbarHost || !visible) return null;

  return createPortal(
    <div
      aria-label={ariaLabel}
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
          if (previousKeyTime !== undefined) onSeekKey(previousKeyTime);
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
          if (followingKeyTime !== undefined) onSeekKey(followingKeyTime);
        }}
        title="下一个关键帧"
        variant="secondary"
      />
      {selectedCount >= 2 ? (
        <span
          aria-live="polite"
          className="character-motion-selection-count"
          data-testid={`${testIdPrefix}-selection-count`}
          role="status"
          title={`已选择 ${selectedCount} 个关键帧 · 拖动任意一个可整体移动`}
        >
          <span aria-hidden="true">◈</span>
          <span>已选 {selectedCount} 个关键帧</span>
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
            disabled={!canCopy}
            onClick={onCopyPose}
            title="复制姿势"
            type="button"
          >
            复制姿势
          </button>
          <button
            aria-label="粘贴姿势"
            className="character-motion-key-text-control"
            data-testid={`${testIdPrefix}-paste-pose`}
            disabled={!canPaste}
            onClick={onPastePose}
            title="粘贴姿势"
            type="button"
          >
            粘贴姿势
          </button>
          <IconButton
            aria-label="删除动作关键帧"
            className="character-motion-key-control"
            data-testid={`${testIdPrefix}-delete-key`}
            disabled={!canDelete}
            icon={<Trash2 aria-hidden="true" size={13} />}
            onClick={onDeleteKey}
            title="删除关键帧"
            variant="secondary"
          />
          {hasOutgoingInterval ? (
            <select
              aria-label="到下个关键帧的补间"
              className="character-motion-key-easing"
              data-testid={`${testIdPrefix}-easing`}
              value={selectedEasing ?? ''}
              onChange={(event) =>
                onSetEasing(event.currentTarget.value as AnimationInterpolation)
              }
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
  );
}

/** Shared Composite Key track strip supporting compact mouse markers and ±22px Touch nearest-hit capture routing. */
export function MotionKeyTrackStrip({
  rowId,
  label,
  timesMs,
  selectedTimesMs,
  currentTimeMs,
  pixelsPerMs,
  durationMs,
  trackWidth,
  editable,
  protectedCue,
  dragPreview,
  staleErrorMessage = '动作关键帧或工程状态已变化，请重新选择后再操作。',
  isContextCurrent,
  markerAriaLabel,
  markerDataAttributes,
  onPointerDownKeyArea,
  onActivateKey,
  onBlockedBaseDrag,
  onDragPreview,
  onCommitRetime,
  onError,
}: MotionKeyTrackStripProps): React.JSX.Element {
  const touchKeySessionRef = useRef<TouchKeySession | null>(null);
  const suppressTouchClickRef = useRef(false);

  useEffect(() => {
    touchKeySessionRef.current = null;
    suppressTouchClickRef.current = false;
  }, [rowId]);

  const commitDrag = (drag: KeyDragSession): void => {
    if (!isContextCurrent(drag.fromTimesMs)) {
      onError(staleErrorMessage);
      return;
    }
    if (drag.deltaFrames === 0) return;
    const anchorNext = Math.max(
      0,
      Math.min(
        durationMs,
        frameTimeMs(
          Math.round((drag.anchorTimeMs * TIMELINE_FPS) / 1_000) + drag.deltaFrames,
        ),
      ),
    );
    onCommitRetime(drag.fromTimesMs, drag.deltaFrames, anchorNext);
  };

  const spanStart = timesMs.length >= 2 ? timesMs[0]! : null;
  const spanEnd = timesMs.length >= 2 ? timesMs[timesMs.length - 1]! : null;
  const activePreview = dragPreview?.rowId === rowId ? dragPreview : null;

  return (
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
        onPointerDownKeyArea?.();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        if (event.shiftKey || !editable) {
          touchKeySessionRef.current = {
            kind: 'tap',
            pointerId: event.pointerId,
            rowId,
            ownerTimeMs: nearestTime,
            shiftKey: event.shiftKey,
          };
          return;
        }
        const prepared = prepareKeyDragSession({
          pointerId: event.pointerId,
          startX: event.clientX,
          rowId,
          anchorTimeMs: nearestTime,
          selectedTimes: selectedTimesMs.includes(nearestTime)
            ? selectedTimesMs
            : [],
          allTimesMs: timesMs,
          isContextCurrent,
        });
        if (prepared.kind === 'stale') {
          onError(staleErrorMessage);
          return;
        }
        if (prepared.kind === 'ignore') {
          touchKeySessionRef.current = {
            kind: 'tap',
            pointerId: event.pointerId,
            rowId,
            ownerTimeMs: nearestTime,
            shiftKey: false,
          };
          return;
        }
        if (prepared.kind === 'blocked-base') {
          touchKeySessionRef.current = {
            kind: 'blocked-base',
            pointerId: event.pointerId,
            rowId,
            ownerTimeMs: nearestTime,
            startX: event.clientX,
          };
          return;
        }
        touchKeySessionRef.current = {
          kind: 'drag',
          pointerId: event.pointerId,
          rowId,
          ownerTimeMs: nearestTime,
          drag: prepared.session,
        };
      }}
      onPointerMoveCapture={(event) => {
        const session = touchKeySessionRef.current;
        if (!session || session.rowId !== rowId || session.pointerId !== event.pointerId) {
          return;
        }
        event.stopPropagation();
        if (session.kind === 'tap') return;
        if (session.kind === 'blocked-base') {
          if (Math.abs(event.clientX - session.startX) >= 3) {
            touchKeySessionRef.current = null;
            suppressTouchClickRef.current = true;
            onBlockedBaseDrag();
          }
          return;
        }
        if (!editable || !isContextCurrent(session.drag.fromTimesMs)) {
          touchKeySessionRef.current = null;
          onDragPreview(null);
          return;
        }
        const nextPreview = stepKeyDragSession(
          session.drag,
          event.clientX,
          pixelsPerMs,
          durationMs,
        );
        if (nextPreview) onDragPreview(nextPreview);
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
        if (!session || session.rowId !== rowId || session.pointerId !== event.pointerId) {
          return;
        }
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
          onActivateKey(
            session.ownerTimeMs,
            session.kind === 'tap' ? session.shiftKey : false,
          );
          return;
        }
        onDragPreview(null);
        if (!session.drag.moved) {
          onActivateKey(session.ownerTimeMs, false);
          return;
        }
        commitDrag(session.drag);
      }}
      onPointerCancelCapture={(event) => {
        if (
          touchKeySessionRef.current?.rowId === rowId &&
          touchKeySessionRef.current.pointerId === event.pointerId
        ) {
          touchKeySessionRef.current = null;
          onDragPreview(null);
        }
        if (suppressTouchClickRef.current) {
          window.setTimeout(() => {
            suppressTouchClickRef.current = false;
          }, 0);
        }
      }}
      onLostPointerCapture={(event) => {
        if (
          touchKeySessionRef.current?.rowId === rowId &&
          touchKeySessionRef.current.pointerId === event.pointerId
        ) {
          touchKeySessionRef.current = null;
          onDragPreview(null);
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
          rowId={rowId}
          allTimesMs={timesMs}
          ariaLabel={
            markerAriaLabel ? markerAriaLabel(timeMs) : `${label} 关键帧 ${timeMs}ms`
          }
          current={timeMs === currentTimeMs}
          dataAttributes={markerDataAttributes?.(timeMs)}
          dragPreviewTimeMs={activePreview?.previewTimesByOrigin.get(timeMs) ?? null}
          durationMs={durationMs}
          editable={editable}
          isContextCurrent={isContextCurrent}
          pixelsPerMs={pixelsPerMs}
          protectedCue={timeMs === 0 && protectedCue}
          selected={selectedTimesMs.includes(timeMs)}
          selectedTimesMs={selectedTimesMs}
          showDragBubble={activePreview?.anchorTimeMs === timeMs}
          staleErrorMessage={staleErrorMessage}
          timeMs={timeMs}
          onActivate={onActivateKey}
          onBlockedBaseDrag={onBlockedBaseDrag}
          onCommitDrag={commitDrag}
          onDragPreview={onDragPreview}
          onError={onError}
          onPointerDownKeyArea={onPointerDownKeyArea}
        />
      ))}
    </div>
  );
}

/** Single-lane target-neutral wrapper combining MotionKeyToolbar and MotionKeyTrackStrip. */
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
  const [dragPreview, setDragPreview] = useState<MotionKeyDragPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [protectedCue, setProtectedCue] = useState(false);

  useEffect(() => {
    setSelectedTimes([]);
    setDragPreview(null);
    setError(null);
    setProtectedCue(false);
  }, [scopeKey]);

  useEffect(() => {
    if (!protectedCue) return undefined;
    const timer = window.setTimeout(() => setProtectedCue(false), 900);
    return () => window.clearTimeout(timer);
  }, [protectedCue]);

  const validSelectedTimes = selectedTimes
    .filter((timeMs) => timesMs.includes(timeMs))
    .sort((left, right) => left - right);
  const singleSelectedKeyTime =
    validSelectedTimes.length === 1 ? validSelectedTimes[0]! : null;
  const previousAnchor = validSelectedTimes[0];
  const followingAnchor = validSelectedTimes[validSelectedTimes.length - 1];
  const previousKeyTime =
    previousAnchor !== undefined
      ? [...timesMs].reverse().find((timeMs) => timeMs < previousAnchor)
      : [...timesMs].reverse().find((timeMs) => timeMs < currentTimeMs);
  const followingKeyTime =
    followingAnchor !== undefined
      ? timesMs.find((timeMs) => timeMs > followingAnchor)
      : timesMs.find((timeMs) => timeMs > currentTimeMs);
  const canEditKeys = !layer.locked && !productPreviewOpen;
  const validPasteTime =
    shot.durationMs > 0 &&
    isValidFrameTime(currentTimeMs) &&
    currentTimeMs <= lastValidFrameTime(shot.durationMs);
  const showOutgoingInterval =
    singleSelectedKeyTime !== null && hasOutgoingInterval(singleSelectedKeyTime);
  const selectedEasing =
    singleSelectedKeyTime !== null ? readEasing(singleSelectedKeyTime) : null;

  const isContextCurrent = (requiredTimesMs: readonly number[]): boolean =>
    shotStore.getCurrentShotId() === shot.id &&
    selectionStore.getSelectedLayerId() === layer.id &&
    requiredTimesMs.every((timeMs) => timesMs.includes(timeMs)) &&
    instanceId === editorProjectStore.getProjectInstanceId() &&
    snapshot === editorProjectStore.getSnapshot();

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

  return (
    <>
      <MotionKeyToolbar
        ariaLabel="对象动作关键帧操作"
        canCopy={singleSelectedKeyTime !== null}
        canDelete={singleSelectedKeyTime !== null && singleSelectedKeyTime !== 0}
        canPaste={hasClipboard && validPasteTime}
        followingKeyTime={followingKeyTime}
        hasOutgoingInterval={showOutgoingInterval}
        previousKeyTime={previousKeyTime}
        selectedCount={validSelectedTimes.length}
        selectedEasing={selectedEasing}
        singleSelectedKeyTime={singleSelectedKeyTime}
        testIdPrefix={testIdPrefix}
        toolbarHost={toolbarHost}
        toolbarTestId={toolbarTestId}
        visible={canEditKeys}
        onCopyPose={() => {
          if (singleSelectedKeyTime === null) return;
          try {
            setError(null);
            onCopyPose(singleSelectedKeyTime);
          } catch (operationError) {
            setError(errorText(operationError));
          }
        }}
        onDeleteKey={() => {
          if (singleSelectedKeyTime === null || singleSelectedKeyTime === 0) return;
          try {
            setError(null);
            onDeleteKey(singleSelectedKeyTime);
            setSelectedTimes([]);
          } catch (operationError) {
            setError(errorText(operationError));
          }
        }}
        onPastePose={() => {
          if (!hasClipboard || !validPasteTime) return;
          try {
            setError(null);
            onPastePose(currentTimeMs);
            setSelectedTimes([currentTimeMs]);
          } catch (operationError) {
            setError(errorText(operationError));
          }
        }}
        onSeekKey={(timeMs) => activateKey(timeMs, false)}
        onSetEasing={(easing) => {
          if (singleSelectedKeyTime === null) return;
          try {
            setError(null);
            onSetEasing(singleSelectedKeyTime, easing);
          } catch (operationError) {
            setError(errorText(operationError));
          }
        }}
      />

      <div
        aria-label={label}
        className={`timeline-lane character-motion-lane ${laneClassName}`.trim()}
        data-testid={laneTestId}
        role="group"
      >
        <span className="timeline-lane-label" title={label}>
          <span className="timeline-lane-label-text">{label}</span>
        </span>
        <MotionKeyTrackStrip
          currentTimeMs={currentTimeMs}
          dragPreview={dragPreview}
          durationMs={shot.durationMs}
          editable={canEditKeys}
          isContextCurrent={isContextCurrent}
          label={label}
          pixelsPerMs={pixelsPerMs}
          protectedCue={protectedCue}
          rowId={layer.id}
          selectedTimesMs={validSelectedTimes}
          timesMs={timesMs}
          trackWidth={trackWidth}
          onActivateKey={activateKey}
          onBlockedBaseDrag={() => {
            setError('基础姿势不能批量移动');
            setProtectedCue(true);
          }}
          onCommitRetime={(fromTimesMs, deltaFrames, anchorNext) => {
            try {
              setError(null);
              setProtectedCue(false);
              const nextTimes = onRetimeKeys(fromTimesMs, deltaFrames);
              setSelectedTimes([...nextTimes].sort((left, right) => left - right));
              timelineUiStore.seek(anchorNext, shot.durationMs);
            } catch (operationError) {
              setError(errorText(operationError));
            }
          }}
          onDragPreview={setDragPreview}
          onError={setError}
        />
      </div>
      {error ? (
        <div className="character-motion-error" role="alert">
          {error}
        </div>
      ) : null}
    </>
  );
}
