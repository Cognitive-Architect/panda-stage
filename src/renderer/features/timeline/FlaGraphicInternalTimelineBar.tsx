import { useState } from 'react';
import {
  collectFlaGraphicTimelineDurationMs,
  resolveFlaGraphicTimelineTarget,
  type FlaGraphicDefinition,
  type FlaGraphicTransformEasing,
  type Project,
} from '../../../domain';
import { layerStore } from '../../stores/layerStore';
import { formatTimecode } from './timeGeometry';
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

  const timelineDurationMs = collectFlaGraphicTimelineDurationMs(activeTimeline);
  const rangeMaxMs = Math.max(2_000, timelineDurationMs, context.internalTimeMs);
  const frameStepMs = Math.max(1, Math.round(1_000 / Math.max(1, context.fps)));

  const handleAddKeyframe = (): void => {
    if (!context.selectedNodePath || !target?.trackId) return;
    try {
      setStatusMessage(null);
      layerStore.addFlaGraphicTimelineKeyframe(
        context.layerId,
        context.frameOrdinal,
        context.selectedNodePath,
        context.internalTimeMs,
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
          target?.trackId ? (
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
            </>
          ) : (
            <span data-testid="fla-internal-readonly-node">
              当前节点不可建轨（只读）
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
