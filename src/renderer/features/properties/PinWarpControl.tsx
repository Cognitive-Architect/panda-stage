import { useState } from 'react';
import {
  PIN_WARP_MAX_MESH_CELLS,
  PIN_WARP_MIN_MESH_CELLS,
  resolvePinWarpAuthoringTimeMs,
  resolvePinWarpPoseAtTime,
  type Layer,
  type Shot,
} from '../../../domain';
import { layerStore } from '../../stores/layerStore';
import { Button, Stepper } from '../../ui';
import { useTimelineUi } from '../timeline/timelineUiStore';

function poseStatusLabel(
  pinWarp: NonNullable<Layer['pinWarp']>,
  timeMs: number,
): string {
  const sample = resolvePinWarpPoseAtTime(pinWarp, timeMs);
  if (sample.status === 'invalid') return '数据无效，已显示原图';
  switch (sample.mode) {
    case 'exact':
      return '当前帧已有姿态';
    case 'between':
      return '两姿态之间插值';
    case 'hold-before':
      return '首个姿态之前（保持）';
    case 'hold-after':
      return '末个姿态之后（保持）';
  }
}

/**
 * Inspector control for the bitmap pin-warp prototype (#1460, R-D / R06).
 *
 * One deliberate action = one `editorProjectStore.updateProject` = one undo
 * step through `layerStore`/`LayerService`; no second store. Visible only for
 * ordinary bitmap content Layers (not backgrounds, characters, or Graphics),
 * matching the honest "one bitmap sleeve/braid" scope of the ticket.
 */
export function PinWarpControl({
  layer,
  shot,
}: {
  layer: Layer;
  shot: Shot;
}): React.JSX.Element | null {
  const { currentTimeMs } = useTimelineUi();
  const [error, setError] = useState('');

  if (layer.source.kind !== 'asset' || shot.backgroundLayerId === layer.id) {
    return null;
  }

  const pinWarp = layer.pinWarp;
  const authoringTimeMs = resolvePinWarpAuthoringTimeMs(
    currentTimeMs,
    shot.durationMs,
  );
  const poseAtCurrentTime = pinWarp?.poses.find(
    (pose) => pose.timeMs === authoringTimeMs,
  );

  const run = (action: () => void): void => {
    try {
      action();
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法修改控制点变形。');
    }
  };

  if (!pinWarp) {
    return (
      <details
        className="animation-key-selection"
        data-testid="layer-pin-warp"
      >
        <summary>控制点变形</summary>
        <p data-testid="layer-pin-warp-empty">
          把这张位图变成可拖动的柔性网格。小样范围：只作用于当前位图图层，不改变位置与缩放。
        </p>
        <Button
          disabled={layer.locked}
          onClick={() =>
            run(() => layerStore.bindPinWarp(layer.id, authoringTimeMs))
          }
          type="button"
          variant="secondary"
        >
          启用控制点变形
        </Button>
        {error ? <p role="alert">{error}</p> : null}
      </details>
    );
  }

  const { columns, rows } = pinWarp.mesh;
  const setDensity = (nextColumns: number, nextRows: number): void => {
    run(() =>
      layerStore.setPinWarpMeshDensity(layer.id, {
        columns: Math.min(
          PIN_WARP_MAX_MESH_CELLS,
          Math.max(PIN_WARP_MIN_MESH_CELLS, nextColumns),
        ),
        rows: Math.min(
          PIN_WARP_MAX_MESH_CELLS,
          Math.max(PIN_WARP_MIN_MESH_CELLS, nextRows),
        ),
      }),
    );
  };

  return (
    <details className="animation-key-selection" data-testid="layer-pin-warp">
      <summary>控制点变形</summary>
      <fieldset className="animation-curve-fields" disabled={layer.locked}>
        <legend>变形网格</legend>
        <div
          data-testid="layer-pin-warp-mesh"
          style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <span>列</span>
          <Stepper
            aria-label="变形网格列数"
            decrementDisabled={columns <= PIN_WARP_MIN_MESH_CELLS}
            incrementDisabled={columns >= PIN_WARP_MAX_MESH_CELLS}
            onDecrement={() => setDensity(columns - 1, rows)}
            onIncrement={() => setDensity(columns + 1, rows)}
            value={columns}
          />
          <span>行</span>
          <Stepper
            aria-label="变形网格行数"
            decrementDisabled={rows <= PIN_WARP_MIN_MESH_CELLS}
            incrementDisabled={rows >= PIN_WARP_MAX_MESH_CELLS}
            onDecrement={() => setDensity(columns, rows - 1)}
            onIncrement={() => setDensity(columns, rows + 1)}
            value={rows}
          />
        </div>
        <p data-testid="layer-pin-warp-pose" role="status">
          第 {authoringTimeMs} ms · {poseStatusLabel(pinWarp, authoringTimeMs)} ·{' '}
          {pinWarp.poses.length} 个姿态
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          <Button
            onClick={() =>
              run(() => layerStore.addPinWarpPose(layer.id, authoringTimeMs))
            }
            type="button"
            variant="secondary"
          >
            记录当前姿态
          </Button>
          <Button
            disabled={!poseAtCurrentTime}
            onClick={() =>
              run(() => layerStore.removePinWarpPose(layer.id, authoringTimeMs))
            }
            type="button"
            variant="secondary"
          >
            删除当前姿态
          </Button>
          <Button
            disabled={!poseAtCurrentTime}
            onClick={() =>
              run(() => layerStore.resetPinWarpPose(layer.id, authoringTimeMs))
            }
            type="button"
            variant="secondary"
          >
            重置当前姿态
          </Button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          <Button
            onClick={() => run(() => layerStore.reseedPinWarp(layer.id))}
            type="button"
            variant="secondary"
          >
            重置控制点
          </Button>
          <Button
            onClick={() => run(() => layerStore.clearPinWarp(layer.id))}
            type="button"
            variant="danger"
          >
            移除变形
          </Button>
        </div>
        <p>选中图层后在画布上拖动黄色控制点；拖动结束会写入当前帧的姿态。</p>
      </fieldset>
      {error ? <p role="alert">{error}</p> : null}
    </details>
  );
}
