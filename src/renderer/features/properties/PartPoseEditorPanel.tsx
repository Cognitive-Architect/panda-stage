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
  ArrowLeft,
  Check,
  ChevronDown,
  LockKeyhole,
  MoreHorizontal,
  Plus,
} from 'lucide-react';
import { layerStore } from '../../stores/layerStore';
import { Button } from '../../ui';
import { useTimelineUi } from '../timeline/timelineUiStore';
import {
  resolvePartPoseEditorParts,
  type PartPoseEditorUi,
} from '../part-pose/partPoseEditorTypes';

export interface PartPoseEditorPanelProps {
  project: Project;
  shot: Shot;
  layer: Layer;
  editor: PartPoseEditorUi;
}

const KNOWN_PART_LABELS: Readonly<Record<string, string>> = {
  Torso: '身体',
  Head: '头部',
  'Upper arm': '上臂',
  Forearm: '前臂',
};

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

function getPartLabel(
  displayName: string | undefined,
  index: number,
): string {
  const name = displayName?.trim();
  if (!name) return `部件 ${index + 1}`;
  return KNOWN_PART_LABELS[name] ?? name;
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
  const selectedPartId = active
    ? editor.selectedPartId ?? parts[0]?.partId ?? null
    : null;
  const selectedPart = parts.find((part) => part.partId === selectedPartId);
  const track = layer.poseAnimation?.tracks.find(
    (candidate) => candidate.partId === selectedPartId,
  );
  const pivotLocked = Boolean(track && hasAuthoredPartPose(track));
  const canCalibratePivot = Boolean(
    active &&
      selectedPart &&
      selectedPart.visible !== false &&
      !layer.locked &&
      !pivotLocked,
  );
  const timeMs = timeline.currentTimeMs;
  const keyframe = track?.keys.find((key) => key.timeMs === timeMs);
  const pivotDraft =
    editor.pivotDraft?.layerId === layer.id &&
    editor.pivotDraft.partId === selectedPartId
      ? editor.pivotDraft.point
      : null;
  const timeIsValid = isValidFrameTime(timeMs) && timeMs <= shot.durationMs;
  const canEditKey = Boolean(
    active &&
      selectedPart &&
      !layer.locked &&
      selectedPart.visible !== false &&
      keyframe,
  );
  const canAddKey = Boolean(
    active &&
      selectedPart &&
      selectedPart.visible !== false &&
      !layer.locked &&
      timeIsValid &&
      !keyframe,
  );
  const keyReason = !timeIsValid
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

  const commitKey = (
    update: Partial<NonNullable<typeof keyframe>>,
  ): void => {
    if (!keyframe || !selectedPartId || !canEditKey) return;
    try {
      layerStore.setPartPoseKeyframe(layer.id, selectedPartId, {
        ...keyframe,
        ...update,
      });
    } catch (error) {
      setFeedback(readableError(error));
    }
  };

  if (!active) {
    return (
      <section
        aria-label="动作"
        className="part-pose-editor"
        data-testid="part-pose-editor-entry"
      >
        <div className="part-pose-editor-heading">
          <strong>动作</strong>
          <Button
            disabled={layer.locked || parts.length === 0}
            data-testid="part-pose-edit-action"
            onClick={() => {
              const firstPartId =
                parts.find((part) => part.visible !== false)?.partId ??
                parts[0]?.partId;
              if (firstPartId) editor.onStart(layer.id, firstPartId);
            }}
            type="button"
            variant="primary"
          >
            编辑动作
          </Button>
        </div>
      </section>
    );
  }

  const addKey = (): void => {
    if (!selectedPartId || !canAddKey) return;
    try {
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
      aria-label="动作编辑"
      className="part-pose-editor"
      data-layer-id={layer.id}
      data-testid="part-pose-editor"
    >
      <div className="part-pose-editor-heading">
        <strong>动作编辑</strong>
        <Button
          className="part-pose-editor-back"
          data-testid="part-pose-editor-back"
          onClick={editor.onExit}
          type="button"
          variant="secondary"
        >
          <ArrowLeft aria-hidden="true" className="ui-icon" focusable="false" size={16} />
          <span>返回</span>
        </Button>
      </div>

      <label className="part-pose-editor-part-row">
        <span className="part-pose-editor-label">零件</span>
        <span className="part-pose-editor-select-wrap">
          <select
            aria-label="当前零件"
            className="part-pose-editor-select"
            data-testid="part-pose-part-select"
            disabled={parts.length === 0}
            onChange={(event) => {
              if (event.currentTarget.value) {
                editor.onSelectPart(event.currentTarget.value);
              }
            }}
            value={selectedPartId ?? ''}
          >
            {parts.length === 0 ? (
              <option value="">没有可用零件</option>
            ) : null}
            {parts.map((part, index) => (
              <option key={part.partId} value={part.partId}>
                {getPartLabel(part.displayName, index)}
                {part.visible === false ? '（隐藏）' : ''}
              </option>
            ))}
          </select>
          <ChevronDown aria-hidden="true" className="ui-icon" focusable="false" size={16} />
        </span>
      </label>

      <div className="part-pose-editor-pivot" data-testid="part-pose-pivot-row">
        <span className="part-pose-editor-label">旋转点</span>
        {pivotLocked ? (
          <span
            aria-label="旋转点已固定"
            className="part-pose-editor-pivot-status is-fixed"
            data-testid="part-pose-pivot-fixed"
          >
            <LockKeyhole aria-hidden="true" className="ui-icon" focusable="false" size={14} />
            已固定
          </span>
        ) : editor.calibratingPivot ? (
          <>
            <span className="part-pose-editor-pivot-status">
              点击画布设置旋转点
            </span>
            <Button
              data-testid="part-pose-cancel-pivot"
              onClick={editor.onCancelPivot}
              type="button"
              variant="secondary"
            >
              取消
            </Button>
          </>
        ) : (
          <>
            <span className="part-pose-editor-pivot-status">
              {pivotDraft
                ? '新旋转点待关键帧保存'
                : track
                  ? '当前旋转点已保存'
                  : '当前使用部件中心'}
            </span>
            <Button
              disabled={!canCalibratePivot}
              data-testid="part-pose-set-pivot"
              onClick={() => {
                if (selectedPartId) editor.onStartPivot(layer.id, selectedPartId);
              }}
              type="button"
              variant="secondary"
            >
              设置旋转点
            </Button>
          </>
        )}
      </div>
      {!pivotLocked && !editor.calibratingPivot && pivotReason ? (
        <p className="part-pose-editor-inline-reason">{pivotReason}</p>
      ) : null}

      <div className="part-pose-editor-key" data-testid="part-pose-key-row">
        <span className="part-pose-editor-label">时间</span>
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
        <div aria-label="部件姿势精调" className="part-pose-editor-adjustments">
          <Button
            aria-label="逆时针旋转 15 度"
            disabled={!canEditKey}
            onClick={() => rotateBy(-15)}
            type="button"
            variant="secondary"
          >
            逆时针 15°
          </Button>
          <Button
            aria-label="顺时针旋转 15 度"
            disabled={!canEditKey}
            onClick={() => rotateBy(15)}
            type="button"
            variant="secondary"
          >
            顺时针 15°
          </Button>
          <Button
            disabled={!canEditKey || (keyframe?.scale ?? 0) <= CHARACTER_PART_MIN_SCALE}
            onClick={() => scaleBy(0.9)}
            type="button"
            variant="secondary"
          >
            缩小
          </Button>
          <Button
            disabled={!canEditKey || (keyframe?.scale ?? 0) >= CHARACTER_PART_MAX_SCALE}
            onClick={() => scaleBy(1.1)}
            type="button"
            variant="secondary"
          >
            放大
          </Button>
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
        <details className="part-pose-editor-more" data-testid="part-pose-more">
          <summary>
            <MoreHorizontal aria-hidden="true" className="ui-icon" focusable="false" size={16} />
            更多
          </summary>
          <div className="part-pose-editor-more-menu">
            {confirmClear ? (
              <>
                <p>清除后可通过撤销恢复。</p>
                <div className="part-pose-editor-confirm-actions">
                  <Button
                    data-testid="part-pose-confirm-clear"
                    onClick={clearAnimation}
                    type="button"
                    variant="danger"
                  >
                    确认清除
                  </Button>
                  <Button
                    data-testid="part-pose-cancel-clear"
                    onClick={() => setConfirmClear(false)}
                    type="button"
                    variant="secondary"
                  >
                    取消
                  </Button>
                </div>
              </>
            ) : (
              <Button
                className="part-pose-editor-clear"
                data-testid="part-pose-clear"
                onClick={() => setConfirmClear(true)}
                type="button"
                variant="danger"
              >
                清除本镜头动作
              </Button>
            )}
          </div>
        </details>
      ) : null}
    </section>
  );
}
