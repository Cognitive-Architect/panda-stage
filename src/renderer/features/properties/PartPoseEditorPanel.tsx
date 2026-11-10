import { useEffect, useState } from 'react';
import {
  CHARACTER_PART_MAX_SCALE,
  CHARACTER_PART_MIN_SCALE,
  hasAuthoredPartPose,
  isValidFrameTime,
  type Layer,
  type Project,
  type Shot,
} from '../../../domain';
import {
  CircleCheck,
  Check,
  ChevronDown,
  LockKeyhole,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { layerStore } from '../../stores/layerStore';
import { Button, IconButton } from '../../ui';
import { useTimelineUi } from '../timeline/timelineUiStore';
import {
  canAddPartPoseKeyAtTime,
  getPartPosePartLabel,
  resolvePartPoseEditorParts,
  type PartPoseEditorUi,
} from '../part-pose/partPoseEditorTypes';

export interface PartPoseEditorPanelProps {
  project: Project;
  shot: Shot;
  layer: Layer;
  editor: PartPoseEditorUi;
}

function readableError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('locked')) return '该角色图层已锁定，无法编辑动作。';
  if (message.includes('stale') || message.includes('changed')) {
    return '工程或镜头已变化，操作已取消。';
  }
  if (message.includes('already has a keyframe') || message.includes('已有关键帧')) {
    return '当前时间已有关键帧，可直接在画布上编辑。';
  }
  if (message.includes('frame grid')) return '请把时间指针移到有效帧。';
  if (message.includes('Shot duration')) return '关键帧必须位于当前镜头范围内。';
  if (message.includes('pivot')) {
    return '该零件已有动作姿势；清除本镜头动作后才能重新设置旋转点。';
  }
  return '动作没有保存，请调整后重试。';
}

function formatTime(timeMs: number): string {
  const seconds = Math.floor(timeMs / 1_000);
  const milliseconds = Math.abs(timeMs % 1_000);
  return `${String(seconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')} 秒`;
}

export function PartPoseEditorPanel({
  project,
  shot,
  layer,
  editor,
}: PartPoseEditorPanelProps): React.JSX.Element | null {
  const timeline = useTimelineUi();
  const [feedback, setFeedback] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  useEffect(() => {
    setFeedback('');
    setConfirmClear(false);
  }, [editor.selectedPartId, layer.id, timeline.currentTimeMs]);

  const active = editor.activeLayerId === layer.id;
  const source = layer.source;
  const character =
    source.kind === 'character'
      ? project.characters.find(
          (candidate) => candidate.id === source.characterId,
        )
      : undefined;
  if (!character || character.mode !== 'adaptive-parts') return null;

  const parts = [...resolvePartPoseEditorParts(character, layer)].sort(
    (left, right) => left.drawOrder - right.drawOrder,
  );
  const selectedPartId = editor.selectedPartId ?? parts[0]?.partId ?? null;
  const selectedPart = parts.find((part) => part.partId === selectedPartId);
  const selectedPartIndex = parts.findIndex(
    (part) => part.partId === selectedPartId,
  );
  const selectedPartLabel = selectedPart
    ? `${getPartPosePartLabel(selectedPart.displayName, selectedPartIndex)}${
        selectedPart.visible === false ? '（隐藏）' : ''
      }`
    : '当前零件';
  const track = layer.poseAnimation?.tracks.find(
    (candidate) => candidate.partId === selectedPartId,
  );
  const pivotLocked = Boolean(track && hasAuthoredPartPose(track));
  const canCalibratePivot = Boolean(
    selectedPart &&
      selectedPart.visible !== false &&
      !layer.locked &&
      !pivotLocked &&
      !editor.calibratingPivot,
  );
  const timeMs = timeline.currentTimeMs;
  const keyframe = track?.keys.find((key) => key.timeMs === timeMs);
  const pivotDraft =
    editor.pivotDraft?.layerId === layer.id &&
    editor.pivotDraft.partId === selectedPartId
      ? editor.pivotDraft.point
      : null;
  const pivotCrop = selectedPart?.imageMapping.crop ?? null;
  const defaultPivot = pivotCrop
    ? {
        x: pivotCrop.x + pivotCrop.width / 2,
        y: pivotCrop.y + pivotCrop.height / 2,
      }
    : null;
  const pivotCalibrated = Boolean(
    track &&
      defaultPivot &&
      (Math.abs(track.pivotSource.x - defaultPivot.x) > 1e-4 ||
        Math.abs(track.pivotSource.y - defaultPivot.y) > 1e-4),
  );
  const timeIsValid = isValidFrameTime(timeMs) && timeMs <= shot.durationMs;
  const canEditKey = Boolean(
    selectedPart &&
      !layer.locked &&
      selectedPart.visible !== false &&
      keyframe &&
      !editor.calibratingPivot,
  );
  const canAddKey = canAddPartPoseKeyAtTime({
    part: selectedPart,
    layerLocked: layer.locked,
    timeMs,
    durationMs: shot.durationMs,
    hasKeyAtTime: Boolean(keyframe),
    calibratingPivot: editor.calibratingPivot,
  });
  const keyReason = editor.calibratingPivot
    ? '正在校准旋转点，请先完成或取消。'
    : !timeIsValid
    ? '当前时间超出镜头范围，无法添加关键帧。'
    : layer.locked
      ? '图层已锁定，无法编辑关键帧。'
      : !selectedPart
        ? '当前没有可编辑零件。'
        : selectedPart.visible === false
          ? '当前零件已隐藏，无法编辑关键帧。'
          : '';
  const pivotReason = layer.locked
    ? '图层已锁定，无法设置旋转点。'
    : selectedPart?.visible === false
      ? '当前零件已隐藏，无法设置旋转点。'
      : '';
  const pivotActionLabel =
    pivotCalibrated || pivotDraft ? '重新设置旋转点' : '设置旋转点';
  const pivotActionReason = pivotLocked
    ? '已有动作姿势，旋转点已固定'
    : pivotReason;
  const pivotStatusAccessibleLabel = pivotLocked
    ? pivotCalibrated
      ? '旋转点已校准，已有动作姿势，旋转点已固定'
      : '旋转点未设置，已有动作姿势，旋转点已固定'
    : pivotDraft
      ? '新旋转点待保存'
      : pivotCalibrated
        ? '旋转点已校准'
        : '旋转点未设置';

  const commitKey = (
    update: Partial<NonNullable<typeof keyframe>>,
  ): void => {
    if (!keyframe || !selectedPartId || !canEditKey) return;
    try {
      if (!active) editor.onStart(layer.id, selectedPartId);
      layerStore.setPartPoseKeyframe(layer.id, selectedPartId, {
        ...keyframe,
        ...update,
      });
    } catch (error) {
      setFeedback(readableError(error));
    }
  };

  const addKey = (): void => {
    if (!selectedPartId || !canAddKey) return;
    try {
      if (!active) editor.onStart(layer.id, selectedPartId);
      layerStore.addPartPoseKeyframe(
        layer.id,
        selectedPartId,
        timeMs,
        pivotDraft ?? undefined,
      );
      editor.onPivotUsed();
    } catch (error) {
      setFeedback(readableError(error));
    }
  };

  const clearAnimation = (): void => {
    try {
      layerStore.clearPartPoseAnimation(layer.id);
      editor.onPivotUsed();
      setConfirmClear(false);
    } catch (error) {
      setFeedback(readableError(error));
    }
  };

  const rotateBy = (amount: number): void => {
    if (!keyframe) return;
    commitKey({ rotationDeg: keyframe.rotationDeg + amount });
  };
  const scaleBy = (factor: number): void => {
    if (!keyframe) return;
    const scale = Math.max(
      CHARACTER_PART_MIN_SCALE,
      Math.min(CHARACTER_PART_MAX_SCALE, keyframe.scale * factor),
    );
    commitKey({ scale });
  };

  return (
    <section
      aria-label="部位"
      className="part-pose-editor"
      data-layer-id={layer.id}
      data-testid="part-pose-editor"
    >
      <div className="part-pose-editor-heading">
        <strong>部位</strong>
        <label className="part-pose-editor-part-row">
          <span className="part-pose-editor-visually-hidden">当前部位</span>
          <span className="part-pose-editor-select-wrap">
            <select
              aria-label="当前部位"
              className="part-pose-editor-select"
              data-testid="part-pose-part-select"
              disabled={parts.length === 0 || (layer.locked && !active)}
              onChange={(event) => {
                const partId = event.currentTarget.value;
                if (!partId) return;
                if (active) editor.onSelectPart(partId);
                else editor.onStart(layer.id, partId);
              }}
              title={selectedPartLabel}
              value={selectedPartId ?? ''}
            >
              {parts.length === 0 ? (
                <option value="">没有可用零件</option>
              ) : null}
              {parts.map((part, index) => (
                <option key={part.partId} value={part.partId}>
                  {getPartPosePartLabel(part.displayName, index)}
                  {part.visible === false ? '（隐藏）' : ''}
                </option>
              ))}
            </select>
            <ChevronDown aria-hidden="true" className="ui-icon" focusable="false" size={16} />
          </span>
        </label>
      </div>

      <div className="part-pose-editor-pivot" data-testid="part-pose-pivot-row">
        <span className="part-pose-editor-label">旋转点</span>
        <span
          aria-label={pivotStatusAccessibleLabel}
          className={`part-pose-editor-pivot-status${pivotLocked ? ' is-fixed' : ''}`}
          data-testid={pivotLocked ? 'part-pose-pivot-fixed' : 'part-pose-pivot-status'}
          title={pivotLocked ? '已有动作姿势，旋转点已固定' : undefined}
        >
          {pivotDraft && !pivotLocked ? (
            '新旋转点待保存'
          ) : pivotCalibrated ? (
            <span
              aria-label="旋转点已校准"
              className="part-pose-editor-pivot-calibrated"
              data-testid="part-pose-pivot-calibrated"
              title="旋转点已校准"
            >
              <CircleCheck aria-hidden="true" className="ui-icon" focusable="false" size={14} />
            </span>
          ) : (
            '未设置'
          )}
          {pivotLocked ? (
            <LockKeyhole aria-hidden="true" className="ui-icon" focusable="false" size={14} />
          ) : null}
        </span>
        {editor.calibratingPivot ? (
          <Button
            data-testid="part-pose-cancel-pivot"
            onClick={editor.onCancelPivot}
            type="button"
            variant="secondary"
          >
            取消
          </Button>
        ) : (
          <IconButton
            aria-label={
              pivotActionReason
                ? `${pivotActionLabel}，${pivotActionReason}`
                : pivotActionLabel
            }
            className="part-pose-editor-pivot-action"
            disabled={!canCalibratePivot}
            data-testid="part-pose-set-pivot"
            onClick={() => {
              if (selectedPartId) editor.onStartPivot(layer.id, selectedPartId);
            }}
            title={pivotActionReason || pivotActionLabel}
            type="button"
            variant="secondary"
            icon={<RotateCcw aria-hidden="true" className="ui-icon" focusable="false" size={16} />}
          />
        )}
      </div>
      {!pivotLocked && !editor.calibratingPivot && pivotReason ? (
        <p className="part-pose-editor-inline-reason">{pivotReason}</p>
      ) : null}

      <div className="part-pose-editor-key" data-testid="part-pose-key-row">
        <span className="part-pose-editor-time">{formatTime(timeMs)}</span>
        {keyframe ? (
          <span
            className="part-pose-editor-key-present"
            data-testid="part-pose-key-present"
          >
            <Check aria-hidden="true" className="ui-icon" focusable="false" size={15} />
            已有关键帧
          </span>
        ) : (
          <Button
            className="part-pose-editor-add-key"
            data-testid="part-pose-add-key"
            disabled={!canAddKey}
            onClick={addKey}
            type="button"
            variant="secondary"
          >
            <Plus aria-hidden="true" className="ui-icon" focusable="false" size={16} />
            关键帧
          </Button>
        )}
      </div>
      {keyReason ? (
        <p className="part-pose-editor-inline-reason" data-testid="part-pose-key-reason">
          {keyReason}
        </p>
      ) : null}

      <details
        className="part-pose-editor-fine"
        data-testid="part-pose-fine"
      >
        <summary>
          <span>精调</span>
          <ChevronDown aria-hidden="true" className="ui-icon" focusable="false" size={16} />
        </summary>
        <div aria-label="零件姿势精调" className="part-pose-editor-adjustments">
          <div className="part-pose-editor-adjustment-row part-pose-editor-rotation-controls" data-testid="part-pose-rotation-controls">
            <span>旋转</span>
            <Button
              aria-label="逆时针旋转 15 度"
              disabled={!canEditKey}
              onClick={() => rotateBy(-15)}
              type="button"
              variant="secondary"
            >
              <span aria-hidden="true" className="part-pose-editor-rotation-icon">↶</span>
              <span>15°</span>
            </Button>
            <Button
              aria-label="顺时针旋转 15 度"
              disabled={!canEditKey}
              onClick={() => rotateBy(15)}
              type="button"
              variant="secondary"
            >
              <span aria-hidden="true" className="part-pose-editor-rotation-icon">↷</span>
              <span>15°</span>
            </Button>
          </div>
          <div className="part-pose-editor-adjustment-row part-pose-editor-scale-controls" data-testid="part-pose-scale-controls">
            <span>缩放</span>
            <div aria-label="零件缩放" className="part-pose-editor-scale-stepper" role="group">
              <Button
                aria-label="缩小零件"
                disabled={!canEditKey || (keyframe?.scale ?? CHARACTER_PART_MIN_SCALE) <= CHARACTER_PART_MIN_SCALE}
                onClick={() => scaleBy(0.9)}
                type="button"
                variant="secondary"
              >
                −
              </Button>
              <output aria-label="零件缩放" data-testid="part-pose-scale-value">
                {String(Number(((keyframe?.scale ?? 1) * 100).toFixed(1)))}%
              </output>
              <Button
                aria-label="放大零件"
                disabled={!canEditKey || (keyframe?.scale ?? CHARACTER_PART_MAX_SCALE) >= CHARACTER_PART_MAX_SCALE}
                onClick={() => scaleBy(1.1)}
                type="button"
                variant="secondary"
              >
                +
              </Button>
            </div>
          </div>
        </div>
      </details>

      {feedback ? (
        <p
          aria-live="assertive"
          className="part-pose-editor-feedback"
          data-testid="part-pose-editor-feedback"
          role="alert"
        >
          {feedback}
        </p>
      ) : null}

      {layer.poseAnimation ? (
        confirmClear ? (
          <div className="part-pose-editor-clear-confirm" data-testid="part-pose-clear-confirm">
            <span>
              清除当前镜头当前人物实例的所有零件姿势，并恢复角色库当前默认姿势？
              角色库若已更新，恢复结果可能与冻结的旧镜头不同。
            </span>
            <div className="part-pose-editor-confirm-actions">
              <Button
                data-testid="part-pose-cancel-clear"
                onClick={() => setConfirmClear(false)}
                type="button"
                variant="secondary"
              >
                取消
              </Button>
              <Button
                data-testid="part-pose-confirm-clear"
                onClick={clearAnimation}
                type="button"
                variant="danger"
              >
                确认清除
              </Button>
            </div>
          </div>
        ) : (
          <Button
            className="part-pose-editor-clear"
            data-testid="part-pose-clear"
            onClick={() => setConfirmClear(true)}
            type="button"
            variant="secondary"
          >
            <Trash2
              aria-hidden="true"
              className="ui-icon"
              focusable="false"
              size={14}
            />
            清除全部零件动作
          </Button>
        )
      ) : null}
    </section>
  );
}
