import { useState } from 'react';
import {
  collectFlaGraphicTimelineDurationMs,
  isNativeFlaGraphicDefinition,
  listFlaGraphicIdentityAliasGroups,
  listNativeGraphicExposureFrames,
  resolveFlaGraphicTimelineTarget,
  type FlaGraphicDefinition,
  type FlaGraphicIdentityAliasGroup,
  type FlaGraphicStructureNode,
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
  const [exposureFrameOrdinal, setExposureFrameOrdinal] = useState(0);
  const [exposureFrameCount, setExposureFrameCount] = useState('1');
  const [exposureLayerIndex, setExposureLayerIndex] = useState(0);
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
  const nativeDefinition = isNativeFlaGraphicDefinition(animation) ? animation : null;
  const nativeFrames = nativeDefinition
    ? listNativeGraphicExposureFrames(nativeDefinition)
    : [];
  const activeExposureIndex = nativeFrames.length > 0
    ? Math.min(exposureFrameOrdinal, nativeFrames.length - 1)
    : 0;
  const activeExposure = nativeFrames[activeExposureIndex] ?? null;
  const activeAuthoredFrame =
    nativeDefinition && activeExposure
      ? nativeDefinition.structure!.frames.find(
          (frame) => frame.ordinal === activeExposure.authoredOrdinal,
        ) ?? null
      : null;
  const exposureLayers = activeAuthoredFrame?.layers ?? [];
  const activeLayerIndex = exposureLayers.length > 0
    ? Math.min(exposureLayerIndex, exposureLayers.length - 1)
    : 0;
  const selectedStructureNode: FlaGraphicStructureNode | null =
    target?.targetNode ?? null;
  const canUngroupSelected = Boolean(
    nativeDefinition &&
      selectedStructureNode?.type === 'group' &&
      context.selectedNodePath?.length === 1,
  );

  const runExposureOperation = (operation: () => void): void => {
    try {
      setStatusMessage(null);
      operation();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '曝光编辑失败。');
    }
  };

  const resolveExposureCount = (): number | null => {
    const parsed = Number(exposureFrameCount);
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
      setStatusMessage('曝光帧数必须为正整数。');
      return null;
    }
    return parsed;
  };

  const handleInsertBlankKeyframe = (): void => {
    if (!nativeDefinition) return;
    runExposureOperation(() => {
      const ordinal = layerStore.addNativeGraphicBlankKeyframe(
        nativeDefinition.id,
        activeExposureIndex,
      );
      setExposureFrameOrdinal(ordinal);
    });
  };

  const handleCopyFrame = (): void => {
    if (!nativeDefinition) return;
    runExposureOperation(() => {
      const ordinal = layerStore.copyNativeGraphicFrame(
        nativeDefinition.id,
        activeExposureIndex,
      );
      setExposureFrameOrdinal(ordinal);
    });
  };

  const handleExtendExposure = (): void => {
    if (!nativeDefinition) return;
    const count = resolveExposureCount();
    if (count === null) return;
    runExposureOperation(() => {
      layerStore.extendNativeGraphicExposure(nativeDefinition.id, count);
    });
  };

  const handleShortenExposure = (): void => {
    if (!nativeDefinition) return;
    const count = resolveExposureCount();
    if (count === null) return;
    runExposureOperation(() => {
      layerStore.shortenNativeGraphicExposure(nativeDefinition.id, count);
    });
  };

  const handleAddLayer = (): void => {
    if (!nativeDefinition) return;
    runExposureOperation(() => {
      layerStore.addNativeGraphicLayer(nativeDefinition.id, activeExposureIndex);
    });
  };

  const handleRemoveLayer = (): void => {
    if (!nativeDefinition || exposureLayers.length === 0) return;
    runExposureOperation(() => {
      layerStore.removeNativeGraphicLayer(
        nativeDefinition.id,
        activeExposureIndex,
        activeLayerIndex,
      );
    });
  };

  const handleMoveLayer = (direction: 1 | -1): void => {
    if (!nativeDefinition || exposureLayers.length === 0) return;
    runExposureOperation(() => {
      layerStore.moveNativeGraphicLayer(
        nativeDefinition.id,
        activeExposureIndex,
        activeLayerIndex,
        direction,
      );
    });
  };

  const handleUngroupNode = (): void => {
    if (!nativeDefinition || !context.selectedNodePath) return;
    runExposureOperation(() => {
      layerStore.ungroupNativeGraphicNode(
        nativeDefinition.id,
        activeExposureIndex,
        context.selectedNodePath!,
      );
    });
  };

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
    ...new Set([
      ...(activeTimeline?.tracks ?? []).flatMap((track) =>
        track.keyframes.map((kf) => kf.timeMs),
      ),
      ...(structure.shapeTweenTracks ?? []).flatMap((track) => [
        track.startTimeMs,
        track.endTimeMs,
      ]),
    ]),
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
                ? '当前节点变换含退化或无法无损分解的分量（只读）'
                : target?.authoringCapability === 'readonly-affine-unsafe'
                  ? '相邻关键帧缩放方向相反，补间会经过退化帧（只读）'
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
        {nativeDefinition ? (
          <span
            className="fla-internal-exposure-controls"
            data-testid="fla-internal-exposure-controls"
          >
            <select
              aria-label="曝光帧"
              data-testid="fla-internal-exposure-frame"
              onChange={(event) => {
                setExposureFrameOrdinal(Number(event.target.value));
                setExposureLayerIndex(0);
              }}
              value={activeExposureIndex}
            >
              {nativeFrames.map((frame, index) => (
                <option key={frame.ordinal} value={index}>
                  {`帧 ${index + 1}${frame.held ? '（保持）' : frame.blank ? '（空白）' : ''}`}
                </option>
              ))}
            </select>
            <button
              data-testid="fla-internal-insert-blank-frame"
              data-ui-button
              data-ui-variant="secondary"
              onClick={handleInsertBlankKeyframe}
              type="button"
            >
              插入空白关键帧
            </button>
            <button
              data-testid="fla-internal-copy-frame"
              data-ui-button
              data-ui-variant="secondary"
              onClick={handleCopyFrame}
              type="button"
            >
              复制帧
            </button>
            <input
              aria-label="曝光帧数"
              data-testid="fla-internal-exposure-count"
              min={1}
              onChange={(event) => setExposureFrameCount(event.target.value)}
              step={1}
              style={{ width: '56px' }}
              type="number"
              value={exposureFrameCount}
            />
            <button
              data-testid="fla-internal-extend-exposure"
              data-ui-button
              data-ui-variant="secondary"
              onClick={handleExtendExposure}
              type="button"
            >
              延长曝光
            </button>
            <button
              data-testid="fla-internal-shorten-exposure"
              data-ui-button
              data-ui-variant="secondary"
              onClick={handleShortenExposure}
              type="button"
            >
              缩短曝光
            </button>
            {exposureLayers.length > 0 ? (
              <>
                <select
                  aria-label="曝光帧图层"
                  data-testid="fla-internal-exposure-layer"
                  onChange={(event) => setExposureLayerIndex(Number(event.target.value))}
                  value={activeLayerIndex}
                >
                  {exposureLayers.map((layer, index) => (
                    <option key={`${layer.name}-${index}`} value={index}>
                      {layer.name || `图层 ${index + 1}`}
                    </option>
                  ))}
                </select>
                <button
                  data-testid="fla-internal-add-layer"
                  data-ui-button
                  data-ui-variant="secondary"
                  onClick={handleAddLayer}
                  type="button"
                >
                  新增层
                </button>
                <button
                  data-testid="fla-internal-remove-layer"
                  data-ui-button
                  data-ui-variant="secondary"
                  onClick={handleRemoveLayer}
                  type="button"
                >
                  删除层
                </button>
                <button
                  data-testid="fla-internal-move-layer-backward"
                  data-ui-button
                  data-ui-variant="secondary"
                  onClick={() => handleMoveLayer(-1)}
                  type="button"
                >
                  层后移
                </button>
                <button
                  data-testid="fla-internal-move-layer-forward"
                  data-ui-button
                  data-ui-variant="secondary"
                  onClick={() => handleMoveLayer(1)}
                  type="button"
                >
                  层前移
                </button>
                {canUngroupSelected ? (
                  <button
                    data-testid="fla-internal-ungroup"
                    data-ui-button
                    data-ui-variant="secondary"
                    onClick={handleUngroupNode}
                    type="button"
                  >
                    解组
                  </button>
                ) : null}
              </>
            ) : (
              <button
                data-testid="fla-internal-add-layer"
                data-ui-button
                data-ui-variant="secondary"
                onClick={handleAddLayer}
                type="button"
              >
                新增层
              </button>
            )}
          </span>
        ) : null}
        {statusMessage ? (
          <output data-testid="fla-internal-timeline-status">{statusMessage}</output>
        ) : null}
      </div>
    </div>
  );
}
