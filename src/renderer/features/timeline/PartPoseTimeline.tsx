import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Copy, Trash2 } from 'lucide-react';
import {
  hasAuthoredPartPose,
  isValidFrameTime,
  lastValidFrameTime,
  type AdaptivePartsCharacter,
  type PartPoseEasing,
  type PartPoseKeyframe,
  type PartPoseTrack,
  type Shot,
  type Layer,
} from '../../../domain';
import type { PartPoseEditorUi } from '../part-pose/partPoseEditorTypes';
import type { EditorProjectSnapshot } from '../../stores/EditorProjectStore';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { layerStore } from '../../stores/layerStore';
import { selectionStore } from '../../stores/selectionStore';
import { shotStore } from '../../stores/shotStore';
import { IconButton } from '../../ui/Button';
import { formatTimecode, timeToPx } from './timeGeometry';
import { timelineUiStore } from './timelineUiStore';
import { PositionLaneErrorNotice } from './PositionLane';
import { previewPartPoseKeyTime } from './partPoseTimelineGesture';

export interface PartPoseTimelineProps {
  partPoseEditor: PartPoseEditorUi;
  shot: Shot;
  layer: Layer;
  snapshot: EditorProjectSnapshot;
  currentTimeMs: number;
  pixelsPerMs: number;
  trackWidth: number;
  laneLabelWidth: number;
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

function isCurrentPartPoseTarget(input: {
  snapshot: EditorProjectSnapshot;
  instanceId: number | null;
  shotId: string;
  layerId: string;
  partId: string;
  partPoseEditor: PartPoseEditorUi;
  sourceTimeMs?: number;
}): boolean {
  const {
    snapshot,
    instanceId,
    shotId,
    layerId,
    partId,
    partPoseEditor,
    sourceTimeMs,
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
  if (!layer || layer.locked || !layer.poseAnimation) return false;
  const track = layer.poseAnimation.tracks.find(
    (candidate) => candidate.partId === partId,
  );
  return !!track && (
    sourceTimeMs === undefined ||
    track.keys.some((key) => key.timeMs === sourceTimeMs)
  );
}

function partName(
  character: AdaptivePartsCharacter,
  track: PartPoseTrack | undefined,
  partId: string,
): string {
  const partIndex = character.parts.findIndex((part) => part.partId === partId);
  return (
    track?.displayName ??
    character.parts[partIndex]?.displayName ??
    `Part ${partIndex + 1}`
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
  shot,
  layer,
  snapshot,
  currentTimeMs,
  pixelsPerMs,
  trackWidth,
  laneLabelWidth,
  character,
}: PartPoseTimelineContentProps): React.JSX.Element {
  const instanceId = editorProjectStore.getProjectInstanceId();
  const isPartPoseMode = partPoseEditor.activeLayerId === layer.id;
  const animation = layer.poseAnimation;

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
  const [expandedOtherParts, setExpandedOtherParts] = useState(false);
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
    isValidFrameTime(currentTimeMs) &&
    currentTimeMs < shot.durationMs &&
    currentTimeMs <= lastValidFrameTime(Math.max(0, shot.durationMs - 1));

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

  const primaryName = primaryPartId
    ? partName(character, primaryTrack, primaryPartId)
    : 'Part';
  const legacyEasingLabel: Record<string, string> = {
    'ease-in': '现有缓入',
    'ease-out': '现有缓出',
  };

  return (
    <>
      <div
        aria-label="Part 姿势关键帧操作"
        className="timeline-pose-toolbar"
        data-testid="part-pose-toolbar"
        role="group"
        style={{ width: `${trackWidth + laneLabelWidth}px` }}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <span
          className="timeline-pose-toolbar-label"
          style={{ width: `${laneLabelWidth}px` }}
        >
          {primaryName}
        </span>
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
        {otherTracks.length > 0 ? (
          <button
            aria-expanded={expandedOtherParts}
            aria-label={expandedOtherParts ? '收起其他 Part 轨道' : '展开其他 Part 轨道'}
            className="timeline-pose-text-control"
            data-testid="part-pose-expand-others"
            onClick={() => setExpandedOtherParts((expanded) => !expanded)}
            type="button"
          >
            {expandedOtherParts ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            其他 {otherTracks.length}
          </button>
        ) : null}
      </div>

      <div
        aria-label="人物动作总览"
        className="timeline-lane timeline-pose-overview-lane"
        data-testid="part-pose-overview-lane"
        role="group"
      >
        <span className="timeline-lane-label" data-track-label="part-pose-overview">
          <span className="timeline-lane-label-text">人物动作</span>
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
              style={{ left: `${timeToPx(timeMs, pixelsPerMs)}px` }}
              title={formatTimecode(timeMs)}
              type="button"
            >
              <span aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>

      {primaryPartId ? (
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
          onError={setError}
          onRetime={retimeSelectedMarker}
        />
      ) : null}

      {expandedOtherParts
        ? otherTracks.map((track) => (
            <PartPoseLane
              currentTimeMs={currentTimeMs}
              durationMs={shot.durationMs}
              editable={false}
              layerId={layer.id}
              key={track.partId}
              partId={track.partId}
              partName={partName(character, track, track.partId)}
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
  onError,
  onRetime,
}: PartPoseLaneProps): React.JSX.Element {
  const keys = track?.keys.filter(
    (key) => key.timeMs <= durationMs,
  ) ?? [];
  return (
    <div
      aria-label={`${label} Part 姿势`}
      className="timeline-lane timeline-pose-part-lane"
      data-part-id={partId}
      data-testid="part-pose-part-lane"
      role="group"
    >
      <span className="timeline-lane-label" data-track-label="part-pose-part">
        <span className="timeline-lane-label-text">{label}</span>
      </span>
      <div
        className="timeline-lane-content timeline-pose-lane-content"
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
