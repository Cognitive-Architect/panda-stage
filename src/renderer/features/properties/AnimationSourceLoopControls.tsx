import { useState } from 'react';
import type { Layer } from '../../../domain';
import { Button } from '../../ui';

export function AnimationSourceLoopControls({ layer, orderedLayers, frameCount, onApply }: {
  layer: Layer;
  orderedLayers: readonly Layer[];
  frameCount: number;
  onApply: (range: { firstFrame: number; lastFrame: number; closingReference: boolean; throughLayerId: string }) => void;
}): React.JSX.Element {
  const [firstFrame, setFirstFrame] = useState((layer.animationSourceRange?.firstFrame ?? layer.animationFirstFrame ?? 0) + 1);
  const [lastFrame, setLastFrame] = useState((layer.animationSourceRange?.lastFrame ?? frameCount - 1) + 1);
  const [closingReference, setClosingReference] = useState(false);
  const [throughLayerId, setThroughLayerId] = useState(layer.id);
  const end = lastFrame - Number(closingReference);
  const valid = Number.isSafeInteger(firstFrame) && Number.isSafeInteger(lastFrame) &&
    firstFrame >= 1 && lastFrame <= frameCount && end >= firstFrame;
  return <details>
    <summary>图层循环范围</summary>
    <label className="animation-playback-field">首帧<input type="number" min={1} max={frameCount} value={firstFrame}
      disabled={layer.locked} onChange={(event) => setFirstFrame(Number(event.target.value))} /></label>
    <label className="animation-playback-field">尾帧<input type="number" min={1} max={frameCount} value={lastFrame}
      disabled={layer.locked} onChange={(event) => setLastFrame(Number(event.target.value))} /></label>
    <label><input type="checkbox" checked={closingReference} disabled={layer.locked}
      onChange={(event) => setClosingReference(event.target.checked)} />尾帧仅作闭合参考</label>
    {orderedLayers.length > 1 ? <label className="animation-playback-field">同步至图层
      <select value={throughLayerId} disabled={layer.locked} onChange={(event) => setThroughLayerId(event.target.value)}>
        {orderedLayers.map((entry) => <option key={entry.id} value={entry.id}>{entry.id === layer.id ? '当前图层' : entry.name}</option>)}
      </select>
    </label> : null}
    <Button disabled={layer.locked || !valid} onClick={() => onApply({
      firstFrame: firstFrame - 1, lastFrame: lastFrame - 1, closingReference, throughLayerId,
    })}>
      {valid ? `循环播放第 ${firstFrame}–${end} 帧` : '应用循环'}
    </Button>
  </details>;
}
