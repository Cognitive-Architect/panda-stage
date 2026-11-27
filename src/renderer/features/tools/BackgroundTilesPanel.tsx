import { useState, useSyncExternalStore } from 'react';
import type { BackgroundScrollDirection, BackgroundTileInput } from '../../../domain';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { layerStore } from '../../stores/layerStore';
import { selectionStore } from '../../stores/selectionStore';
import { shotStore } from '../../stores/shotStore';
import { Button } from '../../ui';

function currentTargetKey(): string {
  return JSON.stringify([
    editorProjectStore.getProjectInstanceId(),
    shotStore.getCurrentShotId(),
    selectionStore.getSelectedLayerId(),
  ]);
}

export function BackgroundTilesPanel({ onCancel }: { onCancel(): void }): React.JSX.Element {
  useSyncExternalStore(editorProjectStore.subscribe, editorProjectStore.getSnapshot);
  useSyncExternalStore(shotStore.subscribe, shotStore.getCurrentShotId);
  useSyncExternalStore(selectionStore.subscribe, selectionStore.getSelectedLayerId);
  return <BackgroundTilesDraft key={currentTargetKey()} onCancel={onCancel} />;
}

function BackgroundTilesDraft({ onCancel }: { onCancel(): void }): React.JSX.Element {
  const targetKey = currentTargetKey();
  const layerId = selectionStore.getSelectedLayerId();
  const [mode, setMode] = useState<BackgroundTileInput['mode']>('static');
  const [direction, setDirection] = useState<BackgroundScrollDirection>('left');
  const [period, setPeriod] = useState('24');
  const [error, setError] = useState('');
  const input: BackgroundTileInput = mode === 'static' ? { mode } : { mode, direction, periodFrames: Number(period) };
  let plan: ReturnType<typeof layerStore.planBackgroundTiles> | undefined;
  let message = '';
  try {
    if (!layerId) throw new Error('请选择一个未锁定的 Graphic 背景模板。');
    plan = layerStore.planBackgroundTiles(layerId, input);
  } catch (cause) {
    message = cause instanceof Error ? cause.message : '无法读取背景模板。';
  }

  return (
    <form aria-label="背景铺排 / 循环" className="grid-array-panel" noValidate onSubmit={(event) => {
      event.preventDefault();
      if (!plan || !layerId || currentTargetKey() !== targetKey) return;
      try {
        layerStore.generateBackgroundTiles(layerId, input);
        setError('');
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '背景铺排生成失败。');
      }
    }}>
      <div className="grid-array-fields">
        <label className="grid-array-field">
          <span>模式</span>
          <select value={mode} onChange={(event) => { setMode(event.target.value === 'loop' ? 'loop' : 'static'); setError(''); }}>
            <option value="static">静态铺排</option>
            <option value="loop">循环</option>
          </select>
        </label>
        {mode === 'loop' && <>
          <label className="grid-array-field">
            <span>方向</span>
            <select value={direction} onChange={(event) => { setDirection(event.target.value as BackgroundScrollDirection); setError(''); }}>
              <option value="left">向左</option>
              <option value="right">向右</option>
              <option value="up">向上</option>
              <option value="down">向下</option>
            </select>
          </label>
          <label className="grid-array-field">
            <span>周期（帧）</span>
            <input type="number" min={1} step={1} value={period} onChange={(event) => { setPeriod(event.target.value); setError(''); }} />
          </label>
        </>}
      </div>
      <div className="grid-array-status" role="status">
        {message || error || (plan && `${plan.count} 个副本 · ${Number(plan.width.toFixed(2))} × ${Number(plan.height.toFixed(2))} px`)}
      </div>
      <div className="grid-array-actions">
        <Button type="button" onClick={onCancel}>取消</Button>
        <Button type="submit" disabled={!plan}>生成</Button>
      </div>
    </form>
  );
}
