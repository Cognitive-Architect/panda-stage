import { cloneElement, useState, type HTMLAttributes, type ReactElement } from 'react';
import * as ContextMenu from '@radix-ui/react-context-menu';
import { Camera, ChevronDown, ChevronRight, Diamond, Music, Plus, Trash2, ZoomIn } from 'lucide-react';
import { TimelineBody, layerClipItems, layerKeyItems, type TItem, type TRow } from '../../core/Timeline';
import { actions, currentLayer, currentShot, useStore } from '../../core/store';
import { Context, IconButton, Range } from './controls';
import { LayerContext, LayerIcon, LayerToggles } from './Layers';

function itemContext(item: TItem, target: ReactElement<HTMLAttributes<HTMLDivElement>>) {
  const select = () => { actions.select(item.sel); actions.seek(item.start); };
  return <Context key={item.sel?.id} target={cloneElement(target, {
    tabIndex: 0, role: 'button', 'aria-label': item.label ?? `第 ${item.start} 帧的关键帧`,
    onKeyDown: (event) => {
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        select();
      }
    },
  })}>
    <ContextMenu.Item onSelect={select}>定位到第 {item.start} 帧</ContextMenu.Item>
    <ContextMenu.Item onSelect={() => { actions.select(item.sel); actions.deleteSelection(); }}>删除{item.shape === 'key' || item.shape === 'cam' ? '关键帧' : '片段'}</ContextMenu.Item>
  </Context>;
}

function motionLanes(items: TItem[]) {
  const lanes: TItem[][] = [];
  for (const item of [...items].sort((a, b) => a.start - b.start)) {
    const lane = lanes.find((entries) => {
      const last = entries[entries.length - 1];
      return last.start + (last.len ?? 0) <= item.start;
    });
    if (lane) lane.push(item);
    else lanes.push([item]);
  }
  return lanes.length ? lanes : [[]];
}

export function Timeline() {
  const shot = useStore(currentShot);
  const selected = useStore(currentLayer);
  const zoom = useStore((s) => s.pxPerFrame);
  const selection = useStore((s) => s.sel);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const rows: TRow[] = [];
  shot.layers.forEach((layer, index) => {
    const open = expanded[layer.id];
    const clips = layerClipItems(layer, layer.kind === 'character' ? '#493878' : '#865337');
    const keys = layerKeyItems(layer);
    rows.push({
      id: layer.id, height: 27, active: layer.id === selected?.id, className: layer.visible ? '' : 'vd-hidden-track',
      onHeaderClick: () => actions.selectLayer(layer.id),
      header: <LayerContext layer={layer} index={index} count={shot.layers.length} target={<div className="vd-track">
        <IconButton label={open ? '折叠子轨' : '展开子轨'} pressed={!!open} onClick={() => setExpanded({ ...expanded, [layer.id]: !open })}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </IconButton>
        <LayerIcon kind={layer.kind} /><span>{layer.name}</span><LayerToggles layer={layer} />
      </div>} />,
      items: open ? [] : [...clips, ...keys],
    });
    if (open) {
      if (layer.kind !== 'background') {
        motionLanes(clips).forEach((items, lane) => rows.push({
          id: layer.id + ':motion:' + lane, height: 23,
          header: lane === 0 ? <span className="vd-subtrack">动作</span> : null, items,
        }));
      }
      rows.push({ id: layer.id + ':transform', height: 23, header: <span className="vd-subtrack">变换</span>, items: keys });
      rows.push({ id: layer.id + ':depth', height: 23, header: <span className="vd-subtrack">景深 · {layer.depth}</span>, items: [] });
    }
  });
  rows.push({
    id: 'camera', height: 27, header: <div className="vd-track vd-track-extra"><Camera size={14} /><span>相机</span>
      <IconButton label="添加相机关键帧" onClick={actions.addCameraKey}><Plus size={14} /></IconButton></div>,
    items: shot.camera.map((key) => ({ sel: { kind: 'cam', id: key.id }, shape: 'cam', start: key.t, color: '#65c5a0' })),
  });
  shot.audio.forEach((clip) => rows.push({
    id: clip.id, height: 28, header: <div className="vd-track vd-track-extra"><Music size={14} /><span>{clip.name}</span></div>,
    items: [{ sel: { kind: 'audio', id: clip.id }, shape: 'audio', start: clip.start, len: clip.len, label: clip.name, seed: clip.assetId, color: '#28594e' }],
  }));
  return <div className="vd-panel vd-timeline">
    <div className="vd-strip">
      <button className="vd-button" disabled={!selected || selected.locked} onClick={() => selected && actions.addKey(selected.id)}><Diamond size={14} />关键帧</button>
      <IconButton label="删除时间轴选中项" disabled={!selection} onClick={actions.deleteSelection}><Trash2 size={14} /></IconButton>
      <span className="vd-spacer" /><ZoomIn size={15} />
      <Range label="时间轴缩放" min={1.5} max={30} step={0.5} value={zoom} onChange={actions.setTimelineZoom} />
    </div>
    <TimelineBody rows={rows} headerWidth={206} rulerHeight={24} renderItem={itemContext} />
  </div>;
}
