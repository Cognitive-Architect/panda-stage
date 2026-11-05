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
import { layerStore } from '../../stores/layerStore';
import { useTimelineUi } from '../timeline/timelineUiStore';
import type { PartPoseEditorUi } from '../part-pose/partPoseEditorTypes';

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
  if (message.includes('Shot duration')) return '关键帧必须位于当前镜头内。';
  if (message.includes('pivot')) {
    return '该零件已有动作姿势；清除本镜头动作后才能重新设置旋转点。';
  }
  return '动作没有保存，请调整后重试。';
}

function formatTime(timeMs: number): string {
  return `${(timeMs / 1000).toFixed(2)} 秒`;
}

export function PartPoseEditorPanel({
  project,
  shot,
  layer,
  editor,
}: PartPoseEditorPanelProps): React.JSX.Element | null {
  const timeline = useTimelineUi();
  const [feedback, setFeedback] = useState('');
  useEffect(
    () => setFeedback(''),
    [editor.selectedPartId, layer.id, timeline.currentTimeMs],
  );
  const active = editor.activeLayerId === layer.id;
  const source = layer.source;
  const character =
    source.kind === 'character'
      ? project.characters.find(
          (candidate) => candidate.id === source.characterId,
        )
      : undefined;
  if (!character || character.mode !== 'adaptive-parts') return null;

  const parts = [...character.parts].sort(
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

  const commitKey = (
    update: Partial<NonNullable<typeof keyframe>>,
  ): void => {
    if (!keyframe || !selectedPartId || !canEditKey) return;
    try {
      layerStore.setPartPoseKeyframe(layer.id, selectedPartId, {
        ...keyframe,
        ...update,
      });
      setFeedback('姿势已更新。');
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
          <button
            disabled={layer.locked || parts.length === 0}
            data-testid="part-pose-edit-action"
            onClick={() => {
              const firstPartId =
                parts.find((part) => part.visible !== false)?.partId ??
                parts[0]?.partId;
              if (firstPartId) editor.onStart(layer.id, firstPartId);
            }}
            type="button"
          >
            编辑动作
          </button>
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
      setFeedback(`${formatTime(timeMs)}关键帧已添加。`);
    } catch (error) {
      setFeedback(readableError(error));
    }
  };

  const clearAnimation = (): void => {
    try {
      layerStore.clearPartPoseAnimation(layer.id);
      editor.onPivotUsed();
      setFeedback('本镜头动作已清除。');
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
        <strong>动作</strong>
        <button onClick={editor.onExit} type="button">退出</button>
      </div>
      <div aria-label="选择部件" className="part-pose-editor-parts">
        {parts.map((part, index) => {
          const label = part.displayName?.trim() || `部件 ${index + 1}`;
          const selected = part.partId === selectedPartId;
          return (
            <button
              aria-pressed={selected}
              className="part-pose-editor-part"
              data-testid={`part-pose-part-${index}`}
              key={part.partId}
              onClick={() => editor.onSelectPart(part.partId)}
              type="button"
            >
              {label}{part.visible === false ? '（隐藏）' : ''}
            </button>
          );
        })}
      </div>
      <div className="part-pose-editor-pivot">
        {editor.calibratingPivot ? (
          <>
            <span>点击画布设置旋转点</span>
            <button onClick={editor.onCancelPivot} type="button">取消</button>
          </>
        ) : (
          <>
            <span>
              {pivotLocked
                ? '已有动作，清除后可重设旋转点'
                : pivotDraft
                  ? '旋转点待随首帧保存'
                  : track
                    ? '旋转点已保存'
                    : '默认使用部件中心'}
            </span>
            <button
              disabled={!canCalibratePivot}
              data-testid="part-pose-set-pivot"
              onClick={() => {
                if (selectedPartId) editor.onStartPivot(layer.id, selectedPartId);
              }}
              type="button"
            >
              {track || pivotDraft ? '重设旋转点' : '设置旋转点'}
            </button>
          </>
        )}
      </div>
      <div className="part-pose-editor-key">
        <button
          data-testid="part-pose-add-key"
          disabled={!canAddKey}
          onClick={addKey}
          type="button"
        >
          添加关键帧 · {formatTime(timeMs)}
        </button>
        {keyframe ? (
          <span>{timeMs === 0 ? '0 秒基准帧' : '当前时间已有关键帧'}</span>
        ) : !timeIsValid ? (
          <span>时间不在镜头范围内，请移动时间指针。</span>
        ) : !selectedPart?.visible && selectedPart ? (
          <span>该部件已隐藏。</span>
        ) : null}
      </div>
      <div aria-label="部件姿势调整" className="part-pose-editor-adjustments">
        <button
          aria-label="逆时针旋转 15 度"
          disabled={!canEditKey}
          onClick={() => rotateBy(-15)}
          type="button"
        >
          逆时针 15°
        </button>
        <button
          aria-label="顺时针旋转 15 度"
          disabled={!canEditKey}
          onClick={() => rotateBy(15)}
          type="button"
        >
          顺时针 15°
        </button>
        <button
          disabled={!canEditKey || keyframe!.scale <= CHARACTER_PART_MIN_SCALE}
          onClick={() => scaleBy(0.9)}
          type="button"
        >
          缩小
        </button>
        <button
          disabled={!canEditKey || keyframe!.scale >= CHARACTER_PART_MAX_SCALE}
          onClick={() => scaleBy(1.1)}
          type="button"
        >
          放大
        </button>
      </div>
      <p aria-live="polite" className="part-pose-editor-feedback" role="status">
        {feedback || (keyframe ? '' : '先添加关键帧，再拖动、旋转或缩放部件。')}
      </p>
      {layer.poseAnimation ? (
        <button
          className="part-pose-editor-clear"
          onClick={clearAnimation}
          type="button"
        >
          清除本镜头动作
        </button>
      ) : null}
    </section>
  );
}
