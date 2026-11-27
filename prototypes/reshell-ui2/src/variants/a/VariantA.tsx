// Variant A · 现代创作派 (Rive / Figma). Radix primitives + react-resizable-panels + Animora field/easing donors.
import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Popover from '@radix-ui/react-popover';
import * as Tabs from '@radix-ui/react-tabs';
import * as Tooltip from '@radix-ui/react-tooltip';
import * as ContextMenu from '@radix-ui/react-context-menu';
import * as Slider from '@radix-ui/react-slider';
import { Group, Panel, Separator, type PanelImperativeHandle } from 'react-resizable-panels';
import { useRef } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Diamond, Download, Eye, EyeOff, Lock, Unlock, Pause, Play, Redo2, Undo2, ArrowUp, ArrowDown, Sparkles, Search, Plus, Camera, Music, PanelLeft, PanelRight, Trash2, User, Box, Image as ImageIcon, SkipBack, SkipForward } from 'lucide-react';
import { ASSETS, CATEGORIES, assetUrl, type AssetCategory } from '../../core/assets';
import { easeLabel, fmtTime, sampleTransform, type Layer } from '../../core/model';
import { Stage, type OverlayRect } from '../../core/Stage';
import { TimelineBody, layerClipItems, layerKeyItems, type TRow } from '../../core/Timeline';
import { actions, currentLayer, currentShot, useStore } from '../../core/store';
import { NumberField } from '../../donors/NumberField';
import { EasingEditor } from '../../donors/EasingEditor';
import { defaultExport, useExportSim, type ExportOpts } from '../../core/exportSim';
import './a.css';

const kindIcon = (k: Layer['kind']) => (k === 'character' ? <User size={13} /> : k === 'prop' ? <Box size={13} /> : <ImageIcon size={13} />);

function Tip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip.Root delayDuration={350}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal><Tooltip.Content className="va-tip" sideOffset={6}>{label}</Tooltip.Content></Tooltip.Portal>
    </Tooltip.Root>
  );
}

function TopBar({ onToggleLeft, onToggleRight }: { onToggleLeft: () => void; onToggleRight: () => void }) {
  const project = useStore((s) => s.project);
  const shot = useStore(currentShot);
  const past = useStore((s) => s.past.length);
  const fut = useStore((s) => s.future.length);
  const zoom = useStore((s) => s.viewZoom);
  return (
    <header className="va-top">
      <div className="va-top-l">
        <div className="va-logo">🐼</div>
        <Tip label="左侧面板"><button className="va-icon" onClick={onToggleLeft}><PanelLeft size={16} /></button></Tip>
        <span className="va-proj">{project.name}</span>
        <span className="va-sep">/</span>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger className="va-shot-trigger">{shot.name}<ChevronDown size={14} /></DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="va-menu" sideOffset={6}>
              {project.shots.map((s) => (
                <DropdownMenu.Item key={s.id} className={`va-menu-item ${s.id === shot.id ? 'on' : ''}`} onSelect={() => actions.setShot(s.id)}>
                  {s.name}<span className="va-menu-hint">{fmtTime(s.duration)}</span>
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
      <div className="va-top-c">
        <Tip label="撤销 Ctrl+Z"><button className="va-icon" disabled={!past} onClick={actions.undo}><Undo2 size={16} /></button></Tip>
        <Tip label="重做 Ctrl+Shift+Z"><button className="va-icon" disabled={!fut} onClick={actions.redo}><Redo2 size={16} /></button></Tip>
      </div>
      <div className="va-top-r">
        <div className="va-zoom">
          <button onClick={() => actions.setViewZoom(zoom / 1.2)}>−</button>
          <span onDoubleClick={() => actions.setViewZoom(1)}>{Math.round(zoom * 100)}%</span>
          <button onClick={() => actions.setViewZoom(zoom * 1.2)}>+</button>
        </div>
        <ExportDialog />
        <Tip label="属性面板"><button className="va-icon" onClick={onToggleRight}><PanelRight size={16} /></button></Tip>
      </div>
    </header>
  );
}

function ExportDialog() {
  const [o, setO] = useState<ExportOpts>(defaultExport);
  const sim = useExportSim();
  const project = useStore((s) => s.project);
  return (
    <Dialog.Root onOpenChange={(v) => !v && sim.cancel()}>
      <Dialog.Trigger className="va-primary"><Download size={14} />导出</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="va-overlay" />
        <Dialog.Content className="va-dialog">
          <Dialog.Title>导出动画</Dialog.Title>
          <div className="va-seg-row"><label>格式</label><div className="va-seg">{(['mp4', 'gif', 'png'] as const).map((f) => <button key={f} className={o.format === f ? 'on' : ''} onClick={() => setO({ ...o, format: f })}>{f === 'png' ? 'PNG 序列' : f.toUpperCase()}</button>)}</div></div>
          <div className="va-seg-row"><label>分辨率</label><div className="va-seg">{(['720p', '1080p', '4k'] as const).map((f) => <button key={f} className={o.res === f ? 'on' : ''} onClick={() => setO({ ...o, res: f })}>{f.toUpperCase()}</button>)}</div></div>
          <div className="va-seg-row"><label>帧率</label><div className="va-seg">{([24, 30, 60] as const).map((f) => <button key={f} className={o.fps === f ? 'on' : ''} onClick={() => setO({ ...o, fps: f })}>{f}</button>)}</div></div>
          <div className="va-seg-row"><label>范围</label><div className="va-seg"><button className={o.range === 'all' ? 'on' : ''} onClick={() => setO({ ...o, range: 'all' })}>全部镜头 ({project.shots.length})</button><button className={o.range === 'shot' ? 'on' : ''} onClick={() => setO({ ...o, range: 'shot' })}>当前镜头</button></div></div>
          <div className="va-seg-row"><label>质量</label><Slider.Root className="va-slider" min={10} max={100} value={[o.quality]} onValueChange={([q]) => setO({ ...o, quality: q })}><Slider.Track className="va-slider-track"><Slider.Range className="va-slider-range" /></Slider.Track><Slider.Thumb className="va-slider-thumb" /></Slider.Root><span className="va-num">{o.quality}</span></div>
          {sim.phase !== 'idle' && <div className="va-progress"><i style={{ width: `${sim.progress}%` }} /><span>{sim.phase === 'done' ? '模拟导出完成' : `模拟导出 ${sim.progress}%`}</span></div>}
          <div className="va-dialog-foot">
            <Dialog.Close className="va-ghost">取消</Dialog.Close>
            <button className="va-primary" disabled={sim.phase === 'running'} onClick={sim.start}>{sim.phase === 'done' ? '再次导出' : '开始导出'}</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function LayerRow({ l, index }: { l: Layer; index: number }) {
  const sel = useStore((s) => s.layerId === l.id);
  const [edit, setEdit] = useState(false);
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div
          className={`va-layer ${sel ? 'on' : ''} ${l.visible ? '' : 'hidden'}`}
          draggable
          onDragStart={(e) => e.dataTransfer.setData('text/layer', l.id)}
          onDragOver={(e) => e.dataTransfer.types.includes('text/layer') && e.preventDefault()}
          onDrop={(e) => { const id = e.dataTransfer.getData('text/layer'); if (id && id !== l.id) actions.moveLayerTo(id, index); }}
          onClick={() => actions.selectLayer(l.id)}
        >
          <span className="va-layer-kind">{kindIcon(l.kind)}</span>
          {edit ? <input autoFocus defaultValue={l.name} onBlur={(e) => { setEdit(false); if (e.target.value.trim()) actions.rename(l.id, e.target.value.trim()); }} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
            : <span className="va-layer-name" onDoubleClick={() => setEdit(true)}>{l.name}</span>}
          {l.keys.length > 0 && <Diamond size={10} className="va-layer-hasKey" />}
          <button className={`va-mini ${l.locked ? 'stay' : ''}`} onClick={(e) => { e.stopPropagation(); actions.toggleLocked(l.id); }}>{l.locked ? <Lock size={12} /> : <Unlock size={12} />}</button>
          <button className={`va-mini ${!l.visible ? 'stay' : ''}`} onClick={(e) => { e.stopPropagation(); actions.toggleVisible(l.id); }}>{l.visible ? <Eye size={12} /> : <EyeOff size={12} />}</button>
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="va-menu">
          <ContextMenu.Item className="va-menu-item" onSelect={() => setEdit(true)}>重命名</ContextMenu.Item>
          <ContextMenu.Item className="va-menu-item" onSelect={() => actions.reorder(l.id, -1)}>上移一层</ContextMenu.Item>
          <ContextMenu.Item className="va-menu-item" onSelect={() => actions.reorder(l.id, 1)}>下移一层</ContextMenu.Item>
          <ContextMenu.Item className="va-menu-item" onSelect={() => { actions.selectLayer(l.id); actions.addKey(l.id); }}>在播放头添加关键帧</ContextMenu.Item>
          <ContextMenu.Separator className="va-menu-sep" />
          <ContextMenu.Item className="va-menu-item danger" onSelect={() => actions.removeLayer(l.id)}>删除</ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

function AssetsTab() {
  const [cat, setCat] = useState<AssetCategory | '全部'>('全部');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const list = ASSETS.filter((a) => (cat === '全部' || a.category === cat) && (!q || a.name.includes(q) || a.tags.some((t) => t.includes(q))));
  return (
    <div className="va-assets">
      <div className="va-search"><Search size={13} /><input placeholder="搜索素材" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="va-chips">{(['全部', ...CATEGORIES] as const).map((c) => <button key={c} className={cat === c ? 'on' : ''} onClick={() => setCat(c)}>{c}</button>)}</div>
      <div className="va-asset-grid">
        {list.map((a) => (
          <div key={a.id} className={`va-asset ${picked === a.id ? 'on' : ''}`} draggable onDragStart={(e) => e.dataTransfer.setData('text/asset', a.id)} onClick={() => setPicked(a.id)} onDoubleClick={() => actions.placeAsset(a.id)}>
            <div className="va-asset-thumb">{a.svg ? <img src={assetUrl(a)} alt="" /> : <Music size={22} />}</div>
            <span>{a.name}</span>
            <button className="va-asset-add" title="放入当前镜头" onClick={(e) => { e.stopPropagation(); actions.placeAsset(a.id); }}><Plus size={12} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

function LeftPanel() {
  const shot = useStore(currentShot);
  return (
    <Tabs.Root className="va-left" defaultValue="layers">
      <Tabs.List className="va-tabs">
        <Tabs.Trigger value="layers">图层</Tabs.Trigger>
        <Tabs.Trigger value="assets">资源</Tabs.Trigger>
      </Tabs.List>
      <Tabs.Content value="layers" className="va-tab-body">
        <div className="va-layers">{shot.layers.map((l, i) => <LayerRow key={l.id} l={l} index={i} />)}</div>
        <div className="va-audio-list">
          {shot.audio.map((a) => <div key={a.id} className="va-audio-item" onClick={() => actions.select({ kind: 'audio', id: a.id })}><Music size={12} />{a.name}</div>)}
        </div>
      </Tabs.Content>
      <Tabs.Content value="assets" className="va-tab-body"><AssetsTab /></Tabs.Content>
    </Tabs.Root>
  );
}

export function ContextToolbar({ r, fusion = false }: { r: OverlayRect; fusion?: boolean }) {
  const l = useStore(currentLayer);
  if (!l) return null;
  return (
    <div className={fusion ? 'va-ctx vd-object-tools' : 'va-ctx'} style={fusion ? {
      left: `clamp(100px, ${r.x + r.w / 2}px, 100cqw - 100px)`,
      top: `clamp(6px, ${r.y > 48 ? r.y - 44 : r.y + r.h + 6}px, 100cqh - 44px)`,
    } : { left: r.x + r.w / 2, top: Math.max(8, r.y - 46) }} onPointerDown={(e) => e.stopPropagation()}>
      {!fusion && <span className="va-ctx-name">{l.name}</span>}
      <Tip label="添加关键帧 K"><button aria-label="对象添加关键帧" disabled={fusion && l.locked} onClick={() => actions.addKey(l.id)}><Diamond size={14} /></button></Tip>
      {(!fusion || (l.kind !== 'background' && !l.locked)) && <DropdownMenu.Root>
        <Tip label="添加动作"><DropdownMenu.Trigger asChild><button aria-label="对象添加动作"><Sparkles size={14} /></button></DropdownMenu.Trigger></Tip>
        <DropdownMenu.Portal><DropdownMenu.Content className="va-menu" sideOffset={6}>
          {([['walk', '走路'], ['wave', '挥手'], ['bounce', '弹跳'], ['sway', '摇摆']] as const).map(([m, n]) => <DropdownMenu.Item key={m} className="va-menu-item" onSelect={() => actions.addAction(l.id, m)}>{n}</DropdownMenu.Item>)}
        </DropdownMenu.Content></DropdownMenu.Portal>
      </DropdownMenu.Root>}
      <i />
      <Tip label="上移一层"><button aria-label="对象上移一层" onClick={() => actions.reorder(l.id, -1)}><ArrowUp size={14} /></button></Tip>
      <Tip label="下移一层"><button aria-label="对象下移一层" onClick={() => actions.reorder(l.id, 1)}><ArrowDown size={14} /></button></Tip>
      <Tip label={l.locked ? '解锁' : '锁定'}><button aria-label={l.locked ? '解锁对象' : '锁定对象'} onClick={() => actions.toggleLocked(l.id)}>{l.locked ? <Lock size={14} /> : <Unlock size={14} />}</button></Tip>
      <Tip label="隐藏"><button aria-label="隐藏对象" onClick={() => actions.toggleVisible(l.id)}><EyeOff size={14} /></button></Tip>
    </div>
  );
}

function Inspector() {
  const l = useStore(currentLayer);
  const time = useStore((s) => s.time);
  const sel = useStore((s) => s.sel);
  const shot = useStore(currentShot);
  if (sel?.kind === 'cam') {
    const k = shot.camera.find((c) => c.id === sel.id);
    if (k) return (
      <aside className="va-insp">
        <h4><Camera size={14} />相机 · 第 {k.t} 帧</h4>
        <div className="va-grid2">
          <NumberField suffix label="X" value={k.x} onChange={(v, g) => actions.setCamKey(k.id, { x: v }, g)} />
          <NumberField suffix label="Y" value={k.y} onChange={(v, g) => actions.setCamKey(k.id, { y: v }, g)} />
        </div>
        <NumberField suffix label="缩放" step={0.01} value={k.zoom} min={0.2} max={4} onChange={(v, g) => actions.setCamKey(k.id, { zoom: v }, g)} />
        <h5>缓动</h5>
        <EasingEditor value={k.easing} onChange={(b, g) => actions.setEasing(sel, b, g)} />
      </aside>
    );
  }
  if (!l) return <aside className="va-insp empty"><div className="va-empty">选择画布中的对象</div></aside>;
  const v = sampleTransform({ ...l, clips: [] }, Math.round(time));
  const t = Math.round(time);
  const keyHere = l.keys.find((k) => k.t === t);
  const selKey = sel?.kind === 'key' && sel.layerId === l.id ? l.keys.find((k) => k.id === sel.id) : keyHere;
  const set = (p: Partial<typeof v>, g: string) => actions.setProps(l.id, p, g);
  const sorted = [...l.keys].sort((a, b) => a.t - b.t);
  const prev = sorted.filter((k) => k.t < t).at(-1); const next = sorted.find((k) => k.t > t);
  return (
    <aside className="va-insp">
      <div className="va-insp-head">
        <span className="va-layer-kind">{kindIcon(l.kind)}</span><b>{l.name}</b>
        <div className="va-keynav">
          <button disabled={!prev} onClick={() => prev && actions.seek(prev.t)}><ChevronLeft size={13} /></button>
          <button className={keyHere ? 'on' : ''} onClick={() => (keyHere ? actions.select({ kind: 'key', layerId: l.id, id: keyHere.id }) : actions.addKey(l.id))}><Diamond size={12} /></button>
          <button disabled={!next} onClick={() => next && actions.seek(next.t)}><ChevronRight size={13} /></button>
        </div>
      </div>
      <h5>变换{l.keys.length ? <span className="va-auto">自动关键帧</span> : null}</h5>
      <div className="va-grid2">
        <NumberField suffix label="X" value={v.x} disabled={l.locked} defaultValue={640} onChange={(x, g) => set({ x }, g)} />
        <NumberField suffix label="Y" value={v.y} disabled={l.locked} onChange={(y, g) => set({ y }, g)} />
        <NumberField suffix label="缩放" step={0.01} min={0.05} value={v.scale} disabled={l.locked} defaultValue={1} onChange={(s, g) => set({ scale: s }, g)} />
        <NumberField suffix label="旋转" unit="°" value={v.rotation} disabled={l.locked} defaultValue={0} onChange={(r, g) => set({ rotation: r }, g)} />
      </div>
      <NumberField label="透明度" step={0.01} min={0} max={1} value={v.opacity} disabled={l.locked} defaultValue={1} onChange={(o, g) => set({ opacity: o }, g)} />
      <h5>关键帧</h5>
      {selKey ? (
        <Popover.Root>
          <Popover.Trigger className="va-ease-trigger">
            <svg viewBox="0 0 40 24"><path d={`M2 22 C ${2 + selKey.easing[0] * 36} ${22 - selKey.easing[1] * 20} ${2 + selKey.easing[2] * 36} ${22 - selKey.easing[3] * 20} 38 2`} /></svg>
            <span>第 {selKey.t} 帧 · {easeLabel(selKey.easing)}</span><ChevronDown size={13} />
          </Popover.Trigger>
          <Popover.Portal><Popover.Content className="va-pop" side="left" sideOffset={10} align="start">
            <EasingEditor value={selKey.easing} onChange={(b, g) => actions.setEasing({ kind: 'key', layerId: l.id, id: selKey.id }, b, g)} />
          </Popover.Content></Popover.Portal>
        </Popover.Root>
      ) : <button className="va-ghost wide" onClick={() => actions.addKey(l.id)}><Diamond size={12} />在第 {t} 帧添加关键帧</button>}
      <h5>动作</h5>
      <div className="va-clips">
        {l.clips.map((c) => <button key={c.id} className={sel?.kind === 'clip' && sel.id === c.id ? 'on' : ''} onClick={() => actions.select({ kind: 'clip', layerId: l.id, id: c.id })}>{c.name}<span>{c.start}–{c.start + c.len}</span></button>)}
      </div>
      <h5>层级</h5>
      <div className="va-grid2">
        <select className="va-select" value={l.parentId ?? ''} onChange={(e) => actions.setParent(l.id, e.target.value || null)}>
          <option value="">无父级</option>
          {shot.layers.filter((x) => x.id !== l.id && x.kind !== 'background').map((x) => <option key={x.id} value={x.id}>跟随 {x.name}</option>)}
        </select>
        <NumberField suffix label="景深" value={l.depth} min={-5} max={10} onChange={(d, g) => actions.setDepth(l.id, d, g)} />
      </div>
    </aside>
  );
}

function TimelineA() {
  const shot = useStore(currentShot);
  const layerId = useStore((s) => s.layerId);
  const playing = useStore((s) => s.playing);
  const time = useStore((s) => s.time);
  const ppf = useStore((s) => s.pxPerFrame);
  const rows: TRow[] = shot.layers.map((l) => ({
    id: l.id, height: 30, active: l.id === layerId, onHeaderClick: () => actions.selectLayer(l.id),
    header: <div className="va-tl-head"><span className="va-layer-kind">{kindIcon(l.kind)}</span><span>{l.name}</span></div>,
    items: [...layerClipItems(l), ...layerKeyItems(l)],
    className: l.visible ? '' : 'dim',
  }));
  rows.push({ id: 'cam', height: 26, header: <div className="va-tl-head"><Camera size={13} /><span>相机</span><button className="va-mini" onClick={actions.addCameraKey}><Plus size={12} /></button></div>, items: shot.camera.map((k) => ({ sel: { kind: 'cam', id: k.id }, start: k.t, shape: 'cam' })), className: 'cam' });
  for (const a of shot.audio) rows.push({ id: a.id, height: 26, header: <div className="va-tl-head"><Music size={13} /><span>{a.name}</span></div>, items: [{ sel: { kind: 'audio', id: a.id }, start: a.start, len: a.len, shape: 'audio', seed: a.assetId }], className: 'audio' });
  return (
    <div className="va-timeline">
      <div className="va-tl-bar">
        <button className="va-icon" onClick={() => actions.seek(0)}><SkipBack size={14} /></button>
        <button className="va-play" onClick={() => actions.play()}>{playing ? <Pause size={15} /> : <Play size={15} />}</button>
        <button className="va-icon" onClick={() => actions.seek(shot.duration)}><SkipForward size={14} /></button>
        <span className="va-tc">{fmtTime(time)}<em>/ {fmtTime(shot.duration)}</em></span>
        <span className="va-flex" />
        <button className="va-icon" title="删除所选" onClick={actions.deleteSelection}><Trash2 size={14} /></button>
        <Slider.Root className="va-slider small" min={1.5} max={30} step={0.5} value={[ppf]} onValueChange={([v]) => actions.setTimelineZoom(v)}><Slider.Track className="va-slider-track"><Slider.Range className="va-slider-range" /></Slider.Track><Slider.Thumb className="va-slider-thumb" /></Slider.Root>
      </div>
      <TimelineBody rows={rows} headerWidth={168} rulerHeight={22} className="va-tl" />
    </div>
  );
}

export default function VariantA() {
  const [overlay, setOverlay] = useState<OverlayRect | null>(null);
  const left = useRef<PanelImperativeHandle>(null);
  const right = useRef<PanelImperativeHandle>(null);
  const toast = useStore((s) => s.toast);
  const playing = useStore((s) => s.playing);
  const toggle = (p: PanelImperativeHandle | null) => p && (p.isCollapsed() ? p.expand() : p.collapse());
  return (
    <Tooltip.Provider>
      <div className="va">
        <TopBar onToggleLeft={() => toggle(left.current)} onToggleRight={() => toggle(right.current)} />
        <Group orientation="horizontal" className="va-body">
          <Panel panelRef={left} id="a-left" defaultSize={248} minSize={190} maxSize={380} collapsible collapsedSize={0}><LeftPanel /></Panel>
          <Separator className="va-sep-v" />
          <Panel id="a-center" minSize={400}>
            <Group orientation="vertical">
              <Panel id="a-canvas" minSize={200}>
                <div className="va-canvas">
                  <Stage theme={{ backdrop: '#121316', frameStroke: 'rgba(255,255,255,.12)', accent: '#7c6cff' }} onOverlay={setOverlay} />
                  {overlay && !playing && <ContextToolbar r={overlay} />}
                </div>
              </Panel>
              <Separator className="va-sep-h" />
              <Panel id="a-timeline" defaultSize={230} minSize={120} maxSize={480}><TimelineA /></Panel>
            </Group>
          </Panel>
          <Separator className="va-sep-v" />
          <Panel panelRef={right} id="a-right" defaultSize={280} minSize={240} maxSize={400} collapsible collapsedSize={0}><Inspector /></Panel>
        </Group>
        {toast && <div className="proto-toast va-toast">{toast}</div>}
      </div>
    </Tooltip.Provider>
  );
}
