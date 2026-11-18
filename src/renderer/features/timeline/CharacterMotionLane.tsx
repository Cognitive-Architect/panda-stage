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
  characterNodeCompositeKeyEasing,
  characterNodeCompositeKeyTimes,
  CharacterNodeMotionService,
  characterNodeMotionValues,
  deleteMouthCueEvent,
  frameTimeMs,
  hasAuthoredCharacterPartMotion,
  hasCharacterNodeCompositeKeyOutgoingInterval,
  hasCompositeKeyOutgoingInterval,
  isValidFrameTime,
  lastValidFrameTime,
  TIMELINE_FPS,
  type AnimationInterpolation,
  type CharacterMotionValues,
  type CharacterNodeId,
  type Layer,
  type MouthCueEvent,
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
import {
  adaptivePartIdForNodeId,
  resolveCharacterView,
  type CharacterNode,
} from '../characters/characterView';
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

type MotionLaneKind = 'v1' | 'v3';

interface MotionTargetAdapter {
  readonly kind: MotionLaneKind;
  readonly undoLabels: {
    readonly paste: string;
    readonly delete: string;
    readonly retimeSingle: string;
    readonly retimeBatch: string;
    readonly easing: string;
  };
  keyTimes(layer: Layer, targetId: string): number[];
  hasOutgoingInterval(layer: Layer, targetId: string, timeMs: number): boolean;
  easing(layer: Layer, targetId: string, timeMs: number): AnimationInterpolation | null;
  readPose(project: Project, shotId: string, layerId: string, targetId: string, timeMs: number): CharacterMotionValues;
  deleteKey(project: Project, input: { shotId: string; layerId: string; targetId: string; timeMs: number }): Project;
  retimeKey(project: Project, input: { shotId: string; layerId: string; targetId: string; fromTimeMs: number; toTimeMs: number }): Project;
  retimeKeys(project: Project, input: { shotId: string; layerId: string; targetId: string; fromTimesMs: readonly number[]; deltaFrames: number }): Project;
  pastePose(project: Project, input: { shotId: string; layerId: string; targetId: string; targetTimeMs: number; pose: CharacterMotionValues }): Project;
  setEasing(project: Project, input: { shotId: string; layerId: string; targetId: string; timeMs: number; interpolationToNext: AnimationInterpolation }): Project;
  hasTarget(project: Project, layer: Layer, targetId: string): boolean;
  isSelected(targetId: string): boolean;
  select(targetId: string): void;
}

const motionService = new CharacterMotionService();
const nodeMotionService = new CharacterNodeMotionService();

const ADAPTERS: Record<MotionLaneKind, MotionTargetAdapter> = {
  v1: {
    kind: 'v1',
    undoLabels: {
      paste: '粘贴部件姿势',
      delete: '删除动作关键帧',
      retimeSingle: '调整动作关键帧时间',
      retimeBatch: '批量调整动作关键帧时间',
      easing: '修改动作关键帧补间',
    },
    keyTimes: (layer, targetId) => characterCompositeKeyTimes(layer, targetId),
    hasOutgoingInterval: (layer, targetId, timeMs) =>
      hasCompositeKeyOutgoingInterval(layer, targetId, timeMs),
    easing: (layer, targetId, timeMs) =>
      characterCompositeKeyEasing(layer, targetId, timeMs),
    readPose: (project, shotId, layerId, targetId, timeMs) =>
      characterMotionValues(project, {
        shotId,
        layerId,
        partId: targetId,
        timeMs,
        autoKey: true,
      }),
    deleteKey: (project, { shotId, layerId, targetId, timeMs }) =>
      motionService.deleteCompositeKey(project, { shotId, layerId, partId: targetId, timeMs }),
    retimeKey: (project, { shotId, layerId, targetId, fromTimeMs, toTimeMs }) =>
      motionService.retimeCompositeKey(project, {
        shotId,
        layerId,
        partId: targetId,
        fromTimeMs,
        toTimeMs,
      }),
    retimeKeys: (project, { shotId, layerId, targetId, fromTimesMs, deltaFrames }) =>
      motionService.retimeCompositeKeys(project, {
        shotId,
        layerId,
        partId: targetId,
        fromTimesMs,
        deltaFrames,
      }),
    pastePose: (project, { shotId, layerId, targetId, targetTimeMs, pose }) =>
      motionService.pasteCompositePose(project, {
        shotId,
        layerId,
        partId: targetId,
        targetTimeMs,
        pose,
      }),
    setEasing: (project, { shotId, layerId, targetId, timeMs, interpolationToNext }) =>
      motionService.setCompositeKeyEasing(project, {
        shotId,
        layerId,
        partId: targetId,
        timeMs,
        interpolationToNext,
      }),
    hasTarget: (project, layer, targetId) =>
      characterMotionParts(project, layer).some((part) => part.partId === targetId),
    isSelected: (targetId) => selectionStore.getSelectedCharacterPartId() === targetId,
    select: (targetId) => selectionStore.selectCharacterPart(targetId),
  },
  v3: {
    kind: 'v3',
    undoLabels: {
      paste: '粘贴脸部姿势',
      delete: '删除脸部动作关键帧',
      retimeSingle: '调整脸部关键帧时间',
      retimeBatch: '批量调整脸部关键帧时间',
      easing: '修改脸部关键帧补间',
    },
    keyTimes: (layer, targetId) =>
      characterNodeCompositeKeyTimes(layer, targetId as CharacterNodeId),
    hasOutgoingInterval: (layer, targetId, timeMs) =>
      hasCharacterNodeCompositeKeyOutgoingInterval(layer, targetId as CharacterNodeId, timeMs),
    easing: (layer, targetId, timeMs) =>
      characterNodeCompositeKeyEasing(layer, targetId as CharacterNodeId, timeMs),
    readPose: (project, shotId, layerId, targetId, timeMs) =>
      characterNodeMotionValues(project, {
        shotId,
        layerId,
        nodeId: targetId as CharacterNodeId,
        timeMs,
        autoKey: true,
      }),
    deleteKey: (project, { shotId, layerId, targetId, timeMs }) =>
      nodeMotionService.deleteCompositeKey(project, {
        shotId,
        layerId,
        nodeId: targetId as CharacterNodeId,
        timeMs,
      }),
    retimeKey: (project, { shotId, layerId, targetId, fromTimeMs, toTimeMs }) =>
      nodeMotionService.retimeCompositeKey(project, {
        shotId,
        layerId,
        nodeId: targetId as CharacterNodeId,
        fromTimeMs,
        toTimeMs,
      }),
    retimeKeys: (project, { shotId, layerId, targetId, fromTimesMs, deltaFrames }) =>
      nodeMotionService.retimeCompositeKeys(project, {
        shotId,
        layerId,
        nodeId: targetId as CharacterNodeId,
        fromTimesMs,
        deltaFrames,
      }),
    pastePose: (project, { shotId, layerId, targetId, targetTimeMs, pose }) =>
      nodeMotionService.pasteCompositePose(project, {
        shotId,
        layerId,
        nodeId: targetId as CharacterNodeId,
        targetTimeMs,
        pose,
      }),
    setEasing: (project, { shotId, layerId, targetId, timeMs, interpolationToNext }) =>
      nodeMotionService.setCompositeKeyEasing(project, {
        shotId,
        layerId,
        nodeId: targetId as CharacterNodeId,
        timeMs,
        interpolationToNext,
      }),
    hasTarget: (project, layer, targetId) =>
      Boolean(
        resolveCharacterView(project, layer)?.nodes.some(
          (node) => node.id === targetId && node.motion === 'character-clip-v3',
        ),
      ),
    isSelected: (targetId) => selectionStore.getSelectedCharacterNodeId() === targetId,
    select: (targetId) => selectionStore.selectCharacterNode(targetId as CharacterNodeId),
  },
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : '动作关键帧操作失败，请重试。';
}

function isCurrentCharacterMotionContext(input: {
  adapter: MotionTargetAdapter;
  snapshot: EditorProjectSnapshot | null;
  instanceId: number | null;
  shotId: string;
  layerId: string;
  targetId: string;
  requireSelectedTarget?: boolean;
  keyTimeMs?: number;
  keyTimesMs?: readonly number[];
}): input is typeof input & { snapshot: EditorProjectSnapshot } {
  const {
    adapter,
    snapshot,
    instanceId,
    shotId,
    layerId,
    targetId,
    requireSelectedTarget = true,
    keyTimeMs,
    keyTimesMs,
  } = input;
  if (
    !snapshot ||
    editorProjectStore.getSnapshot() !== snapshot ||
    editorProjectStore.getProjectInstanceId() !== instanceId ||
    shotStore.getCurrentShotId() !== shotId ||
    selectionStore.getSelectedLayerId() !== layerId ||
    (requireSelectedTarget && !adapter.isSelected(targetId))
  ) {
    return false;
  }
  const shot = snapshot.project.shots.find((candidate) => candidate.id === shotId);
  const layer = shot?.layers.find((candidate) => candidate.id === layerId);
  if (!layer || layer.locked || layer.source.kind !== 'character') return false;
  if (!adapter.hasTarget(snapshot.project, layer, targetId)) {
    return false;
  }
  const timesToCheck = keyTimesMs ?? (keyTimeMs === undefined ? null : [keyTimeMs]);
  if (!timesToCheck) return true;
  const currentTimes = adapter.keyTimes(layer, targetId);
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
  const nodeId = useSyncExternalStore(selectionStore.subscribe, selectionStore.getSelectedCharacterNodeId);
  const partId = adaptivePartIdForNodeId(nodeId);
  const revealNonce = useSyncExternalStore(
    timelineUiStore.subscribe,
    () => timelineUiStore.getSnapshot().characterMotionRevealNonce,
  );
  const [groupExpanded, setGroupExpanded] = useState(true);
  const [selectedKey, setSelectedKey] = useState<{ targetId: string; timesMs: number[] } | null>(
    null,
  );
  const [dragPreview, setDragPreview] = useState<MotionKeyDragPreview | null>(null);
  const [protectedCueTargetId, setProtectedCueTargetId] = useState<string | null>(null);
  const [clipboard, setClipboard] = useState<PoseClipboard | null>(null);
  const [selectedMouthCueId, setSelectedMouthCueId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selectedRowRef = useRef<HTMLDivElement>(null);
  const lastFocusedKeyRef = useRef<string | null>(null);
  const prevNodeIdRef = useRef(nodeId);
  const prevRevealNonceRef = useRef(revealNonce);
  const overviewTouchSessionRef = useRef<{ pointerId: number; ownerTimeMs: number } | null>(null);
  const suppressOverviewClickRef = useRef(false);
  const layer = shot.layers.find((candidate) => candidate.id === layerId);
  const view = resolveCharacterView(project, layer);
  const allParts = view?.nodes.filter((node) => node.motion === 'character-clip-v1') ?? [];
  const motionSemanticNodes = view?.nodes.filter((node) => node.motion === 'character-clip-v3') ?? [];
  const laneMode: MotionLaneKind | null =
    allParts.length > 0 ? 'v1' : motionSemanticNodes.length > 0 ? 'v3' : null;
  const activeTargetId =
    allParts.length > 0
      ? partId
      : motionSemanticNodes.some((node) => node.id === nodeId)
        ? nodeId
        : null;

  const scopeKey = JSON.stringify([
    instanceId,
    project.id,
    snapshot?.projectRoot ?? '',
    shot.id,
    layer?.id ?? '',
    activeTargetId ?? '',
  ]);

  useEffect(() => {
    setGroupExpanded(true);
    lastFocusedKeyRef.current = null;
  }, [shot.id, layer?.id]);

  useEffect(() => {
    setSelectedKey((current) => (current?.targetId === activeTargetId ? current : null));
    setDragPreview(null);
    setProtectedCueTargetId(null);
    overviewTouchSessionRef.current = null;
    suppressOverviewClickRef.current = false;
    setClipboard(null);
    setSelectedMouthCueId(null);
    setError(null);
  }, [instanceId, project.id, snapshot?.projectRoot, shot.id, layer?.id, activeTargetId]);

  useEffect(() => {
    if (!protectedCueTargetId) return undefined;
    const timer = window.setTimeout(() => setProtectedCueTargetId(null), 900);
    return () => window.clearTimeout(timer);
  }, [protectedCueTargetId]);

  useLayoutEffect(() => {
    const nodeChanged = nodeId !== prevNodeIdRef.current;
    const revealed = revealNonce !== prevRevealNonceRef.current;
    prevNodeIdRef.current = nodeId;
    prevRevealNonceRef.current = revealNonce;
    if (!nodeId || !layer) {
      lastFocusedKeyRef.current = null;
      return;
    }
    if ((nodeChanged || revealed) && !groupExpanded) {
      lastFocusedKeyRef.current = null;
      setGroupExpanded(true);
      return;
    }
    if (!groupExpanded) {
      lastFocusedKeyRef.current = null;
      return;
    }
    const focusKey = `${shot.id}:${layer.id}:${nodeId}`;
    if (!revealed && lastFocusedKeyRef.current === focusKey) return;
    lastFocusedKeyRef.current = focusKey;
    focusSelectedPartRow(selectedRowRef.current);
  }, [groupExpanded, layer, nodeId, revealNonce, shot.id]);

  if (!layer || !view?.nodes.length) return null;

  const mouthCueEvents = shot.timelineEvents
    .filter(
      (event): event is MouthCueEvent =>
        event.type === 'mouth-cue' &&
        event.layerId === layer.id &&
        event.startMs <= shot.durationMs,
    )
    .sort((left, right) => left.startMs - right.startMs || left.id.localeCompare(right.id));

  const reportStale = (): void => {
    setError('动作关键帧或工程状态已变化，请重新选择后再操作。');
  };

  const deleteMouthCue = (eventId: string): void => {
    if (!snapshot || editorProjectStore.getSnapshot() !== snapshot) {
      reportStale();
      return;
    }
    try {
      setError(null);
      const next = deleteMouthCueEvent(snapshot.project, shot.id, layer.id, eventId);
      if (next !== snapshot.project) {
        editorProjectStore.updateProject(next, '删除角色嘴型');
      }
      setSelectedMouthCueId((current) => (current === eventId ? null : current));
    } catch (operationError) {
      setError(errorText(operationError));
    }
  };

  const mouthCueLane =
    laneMode !== 'v1' && mouthCueEvents.length > 0 ? (
      <div
        aria-label="嘴型关键帧"
        className="timeline-lane character-motion-lane mouth-cue-lane"
        data-layer-id={layer.id}
        data-testid="mouth-cue-lane"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          setSelectedMouthCueId(null);
        }}
      >
        <span className="timeline-lane-label" title="嘴型">
          <span className="timeline-lane-label-text">嘴型</span>
        </span>
        <div
          className="timeline-lane-content mouth-cue-track"
          style={{ width: `${trackWidth}px` }}
        >
          {mouthCueEvents.map((cue) => {
            const cueSelected = selectedMouthCueId === cue.id;
            const stateLabel = cue.state === 'open' ? '张开' : '闭合';
            return (
              <div
                key={cue.id}
                className="mouth-cue-marker-group"
                style={{ left: `${cue.startMs * pixelsPerMs}px` }}
              >
                <button
                  type="button"
                  aria-current={cue.startMs === currentTimeMs ? 'true' : undefined}
                  aria-label={`嘴型 ${stateLabel} ${cue.startMs}ms`}
                  aria-pressed={cueSelected}
                  className="mouth-cue-timeline-marker"
                  data-mouth-cue-id={cue.id}
                  data-mouth-cue-state={cue.state}
                  data-selected={cueSelected ? 'true' : 'false'}
                  data-testid="mouth-cue-timeline-marker"
                  data-time-ms={cue.startMs}
                  title={`${cue.startMs}ms · 嘴型${stateLabel}`}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectedMouthCueId(cue.id);
                    timelineUiStore.seek(cue.startMs, shot.durationMs);
                  }}
                  onKeyDown={(event) => {
                    if (
                      !layer.locked &&
                      !productPreviewOpen &&
                      (event.key === 'Delete' || event.key === 'Backspace')
                    ) {
                      event.preventDefault();
                      event.stopPropagation();
                      deleteMouthCue(cue.id);
                    }
                  }}
                >
                  <span aria-hidden="true">{cue.state === 'open' ? '○' : '—'}</span>
                </button>
                {cueSelected && !layer.locked && !productPreviewOpen ? (
                  <button
                    type="button"
                    aria-label={`删除 ${cue.startMs}ms 嘴型${stateLabel}`}
                    className="mouth-cue-timeline-delete"
                    data-mouth-cue-id={cue.id}
                    data-testid="mouth-cue-timeline-delete"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      deleteMouthCue(cue.id);
                    }}
                  >
                    ×
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    ) : null;

  if (!laneMode) {
    return (
      <>
        {view.nodes.map((node) => {
          const selected = node.id === nodeId;
          const select = () => selectionStore.selectCharacterNode(node.id);
          return (
            <div
              key={node.id}
              ref={selected ? selectedRowRef : undefined}
              className="timeline-lane character-motion-lane"
              data-testid="character-node-lane"
              data-character-node-id={node.id}
              data-selected-part={selected}
              onPointerDown={(event) => { event.stopPropagation(); select(); }}
              onClick={(event) => { event.stopPropagation(); select(); }}
            >
              <span className="timeline-lane-label">
                <button className="character-motion-part-select" type="button" aria-pressed={selected}>
                  <span className="timeline-lane-label-text">{node.name}</span>
                </button>
              </span>
              <div className="timeline-lane-content" style={{ width: `${trackWidth}px` }} />
            </div>
          );
        })}
        {mouthCueLane}
        {error ? (
          <PositionLaneErrorNotice message={error} onDismiss={() => setError(null)} />
        ) : null}
      </>
    );
  }

  const adapter = ADAPTERS[laneMode];
  const authoredPartIds =
    laneMode === 'v1'
      ? new Set(
          allParts
            .filter((part) => hasAuthoredCharacterPartMotion(layer, part.partId))
            .map((part) => part.partId),
        )
      : new Set<string>();
  const visibleParts =
    laneMode === 'v1'
      ? allParts.filter((part) => part.partId === partId || authoredPartIds.has(part.partId))
      : [];
  if (laneMode === 'v1' && visibleParts.length === 0) return null;

  const activeTarget =
    laneMode === 'v1'
      ? activeTargetId && visibleParts.some((part) => part.partId === activeTargetId)
        ? activeTargetId
        : null
      : activeTargetId && motionSemanticNodes.some((node) => node.id === activeTargetId)
        ? activeTargetId
        : null;

  const overviewTimes =
    laneMode === 'v1'
      ? [
          ...new Set(
            visibleParts
              .filter((part) => authoredPartIds.has(part.partId))
              .flatMap((part) =>
                adapter.keyTimes(layer, part.partId).filter((time) => time <= shot.durationMs),
              ),
          ),
        ].sort((left, right) => left - right)
      : [];

  const activeTimes = activeTarget
    ? adapter.keyTimes(layer, activeTarget).filter((time) => time <= shot.durationMs)
    : [];
  const selectedKeyTimes =
    activeTarget && selectedKey?.targetId === activeTarget
      ? selectedKey.timesMs
          .filter((time) => activeTimes.includes(time))
          .sort((left, right) => left - right)
      : [];
  const singleSelectedKeyTime =
    selectedKeyTimes.length === 1 ? selectedKeyTimes[0]! : null;
  const previousAnchor = selectedKeyTimes[0];
  const followingAnchor = selectedKeyTimes[selectedKeyTimes.length - 1];
  const previousKeyTime =
    previousAnchor !== undefined
      ? [...activeTimes].reverse().find((time) => time < previousAnchor)
      : [...activeTimes].reverse().find((time) => time < currentTimeMs);
  const followingKeyTime =
    followingAnchor !== undefined
      ? activeTimes.find((time) => time > followingAnchor)
      : activeTimes.find((time) => time > currentTimeMs);
  const hasOutgoingInterval = Boolean(
    activeTarget &&
      singleSelectedKeyTime !== null &&
      adapter.hasOutgoingInterval(layer, activeTarget, singleSelectedKeyTime),
  );
  const selectedEasing =
    hasOutgoingInterval && activeTarget && singleSelectedKeyTime !== null
      ? adapter.easing(layer, activeTarget, singleSelectedKeyTime)
      : null;
  const clipboardMatches = clipboard?.scope === scopeKey;
  const validPasteTime =
    shot.durationMs > 0 &&
    isValidFrameTime(currentTimeMs) &&
    currentTimeMs <= lastValidFrameTime(shot.durationMs);

  const selectTarget = (targetKey: string): void => {
    if (selectionStore.getSelectedLayerId() !== layer.id) {
      selectionStore.select(layer.id);
    }
    adapter.select(targetKey);
  };

  const activateKey = (targetKey: string, timeMs: number, shiftKey = false): void => {
    setError(null);
    selectTarget(targetKey);
    if (!shiftKey) {
      setSelectedKey({ targetId: targetKey, timesMs: [timeMs] });
      timelineUiStore.seek(timeMs, shot.durationMs);
      return;
    }
    setSelectedKey((current) => {
      if (!current || current.targetId !== targetKey) {
        return { targetId: targetKey, timesMs: [timeMs] };
      }
      const nextTimes = current.timesMs.includes(timeMs)
        ? current.timesMs.filter((candidate) => candidate !== timeMs)
        : [...current.timesMs, timeMs].sort((left, right) => left - right);
      return nextTimes.length > 0 ? { targetId: targetKey, timesMs: nextTimes } : null;
    });
  };

  const copySelectedPose = (): void => {
    if (!activeTarget || singleSelectedKeyTime === null) return;
    try {
      setError(null);
      const pose = adapter.readPose(project, shot.id, layer.id, activeTarget, singleSelectedKeyTime);
      setClipboard({ scope: scopeKey, sourceTimeMs: singleSelectedKeyTime, pose });
    } catch (operationError) {
      setError(errorText(operationError));
    }
  };

  const pasteAtPlayhead = (): void => {
    if (!activeTarget || !clipboardMatches || !clipboard) return;
    if (!validPasteTime) {
      setError('请先将播放头移到镜头内的有效帧。');
      return;
    }
    if (
      !snapshot ||
      !isCurrentCharacterMotionContext({
        adapter,
        snapshot,
        instanceId,
        shotId: shot.id,
        layerId: layer.id,
        targetId: activeTarget,
      })
    ) {
      reportStale();
      return;
    }
    try {
      setError(null);
      const next = adapter.pastePose(snapshot.project, {
        shotId: shot.id,
        layerId: layer.id,
        targetId: activeTarget,
        targetTimeMs: currentTimeMs,
        pose: clipboard.pose,
      });
      if (next !== snapshot.project) {
        editorProjectStore.updateProject(next, adapter.undoLabels.paste);
      }
      setSelectedKey({ targetId: activeTarget, timesMs: [currentTimeMs] });
    } catch (operationError) {
      setError(errorText(operationError));
    }
  };

  const deleteSelectedKey = (): void => {
    if (!activeTarget || singleSelectedKeyTime === null || singleSelectedKeyTime === 0) return;
    if (
      !snapshot ||
      !isCurrentCharacterMotionContext({
        adapter,
        snapshot,
        instanceId,
        shotId: shot.id,
        layerId: layer.id,
        targetId: activeTarget,
        keyTimeMs: singleSelectedKeyTime,
      })
    ) {
      reportStale();
      return;
    }
    try {
      setError(null);
      const next = adapter.deleteKey(snapshot.project, {
        shotId: shot.id,
        layerId: layer.id,
        targetId: activeTarget,
        timeMs: singleSelectedKeyTime,
      });
      editorProjectStore.updateProject(next, adapter.undoLabels.delete);
      setSelectedKey(null);
    } catch (operationError) {
      setError(errorText(operationError));
    }
  };

  const setEasing = (interpolationToNext: AnimationInterpolation): void => {
    if (!activeTarget || singleSelectedKeyTime === null || !hasOutgoingInterval) return;
    if (
      !snapshot ||
      !isCurrentCharacterMotionContext({
        adapter,
        snapshot,
        instanceId,
        shotId: shot.id,
        layerId: layer.id,
        targetId: activeTarget,
        keyTimeMs: singleSelectedKeyTime,
      })
    ) {
      reportStale();
      return;
    }
    try {
      setError(null);
      const next = adapter.setEasing(snapshot.project, {
        shotId: shot.id,
        layerId: layer.id,
        targetId: activeTarget,
        timeMs: singleSelectedKeyTime,
        interpolationToNext,
      });
      if (next !== snapshot.project) {
        editorProjectStore.updateProject(next, adapter.undoLabels.easing);
      }
    } catch (operationError) {
      setError(errorText(operationError));
    }
  };

  const renderTrackStrip = (
    targetKey: string,
    targetLabel: string,
    selected: boolean,
    extraMarkerAttributes?: Record<string, string>,
  ) => {
    const times = adapter.keyTimes(layer, targetKey).filter((time) => time <= shot.durationMs);
    return (
      <MotionKeyTrackStrip
        currentTimeMs={currentTimeMs}
        dragPreview={dragPreview}
        durationMs={shot.durationMs}
        editable={!layer.locked && !productPreviewOpen}
        isContextCurrent={(requiredTimesMs) =>
          isCurrentCharacterMotionContext({
            adapter,
            snapshot,
            instanceId,
            shotId: shot.id,
            layerId: layer.id,
            targetId: targetKey,
            requireSelectedTarget: false,
            keyTimesMs: requiredTimesMs,
          })
        }
        label={targetLabel}
        markerAriaLabel={(timeMs) => `${targetLabel} 动作关键帧 ${timeMs}ms`}
        markerDataAttributes={() => ({ 'data-part-id': targetKey, ...extraMarkerAttributes })}
        pixelsPerMs={pixelsPerMs}
        protectedCue={protectedCueTargetId === targetKey}
        rowId={targetKey}
        selectedTimesMs={selected ? selectedKeyTimes : []}
        staleErrorMessage="动作关键帧已变化，请重新选择后再操作。"
        timesMs={times}
        trackWidth={trackWidth}
        onActivateKey={(timeMs, shiftKey) => activateKey(targetKey, timeMs, shiftKey)}
        onBlockedBaseDrag={() => {
          setError('基础姿势不能批量移动');
          setProtectedCueTargetId(targetKey);
        }}
        onCommitRetime={(fromTimesMs, deltaFrames, anchorNext) => {
          if (!snapshot) {
            reportStale();
            return;
          }
          try {
            setError(null);
            if (fromTimesMs.length === 1) {
              const next = adapter.retimeKey(snapshot.project, {
                shotId: shot.id,
                layerId: layer.id,
                targetId: targetKey,
                fromTimeMs: fromTimesMs[0]!,
                toTimeMs: anchorNext,
              });
              if (next !== snapshot.project) {
                editorProjectStore.updateProject(next, adapter.undoLabels.retimeSingle);
              }
              setSelectedKey({ targetId: targetKey, timesMs: [anchorNext] });
              timelineUiStore.seek(anchorNext, shot.durationMs);
              return;
            }
            const next = adapter.retimeKeys(snapshot.project, {
              shotId: shot.id,
              layerId: layer.id,
              targetId: targetKey,
              fromTimesMs,
              deltaFrames,
            });
            if (next !== snapshot.project) {
              editorProjectStore.updateProject(next, adapter.undoLabels.retimeBatch);
            }
            const movedTimes = fromTimesMs
              .map((origin) =>
                frameTimeMs(Math.round((origin * TIMELINE_FPS) / 1_000) + deltaFrames),
              )
              .sort((left, right) => left - right);
            setSelectedKey({ targetId: targetKey, timesMs: movedTimes });
            timelineUiStore.seek(anchorNext, shot.durationMs);
          } catch (operationError) {
            setError(errorText(operationError));
          }
        }}
        onDragPreview={setDragPreview}
        onError={setError}
        onPointerDownKeyArea={() => selectTarget(targetKey)}
      />
    );
  };

  const renderSemanticNodeRow = (node: CharacterNode) => {
    const selected = node.id === nodeId;
    const isMotionNode = node.motion === 'character-clip-v3';
    const onSelectRow = () => {
      selectionStore.selectCharacterNode(node.id);
      if (selected && isMotionNode) setSelectedKey(null);
    };
    return (
      <div
        key={node.id}
        ref={selected ? selectedRowRef : undefined}
        className="timeline-lane character-motion-lane"
        aria-label={isMotionNode ? `${node.name} 动作关键帧` : undefined}
        data-testid="character-node-lane"
        data-character-node-id={node.id}
        {...(isMotionNode ? { 'data-part-id': node.id } : {})}
        data-selected-part={selected ? 'true' : 'false'}
        onPointerDown={(event) => {
          event.stopPropagation();
          onSelectRow();
        }}
        onClick={(event) => {
          event.stopPropagation();
          onSelectRow();
        }}
      >
        <span className="timeline-lane-label" title={node.name}>
          <button
            className="character-motion-part-select"
            type="button"
            aria-pressed={selected}
            aria-label={isMotionNode ? node.name : undefined}
            onPointerDown={(event) => {
              if (!isMotionNode) return;
              event.stopPropagation();
              selectionStore.selectCharacterNode(node.id);
            }}
            onClick={(event) => {
              if (!isMotionNode) return;
              event.stopPropagation();
              selectionStore.selectCharacterNode(node.id);
            }}
          >
            <span className="timeline-lane-label-text">{node.name}</span>
          </button>
        </span>
        {isMotionNode
          ? renderTrackStrip(node.id, node.name, selected, { 'data-character-node-id': node.id })
          : <div className="timeline-lane-content" style={{ width: `${trackWidth}px` }} />}
      </div>
    );
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
        visible={Boolean(activeTarget && !layer.locked && !productPreviewOpen)}
        onCopyPose={copySelectedPose}
        onDeleteKey={deleteSelectedKey}
        onPastePose={pasteAtPlayhead}
        onSeekKey={(timeMs) => {
          if (activeTarget) activateKey(activeTarget, timeMs);
        }}
        onSetEasing={setEasing}
      />

      {laneMode === 'v3' ? (
        <>
          {view.nodes.map(renderSemanticNodeRow)}
          {mouthCueLane}
        </>
      ) : (
        <>
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
                      selectTarget(part.partId);
                      if (selected) setSelectedKey(null);
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      selectTarget(part.partId);
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
                          selectTarget(part.partId);
                        }}
                        onClick={(event) => {
                          event.stopPropagation();
                          selectTarget(part.partId);
                        }}
                      >
                        <span className="timeline-lane-label-text">{part.name}</span>
                      </button>
                    </span>
                    {renderTrackStrip(part.partId, part.name, selected)}
                  </div>
                );
              })
            : null}
        </>
      )}
      {error ? (
        <PositionLaneErrorNotice message={error} onDismiss={() => setError(null)} />
      ) : null}
    </>
  );
}
