import { useRef, type ReactNode } from 'react';
import { Diamond } from 'lucide-react';
import { sampleTransform, uid, type Layer } from '../../core/model';
import { actions, currentLayer, currentShot, useStore } from '../../core/store';
import { EasingEditor } from '../../donors/EasingEditor';
import { NumberField } from '../../donors/NumberField';
import { OpenCutNumberField } from '../../donors/OpenCutControls';
import { IconButton, MotionMenu, Range } from './controls';
import { LayerIcon } from './Layers';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="vd-field"><span>{label}</span><div className="vd-values">{children}</div></div>;
}

function eligibleParents(layers: Layer[], id: string) {
  return layers.filter((candidate) => {
    if (candidate.kind === 'background') return false;
    const seen = new Set([id]);
    let ancestor: Layer | undefined = candidate;
    while (ancestor) {
      if (seen.has(ancestor.id)) return false;
      seen.add(ancestor.id);
      const parentId: string | null = ancestor.parentId;
      ancestor = layers.find((layer) => layer.id === parentId);
    }
    return true;
  });
}

export function Inspector() {
  const layer = useStore(currentLayer);
  const shot = useStore(currentShot);
  const selection = useStore((s) => s.sel);
  const time = useStore((s) => Math.round(s.time));
  const depthGesture = useRef('');
  const camera = selection?.kind === 'cam' && shot.camera.find((key) => key.id === selection.id);
  const audio = selection?.kind === 'audio' && shot.audio.find((clip) => clip.id === selection.id);

  if (audio) return <div className="vd-panel vd-inspector"><strong>{audio.name}</strong><Field label="起始帧">
    <NumberField label="帧" title="音频起始帧" value={audio.start} min={0} max={shot.duration - 1} onChange={(v, g) => actions.moveItem(selection, v, g)} />
  </Field></div>;
  if (camera) return <div className="vd-panel vd-inspector">
    <strong>相机 · 第 {camera.t} 帧</strong>
    <Field label="位置">
      <NumberField label="X" title="相机位置 X" value={camera.x} onChange={(x, g) => actions.setCamKey(camera.id, { x }, g)} />
      <NumberField label="Y" title="相机位置 Y" value={camera.y} onChange={(y, g) => actions.setCamKey(camera.id, { y }, g)} />
    </Field>
    <Field label="缩放"><NumberField label="%" title="相机缩放" value={camera.zoom * 100} min={1}
      onChange={(v, g) => actions.setCamKey(camera.id, { zoom: v / 100 }, g)} /></Field>
  </div>;
  if (!layer) return <div className="vd-empty">未选择图层</div>;

  const selectedKey = selection?.kind === 'key' && layer.keys.find((key) => key.id === selection.id);
  const value = sampleTransform({ ...layer, clips: [] }, time);
  const keyed = layer.keys.some((key) => key.t === time);
  const clip = selection?.kind === 'clip' && layer.clips.find((entry) => entry.id === selection.id);
  return (
    <div key={layer.id} className="vd-panel vd-inspector">
      <div className="vd-object"><LayerIcon kind={layer.kind} /><strong>{layer.name}</strong><span className="vd-spacer" />
        <IconButton label="添加关键帧" pressed={keyed} disabled={layer.locked || keyed} onClick={() => actions.addKey(layer.id)}><Diamond size={14} /></IconButton>
      </div>
      <details open>
        <summary>变换</summary>
        <Field label="位置">
          <NumberField label="X" title="位置 X" value={value.x} disabled={layer.locked} onChange={(x, g) => actions.setProps(layer.id, { x }, g)} />
          <NumberField label="Y" title="位置 Y" value={value.y} disabled={layer.locked} onChange={(y, g) => actions.setProps(layer.id, { y }, g)} />
        </Field>
        <Field label="缩放"><OpenCutNumberField icon="%" label="缩放" value={value.scale * 100} step={0.1} min={1} defaultValue={100}
          disabled={layer.locked} onChange={(v, g) => actions.setProps(layer.id, { scale: v / 100 }, g)} /></Field>
        <Field label="旋转"><NumberField label="°" title="旋转" value={value.rotation} disabled={layer.locked}
          onChange={(rotation, g) => actions.setProps(layer.id, { rotation }, g)} /></Field>
        <Field label="不透明度"><NumberField label="%" title="不透明度" value={value.opacity * 100} min={0} max={100} disabled={layer.locked}
          onChange={(v, g) => actions.setProps(layer.id, { opacity: v / 100 }, g)} /></Field>
        {selectedKey && <Field label="关键帧"><NumberField label="帧" title="关键帧位置" value={selectedKey.t} min={0} max={shot.duration}
          disabled={layer.locked} onChange={(v, g) => actions.moveItem(selection, v, g)} /></Field>}
      </details>
      <details>
        <summary>父级与景深</summary>
        {layer.kind !== 'background' && <Field label="父级"><select aria-label="父级" value={layer.parentId ?? ''} disabled={layer.locked}
          onChange={(event) => actions.setParent(layer.id, event.target.value || null)}>
          <option value="">无</option>
          {eligibleParents(shot.layers, layer.id).map((parent) => <option key={parent.id} value={parent.id}>{parent.name}</option>)}
        </select></Field>}
        <Field label="景深"><NumberField label="Z" title="景深" value={layer.depth} step={0.1} min={-5} max={10} disabled={layer.locked}
          onChange={(v, g) => actions.setDepth(layer.id, v, g)} /></Field>
        <Range label="景深" min={-5} max={10} step={0.1} value={layer.depth} disabled={layer.locked}
          onChange={(v) => actions.setDepth(layer.id, v, depthGesture.current ||= uid('depth'))}
          onCommit={() => { depthGesture.current = ''; }} />
      </details>
      {layer.kind !== 'background' && <details open={!!clip}>
        <summary>动作</summary>
        <div className="vd-motion-list">
          {layer.clips.map((entry) => <button key={entry.id} className="vd-button" aria-pressed={entry === clip}
            onClick={() => actions.select({ kind: 'clip', layerId: layer.id, id: entry.id })}>{entry.name}</button>)}
          {!layer.locked && <MotionMenu layerId={layer.id} />}
        </div>
        {clip && <Field label="时长"><NumberField label="帧" title="动作时长" value={clip.len} min={4} disabled={layer.locked}
          onChange={(v, g) => actions.resizeClip(selection, v, g)} /></Field>}
      </details>}
    </div>
  );
}

export function Curve() {
  const selection = useStore((s) => s.sel);
  const shot = useStore(currentShot);
  const key = selection?.kind === 'cam' ? shot.camera.find((entry) => entry.id === selection.id)
    : selection?.kind === 'key' ? shot.layers.find((layer) => layer.id === selection.layerId)?.keys.find((entry) => entry.id === selection.id) : undefined;
  return key ? <div className="vd-panel vd-inspector">
    <strong>第 {key.t} 帧</strong>
    <EasingEditor key={key.id} value={key.easing} onChange={(value, gesture) => actions.setEasing(selection, value, gesture)} />
  </div> : <div className="vd-empty">选择时间轴上的关键帧</div>;
}
