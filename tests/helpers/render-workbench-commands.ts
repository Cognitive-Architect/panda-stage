import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WorkbenchCommandBar } from '../../src/renderer/shell/WorkbenchCommandBar';
import type { EditorProjectSnapshot } from '../../src/renderer/stores/EditorProjectStore';

export function renderWorkbenchCommands(
  snapshot: EditorProjectSnapshot,
  overrides: Partial<ComponentProps<typeof WorkbenchCommandBar>> = {},
): string {
  const noop = () => undefined;
  return renderToStaticMarkup(createElement(WorkbenchCommandBar, {
    windowMenu: null,
    snapshot,
    shotId: snapshot.project.shots[0]?.id ?? null,
    busy: false,
    navigationBlocked: false,
    modalOpen: false,
    previewOpen: false,
    exportBusy: false,
    exportOpen: false,
    saveState: snapshot.dirty ? 'dirty' : 'saved',
    status: 'Ready',
    onShotChange: noop,
    onNew: noop,
    onOpen: noop,
    onSave: noop,
    onClose: noop,
    onProjectCenter: noop,
    onFolder: noop,
    onImport: noop,
    onPreview: noop,
    onExport: noop,
    onExportSettings: noop,
    onCanvasView: noop,
    ...overrides,
  }));
}
