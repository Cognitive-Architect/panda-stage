import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  Trash2,
} from 'lucide-react';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import {
  characterCompositeKeyEasing,
  characterCompositeKeyTimes,
  CharacterMotionService,
  characterMotionValues,
  hasAuthoredCharacterPartMotion,
  hasCompositeKeyOutgoingInterval,
  isValidFrameTime,
  lastValidFrameTime,
  type AnimationInterpolation,
  type CharacterMotionValues,
  type Project,
  type Shot,
} from '../../../domain';
import { editorProjectStore, type EditorProjectSnapshot } from '../../stores/EditorProjectStore';
import { selectionStore } from '../../stores/selectionStore';
import { shotStore } from '../../stores/shotStore';
import { IconButton } from '../../ui/Button';
import { characterMotionParts } from '../canvas/characterMotionContext';
import { previewCharacterMotionKeyGroupShift } from './characterMotionKeyGesture';
import { PositionLaneErrorNotice } from './PositionLane';
import { formatTimecode } from './timeGeometry';
import { timelineUiStore } from './timelineUiStore';

export interface CharacterMotionLaneProps {
  project: Project;
  shot: Shot;
  layerId: string | null;
  pixelsPerMs: number;
  currentTimeMs: number;
  trackWidth?: number;
  toolbarHost?: HTMLElement | null;
  productPreviewOpen?: boolean;
}

interface PoseClipboard {
  scope: string;
  sourceTimeMs: number;
  pose: CharacterMotionValues;
}

interface KeyGroupDragPreview {
  partId: string;
  anchorTimeMs: number;
  previewTimesByOrigin: ReadonlyMap<number, number>;
}

interface KeyDragSession {
  pointerId: number;
  startX: number;
  fromTimesMs: readonly number[];
  unselectedTimesMs: readonly number[];
  anchorTimeMs: number;
  deltaFrames: number;
  anchorPreviewTimeMs: number;
  previewTimesByOrigin: ReadonlyMap<number, number>;
  blockedBase: boolean;
  moved: boolean;
  snapshot: EditorProjectSnapshot;
  instanceId: number | null;
}

const motionService = new CharacterMotionService();

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : '动作关键帧操作失败，请重试。';
}

function isCurrentCharacterMotionContext(input: {
  snapshot: EditorProjectSnapshot | null;
  instanceId: number | null;
  shotId: string;
  layerId: string;
  partId: string;
  requireSelectedPart?: boolean;
  keyTimeMs?: number;
  keyTimesMs?: readonly number[];
}): input is typeof input & { snapshot: EditorProjectSnapshot } {
  const {
    snapshot,
    instanceId,
    shotId,
    layerId,
    partId,
    requireSelectedPart = true,
    keyTimeMs,
    keyTimesMs,
  } = input;
  if (
    !snapshot ||
    editorProjectStore.getSnapshot() !== snapshot ||
    editorProjectStore.getProjectInstanceId() !== instanceId ||
    shotStore.getCurrentShotId() !== shotId ||
    selectionStore.getSelectedLayerId() !== layerId ||
    (requireSelectedPart && selectionStore.getSelectedCharacterPartId() !== partId)
  ) {
    return false;
  }
  const shot = snapshot.project.shots.find((candidate) => candidate.id === shotId);
  const layer = shot?.layers.find((candidate) => candidate.id === layerId);
  if (!layer || layer.locked || layer.source.kind !== 'character') return false;
  if (!characterMotionParts(snapshot.project, layer).some((part) => part.partId === partId)) return false;
  const timesToCheck = keyTimesMs ?? (keyTimeMs === undefined ? null : [keyTimeMs]);
  if (!timesToCheck) return true;
  const currentTimes = characterCompositeKeyTimes(layer, partId);
  return timesToCheck.every((candidate) => currentTimes.includes(candidate));
}

/** Scroll only the enclosing vertical lane viewport so horizontal ruler scroll stays intact. */
function focusSelectedPartRow(row: HTMLDivElement | null): void {
  if (!row) return;
  const container = row.closest<HTMLElement>('.timeline-media-lanes');
  if (container && container.clientHeight > 0) {
    const rowTop = row.offsetTop - container.offsetTop;
    const rowBottom = rowTop + row.offsetHeight;
    if (rowTop < container.scrollTop) {
      container.scrollTop = rowTop;
    } else if (rowBottom > container.scrollTop + container.clientHeight) {
      container.scrollTop = rowBottom - container.clientHeight;
    }
    return;
  }
  row.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
}

export function CharacterMotionLane({
  project,
  shot,
  layerId,
  pixelsPerMs,
  currentTimeMs,
  trackWidth = shot.durationMs * pixelsPerMs,
  toolbarHost = null,
  productPreviewOpen = false,
}: CharacterMotionLaneProps): React.JSX.Element | null {
  const snapshot = useSyncExternalStore(editorProjectStore.subscribe, editorProjectStore.getSnapshot);
  const instanceId = editorProjectStore.getProjectInstanceId();
  const partId = useSyncExternalStore(selectionStore.subscribe, selectionStore.getSelectedCharacterPartId);
  const revealNonce = useSyncExternalStore(
    timelineUiStore.subscribe,
    () => timelineUiStore.getSnapshot().characterMotionRevealNonce,
  );
  const [groupExpanded, setGroupExpanded] = useState(true);
  const [selectedKey, setSelectedKey] = useState<{ partId: string; timesMs: number[] } | null>(null);
  const [dragPreview, setDragPreview] = useState<KeyGroupDragPreview | null>(null);
  const [clipboard, setClipboard] = useState<PoseClipboard | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [actionsPosition, setActionsPosition] = useState<{ left: number; top: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const actionsRef = useRef<HTMLDetailsElement>(null);
  const selectedRowRef = useRef<HTMLDivElement>(null);
  const lastFocusedKeyRef = useRef<string | null>(null);
  const prevPartIdRef = useRef(partId);
  const prevRevealNonceRef = useRef(revealNonce);
  const layer = shot.layers.find((candidate) => candidate.id === layerId);
  const allParts = characterMotionParts(project, layer);

  const scopeKey = JSON.stringify([
    instanceId,
    project.id,
    snapshot?.projectRoot ?? '',
    shot.id,
    layer?.id ?? '',
    partId ?? '',
  ]);

  useEffect(() => {
    setGroupExpanded(true);
    lastFocusedKeyRef.current = null;
  }, [shot.id, layer?.id]);

  useEffect(() => {
    setSelectedKey((current) => (current?.partId === partId ? current : null));
    setDragPreview(null);
    setClipboard(null);
    setActionsOpen(false);
    setError(null);
  }, [instanceId, project.id, snapshot?.projectRoot, shot.id, layer?.id, partId]);

  useEffect(() => {
    if (!actionsOpen) {
      setActionsPosition(null);
      return;
    }
    const positionMenu = (): void => {
      const details = actionsRef.current;
      const trigger = details?.querySelector('summary');
      const menu = details?.querySelector<HTMLElement>('.character-motion-key-overflow-content');
      if (!details?.open || !trigger || !menu) return;
      const triggerBounds = trigger.getBoundingClientRect();
      const menuBounds = menu.getBoundingClientRect();
      const menuWidth = menuBounds.width || menu.scrollWidth;
      const menuHeight = menuBounds.height || menu.scrollHeight;
      const left = Math.min(
        Math.max(8, triggerBounds.right - menuWidth),
        Math.max(8, window.innerWidth - menuWidth - 8),
      );
      const below = triggerBounds.bottom + 5;
      const top =
        below + menuHeight <= window.innerHeight - 8
          ? below
          : Math.max(8, triggerBounds.top - menuHeight - 5);
      setActionsPosition((current) =>
        current?.left === left && current.top === top ? current : { left, top },
      );
    };
    const frame = window.requestAnimationFrame(positionMenu);
    window.addEventListener('resize', positionMenu);
    window.addEventListener('scroll', positionMenu, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', positionMenu);
      window.removeEventListener('scroll', positionMenu, true);
    };
  }, [actionsOpen]);

  useLayoutEffect(() => {
    const partChanged = partId !== prevPartIdRef.current;
    const revealed = revealNonce !== prevRevealNonceRef.current;
    prevPartIdRef.current = partId;
    prevRevealNonceRef.current = revealNonce;
    if (!partId || !layer) {
      lastFocusedKeyRef.current = null;
      return;
    }
    if ((partChanged || revealed) && !groupExpanded) {
      lastFocusedKeyRef.current = null;
      setGroupExpanded(true);
      return;
    }
    if (!groupExpanded) {
      lastFocusedKeyRef.current = null;
      return;
    }
    const focusKey = `${shot.id}:${layer.id}:${partId}`;
    if (!revealed && lastFocusedKeyRef.current === focusKey) return;
    lastFocusedKeyRef.current = focusKey;
    focusSelectedPartRow(selectedRowRef.current);
  }, [groupExpanded, layer, partId, revealNonce, shot.id]);

  if (!layer || allParts.length === 0) return null;

  const authoredPartIds = new Set(
    allParts
      .filter((part) => hasAuthoredCharacterPartMotion(layer, part.partId))
      .map((part) => part.partId),
  );
  const visibleParts = allParts.filter(
    (part) => part.partId === partId || authoredPartIds.has(part.partId),
  );
  if (visibleParts.length === 0) return null;

  const overviewTimes = [
    ...new Set(
      visibleParts
        .filter((part) => authoredPartIds.has(part.partId))
        .flatMap((part) =>
          characterCompositeKeyTimes(layer, part.partId).filter((time) => time <= shot.durationMs),
        ),
    ),
  ].sort((left, right) => left - right);

  const activePart = partId ? visibleParts.find((part) => part.partId === partId) ?? null : null;
  const activePartTimes = activePart
    ? characterCompositeKeyTimes(layer, activePart.partId).filter((time) => time <= shot.durationMs)
    : [];
  const selectedKeyTimes =
    activePart && selectedKey?.partId === activePart.partId
      ? selectedKey.timesMs
          .filter((time) => activePartTimes.includes(time))
          .sort((left, right) => left - right)
      : [];
  const singleSelectedKeyTime =
    selectedKeyTimes.length === 1 ? selectedKeyTimes[0]! : null;
  const previousAnchor = selectedKeyTimes[0];
  const followingAnchor = selectedKeyTimes[selectedKeyTimes.length - 1];
  const previousKeyTime =
    previousAnchor !== undefined
      ? [...activePartTimes].reverse().find((time) => time < previousAnchor)
      : [...activePartTimes].reverse().find((time) => time < currentTimeMs);
  const followingKeyTime =
    followingAnchor !== undefined
      ? activePartTimes.find((time) => time > followingAnchor)
      : activePartTimes.find((time) => time > currentTimeMs);
  const hasOutgoingInterval = Boolean(
    activePart &&
      singleSelectedKeyTime !== null &&
      hasCompositeKeyOutgoingInterval(layer, activePart.partId, singleSelectedKeyTime),
  );
  const selectedEasing =
    hasOutgoingInterval && activePart && singleSelectedKeyTime !== null
      ? characterCompositeKeyEasing(layer, activePart.partId, singleSelectedKeyTime)
      : null;
  const clipboardMatches = clipboard?.scope === scopeKey;
  const validPasteTime =
    shot.durationMs > 0 &&
    isValidFrameTime(currentTimeMs) &&
    currentTimeMs <= lastValidFrameTime(shot.durationMs);

  const reportStale = (): void => {
    setError('动作关键帧或工程状态已变化，请重新选择后再操作。');
  };

  const selectPart = (targetPartId: string): void => {
    if (selectionStore.getSelectedLayerId() !== layer.id) {
      selectionStore.select(layer.id);
    }
    selectionStore.selectCharacterPart(targetPartId);
  };

  const activateKey = (targetPartId: string, timeMs: number, shiftKey = false): void => {
    setError(null);
    selectPart(targetPartId);
    if (!shiftKey) {
      setSelectedKey({ partId: targetPartId, timesMs: [timeMs] });
      timelineUiStore.seek(timeMs, shot.durationMs);
      return;
    }
    setSelectedKey((current) => {
      if (!current || current.partId !== targetPartId) {
        return { partId: targetPartId, timesMs: [timeMs] };
      }
      const nextTimes = current.timesMs.includes(timeMs)
        ? current.timesMs.filter((candidate) => candidate !== timeMs)
        : [...current.timesMs, timeMs].sort((left, right) => left - right);
      return nextTimes.length > 0 ? { partId: targetPartId, timesMs: nextTimes } : null;
    });
  };

  const retimeSelectedKeys = (
    targetPartId: string,
    nextTimesMs: readonly number[],
    anchorTimeMs: number,
  ): void => {
    setError(null);
    setSelectedKey({
      partId: targetPartId,
      timesMs: [...nextTimesMs].sort((left, right) => left - right),
    });
    timelineUiStore.seek(anchorTimeMs, shot.durationMs);
  };

  const copySelectedPose = (): void => {
    if (!activePart || singleSelectedKeyTime === null) return;
    try {
      setError(null);
      const pose = characterMotionValues(project, {
        shotId: shot.id,
        layerId: layer.id,
        partId: activePart.partId,
        timeMs: singleSelectedKeyTime,
        autoKey: true,
      });
      setClipboard({ scope: scopeKey, sourceTimeMs: singleSelectedKeyTime, pose });
    } catch (operationError) {
      setError(errorText(operationError));
    }
  };

  const pasteAtPlayhead = (): void => {
    if (!activePart || !clipboardMatches || !clipboard) return;
    if (!validPasteTime) {
      setError('请先将播放头移到镜头内的有效帧。');
      return;
    }
    if (
      !snapshot ||
      !isCurrentCharacterMotionContext({
        snapshot,
        instanceId,
        shotId: shot.id,
        layerId: layer.id,
        partId: activePart.partId,
      })
    ) {
      reportStale();
      return;
    }
    try {
      setError(null);
      const next = motionService.pasteCompositePose(snapshot.project, {
        shotId: shot.id,
        layerId: layer.id,
        partId: activePart.partId,
        targetTimeMs: currentTimeMs,
        pose: clipboard.pose,
      });
      if (next !== snapshot.project) {
        editorProjectStore.updateProject(next, '粘贴部件姿势');
      }
      setSelectedKey({ partId: activePart.partId, timesMs: [currentTimeMs] });
    } catch (operationError) {
      setError(errorText(operationError));
    }
  };

  const deleteSelectedKey = (): void => {
    if (!activePart || singleSelectedKeyTime === null || singleSelectedKeyTime === 0) return;
    if (
      !snapshot ||
      !isCurrentCharacterMotionContext({
        snapshot,
        instanceId,
        shotId: shot.id,
        layerId: layer.id,
        partId: activePart.partId,
        keyTimeMs: singleSelectedKeyTime,
      })
    ) {
      reportStale();
      return;
    }
    try {
      setError(null);
      const next = motionService.deleteCompositeKey(snapshot.project, {
        shotId: shot.id,
        layerId: layer.id,
        partId: activePart.partId,
        timeMs: singleSelectedKeyTime,
      });
      editorProjectStore.updateProject(next, '删除动作关键帧');
      setSelectedKey(null);
    } catch (operationError) {
      setError(errorText(operationError));
    }
  };

  const setEasing = (interpolationToNext: AnimationInterpolation): void => {
    if (!activePart || singleSelectedKeyTime === null || !hasOutgoingInterval) return;
    if (
      !snapshot ||
      !isCurrentCharacterMotionContext({
        snapshot,
        instanceId,
        shotId: shot.id,
        layerId: layer.id,
        partId: activePart.partId,
        keyTimeMs: singleSelectedKeyTime,
      })
    ) {
      reportStale();
      return;
    }
    try {
      setError(null);
      const next = motionService.setCompositeKeyEasing(snapshot.project, {
        shotId: shot.id,
        layerId: layer.id,
        partId: activePart.partId,
        timeMs: singleSelectedKeyTime,
        interpolationToNext,
      });
      if (next !== snapshot.project) {
        editorProjectStore.updateProject(next, '修改动作关键帧补间');
      }
    } catch (operationError) {
      setError(errorText(operationError));
    }
  };

  return (
    <>
      {toolbarHost && activePart && !layer.locked && !productPreviewOpen
        ? createPortal(
            <div
              aria-label="动作关键帧操作"
              className="character-motion-toolbar"
              data-testid="character-motion-toolbar"
              role="group"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              <IconButton
                aria-label="上一个动作关键帧"
                className="character-motion-key-control"
                data-testid="character-motion-prev-key"
                disabled={previousKeyTime === undefined}
                icon={<ChevronLeft aria-hidden="true" size={14} />}
                onClick={() => {
                  if (previousKeyTime !== undefined) {
                    activateKey(activePart.partId, previousKeyTime);
                  }
                }}
                title="上一个关键帧"
                variant="secondary"
              />
              <IconButton
                aria-label="下一个动作关键帧"
                className="character-motion-key-control"
                data-testid="character-motion-next-key"
                disabled={followingKeyTime === undefined}
                icon={<ChevronRight aria-hidden="true" size={14} />}
                onClick={() => {
                  if (followingKeyTime !== undefined) {
                    activateKey(activePart.partId, followingKeyTime);
                  }
                }}
                title="下一个关键帧"
                variant="secondary"
              />
              <details
                className="character-motion-key-overflow"
                data-testid="character-motion-key-actions"
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
                    data-testid="character-motion-copy-pose"
                    disabled={singleSelectedKeyTime === null}
                    onClick={copySelectedPose}
                    title="复制姿势"
                    type="button"
                  >
                    复制姿势
                  </button>
                  <button
                    aria-label="粘贴姿势"
                    className="character-motion-key-text-control"
                    data-testid="character-motion-paste-pose"
                    disabled={!clipboardMatches || !validPasteTime}
                    onClick={pasteAtPlayhead}
                    title="粘贴姿势"
                    type="button"
                  >
                    粘贴姿势
                  </button>
                  <IconButton
                    aria-label="删除动作关键帧"
                    className="character-motion-key-control"
                    data-testid="character-motion-delete-key"
                    disabled={singleSelectedKeyTime === null || singleSelectedKeyTime === 0}
                    icon={<Trash2 aria-hidden="true" size={13} />}
                    onClick={deleteSelectedKey}
                    title="删除关键帧"
                    variant="secondary"
                  />
                  {hasOutgoingInterval ? (
                    <select
                      aria-label="到下个关键帧的补间"
                      className="character-motion-key-easing"
                      data-testid="character-motion-easing"
                      value={selectedEasing ?? ''}
                      onChange={(event) =>
                        setEasing(event.currentTarget.value as AnimationInterpolation)
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
          )
        : null}

      <div
        aria-label="人物动作总览"
        className="timeline-lane character-motion-overview-lane"
        data-expanded={groupExpanded ? 'true' : 'false'}
        data-testid="character-motion-overview-lane"
        role="group"
      >
        <span
          className="timeline-lane-label character-motion-overview-label"
          data-track-label="character-motion-overview"
          title="人物动作"
        >
          <button
            type="button"
            className="character-motion-group-toggle"
            data-testid="character-motion-group-toggle"
            aria-expanded={groupExpanded}
            aria-label={groupExpanded ? '收起人物动作轨道' : '展开人物动作轨道'}
            title={groupExpanded ? '收起人物动作轨道' : '展开人物动作轨道'}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              setGroupExpanded((expanded) => !expanded);
            }}
          >
            {groupExpanded ? (
              <ChevronDown aria-hidden="true" size={13} />
            ) : (
              <ChevronRight aria-hidden="true" size={13} />
            )}
          </button>
          <span className="timeline-lane-label-text">人物动作</span>
        </span>
        <div
          className="timeline-lane-content character-motion-overview-keys"
          style={{ width: `${trackWidth}px` }}
        >
          {overviewTimes.map((time) => (
            <button
              type="button"
              key={time}
              className="character-motion-overview-marker"
              data-testid="character-motion-overview-marker"
              data-time-ms={time}
              aria-label={`人物动作总览关键帧 ${time}ms`}
              aria-current={time === currentTimeMs ? 'true' : undefined}
              style={{ left: time * pixelsPerMs }}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                timelineUiStore.seek(time, shot.durationMs);
              }}
            >
              <span aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>
      {groupExpanded
        ? visibleParts.map((part) => {
            const selected = part.partId === partId;
            const times = characterCompositeKeyTimes(layer, part.partId).filter(
              (time) => time <= shot.durationMs,
            );
            const activeDragPreview = dragPreview?.partId === part.partId ? dragPreview : null;
            const previewedTimes = activeDragPreview
              ? times
                  .map((time) => activeDragPreview.previewTimesByOrigin.get(time) ?? time)
                  .sort((left, right) => left - right)
              : times;
            const spanStart = previewedTimes.length > 1 ? previewedTimes[0]! : null;
            const spanEnd =
              previewedTimes.length > 1 ? previewedTimes[previewedTimes.length - 1]! : null;
            return (
              <div
                key={part.partId}
                ref={selected ? selectedRowRef : undefined}
                className="timeline-lane character-motion-lane"
                aria-label={`${part.name} 动作关键帧`}
                data-part-id={part.partId}
                data-selected-part={selected ? 'true' : 'false'}
                data-testid="character-motion-part-lane"
                onPointerDown={(event) => {
                  event.stopPropagation();
                  selectPart(part.partId);
                  if (selected) setSelectedKey(null);
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  selectPart(part.partId);
                  if (selected) setSelectedKey(null);
                }}
              >
                <span className="timeline-lane-label" title={part.name}>
                  <button
                    type="button"
                    className="character-motion-part-select"
                    aria-pressed={selected}
                    aria-label={part.name}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      selectPart(part.partId);
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      selectPart(part.partId);
                    }}
                  >
                    <span className="timeline-lane-label-text">{part.name}</span>
                  </button>
                </span>
                <div
                  className="timeline-lane-content character-motion-keys"
                  style={{ width: `${trackWidth}px` }}
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
                  {times.map((time) => (
                    <CharacterMotionKeyMarker
                      key={time}
                      allPartTimes={times}
                      current={time === currentTimeMs}
                      dragPreviewTimeMs={activeDragPreview?.previewTimesByOrigin.get(time) ?? null}
                      durationMs={shot.durationMs}
                      editable={!layer.locked && !productPreviewOpen && time !== 0}
                      instanceId={instanceId}
                      layerId={layer.id}
                      partId={part.partId}
                      partName={part.name}
                      pixelsPerMs={pixelsPerMs}
                      selected={selected && selectedKeyTimes.includes(time)}
                      selectedTimesMs={selected ? selectedKeyTimes : []}
                      shotId={shot.id}
                      showDragBubble={activeDragPreview?.anchorTimeMs === time}
                      snapshot={snapshot}
                      timeMs={time}
                      onActivate={activateKey}
                      onDragPreview={setDragPreview}
                      onError={setError}
                      onRetime={retimeSelectedKeys}
                      onSelectPart={selectPart}
                    />
                  ))}
                </div>
              </div>
            );
          })
        : null}
      {error ? (
        <PositionLaneErrorNotice message={error} onDismiss={() => setError(null)} />
      ) : null}
    </>
  );
}

interface CharacterMotionKeyMarkerProps {
  allPartTimes: readonly number[];
  current: boolean;
  dragPreviewTimeMs: number | null;
  durationMs: number;
  editable: boolean;
  instanceId: number | null;
  layerId: string;
  partId: string;
  partName: string;
  pixelsPerMs: number;
  selected: boolean;
  selectedTimesMs: readonly number[];
  shotId: string;
  showDragBubble: boolean;
  snapshot: EditorProjectSnapshot | null;
  timeMs: number;
  onActivate(partId: string, timeMs: number, shiftKey?: boolean): void;
  onDragPreview(preview: KeyGroupDragPreview | null): void;
  onError(message: string): void;
  onRetime(partId: string, nextTimesMs: readonly number[], anchorTimeMs: number): void;
  onSelectPart(partId: string): void;
}

function CharacterMotionKeyMarker({
  allPartTimes,
  current,
  dragPreviewTimeMs,
  durationMs,
  editable,
  instanceId,
  layerId,
  partId,
  partName,
  pixelsPerMs,
  selected,
  selectedTimesMs,
  shotId,
  showDragBubble,
  snapshot,
  timeMs,
  onActivate,
  onDragPreview,
  onError,
  onRetime,
  onSelectPart,
}: CharacterMotionKeyMarkerProps): React.JSX.Element {
  const dragRef = useRef<KeyDragSession | null>(null);
  const suppressClickRef = useRef(false);
  const displayTime = dragPreviewTimeMs ?? timeMs;

  const cancelDrag = (): void => {
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
      drag &&
      (drag.snapshot !== snapshot ||
        drag.instanceId !== instanceId ||
        !editable ||
        shotStore.getCurrentShotId() !== shotId ||
        selectionStore.getSelectedLayerId() !== layerId)
    ) {
      cancelDrag();
    }
  }, [editable, instanceId, layerId, shotId, snapshot]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    event.stopPropagation();
    if (event.button !== 0) return;
    onSelectPart(partId);
    if (event.shiftKey) return;
    const dragGroup =
      selected && selectedTimesMs.includes(timeMs) ? selectedTimesMs : [timeMs];
    if (timeMs === 0 || !editable) return;
    const blockedBase = dragGroup.includes(0);
    if (
      !snapshot ||
      !isCurrentCharacterMotionContext({
        snapshot,
        instanceId,
        shotId,
        layerId,
        partId,
        requireSelectedPart: false,
        keyTimesMs: dragGroup,
      })
    ) {
      onError('动作关键帧已变化，请重新选择后再操作。');
      return;
    }
    const unselectedTimesMs = allPartTimes.filter((candidate) => !dragGroup.includes(candidate));
    const initialMap = new Map(dragGroup.map((candidate) => [candidate, candidate]));
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      fromTimesMs: dragGroup,
      unselectedTimesMs,
      anchorTimeMs: timeMs,
      deltaFrames: 0,
      anchorPreviewTimeMs: timeMs,
      previewTimesByOrigin: initialMap,
      blockedBase,
      moved: false,
      snapshot,
      instanceId,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    event.stopPropagation();
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaPx = event.clientX - drag.startX;
    if (!drag.moved && Math.abs(deltaPx) < 3) return;
    drag.moved = true;
    if (drag.blockedBase) return;
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
    drag.previewTimesByOrigin = preview.previewTimesByOrigin;
    onDragPreview({
      partId,
      anchorTimeMs: drag.anchorTimeMs,
      previewTimesByOrigin: preview.previewTimesByOrigin,
    });
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    event.stopPropagation();
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
    if (drag.blockedBase) {
      onError('0 秒基础姿势关键帧不可移动，请取消选中后再移动其他关键帧。');
      return;
    }
    if (
      !isCurrentCharacterMotionContext({
        snapshot: drag.snapshot,
        instanceId: drag.instanceId,
        shotId,
        layerId,
        partId,
        keyTimesMs: drag.fromTimesMs,
      })
    ) {
      onError('动作关键帧已变化，请重新选择后再操作。');
      return;
    }
    if (drag.deltaFrames === 0) return;
    try {
      if (drag.fromTimesMs.length === 1) {
        const next = motionService.retimeCompositeKey(drag.snapshot.project, {
          shotId,
          layerId,
          partId,
          fromTimeMs: drag.fromTimesMs[0]!,
          toTimeMs: drag.anchorPreviewTimeMs,
        });
        if (next !== drag.snapshot.project) {
          editorProjectStore.updateProject(next, '调整动作关键帧时间');
        }
        onRetime(partId, [drag.anchorPreviewTimeMs], drag.anchorPreviewTimeMs);
        return;
      }
      const next = motionService.retimeCompositeKeys(drag.snapshot.project, {
        shotId,
        layerId,
        partId,
        fromTimesMs: drag.fromTimesMs,
        deltaFrames: drag.deltaFrames,
      });
      if (next !== drag.snapshot.project) {
        editorProjectStore.updateProject(next, '批量调整动作关键帧时间');
      }
      const movedTimes = drag.fromTimesMs.map(
        (origin) => drag.previewTimesByOrigin.get(origin) ?? origin,
      );
      onRetime(partId, movedTimes, drag.anchorPreviewTimeMs);
    } catch (operationError) {
      onError(errorText(operationError));
    }
  };

  const handleCancel = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    event.stopPropagation();
    if (dragRef.current?.pointerId === event.pointerId) cancelDrag();
  };

  return (
    <>
      <button
        type="button"
        data-time-ms={timeMs}
        data-part-id={partId}
        data-selected={selected ? 'true' : 'false'}
        data-current={current ? 'true' : 'false'}
        data-dragging={dragPreviewTimeMs === null ? 'false' : 'true'}
        aria-label={`${partName} 动作关键帧 ${timeMs}ms`}
        aria-pressed={selected}
        aria-current={current ? 'true' : undefined}
        style={{ left: displayTime * pixelsPerMs }}
        title={`${formatTimecode(timeMs)}${timeMs === 0 ? ' · 基础姿势' : ''}`}
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
          onActivate(partId, timeMs, event.shiftKey);
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
