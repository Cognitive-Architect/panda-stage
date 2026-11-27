import { useEffect, useRef, useState } from 'react';
import { DockviewReact, type DockviewApi, type DockviewReadyEvent, type IDockviewHeaderActionsProps, type IDockviewPanelProps } from 'dockview-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Tooltip from '@radix-ui/react-tooltip';
import { ChevronDown, ChevronUp, Frame, Pause, Play, Redo2, SkipBack, SkipForward, StepBack, StepForward, Undo2 } from 'lucide-react';
import { fmtTime, FPS } from '../../core/model';
import { Stage, type OverlayRect } from '../../core/Stage';
import { actions, currentLayer, currentShot, getState, useStore } from '../../core/store';
import { ContextToolbar } from '../a/VariantA';
import { ExportDialogC } from '../c/VariantC';
import { IconButton, Menu } from './controls';
import { Curve, Inspector } from './Inspector';
import { Layers } from './Layers';
import { Library } from './Library';
import { Timeline } from './Timeline';
import './d.css';

const LAYOUT_KEY = 'reshell-proto-d-layout-v1';

function Canvas() {
  const [safe, setSafe] = useState(false);
  const [overlay, setOverlay] = useState<OverlayRect | null>(null);
  const zoom = useStore((s) => s.viewZoom);
  const playing = useStore((s) => s.playing);
  const percent = Math.round(zoom * 100);
  return <div className="vd-panel">
    <div className="vd-strip vd-canvas-tools">
      <span>1280 × 720 <i /> {FPS} fps</span><span className="vd-spacer" />
      <IconButton label="安全框" pressed={safe} onClick={() => setSafe(!safe)}><Frame size={15} /></IconButton>
      <select aria-label="画布缩放" value={percent} onChange={(e) => actions.setViewZoom(Number(e.target.value) / 100)}>
        {[...new Set([25, 50, 75, 100, 125, 150, 200, percent])].sort((a, b) => a - b).map((n) => <option key={n} value={n}>{n}%</option>)}
      </select>
    </div>
    <div className="vd-canvas">
      <Stage theme={{ backdrop: '#141619', frameStroke: '#343940', accent: '#53ccf4', safe }} onOverlay={setOverlay} />
      {overlay && !playing && <ContextToolbar r={overlay} fusion />}
    </div>
  </div>;
}

const panels = {
  stage: { title: '画布', view: Canvas },
  assets: { title: '资源库', view: Library },
  layers: { title: '图层', view: Layers },
  props: { title: '属性检查器', view: Inspector },
  curve: { title: '缓动曲线', view: Curve },
  timeline: { title: '时间轴', view: Timeline },
};

type PanelId = keyof typeof panels;
const panelIds = Object.keys(panels) as PanelId[];
const compactPanels = ['assets', 'layers', 'timeline'];
type FoldState = { folded?: boolean; restoreHeight?: number };

function saveLayout(api: DockviewApi) {
  try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(api.toJSON())); } catch { /* Storage can be unavailable. */ }
}

function FoldControl({ activePanel, panels: groupPanels, containerApi }: IDockviewHeaderActionsProps) {
  const [fold, setFold] = useState<FoldState>({});
  useEffect(() => {
    setFold(activePanel?.params ?? {});
    const subscription = activePanel?.api.onDidParametersChange(setFold);
    return () => subscription?.dispose();
  }, [activePanel]);
  if (!activePanel) return null;
  const { folded, restoreHeight } = fold;
  const vertical = groupPanels.length === 1 && activePanel.api.location.type === 'grid'
    && compactPanels.includes(activePanel.id);
  return <IconButton label={folded ? '展开面板' : '折叠面板'} pressed={!!folded} onClick={() => {
    activePanel.api.updateParameters({ folded: !folded, restoreHeight: !folded && vertical ? activePanel.api.group.api.height : undefined });
    if (vertical) activePanel.api.setSize({ height: folded ? restoreHeight ?? 220 : 34 });
    saveLayout(containerApi);
  }}>{folded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}</IconButton>;
}

const components = Object.fromEntries(panelIds.map((id) => {
  const View = panels[id].view;
  return [id, function Panel({ params }: IDockviewPanelProps<FoldState>) {
    return <div className="vd-content" hidden={params.folded}><View /></div>;
  }];
}));

function addPanel(api: DockviewApi, id: PanelId, options?: { position?: Parameters<DockviewApi['addPanel']>[0]['position']; initialWidth?: number; initialHeight?: number }) {
  return api.addPanel({ id, component: id, title: panels[id].title, minimumHeight: compactPanels.includes(id) ? 34 : 100, params: {}, ...options });
}

function defaultLayout(api: DockviewApi) {
  api.clear();
  addPanel(api, 'stage');
  addPanel(api, 'assets', { position: { referencePanel: 'stage', direction: 'left' }, initialWidth: 260 });
  addPanel(api, 'layers', { position: { referencePanel: 'assets', direction: 'below' }, initialHeight: 190 });
  addPanel(api, 'props', { position: { referencePanel: 'stage', direction: 'right' }, initialWidth: 275 });
  addPanel(api, 'curve', { position: { referencePanel: 'props', direction: 'within' } });
  api.getPanel('props')?.api.setActive();
  addPanel(api, 'timeline', { position: { direction: 'below' }, initialHeight: 318 });
  api.getPanel('layers')?.api.setSize({ height: 218 });
  api.getPanel('stage')?.api.setActive();
}

export default function VariantD() {
  const dock = useRef<DockviewApi>(null);
  const [shown, setShown] = useState<PanelId[]>([]);
  const [exportOpen, setExportOpen] = useState(false);
  const project = useStore((s) => s.project);
  const shot = useStore(currentShot);
  const layer = useStore(currentLayer);
  const time = useStore((s) => s.time);
  const playing = useStore((s) => s.playing);
  const undo = useStore((s) => s.past.length > 0);
  const redo = useStore((s) => s.future.length > 0);
  const toast = useStore((s) => s.toast);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'm') {
        event.preventDefault();
        setExportOpen(true);
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, []);

  function onReady({ api }: DockviewReadyEvent) {
    dock.current = api;
    try {
      const saved = localStorage.getItem(LAYOUT_KEY);
      if (saved) api.fromJSON(JSON.parse(saved));
      else defaultLayout(api);
    } catch { defaultLayout(api); }
    const sync = () => setShown(panelIds.filter((id) => !!api.getPanel(id)));
    api.onDidLayoutChange(() => { saveLayout(api); sync(); });
    sync();
  }

  function togglePanel(id: PanelId) {
    const api = dock.current;
    if (!api) return;
    const panel = api.getPanel(id);
    if (panel) panel.api.close();
    else addPanel(api, id, { position: { direction: id === 'timeline' ? 'below' : 'within' } });
  }

  return <Tooltip.Provider delayDuration={350}>
    <div className="vd">
      <header className="vd-header">
        <div className="vd-menu-bar">
          <span className="vd-brand">Panda Stage</span>
          <Menu label="文件">
            <DropdownMenu.Item onSelect={() => setExportOpen(true)}>导出… <kbd>Ctrl+M</kbd></DropdownMenu.Item>
          </Menu>
          <Menu label="编辑">
            <DropdownMenu.Item disabled={!undo} onSelect={actions.undo}>撤销 <kbd>Ctrl+Z</kbd></DropdownMenu.Item>
            <DropdownMenu.Item disabled={!redo} onSelect={actions.redo}>重做 <kbd>Ctrl+Shift+Z</kbd></DropdownMenu.Item>
            <DropdownMenu.Separator />
            <DropdownMenu.Item disabled={!layer || layer.locked} onSelect={() => layer && actions.addKey(layer.id)}>添加关键帧 <kbd>K</kbd></DropdownMenu.Item>
            <DropdownMenu.Item onSelect={actions.deleteSelection}>删除时间轴选中项 <kbd>Del</kbd></DropdownMenu.Item>
          </Menu>
          <Menu label="视图">
            <DropdownMenu.Item onSelect={() => actions.setViewZoom(getState().viewZoom * 1.25)}>放大画布</DropdownMenu.Item>
            <DropdownMenu.Item onSelect={() => actions.setViewZoom(getState().viewZoom / 1.25)}>缩小画布</DropdownMenu.Item>
            <DropdownMenu.Item onSelect={() => actions.setViewZoom(1)}>适合窗口</DropdownMenu.Item>
          </Menu>
          <Menu label="窗口">
            {panelIds.map((id) => <DropdownMenu.CheckboxItem key={id} checked={shown.includes(id)} onCheckedChange={() => togglePanel(id)}>
              <DropdownMenu.ItemIndicator>✓</DropdownMenu.ItemIndicator>{panels[id].title}
            </DropdownMenu.CheckboxItem>)}
            <DropdownMenu.Separator />
            <DropdownMenu.Item onSelect={() => { if (dock.current) { defaultLayout(dock.current); saveLayout(dock.current); } }}>恢复默认布局</DropdownMenu.Item>
          </Menu>
          <span className="vd-project">{project.name}</span>
        </div>
        <div className="vd-toolbar">
          <div className="vd-toolbar-group">
            <IconButton label="撤销" disabled={!undo} onClick={actions.undo}><Undo2 size={16} /></IconButton>
            <IconButton label="重做" disabled={!redo} onClick={actions.redo}><Redo2 size={16} /></IconButton>
          </div>
          <select aria-label="切换镜头" value={shot.id} onChange={(e) => actions.setShot(e.target.value)}>
            {project.shots.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <div className="vd-transport">
            <IconButton label="跳到开头" onClick={() => actions.seek(0)}><SkipBack size={15} /></IconButton>
            <IconButton label="上一帧" onClick={() => actions.step(-1)}><StepBack size={15} /></IconButton>
            <IconButton label={playing ? '暂停' : '播放'} pressed={playing} onClick={() => actions.play()}>{playing ? <Pause size={16} /> : <Play size={16} />}</IconButton>
            <IconButton label="下一帧" onClick={() => actions.step(1)}><StepForward size={15} /></IconButton>
            <IconButton label="跳到结尾" onClick={() => actions.seek(shot.duration)}><SkipForward size={15} /></IconButton>
            <output aria-label="播放位置">{fmtTime(time)}</output>
          </div>
          <div className="vd-export"><ExportDialogC open={exportOpen} onOpenChange={setExportOpen} /></div>
        </div>
      </header>
      <div className="vd-dock">
        <DockviewReact className="dockview-theme-dark" components={components} onReady={onReady}
          rightHeaderActionsComponent={FoldControl} disableFloatingGroups />
      </div>
      {toast && !toast.startsWith('已放入：') && !toast.startsWith('已添加音频：') && <div className="proto-toast vd-toast" role="status">{toast}</div>}
    </div>
  </Tooltip.Provider>;
}
