import { ChevronDown, ChevronRight } from 'lucide-react';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  characterCompositeKeyEasing,
  characterCompositeKeyTimes,
  CharacterMotionService,
  characterMotionValues,
  frameTimeMs,
  hasAuthoredCharacterPartMotion,
  hasCompositeKeyOutgoingInterval,
  isValidFrameTime,
  lastValidFrameTime,
  TIMELINE_FPS,
  type AnimationInterpolation,
  type CharacterMotionValues,
  type Project,
  type Shot,
} from '../../../domain';
import {
  editorProjectStore,
  type EditorProjectSnapshot,
} from '../../stores/EditorProjectStore';
import { selectionStore } from '../../stores/selectionStore';
import { shotStore } from '../../stores/shotStore';
import { characterMotionParts } from '../canvas/characterMotionContext';
import { resolveNearestCharacterMotionKey } from './characterMotionKeyGesture';
import {
  MotionKeyToolbar,
  MotionKeyTrackStrip,
  type MotionKeyDragPreview,
} from './MotionKeyLaneControl';
import { PositionLaneErrorNotice } from './PositionLane';
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
  if (!characterMotionParts(snapshot.project, layer).some((part) => part.partId === partId)) {
    return false;
  }
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
  const snapshot = useSyncExternalStore(
    editorProjectStore.subscribe,
    editorProjectStore.getSnapshot,
  );
  const instanceId = editorProjectStore.getProjectInstanceId();
  const partId = useSyncExternalStore(
    selectionStore.subscribe,
    selectionStore.getSelectedCharacterPartId,
  );
  const revealNonce = useSyncExternalStore(
    timelineUiStore.subscribe,
    () => timelineUiStore.getSnapshot().characterMotionRevealNonce,
  );
  const [groupExpanded, setGroupExpanded] = useState(true);
  const [selectedKey, setSelectedKey] = useState<{ partId: string; timesMs: number[] } | null>(
    null,
  );
  const [dragPreview, setDragPreview] = useState<MotionKeyDragPreview | null>(null);
  const [protectedCuePartId, setProtectedCuePartId] = useState<string | null>(null);
  const [clipboard, setClipboard] = useState<PoseClipboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selectedRowRef = useRef<HTMLDivElement>(null);
  const lastFocusedKeyRef = useRef<string | null>(null);
  const prevPartIdRef = useRef(partId);
  const prevRevealNonceRef = useRef(revealNonce);
  const overviewTouchSessionRef = useRef<{ pointerId: number; ownerTimeMs: number } | null>(null);
  const suppressOverviewClickRef = useRef(false);
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
    setProtectedCuePartId(null);
    overviewTouchSessionRef.current = null;
    suppressOverviewClickRef.current = false;
    setClipboard(null);
    setError(null);
  }, [instanceId, project.id, snapshot?.projectRoot, shot.id, layer?.id, partId]);

  useEffect(() => {
    if (!protectedCuePartId) return undefined;
    const timer = window.setTimeout(() => setProtectedCuePartId(null), 900);
    return () => window.clearTimeout(timer);
  }, [protectedCuePartId]);

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
      <MotionKeyToolbar
        ariaLabel="动作关键帧操作"
        canCopy={singleSelectedKeyTime !== null}
        canDelete={singleSelectedKeyTime !== null && singleSelectedKeyTime !== 0}
        canPaste={Boolean(clipboardMatches && validPasteTime)}
        followingKeyTime={followingKeyTime}
        hasOutgoingInterval={hasOutgoingInterval}
        previousKeyTime={previousKeyTime}
        selectedCount={selectedKeyTimes.length}
        selectedEasing={selectedEasing}
        singleSelectedKeyTime={singleSelectedKeyTime}
        testIdPrefix="character-motion"
        toolbarHost={toolbarHost}
        toolbarTestId="character-motion-toolbar"
        visible={Boolean(activePart && !layer.locked && !productPreviewOpen)}
        onCopyPose={copySelectedPose}
        onDeleteKey={deleteSelectedKey}
        onPastePose={pasteAtPlayhead}
        onSeekKey={(timeMs) => {
          if (activePart) activateKey(activePart.partId, timeMs);
        }}
        onSetEasing={setEasing}
      />

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
          onPointerDownCapture={(event) => {
            if (event.pointerType !== 'touch' || event.button !== 0) return;
            const nearestTime = resolveNearestCharacterMotionKey({
              pointerX: event.clientX,
              trackLeft: event.currentTarget.getBoundingClientRect().left,
              pixelsPerMs,
              timesMs: overviewTimes,
            });
            if (nearestTime === null) return;
            event.stopPropagation();
            if (overviewTouchSessionRef.current) return;
            overviewTouchSessionRef.current = {
              pointerId: event.pointerId,
              ownerTimeMs: nearestTime,
            };
            event.currentTarget.setPointerCapture?.(event.pointerId);
          }}
          onPointerUpCapture={(event) => {
            const session = overviewTouchSessionRef.current;
            if (!session || session.pointerId !== event.pointerId) return;
            event.stopPropagation();
            overviewTouchSessionRef.current = null;
            if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
            suppressOverviewClickRef.current = true;
            window.setTimeout(() => {
              suppressOverviewClickRef.current = false;
            }, 0);
            timelineUiStore.seek(session.ownerTimeMs, shot.durationMs);
          }}
          onPointerCancelCapture={(event) => {
            if (overviewTouchSessionRef.current?.pointerId === event.pointerId) {
              overviewTouchSessionRef.current = null;
            }
          }}
          onLostPointerCapture={(event) => {
            if (overviewTouchSessionRef.current?.pointerId === event.pointerId) {
              overviewTouchSessionRef.current = null;
            }
          }}
          onClickCapture={(event) => {
            if (!suppressOverviewClickRef.current) return;
            event.stopPropagation();
            suppressOverviewClickRef.current = false;
          }}
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
                <MotionKeyTrackStrip
                  currentTimeMs={currentTimeMs}
                  dragPreview={dragPreview}
                  durationMs={shot.durationMs}
                  editable={!layer.locked && !productPreviewOpen}
                  isContextCurrent={(requiredTimesMs) =>
                    isCurrentCharacterMotionContext({
                      snapshot,
                      instanceId,
                      shotId: shot.id,
                      layerId: layer.id,
                      partId: part.partId,
                      requireSelectedPart: false,
                      keyTimesMs: requiredTimesMs,
                    })
                  }
                  label={part.name}
                  markerAriaLabel={(timeMs) => `${part.name} 动作关键帧 ${timeMs}ms`}
                  markerDataAttributes={() => ({ 'data-part-id': part.partId })}
                  pixelsPerMs={pixelsPerMs}
                  protectedCue={protectedCuePartId === part.partId}
                  rowId={part.partId}
                  selectedTimesMs={selected ? selectedKeyTimes : []}
                  staleErrorMessage="动作关键帧已变化，请重新选择后再操作。"
                  timesMs={times}
                  trackWidth={trackWidth}
                  onActivateKey={(timeMs, shiftKey) =>
                    activateKey(part.partId, timeMs, shiftKey)
                  }
                  onBlockedBaseDrag={() => {
                    setError('基础姿势不能批量移动');
                    setProtectedCuePartId(part.partId);
                  }}
                  onCommitRetime={(fromTimesMs, deltaFrames, anchorNext) => {
                    if (!snapshot) {
                      reportStale();
                      return;
                    }
                    try {
                      setError(null);
                      if (fromTimesMs.length === 1) {
                        const next = motionService.retimeCompositeKey(snapshot.project, {
                          shotId: shot.id,
                          layerId: layer.id,
                          partId: part.partId,
                          fromTimeMs: fromTimesMs[0]!,
                          toTimeMs: anchorNext,
                        });
                        if (next !== snapshot.project) {
                          editorProjectStore.updateProject(next, '调整动作关键帧时间');
                        }
                        setSelectedKey({ partId: part.partId, timesMs: [anchorNext] });
                        timelineUiStore.seek(anchorNext, shot.durationMs);
                        return;
                      }
                      const next = motionService.retimeCompositeKeys(snapshot.project, {
                        shotId: shot.id,
                        layerId: layer.id,
                        partId: part.partId,
                        fromTimesMs,
                        deltaFrames,
                      });
                      if (next !== snapshot.project) {
                        editorProjectStore.updateProject(next, '批量调整动作关键帧时间');
                      }
                      const movedTimes = fromTimesMs
                        .map((origin) =>
                          frameTimeMs(
                            Math.round((origin * TIMELINE_FPS) / 1_000) + deltaFrames,
                          ),
                        )
                        .sort((left, right) => left - right);
                      setSelectedKey({ partId: part.partId, timesMs: movedTimes });
                      timelineUiStore.seek(anchorNext, shot.durationMs);
                    } catch (operationError) {
                      setError(errorText(operationError));
                    }
                  }}
                  onDragPreview={setDragPreview}
                  onError={setError}
                  onPointerDownKeyArea={() => selectPart(part.partId)}
                />
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
