import { useState, useSyncExternalStore } from 'react';
import {
  GRID_ARRAY_DEFAULT_COLS,
  GRID_ARRAY_DEFAULT_ROWS,
  GRID_ARRAY_DEFAULT_SPACING_X,
  GRID_ARRAY_DEFAULT_SPACING_Y,
  GRID_ARRAY_MAX_INSTANCES,
  PROJECT_HEIGHT,
  PROJECT_WIDTH,
  RADIAL_ARRAY_DEFAULT_RADIUS,
  RADIAL_ARRAY_DEFAULT_START_ANGLE_DEG,
  STATIC_ARRAY_DEFAULT_COUNT,
  STATIC_ARRAY_MAX_COUNT,
  STATIC_ARRAY_MIN_COUNT,
  isFlaGraphicDefinition,
  samplePathArrayLayout,
  sampleRadialArrayLayout,
  type CubicBezier2D,
  type GridArrayInput,
  type Layer,
  type PathArrayInput,
  type Point,
  type RadialArrayInput,
  type StaticArrayOrientationMode,
} from '../../../domain';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { layerStore } from '../../stores/layerStore';
import { selectionStore } from '../../stores/selectionStore';
import { shotStore } from '../../stores/shotStore';
import { Button } from '../../ui';

export interface GridArrayPanelProps {
  onCancel(): void;
}

export type StaticArrayMode = 'grid' | 'radial' | 'path';

interface GridArrayTarget {
  readonly key: string;
  readonly projectInstanceId: number | null;
  readonly projectId: string;
  readonly projectRoot: string;
  readonly shotId: string;
  readonly layer: Layer;
}

type GridArrayTargetState =
  | { readonly ok: true; readonly target: GridArrayTarget }
  | { readonly ok: false; readonly message: string };

interface GridArrayDraft {
  readonly rows: string;
  readonly cols: string;
  readonly spacingX: string;
  readonly spacingY: string;
}

interface RadialArrayDraft {
  readonly targetKey: string;
  readonly count: string;
  readonly centerX: string;
  readonly centerY: string;
  readonly radius: string;
  readonly startAngleDeg: string;
  readonly orientation: StaticArrayOrientationMode;
}

interface PathArrayDraft {
  readonly targetKey: string;
  readonly count: string;
  readonly p0x: string;
  readonly p0y: string;
  readonly p1x: string;
  readonly p1y: string;
  readonly p2x: string;
  readonly p2y: string;
  readonly p3x: string;
  readonly p3y: string;
  readonly orientation: StaticArrayOrientationMode;
}

type ParsedGridArrayDraft =
  | { readonly ok: true; readonly input: GridArrayInput }
  | { readonly ok: false; readonly message: string };

type ParsedRadialArrayDraft =
  | { readonly ok: true; readonly input: RadialArrayInput }
  | { readonly ok: false; readonly message: string };

type ParsedPathArrayDraft =
  | { readonly ok: true; readonly input: PathArrayInput }
  | { readonly ok: false; readonly message: string };

const POSITIVE_INT_PATTERN = /^\d+$/u;

const MODE_OPTIONS: readonly { readonly mode: StaticArrayMode; readonly label: string; readonly testId: string }[] = [
  { mode: 'grid', label: '矩形', testId: 'array-mode-grid' },
  { mode: 'radial', label: '径向', testId: 'array-mode-radial' },
  { mode: 'path', label: '沿路径', testId: 'array-mode-path' },
] as const;

function resolveGridArrayTarget(): GridArrayTargetState {
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
    return { ok: false, message: '背景图层不能执行排兵布阵。' };
  }
  if (layer.source.kind !== 'animation' || !layer.animationPlayback) {
    return { ok: false, message: '排兵布阵仅支持 FLA 图形动画图层。' };
  }
  const animationId = layer.source.animationId;
  const definition = snapshot.project.animations.find(
    (candidate) => candidate.id === animationId,
  );
  if (!definition || !isFlaGraphicDefinition(definition)) {
    return { ok: false, message: '排兵布阵仅支持 FLA 图形动画图层。' };
  }
  if (layer.locked) {
    return { ok: false, message: `图层“${layer.name}”已锁定，请先解锁。` };
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
      projectId: snapshot.project.id,
      projectRoot: snapshot.projectRoot,
      shotId: shot.id,
      layer,
    },
  };
}

function parsePositiveInt(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed || !POSITIVE_INT_PATTERN.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) && value >= 1 ? value : null;
}

function parseFinite(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

function parsePositiveFinite(raw: string): number | null {
  const value = parseFinite(raw);
  return value !== null && value > 0 ? value : null;
}

function isStagePoint(point: Point): boolean {
  return (
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    point.x >= 0 &&
    point.x <= PROJECT_WIDTH &&
    point.y >= 0 &&
    point.y <= PROJECT_HEIGHT
  );
}

function roundCoord(value: number): number {
  return Math.round(value * 10) / 10;
}

function buildDefaultRadialDraft(target: GridArrayTarget | null): RadialArrayDraft {
  const cx = target ? roundCoord(target.layer.x) : PROJECT_WIDTH / 2;
  const cy = target ? roundCoord(target.layer.y) : PROJECT_HEIGHT / 2;
  return {
    targetKey: target?.key ?? '',
    count: String(STATIC_ARRAY_DEFAULT_COUNT),
    centerX: String(cx),
    centerY: String(cy),
    radius: String(RADIAL_ARRAY_DEFAULT_RADIUS),
    startAngleDeg: String(RADIAL_ARRAY_DEFAULT_START_ANGLE_DEG),
    orientation: 'keep',
  };
}

function buildDefaultPathDraft(target: GridArrayTarget | null): PathArrayDraft {
  const x0 = target ? roundCoord(target.layer.x) : 400;
  const y0 = target ? roundCoord(target.layer.y) : 300;
  const spanX = x0 + 480 <= PROJECT_WIDTH ? 480 : -Math.min(480, x0);
  const x3 = roundCoord(Math.min(PROJECT_WIDTH, Math.max(0, x0 + (spanX === 0 ? 480 : spanX))));
  const arcY = roundCoord(y0 - 160 >= 0 ? y0 - 160 : Math.min(PROJECT_HEIGHT, y0 + 160));
  const x1 = roundCoord(x0 + (x3 - x0) / 3);
  const x2 = roundCoord(x0 + ((x3 - x0) * 2) / 3);
  return {
    targetKey: target?.key ?? '',
    count: String(STATIC_ARRAY_DEFAULT_COUNT),
    p0x: String(x0),
    p0y: String(y0),
    p1x: String(x1),
    p1y: String(arcY),
    p2x: String(x2),
    p2y: String(arcY),
    p3x: String(x3),
    p3y: String(y0),
    orientation: 'keep',
  };
}

export function parseGridArrayDraft(
  draft: GridArrayDraft,
  sourceBase?: { readonly x: number; readonly y: number },
): ParsedGridArrayDraft {
  const rows = parsePositiveInt(draft.rows);
  const cols = parsePositiveInt(draft.cols);
  if (rows === null || cols === null) {
    return { ok: false, message: '行数和列数必须是大于等于 1 的整数。' };
  }
  if (rows * cols > GRID_ARRAY_MAX_INSTANCES) {
    return {
      ok: false,
      message: `排兵布阵总数不能超过 ${GRID_ARRAY_MAX_INSTANCES} 个（含源图层）。`,
    };
  }
  const spacingX =
    cols > 1 ? parsePositiveFinite(draft.spacingX) : GRID_ARRAY_DEFAULT_SPACING_X;
  if (spacingX === null) {
    return { ok: false, message: '横向间距必须是大于 0 的有效数字。' };
  }
  const spacingY =
    rows > 1 ? parsePositiveFinite(draft.spacingY) : GRID_ARRAY_DEFAULT_SPACING_Y;
  if (spacingY === null) {
    return { ok: false, message: '纵向间距必须是大于 0 的有效数字。' };
  }
  if (sourceBase && (rows > 1 || cols > 1)) {
    const maxX = sourceBase.x + (cols === 1 ? 0 : (cols - 1) * spacingX);
    const maxY = sourceBase.y + (rows === 1 ? 0 : (rows - 1) * spacingY);
    if (
      !Number.isFinite(maxX) ||
      !Number.isFinite(maxY) ||
      sourceBase.x < 0 ||
      sourceBase.y < 0 ||
      maxX > PROJECT_WIDTH ||
      maxY > PROJECT_HEIGHT
    ) {
      return {
        ok: false,
        message: `阵列目标位置超出画布范围（0–${PROJECT_WIDTH}、0–${PROJECT_HEIGHT}），请调整行列、间距或源位置。`,
      };
    }
  }
  return {
    ok: true,
    input: { rows, cols, spacingX, spacingY },
  };
}

function parseRadialArrayDraft(draft: RadialArrayDraft): ParsedRadialArrayDraft {
  const count = parsePositiveInt(draft.count);
  if (
    count === null ||
    count < STATIC_ARRAY_MIN_COUNT ||
    count > STATIC_ARRAY_MAX_COUNT
  ) {
    return {
      ok: false,
      message: `副本数量必须是 ${STATIC_ARRAY_MIN_COUNT}–${STATIC_ARRAY_MAX_COUNT} 之间的整数。`,
    };
  }
  const cx = parseFinite(draft.centerX);
  const cy = parseFinite(draft.centerY);
  if (cx === null || cy === null || !isStagePoint({ x: cx, y: cy })) {
    return {
      ok: false,
      message: `圆心坐标必须位于画布范围（0–${PROJECT_WIDTH}、0–${PROJECT_HEIGHT}）内。`,
    };
  }
  const radius = parsePositiveFinite(draft.radius);
  if (radius === null) {
    return { ok: false, message: '半径必须是大于 0 的有效数字。' };
  }
  const startAngleDeg = parseFinite(draft.startAngleDeg);
  if (startAngleDeg === null) {
    return { ok: false, message: '起始角度必须是有限数字。' };
  }
  const samples = sampleRadialArrayLayout({
    count,
    center: { x: cx, y: cy },
    radius,
    startAngleDeg,
    orientation: draft.orientation,
  });
  for (const sample of samples) {
    if (!isStagePoint(sample.position)) {
      return {
        ok: false,
        message: `径向阵列目标位置超出画布范围（0–${PROJECT_WIDTH}、0–${PROJECT_HEIGHT}），请调整圆心、半径或数量。`,
      };
    }
  }
  return {
    ok: true,
    input: {
      count,
      center: { x: cx, y: cy },
      radius,
      startAngleDeg,
      orientation: draft.orientation,
    },
  };
}

function parsePathArrayDraft(draft: PathArrayDraft): ParsedPathArrayDraft {
  const count = parsePositiveInt(draft.count);
  if (
    count === null ||
    count < STATIC_ARRAY_MIN_COUNT ||
    count > STATIC_ARRAY_MAX_COUNT
  ) {
    return {
      ok: false,
      message: `副本数量必须是 ${STATIC_ARRAY_MIN_COUNT}–${STATIC_ARRAY_MAX_COUNT} 之间的整数。`,
    };
  }
  const coords = [
    parseFinite(draft.p0x),
    parseFinite(draft.p0y),
    parseFinite(draft.p1x),
    parseFinite(draft.p1y),
    parseFinite(draft.p2x),
    parseFinite(draft.p2y),
    parseFinite(draft.p3x),
    parseFinite(draft.p3y),
  ];
  if (coords.some((value) => value === null)) {
    return { ok: false, message: '路径控制点坐标必须是有效数字。' };
  }
  const curve: CubicBezier2D = {
    p0: { x: coords[0]!, y: coords[1]! },
    p1: { x: coords[2]!, y: coords[3]! },
    p2: { x: coords[4]!, y: coords[5]! },
    p3: { x: coords[6]!, y: coords[7]! },
  };
  if (
    !isStagePoint(curve.p0) ||
    !isStagePoint(curve.p1) ||
    !isStagePoint(curve.p2) ||
    !isStagePoint(curve.p3)
  ) {
    return {
      ok: false,
      message: `路径控制点必须位于画布范围（0–${PROJECT_WIDTH}、0–${PROJECT_HEIGHT}）内。`,
    };
  }
  const sampled = samplePathArrayLayout({
    count,
    curve,
    orientation: draft.orientation,
  });
  if (!sampled.ok) {
    if (sampled.reason === 'degenerate-tangent') {
      return {
        ok: false,
        message: '路径在部分采样点切线退化，无法沿路径切线对齐朝向；请调整控制点或改用“保持朝向”。',
      };
    }
    return {
      ok: false,
      message: '路径长度为 0（退化路径），请设置有效的起止点与控制点。',
    };
  }
  for (const sample of sampled.samples) {
    if (!isStagePoint(sample.position)) {
      return {
        ok: false,
        message: `沿路径阵列目标位置超出画布范围（0–${PROJECT_WIDTH}、0–${PROJECT_HEIGHT}），请调整路径控制点或数量。`,
      };
    }
  }
  return {
    ok: true,
    input: {
      count,
      curve,
      orientation: draft.orientation,
    },
  };
}

export function GridArrayPanel({ onCancel }: GridArrayPanelProps): React.JSX.Element {
  useSyncExternalStore(
    editorProjectStore.subscribe,
    editorProjectStore.getSnapshot,
  );
  useSyncExternalStore(shotStore.subscribe, shotStore.getCurrentShotId);
  useSyncExternalStore(
    selectionStore.subscribe,
    selectionStore.getSelectedLayerId,
  );

  const targetState = resolveGridArrayTarget();
  const activeTarget = targetState.ok ? targetState.target : null;
  const activeTargetKey = activeTarget?.key ?? '';

  const [mode, setMode] = useState<StaticArrayMode>('grid');
  const [rows, setRows] = useState(String(GRID_ARRAY_DEFAULT_ROWS));
  const [cols, setCols] = useState(String(GRID_ARRAY_DEFAULT_COLS));
  const [spacingX, setSpacingX] = useState(String(GRID_ARRAY_DEFAULT_SPACING_X));
  const [spacingY, setSpacingY] = useState(String(GRID_ARRAY_DEFAULT_SPACING_Y));
  const [radialDraft, setRadialDraft] = useState<RadialArrayDraft>(() =>
    buildDefaultRadialDraft(activeTarget),
  );
  const [pathDraft, setPathDraft] = useState<PathArrayDraft>(() =>
    buildDefaultPathDraft(activeTarget),
  );
  const [status, setStatus] = useState('');

  const effectiveRadialDraft =
    radialDraft.targetKey === activeTargetKey
      ? radialDraft
      : buildDefaultRadialDraft(activeTarget);
  const effectivePathDraft =
    pathDraft.targetKey === activeTargetKey
      ? pathDraft
      : buildDefaultPathDraft(activeTarget);

  const updateRadialDraft = (patch: Partial<RadialArrayDraft>): void => {
    setRadialDraft({ ...effectiveRadialDraft, ...patch });
    setStatus('');
  };
  const updatePathDraft = (patch: Partial<PathArrayDraft>): void => {
    setPathDraft({ ...effectivePathDraft, ...patch });
    setStatus('');
  };

  const parsedRows = parsePositiveInt(rows);
  const parsedCols = parsePositiveInt(cols);
  const spacingXDisabled = !targetState.ok || parsedCols === 1;
  const spacingYDisabled = !targetState.ok || parsedRows === 1;

  const parsedGrid = parseGridArrayDraft(
    { rows, cols, spacingX, spacingY },
    activeTarget ? { x: activeTarget.layer.x, y: activeTarget.layer.y } : undefined,
  );
  const parsedRadial = parseRadialArrayDraft(effectiveRadialDraft);
  const parsedPath = parsePathArrayDraft(effectivePathDraft);

  const activeParsed =
    mode === 'grid'
      ? parsedGrid
      : mode === 'radial'
        ? parsedRadial
        : parsedPath;

  const canSubmit = targetState.ok && activeParsed.ok;
  const feedbackMessage = !targetState.ok
    ? targetState.message
    : !activeParsed.ok
      ? activeParsed.message
      : status;

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const live = resolveGridArrayTarget();
    if (!live.ok) {
      setStatus(live.message);
      return;
    }
    if (
      !activeTarget ||
      live.target.projectInstanceId !== activeTarget.projectInstanceId ||
      live.target.projectId !== activeTarget.projectId ||
      live.target.projectRoot !== activeTarget.projectRoot ||
      live.target.shotId !== activeTarget.shotId ||
      live.target.layer.id !== activeTarget.layer.id
    ) {
      setStatus('选区或镜头已变化，请确认目标后再生成。');
      return;
    }

    try {
      if (mode === 'grid') {
        const validated = parseGridArrayDraft(
          { rows, cols, spacingX, spacingY },
          { x: live.target.layer.x, y: live.target.layer.y },
        );
        if (!validated.ok) {
          setStatus(validated.message);
          return;
        }
        layerStore.duplicateAnimationLayerGrid(live.target.layer.id, validated.input);
      } else if (mode === 'radial') {
        const validated = parseRadialArrayDraft(effectiveRadialDraft);
        if (!validated.ok) {
          setStatus(validated.message);
          return;
        }
        layerStore.duplicateAnimationLayerRadial(live.target.layer.id, validated.input);
      } else {
        const validated = parsePathArrayDraft(effectivePathDraft);
        if (!validated.ok) {
          setStatus(validated.message);
          return;
        }
        layerStore.duplicateAnimationLayerAlongPath(live.target.layer.id, validated.input);
      }
      setStatus('');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '阵列生成失败。');
    }
  };

  return (
    <form
      aria-label="排兵布阵"
      className="grid-array-panel"
      data-array-mode={mode}
      data-testid="grid-array-panel"
      noValidate
      onSubmit={handleSubmit}
    >
      <div
        aria-label="阵列模式"
        className="project-tools-view-mode-segmented"
        data-testid="array-mode-selector"
        role="group"
      >
        {MODE_OPTIONS.map((option) => (
          <button
            aria-pressed={mode === option.mode}
            data-testid={option.testId}
            key={option.mode}
            onClick={() => {
              setMode(option.mode);
              setStatus('');
            }}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>

      {mode === 'grid' ? (
        <div className="grid-array-fields">
          <label className="grid-array-field">
            <span>行数</span>
            <input
              aria-label="行数"
              data-testid="grid-array-rows"
              disabled={!targetState.ok}
              inputMode="numeric"
              min={1}
              max={GRID_ARRAY_MAX_INSTANCES}
              onChange={(event) => {
                setRows(event.target.value);
                setStatus('');
              }}
              step={1}
              type="number"
              value={rows}
            />
          </label>
          <label className="grid-array-field">
            <span>列数</span>
            <input
              aria-label="列数"
              data-testid="grid-array-cols"
              disabled={!targetState.ok}
              inputMode="numeric"
              min={1}
              max={GRID_ARRAY_MAX_INSTANCES}
              onChange={(event) => {
                setCols(event.target.value);
                setStatus('');
              }}
              step={1}
              type="number"
              value={cols}
            />
          </label>
          <label className="grid-array-field">
            <span>横向间距</span>
            <input
              aria-label="横向间距"
              data-testid="grid-array-spacing-x"
              disabled={spacingXDisabled}
              inputMode="decimal"
              min={1}
              onChange={(event) => {
                setSpacingX(event.target.value);
                setStatus('');
              }}
              step={1}
              type="number"
              value={spacingX}
            />
          </label>
          <label className="grid-array-field">
            <span>纵向间距</span>
            <input
              aria-label="纵向间距"
              data-testid="grid-array-spacing-y"
              disabled={spacingYDisabled}
              inputMode="decimal"
              min={1}
              onChange={(event) => {
                setSpacingY(event.target.value);
                setStatus('');
              }}
              step={1}
              type="number"
              value={spacingY}
            />
          </label>
        </div>
      ) : mode === 'radial' ? (
        <div className="grid-array-fields">
          <label className="grid-array-field">
            <span>数量</span>
            <input
              aria-label="副本数量"
              data-testid="radial-array-count"
              disabled={!targetState.ok}
              inputMode="numeric"
              min={STATIC_ARRAY_MIN_COUNT}
              max={STATIC_ARRAY_MAX_COUNT}
              onChange={(event) => updateRadialDraft({ count: event.target.value })}
              step={1}
              type="number"
              value={effectiveRadialDraft.count}
            />
          </label>
          <label className="grid-array-field">
            <span>半径</span>
            <input
              aria-label="半径"
              data-testid="radial-array-radius"
              disabled={!targetState.ok}
              inputMode="decimal"
              min={1}
              onChange={(event) => updateRadialDraft({ radius: event.target.value })}
              step={10}
              type="number"
              value={effectiveRadialDraft.radius}
            />
          </label>
          <label className="grid-array-field">
            <span>圆心 X</span>
            <input
              aria-label="圆心 X"
              data-testid="radial-array-center-x"
              disabled={!targetState.ok}
              inputMode="decimal"
              onChange={(event) => updateRadialDraft({ centerX: event.target.value })}
              type="number"
              value={effectiveRadialDraft.centerX}
            />
          </label>
          <label className="grid-array-field">
            <span>圆心 Y</span>
            <input
              aria-label="圆心 Y"
              data-testid="radial-array-center-y"
              disabled={!targetState.ok}
              inputMode="decimal"
              onChange={(event) => updateRadialDraft({ centerY: event.target.value })}
              type="number"
              value={effectiveRadialDraft.centerY}
            />
          </label>
          <label className="grid-array-field">
            <span>起始角度</span>
            <input
              aria-label="起始角度"
              data-testid="radial-array-start-angle"
              disabled={!targetState.ok}
              inputMode="decimal"
              onChange={(event) => updateRadialDraft({ startAngleDeg: event.target.value })}
              step={15}
              type="number"
              value={effectiveRadialDraft.startAngleDeg}
            />
          </label>
          <label className="grid-array-field">
            <span>朝向</span>
            <select
              aria-label="朝向"
              data-testid="radial-array-orientation"
              disabled={!targetState.ok}
              onChange={(event) =>
                updateRadialDraft({
                  orientation: event.target.value as StaticArrayOrientationMode,
                })
              }
              value={effectiveRadialDraft.orientation}
            >
              <option value="keep">保持朝向</option>
              <option value="align">沿径向朝外</option>
            </select>
          </label>
        </div>
      ) : (
        <div className="grid-array-fields">
          <label className="grid-array-field">
            <span>数量</span>
            <input
              aria-label="副本数量"
              data-testid="path-array-count"
              disabled={!targetState.ok}
              inputMode="numeric"
              min={STATIC_ARRAY_MIN_COUNT}
              max={STATIC_ARRAY_MAX_COUNT}
              onChange={(event) => updatePathDraft({ count: event.target.value })}
              step={1}
              type="number"
              value={effectivePathDraft.count}
            />
          </label>
          <label className="grid-array-field">
            <span>朝向</span>
            <select
              aria-label="朝向"
              data-testid="path-array-orientation"
              disabled={!targetState.ok}
              onChange={(event) =>
                updatePathDraft({
                  orientation: event.target.value as StaticArrayOrientationMode,
                })
              }
              value={effectivePathDraft.orientation}
            >
              <option value="keep">保持朝向</option>
              <option value="align">沿路径切线</option>
            </select>
          </label>
          <label className="grid-array-field">
            <span>P0 X</span>
            <input
              aria-label="起点 X"
              data-testid="path-array-p0-x"
              disabled={!targetState.ok}
              inputMode="decimal"
              onChange={(event) => updatePathDraft({ p0x: event.target.value })}
              type="number"
              value={effectivePathDraft.p0x}
            />
          </label>
          <label className="grid-array-field">
            <span>P0 Y</span>
            <input
              aria-label="起点 Y"
              data-testid="path-array-p0-y"
              disabled={!targetState.ok}
              inputMode="decimal"
              onChange={(event) => updatePathDraft({ p0y: event.target.value })}
              type="number"
              value={effectivePathDraft.p0y}
            />
          </label>
          <label className="grid-array-field">
            <span>P1 X</span>
            <input
              aria-label="控制点1 X"
              data-testid="path-array-p1-x"
              disabled={!targetState.ok}
              inputMode="decimal"
              onChange={(event) => updatePathDraft({ p1x: event.target.value })}
              type="number"
              value={effectivePathDraft.p1x}
            />
          </label>
          <label className="grid-array-field">
            <span>P1 Y</span>
            <input
              aria-label="控制点1 Y"
              data-testid="path-array-p1-y"
              disabled={!targetState.ok}
              inputMode="decimal"
              onChange={(event) => updatePathDraft({ p1y: event.target.value })}
              type="number"
              value={effectivePathDraft.p1y}
            />
          </label>
          <label className="grid-array-field">
            <span>P2 X</span>
            <input
              aria-label="控制点2 X"
              data-testid="path-array-p2-x"
              disabled={!targetState.ok}
              inputMode="decimal"
              onChange={(event) => updatePathDraft({ p2x: event.target.value })}
              type="number"
              value={effectivePathDraft.p2x}
            />
          </label>
          <label className="grid-array-field">
            <span>P2 Y</span>
            <input
              aria-label="控制点2 Y"
              data-testid="path-array-p2-y"
              disabled={!targetState.ok}
              inputMode="decimal"
              onChange={(event) => updatePathDraft({ p2y: event.target.value })}
              type="number"
              value={effectivePathDraft.p2y}
            />
          </label>
          <label className="grid-array-field">
            <span>P3 X</span>
            <input
              aria-label="终点 X"
              data-testid="path-array-p3-x"
              disabled={!targetState.ok}
              inputMode="decimal"
              onChange={(event) => updatePathDraft({ p3x: event.target.value })}
              type="number"
              value={effectivePathDraft.p3x}
            />
          </label>
          <label className="grid-array-field">
            <span>P3 Y</span>
            <input
              aria-label="终点 Y"
              data-testid="path-array-p3-y"
              disabled={!targetState.ok}
              inputMode="decimal"
              onChange={(event) => updatePathDraft({ p3y: event.target.value })}
              type="number"
              value={effectivePathDraft.p3y}
            />
          </label>
        </div>
      )}

      {feedbackMessage ? (
        <output
          className="grid-array-status"
          data-testid="grid-array-status"
          role="alert"
        >
          {feedbackMessage}
        </output>
      ) : null}

      <div className="grid-array-actions">
        <Button
          data-testid="grid-array-submit"
          disabled={!canSubmit}
          type="submit"
          variant="primary"
        >
          生成阵列
        </Button>
        <Button
          data-testid="grid-array-cancel"
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
