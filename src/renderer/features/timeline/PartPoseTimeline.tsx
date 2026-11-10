import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  MoreHorizontal,
  Trash2,
} from 'lucide-react';
import {
  hasAuthoredPartPose,
  isValidFrameTime,
  lastValidFrameTime,
  resolveTimelineFrameTime,
  type AdaptivePartsCharacter,
  type PartPoseEasing,
  type PartPoseKeyframe,
  type PartPoseTrack,
  type Shot,
  type Layer,
} from '../../../domain';
import {
  canAddPartPoseKeyAtTime,
  getPartPosePartLabel,
  resolvePartPoseEditorParts,
  type PartPoseEditorUi,
} from '../part-pose/partPoseEditorTypes';
import type { EditorProjectSnapshot } from '../../stores/EditorProjectStore';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { layerStore } from '../../stores/layerStore';
import { selectionStore } from '../../stores/selectionStore';
import { shotStore } from '../../stores/shotStore';
import { IconButton } from '../../ui/Button';
import { formatTimecode, pxToTime, timeToPx } from './timeGeometry';
import { timelineUiStore } from './timelineUiStore';
import { PositionLaneErrorNotice } from './PositionLane';
import { previewPartPoseKeyTime } from './partPoseTimelineGesture';

export interface PartPoseTimelineProps {
  partPoseEditor: PartPoseEditorUi;
  toolbarHost: HTMLElement | null;
  shot: Shot;
  layer: Layer;
  snapshot: EditorProjectSnapshot;
  currentTimeMs: number;
  pixelsPerMs: number;
  trackWidth: number;
}

interface PartPoseClipboard {
  scope: string;
  sourceTimeMs: number;
  keyframe: PartPoseKeyframe;
}

interface PartPoseDragSession {
  pointerId: number;
  startX: number;
  previewTimeMs: number;
  moved: boolean;
  snapshot: EditorProjectSnapshot;
  instanceId: number | null;
}

function adaptiveCharacterForLayer(
  snapshot: EditorProjectSnapshot,
  layer: Layer,
): AdaptivePartsCharacter | null {
  if (layer.source.kind !== 'character') return null;
  const characterId = layer.source.characterId;
  const character = snapshot.project.characters.find(
    (candidate) => candidate.id === characterId,
  );
  return character?.mode === 'adaptive-parts' ? character : null;
}

function errorText(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Part 姿势关键帧操作失败，请重试。';
}

function isCurrentPartPoseEditorContext(input: {
  snapshot: EditorProjectSnapshot;
  instanceId: number | null;
  shotId: string;
  layerId: string;
  partId: string;
  partPoseEditor: PartPoseEditorUi;
}): boolean {
  const {
    snapshot,
    instanceId,
    shotId,
    layerId,
    partId,
    partPoseEditor,
  } = input;
  if (
    editorProjectStore.getSnapshot() !== snapshot ||
    editorProjectStore.getProjectInstanceId() !== instanceId ||
    shotStore.getCurrentShotId() !== shotId ||
    selectionStore.getSelectedLayerId() !== layerId
  ) {
    return false;
  }
  if (
    partPoseEditor.activeLayerId !== layerId ||
    partPoseEditor.selectedPartId !== partId
  ) {
    return false;
  }
  const shot = snapshot.project.shots.find((candidate) => candidate.id === shotId);
  const layer = shot?.layers.find((candidate) => candidate.id === layerId);
  if (!layer || layer.locked) return false;
  const character = adaptiveCharacterForLayer(snapshot, layer);
  return Boolean(
    character &&
      resolvePartPoseEditorParts(character, layer).some(
        (part) => part.partId === partId,
      ),
  );
}

function isCurrentPartPoseTarget(input: {
  snapshot: EditorProjectSnapshot;
  instanceId: number | null;
  shotId: string;
  layerId: string;
  partId: string;
  partPoseEditor: PartPoseEditorUi;
  sourceTimeMs?: number;
}): boolean {
  if (!isCurrentPartPoseEditorContext(input)) return false;
  const shot = input.snapshot.project.shots.find(
    (candidate) => candidate.id === input.shotId,
  );
  const layer = shot?.layers.find(
    (candidate) => candidate.id === input.layerId,
  );
  if (!layer?.poseAnimation) return false;
  const track = layer.poseAnimation.tracks.find(
    (candidate) => candidate.partId === input.partId,
  );
  return !!track && (
    input.sourceTimeMs === undefined ||
    track.keys.some((key) => key.timeMs === input.sourceTimeMs)
  );
}

export function PartPoseTimeline({
  ...props
}: PartPoseTimelineProps): React.JSX.Element | null {
  const character = adaptiveCharacterForLayer(props.snapshot, props.layer);
  if (
    !character ||
    props.layer.locked ||
    (!props.layer.poseAnimation &&
      props.partPoseEditor.activeLayerId !== props.layer.id)
  ) {
    return null;
  }
  return <PartPoseTimelineContent {...props} character={character} />;
}

interface PartPoseTimelineContentProps extends PartPoseTimelineProps {
  character: AdaptivePartsCharacter;
}

function PartPoseTimelineContent({
  partPoseEditor,
  toolbarHost,
  shot,
  layer,
  snapshot,
  currentTimeMs,
  pixelsPerMs,
  trackWidth,
  character,
}: PartPoseTimelineContentProps): React.JSX.Element {
  const instanceId = editorProjectStore.getProjectInstanceId();
  const isPartPoseMode = partPoseEditor.activeLayerId === layer.id;
  const animation = layer.poseAnimation;
  const poseParts = [...resolvePartPoseEditorParts(character, layer)].sort(
    (left, right) => left.drawOrder - right.drawOrder,
  );
  const partName = (
    track: PartPoseTrack | undefined,
    partId: string,
  ): string => {
    const partIndex = poseParts.findIndex((part) => part.partId === partId);
    const displayName =
      track?.displayName ?? poseParts[partIndex]?.displayName;
    return getPartPosePartLabel(displayName, Math.max(0, partIndex));
  };

  const tracks = animation?.tracks ?? [];
  const authoredTracks = tracks.filter(hasAuthoredPartPose);
  const preferredPartId = isPartPoseMode
    ? partPoseEditor.selectedPartId
    : null;
  const primaryPartId =
    preferredPartId ??
    authoredTracks[0]?.partId ??
    tracks[0]?.partId ??
    character.parts[0]?.partId ??
    null;
  const primaryPart = poseParts.find(
    (part) => part.partId === primaryPartId,
  );
  const primaryTrack = tracks.find((track) => track.partId === primaryPartId);
  const keys = primaryTrack?.keys.filter(
    (key) => key.timeMs <= shot.durationMs,
  ) ?? [];
  const selectedPartActive =
    primaryPartId !== null &&
    partPoseEditor.activeLayerId === layer.id &&
    partPoseEditor.selectedPartId === primaryPartId;
  const overviewTimes = Array.from(
    new Set(
      authoredTracks.flatMap((track) =>
        track.keys
          .filter((key) => key.timeMs <= shot.durationMs)
          .map((key) => key.timeMs),
      ),
    ),
  ).sort((left, right) => left - right);
  const otherTracks = authoredTracks.filter(
    (track) => track.partId !== primaryPartId,
  );
  const [poseGroupExpanded, setPoseGroupExpanded] = useState(true);
  const [expandedOtherParts, setExpandedOtherParts] = useState(false);
  const [poseActionsOpen, setPoseActionsOpen] = useState(false);
  const [poseActionsPosition, setPoseActionsPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const poseActionsRef = useRef<HTMLDetailsElement>(null);
  const [selectedKey, setSelectedKey] = useState<{
    partId: string;
    timeMs: number;
  } | null>(null);
  const [clipboard, setClipboard] = useState<PartPoseClipboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scopeKey = JSON.stringify([
    instanceId,
    snapshot.project.id,
    snapshot.projectRoot,
    shot.id,
    layer.id,
    primaryPartId,
  ]);

  useEffect(() => {
    if (!poseActionsOpen) {
      setPoseActionsPosition(null);
      return;
    }

    const positionMenu = (): void => {
      const details = poseActionsRef.current;
      const trigger = details?.querySelector('summary');
      const menu = details?.querySelector<HTMLElement>(
        '.timeline-pose-overflow-content',
      );
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
      const top = below + menuHeight <= window.innerHeight - 8
        ? below
        : Math.max(8, triggerBounds.top - menuHeight - 5);

      setPoseActionsPosition((current) =>
        current?.left === left && current.top === top
          ? current
          : { left, top },
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
  }, [poseActionsOpen]);

  useEffect(() => {
    setSelectedKey((current) =>
      current?.partId === primaryPartId ? current : null,
    );
    setClipboard(null);
    setExpandedOtherParts(false);
    setError(null);
  }, [instanceId, snapshot.project.id, snapshot.projectRoot, shot.id, layer.id, primaryPartId]);

  const selectedKeyTime =
    selectedKey?.partId === primaryPartId &&
    keys.some((key) => key.timeMs === selectedKey.timeMs)
      ? selectedKey.timeMs
      : null;
  const selectedKeyframe =
    selectedKeyTime === null
      ? undefined
      : keys.find((key) => key.timeMs === selectedKeyTime);
  const selectedKeyIndex = keys.findIndex(
    (key) => key.timeMs === selectedKeyTime,
  );
  const nextKey = selectedKeyIndex >= 0 ? keys[selectedKeyIndex + 1] : undefined;
  const clipboardMatches = clipboard?.scope === scopeKey;
  const validPasteTime =
    shot.durationMs > 0 &&
    isValidFrameTime(currentTimeMs) &&
    currentTimeMs <= lastValidFrameTime(shot.durationMs);

  const reportStale = (): void => {
    setError('Part 姿势或项目状态已变化，请重新选择关键帧后再试。');
  };

  const selectPart = (partId: string): void => {
    if (partPoseEditor.activeLayerId === layer.id) {
      partPoseEditor.onSelectPart(partId);
    } else {
      partPoseEditor.onStart(layer.id, partId);
    }
  };

  const activateKey = (partId: string, timeMs: number): void => {
    if (
      editorProjectStore.getSnapshot() !== snapshot ||
      editorProjectStore.getProjectInstanceId() !== instanceId ||
      shotStore.getCurrentShotId() !== shot.id ||
      selectionStore.getSelectedLayerId() !== layer.id
    ) {
      reportStale();
      return;
    }
    selectPart(partId);
    setSelectedKey({ partId, timeMs });
    timelineUiStore.seek(timeMs, shot.durationMs);
  };

  const selectAndSeek = (partId: string, timeMs: number): void => {
    selectPart(partId);
    setSelectedKey({ partId, timeMs });
    timelineUiStore.seek(timeMs, shot.durationMs);
  };

  const previousKey = selectedKeyIndex >= 0
    ? keys[selectedKeyIndex - 1]
    : [...keys].reverse().find((key) => key.timeMs < currentTimeMs);
  const followingKey = selectedKeyIndex >= 0
    ? keys[selectedKeyIndex + 1]
    : keys.find((key) => key.timeMs > currentTimeMs);

  const copySelectedKey = (): void => {
    if (!selectedKeyframe || primaryPartId === null) return;
    setError(null);
    setClipboard({
      scope: scopeKey,
      sourceTimeMs: selectedKeyframe.timeMs,
      keyframe: { ...selectedKeyframe },
    });
  };

  const pasteAtPlayhead = (): void => {
    if (
      !clipboardMatches ||
      !clipboard ||
      !validPasteTime ||
      primaryPartId === null
    ) {
      if (!validPasteTime) {
        setError('请先将播放头移到镜头内的有效帧。');
      }
      return;
    }
    if (!isCurrentPartPoseTarget({
      snapshot,
      instanceId,
      shotId: shot.id,
      layerId: layer.id,
      partId: primaryPartId,
      partPoseEditor,
    })) {
      reportStale();
      return;
    }
    try {
      setError(null);
      layerStore.copyPartPoseKeyframe(
        layer.id,
        primaryPartId,
        clipboard.sourceTimeMs,
        currentTimeMs,
        clipboard.keyframe,
      );
      setSelectedKey({ partId: primaryPartId, timeMs: currentTimeMs });
    } catch (operationError) {
      setError(errorText(operationError));
    }
  };

  const deleteSelectedKey = (): void => {
    if (
      selectedKeyTime === null ||
      selectedKeyTime === 0 ||
      primaryPartId === null
    ) {
      return;
    }
    if (!isCurrentPartPoseTarget({
      snapshot,
      instanceId,
      shotId: shot.id,
      layerId: layer.id,
      partId: primaryPartId,
      partPoseEditor,
      sourceTimeMs: selectedKeyTime,
    })) {
      reportStale();
      return;
    }
    try {
      setError(null);
      layerStore.deletePartPoseKeyframe(layer.id, primaryPartId, selectedKeyTime);
      setSelectedKey(null);
    } catch (operationError) {
      setError(errorText(operationError));
    }
  };

  const setSelectedEasing = (easingToNext: PartPoseEasing): void => {
    if (
      selectedKeyTime === null ||
      primaryPartId === null ||
      !nextKey
    ) {
      return;
    }
    if (!isCurrentPartPoseTarget({
      snapshot,
      instanceId,
      shotId: shot.id,
      layerId: layer.id,
      partId: primaryPartId,
      partPoseEditor,
      sourceTimeMs: selectedKeyTime,
    })) {
      reportStale();
      return;
    }
    try {
      setError(null);
      layerStore.setPartPoseKeyEasing(
        layer.id,
        primaryPartId,
        selectedKeyTime,
        easingToNext,
      );
    } catch (operationError) {
      setError(errorText(operationError));
    }
  };

  const retimeSelectedMarker = (partId: string, timeMs: number): void => {
    setError(null);
    setSelectedKey({ partId, timeMs });
    timelineUiStore.seek(timeMs, shot.durationMs);
  };

  const addKeyAtTime = (partId: string, timeMs: number): void => {
    if (partId !== primaryPartId || !selectedPartActive) return;
    const track = tracks.find((candidate) => candidate.partId === partId);
    const hasKeyAtTime = Boolean(
      track?.keys.some((key) => key.timeMs === timeMs),
    );
    if (hasKeyAtTime) {
      activateKey(partId, timeMs);
      return;
    }
    if (timeMs === 0) {
      timelineUiStore.seek(timeMs, shot.durationMs);
      return;
    }
    if (!canAddPartPoseKeyAtTime({
      part: primaryPart,
      layerLocked: layer.locked,
      timeMs,
      durationMs: shot.durationMs,
      hasKeyAtTime,
      calibratingPivot: partPoseEditor.calibratingPivot,
    })) {
      return;
    }
    if (!isCurrentPartPoseEditorContext({
      snapshot,
      instanceId,
      shotId: shot.id,
      layerId: layer.id,
      partId,
      partPoseEditor,
    })) {
      reportStale();
      return;
    }
    const pivotDraft =
      partPoseEditor.pivotDraft?.layerId === layer.id &&
      partPoseEditor.pivotDraft.partId === partId
        ? partPoseEditor.pivotDraft.point
        : undefined;
    try {
      setError(null);
      layerStore.addPartPoseKeyframe(layer.id, partId, timeMs, pivotDraft);
      partPoseEditor.onPivotUsed();
      setSelectedKey({ partId, timeMs });
      timelineUiStore.seek(timeMs, shot.durationMs);
    } catch (operationError) {
      setError(errorText(operationError));
    }
  };

  const primaryName = primaryPartId
    ? partName(primaryTrack, primaryPartId)
    : 'Part';
  const legacyEasingLabel: Record<string, string> = {
    'ease-in': '现有缓入',
    'ease-out': '现有缓出',
  };

  return (
    <>
      {toolbarHost && selectedPartActive
        ? createPortal(
            <div
              aria-label="Part 姿势关键帧操作"
              className="timeline-pose-toolbar"
              data-testid="part-pose-toolbar"
              role="group"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              <IconButton
                aria-label="上一个 Part 姿势关键帧"
                className="timeline-pose-control"
                disabled={!previousKey || !primaryPartId}
                icon={<ChevronLeft aria-hidden="true" size={14} />}
                onClick={() => {
                  if (previousKey && primaryPartId) {
                    selectAndSeek(primaryPartId, previousKey.timeMs);
                  }
                }}
                title="上一个关键帧"
                variant="secondary"
              />
              <IconButton
                aria-label="下一个 Part 姿势关键帧"
                className="timeline-pose-control"
                disabled={!followingKey || !primaryPartId}
                icon={<ChevronRight aria-hidden="true" size={14} />}
                onClick={() => {
                  if (followingKey && primaryPartId) {
                    selectAndSeek(primaryPartId, followingKey.timeMs);
                  }
                }}
                title="下一个关键帧"
                variant="secondary"
              />
              <details
                className="timeline-pose-overflow"
                data-testid="part-pose-more-actions"
                onToggle={(event) =>
                  setPoseActionsOpen(event.currentTarget.open)
                }
                ref={poseActionsRef}
              >
                <summary
                  aria-label="更多 Part 姿势关键帧操作"
                  className="timeline-pose-overflow-trigger"
                  title="更多关键帧操作"
                >
                  <MoreHorizontal aria-hidden="true" size={16} />
                </summary>
                <div
                  aria-label="其他关键帧操作"
                  className="timeline-pose-overflow-content"
                  data-positioned={poseActionsPosition ? 'true' : 'false'}
                  role="group"
                  style={poseActionsPosition ?? undefined}
                >
                  <IconButton
                    aria-label="复制当前 Part 姿势关键帧"
                    className="timeline-pose-control"
                    disabled={!selectedKeyframe || !selectedPartActive}
                    icon={<Copy aria-hidden="true" size={13} />}
                    onClick={copySelectedKey}
                    title="复制关键帧"
                    variant="secondary"
                  />
                  <button
                    aria-label="粘贴 Part 姿势关键帧到播放头"
                    className="timeline-pose-text-control"
                    data-testid="part-pose-paste"
                    disabled={!clipboardMatches || !validPasteTime || !selectedPartActive}
                    onClick={pasteAtPlayhead}
                    title="粘贴到播放头"
                    type="button"
                  >
                    粘贴
                  </button>
                  <IconButton
                    aria-label="删除当前 Part 姿势关键帧"
                    className="timeline-pose-control"
                    disabled={
                      !selectedKeyframe ||
                      selectedKeyTime === 0 ||
                      !selectedPartActive
                    }
                    icon={<Trash2 aria-hidden="true" size={13} />}
                    onClick={deleteSelectedKey}
                    title="删除关键帧"
                    variant="secondary"
                  />
                  {selectedKeyframe && nextKey ? (
                    <select
                      aria-label="到下个关键帧的缓动"
                      className="timeline-pose-easing"
                      data-testid="part-pose-easing"
                      disabled={!selectedPartActive}
                      value={selectedKeyframe.easingToNext}
                      onChange={(event) =>
                        setSelectedEasing(event.currentTarget.value as PartPoseEasing)
                      }
                    >
                      {legacyEasingLabel[selectedKeyframe.easingToNext] ? (
                        <option disabled value={selectedKeyframe.easingToNext}>
                          {legacyEasingLabel[selectedKeyframe.easingToNext]}
                        </option>
                      ) : null}
                      <option value="linear">匀速</option>
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
        className="timeline-lane timeline-pose-overview-lane"
        data-expanded={poseGroupExpanded ? 'true' : 'false'}
        data-testid="part-pose-overview-lane"
        role="group"
      >
        <span
          className="timeline-lane-label timeline-pose-overview-label"
          data-track-label="part-pose-overview"
        >
          <button
            aria-expanded={poseGroupExpanded}
            aria-label={poseGroupExpanded ? '收起人物动作轨道' : '展开人物动作轨道'}
            className="timeline-pose-group-toggle"
            data-testid="part-pose-group-toggle"
            onClick={(event) => {
              event.stopPropagation();
              setPoseGroupExpanded((expanded) => !expanded);
            }}
            onPointerDown={(event) => event.stopPropagation()}
            title={poseGroupExpanded ? '收起人物动作轨道' : '展开人物动作轨道'}
            type="button"
          >
            {poseGroupExpanded
              ? <ChevronDown aria-hidden="true" size={13} />
              : <ChevronRight aria-hidden="true" size={13} />}
          </button>
          <span className="timeline-lane-label-text">人物动作</span>
          {otherTracks.length > 0 ? (
            <button
              aria-expanded={expandedOtherParts}
              aria-label={expandedOtherParts
                ? `收起其他有动作的部位（${otherTracks.length}）`
                : `展开其他有动作的部位（${otherTracks.length}）`}
              className="timeline-pose-other-toggle"
              data-testid="part-pose-expand-others"
              onClick={(event) => {
                event.stopPropagation();
                setExpandedOtherParts((expanded) => !expanded);
              }}
              onPointerDown={(event) => event.stopPropagation()}
              title={expandedOtherParts ? '收起其他部位' : '展开其他部位'}
              type="button"
            >
              {expandedOtherParts
                ? <ChevronUp aria-hidden="true" size={11} />
                : <ChevronDown aria-hidden="true" size={11} />}
              <span aria-hidden="true">{otherTracks.length}</span>
            </button>
          ) : null}
        </span>
        <div
          className="timeline-lane-content timeline-pose-lane-content"
          style={{ width: `${trackWidth}px` }}
        >
          {overviewTimes.map((timeMs) => (
            <button
              aria-current={currentTimeMs === timeMs ? 'time' : undefined}
              aria-label={`${formatTimecode(timeMs)}，Part 姿势总览关键帧`}
              className="part-pose-overview-marker"
              data-testid="part-pose-overview-marker"
              data-time-ms={timeMs}
              key={timeMs}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                timelineUiStore.seek(timeMs, shot.durationMs);
              }}
              onDoubleClick={(event) => event.stopPropagation()}
              style={{ left: `${timeToPx(timeMs, pixelsPerMs)}px` }}
              title={formatTimecode(timeMs)}
              type="button"
            >
              <span aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>

      {poseGroupExpanded && primaryPartId ? (
        <PartPoseLane
          currentTimeMs={currentTimeMs}
          durationMs={shot.durationMs}
          editable={selectedPartActive}
          layerId={layer.id}
          partId={primaryPartId}
          partName={primaryName}
          partPoseEditor={partPoseEditor}
          pixelsPerMs={pixelsPerMs}
          selectedTimeMs={selectedKeyTime}
          shotId={shot.id}
          snapshot={snapshot}
          track={primaryTrack}
          trackWidth={trackWidth}
          onActivate={activateKey}
          onAddAtTime={addKeyAtTime}
          onError={setError}
          onRetime={retimeSelectedMarker}
        />
      ) : null}

      {poseGroupExpanded && expandedOtherParts
        ? otherTracks.map((track) => (
            <PartPoseLane
              currentTimeMs={currentTimeMs}
              durationMs={shot.durationMs}
              editable={false}
              layerId={layer.id}
              key={track.partId}
              partId={track.partId}
              partName={partName(track, track.partId)}
              partPoseEditor={partPoseEditor}
              pixelsPerMs={pixelsPerMs}
              selectedTimeMs={null}
              shotId={shot.id}
              snapshot={snapshot}
              track={track}
              trackWidth={trackWidth}
              onActivate={activateKey}
              onError={setError}
              onRetime={retimeSelectedMarker}
            />
          ))
        : null}
      {error ? (
        <PositionLaneErrorNotice message={error} onDismiss={() => setError(null)} />
      ) : null}
    </>
  );
}

interface PartPoseLaneProps {
  currentTimeMs: number;
  durationMs: number;
  editable: boolean;
  layerId: string;
  partId: string;
  partName: string;
  partPoseEditor: PartPoseEditorUi;
  pixelsPerMs: number;
  selectedTimeMs: number | null;
  shotId: string;
  snapshot: EditorProjectSnapshot;
  track: PartPoseTrack | undefined;
  trackWidth: number;
  onActivate(partId: string, timeMs: number): void;
  onAddAtTime?(partId: string, timeMs: number): void;
  onError(message: string): void;
  onRetime(partId: string, timeMs: number): void;
}

function PartPoseLane({
  currentTimeMs,
  durationMs,
  editable,
  layerId,
  partId,
  partName: label,
  partPoseEditor,
  pixelsPerMs,
  selectedTimeMs,
  shotId,
  snapshot,
  track,
  trackWidth,
  onActivate,
  onAddAtTime,
  onError,
  onRetime,
}: PartPoseLaneProps): React.JSX.Element {
  const keys = track?.keys.filter(
    (key) => key.timeMs <= durationMs,
  ) ?? [];
  const lastPointerTypeRef = useRef<string | null>(null);
  const blankLanePointerIdRef = useRef<number | null>(null);

  const seekBlankLane = (
    element: HTMLDivElement,
    clientX: number,
  ): void => {
    const bounds = element.getBoundingClientRect();
    timelineUiStore.seek(
      pxToTime(clientX - bounds.left, pixelsPerMs),
      durationMs,
    );
  };

  const handleBlankLanePointerDown = (
    event: ReactPointerEvent<HTMLDivElement>,
  ): void => {
    lastPointerTypeRef.current = event.pointerType;
    if (
      event.target !== event.currentTarget ||
      event.pointerType !== 'mouse' ||
      event.button !== 0 ||
      !editable ||
      !onAddAtTime
    ) {
      return;
    }

    // Own only blank clicks on the active Part lane. The outer ruler still
    // captures seeks everywhere else; keeping capture on this lane lets the
    // browser deliver its click/dblclick sequence back to the intended target.
    event.stopPropagation();
    blankLanePointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    seekBlankLane(event.currentTarget, event.clientX);
  };

  const handleBlankLanePointerMove = (
    event: ReactPointerEvent<HTMLDivElement>,
  ): void => {
    if (blankLanePointerIdRef.current !== event.pointerId) return;
    event.stopPropagation();
    seekBlankLane(event.currentTarget, event.clientX);
  };

  const handleBlankLanePointerEnd = (
    event: ReactPointerEvent<HTMLDivElement>,
  ): void => {
    if (blankLanePointerIdRef.current !== event.pointerId) return;
    event.stopPropagation();
    blankLanePointerIdRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
  };

  const handleDoubleClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    event.stopPropagation();
    if (
      event.target !== event.currentTarget ||
      event.detail !== 2 ||
      lastPointerTypeRef.current !== 'mouse' ||
      !editable ||
      !onAddAtTime
    ) {
      return;
    }
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const timeMs = resolveTimelineFrameTime(
      pxToTime(event.clientX - bounds.left, pixelsPerMs),
      durationMs,
    );
    onAddAtTime(partId, timeMs);
  };

  return (
    <div
      aria-label={`${label} Part 姿势`}
      className="timeline-lane timeline-pose-part-lane"
      data-part-id={partId}
      data-selected-part={editable ? 'true' : 'false'}
      data-testid="part-pose-part-lane"
      role="group"
    >
      <span className="timeline-lane-label" data-track-label="part-pose-part">
        <span className="timeline-lane-label-text">{label}</span>
      </span>
      <div
        className="timeline-lane-content timeline-pose-lane-content"
        onDoubleClick={handleDoubleClick}
        onLostPointerCapture={handleBlankLanePointerEnd}
        onPointerCancel={handleBlankLanePointerEnd}
        onPointerDown={handleBlankLanePointerDown}
        onPointerMove={handleBlankLanePointerMove}
        onPointerUp={handleBlankLanePointerEnd}
        style={{ width: `${trackWidth}px` }}
      >
        {keys.map((keyframe, index) => (
          <PartPoseKeyMarker
            current={currentTimeMs === keyframe.timeMs}
            durationMs={durationMs}
            editable={editable && keyframe.timeMs !== 0}
            key={`${partId}:${keyframe.timeMs}`}
            keyframe={keyframe}
            nextTimeMs={keys[index + 1]?.timeMs ?? null}
            partId={partId}
            partName={label}
            partPoseEditor={partPoseEditor}
            pixelsPerMs={pixelsPerMs}
            previousTimeMs={keys[index - 1]?.timeMs ?? null}
            selected={selectedTimeMs === keyframe.timeMs}
            shotId={shotId}
            layerId={layerId}
            snapshot={snapshot}
            onActivate={onActivate}
            onError={onError}
            onRetime={onRetime}
          />
        ))}
      </div>
    </div>
  );
}

interface PartPoseKeyMarkerProps {
  current: boolean;
  durationMs: number;
  editable: boolean;
  keyframe: PartPoseKeyframe;
  nextTimeMs: number | null;
  partId: string;
  partName: string;
  partPoseEditor: PartPoseEditorUi;
  pixelsPerMs: number;
  previousTimeMs: number | null;
  selected: boolean;
  shotId: string;
  layerId: string;
  snapshot: EditorProjectSnapshot;
  onActivate(partId: string, timeMs: number): void;
  onError(message: string): void;
  onRetime(partId: string, timeMs: number): void;
}

function PartPoseKeyMarker({
  current,
  durationMs,
  editable,
  keyframe,
  nextTimeMs,
  partId,
  partName: label,
  partPoseEditor,
  pixelsPerMs,
  previousTimeMs,
  selected,
  shotId,
  layerId,
  snapshot,
  onActivate,
  onError,
  onRetime,
}: PartPoseKeyMarkerProps): React.JSX.Element {
  const markerRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<PartPoseDragSession | null>(null);
  const suppressClickRef = useRef(false);
  const [previewTimeMs, setPreviewTimeMs] = useState<number | null>(null);
  const displayTime = previewTimeMs ?? keyframe.timeMs;
  const instanceId = editorProjectStore.getProjectInstanceId();

  const cancelDrag = (): void => {
    dragRef.current = null;
    setPreviewTimeMs(null);
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
        selectionStore.getSelectedLayerId() !== layerId ||
        partPoseEditor.activeLayerId !== layerId ||
        partPoseEditor.selectedPartId !== partId)
    ) {
      cancelDrag();
    }
  }, [editable, instanceId, layerId, partId, partPoseEditor.activeLayerId, partPoseEditor.selectedPartId, shotId, snapshot]);

  const reportStale = (): void =>
    onError('Part 姿势关键帧已变化，请重新选择后再操作。');

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    event.stopPropagation();
    if (!editable || event.button !== 0 || previousTimeMs === null) return;
    if (!isCurrentPartPoseTarget({
      snapshot,
      instanceId,
      shotId,
      layerId,
      partId,
      partPoseEditor,
      sourceTimeMs: keyframe.timeMs,
    })) {
      reportStale();
      return;
    }
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      previewTimeMs: keyframe.timeMs,
      moved: false,
      snapshot,
      instanceId,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    event.stopPropagation();
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || previousTimeMs === null) return;
    const deltaPx = event.clientX - drag.startX;
    if (!drag.moved && Math.abs(deltaPx) < 3) return;
    drag.moved = true;
    drag.previewTimeMs = previewPartPoseKeyTime({
      fromTimeMs: keyframe.timeMs,
      deltaPx,
      pixelsPerMs,
      previousTimeMs,
      nextTimeMs,
      durationMs,
    });
    setPreviewTimeMs(drag.previewTimeMs);
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    event.stopPropagation();
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setPreviewTimeMs(null);
    if (!drag.moved) return;
    suppressClickRef.current = true;
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
    if (
      !isCurrentPartPoseTarget({
        snapshot: drag.snapshot,
        instanceId: drag.instanceId,
        shotId,
        layerId,
        partId,
        partPoseEditor,
        sourceTimeMs: keyframe.timeMs,
      })
    ) {
      reportStale();
      return;
    }
    if (drag.previewTimeMs === keyframe.timeMs) return;
    try {
      layerStore.retimePartPoseKeyframe(
        layerId,
        partId,
        keyframe.timeMs,
        drag.previewTimeMs,
      );
      onRetime(partId, drag.previewTimeMs);
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
        ref={markerRef}
        aria-current={current ? 'time' : undefined}
        aria-label={`${formatTimecode(keyframe.timeMs)}，${label} Part 姿势关键帧`}
        aria-pressed={selected}
        className="part-pose-key-marker"
        data-current={current ? 'true' : 'false'}
        data-dragging={previewTimeMs === null ? 'false' : 'true'}
        data-part-id={partId}
        data-selected={selected ? 'true' : 'false'}
        data-time-ms={keyframe.timeMs}
        data-testid="part-pose-key-marker"
        onClick={(event) => {
          event.stopPropagation();
          if (suppressClickRef.current && event.detail !== 0) {
            suppressClickRef.current = false;
            return;
          }
          onActivate(partId, keyframe.timeMs);
        }}
        onDoubleClick={(event) => event.stopPropagation()}
        onPointerCancel={handleCancel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onLostPointerCapture={handleCancel}
        style={{ left: `${timeToPx(displayTime, pixelsPerMs)}px` }}
        title={`${formatTimecode(keyframe.timeMs)}${keyframe.timeMs === 0 ? ' · 基础姿势' : ''}`}
        type="button"
      >
        <span aria-hidden="true" className="part-pose-key-diamond" />
      </button>
      {previewTimeMs !== null ? (
        <span
          aria-hidden="true"
          className="part-pose-key-time-bubble"
          style={{ left: `${timeToPx(displayTime, pixelsPerMs)}px` }}
        >
          {formatTimecode(previewTimeMs)}
        </span>
      ) : null}
    </>
  );
}
