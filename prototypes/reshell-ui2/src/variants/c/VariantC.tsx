/*
 * Variant C · 现代效率派 (CapCut / OpenCut Classic)
 * Workbench topology adapted from OpenCut Classic apps/web/src/app/editor/[project_id]/page.tsx (MIT)
 * using react-resizable-panels (top 3-column [Media/Workflow | Preview | Properties] + bottom full-width multi-track Timeline),
 * Radix primitives, and OpenCut Classic's NumberField + BezierGraph donors.
 */
import { useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Tabs from '@radix-ui/react-tabs';
import * as Slider from '@radix-ui/react-slider';
import { Group, Panel, Separator, type PanelImperativeHandle } from 'react-resizable-panels';
import {
  ArrowDown, ArrowUp, Box, Camera, Clapperboard, Diamond, Download, Eye, EyeOff,
  Image as ImageIcon, Layers, Lock, Minus, Music, Pause, Play, Plus, Redo2, Repeat, Search,
  SkipBack, SkipForward, Sparkles, Trash2, Undo2, Unlock, User,
} from 'lucide-react';
import { ASSETS, assetUrl, type AssetCategory } from '../../core/assets';
import { easeLabel, fmtTime, sampleTransform, FPS, type Layer } from '../../core/model';
import { Stage } from '../../core/Stage';
import { TimelineBody, layerClipItems, layerKeyItems, type TRow } from '../../core/Timeline';
import { actions, currentLayer, currentShot, setState, useStore } from '../../core/store';
import { OpenCutBezierGraph, OpenCutNumberField } from '../../donors/OpenCutControls';
import { defaultExport, useExportSim, type ExportOpts } from '../../core/exportSim';
import './c.css';

type RailTab = '角色' | '道具' | '背景' | '音频' | '动作' | '图层' | '镜头';

const RAIL: { id: RailTab; label: string; icon: React.ReactNode }[] = [
  { id: '角色', label: '角色', icon: <User size={16} /> },
  { id: '道具', label: '道具', icon: <Box size={16} /> },
  { id: '背景', label: '背景', icon: <ImageIcon size={16} /> },
  { id: '音频', label: '音频', icon: <Music size={16} /> },
  { id: '动作', label: '动作', icon: <Sparkles size={16} /> },
  { id: '图层', label: '图层', icon: <Layers size={16} /> },
  { id: '镜头', label: '镜头', icon: <Clapperboard size={16} /> },
];

const MOTIONS: { id: Layer['clips'][number]['motion']; name: string; tag: string }[] = [
  { id: 'walk', name: '走路循环', tag: '位移起伏' },
  { id: 'wave', name: '招手摆动', tag: '轻快旋转' },
  { id: 'bounce', name: '弹跳节拍', tag: '纵向弹跳' },
  { id: 'sway', name: '微风摇摆', tag: '柔和摆动' },
];

function HeaderC() {
  const project = useStore((s) => s.project);
  const shot = useStore(currentShot);
  const past = useStore((s) => s.past.length);
  const fut = useStore((s) => s.future.length);
  return (
    <header className="vc-header">
      <div className="vc-head-l">
        <span className="vc-mark">PS</span>
        <span className="vc-title">{project.name}</span>
      </div>
      <div className="vc-head-c">
        <div className="vc-shot-strip">
          {project.shots.map((s, idx) => (
            <button key={s.id} className={s.id === shot.id ? 'on' : ''} onClick={() => actions.setShot(s.id)}>
              <b>{idx + 1}</b><span>{s.name.replace(/^镜头\s*\d+\s*·\s*/, '')}</span><em>{Math.round(s.duration / FPS)}s</em>
            </button>
          ))}
        </div>
      </div>
      <div className="vc-head-r">
        <button className="vc-ico" disabled={!past} title="撤销 Ctrl+Z" onClick={actions.undo}><Undo2 size={15} /></button>
        <button className="vc-ico" disabled={!fut} title="重做 Ctrl+Shift+Z" onClick={actions.redo}><Redo2 size={15} /></button>
        <ExportDialogC />
      </div>
    </header>
  );
}

export function ExportDialogC({ open, onOpenChange }: { open?: boolean; onOpenChange?: (open: boolean) => void } = {}) {
  const [o, setO] = useState<ExportOpts>(defaultExport);
  const sim = useExportSim();
  const project = useStore((s) => s.project);
  return (
    <Dialog.Root open={open} onOpenChange={(v) => { if (!v) sim.cancel(); onOpenChange?.(v); }}>
      <Dialog.Trigger className="vc-export-btn"><Download size={14} />导出</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="vc-overlay" />
        <Dialog.Content className="vc-dialog" aria-describedby={undefined}>
          <div className="vc-dialog-top">
            <Dialog.Title>快速导出</Dialog.Title>
            <span className="vc-badge">模拟输出</span>
          </div>
          <div className="vc-field-row">
            <label>输出格式</label>
            <div className="vc-seg">{(['mp4', 'gif', 'png'] as const).map((f) => <button key={f} className={o.format === f ? 'on' : ''} onClick={() => setO({ ...o, format: f })}>{f === 'png' ? 'PNG 序列' : f.toUpperCase()}</button>)}</div>
          </div>
          <div className="vc-field-row">
            <label>画质规格</label>
            <div className="vc-seg">{(['720p', '1080p', '4k'] as const).map((f) => <button key={f} className={o.res === f ? 'on' : ''} onClick={() => setO({ ...o, res: f })}>{f.toUpperCase()}</button>)}</div>
          </div>
          <div className="vc-field-row">
            <label>帧率</label>
            <div className="vc-seg">{([24, 30, 60] as const).map((f) => <button key={f} className={o.fps === f ? 'on' : ''} onClick={() => setO({ ...o, fps: f })}>{f} fps</button>)}</div>
          </div>
          <div className="vc-field-row">
            <label>导出范围</label>
            <div className="vc-seg">
              <button className={o.range === 'all' ? 'on' : ''} onClick={() => setO({ ...o, range: 'all' })}>全片 ({project.shots.length} 镜头)</button>
              <button className={o.range === 'shot' ? 'on' : ''} onClick={() => setO({ ...o, range: 'shot' })}>仅当前镜头</button>
            </div>
          </div>
          <div className="vc-field-row">
            <label>码率质量</label>
            <Slider.Root className="vc-slider" min={10} max={100} value={[o.quality]} onValueChange={([q]) => setO({ ...o, quality: q })}>
              <Slider.Track className="vc-slider-track"><Slider.Range className="vc-slider-range" /></Slider.Track>
              <Slider.Thumb className="vc-slider-thumb" aria-label="码率质量" />
            </Slider.Root>
            <span className="vc-q">{o.quality}%</span>
          </div>
          {sim.phase !== 'idle' && (
            <div className="vc-prog">
              <div className="vc-prog-fill" style={{ width: `${sim.progress}%` }} />
              <span>{sim.phase === 'done' ? '模拟导出完成' : `正在模拟合成 ${sim.progress}%`}</span>
            </div>
          )}
          <div className="vc-dialog-foot">
            <Dialog.Close className="vc-btn-ghost">关闭</Dialog.Close>
            <button className="vc-export-btn" disabled={sim.phase === 'running'} onClick={sim.start}>{sim.phase === 'done' ? '重新模拟导出' : '开始导出'}</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function MediaPanel() {
  const [tab, setTab] = useState<RailTab>('角色');
  const [q, setQ] = useState('');
  const [previewId, setPreviewId] = useState<string>('panda');
  const shot = useStore(currentShot);
  const project = useStore((s) => s.project);
  const layer = useStore(currentLayer);

  const isCat = tab === '角色' || tab === '道具' || tab === '背景' || tab === '音频';
  const list = isCat
    ? ASSETS.filter((a) => a.category === (tab as AssetCategory) && (!q || a.name.includes(q) || a.tags.some((t) => t.includes(q))))
    : [];
  const preview = ASSETS.find((a) => a.id === previewId);

  return (
    <div className="vc-card vc-media-wrap">
      <nav className="vc-rail">
        {RAIL.map((item) => (
          <button key={item.id} className={tab === item.id ? 'on' : ''} onClick={() => setTab(item.id)}>
            {item.icon}<span>{item.label}</span>
          </button>
        ))}
      </nav>
      <div className="vc-browser">
        <div className="vc-pane-head">
          <span>{tab}</span>
          {isCat && (
            <div className="vc-search">
              <Search size={12} />
              <input placeholder="筛选…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          )}
        </div>

        {isCat && (
          <>
            <div className="vc-grid">
              {list.map((a) => (
                <div
                  key={a.id}
                  className={`vc-tile ${previewId === a.id ? 'on' : ''}`}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('text/asset', a.id)}
                  onClick={() => setPreviewId(a.id)}
                  onDoubleClick={() => actions.placeAsset(a.id)}
                >
                  <div className="vc-tile-thumb">
                    {a.svg ? <img src={assetUrl(a)} alt="" /> : <Music size={22} />}
                    <button className="vc-tile-add" title="放入当前镜头" onClick={(e) => { e.stopPropagation(); actions.placeAsset(a.id); }}>
                      <Plus size={13} />
                    </button>
                  </div>
                  <div className="vc-tile-name">{a.name}</div>
                </div>
              ))}
            </div>
            {preview && (
              <div className="vc-preview-strip">
                <div className="vc-preview-thumb">{preview.svg ? <img src={assetUrl(preview)} alt="" /> : <Music size={16} />}</div>
                <div className="vc-preview-meta">
                  <b>{preview.name}</b>
                  <span>{preview.category} · {preview.duration ? fmtTime(preview.duration) : `${preview.w}×${preview.h}`}</span>
                </div>
                <button className="vc-add-cta" onClick={() => actions.placeAsset(preview.id)}><Plus size={13} />放入</button>
              </div>
            )}
          </>
        )}

        {tab === '动作' && (
          <div className="vc-motion-list">
            <div className="vc-target-bar">{layer ? `应用目标：${layer.name}` : '请先在画布或轨道选中角色/道具'}</div>
            {MOTIONS.map((m) => (
              <button key={m.id} className="vc-motion-card" disabled={!layer} onClick={() => layer && actions.addAction(layer.id, m.id)}>
                <Sparkles size={15} />
                <div><b>{m.name}</b><span>{m.tag}</span></div>
                <Plus size={14} />
              </button>
            ))}
          </div>
        )}

        {tab === '图层' && (
          <div className="vc-layer-list">
            {shot.layers.map((l, i) => (
              <div
                key={l.id}
                className={`vc-layer-row ${layer?.id === l.id ? 'on' : ''} ${!l.visible ? 'dim' : ''}`}
                draggable
                onDragStart={(e) => e.dataTransfer.setData('text/layer', l.id)}
                onDragOver={(e) => e.dataTransfer.types.includes('text/layer') && e.preventDefault()}
                onDrop={(e) => { const id = e.dataTransfer.getData('text/layer'); if (id && id !== l.id) actions.moveLayerTo(id, i); }}
                onClick={() => actions.selectLayer(l.id)}
              >
                <span className={`vc-dot k-${l.kind}`} />
                <span className="vc-lname">{l.name}</span>
                <button className="vc-lbtn-hover" title="上移" onClick={(e) => { e.stopPropagation(); actions.reorder(l.id, -1); }}><ArrowUp size={12} /></button>
                <button className="vc-lbtn-hover" title="下移" onClick={(e) => { e.stopPropagation(); actions.reorder(l.id, 1); }}><ArrowDown size={12} /></button>
                <button className={l.locked ? 'stay' : ''} title="锁定" onClick={(e) => { e.stopPropagation(); actions.toggleLocked(l.id); }}>{l.locked ? <Lock size={12} /> : <Unlock size={12} />}</button>
                <button className={!l.visible ? 'stay' : ''} title="显隐" onClick={(e) => { e.stopPropagation(); actions.toggleVisible(l.id); }}>{l.visible ? <Eye size={12} /> : <EyeOff size={12} />}</button>
              </div>
            ))}
          </div>
        )}

        {tab === '镜头' && (
          <div className="vc-shot-cards">
            {project.shots.map((s, idx) => (
              <button key={s.id} className={`vc-shot-card ${s.id === shot.id ? 'on' : ''}`} onClick={() => actions.setShot(s.id)}>
                <div className="vc-shot-num">#{idx + 1}</div>
                <div className="vc-shot-info">
                  <b>{s.name}</b>
                  <span>{fmtTime(s.duration)} · {s.layers.length} 图层 · {s.audio.length} 音轨</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PreviewCard() {
  const shot = useStore(currentShot);
  const time = useStore((s) => s.time);
  const playing = useStore((s) => s.playing);
  const loop = useStore((s) => s.loop);
  const zoom = useStore((s) => s.viewZoom);
  return (
    <div className="vc-card vc-preview-card">
      <div className="vc-stage-wrap">
        <Stage theme={{ backdrop: '#09090b', frameStroke: 'rgba(255,255,255,.14)', accent: '#22b8ff' }} />
      </div>
      <div className="vc-transport">
        <div className="vc-tc"><b>{fmtTime(time)}</b><span>/ {fmtTime(shot.duration)}</span></div>
        <div className="vc-play-group">
          <button className="vc-ico" title="回到开头" onClick={() => actions.seek(0)}><SkipBack size={14} /></button>
          <button className="vc-play-btn" onClick={() => actions.play()}>{playing ? <Pause size={15} /> : <Play size={15} />}</button>
          <button className="vc-ico" title="跳到结尾" onClick={() => actions.seek(shot.duration)}><SkipForward size={14} /></button>
          <button className={`vc-ico ${loop ? 'active' : ''}`} title="循环播放" onClick={() => setState({ loop: !loop })}><Repeat size={13} /></button>
        </div>
        <div className="vc-zoom-bar">
          <button onClick={() => actions.setViewZoom(zoom / 1.15)}><Minus size={12} /></button>
          <button className="vc-zoom-val" onClick={() => actions.setViewZoom(1)}>{Math.round(zoom * 100)}%</button>
          <button onClick={() => actions.setViewZoom(zoom * 1.15)}><Plus size={12} /></button>
        </div>
      </div>
    </div>
  );
}

function PropertiesCard() {
  const l = useStore(currentLayer);
  const shot = useStore(currentShot);
  const time = useStore((s) => s.time);
  const sel = useStore((s) => s.sel);

  if (sel?.kind === 'cam') {
    const k = shot.camera.find((c) => c.id === sel.id);
    if (k) {
      return (
        <div className="vc-card vc-props">
          <div className="vc-pane-head"><span><Camera size={13} /> 相机关键帧 · {k.t}f</span></div>
          <div className="vc-prop-body">
            <div className="vc-grid2">
              <OpenCutNumberField icon="X" value={k.x} defaultValue={0} onChange={(x, g) => actions.setCamKey(k.id, { x }, g)} />
              <OpenCutNumberField icon="Y" value={k.y} defaultValue={0} onChange={(y, g) => actions.setCamKey(k.id, { y }, g)} />
            </div>
            <OpenCutNumberField icon="缩放" step={0.05} min={0.2} max={4} value={k.zoom} defaultValue={1} onChange={(z, g) => actions.setCamKey(k.id, { zoom: z }, g)} />
            <div className="vc-sec-title">缓动曲线</div>
            <OpenCutBezierGraph value={k.easing} onChange={(b, g) => actions.setEasing(sel, b, g)} />
          </div>
        </div>
      );
    }
  }

  if (!l) {
    return (
      <div className="vc-card vc-props">
        <div className="vc-pane-head"><span>属性</span></div>
        <div className="vc-empty">选中角色、道具或关键帧</div>
      </div>
    );
  }

  const t = Math.round(time);
  const v = sampleTransform({ ...l, clips: [] }, t);
  const keyHere = l.keys.find((k) => k.t === t);
  const selKey = sel?.kind === 'key' && sel.layerId === l.id ? l.keys.find((k) => k.id === sel.id) : keyHere;
  const set = (patch: Partial<typeof v>, g: string) => actions.setProps(l.id, patch, g);

  return (
    <div className="vc-card vc-props">
      <div className="vc-pane-head">
        <span className="vc-prop-name"><i className={`vc-dot k-${l.kind}`} />{l.name}</span>
        <button className={`vc-key-btn ${keyHere ? 'on' : ''}`} onClick={() => actions.addKey(l.id)}>
          <Diamond size={11} />{keyHere ? `${t}f` : '打帧'}
        </button>
      </div>
      <Tabs.Root className="vc-ptabs" defaultValue="transform">
        <Tabs.List className="vc-ptab-list">
          <Tabs.Trigger value="transform">变换</Tabs.Trigger>
          <Tabs.Trigger value="curve">缓动</Tabs.Trigger>
          <Tabs.Trigger value="layer">层级</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="transform" className="vc-prop-body">
          <div className="vc-sec-title">位置</div>
          <div className="vc-grid2">
            <OpenCutNumberField icon="X" value={Math.round(v.x)} defaultValue={640} disabled={l.locked} onChange={(x, g) => set({ x }, g)} />
            <OpenCutNumberField icon="Y" value={Math.round(v.y)} defaultValue={400} disabled={l.locked} onChange={(y, g) => set({ y }, g)} />
          </div>
          <div className="vc-sec-title">缩放与旋转</div>
          <div className="vc-grid2">
            <OpenCutNumberField icon="缩放" suffix="%" step={1} min={5} max={400} value={Math.round(v.scale * 100)} defaultValue={100} disabled={l.locked} onChange={(s, g) => set({ scale: s / 100 }, g)} />
            <OpenCutNumberField icon="角度" suffix="°" step={1} value={Math.round(v.rotation)} defaultValue={0} disabled={l.locked} onChange={(r, g) => set({ rotation: r }, g)} />
          </div>
          <div className="vc-sec-title">不透明度</div>
          <div className="vc-opacity-row">
            <Slider.Root className="vc-slider" min={0} max={100} disabled={l.locked} value={[Math.round(v.opacity * 100)]} onValueChange={([o]) => set({ opacity: o / 100 }, `oc-op:${l.id}`)}>
              <Slider.Track className="vc-slider-track"><Slider.Range className="vc-slider-range" /></Slider.Track>
              <Slider.Thumb className="vc-slider-thumb" />
            </Slider.Root>
            <OpenCutNumberField suffix="%" min={0} max={100} value={Math.round(v.opacity * 100)} defaultValue={100} disabled={l.locked} onChange={(o, g) => set({ opacity: o / 100 }, g)} />
          </div>
          <div className="vc-sec-title">快捷动作</div>
          <div className="vc-quick-acts">
            {MOTIONS.map((m) => (
              <button key={m.id} onClick={() => actions.addAction(l.id, m.id)}><Plus size={11} />{m.name.slice(0, 2)}</button>
            ))}
          </div>
        </Tabs.Content>

        <Tabs.Content value="curve" className="vc-prop-body">
          {selKey ? (
            <>
              <div className="vc-sec-title">第 {selKey.t} 帧 · {easeLabel(selKey.easing)}</div>
              <OpenCutBezierGraph value={selKey.easing} onChange={(b, g) => actions.setEasing({ kind: 'key', layerId: l.id, id: selKey.id }, b, g)} />
            </>
          ) : (
            <div className="vc-empty-col">
              <span>当前帧无关键帧</span>
              <button className="vc-add-cta" onClick={() => actions.addKey(l.id)}><Diamond size={12} />在 {t}f 添加关键帧</button>
            </div>
          )}
        </Tabs.Content>

        <Tabs.Content value="layer" className="vc-prop-body">
          <div className="vc-sec-title">跟随父级</div>
          <select className="vc-select" value={l.parentId ?? ''} onChange={(e) => actions.setParent(l.id, e.target.value || null)}>
            <option value="">无父级</option>
            {shot.layers.filter((x) => x.id !== l.id && x.kind !== 'background').map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
          <div className="vc-sec-title">镜头景深</div>
          <OpenCutNumberField icon="Z" min={-5} max={10} value={l.depth} defaultValue={0} onChange={(d, g) => actions.setDepth(l.id, d, g)} />
          <div className="vc-sec-title">图层控制</div>
          <div className="vc-layer-ops">
            <button onClick={() => actions.reorder(l.id, -1)}><ArrowUp size={13} />上移</button>
            <button onClick={() => actions.reorder(l.id, 1)}><ArrowDown size={13} />下移</button>
            <button onClick={() => actions.toggleVisible(l.id)}>{l.visible ? <EyeOff size={13} /> : <Eye size={13} />}{l.visible ? '隐藏' : '显示'}</button>
            <button onClick={() => actions.toggleLocked(l.id)}>{l.locked ? <Unlock size={13} /> : <Lock size={13} />}{l.locked ? '解锁' : '锁定'}</button>
          </div>
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}

function TimelineCard() {
  const shot = useStore(currentShot);
  const layerId = useStore((s) => s.layerId);
  const ppf = useStore((s) => s.pxPerFrame);
  const sel = useStore((s) => s.sel);

  const trackColor = (k: Layer['kind']) => (k === 'character' ? '#1f7fb8' : k === 'prop' ? '#2c8a72' : '#4b5563');

  const rows: TRow[] = shot.layers.map((l) => ({
    id: l.id, height: 34, active: l.id === layerId, onHeaderClick: () => actions.selectLayer(l.id),
    className: l.visible ? '' : 'dim',
    header: (
      <div className="vc-tl-head">
        <span className={`vc-dot k-${l.kind}`} />
        <span className="vc-tl-name">{l.name}</span>
        <button className={`vc-tbtn ${l.locked ? 'stay' : ''}`} onClick={(e) => { e.stopPropagation(); actions.toggleLocked(l.id); }}>{l.locked ? <Lock size={11} /> : <Unlock size={11} />}</button>
        <button className={`vc-tbtn ${!l.visible ? 'stay' : ''}`} onClick={(e) => { e.stopPropagation(); actions.toggleVisible(l.id); }}>{l.visible ? <Eye size={11} /> : <EyeOff size={11} />}</button>
      </div>
    ),
    items: [...layerClipItems(l, trackColor(l.kind)), ...layerKeyItems(l, '#ffd166')],
  }));

  rows.push({
    id: 'cam', height: 28, className: 'cam',
    header: (
      <div className="vc-tl-head">
        <Camera size={12} className="vc-cam-ico" />
        <span className="vc-tl-name">镜头相机</span>
        <button className="vc-tbtn stay" title="添加相机关键帧" onClick={actions.addCameraKey}><Plus size={12} /></button>
      </div>
    ),
    items: shot.camera.map((k) => ({ sel: { kind: 'cam', id: k.id }, start: k.t, shape: 'cam', color: '#38bdf8' })),
  });

  for (const a of shot.audio) {
    rows.push({
      id: a.id, height: 32, className: 'audio',
      header: (
        <div className="vc-tl-head">
          <Music size={12} className="vc-aud-ico" />
          <span className="vc-tl-name">{a.name}</span>
        </div>
      ),
      items: [{ sel: { kind: 'audio', id: a.id }, start: a.start, len: a.len, shape: 'audio', label: a.name, seed: a.assetId, color: '#2563eb' }],
    });
  }

  return (
    <div className="vc-card vc-timeline-card">
      <div className="vc-tl-toolbar">
        <button className="vc-tool-chip" disabled={!layerId} onClick={() => layerId && actions.addKey(layerId)}><Diamond size={12} />关键帧</button>
        <button className="vc-tool-chip" onClick={actions.addCameraKey}><Camera size={12} />相机帧</button>
        <button className="vc-tool-chip danger" disabled={!sel} onClick={actions.deleteSelection}><Trash2 size={12} />删除</button>
        <span className="vc-flex" />
        <button className="vc-ico sm" onClick={() => actions.setTimelineZoom(ppf / 1.25)}><Minus size={12} /></button>
        <Slider.Root className="vc-slider tl" min={1.5} max={30} step={0.5} value={[ppf]} onValueChange={([v]) => actions.setTimelineZoom(v)}>
          <Slider.Track className="vc-slider-track"><Slider.Range className="vc-slider-range" /></Slider.Track>
          <Slider.Thumb className="vc-slider-thumb" />
        </Slider.Root>
        <button className="vc-ico sm" onClick={() => actions.setTimelineZoom(ppf * 1.25)}><Plus size={12} /></button>
      </div>
      <div className="vc-tl-wrap">
        <TimelineBody rows={rows} headerWidth={190} rulerHeight={24} className="vc-tl" />
      </div>
    </div>
  );
}

export default function VariantC() {
  const mediaRef = useRef<PanelImperativeHandle>(null);
  const propRef = useRef<PanelImperativeHandle>(null);
  const toast = useStore((s) => s.toast);
  return (
    <div className="vc">
      <HeaderC />
      <div className="vc-workbench">
        <Group orientation="vertical" className="vc-vgroup">
          <Panel id="c-main" defaultSize="64%" minSize="35%" maxSize="82%">
            <Group orientation="horizontal" className="vc-hgroup">
              <Panel panelRef={mediaRef} id="c-media" defaultSize={340} minSize={240} maxSize={460} collapsible collapsedSize={0}>
                <MediaPanel />
              </Panel>
              <Separator className="vc-handle-v" />
              <Panel id="c-preview" minSize={360}>
                <PreviewCard />
              </Panel>
              <Separator className="vc-handle-v" />
              <Panel panelRef={propRef} id="c-props" defaultSize={285} minSize={250} maxSize={400} collapsible collapsedSize={0}>
                <PropertiesCard />
              </Panel>
            </Group>
          </Panel>
          <Separator className="vc-handle-h" />
          <Panel id="c-timeline" defaultSize="36%" minSize="18%" maxSize="65%">
            <TimelineCard />
          </Panel>
        </Group>
      </div>
      {toast && <div className="proto-toast vc-toast">{toast}</div>}
    </div>
  );
}
