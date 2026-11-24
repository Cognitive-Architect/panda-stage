import { useState, useSyncExternalStore } from 'react';
import {
  PROJECT_HEIGHT,
  PROJECT_WIDTH,
  RADIAL_BURST_DEFAULT_COUNT,
  RADIAL_BURST_DEFAULT_DURATION_FRAMES,
  RADIAL_BURST_DEFAULT_MAX_ROTATION_DEG,
  RADIAL_BURST_DEFAULT_RADIUS,
  RADIAL_BURST_DEFAULT_SEED,
  RADIAL_BURST_DEFAULT_STAGGER_FRAMES,
  RADIAL_BURST_DEFAULT_START_ANGLE_DEG,
  RADIAL_BURST_MAX_COUNT,
  RADIAL_BURST_MAX_SEED,
  RADIAL_BURST_MIN_COUNT,
  TIMELINE_FPS,
  evaluateShotAtTime,
  frameTimeMs,
  isFlaGraphicDefinition,
  lastValidFrameTime,
  resolveTimelineFrameTime,
  type Layer,
  type Project,
  type RadialBurstInput,
  type Shot,
} from '../../../domain';
import { useTimelineUi } from '../timeline/timelineUiStore';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { layerStore } from '../../stores/layerStore';
import { selectionStore } from '../../stores/selectionStore';
import { shotStore } from '../../stores/shotStore';
import { Button, SegmentedTabs } from '../../ui';

export interface RadialBurstPanelProps {
  onCancel(): void;
}

interface RadialBurstTarget {
  readonly key: string;
  readonly project: Project;
  readonly shot: Shot;
  readonly layer: Layer;
  readonly maxFrame: number;
}

type RadialBurstTargetState =
  | { readonly ok: true; readonly target: RadialBurstTarget }
  | { readonly ok: false; readonly message: string };

interface RadialBurstDraft {
  readonly targetKey: string;
  readonly count: string;
  readonly centerX: string;
  readonly centerY: string;
  readonly radius: string;
  readonly startAngleDeg: string;
  readonly maxRotationDeg: string;
  readonly startFrame: string;
  readonly durationFrames: string;
  readonly staggerFrames: string;
  readonly seed: string;
  readonly fadeOut: boolean;
}

type ParsedRadialBurstDraft =
  | { readonly ok: true; readonly input: RadialBurstInput }
  | { readonly ok: false; readonly message: string };

const NON_NEGATIVE_INT_PATTERN = /^\d+$/u;

function frameIndexFromMs(timeMs: number): number {
  return Math.max(0, Math.round((timeMs * TIMELINE_FPS) / 1_000));
}

function resolveRadialBurstTarget(): RadialBurstTargetState {
  const snapshot = editorProjectStore.getSnapshot();
  const shotId = shotStore.getCurrentShotId();
  const selectedLayerId = selectionStore.getSelectedLayerId();
  if (!snapshot || !shotId) {
    return { ok: false, message: '请先打开项目并选择镜头。' };
  }
  const shot = snapshot.project.shots.find((candidate) => candidate.id === shotId);
  if (!shot || !selectedLayerId) {
    return { ok: false, message: '请先选中一个 FLA 图形动画图层。' };
  }
  const layer = shot.layers.find((candidate) => candidate.id === selectedLayerId);
  if (!layer) {
    return { ok: false, message: '请先选中一个 FLA 图形动画图层。' };
  }
  if (shot.backgroundLayerId === layer.id) {
    return { ok: false, message: '背景图层不能生成径向爆炸。' };
  }
  if (layer.source.kind !== 'animation' || !layer.animationPlayback) {
    return { ok: false, message: '径向爆炸仅支持 FLA 图形动画图层。' };
  }
  const animationId = layer.source.animationId;
  const definition = snapshot.project.animations.find(
    (candidate) => candidate.id === animationId,
  );
  if (!definition || !isFlaGraphicDefinition(definition)) {
    return { ok: false, message: '径向爆炸仅支持 FLA 图形动画图层。' };
  }
  if (layer.locked) {
    return { ok: false, message: `图层“${layer.name}”已锁定，请先解锁。` };
  }
  const maxFrame = frameIndexFromMs(lastValidFrameTime(shot.durationMs));
  if (maxFrame < 1) {
    return { ok: false, message: '当前镜头帧数不足，无法生成径向爆炸。' };
  }
  const projectInstanceId = editorProjectStore.getProjectInstanceId();
  return {
    ok: true,
    target: {
      key: JSON.stringify([
        projectInstanceId,
        snapshot.project.id,
        snapshot.projectRoot,
        shot.id,
        layer.id,
      ]),
      project: snapshot.project,
      shot,
      layer,
      maxFrame,
    },
  };
}

function buildInitialDraft(
  target: RadialBurstTarget | null,
  currentTimeMs: number,
): RadialBurstDraft {
  if (!target) {
    return {
      targetKey: '',
      count: String(RADIAL_BURST_DEFAULT_COUNT),
      centerX: String(PROJECT_WIDTH / 2),
      centerY: String(PROJECT_HEIGHT / 2),
      radius: String(RADIAL_BURST_DEFAULT_RADIUS),
      startAngleDeg: String(RADIAL_BURST_DEFAULT_START_ANGLE_DEG),
      maxRotationDeg: String(RADIAL_BURST_DEFAULT_MAX_ROTATION_DEG),
      startFrame: '0',
      durationFrames: String(RADIAL_BURST_DEFAULT_DURATION_FRAMES),
      staggerFrames: String(RADIAL_BURST_DEFAULT_STAGGER_FRAMES),
      seed: String(RADIAL_BURST_DEFAULT_SEED),
      fadeOut: true,
    };
  }
  const legalMs = resolveTimelineFrameTime(currentTimeMs, target.shot.durationMs);
  const startFrame = Math.min(target.maxFrame, frameIndexFromMs(legalMs));
  const evaluated = evaluateShotAtTime(
    target.shot,
    frameTimeMs(startFrame),
    target.project,
  ).layers.find((candidate) => candidate.id === target.layer.id);
  const cx = Math.min(
    PROJECT_WIDTH,
    Math.max(0, Math.round((evaluated?.x ?? target.layer.x) * 10) / 10),
  );
  const cy = Math.min(
    PROJECT_HEIGHT,
    Math.max(0, Math.round((evaluated?.y ?? target.layer.y) * 10) / 10),
  );
  return {
    targetKey: target.key,
    count: String(RADIAL_BURST_DEFAULT_COUNT),
    centerX: String(cx),
    centerY: String(cy),
    radius: String(RADIAL_BURST_DEFAULT_RADIUS),
    startAngleDeg: String(RADIAL_BURST_DEFAULT_START_ANGLE_DEG),
    maxRotationDeg: String(RADIAL_BURST_DEFAULT_MAX_ROTATION_DEG),
    startFrame: String(startFrame),
    durationFrames: String(RADIAL_BURST_DEFAULT_DURATION_FRAMES),
    staggerFrames: String(RADIAL_BURST_DEFAULT_STAGGER_FRAMES),
    seed: String(RADIAL_BURST_DEFAULT_SEED),
    fadeOut: true,
  };
}

function parseNonNegativeInt(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed || !NON_NEGATIVE_INT_PATTERN.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function parseFinite(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

function parseRadialBurstDraft(
  draft: RadialBurstDraft,
  target: RadialBurstTarget,
): ParsedRadialBurstDraft {
  const count = parseNonNegativeInt(draft.count);
  if (
    count === null ||
    count < RADIAL_BURST_MIN_COUNT ||
    count > RADIAL_BURST_MAX_COUNT
  ) {
    return {
      ok: false,
      message: `副本数量必须是 ${RADIAL_BURST_MIN_COUNT}–${RADIAL_BURST_MAX_COUNT} 之间的整数。`,
    };
  }
  const cx = parseFinite(draft.centerX);
  const cy = parseFinite(draft.centerY);
  if (
    cx === null ||
    cy === null ||
    cx < 0 ||
    cx > PROJECT_WIDTH ||
    cy < 0 ||
    cy > PROJECT_HEIGHT
  ) {
    return {
      ok: false,
      message: `爆炸中心坐标必须位于画布范围（0–${PROJECT_WIDTH}、0–${PROJECT_HEIGHT}）内。`,
    };
  }
  const radius = parseFinite(draft.radius);
  if (radius === null || radius <= 0) {
    return { ok: false, message: '爆炸半径必须是大于 0 的有限数字。' };
  }
  const startAngleDeg = parseFinite(draft.startAngleDeg);
  if (startAngleDeg === null) {
    return { ok: false, message: '起始角度必须是有限数字。' };
  }
  const maxRotationDeg = parseFinite(draft.maxRotationDeg);
  if (maxRotationDeg === null || maxRotationDeg < 0) {
    return { ok: false, message: '最大旋转幅度必须是大于等于 0 的有限数字。' };
  }
  const startFrame = parseNonNegativeInt(draft.startFrame);
  const durationFrames = parseNonNegativeInt(draft.durationFrames);
  const staggerFrames = parseNonNegativeInt(draft.staggerFrames);
  if (startFrame === null || durationFrames === null || durationFrames < 1 || staggerFrames === null) {
    return { ok: false, message: '起帧与延迟必须为非负整数，持续帧数必须大于等于 1。' };
  }
  const lastEndFrame = startFrame + (count - 1) * staggerFrames + durationFrames;
  if (startFrame > target.maxFrame || lastEndFrame > target.maxFrame) {
    return {
      ok: false,
      message: `最晚结束帧（${lastEndFrame}）超出当前镜头末帧（${target.maxFrame}），请缩短持续帧数、延迟、数量或提前起帧。`,
    };
  }
  const seed = parseNonNegativeInt(draft.seed);
  if (seed === null || seed > RADIAL_BURST_MAX_SEED) {
    return {
      ok: false,
      message: `随机种子必须是 0–${RADIAL_BURST_MAX_SEED} 之间的整数。`,
    };
  }
  const evaluatedAtStart = evaluateShotAtTime(
    target.shot,
    frameTimeMs(startFrame),
    target.project,
  ).layers.find((candidate) => candidate.id === target.layer.id);
  if (!evaluatedAtStart || !evaluatedAtStart.visible || evaluatedAtStart.opacity <= 1e-6) {
    return {
      ok: false,
      message: '源图层在起帧不可见或完全透明，无法生成径向爆炸。',
    };
  }
  return {
    ok: true,
    input: {
      count,
      center: { x: cx, y: cy },
      radius,
      startAngleDeg,
      maxRotationDeg,
      startFrame,
      durationFrames,
      staggerFrames,
      seed,
      fadeOut: draft.fadeOut,
    },
  };
}

export function RadialBurstPanel({
  onCancel,
}: RadialBurstPanelProps): React.JSX.Element {
  useSyncExternalStore(
    editorProjectStore.subscribe,
    editorProjectStore.getSnapshot,
  );
  useSyncExternalStore(shotStore.subscribe, shotStore.getCurrentShotId);
  useSyncExternalStore(
    selectionStore.subscribe,
    selectionStore.getSelectedLayerId,
  );
  const { currentTimeMs } = useTimelineUi();

  const targetState = resolveRadialBurstTarget();
  const activeTarget = targetState.ok ? targetState.target : null;
  const activeTargetKey = activeTarget?.key ?? '';

  const [draft, setDraft] = useState<RadialBurstDraft>(() =>
    buildInitialDraft(activeTarget, currentTimeMs),
  );
  const [status, setStatus] = useState('');

  const effectiveDraft =
    activeTarget && draft.targetKey !== activeTargetKey
      ? buildInitialDraft(activeTarget, currentTimeMs)
      : draft;

  const updateDraft = (patch: Partial<RadialBurstDraft>): void => {
    setDraft({
      ...effectiveDraft,
      targetKey: activeTargetKey,
      ...patch,
    });
    setStatus('');
  };

  const parsed = activeTarget
    ? parseRadialBurstDraft(effectiveDraft, activeTarget)
    : null;
  const canSubmit = Boolean(activeTarget && parsed?.ok);
  const feedbackMessage = !targetState.ok
    ? targetState.message
    : parsed && !parsed.ok
      ? parsed.message
      : status;

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const live = resolveRadialBurstTarget();
    if (!live.ok) {
      setStatus(live.message);
      return;
    }
    if (!activeTarget || live.target.key !== activeTarget.key) {
      setDraft(buildInitialDraft(live.target, currentTimeMs));
      setStatus('选区、镜头或工程会话已变化，请确认参数后再生成。');
      return;
    }
    const validated = parseRadialBurstDraft(effectiveDraft, live.target);
    if (!validated.ok) {
      setStatus(validated.message);
      return;
    }
    try {
      layerStore.generateRadialBurst(live.target.layer.id, validated.input);
      setStatus('');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '径向爆炸生成失败。');
    }
  };

  return (
    <form
      aria-label="径向爆炸"
      className="grid-array-panel"
      data-testid="radial-burst-panel"
      noValidate
      onSubmit={handleSubmit}
    >
      <div className="grid-array-fields">
        <label className="grid-array-field">
          <span>数量</span>
          <input
            aria-label="副本数量"
            data-testid="radial-burst-count"
            disabled={!targetState.ok}
            inputMode="numeric"
            min={RADIAL_BURST_MIN_COUNT}
            max={RADIAL_BURST_MAX_COUNT}
            onChange={(event) => updateDraft({ count: event.target.value })}
            step={1}
            type="number"
            value={effectiveDraft.count}
          />
        </label>
        <label className="grid-array-field">
          <span>半径</span>
          <input
            aria-label="爆炸半径"
            data-testid="radial-burst-radius"
            disabled={!targetState.ok}
            inputMode="decimal"
            min={1}
            onChange={(event) => updateDraft({ radius: event.target.value })}
            step={10}
            type="number"
            value={effectiveDraft.radius}
          />
        </label>
        <label className="grid-array-field">
          <span>中心 X</span>
          <input
            aria-label="中心 X"
            data-testid="radial-burst-center-x"
            disabled={!targetState.ok}
            inputMode="decimal"
            onChange={(event) => updateDraft({ centerX: event.target.value })}
            type="number"
            value={effectiveDraft.centerX}
          />
        </label>
        <label className="grid-array-field">
          <span>中心 Y</span>
          <input
            aria-label="中心 Y"
            data-testid="radial-burst-center-y"
            disabled={!targetState.ok}
            inputMode="decimal"
            onChange={(event) => updateDraft({ centerY: event.target.value })}
            type="number"
            value={effectiveDraft.centerY}
          />
        </label>
        <label className="grid-array-field">
          <span>起帧</span>
          <input
            aria-label="起帧"
            data-testid="radial-burst-start-frame"
            disabled={!targetState.ok}
            inputMode="numeric"
            min={0}
            max={activeTarget?.maxFrame}
            onChange={(event) => updateDraft({ startFrame: event.target.value })}
            step={1}
            type="number"
            value={effectiveDraft.startFrame}
          />
        </label>
        <label className="grid-array-field">
          <span>持续帧数</span>
          <input
            aria-label="持续帧数"
            data-testid="radial-burst-duration"
            disabled={!targetState.ok}
            inputMode="numeric"
            min={1}
            onChange={(event) => updateDraft({ durationFrames: event.target.value })}
            step={1}
            type="number"
            value={effectiveDraft.durationFrames}
          />
        </label>
        <label className="grid-array-field">
          <span>逐个延迟</span>
          <input
            aria-label="逐个延迟（帧）"
            data-testid="radial-burst-stagger"
            disabled={!targetState.ok}
            inputMode="numeric"
            min={0}
            onChange={(event) => updateDraft({ staggerFrames: event.target.value })}
            step={1}
            type="number"
            value={effectiveDraft.staggerFrames}
          />
        </label>
        <label className="grid-array-field">
          <span>随机种子</span>
          <input
            aria-label="随机种子"
            data-testid="radial-burst-seed"
            disabled={!targetState.ok}
            inputMode="numeric"
            min={0}
            max={RADIAL_BURST_MAX_SEED}
            onChange={(event) => updateDraft({ seed: event.target.value })}
            step={1}
            type="number"
            value={effectiveDraft.seed}
          />
        </label>
        <label className="grid-array-field">
          <span>起始角</span>
          <input
            aria-label="起始角度"
            data-testid="radial-burst-start-angle"
            disabled={!targetState.ok}
            inputMode="decimal"
            onChange={(event) => updateDraft({ startAngleDeg: event.target.value })}
            type="number"
            value={effectiveDraft.startAngleDeg}
          />
        </label>
        <label className="grid-array-field">
          <span>最大旋转</span>
          <input
            aria-label="最大旋转幅度"
            data-testid="radial-burst-max-rotation"
            disabled={!targetState.ok}
            inputMode="decimal"
            min={0}
            onChange={(event) => updateDraft({ maxRotationDeg: event.target.value })}
            type="number"
            value={effectiveDraft.maxRotationDeg}
          />
        </label>
      </div>

      <div className="curve-motion-speed" data-testid="radial-burst-fade">
        <span>结束渐隐</span>
        <SegmentedTabs
          aria-label="结束渐隐"
          options={[
            { value: 'on', label: '渐隐消失', disabled: !targetState.ok },
            { value: 'off', label: '保留末态', disabled: !targetState.ok },
          ]}
          onChange={(value) => updateDraft({ fadeOut: value === 'on' })}
          value={effectiveDraft.fadeOut ? 'on' : 'off'}
        />
      </div>

      {feedbackMessage ? (
        <output
          className="grid-array-status"
          data-testid="radial-burst-status"
          role="alert"
        >
          {feedbackMessage}
        </output>
      ) : null}

      <div className="grid-array-actions">
        <Button
          data-testid="radial-burst-submit"
          disabled={!canSubmit}
          type="submit"
          variant="primary"
        >
          生成爆炸
        </Button>
        <Button
          data-testid="radial-burst-cancel"
          onClick={onCancel}
          type="button"
          variant="secondary"
        >
          取消
        </Button>
      </div>
    </form>
  );
}
