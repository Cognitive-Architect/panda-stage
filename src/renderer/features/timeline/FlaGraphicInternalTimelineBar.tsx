import { useState } from 'react';
import {
  collectFlaGraphicTimelineDurationMs,
  listFlaGraphicIdentityAliasGroups,
  resolveFlaGraphicTimelineTarget,
  type FlaGraphicDefinition,
  type FlaGraphicIdentityAliasGroup,
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

function identityAliasGroupLabel(
  group: FlaGraphicIdentityAliasGroup,
  index: number,
): string {
  const first = group.assignments[0];
  const frameMatch = first
    ? /^frame:(\d+)$/u.exec(first.containerKey)
    : null;
  const scope = frameMatch
    ? `第 ${Number(frameMatch[1]) + 1} 帧`
    : '共享元件';
  return `关联身份 ${index + 1}（${scope}，${group.assignments.length} 个节点）`;
}

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
  const [associationOpen, setAssociationOpen] = useState(false);
  const [associationGroupId, setAssociationGroupId] = useState('');
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
  const identityAliasGroups = listFlaGraphicIdentityAliasGroups(structure);

  const handleAssociateIdentity = (): void => {
    if (!context.selectedNodePath) return;
    try {
      setStatusMessage(null);
      layerStore.setFlaGraphicNodeIdentityAlias(
        context.layerId,
        context.frameOrdinal,
        context.selectedNodePath,
        associationGroupId || undefined,
      );
      setAssociationOpen(false);
      setAssociationGroupId('');
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : '建立节点关联失败。',
      );
    }
  };

  const handleClearIdentityAssociation = (): void => {
    if (!context.selectedNodePath) return;
    try {
      setStatusMessage(null);
      layerStore.clearFlaGraphicNodeIdentityAlias(
        context.layerId,
        context.frameOrdinal,
        context.selectedNodePath,
      );
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : '解除节点关联失败。',
      );
    }
  };

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
          ) : target?.authoringCapability === 'readonly-identity' ? (
            <>
              <span data-testid="fla-internal-readonly-node">
                当前节点无稳定身份（只读）
              </span>
              <button
                data-testid="fla-internal-associate-identity-open"
                data-ui-button
                data-ui-variant="secondary"
                onClick={() => setAssociationOpen(true)}
                type="button"
              >
                建立节点关联
              </button>
              {associationOpen ? (
                <span
                  className="fla-internal-identity-association"
                  data-testid="fla-internal-identity-association"
                >
                  <select
                    aria-label="关联身份"
                    data-testid="fla-internal-identity-group"
                    onChange={(event) =>
                      setAssociationGroupId(event.target.value)
                    }
                    value={associationGroupId}
                  >
                    <option value="">新建关联身份</option>
                    {identityAliasGroups.map((group, index) => (
                      <option key={group.aliasId} value={group.aliasId}>
                        {identityAliasGroupLabel(group, index)}
                      </option>
                    ))}
                  </select>
                  <button
                    data-testid="fla-internal-associate-identity-confirm"
                    data-ui-button
                    data-ui-variant="primary"
                    onClick={handleAssociateIdentity}
                    type="button"
                  >
                    建立关联
                  </button>
                  <button
                    data-testid="fla-internal-associate-identity-cancel"
                    data-ui-button
                    data-ui-variant="secondary"
                    onClick={() => {
                      setAssociationOpen(false);
                      setAssociationGroupId('');
                    }}
                    type="button"
                  >
                    取消
                  </button>
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
        {target?.identitySource === 'alias' ? (
          <span
            className="fla-internal-identity-association"
            data-testid="fla-internal-identity-association-status"
          >
            已建立节点关联
            <button
              data-testid="fla-internal-clear-identity-association"
              data-ui-button
              data-ui-variant="secondary"
              onClick={handleClearIdentityAssociation}
              type="button"
            >
              解除关联
            </button>
          </span>
        ) : null}
        {statusMessage ? (
          <output data-testid="fla-internal-timeline-status">{statusMessage}</output>
        ) : null}
      </div>
    </div>
  );
}
