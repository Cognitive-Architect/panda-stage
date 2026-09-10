import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  QuickActionDrawer,
  shouldRenderRestSaveState,
  type CompactProjectSaveState,
} from '../../src/renderer/shell/CompactProjectBar';
import { migrateProject } from '../../src/domain';
import type { EditorProjectSnapshot } from '../../src/renderer/stores/EditorProjectStore';
import exampleProject from '../../demo-project/project-v1.example.json';

function source(path: string): string {
  return readFileSync(path, 'utf8').replace(/\r\n/gu, '\n');
}

const project = migrateProject(exampleProject);
const snapshot: EditorProjectSnapshot = {
  projectRoot: 'D:\\PandaStage-Acceptance\\issue-470.pandastage',
  project,
  dirty: false,
  revision: 0,
};

function renderDrawer(saveState: CompactProjectSaveState): string {
  return renderToStaticMarkup(
    createElement(QuickActionDrawer, {
      busy: false,
      closeConfirmOpen: false,
      onOpenProductPreview: () => undefined,
      onOpenProjectCenter: () => undefined,
      onOpenProjectFolder: async () => undefined,
      onRequestCloseProject: () => undefined,
      onSaveProject: async () => undefined,
      presentation: 'landscape',
      productPreviewOpen: false,
      projectSnapshot: {
        ...snapshot,
        dirty: saveState !== 'saved',
      },
      saveState,
      status: 'Ready',
    }),
  );
}

describe('Issue #470 Quick Action Drawer save-state presentation', () => {
  it('shows the rest-state only for collapsed transient save states', () => {
    expect(shouldRenderRestSaveState(false, 'dirty')).toBe(false);
    expect(shouldRenderRestSaveState(false, 'saving')).toBe(true);
    expect(shouldRenderRestSaveState(false, 'failed')).toBe(true);
    expect(shouldRenderRestSaveState(true, 'dirty')).toBe(false);
    expect(shouldRenderRestSaveState(true, 'saving')).toBe(false);
    expect(shouldRenderRestSaveState(true, 'failed')).toBe(false);
    expect(shouldRenderRestSaveState(false, 'saved')).toBe(false);
    expect(shouldRenderRestSaveState(true, 'saved')).toBe(false);
  });

  it('keeps the in-drawer state and removes the duplicate external surface', () => {
    const dirty = renderDrawer('dirty');
    const saving = renderDrawer('saving');
    const saved = renderDrawer('saved');
    const drawer = source('src/renderer/shell/CompactProjectBar.tsx');

    expect(dirty).not.toContain('data-testid="project-save-state"');
    expect(dirty).not.toContain('data-testid="project-save-state-rest"');
    expect(saving).toContain('data-testid="project-save-state"');
    expect(saving).toContain('data-testid="project-save-state-rest"');
    expect(saved).not.toContain('data-testid="project-save-state"');
    expect(saved).not.toContain('data-testid="project-save-state-rest"');
    expect(drawer).toContain(
      'const showRestSaveState = shouldRenderRestSaveState(expanded, saveState);',
    );
  });
});
