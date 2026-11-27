import {
  createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import * as Menu from '@radix-ui/react-dropdown-menu';
import {
  DockviewDefaultTab, DockviewReact, themeDark,
  type DockviewApi, type DockviewReadyEvent, type IDockviewHeaderActionsProps,
  type IDockviewPanelHeaderProps, type IDockviewPanelProps,
} from 'dockview-react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Button, IconButton } from '../ui';
import { defaultWorkbenchLayout, addWorkbenchPanel, restoreWorkbenchLayout, saveWorkbenchLayout,
  WORKBENCH_PANELS, WORKBENCH_TITLES, type WorkbenchPanel, type FoldState,
} from './editorWorkbenchLayout';
import 'dockview-react/dist/styles/dockview.css';

export interface WorkbenchControls {
  show(panel: WorkbenchPanel): void;
  close(panel: WorkbenchPanel): void;
}

interface PanelMounts {
  nodes: Record<WorkbenchPanel, HTMLElement>;
  parking: HTMLElement | null;
  canHide(panel: WorkbenchPanel): boolean;
  close(panel: WorkbenchPanel): void;
}

const PanelContext = createContext<PanelMounts | null>(null);
const PanelHideContext = createContext<(panel: WorkbenchPanel) => boolean>(() => true);
const COMPACT_PANELS: readonly WorkbenchPanel[] = ['assets', 'layers', 'timeline'];

function PanelSlot({ api, params }: IDockviewPanelProps<FoldState>) {
  const mounts = useContext(PanelContext)!;
  const slot = useRef<HTMLDivElement>(null);
  const content = mounts.nodes[api.id as WorkbenchPanel];
  useLayoutEffect(() => {
    const host = slot.current;
    host?.appendChild(content);
    return () => {
      if (content.parentNode !== host) return;
      if (mounts.parking) mounts.parking.appendChild(content);
      else content.remove();
    };
  }, [content, mounts]);
  return <div className="workbench-panel-slot" ref={slot} hidden={params.folded === true} />;
}

function WorkbenchTab(props: IDockviewPanelHeaderProps) {
  const mounts = useContext(PanelContext)!;
  const canHide = useContext(PanelHideContext);
  const panel = props.api.id as WorkbenchPanel;
  return <DockviewDefaultTab {...props}
    hideClose={!canHide(panel)} closeActionOverride={() => mounts.close(panel)} />;
}

function FoldControl({ activePanel, panels, containerApi }: IDockviewHeaderActionsProps) {
  const mounts = useContext(PanelContext)!;
  const canHide = useContext(PanelHideContext);
  const [fold, setFold] = useState<FoldState>({});
  useEffect(() => {
    setFold(activePanel?.params ?? {});
    const subscription = activePanel?.api.onDidParametersChange(setFold);
    return () => subscription?.dispose();
  }, [activePanel]);
  if (!activePanel) return null;
  const id = activePanel.id as WorkbenchPanel;
  const compact = panels.length === 1 && activePanel.api.location.type === 'grid'
    && COMPACT_PANELS.includes(id);
  const label = `${fold.folded ? '展开' : '折叠'}${WORKBENCH_TITLES[id]}`;
  return <IconButton variant="secondary" aria-label={label} title={label}
    disabled={!fold.folded && !canHide(id)}
    aria-expanded={!fold.folded}
    icon={fold.folded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
    onClick={() => {
      if (!fold.folded && !mounts.canHide(id)) return;
      activePanel.api.updateParameters({
        folded: !fold.folded,
        restoreFraction: !fold.folded && compact ? activePanel.api.group.api.height / containerApi.height : undefined,
      });
      if (compact) {
        activePanel.api.setSize({ height: fold.folded
          ? Math.round(containerApi.height * (fold.restoreFraction ?? 0.32))
          : 34 });
      }
      saveWorkbenchLayout(containerApi);
    }} />;
}

const panelComponents = Object.fromEntries(WORKBENCH_PANELS.map((panel) => [panel, PanelSlot]));

interface EditorWorkbenchProps {
  controls: { current: WorkbenchControls | null };
  canHide(panel: WorkbenchPanel): boolean;
  header: ReactNode;
  panels: Record<WorkbenchPanel, ReactNode>;
}

export function EditorWorkbench({ controls, canHide, header, panels }: EditorWorkbenchProps) {
  const [shown, setShown] = useState<WorkbenchPanel[]>([]);
  const [api, setApi] = useState<DockviewApi | null>(null);
  const dock = useRef<DockviewApi>(null);
  const windowMenu = useRef<HTMLButtonElement>(null);
  const hideGuard = useRef(canHide);
  hideGuard.current = canHide;

  // React owns each business panel for the editor's lifetime. Dockview can
  // replace its slot without tearing down local drafts or the Konva stage.
  const [mounts] = useState<PanelMounts>(() => {
    const nodes = {} as PanelMounts['nodes'];
    for (const id of WORKBENCH_PANELS) {
      const node = document.createElement('div');
      node.className = 'workbench-panel-content';
      node.dataset.workbenchPanel = id;
      nodes[id] = node;
    }
    return {
      nodes,
      parking: null,
      canHide: (panel) => hideGuard.current(panel),
      close: (panel) => {
        if (!hideGuard.current(panel)) return;
        dock.current?.getPanel(panel)?.api.close();
        windowMenu.current?.focus();
      },
    };
  });

  const parkPanels = useCallback((node: HTMLDivElement | null) => {
    mounts.parking = node;
    if (node) for (const id of WORKBENCH_PANELS) {
      if (!mounts.nodes[id].isConnected) node.appendChild(mounts.nodes[id]);
    }
  }, [mounts]);

  useLayoutEffect(() => {
    controls.current = {
      show(id) {
        const current = dock.current;
        if (!current) return;
        const panel = current.getPanel(id) ?? addWorkbenchPanel(current, id, {
          position: { direction: id === 'timeline' ? 'below' : 'within' },
        });
        if (panel.params?.folded) {
          const fraction = panel.params.restoreFraction as number | undefined;
          panel.api.updateParameters({ folded: false, restoreFraction: undefined });
          if (fraction !== undefined && panel.group.panels.length === 1) {
            panel.api.setSize({ height: Math.round(current.height * fraction) });
          }
        }
        panel.api.setActive();
      },
      close: mounts.close,
    };
    return () => { controls.current = null; };
  }, [controls, mounts]);

  function onReady({ api: readyApi }: DockviewReadyEvent) {
    dock.current = readyApi;
    restoreWorkbenchLayout(readyApi);
    setApi(readyApi);
    setShown(WORKBENCH_PANELS.filter((id) => readyApi.getPanel(id)));
  }

  useEffect(() => {
    if (!api) return;
    const layout = api.onDidLayoutChange(() => {
      saveWorkbenchLayout(api);
      setShown(WORKBENCH_PANELS.filter((id) => api.getPanel(id)));
    });
    return () => layout.dispose();
  }, [api]);

  return (
    <>
      <div className="workbench-toolbar">
        <Menu.Root>
          <Menu.Trigger asChild>
            <Button ref={windowMenu} variant="secondary" data-testid="workbench-window-menu">窗口</Button>
          </Menu.Trigger>
          <Menu.Content className="workbench-menu" sideOffset={4} align="start">
            {WORKBENCH_PANELS.map((id) => <Menu.CheckboxItem key={id}
              data-panel={id}
              checked={shown.includes(id)}
              disabled={shown.includes(id) && !canHide(id)}
              onCheckedChange={(visible) => visible ? controls.current?.show(id) : mounts.close(id)}>
              <Menu.ItemIndicator>✓</Menu.ItemIndicator>{WORKBENCH_TITLES[id]}
            </Menu.CheckboxItem>)}
            <Menu.Separator />
            <Menu.Item onSelect={() => {
              if (!dock.current) return;
              defaultWorkbenchLayout(dock.current);
              saveWorkbenchLayout(dock.current);
            }}>恢复默认布局</Menu.Item>
          </Menu.Content>
        </Menu.Root>
        {header}
      </div>
      <PanelContext.Provider value={mounts}>
        <PanelHideContext.Provider value={canHide}>
          <div className="workbench-dock" data-testid="workbench-dock">
            <DockviewReact theme={themeDark} components={panelComponents} onReady={onReady}
              defaultTabComponent={WorkbenchTab} rightHeaderActionsComponent={FoldControl}
              disableFloatingGroups proportionalLayout keyboardNavigation />
          </div>
        </PanelHideContext.Provider>
      </PanelContext.Provider>
      <div hidden ref={parkPanels} />
      {WORKBENCH_PANELS.map((id) => createPortal(panels[id], mounts.nodes[id], id))}
    </>
  );
}
