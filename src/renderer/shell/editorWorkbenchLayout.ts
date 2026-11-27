import { z } from 'zod';
import type { DockviewApi, SerializedDockview } from 'dockview-react';

export const WORKBENCH_TITLES = {
  assets: '资源库',
  layers: '图层',
  stage: '画布',
  props: '属性检查器',
  curve: '缓动曲线',
  timeline: '时间轴',
} as const;

export type WorkbenchPanel = keyof typeof WORKBENCH_TITLES;
export const WORKBENCH_PANELS = Object.keys(WORKBENCH_TITLES) as WorkbenchPanel[];
export const WORKBENCH_LAYOUT_KEY = 'panda-stage:editor-workbench:v1';

const panelId = z.enum(WORKBENCH_PANELS);
const foldState = z.object({
  folded: z.boolean().optional(),
  restoreFraction: z.number().positive().max(1).optional(),
});
export type FoldState = z.infer<typeof foldState>;

const panelState = z.object({
  id: panelId,
  contentComponent: panelId,
  params: foldState.optional(),
  minimumHeight: z.number().nonnegative().optional(),
  minimumWidth: z.number().nonnegative().optional(),
});
const groupState = z.object({
  id: z.string().min(1),
  views: z.array(panelId).min(1),
  activeView: panelId.optional(),
}).refine(({ views, activeView }) => !activeView || views.includes(activeView));

const leaf = z.object({ type: z.literal('leaf'), size: z.number().nonnegative(), data: groupState });
type LayoutNode = z.infer<typeof leaf> | { type: 'branch'; size?: number; data: LayoutNode[] };
const gridNode: z.ZodType<LayoutNode> = z.lazy(() => z.union([leaf, z.object({
  type: z.literal('branch'),
  size: z.number().nonnegative().optional(),
  data: z.array(gridNode).max(WORKBENCH_PANELS.length),
})]));

const layoutState = z.object({
  grid: z.object({
    root: gridNode,
    width: z.number().positive(),
    height: z.number().positive(),
    orientation: z.enum(['HORIZONTAL', 'VERTICAL']),
  }),
  panels: z.partialRecord(panelId, panelState),
  activeGroup: z.string().optional(),
});

export function decodeWorkbenchLayout(value: string): SerializedDockview {
  const layout = layoutState.parse(JSON.parse(value));
  const views = new Set<WorkbenchPanel>();
  const groups = new Set<string>();
  const visit = (node: LayoutNode) => {
    if (node.type === 'branch') {
      node.data.forEach(visit);
      return;
    }
    if (groups.has(node.data.id)) throw new Error('Duplicate workbench group');
    groups.add(node.data.id);
    for (const id of node.data.views) {
      const panel = layout.panels[id];
      if (views.has(id) || panel?.id !== id || panel.contentComponent !== id) {
        throw new Error('Invalid workbench panel');
      }
      views.add(id);
    }
  };
  visit(layout.grid.root);
  if (views.size !== Object.keys(layout.panels).length ||
    (layout.activeGroup && !groups.has(layout.activeGroup))) {
    throw new Error('Invalid workbench layout');
  }
  for (const id of views) {
    const panel = layout.panels[id]!;
    layout.panels[id] = { ...panel, ...restoredPanelSizes(id) };
  }
  return layout as SerializedDockview;
}

function restoredPanelSizes(id: WorkbenchPanel) {
  return { minimumHeight: id === 'assets' || id === 'layers' || id === 'timeline' ? 34 : 100 };
}

type PanelPlacement = Pick<Parameters<DockviewApi['addPanel']>[0], 'position' | 'initialWidth' | 'initialHeight'>;

export function addWorkbenchPanel(api: DockviewApi, id: WorkbenchPanel, placement?: PanelPlacement) {
  return api.addPanel({
    id, component: id, title: WORKBENCH_TITLES[id],
    ...restoredPanelSizes(id),
    params: {},
    ...placement,
  });
}

// Dockview owns the topology and sizes. Split off the full-width timeline
// before creating the upper columns, as in the approved D prototype (#1392).
export function defaultWorkbenchLayout(api: DockviewApi) {
  const timelineHeight = Math.round(api.height * 0.32);
  const layersHeight = Math.round((api.height - timelineHeight) * 0.40);
  api.clear();
  addWorkbenchPanel(api, 'stage');
  addWorkbenchPanel(api, 'timeline', { position: { direction: 'below' }, initialHeight: timelineHeight });
  addWorkbenchPanel(api, 'assets', { position: { referencePanel: 'stage', direction: 'left' }, initialWidth: 260 });
  addWorkbenchPanel(api, 'layers', { position: { referencePanel: 'assets', direction: 'below' }, initialHeight: layersHeight });
  addWorkbenchPanel(api, 'props', { position: { referencePanel: 'stage', direction: 'right' }, initialWidth: 275 });
  addWorkbenchPanel(api, 'curve', { position: { referencePanel: 'props', direction: 'within' } });
  api.getPanel('props')?.api.setActive();
  api.getPanel('stage')?.api.setActive();
}

export function restoreWorkbenchLayout(api: DockviewApi) {
  try {
    const saved = window.localStorage.getItem(WORKBENCH_LAYOUT_KEY);
    if (saved) {
      api.fromJSON(decodeWorkbenchLayout(saved));
      for (const panel of api.panels) panel.api.setTitle(WORKBENCH_TITLES[panel.id as WorkbenchPanel]);
      return;
    }
  } catch {
    // Storage can be disabled, or the preference may be damaged.
  }
  defaultWorkbenchLayout(api);
}

export function saveWorkbenchLayout(api: DockviewApi) {
  try {
    window.localStorage.setItem(WORKBENCH_LAYOUT_KEY, JSON.stringify(api.toJSON()));
  } catch {
    // The editor remains usable if application preferences cannot be written.
  }
}
