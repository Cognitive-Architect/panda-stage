import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  getEditorShellLayoutMode,
  reconcileEditorWorkspace,
  type EditorWorkspace,
} from '../../src/renderer/shell/adaptiveEditorShell';

function readSource(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('UI-M2 adaptive EditorShell state', () => {
  it('derives desktop, cloud-mobile landscape, and portrait from content space', () => {
    expect(getEditorShellLayoutMode({ width: 1_024, height: 720 })).toBe(
      'landscape',
    );
    expect(getEditorShellLayoutMode({ width: 1_280, height: 720 })).toBe(
      'desktop',
    );
    expect(getEditorShellLayoutMode({ width: 1_100, height: 720 })).toBe(
      'landscape',
    );
    expect(getEditorShellLayoutMode({ width: 1_101, height: 720 })).toBe(
      'desktop',
    );
    expect(getEditorShellLayoutMode({ width: 1_220, height: 2_712 })).toBe(
      'portrait',
    );
    expect(getEditorShellLayoutMode({ width: 0, height: 0 })).toBe(
      'landscape',
    );
  });

  it('preserves a legal workspace through an orientation round-trip', () => {
    const workspaces: readonly EditorWorkspace[] = [
      'canvas',
      'shots',
      'assets',
      'properties',
      'timeline',
    ];

    for (const workspace of workspaces) {
      const portrait = reconcileEditorWorkspace('portrait', workspace);
      const landscape = reconcileEditorWorkspace('landscape', portrait);
      expect(landscape).toBe(workspace);
    }
  });

  it('keeps one production owner and uses hidden slots for portrait focus', () => {
    const shell = readSource('src/renderer/shell/EditorShell.tsx');
    const switcher = readSource(
      'src/renderer/shell/AdaptiveWorkspaceSwitcher.tsx',
    );
    const adaptive = readSource(
      'src/renderer/shell/adaptiveEditorShell.ts',
    );
    const left = readSource('src/renderer/shell/LeftWorkspace.tsx');
    const inspector = readSource('src/renderer/shell/RightInspector.tsx');
    const bottom = readSource('src/renderer/shell/BottomWorkspace.tsx');
    const styles = readSource('src/renderer/styles.css');

    expect(shell.match(/<CanvasWorkspace/gu)).toHaveLength(1);
    expect(shell.match(/<RightInspector/gu)).toHaveLength(1);
    expect(shell.match(/<LeftWorkspace/gu)).toHaveLength(1);
    expect(shell.match(/<BottomWorkspace/gu)).toHaveLength(1);
    expect(shell).toContain("data-shell-mode={layoutMode}");
    expect(shell).toContain('data-active-workspace=');
    expect(shell).toContain('hidden={isPortrait');
    expect(shell).toContain('aria-hidden={');

    for (const workspace of [
      'Canvas',
      'Shots',
      'Assets',
      'Properties',
      'Timeline',
    ]) {
      expect(switcher).toContain(`label: '${workspace}'`);
    }
    expect(switcher).toContain('<SegmentedTabs');
    expect(readSource('src/renderer/ui/SegmentedTabs.tsx')).toContain(
      'role="tablist"',
    );
    expect(adaptive).toContain('useSyncExternalStore');

    expect(left).toContain('shellMode?: EditorShellLayoutMode');
    expect(left).toContain('onActiveActivityChange');
    expect(inspector).toContain('shellMode?: EditorShellLayoutMode');
    expect(bottom).toContain('data-presentation={presentation}');

    expect(styles).toContain(
      ".editor-layout[data-shell-mode='landscape']",
    );
    expect(styles).toMatch(
      /\.editor-workspace-slot\s*\{[\s\S]*?display:\s*grid;/u,
    );
    expect(styles).toContain(".editor-layout[data-shell-mode='portrait']");
    expect(styles).toContain(".editor-workspace-slot[hidden]");
    expect(styles).toContain(".bottom-workspace[data-presentation='portrait']");
  });

  it('keeps responsive state outside Project, History, and cross-process owners', () => {
    const adaptive = readSource(
      'src/renderer/shell/adaptiveEditorShell.ts',
    );
    const switcher = readSource(
      'src/renderer/shell/AdaptiveWorkspaceSwitcher.tsx',
    );

    for (const source of [adaptive, switcher]) {
      expect(source).not.toContain('updateProject');
      expect(source).not.toContain('editorProjectStore');
      expect(source).not.toContain('historyStore');
      expect(source).not.toContain('project.json');
      expect(source).not.toContain('window.pandaStage');
    }
  });

  it('uses one shell-level vertical scroll owner in portrait', () => {
    const styles = readSource('src/renderer/styles.css');

    expect(styles).toMatch(
      /\.editor-body\[data-shell-mode='portrait'\]\s*\{[\s\S]*?overflow-y:\s*auto;/u,
    );
    expect(styles).toMatch(
      /\.editor-layout\[data-shell-mode='portrait'\]\s+\.resource-activity-body\s*\{[\s\S]*?overflow:\s*visible;/u,
    );
    expect(styles).toMatch(
      /\.editor-layout\[data-shell-mode='portrait'\][\s\S]*?\.timeline-dock\s*\{[\s\S]*?overflow:\s*visible;/u,
    );
    expect(styles).toMatch(
      /\.editor-layout\[data-shell-mode='portrait'\]\s+>\s+\.bottom-workspace\[data-presentation='portrait'\]\s*\{[\s\S]*?overflow-y:\s*auto;/u,
    );
  });
});
