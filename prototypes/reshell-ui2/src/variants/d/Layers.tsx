import { useState } from 'react';
import * as ContextMenu from '@radix-ui/react-context-menu';
import { ArrowDown, ArrowUp, Box, Eye, EyeOff, Image, Link2, Lock, Unlock, User } from 'lucide-react';
import type { Layer } from '../../core/model';
import { actions, currentShot, useStore } from '../../core/store';
import { Context, IconButton } from './controls';

export function LayerIcon({ kind }: { kind: Layer['kind'] }) {
  const Icon = kind === 'character' ? User : kind === 'prop' ? Box : Image;
  return <Icon size={14} className={`vd-kind ${kind}`} />;
}

export function LayerToggles({ layer }: { layer: Layer }) {
  return <>
    <IconButton label={layer.visible ? '隐藏图层' : '显示图层'} onClick={() => actions.toggleVisible(layer.id)}>{layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}</IconButton>
    <IconButton label={layer.locked ? '解锁图层' : '锁定图层'} onClick={() => actions.toggleLocked(layer.id)}>{layer.locked ? <Lock size={14} /> : <Unlock size={14} />}</IconButton>
  </>;
}

export function LayerContext({ layer, index, count, target }: { layer: Layer; index: number; count: number; target: React.ReactElement }) {
  return <Context target={target}>
    <ContextMenu.Item onSelect={() => actions.toggleVisible(layer.id)}>{layer.visible ? '隐藏图层' : '显示图层'}</ContextMenu.Item>
    <ContextMenu.Item onSelect={() => actions.toggleLocked(layer.id)}>{layer.locked ? '解锁图层' : '锁定图层'}</ContextMenu.Item>
    <ContextMenu.Item disabled={index === 0} onSelect={() => actions.reorder(layer.id, -1)}>上移一层</ContextMenu.Item>
    <ContextMenu.Item disabled={index === count - 1} onSelect={() => actions.reorder(layer.id, 1)}>下移一层</ContextMenu.Item>
    <ContextMenu.Item disabled={layer.locked} onSelect={() => actions.addKey(layer.id)}>添加关键帧</ContextMenu.Item>
    <ContextMenu.Separator />
    <ContextMenu.Item onSelect={() => actions.removeLayer(layer.id)}>删除图层</ContextMenu.Item>
  </Context>;
}

export function Layers() {
  const { layers } = useStore(currentShot);
  const selected = useStore((s) => s.layerId);
  const [showLinks, setShowLinks] = useState(false);
  const index = layers.findIndex((l) => l.id === selected);
  return (
    <div className="vd-panel">
      <div className="vd-strip vd-layer-tools">
        <IconButton label="上移一层" disabled={index <= 0} onClick={() => selected && actions.reorder(selected, -1)}><ArrowUp size={15} /></IconButton>
        <IconButton label="下移一层" disabled={index < 0 || index === layers.length - 1} onClick={() => selected && actions.reorder(selected, 1)}><ArrowDown size={15} /></IconButton>
        <span className="vd-spacer" />
        <IconButton label="父级与景深" pressed={showLinks} onClick={() => setShowLinks(!showLinks)}><Link2 size={15} /></IconButton>
      </div>
      <div className="vd-scroll">
        {layers.map((layer, i) => (
          <LayerContext key={layer.id} layer={layer} index={i} count={layers.length} target={
            <div className={`vd-layer-row ${selected === layer.id ? 'on' : ''}`} draggable
              onDragStart={(e) => e.dataTransfer.setData('text/layer', layer.id)}
              onDragOver={(e) => { if (e.dataTransfer.types.includes('text/layer')) e.preventDefault(); }}
              onDrop={(e) => {
                const id = e.dataTransfer.getData('text/layer');
                if (id !== layer.id && layers.some((entry) => entry.id === id)) actions.moveLayerTo(id, i);
              }}>
              <button className="vd-layer-name" aria-pressed={selected === layer.id} onClick={() => actions.selectLayer(layer.id)}>
                <LayerIcon kind={layer.kind} /><span>{layer.name}</span>
              </button>
              {showLinks && <span className="vd-layer-link" title={`景深 ${layer.depth}`}>
                {layers.find((entry) => entry.id === layer.parentId)?.name ?? '—'} · {layer.depth}
              </span>}
              <LayerToggles layer={layer} />
            </div>
          } />
        ))}
      </div>
    </div>
  );
}
