import { useState, useSyncExternalStore } from 'react';
import { evaluateShotAtTime, frameTimeMs, isFlaGraphicDefinition, lastValidFrameTime, TIMELINE_FPS, type Project, type Shot } from '../../../domain';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { layerStore } from '../../stores/layerStore';
import { selectionStore } from '../../stores/selectionStore';
import { shotStore } from '../../stores/shotStore';
import { Button } from '../../ui';
import { useTimelineUi } from '../timeline/timelineUiStore';

function targetKey(): string {
  return JSON.stringify([
    editorProjectStore.getProjectInstanceId(),
    shotStore.getCurrentShotId(),
    selectionStore.getSelectedLayerId(),
  ]);
}

function NumberField({ label, name, value, min, max, step = 1, placeholder }: {
  label: string; name: string; value?: number; min?: number; max?: number; step?: number | 'any'; placeholder?: string;
}) {
  return (
    <label className="grid-array-field">
      <span>{label}</span>
      <input type="number" name={name} defaultValue={value} min={min} max={max} step={step}
        placeholder={placeholder} required={value !== undefined} />
    </label>
  );
}

interface BakeTarget {
  readonly project: Project;
  readonly shot: Shot;
  readonly layerId: string;
}

export function GraphicBakePanel({ onCancel }: { onCancel(): void }) {
  const snapshot = useSyncExternalStore(editorProjectStore.subscribe, editorProjectStore.getSnapshot);
  const shotId = useSyncExternalStore(shotStore.subscribe, shotStore.getCurrentShotId);
  const layerId = useSyncExternalStore(selectionStore.subscribe, selectionStore.getSelectedLayerId);
  const { currentTimeMs } = useTimelineUi();
  const project = snapshot?.project;
  const shot = project?.shots.find((entry) => entry.id === shotId);
  const source = shot?.layers.find((entry) => entry.id === layerId);
  const animationId = source?.source.kind === 'animation' ? source.source.animationId : null;
  const definition = project?.animations.find((entry) => entry.id === animationId);
  if (!project || !shot || !source || !definition || !isFlaGraphicDefinition(definition) ||
    source.locked || source.id === shot.backgroundLayerId) {
    return (
      <div className="grid-array-panel">
        <div className="grid-array-status" role="status">请选择一个未锁定的普通 Graphic 图层。</div>
        <div className="grid-array-actions"><Button onClick={onCancel}>取消</Button></div>
      </div>
    );
  }
  const frame = Math.min(lastValidFrameTime(shot.durationMs), Math.max(0, currentTimeMs));
  return <OrbitDraft key={targetKey()} target={{ project, shot, layerId: source.id }}
    initialFrame={Math.round(frame * TIMELINE_FPS / 1000)} onCancel={onCancel} />;
}

function OrbitDraft({ target, initialFrame, onCancel }: { target: BakeTarget; initialFrame: number; onCancel(): void }) {
  const key = targetKey();
  const { shot, project, layerId } = target;
  const [frame, setFrame] = useState(String(initialFrame));
  const [count, setCount] = useState('3');
  const [primary, setPrimary] = useState('');
  const [secondary, setSecondary] = useState('');
  const [error, setError] = useState('');
  const lastFrame = Math.round(lastValidFrameTime(shot.durationMs) * TIMELINE_FPS / 1000);
  const startFrame = Number(frame);
  const visible = evaluateShotAtTime(shot, frameTimeMs(startFrame), project).layers;
  const references = shot.layers.filter((layer) =>
    layer.id !== layerId && layer.id !== shot.backgroundLayerId && visible.some((entry) => entry.id === layer.id && entry.visible),
  );
  const reference = visible.find((entry) => entry.id === primary);
  const validReferences = references.some((entry) => entry.id === primary) &&
    (!secondary || references.some((entry) => entry.id === secondary));
  return (
    <form aria-label="环绕飞行" className="grid-array-panel" onChange={() => setError('')} onSubmit={(event) => {
      event.preventDefault();
      if (targetKey() !== key || !validReferences || !reference) return;
      const fields = new FormData(event.currentTarget);
      const number = (name: string) => Number(fields.get(name));
      const x = fields.get('x');
      const y = fields.get('y');
      try {
        layerStore.generateOrbitFlight(layerId, {
          referenceLayerIds: secondary ? [primary, secondary] : [primary],
          center: x || y ? { x: x ? Number(x) : reference.x, y: y ? Number(y) : reference.y } : undefined,
          count: Number(count), startFrame, durationFrames: number('duration'),
          radiusX: number('radius-x'), radiusY: number('radius-y'), startAngleDeg: number('angle'),
          direction: fields.get('direction') === 'counterclockwise' ? 'counterclockwise' : 'clockwise',
          orientation: fields.get('orientation') === 'tangent' ? 'tangent' : 'keep',
        });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '生成环绕飞行失败。');
      }
    }}>
      <div className="grid-array-fields">
        <label className="grid-array-field">
          <span>参考图层</span>
          <select value={primary} required onChange={(event) => {
            setPrimary(event.target.value);
            if (event.target.value === secondary) setSecondary('');
          }}>
            <option value="">选择图层</option>
            {references.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
          </select>
        </label>
        <label className="grid-array-field">
          <span>第二参考图层</span>
          <select value={secondary} disabled={!primary} onChange={(event) => setSecondary(event.target.value)}>
            <option value="">无</option>
            {references.filter((entry) => entry.id !== primary).map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
          </select>
        </label>
        <label className="grid-array-field">
          <span>飞行数量</span>
          <input type="number" min={1} max={8} required value={count} onChange={(event) => setCount(event.target.value)} />
        </label>
        <NumberField label="横向半径" name="radius-x" value={240} min={0} step="any" />
        <NumberField label="纵向半径" name="radius-y" value={100} min={0} step="any" />
        <label className="grid-array-field">
          <span>起帧</span>
          <input type="number" min={0} max={lastFrame} required value={frame} onChange={(event) => setFrame(event.target.value)} />
        </label>
        <NumberField label="持续帧数" name="duration" value={48} min={4} />
        <label className="grid-array-field">
          <span>方向</span>
          <select name="direction"><option value="clockwise">顺时针</option><option value="counterclockwise">逆时针</option></select>
        </label>
      </div>
      <details>
        <summary>中心与朝向</summary>
        <div className="grid-array-fields">
          <NumberField label="中心 X" name="x" step="any" placeholder={reference?.x.toFixed(1)} />
          <NumberField label="中心 Y" name="y" step="any" placeholder={reference?.y.toFixed(1)} />
          <NumberField label="起始角" name="angle" step="any" value={0} />
          <label className="grid-array-field">
            <span>朝向</span>
            <select name="orientation"><option value="keep">保持</option><option value="tangent">沿切线</option></select>
          </label>
        </div>
      </details>
      <div className="grid-array-status" role="status">
        {error || (!validReferences ? '请选择起帧可见的参考图层。' :
          `${Number(count) * (secondary ? 3 : 2)} 个图层 · 各遮挡图层可独立编辑`)}
      </div>
      <div className="grid-array-actions">
        <Button type="button" onClick={onCancel}>取消</Button>
        <Button type="submit" disabled={!validReferences}>生成</Button>
      </div>
    </form>
  );
}
