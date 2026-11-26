import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  MIN_CURVE_ARC_LENGTH,
  PROJECT_HEIGHT,
  PROJECT_WIDTH,
  TIMELINE_FPS,
  buildCubicBezierArcLengthTable,
  evaluateShotAtTime,
  frameTimeMs,
  getLayerCurveMotionConflict,
  isFlaGraphicDefinition,
  lastValidFrameTime,
  layerCurveMotionPositionTracks,
  sampleCubicBezierBySteps,
  resolveTimelineFrameTime,
  type CurveMotionSpeedMode,
  type Layer,
  type LayerCurveMotionInput,
  type Point,
  type Project,
  type Shot,
} from '../../../domain';
import type { CurveMotionStageDraft } from '../canvas/CurveMotionStageOverlay';
import { useTimelineUi } from '../timeline/timelineUiStore';
import { editorProjectStore, type EditorProjectSnapshot } from '../../stores/EditorProjectStore';
import { layerStore } from '../../stores/layerStore';
import { selectionStore } from '../../stores/selectionStore';
import { shotStore } from '../../stores/shotStore';
import { Button, SegmentedTabs } from '../../ui';

export interface CurveMotionPanelProps {
  onCancel(): void;
  onStageDraft?(draft: CurveMotionStageDraft | null): void;
}

interface CurveMotionTarget {
  readonly key: string;
  readonly projectInstanceId: number | null;
  readonly revision: number;
  readonly replacing: boolean;
  readonly projectId: string;
  readonly projectRoot: string;
  readonly project: Project;
  readonly shot: Shot;
  readonly layer: Layer;
  readonly maxFrame: number;
}

type CurveMotionTargetState =
  | { readonly ok: true; readonly target: CurveMotionTarget }
  | { readonly ok: false; readonly message: string };

interface CurveMotionDraft {
  readonly targetKey: string;
  readonly revision: number;
  readonly startFrame: string;
  readonly endFrame: string;
  readonly p1x: string;
  readonly p1y: string;
  readonly p2x: string;
  readonly p2y: string;
  readonly p3x: string;
  readonly p3y: string;
  readonly speedMode: CurveMotionSpeedMode;
}

type ParsedCurveMotionDraft =
  | {
      readonly ok: true;
      readonly p0: Point;
      readonly input: Omit<LayerCurveMotionInput, 'shotId' | 'layerId'>;
    }
  | { readonly ok: false; readonly p0: Point | null; readonly message: string };

const NON_NEGATIVE_INT_PATTERN = /^\d+$/u;

function frameIndexFromMs(timeMs: number): number {
  return Math.max(0, Math.round((timeMs * TIMELINE_FPS) / 1_000));
}

function clampStageCoord(value: number, max: number): number {
  return Math.round(Math.min(max, Math.max(0, value)));
}

function resolveCurveMotionTarget(
  snapshot: EditorProjectSnapshot | null = editorProjectStore.getSnapshot(),
  shotId = shotStore.getCurrentShotId(),
  selectedLayerId = selectionStore.getSelectedLayerId(),
): CurveMotionTargetState {
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
    return { ok: false, message: '背景图层不能生成曲线运动。' };
  }
  if (layer.source.kind !== 'animation' || !layer.animationPlayback) {
    return { ok: false, message: '曲线运动仅支持 FLA 图形动画图层。' };
  }
  const animationId = layer.source.animationId;
  const definition = snapshot.project.animations.find(
    (candidate) => candidate.id === animationId,
  );
  if (!definition || !isFlaGraphicDefinition(definition)) {
    return { ok: false, message: '曲线运动仅支持 FLA 图形动画图层。' };
  }
  if (layer.locked) {
    return { ok: false, message: `图层“${layer.name}”已锁定，请先解锁。` };
  }
  const maxFrame = frameIndexFromMs(lastValidFrameTime(shot.durationMs));
  if (maxFrame < 1) {
    return { ok: false, message: '当前镜头不足 2 帧，无法生成曲线运动。' };
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
      projectInstanceId,
      revision: snapshot.revision,
      replacing: layerCurveMotionPositionTracks(layer).length > 0,
      projectId: snapshot.project.id,
      projectRoot: snapshot.projectRoot,
      project: snapshot.project,
      shot,
      layer,
      maxFrame,
    },
  };
}

function evaluateStageAnchorAtFrame(
  target: CurveMotionTarget,
  frame: number,
): Point | null {
  const timeMs = frameTimeMs(frame);
  const evaluated = evaluateShotAtTime(target.shot, timeMs, target.project).layers.find(
    (candidate) => candidate.id === target.layer.id,
  );
  return evaluated ? { x: evaluated.x, y: evaluated.y } : null;
}

function buildInitialDraft(
  target: CurveMotionTarget | null,
  currentTimeMs: number,
): CurveMotionDraft {
  if (!target) {
    return {
      targetKey: '',
      revision: -1,
      startFrame: '0',
      endFrame: String(TIMELINE_FPS),
      p1x: '450',
      p1y: '80',
      p2x: '850',
      p2y: '80',
      p3x: '900',
      p3y: '300',
      speedMode: 'constant',
    };
  }
  const legalMs = resolveTimelineFrameTime(currentTimeMs, target.shot.durationMs);
  let startFrame = Math.min(target.maxFrame, frameIndexFromMs(legalMs));
  let endFrame = Math.min(target.maxFrame, startFrame + TIMELINE_FPS);
  if (endFrame <= startFrame) {
    startFrame = Math.max(0, target.maxFrame - 1);
    endFrame = target.maxFrame;
  }
  const p0 = evaluateStageAnchorAtFrame(target, startFrame) ?? {
    x: target.layer.x,
    y: target.layer.y,
  };
  const dx = p0.x + 300 <= PROJECT_WIDTH ? 300 : -300;
  const arcY = p0.y - 140 >= 0 ? p0.y - 140 : p0.y + 140;
  const end = target.replacing ? evaluateStageAnchorAtFrame(target, endFrame) : null;
  const first = end ? evaluateStageAnchorAtFrame(target, Math.round(startFrame + (endFrame - startFrame) / 3)) : null;
  const second = end ? evaluateStageAnchorAtFrame(target, Math.round(startFrame + 2 * (endFrame - startFrame) / 3)) : null;
  // Approximate an initial cubic from two interior poses at one-third and two-thirds.
  function estimate(axis: 'x' | 'y', which: 'p1' | 'p2'): number | undefined {
    if (!end || !first || !second) return undefined;
    const a = (27 * first[axis] - 8 * p0[axis] - end[axis]) / 6;
    const b = (27 * second[axis] - p0[axis] - 8 * end[axis]) / 6;
    return which === 'p1' ? (2 * a - b) / 3 : (2 * b - a) / 3;
  }
  return {
    targetKey: target.key,
    revision: target.revision,
    startFrame: String(startFrame),
    endFrame: String(endFrame),
    p1x: String(clampStageCoord(estimate('x', 'p1') ?? p0.x + dx * 0.25, PROJECT_WIDTH)),
    p1y: String(clampStageCoord(estimate('y', 'p1') ?? arcY, PROJECT_HEIGHT)),
    p2x: String(clampStageCoord(estimate('x', 'p2') ?? p0.x + dx * 0.75, PROJECT_WIDTH)),
    p2y: String(clampStageCoord(estimate('y', 'p2') ?? arcY, PROJECT_HEIGHT)),
    p3x: String(clampStageCoord(p0.x + dx, PROJECT_WIDTH)),
    p3y: String(clampStageCoord(p0.y, PROJECT_HEIGHT)),
    speedMode: 'constant',
  };
}

function parseNonNegativeInt(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed || !NON_NEGATIVE_INT_PATTERN.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function parseStageCoordinate(raw: string, max: number): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && value >= 0 && value <= max ? value : null;
}

function parseCurveMotionDraft(
  draft: CurveMotionDraft,
  target: CurveMotionTarget,
): ParsedCurveMotionDraft {
  const startFrame = parseNonNegativeInt(draft.startFrame);
  const endFrame = parseNonNegativeInt(draft.endFrame);
  if (startFrame === null || endFrame === null) {
    return {
      ok: false,
      p0: null,
      message: '起止帧必须是非负整数。',
    };
  }
  if (endFrame <= startFrame) {
    return {
      ok: false,
      p0: startFrame <= target.maxFrame ? evaluateStageAnchorAtFrame(target, startFrame) : null,
      message: '止帧必须晚于起帧至少 1 帧。',
    };
  }
  if (endFrame > target.maxFrame) {
    return {
      ok: false,
      p0: startFrame <= target.maxFrame ? evaluateStageAnchorAtFrame(target, startFrame) : null,
      message: `止帧不能超过当前镜头末帧（${target.maxFrame}）。`,
    };
  }
  const p0 = evaluateStageAnchorAtFrame(target, startFrame);
  const conflict = getLayerCurveMotionConflict(target.shot, target.layer, {
    startMs: frameTimeMs(startFrame), endMs: frameTimeMs(endFrame),
  });
  if (conflict) return { ok: false, p0, message: conflict };
  const fixedEnd = target.replacing ? evaluateStageAnchorAtFrame(target, endFrame) : null;
  if (
    !p0 ||
    !Number.isFinite(p0.x) ||
    !Number.isFinite(p0.y) ||
    (!target.replacing && (p0.x < 0 || p0.y < 0 || p0.x > PROJECT_WIDTH || p0.y > PROJECT_HEIGHT))
  ) {
    return {
      ok: false,
      p0,
      message: `起点 P0 必须位于画布范围（0–${PROJECT_WIDTH}、0–${PROJECT_HEIGHT}）内。`,
    };
  }
  const p1x = parseStageCoordinate(draft.p1x, PROJECT_WIDTH);
  const p1y = parseStageCoordinate(draft.p1y, PROJECT_HEIGHT);
  const p2x = parseStageCoordinate(draft.p2x, PROJECT_WIDTH);
  const p2y = parseStageCoordinate(draft.p2y, PROJECT_HEIGHT);
  const p3x = fixedEnd?.x ?? parseStageCoordinate(draft.p3x, PROJECT_WIDTH);
  const p3y = fixedEnd?.y ?? parseStageCoordinate(draft.p3y, PROJECT_HEIGHT);
  if (
    p1x === null ||
    p1y === null ||
    p2x === null ||
    p2y === null ||
    p3x === null ||
    p3y === null
  ) {
    return {
      ok: false,
      p0,
      message: `控制点与终点坐标必须位于画布范围（0–${PROJECT_WIDTH}、0–${PROJECT_HEIGHT}）内。`,
    };
  }
  const p1 = { x: p1x, y: p1y };
  const p2 = { x: p2x, y: p2y };
  const p3 = { x: p3x, y: p3y };
  const table = buildCubicBezierArcLengthTable({ p0, p1, p2, p3 }, 64);
  if (table.totalLength <= MIN_CURVE_ARC_LENGTH) {
    return {
      ok: false,
      p0,
      message: '曲线路径长度为 0，请调整控制点或终点后再生成。',
    };
  }
  return {
    ok: true,
    p0,
    input: {
      startFrame,
      endFrame,
      p1,
      p2,
      p3,
      speedMode: draft.speedMode,
      replacePosition: true,
    },
  };
}

function formatPoint(point: Point | null): string {
  if (!point) return '--';
  return `${Math.round(point.x * 10) / 10}, ${Math.round(point.y * 10) / 10}`;
}

export function CurveMotionPanel({
  onCancel,
  onStageDraft,
}: CurveMotionPanelProps): React.JSX.Element {
  const snapshot = useSyncExternalStore(
    editorProjectStore.subscribe,
    editorProjectStore.getSnapshot,
  );
  const shotId = useSyncExternalStore(shotStore.subscribe, shotStore.getCurrentShotId);
  const layerId = useSyncExternalStore(
    selectionStore.subscribe,
    selectionStore.getSelectedLayerId,
  );
  const { currentTimeMs } = useTimelineUi();

  const targetState = useMemo(() => resolveCurveMotionTarget(snapshot, shotId, layerId),
    [snapshot, shotId, layerId]);
  const activeTarget = targetState.ok ? targetState.target : null;

  const [draft, setDraft] = useState<CurveMotionDraft>(() =>
    buildInitialDraft(activeTarget, currentTimeMs),
  );
  const [status, setStatus] = useState('');

  const effectiveDraft = useMemo(() =>
    activeTarget && !draft.targetKey ? buildInitialDraft(activeTarget, currentTimeMs) : draft,
  [activeTarget, currentTimeMs, draft]);
  const stale = Boolean(activeTarget && effectiveDraft.targetKey &&
    (effectiveDraft.targetKey !== activeTarget.key || effectiveDraft.revision !== activeTarget.revision));
  const updateDraft = useCallback((patch: Partial<CurveMotionDraft>): void => {
    const live = resolveCurveMotionTarget();
    if (stale || !live.ok || live.target.key !== effectiveDraft.targetKey ||
      live.target.revision !== effectiveDraft.revision) return;
    setDraft({ ...effectiveDraft, ...patch });
    setStatus('');
  }, [effectiveDraft, stale]);

  const parsed = useMemo(() => activeTarget && !stale ? parseCurveMotionDraft(effectiveDraft, activeTarget) : null,
    [activeTarget, effectiveDraft, stale]);
  const canSubmit = Boolean(parsed?.ok);
  const feedbackMessage = !targetState.ok
    ? targetState.message
    : stale
      ? '工程或选区已变更，请重新开始曲线编辑。'
      : parsed && !parsed.ok ? parsed.message : status;
  const replacedTimes = useMemo(() => {
    if (!activeTarget?.replacing || !parsed?.ok) return [];
    const start = frameTimeMs(parsed.input.startFrame);
    const end = frameTimeMs(parsed.input.endFrame);
    const times = new Set(layerCurveMotionPositionTracks(activeTarget.layer).flatMap((track) =>
      track.keys.filter(({ timeMs }) => timeMs > start && timeMs < end).map(({ timeMs }) => timeMs)));
    return [...times].sort((a, b) => a - b);
  }, [activeTarget, parsed]);
  const stageDraft = useMemo<CurveMotionStageDraft | null>(() => {
    if (!onStageDraft || !activeTarget || !parsed?.ok) return null;
    const { input, p0 } = parsed;
    const curve = { p0, p1: input.p1, p2: input.p2, p3: input.p3 };
    const points = sampleCubicBezierBySteps(curve, Math.min(16, input.endFrame - input.startFrame), input.speedMode).points;
    const stride = Math.max(1, Math.ceil(replacedTimes.length / 24));
    const replaced = replacedTimes.filter((_, index) => index % stride === 0).flatMap((timeMs) => {
      const point = evaluateStageAnchorAtFrame(activeTarget, frameIndexFromMs(timeMs));
      return point ? [point] : [];
    });
    return {
      projectInstanceId: activeTarget.projectInstanceId, revision: activeTarget.revision,
      shotId: activeTarget.shot.id, layerId: activeTarget.layer.id,
      curve, samples: points.slice(1, -1), replaced, fixedEnd: activeTarget.replacing,
      move(handle, point) {
        if (handle === 'p3' && activeTarget.replacing) return;
        updateDraft({
          [handle + 'x']: String(clampStageCoord(point.x, PROJECT_WIDTH)),
          [handle + 'y']: String(clampStageCoord(point.y, PROJECT_HEIGHT)),
        });
      },
    };
  }, [activeTarget, onStageDraft, parsed, replacedTimes, updateDraft]);
  useEffect(() => { onStageDraft?.(stageDraft); }, [onStageDraft, stageDraft]);
  useEffect(() => () => { onStageDraft?.(null); }, [onStageDraft]);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const live = resolveCurveMotionTarget();
    if (!live.ok) {
      setStatus(live.message);
      return;
    }
    if (live.target.key !== effectiveDraft.targetKey || live.target.revision !== effectiveDraft.revision) {
      setStatus('选区、镜头或工程会话已变化，请重新开始曲线编辑。');
      return;
    }
    const validated = parseCurveMotionDraft(effectiveDraft, live.target);
    if (!validated.ok) {
      setStatus(validated.message);
      return;
    }
    try {
      layerStore.applyCurveMotion(live.target.layer.id, validated.input);
      setStatus('');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '曲线运动生成失败。');
    }
  };

  const previewCurve = parsed?.ok
    ? {
        p0: parsed.p0,
        p1: parsed.input.p1,
        p2: parsed.input.p2,
        p3: parsed.input.p3,
      }
    : null;

  return (
    <form
      aria-label="曲线运动"
      className="grid-array-panel curve-motion-panel"
      data-testid="curve-motion-panel"
      noValidate
      onSubmit={handleSubmit}
    >
      <div className="curve-motion-origin" data-testid="curve-motion-p0">
        <span>起点 P0</span>
        <strong>{formatPoint(parsed?.p0 ?? null)}</strong>
      </div>

      {previewCurve ? (
        <svg
          aria-hidden="true"
          className="curve-motion-preview"
          data-testid="curve-motion-preview"
          viewBox={`0 0 ${PROJECT_WIDTH} ${PROJECT_HEIGHT}`}
        >
          <line
            className="curve-motion-handle-line"
            x1={previewCurve.p0.x}
            y1={previewCurve.p0.y}
            x2={previewCurve.p1.x}
            y2={previewCurve.p1.y}
          />
          <line
            className="curve-motion-handle-line"
            x1={previewCurve.p3.x}
            y1={previewCurve.p3.y}
            x2={previewCurve.p2.x}
            y2={previewCurve.p2.y}
          />
          <path
            className="curve-motion-path"
            d={`M ${previewCurve.p0.x} ${previewCurve.p0.y} C ${previewCurve.p1.x} ${previewCurve.p1.y}, ${previewCurve.p2.x} ${previewCurve.p2.y}, ${previewCurve.p3.x} ${previewCurve.p3.y}`}
          />
          <circle className="curve-motion-endpoint" cx={previewCurve.p0.x} cy={previewCurve.p0.y} r={22} />
          <circle className="curve-motion-endpoint" cx={previewCurve.p3.x} cy={previewCurve.p3.y} r={22} />
          <circle className="curve-motion-control" cx={previewCurve.p1.x} cy={previewCurve.p1.y} r={18} />
          <circle className="curve-motion-control" cx={previewCurve.p2.x} cy={previewCurve.p2.y} r={18} />
        </svg>
      ) : null}

      <div className="grid-array-fields">
        <label className="grid-array-field">
          <span>起帧</span>
          <input
            aria-label="起帧"
            data-testid="curve-motion-start-frame"
            disabled={!targetState.ok || stale}
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
            data-testid="curve-motion-end-frame"
            disabled={!targetState.ok || stale}
            inputMode="numeric"
            min={1}
            max={activeTarget?.maxFrame}
            onChange={(event) => updateDraft({ endFrame: event.target.value })}
            step={1}
            type="number"
            value={effectiveDraft.endFrame}
          />
        </label>
        <label className="grid-array-field">
          <span>P1 X</span>
          <input
            aria-label="控制点 P1 X"
            data-testid="curve-motion-p1-x"
            disabled={!targetState.ok || stale}
            inputMode="decimal"
            onChange={(event) => updateDraft({ p1x: event.target.value })}
            type="number"
            value={effectiveDraft.p1x}
          />
        </label>
        <label className="grid-array-field">
          <span>P1 Y</span>
          <input
            aria-label="控制点 P1 Y"
            data-testid="curve-motion-p1-y"
            disabled={!targetState.ok || stale}
            inputMode="decimal"
            onChange={(event) => updateDraft({ p1y: event.target.value })}
            type="number"
            value={effectiveDraft.p1y}
          />
        </label>
        <label className="grid-array-field">
          <span>P2 X</span>
          <input
            aria-label="控制点 P2 X"
            data-testid="curve-motion-p2-x"
            disabled={!targetState.ok || stale}
            inputMode="decimal"
            onChange={(event) => updateDraft({ p2x: event.target.value })}
            type="number"
            value={effectiveDraft.p2x}
          />
        </label>
        <label className="grid-array-field">
          <span>P2 Y</span>
          <input
            aria-label="控制点 P2 Y"
            data-testid="curve-motion-p2-y"
            disabled={!targetState.ok || stale}
            inputMode="decimal"
            onChange={(event) => updateDraft({ p2y: event.target.value })}
            type="number"
            value={effectiveDraft.p2y}
          />
        </label>
        <label className="grid-array-field">
          <span>终点 P3 X</span>
          <input
            aria-label="终点 P3 X"
            data-testid="curve-motion-p3-x"
            disabled={!targetState.ok || stale || activeTarget?.replacing}
            inputMode="decimal"
            onChange={(event) => updateDraft({ p3x: event.target.value })}
            type="number"
            value={activeTarget?.replacing ? parsed?.ok ? parsed.input.p3.x : '' : effectiveDraft.p3x}
          />
        </label>
        <label className="grid-array-field">
          <span>终点 P3 Y</span>
          <input
            aria-label="终点 P3 Y"
            data-testid="curve-motion-p3-y"
            disabled={!targetState.ok || stale || activeTarget?.replacing}
            inputMode="decimal"
            onChange={(event) => updateDraft({ p3y: event.target.value })}
            type="number"
            value={activeTarget?.replacing ? parsed?.ok ? parsed.input.p3.y : '' : effectiveDraft.p3y}
          />
        </label>
      </div>

      <div className="curve-motion-speed" data-testid="curve-motion-speed">
        <span>速度</span>
        <SegmentedTabs
          aria-label="曲线运动速度模式"
          options={[
            { value: 'constant', label: '等速', disabled: !targetState.ok || stale },
            { value: 'ease-in-out', label: '缓入缓出', disabled: !targetState.ok || stale },
          ]}
          onChange={(value) =>
            updateDraft({ speedMode: value as CurveMotionSpeedMode })
          }
          value={effectiveDraft.speedMode}
        />
      </div>

      {feedbackMessage ? (
        <output
          className="grid-array-status"
          data-testid="curve-motion-status"
          role="alert"
        >
          {feedbackMessage}
        </output>
      ) : null}

      {activeTarget?.replacing && parsed?.ok ? (
        <p>端点沿用原动画。橙色标记为区段内待替换位置（{replacedTimes.length} 帧）。</p>
      ) : null}
      <div className="grid-array-actions">
        {stale && activeTarget ? <Button type="button" onClick={() => {
          setDraft(buildInitialDraft(activeTarget, currentTimeMs));
          setStatus('');
        }}>重新开始</Button> : null}
        <Button
          data-testid="curve-motion-submit"
          disabled={!canSubmit}
          type="submit"
          variant="primary"
        >
          {activeTarget?.replacing ? '替换区段 X/Y' : '生成曲线运动'}
        </Button>
        <Button
          data-testid="curve-motion-cancel"
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
