import { useState } from 'react';
import {
  collectFlaGraphicTimelineDurationMs,
  resolveFlaGraphicTimelineTarget,
  type FlaGraphicDefinition,
  type FlaGraphicTransformEasing,
  type Project,
} from '../../../domain';
import { layerStore } from '../../stores/layerStore';
import {
  formatTimecode,
  integerFrameSpanMs,
  snapToFrame,
  TIMELINE_FPS,
} from './timeGeometry';
import {
  timelineUiStore,
  type FlaGraphicInternalTimelineContext,
} from './timelineUiStore';

export interface FlaGraphicInternalTimelineBarProps {
  readonly context: FlaGraphicInternalTimelineContext;
  readonly project: Project;
}

const EASING_OPTIONS: readonly {
  readonly value: FlaGraphicTransformEasing;
  readonly label: string;
}[] = [
  { value: 'linear', label: '线性' },
  { value: 'ease', label: '平滑' },
  { value: 'hold', label: '保持' },
];

/**
 * Compact internal timeline controls rendered inside the existing TimelineDock
 * while Shared Definition Edit is active. Reuses `timelineUiStore` for seek
 * and `layerStore` for formal History-backed keyframe authoring.
 */
export function FlaGraphicInternalTimelineBar({
  context,
  project,
}: FlaGraphicInternalTimelineBarProps): React.JSX.Element | null {
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const frameStepMs = integerFrameSpanMs(TIMELINE_FPS);
  const [targetTimeInput, setTargetTimeInput] = useState<string>(() =>
    String(snapToFrame(context.internalTimeMs + frameStepMs, TIMELINE_FPS)),
  );
  const animation = project.animations.find(
    (candidate) => candidate.id === context.animationId,
  );
  if (
    !animation ||
    !('kind' in animation) ||
    animation.kind !== 'fla-graphic' ||
    !animation.structure
  ) {
    return null;
  }
  const structure = (animation as FlaGraphicDefinition).structure!;
  const target =
    context.selectedNodePath && context.selectedNodePath.length > 0
      ? resolveFlaGraphicTimelineTarget(
          structure,
          context.frameOrdinal,
          context.selectedNodePath,
        )
      : null;

  const activeTimeline = target?.timeline ?? structure.timeline;
  const overviewTimes = [
    ...new Set(
      (activeTimeline?.tracks ?? []).flatMap((track) =>
        track.keyframes.map((kf) => kf.timeMs),
      ),
    ),
  ].sort((left, right) => left - right);

  const track =
    target?.trackId && activeTimeline
      ? activeTimeline.tracks.find((candidate) => candidate.trackId === target.trackId)
      : undefined;
  const keyframes = track?.keyframes ?? [];
  const currentKf = keyframes.find((kf) => kf.timeMs === context.internalTimeMs) ?? null;
  const prevKf = [...keyframes]
    .reverse()
    .find((kf) => kf.timeMs < context.internalTimeMs);
  const nextKf = keyframes.find((kf) => kf.timeMs > context.internalTimeMs);

  const timelineDurationMs = collectFlaGraphicTimelineDurationMs(
    activeTimeline,
    structure,
  );
  const rangeMaxMs = Math.max(2_000, timelineDurationMs, context.internalTimeMs);

  const resolveSnappedTargetTimeMs = (): number | null => {
    const parsed = Number(targetTimeInput);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setStatusMessage('目标时间必须为非负数字。');
      return null;
    }
    return snapToFrame(parsed, TIMELINE_FPS);
  };

  const handleAddKeyframe = (): void => {
    if (!context.selectedNodePath || target?.authoringCapability !== 'editable') {
      return;
    }
    const snappedTimeMs = snapToFrame(context.internalTimeMs, TIMELINE_FPS);
    try {
      setStatusMessage(null);
      timelineUiStore.setFlaGraphicTimelineAuthoringActive(true);
      layerStore.addFlaGraphicTimelineKeyframe(
        context.layerId,
        context.frameOrdinal,
        context.selectedNodePath,
        snappedTimeMs,
        'linear',
      );
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : '无法添加元件关键帧。',
      );
    }
  };

  const handleDeleteKeyframe = (): void => {
    if (!context.selectedNodePath || !currentKf) return;
    setStatusMessage(null);
    layerStore.deleteFlaGraphicTimelineKeyframe(
      context.layerId,
      context.frameOrdinal,
      context.selectedNodePath,
      currentKf.timeMs,
    );
  };

  const handleMoveKeyframe = (): void => {
    if (!context.selectedNodePath || !currentKf) return;
    const toTimeMs = resolveSnappedTargetTimeMs();
    if (toTimeMs === null) return;
    if (toTimeMs === currentKf.timeMs) {
      setStatusMessage('目标时间与当前关键帧相同。');
      return;
    }
    try {
      setStatusMessage(null);
      layerStore.moveFlaGraphicTimelineKeyframe(
        context.layerId,
        context.frameOrdinal,
        context.selectedNodePath,
        currentKf.timeMs,
        toTimeMs,
      );
      timelineUiStore.seekFlaGraphicInternalTime(
        toTimeMs,
        Math.max(rangeMaxMs, toTimeMs),
      );
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : '移动关键帧失败。',
      );
    }
  };

  const handleDuplicateKeyframe = (): void => {
    if (!context.selectedNodePath || !currentKf) return;
    const toTimeMs = resolveSnappedTargetTimeMs();
    if (toTimeMs === null) return;
    try {
      setStatusMessage(null);
      layerStore.duplicateFlaGraphicTimelineKeyframe(
        context.layerId,
        context.frameOrdinal,
        context.selectedNodePath,
        currentKf.timeMs,
        toTimeMs,
      );
      timelineUiStore.seekFlaGraphicInternalTime(
        toTimeMs,
        Math.max(rangeMaxMs, toTimeMs),
      );
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : '复制关键帧失败。',
      );
    }
  };

  const handleEasingChange = (easing: FlaGraphicTransformEasing): void => {
    if (!context.selectedNodePath || !currentKf) return;
    setStatusMessage(null);
    layerStore.setFlaGraphicTimelineKeyframeEasing(
      context.layerId,
      context.frameOrdinal,
      context.selectedNodePath,
      currentKf.timeMs,
      easing,
    );
  };

  return (
    <div
      className="timeline-lane fla-internal-timeline-bar"
      data-testid="fla-internal-timeline-bar"
    >
      <span className="timeline-lane-label">
        <span className="timeline-lane-label-text">元件内部</span>
      </span>
      <div
        className="timeline-lane-content fla-internal-timeline-controls"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '0 8px',
          flexWrap: 'wrap',
        }}
      >
        <button
          aria-pressed={context.timelineAuthoringActive}
          data-testid="fla-internal-authoring-toggle"
          data-ui-button
          data-ui-variant={context.timelineAuthoringActive ? 'primary' : 'secondary'}
          onClick={() =>
            timelineUiStore.setFlaGraphicTimelineAuthoringActive(
              !context.timelineAuthoringActive,
            )
          }
          type="button"
        >
          {context.timelineAuthoringActive ? '内部时间轴' : '基础姿势'}
        </button>
        <output data-testid="fla-internal-timecode">
          {formatTimecode(context.internalTimeMs)}
        </output>
        <input
          aria-label="元件内部时间"
          data-testid="fla-internal-time-scrubber"
          max={rangeMaxMs}
          min={0}
          onChange={(event) =>
            timelineUiStore.seekFlaGraphicInternalTime(
              Number(event.target.value),
              rangeMaxMs,
            )
          }
          step={frameStepMs}
          type="range"
          value={context.internalTimeMs}
        />
        {overviewTimes.map((timeMs) => (
          <button
            data-testid={`fla-internal-overview-key-${timeMs}`}
            data-ui-button
            data-ui-variant={timeMs === context.internalTimeMs ? 'primary' : 'secondary'}
            key={timeMs}
            onClick={() =>
              timelineUiStore.seekFlaGraphicInternalTime(timeMs, rangeMaxMs)
            }
            type="button"
          >
            {formatTimecode(timeMs)}
          </button>
        ))}
        {context.selectedNodePath && context.selectedNodePath.length > 0 ? (
          target?.authoringCapability === 'editable' ? (
            <>
              <button
                data-testid="fla-internal-prev-key"
                data-ui-button
                data-ui-variant="secondary"
                disabled={!prevKf}
                onClick={() =>
                  prevKf &&
                  timelineUiStore.seekFlaGraphicInternalTime(
                    prevKf.timeMs,
                    rangeMaxMs,
                  )
                }
                type="button"
              >
                上一键
              </button>
              <button
                data-testid="fla-internal-add-key"
                data-ui-button
                data-ui-variant="secondary"
                disabled={Boolean(currentKf)}
                onClick={handleAddKeyframe}
                type="button"
              >
                添加关键帧
              </button>
              <button
                data-testid="fla-internal-delete-key"
                data-ui-button
                data-ui-variant="secondary"
                disabled={!currentKf}
                onClick={handleDeleteKeyframe}
                type="button"
              >
                删除关键帧
              </button>
              <button
                data-testid="fla-internal-next-key"
                data-ui-button
                data-ui-variant="secondary"
                disabled={!nextKf}
                onClick={() =>
                  nextKf &&
                  timelineUiStore.seekFlaGraphicInternalTime(
                    nextKf.timeMs,
                    rangeMaxMs,
                  )
                }
                type="button"
              >
                下一键
              </button>
              <select
                aria-label="元件关键帧补间"
                data-testid="fla-internal-easing-select"
                disabled={!currentKf}
                onChange={(event) =>
                  handleEasingChange(event.target.value as FlaGraphicTransformEasing)
                }
                value={currentKf?.easing ?? 'linear'}
              >
                {EASING_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <input
                aria-label="目标关键帧时间"
                data-testid="fla-internal-target-time-input"
                disabled={!currentKf}
                min={0}
                onChange={(event) => setTargetTimeInput(event.target.value)}
                step={frameStepMs}
                style={{ width: '76px' }}
                type="number"
                value={targetTimeInput}
              />
              <button
                data-testid="fla-internal-move-key"
                data-ui-button
                data-ui-variant="secondary"
                disabled={!currentKf}
                onClick={handleMoveKeyframe}
                type="button"
              >
                移动关键帧
              </button>
              <button
                data-testid="fla-internal-duplicate-key"
                data-ui-button
                data-ui-variant="secondary"
                disabled={!currentKf}
                onClick={handleDuplicateKeyframe}
                type="button"
              >
                复制关键帧
              </button>
              {context.timelineAuthoringActive && !currentKf ? (
                <span data-testid="fla-internal-nokey-hint">
                  无键时间只读（请先添加关键帧）
                </span>
              ) : null}
            </>
          ) : (
            <span data-testid="fla-internal-readonly-node">
              {target?.authoringCapability === 'readonly-trs-unsafe'
                ? '当前节点含倾斜变换（只读）'
                : '当前节点不可建轨（只读）'}
            </span>
          )
        ) : (
          <span data-testid="fla-internal-select-hint">选择内部子节点以编辑关键帧</span>
        )}
        {statusMessage ? (
          <output data-testid="fla-internal-timeline-status">{statusMessage}</output>
        ) : null}
      </div>
    </div>
  );
}
