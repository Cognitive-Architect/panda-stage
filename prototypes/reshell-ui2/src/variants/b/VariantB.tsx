// Variant B · 工业专业派 (Animate / After Effects / Resolve). dockview-react docking + Blueprint dense controls.
// Visual rules (dense neutral greys, single orange accent, flat panels) referenced from Flare's egui theme.rs (BSD-3),
// parent pick-whip + depth slider interaction referenced from AniCraft parenting.rs / layer_depth.rs. No Rust code ported.
import { useCallback, useRef, useState } from 'react';
import { DockviewReact, type DockviewApi, type DockviewReadyEvent, type IDockviewPanelProps } from 'dockview-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Button, ButtonGroup, Classes, Dialog, DialogBody, DialogFooter, HTMLSelect, ProgressBar, SegmentedControl, Slider, Tag, Tab, Tabs, Checkbox } from '@blueprintjs/core';
import '@blueprintjs/core/lib/css/blueprint.css';
import { Camera, ChevronDown, ChevronRight, Diamond, Download, Eye, EyeOff, Lock, Unlock, Music, Pause, Play, Plus, Redo2, SkipBack, SkipForward, StepBack, StepForward, Undo2, Link2, Trash2 } from 'lucide-react';
import { ASSETS, CATEGORIES, assetUrl, type AssetCategory } from '../../core/assets';
import { easeLabel, fmtTime, sampleTransform, FPS } from '../../core/model';
import { Stage } from '../../core/Stage';
import { TimelineBody, layerClipItems, layerKeyItems, type TRow } from '../../core/Timeline';
import { actions, currentLayer, currentShot, getState, setState, useStore } from '../../core/store';
import { NumberField } from '../../donors/NumberField';
import { EasingEditor } from '../../donors/EasingEditor';
import { defaultExport, useExportSim, type ExportOpts } from '../../core/exportSim';
import './b.css';

const LAYOUT_KEY = 'reshell-proto-b-layout';
const PANELS: { id: string; title: string }[] = [
  { id: 'assets', title: '资源库' }, { id: 'layers', title: '图层' }, { id: 'shots', title: '镜头' },
  { id: 'stage', title: '舞台' }, { id: 'props', title: '属性' }, { id: 'curve', title: '缓动曲线' }, { id: 'timeline', title: '时间轴' },
];

function defaultLayout(api: DockviewApi) {
  api.clear();
  api.addPanel({ id: 'stage', component: 'stage', title: '舞台' });
  api.addPanel({ id: 'assets', component: 'assets', title: '资源库', position: { referencePanel: 'stage', direction: 'left' }, initialWidth: 280 });
  api.addPanel({ id: 'shots', component: 'shots', title: '镜头', position: { referencePanel: 'assets', direction: 'within' } });
  api.addPanel({ id: 'props', component: 'props', title: '属性', position: { referencePanel: 'stage', direction: 'right' }, initialWidth: 295 });
  api.addPanel({ id: 'curve', component: 'curve', title: '缓动曲线', position: { referencePanel: 'props', direction: 'below' } });
  api.addPanel({ id: 'timeline', component: 'timeline', title: '时间轴', position: { direction: 'below' }, initialHeight: 265 });
  api.addPanel({ id: 'layers', component: 'layers', title: '图层', position: { referencePanel: 'assets', direction: 'below' } });
  api.getPanel('assets')?.api.setActive();
}

/* ---------------- panels ---------------- */
function AssetsPanel(_: IDockviewPanelProps) {
  const [cat, setCat] = useState<AssetCategory>('角色');
  const [picked, setPicked] = useState<string | null>(null);
  const list = ASSETS.filter((a) => a.category === cat);
  return (
    <div className="vb-pane vb-assets">
      <Tabs id="vb-cat" selectedTabId={cat} onChange={(t) => setCat(t as AssetCategory)} className="vb-cat-tabs">
        {CATEGORIES.map((c) => <Tab key={c} id={c} title={`${c} ${ASSETS.filter((a) => a.category === c).length}`} />)}
      </Tabs>
      <div className="vb-asset-list">
        {list.map((a) => (
          <div key={a.id} className={`vb-asset ${picked === a.id ? 'on' : ''}`} draggable onDragStart={(e) => e.dataTransfer.setData('text/asset', a.id)} onClick={() => setPicked(a.id)} onDoubleClick={() => actions.placeAsset(a.id)}>
            <div className="vb-asset-thumb">{a.svg ? <img src={assetUrl(a)} alt="" /> : <Music size={14} />}</div>
            <span className="vb-asset-name">{a.name}</span>
            <span className="vb-asset-meta">{a.duration ? fmtTime(a.duration) : `${a.w}×${a.h}`}</span>
          </div>
        ))}
      </div>
      <div className="vb-pane-foot">
        <Button small disabled={!picked} icon={<Plus size={12} />} text="放入当前镜头" onClick={() => picked && actions.placeAsset(picked)} />
      </div>
    </div>
  );
}

function LayersPanel(_: IDockviewPanelProps) {
  const shot = useStore(currentShot);
  const layerId = useStore((s) => s.layerId);
  return (
    <div className="vb-pane vb-layers">
      <table className="vb-table">
        <thead><tr><th style={{ width: 20 }}><Eye size={11} /></th><th style={{ width: 20 }}><Lock size={11} /></th><th style={{ width: 20 }}>#</th><th>图层名称</th><th style={{ width: 66 }}>父级</th><th style={{ width: 32 }}>景深</th></tr></thead>
        <tbody>
          {shot.layers.map((l, i) => (
            <tr key={l.id} className={l.id === layerId ? 'on' : ''} onClick={() => actions.selectLayer(l.id)}
              draggable onDragStart={(e) => e.dataTransfer.setData('text/layer', l.id)} onDragOver={(e) => e.dataTransfer.types.includes('text/layer') && e.preventDefault()}
              onDrop={(e) => { const id = e.dataTransfer.getData('text/layer'); if (id && id !== l.id) actions.moveLayerTo(id, i); }}>
              <td><button className="vb-cell-btn" onClick={(e) => { e.stopPropagation(); actions.toggleVisible(l.id); }}>{l.visible ? <Eye size={11} /> : <EyeOff size={11} className="off" />}</button></td>
              <td><button className="vb-cell-btn" onClick={(e) => { e.stopPropagation(); actions.toggleLocked(l.id); }}>{l.locked ? <Lock size={11} className="warn" /> : <Unlock size={11} className="off" />}</button></td>
              <td className="num">{i + 1}</td>
              <td><span className={`vb-swatch k-${l.kind}`} />{l.name}</td>
              <td><select className="vb-mini-select" value={l.parentId ?? ''} onClick={(e) => e.stopPropagation()} onChange={(e) => actions.setParent(l.id, e.target.value || null)}><option value="">无</option>{shot.layers.filter((x) => x.id !== l.id && x.kind !== 'background').map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></td>
              <td className="num">{l.depth}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="vb-pane-foot">
        <ButtonGroup>
          <Button small disabled={!layerId} icon={<ChevronDown size={12} style={{ transform: 'rotate(180deg)' }} />} title="上移" onClick={() => layerId && actions.reorder(layerId, -1)} />
          <Button small disabled={!layerId} icon={<ChevronDown size={12} />} title="下移" onClick={() => layerId && actions.reorder(layerId, 1)} />
          <Button small disabled={!layerId} icon={<Trash2 size={12} />} title="删除图层" onClick={() => layerId && actions.removeLayer(layerId)} />
        </ButtonGroup>
        <span className="vb-dim">{shot.layers.length} 个图层</span>
      </div>
    </div>
  );
}

function ShotsPanel(_: IDockviewPanelProps) {
  const project = useStore((s) => s.project);
  const shotId = useStore((s) => s.shotId);
  return (
    <div className="vb-pane">
      <table className="vb-table">
        <thead><tr><th style={{ width: 28 }}>#</th><th>镜头</th><th style={{ width: 64 }}>时长</th><th style={{ width: 40 }}>图层</th></tr></thead>
        <tbody>{project.shots.map((s, i) => (
          <tr key={s.id} className={s.id === shotId ? 'on' : ''} onClick={() => actions.setShot(s.id)}><td className="num">{i + 1}</td><td>{s.name}</td><td className="num">{fmtTime(s.duration)}</td><td className="num">{s.layers.length}</td></tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function StagePanel(_: IDockviewPanelProps) {
  const zoom = useStore((s) => s.viewZoom);
  const [safe, setSafe] = useState(true);
  return (
    <div className="vb-stage">
      <div className="vb-stage-bar">
        <span className="vb-dim">1280×720 · {FPS}fps</span>
        <span className="vb-flex" />
        <Checkbox className="vb-check" checked={safe} label="安全框" onChange={() => setSafe(!safe)} />
        <HTMLSelect minimal className="vb-zoom-select" value={String(Math.round(zoom * 100))} onChange={(e) => actions.setViewZoom(Number(e.target.value) / 100)}
          options={[...new Set([25, 50, 75, 100, 150, 200, Math.round(zoom * 100)])].sort((a, b) => a - b).map((z) => ({ value: String(z), label: `${z}%` }))} />
      </div>
      <div className="vb-stage-body"><Stage theme={{ backdrop: '#202020', frameStroke: '#555', accent: '#ff8a00', safe }} /></div>
    </div>
  );
}

function PropsPanel(_: IDockviewPanelProps) {
  const l = useStore(currentLayer);
  const time = useStore((s) => s.time);
  const sel = useStore((s) => s.sel);
  const shot = useStore(currentShot);
  const [open, setOpen] = useState({ tr: true, hier: true, act: true });
  if (sel?.kind === 'cam') {
    const k = shot.camera.find((c) => c.id === sel.id);
    if (k) return (
      <div className="vb-pane vb-props">
        <div className="vb-sec-h"><Camera size={12} /> 相机关键帧 @ {k.t}</div>
        <div className="vb-prop"><label>位置 X</label><NumberField label="" value={k.x} onChange={(v, g) => actions.setCamKey(k.id, { x: v }, g)} /></div>
        <div className="vb-prop"><label>位置 Y</label><NumberField label="" value={k.y} onChange={(v, g) => actions.setCamKey(k.id, { y: v }, g)} /></div>
        <div className="vb-prop"><label>缩放</label><NumberField label="" step={0.01} value={k.zoom} onChange={(v, g) => actions.setCamKey(k.id, { zoom: v }, g)} /></div>
      </div>
    );
  }
  if (!l) return <div className="vb-pane vb-empty">无选择</div>;
  const t = Math.round(time);
  const v = sampleTransform({ ...l, clips: [] }, t);
  const keyed = l.keys.some((k) => k.t === t);
  const set = (p: Partial<typeof v>, g: string) => actions.setProps(l.id, p, g);
  const row = (label: string, f: React.ReactNode) => <div className="vb-prop"><label><Diamond size={9} className={keyed ? 'kon' : l.keys.length ? 'khas' : 'koff'} onClick={() => actions.addKey(l.id)} />{label}</label>{f}</div>;
  const parent = shot.layers.find((x) => x.id === l.parentId);
  return (
    <div className="vb-pane vb-props">
      <div className="vb-props-title"><span className={`vb-swatch k-${l.kind}`} />{l.name}<Tag minimal className="vb-tag">{l.kind === 'character' ? '角色' : l.kind === 'prop' ? '道具' : '背景'}</Tag></div>
      <div className="vb-sec-h" onClick={() => setOpen({ ...open, tr: !open.tr })}>{open.tr ? <ChevronDown size={12} /> : <ChevronRight size={12} />}变换</div>
      {open.tr && <>
        {row('位置', <div className="vb-two"><NumberField label="X" value={v.x} disabled={l.locked} onChange={(x, g) => set({ x }, g)} /><NumberField label="Y" value={v.y} disabled={l.locked} onChange={(y, g) => set({ y }, g)} /></div>)}
        {row('缩放', <NumberField label="%" step={1} value={Math.round(v.scale * 100)} disabled={l.locked} onChange={(s, g) => set({ scale: s / 100 }, g)} />)}
        {row('旋转', <NumberField label="°" value={v.rotation} disabled={l.locked} onChange={(r, g) => set({ rotation: r }, g)} />)}
        {row('不透明度', <NumberField label="%" value={Math.round(v.opacity * 100)} min={0} max={100} disabled={l.locked} onChange={(o, g) => set({ opacity: o / 100 }, g)} />)}
      </>}
      <div className="vb-sec-h" onClick={() => setOpen({ ...open, hier: !open.hier })}>{open.hier ? <ChevronDown size={12} /> : <ChevronRight size={12} />}父链与景深</div>
      {open.hier && <>
        <div className="vb-prop"><label><Link2 size={10} />父级</label>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <Button small fill alignText="left" rightIcon={<ChevronDown size={11} />} text={parent ? parent.name : '无'} />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="vb-dd" sideOffset={4} align="start">
                <DropdownMenu.Item className={`vb-dd-item ${!l.parentId ? 'on' : ''}`} onSelect={() => actions.setParent(l.id, null)}>无父级</DropdownMenu.Item>
                {shot.layers.filter((x) => x.id !== l.id && x.kind !== 'background').map((x) => (
                  <DropdownMenu.Item key={x.id} className={`vb-dd-item ${x.id === l.parentId ? 'on' : ''}`} onSelect={() => actions.setParent(l.id, x.id)}>{x.name}</DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
        <div className="vb-prop"><label>景深</label><div className="vb-depth"><Slider min={-5} max={10} stepSize={1} labelRenderer={false} value={l.depth} onChange={(d) => actions.setDepth(l.id, d, 'depth:' + l.id)} onRelease={() => setState({ lastKey: '' })} /><span className="num">{l.depth}</span></div></div>
      </>}
      <div className="vb-sec-h" onClick={() => setOpen({ ...open, act: !open.act })}>{open.act ? <ChevronDown size={12} /> : <ChevronRight size={12} />}动作片段</div>
      {open.act && <div className="vb-actions">
        {l.clips.map((c) => <Tag key={c.id} interactive minimal={!(sel?.kind === 'clip' && sel.id === c.id)} intent="warning" onClick={() => actions.select({ kind: 'clip', layerId: l.id, id: c.id })}>{c.name} {c.start}–{c.start + c.len}</Tag>)}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild><Button small minimal icon={<Plus size={11} />} text="动作" /></DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="vb-dd" sideOffset={4} align="start">
              {([['walk', '走路'], ['wave', '挥手'], ['bounce', '弹跳'], ['sway', '摇摆']] as const).map(([m, n]) => (
                <DropdownMenu.Item key={m} className="vb-dd-item" onSelect={() => actions.addAction(l.id, m)}>{n}</DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>}
    </div>
  );
}

function CurvePanel(_: IDockviewPanelProps) {
  const sel = useStore((s) => s.sel);
  const shot = useStore(currentShot);
  let easing = null; let label = '';
  if (sel?.kind === 'key') { const k = shot.layers.find((l) => l.id === sel.layerId)?.keys.find((x) => x.id === sel.id); if (k) { easing = k.easing; label = `关键帧 @ ${k.t} · ${easeLabel(k.easing)}`; } }
  if (sel?.kind === 'cam') { const k = shot.camera.find((x) => x.id === sel.id); if (k) { easing = k.easing; label = `相机 @ ${k.t} · ${easeLabel(k.easing)}`; } }
  return (
    <div className="vb-pane vb-curve">
      {easing ? <><div className="vb-dim">{label}</div><EasingEditor compact value={easing} onChange={(b, g) => actions.setEasing(sel, b, g)} /></> : <div className="vb-empty">在时间轴选择关键帧</div>}
    </div>
  );
}

function TimelinePanel(_: IDockviewPanelProps) {
  const shot = useStore(currentShot);
  const layerId = useStore((s) => s.layerId);
  const ppf = useStore((s) => s.pxPerFrame);
  const [exp, setExp] = useState<Record<string, boolean>>({});
  const rows: TRow[] = [];
  shot.layers.forEach((l, i) => {
    const e = exp[l.id];
    rows.push({
      id: l.id, height: 22, active: l.id === layerId, onHeaderClick: () => actions.selectLayer(l.id), className: l.visible ? '' : 'dim',
      header: (
        <div className="vb-tl-head">
          <button className="vb-cell-btn" onClick={(ev) => { ev.stopPropagation(); setExp({ ...exp, [l.id]: !e }); }}>{e ? <ChevronDown size={11} /> : <ChevronRight size={11} />}</button>
          <button className="vb-cell-btn" onClick={(ev) => { ev.stopPropagation(); actions.toggleVisible(l.id); }}>{l.visible ? <Eye size={11} /> : <EyeOff size={11} className="off" />}</button>
          <button className="vb-cell-btn" onClick={(ev) => { ev.stopPropagation(); actions.toggleLocked(l.id); }}>{l.locked ? <Lock size={11} className="warn" /> : <Unlock size={11} className="off" />}</button>
          <span className="num">{i + 1}</span><span className={`vb-swatch k-${l.kind}`} /><span className="vb-tl-name">{l.name}</span>
          {l.parentId && <Link2 size={10} className="vb-dim" />}
        </div>
      ),
      items: e ? [] : [...layerClipItems(l, '#7a5a1e'), ...layerKeyItems(l)],
    });
    if (e) {
      rows.push({ id: l.id + ':clips', height: 20, className: 'sub', header: <div className="vb-tl-sub">动作</div>, items: layerClipItems(l, '#7a5a1e') });
      rows.push({ id: l.id + ':keys', height: 20, className: 'sub', header: <div className="vb-tl-sub">变换 <span className="vb-dim">位置·缩放·旋转·不透明度</span></div>, items: layerKeyItems(l) });
    }
  });
  rows.push({ id: 'cam', height: 22, className: 'cam', header: <div className="vb-tl-head"><Camera size={11} /><span className="vb-tl-name">相机</span><button className="vb-cell-btn" title="添加相机关键帧" onClick={actions.addCameraKey}><Plus size={11} /></button></div>, items: shot.camera.map((k) => ({ sel: { kind: 'cam', id: k.id }, start: k.t, shape: 'cam' })) });
  shot.audio.forEach((a) => rows.push({ id: a.id, height: 30, className: 'audio', header: <div className="vb-tl-head"><Music size={11} /><span className="vb-tl-name">{a.name}</span></div>, items: [{ sel: { kind: 'audio', id: a.id }, start: a.start, len: a.len, shape: 'audio', label: a.name, seed: a.assetId }] }));
  return (
    <div className="vb-timeline">
      <div className="vb-tl-tools">
        <Button small minimal icon={<Diamond size={11} />} text="关键帧" disabled={!layerId} onClick={() => layerId && actions.addKey(layerId)} />
        <Button small minimal icon={<Trash2 size={11} />} onClick={actions.deleteSelection} title="删除所选" />
        <span className="vb-flex" />
        <span className="vb-dim">缩放</span>
        <div className="vb-tl-zoom"><Slider min={1.5} max={30} stepSize={0.5} labelRenderer={false} value={ppf} onChange={actions.setTimelineZoom} /></div>
      </div>
      <TimelineBody rows={rows} headerWidth={230} rulerHeight={20} className="vb-tl" />
    </div>
  );
}

const components = { assets: AssetsPanel, layers: LayersPanel, shots: ShotsPanel, stage: StagePanel, props: PropsPanel, curve: CurvePanel, timeline: TimelinePanel };

/* ---------------- chrome ---------------- */
function ExportDialogB({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [o, setO] = useState<ExportOpts>(defaultExport);
  const sim = useExportSim();
  const shots = useStore((s) => s.project.shots.length);
  return (
    <Dialog isOpen={open} onClose={() => { sim.cancel(); onClose(); }} title="渲染队列 · 导出" className={`${Classes.DARK} vb-dialog`}>
      <DialogBody>
        <div className="vb-form">
          <label>格式</label><SegmentedControl small value={o.format} onValueChange={(f) => setO({ ...o, format: f as ExportOpts['format'] })} options={[{ value: 'mp4', label: 'H.264 MP4' }, { value: 'gif', label: 'GIF' }, { value: 'png', label: 'PNG 序列' }]} />
          <label>分辨率</label><HTMLSelect value={o.res} onChange={(e) => setO({ ...o, res: e.target.value as ExportOpts['res'] })} options={[{ value: '720p', label: '1280×720' }, { value: '1080p', label: '1920×1080' }, { value: '4k', label: '3840×2160' }]} />
          <label>帧率</label><HTMLSelect value={String(o.fps)} onChange={(e) => setO({ ...o, fps: Number(e.target.value) as ExportOpts['fps'] })} options={['24', '30', '60']} />
          <label>范围</label><HTMLSelect value={o.range} onChange={(e) => setO({ ...o, range: e.target.value as ExportOpts['range'] })} options={[{ value: 'all', label: `全部镜头 (${shots})` }, { value: 'shot', label: '当前镜头' }]} />
          <label>质量</label><Slider min={10} max={100} stepSize={5} labelStepSize={30} value={o.quality} onChange={(q) => setO({ ...o, quality: q })} />
        </div>
        {sim.phase !== 'idle' && <div className="vb-render"><ProgressBar intent={sim.phase === 'done' ? 'success' : 'warning'} value={sim.progress / 100} animate={sim.phase === 'running'} stripes={sim.phase === 'running'} /><span>{sim.phase === 'done' ? '模拟渲染完成' : `模拟渲染 帧 ${Math.round((sim.progress / 100) * 216)}/216`}</span></div>}
      </DialogBody>
      <DialogFooter actions={<><Button text="关闭" onClick={() => { sim.cancel(); onClose(); }} /><Button intent="warning" icon={<Download size={12} />} text={sim.phase === 'done' ? '再次渲染' : '加入队列并渲染'} disabled={sim.phase === 'running'} onClick={sim.start} /></>} />
    </Dialog>
  );
}

export default function VariantB() {
  const api = useRef<DockviewApi | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [exportOpen, setExportOpen] = useState(false);
  const shot = useStore(currentShot);
  const project = useStore((s) => s.project);
  const time = useStore((s) => s.time);
  const playing = useStore((s) => s.playing);
  const layer = useStore(currentLayer);
  const past = useStore((s) => s.past.length);
  const fut = useStore((s) => s.future.length);
  const toast = useStore((s) => s.toast);

  const sync = useCallback(() => { const a = api.current; if (!a) return; setOpen(Object.fromEntries(PANELS.map((p) => [p.id, !!a.getPanel(p.id)]))); }, []);
  const onReady = (e: DockviewReadyEvent) => {
    api.current = e.api;
    let ok = false;
    try { const s = localStorage.getItem(LAYOUT_KEY); if (s) { e.api.fromJSON(JSON.parse(s)); ok = true; } } catch { ok = false; }
    if (!ok) defaultLayout(e.api);
    e.api.onDidLayoutChange(() => { try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(e.api.toJSON())); } catch { /* ignore */ } sync(); });
    sync();
  };
  const togglePanel = (id: string) => {
    const a = api.current; if (!a) return;
    const p = a.getPanel(id);
    if (p) p.api.close();
    else { const def = PANELS.find((x) => x.id === id)!; a.addPanel({ id, component: id, title: def.title, floating: { width: 320, height: 260 } }); }
    sync();
  };
  const resetLayout = () => { if (api.current) { defaultLayout(api.current); sync(); actions.toast('布局已重置'); } };

  const menus: Record<string, React.ReactNode> = {
    文件: <>
      <DropdownMenu.Item className="vb-dd-item" onSelect={() => setExportOpen(true)}><span>导出…</span><em>Ctrl+M</em></DropdownMenu.Item>
      <DropdownMenu.Separator className="vb-dd-sep" />
      <DropdownMenu.Item className="vb-dd-item" onSelect={() => actions.reset()}><span>重置示例</span></DropdownMenu.Item>
    </>,
    编辑: <>
      <DropdownMenu.Item className="vb-dd-item" disabled={!past} onSelect={actions.undo}><span>撤销</span><em>Ctrl+Z</em></DropdownMenu.Item>
      <DropdownMenu.Item className="vb-dd-item" disabled={!fut} onSelect={actions.redo}><span>重做</span><em>Ctrl+Shift+Z</em></DropdownMenu.Item>
      <DropdownMenu.Separator className="vb-dd-sep" />
      <DropdownMenu.Item className="vb-dd-item" disabled={!layer} onSelect={() => layer && actions.addKey(layer.id)}><span>添加关键帧</span><em>K</em></DropdownMenu.Item>
      <DropdownMenu.Item className="vb-dd-item" onSelect={actions.addCameraKey}><span>添加相机关键帧</span></DropdownMenu.Item>
      <DropdownMenu.Item className="vb-dd-item" onSelect={actions.deleteSelection}><span>删除所选</span><em>Del</em></DropdownMenu.Item>
    </>,
    镜头: <>{project.shots.map((s) => <DropdownMenu.Item key={s.id} className={`vb-dd-item ${s.id === shot.id ? 'on' : ''}`} onSelect={() => actions.setShot(s.id)}><span>{s.name}</span></DropdownMenu.Item>)}</>,
    视图: <>
      <DropdownMenu.Item className="vb-dd-item" onSelect={() => actions.setViewZoom(getState().viewZoom * 1.25)}><span>放大</span></DropdownMenu.Item>
      <DropdownMenu.Item className="vb-dd-item" onSelect={() => actions.setViewZoom(getState().viewZoom / 1.25)}><span>缩小</span></DropdownMenu.Item>
      <DropdownMenu.Item className="vb-dd-item" onSelect={() => actions.setViewZoom(1)}><span>适合窗口</span></DropdownMenu.Item>
    </>,
    窗口: <>
      {PANELS.map((p) => (
        <DropdownMenu.Item key={p.id} className="vb-dd-item" onSelect={() => togglePanel(p.id)}>
          <span><b className="vb-tick">{open[p.id] ? '✓' : ''}</b>{p.title}</span>
        </DropdownMenu.Item>
      ))}
      <DropdownMenu.Separator className="vb-dd-sep" />
      <DropdownMenu.Item className="vb-dd-item" onSelect={resetLayout}><span>重置工作区布局</span></DropdownMenu.Item>
    </>,
  };

  return (
    <div className={`vb ${Classes.DARK}`}>
      <div className="vb-menubar">
        <span className="vb-brand">Panda Stage</span>
        {Object.entries(menus).map(([k, m]) => (
          <DropdownMenu.Root key={k}>
            <DropdownMenu.Trigger className="vb-menubtn">{k}</DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="vb-dd" sideOffset={2} align="start">{m}</DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        ))}
        <span className="vb-flex" />
        <span className="vb-dim">{project.name}</span>
        <span className="vb-ws">工作区：动画</span>
        <Button small minimal text="重置布局" onClick={resetLayout} />
      </div>
      <div className="vb-toolbar">
        <ButtonGroup>
          <Button small icon={<Undo2 size={13} />} disabled={!past} onClick={actions.undo} title="撤销" />
          <Button small icon={<Redo2 size={13} />} disabled={!fut} onClick={actions.redo} title="重做" />
        </ButtonGroup>
        <HTMLSelect className="vb-shot-select" value={shot.id} onChange={(e) => actions.setShot(e.target.value)} options={project.shots.map((s) => ({ value: s.id, label: s.name }))} />
        <span className="vb-flex" />
        <ButtonGroup className="vb-transport">
          <Button small icon={<SkipBack size={13} />} onClick={() => actions.seek(0)} />
          <Button small icon={<StepBack size={13} />} onClick={() => actions.step(-1)} />
          <Button small intent={playing ? 'warning' : 'none'} icon={playing ? <Pause size={13} /> : <Play size={13} />} onClick={() => actions.play()} />
          <Button small icon={<StepForward size={13} />} onClick={() => actions.step(1)} />
          <Button small icon={<SkipForward size={13} />} onClick={() => actions.seek(shot.duration)} />
        </ButtonGroup>
        <div className="vb-tc">{fmtTime(time)}</div>
        <div className="vb-frame">帧 {Math.round(time)} / {shot.duration}</div>
        <span className="vb-flex" />
        <Button small icon={<Diamond size={12} />} text="K" disabled={!layer} onClick={() => layer && actions.addKey(layer.id)} title="添加关键帧" />
        <Button small intent="warning" icon={<Download size={12} />} text="导出" onClick={() => setExportOpen(true)} />
      </div>
      <div className="vb-dock dockview-theme-abyss">
        <DockviewReact components={components} onReady={onReady} />
      </div>
      <div className="vb-status">
        <span>{layer ? `选中：${layer.name}` : '无选择'}</span><span>|</span><span>{shot.name}</span><span>|</span><span>{FPS} fps</span>
        <span className="vb-flex" /><span>撤销 {past}</span><span>重做 {fut}</span>
      </div>
      <ExportDialogB open={exportOpen} onClose={() => setExportOpen(false)} />
      {toast && <div className="proto-toast vb-toast">{toast}</div>}
    </div>
  );
}
