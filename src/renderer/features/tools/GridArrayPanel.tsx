import { useState, useSyncExternalStore } from 'react';
import {
  GRID_ARRAY_DEFAULT_COLS,
  GRID_ARRAY_DEFAULT_ROWS,
  GRID_ARRAY_DEFAULT_SPACING_X,
  GRID_ARRAY_DEFAULT_SPACING_Y,
  GRID_ARRAY_MAX_INSTANCES,
  PROJECT_HEIGHT,
  PROJECT_WIDTH,
  isFlaGraphicDefinition,
  type GridArrayInput,
  type Layer,
} from '../../../domain';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { layerStore } from '../../stores/layerStore';
import { selectionStore } from '../../stores/selectionStore';
import { shotStore } from '../../stores/shotStore';
import { Button } from '../../ui';

export interface GridArrayPanelProps {
  onCancel(): void;
}

interface GridArrayTarget {
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

type ParsedGridArrayDraft =
  | { readonly ok: true; readonly input: GridArrayInput }
  | { readonly ok: false; readonly message: string };

const POSITIVE_INT_PATTERN = /^\d+$/u;

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
  return {
    ok: true,
    target: {
      projectInstanceId: editorProjectStore.getProjectInstanceId(),
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

function parsePositiveFinite(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && value > 0 ? value : null;
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

  const [rows, setRows] = useState(String(GRID_ARRAY_DEFAULT_ROWS));
  const [cols, setCols] = useState(String(GRID_ARRAY_DEFAULT_COLS));
  const [spacingX, setSpacingX] = useState(String(GRID_ARRAY_DEFAULT_SPACING_X));
  const [spacingY, setSpacingY] = useState(String(GRID_ARRAY_DEFAULT_SPACING_Y));
  const [status, setStatus] = useState('');

  const targetState = resolveGridArrayTarget();
  const parsedRows = parsePositiveInt(rows);
  const parsedCols = parsePositiveInt(cols);
  const spacingXDisabled = !targetState.ok || parsedCols === 1;
  const spacingYDisabled = !targetState.ok || parsedRows === 1;
  const parsed = parseGridArrayDraft(
    { rows, cols, spacingX, spacingY },
    targetState.ok ? { x: targetState.target.layer.x, y: targetState.target.layer.y } : undefined,
  );

  const canSubmit = targetState.ok && parsed.ok;
  const feedbackMessage = !targetState.ok
    ? targetState.message
    : !parsed.ok
      ? parsed.message
      : status;

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const live = resolveGridArrayTarget();
    if (!live.ok) {
      setStatus(live.message);
      return;
    }
    if (
      !targetState.ok ||
      live.target.projectInstanceId !== targetState.target.projectInstanceId ||
      live.target.projectId !== targetState.target.projectId ||
      live.target.projectRoot !== targetState.target.projectRoot ||
      live.target.shotId !== targetState.target.shotId ||
      live.target.layer.id !== targetState.target.layer.id
    ) {
      setStatus('选区或镜头已变化，请确认目标后再生成。');
      return;
    }
    const validated = parseGridArrayDraft(
      { rows, cols, spacingX, spacingY },
      { x: live.target.layer.x, y: live.target.layer.y },
    );
    if (!validated.ok) {
      setStatus(validated.message);
      return;
    }
    try {
      layerStore.duplicateAnimationLayerGrid(live.target.layer.id, validated.input);
      setStatus('');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '排兵布阵生成失败。');
    }
  };

  return (
    <form
      aria-label="排兵布阵"
      className="grid-array-panel"
      data-testid="grid-array-panel"
      noValidate
      onSubmit={handleSubmit}
    >
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
