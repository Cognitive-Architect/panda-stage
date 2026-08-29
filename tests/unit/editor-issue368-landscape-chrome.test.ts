import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import { migrateProject } from '../../src/domain';
import { CompactProjectBar } from '../../src/renderer/shell/CompactProjectBar';
import type { EditorProjectSnapshot } from '../../src/renderer/stores/EditorProjectStore';

function source(path: string): string {
  return readFileSync(path, 'utf8').replace(/\r\n/gu, '\n');
}

const project = migrateProject(exampleProject);
const snapshot: EditorProjectSnapshot = {
  projectRoot: 'D:\\PandaStage-Acceptance\\issue-368.pandastage',
  project,
  dirty: false,
  revision: 0,
};

function renderBar(
  status = 'Ready',
  saveState: 'saved' | 'dirty' | 'saving' | 'failed' = 'saved',
): string {
  return renderToStaticMarkup(
    createElement(CompactProjectBar, {
      projectSnapshot: snapshot,
      saveState,
      status,
      busy: false,
      productPreviewOpen: false,
      closeConfirmOpen: false,
      onOpenProjectCenter: vi.fn(),
      onOpenProjectFolder: vi.fn(async () => undefined),
      onSaveProject: vi.fn(async () => undefined),
      onOpenProductPreview: vi.fn(),
      onRequestCloseProject: vi.fn(),
      deviceMode: 'cloud-touch',
      onDeviceModeChange: vi.fn(),
      presentation: 'landscape',
    }),
  );
}

describe('Issue #368 landscape editor chrome', () => {
  it('keeps the top bar compact, ordered, and free of persistent project chrome', () => {
    const markup = renderBar();

    expect(markup).toContain('data-history-presentation="compact"');
    expect(markup).not.toContain('data-testid="open-project-center"');
    expect(markup).toContain('data-testid="active-project-path"');
    expect(markup).toContain('compact-project-path-visually-hidden');
    expect(markup).not.toContain('class="compact-project-path"');
    expect(markup).toContain(`title="${snapshot.projectRoot}"`);
    expect(markup).not.toContain('data-testid="editor-action-status"');

    const historyIndex = markup.indexOf('data-history-presentation="compact"');
    const saveStateIndex = markup.indexOf('data-testid="project-save-state"');
    const saveIndex = markup.indexOf('data-testid="compact-project-save"');
    const moreIndex = markup.indexOf('data-testid="compact-project-more"');
    expect(historyIndex).toBeGreaterThanOrEqual(0);
    expect(historyIndex).toBeLessThan(saveStateIndex);
    expect(saveStateIndex).toBeLessThan(saveIndex);
    expect(saveIndex).toBeLessThan(moreIndex);

    const bar = source('src/renderer/shell/CompactProjectBar.tsx');
    expect(bar).toContain('<HistoryControls presentation="compact" />');
    expect(bar).toContain('data-testid="menu-open-project-center"');
  });

  it('keeps actionable feedback while suppressing ordinary success copy', () => {
    const quietMarkup = renderBar('Ready');
    const actionableMarkup = renderBar('Actionable save failure', 'failed');

    expect(quietMarkup).not.toContain('data-testid="editor-action-status"');
    expect(actionableMarkup).toContain('data-testid="editor-action-status"');
    expect(actionableMarkup).toContain('Actionable save failure');
  });

  it('uses icon-over-label controls and restrained landscape selection styling', () => {
    const dock = source('src/renderer/shell/ResourceActivityDock.tsx');
    const left = source('src/renderer/shell/LeftWorkspace.tsx');
    const styles = source('src/renderer/styles.css');

    for (const icon of ['Clapperboard', 'Images', 'Smile']) {
      expect(dock).toContain(icon);
    }
    expect(dock).toContain('DecorativeIcon icon={activity.icon}');
    expect(left).toContain('DecorativeIcon icon={Wrench}');
    expect(left).toContain('data-testid="landscape-project-tools"');
    expect(styles).toContain('Issue #368');
    expect(styles).toContain('writing-mode: horizontal-tb;');
    expect(styles).toContain('background: rgb(45 104 62 / 28%);');
    expect(styles).toContain('min-width: 44px;');
    expect(styles).toContain(".history-controls[data-history-presentation='compact']");
  });

  it('mounts one History owner in the top bar and removes landscape headings/history', () => {
    const shell = source('src/renderer/shell/EditorShell.tsx');
    const bottom = source('src/renderer/shell/BottomWorkspace.tsx');

    expect(shell).toContain('showHeading={false}');
    expect(shell).toContain('showHistoryControls={false}');
    expect(shell).not.toContain('showHistoryControls={!isPortrait}');
    expect(bottom).toContain("showHistoryControls = presentation !== 'landscape'");
    expect(bottom).toContain('<HistoryControls presentation="bottom" />');
  });
});
