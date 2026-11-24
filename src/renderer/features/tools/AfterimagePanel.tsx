import { useState, useSyncExternalStore } from 'react';
import {
  AFTERIMAGE_DEFAULT_COUNT,
  AFTERIMAGE_DEFAULT_DECAY,
  AFTERIMAGE_DEFAULT_DELAY_FRAMES,
  AFTERIMAGE_MAX_COUNT,
  AFTERIMAGE_MIN_COUNT,
  TIMELINE_FPS,
  isFlaGraphicDefinition,
  lastValidFrameTime,
  resolveTimelineFrameTime,
  type AfterimageInput,
  type Layer,
  type Shot,
} from '../../../domain';
import { useTimelineUi } from '../timeline/timelineUiStore';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { layerStore } from '../../stores/layerStore';
import { selectionStore } from '../../stores/selectionStore';
import { shotStore } from '../../stores/shotStore';
import { Button } from '../../ui';

export interface AfterimagePanelProps {
  onCancel(): void;
}

interface AfterimageTarget {
  readonly key: string;
  readonly shot: Shot;
  readonly layer: Layer;
  readonly maxFrame: number;
}

type AfterimageTargetState =
  | { readonly ok: true; readonly target: AfterimageTarget }
  | { readonly ok: false; readonly message: string };

interface AfterimageDraft {
  readonly targetKey: string;
  readonly count: string;
  readonly delayFrames: string;
  readonly decay: string;
  readonly startFrame: string;
  readonly endFrame: string;
}

type ParsedAfterimageDraft =
  | { readonly ok: true; readonly input: AfterimageInput }
  | { readonly ok: false; readonly message: string };

const NON_NEGATIVE_INT_PATTERN = /^\d+$/u;

function frameIndexFromMs(timeMs: number): number {
  return Math.max(0, Math.round((timeMs * TIMELINE_FPS) / 1_000));
}

function resolveAfterimageTarget(): AfterimageTargetState {
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
    return { ok: false, message: '背景图层不能生成残影。' };
  }
  if (layer.source.kind !== 'animation' || !layer.animationPlayback) {
    return { ok: false, message: '位置残影仅支持 FLA 图形动画图层。' };
  }
  const animationId = layer.source.animationId;
  const definition = snapshot.project.animations.find(
    (candidate) => candidate.id === animationId,
  );
  if (!definition || !isFlaGraphicDefinition(definition)) {
    return { ok: false, message: '位置残影仅支持 FLA 图形动画图层。' };
  }
  if (layer.locked) {
    return { ok: false, message: `图层“${layer.name}”已锁定，请先解锁。` };
  }
  const maxFrame = frameIndexFromMs(lastValidFrameTime(shot.durationMs));
  if (maxFrame < AFTERIMAGE_MIN_COUNT) {
    return { ok: false, message: '当前镜头帧数不足，无法生成位置残影。' };
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
      shot,
      layer,
      maxFrame,
    },
  };
}

function buildInitialDraft(
  target: AfterimageTarget | null,
  currentTimeMs: number,
): AfterimageDraft {
  if (!target) {
    return {
      targetKey: '',
      count: String(AFTERIMAGE_DEFAULT_COUNT),
      delayFrames: String(AFTERIMAGE_DEFAULT_DELAY_FRAMES),
      decay: String(AFTERIMAGE_DEFAULT_DECAY),
      startFrame: '0',
      endFrame: String(TIMELINE_FPS),
    };
  }
  const legalMs = resolveTimelineFrameTime(currentTimeMs, target.shot.durationMs);
  let startFrame = Math.min(target.maxFrame, frameIndexFromMs(legalMs));
  let endFrame = Math.min(target.maxFrame, startFrame + TIMELINE_FPS);
  const minSpan = AFTERIMAGE_DEFAULT_COUNT * AFTERIMAGE_DEFAULT_DELAY_FRAMES;
  if (endFrame - startFrame < minSpan) {
    startFrame = Math.max(0, target.maxFrame - minSpan);
    endFrame = target.maxFrame;
  }
  return {
    targetKey: target.key,
    count: String(AFTERIMAGE_DEFAULT_COUNT),
    delayFrames: String(AFTERIMAGE_DEFAULT_DELAY_FRAMES),
    decay: String(AFTERIMAGE_DEFAULT_DECAY),
    startFrame: String(startFrame),
    endFrame: String(endFrame),
  };
}

function parseNonNegativeInt(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed || !NON_NEGATIVE_INT_PATTERN.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function parseAfterimageDraft(
  draft: AfterimageDraft,
  maxFrame: number,
): ParsedAfterimageDraft {
  const count = parseNonNegativeInt(draft.count);
  if (
    count === null ||
    count < AFTERIMAGE_MIN_COUNT ||
    count > AFTERIMAGE_MAX_COUNT
  ) {
    return {
      ok: false,
      message: `残影数量必须是 ${AFTERIMAGE_MIN_COUNT}–${AFTERIMAGE_MAX_COUNT} 之间的整数。`,
    };
  }
  const delayFrames = parseNonNegativeInt(draft.delayFrames);
  if (delayFrames === null || delayFrames < 1) {
    return { ok: false, message: '时间间隔必须是大于等于 1 的整数帧。' };
  }
  const decayTrimmed = draft.decay.trim();
  const decay = decayTrimmed ? Number(decayTrimmed) : Number.NaN;
  if (!Number.isFinite(decay) || decay <= 0 || decay >= 1) {
    return {
      ok: false,
      message: '透明度衰减系数必须是 0 到 1 之间（不含端点）的数字。',
    };
  }
  const startFrame = parseNonNegativeInt(draft.startFrame);
  const endFrame = parseNonNegativeInt(draft.endFrame);
  if (startFrame === null || endFrame === null) {
    return { ok: false, message: '起止帧必须是非负整数。' };
  }
  if (endFrame <= startFrame) {
    return { ok: false, message: '止帧必须晚于起帧。' };
  }
  if (endFrame > maxFrame) {
    return { ok: false, message: `止帧不能超过当前镜头末帧（${maxFrame}）。` };
  }
  if (endFrame - startFrame < count * delayFrames) {
    return {
      ok: false,
      message: `时段长度不足：${count} 个残影 × ${delayFrames} 帧间隔至少需要 ${count * delayFrames} 帧。`,
    };
  }
  return {
    ok: true,
    input: { count, delayFrames, decay, startFrame, endFrame },
  };
}

export function AfterimagePanel({
  onCancel,
}: AfterimagePanelProps): React.JSX.Element {
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

  const targetState = resolveAfterimageTarget();
  const activeTarget = targetState.ok ? targetState.target : null;
  const activeTargetKey = activeTarget?.key ?? '';

  const [draft, setDraft] = useState<AfterimageDraft>(() =>
    buildInitialDraft(activeTarget, currentTimeMs),
  );
  const [status, setStatus] = useState('');

  const effectiveDraft =
    activeTarget && draft.targetKey !== activeTargetKey
      ? buildInitialDraft(activeTarget, currentTimeMs)
      : draft;

  const updateDraft = (patch: Partial<AfterimageDraft>): void => {
    setDraft({
      ...effectiveDraft,
      targetKey: activeTargetKey,
      ...patch,
    });
    setStatus('');
  };

  const parsed = activeTarget
    ? parseAfterimageDraft(effectiveDraft, activeTarget.maxFrame)
    : null;
  const canSubmit = Boolean(activeTarget && parsed?.ok);
  const feedbackMessage = !targetState.ok
    ? targetState.message
    : parsed && !parsed.ok
      ? parsed.message
      : status;

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const live = resolveAfterimageTarget();
    if (!live.ok) {
      setStatus(live.message);
      return;
    }
    if (!activeTarget || live.target.key !== activeTarget.key) {
      setDraft(buildInitialDraft(live.target, currentTimeMs));
      setStatus('选区、镜头或工程会话已变化，请确认参数后再生成。');
      return;
    }
    const validated = parseAfterimageDraft(effectiveDraft, live.target.maxFrame);
    if (!validated.ok) {
      setStatus(validated.message);
      return;
    }
    try {
      layerStore.generateAfterimages(live.target.layer.id, validated.input);
      setStatus('');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '位置残影生成失败。');
    }
  };

  return (
    <form
      aria-label="位置残影"
      className="grid-array-panel"
      data-testid="afterimage-panel"
      noValidate
      onSubmit={handleSubmit}
    >
      <div className="grid-array-fields">
        <label className="grid-array-field">
          <span>残影数量</span>
          <input
            aria-label="残影数量"
            data-testid="afterimage-count"
            disabled={!targetState.ok}
            inputMode="numeric"
            min={AFTERIMAGE_MIN_COUNT}
            max={AFTERIMAGE_MAX_COUNT}
            onChange={(event) => updateDraft({ count: event.target.value })}
            step={1}
            type="number"
            value={effectiveDraft.count}
          />
        </label>
        <label className="grid-array-field">
          <span>帧间隔</span>
          <input
            aria-label="帧间隔"
            data-testid="afterimage-delay"
            disabled={!targetState.ok}
            inputMode="numeric"
            min={1}
            onChange={(event) => updateDraft({ delayFrames: event.target.value })}
            step={1}
            type="number"
            value={effectiveDraft.delayFrames}
          />
        </label>
        <label className="grid-array-field">
          <span>透明度衰减</span>
          <input
            aria-label="透明度衰减"
            data-testid="afterimage-decay"
            disabled={!targetState.ok}
            inputMode="decimal"
            min={0.05}
            max={0.95}
            onChange={(event) => updateDraft({ decay: event.target.value })}
            step={0.05}
            type="number"
            value={effectiveDraft.decay}
          />
        </label>
        <label className="grid-array-field">
          <span>起帧</span>
          <input
            aria-label="起帧"
            data-testid="afterimage-start-frame"
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
          <span>止帧</span>
          <input
            aria-label="止帧"
            data-testid="afterimage-end-frame"
            disabled={!targetState.ok}
            inputMode="numeric"
            min={1}
            max={activeTarget?.maxFrame}
            onChange={(event) => updateDraft({ endFrame: event.target.value })}
            step={1}
            type="number"
            value={effectiveDraft.endFrame}
          />
        </label>
      </div>

      {feedbackMessage ? (
        <output
          className="grid-array-status"
          data-testid="afterimage-status"
          role="alert"
        >
          {feedbackMessage}
        </output>
      ) : null}

      <div className="grid-array-actions">
        <Button
          data-testid="afterimage-submit"
          disabled={!canSubmit}
          type="submit"
          variant="primary"
        >
          生成残影
        </Button>
        <Button
          data-testid="afterimage-cancel"
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
