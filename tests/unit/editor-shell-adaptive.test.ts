import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  EDITOR_DEVICE_MODE_OPTIONS,
  getEditorShellLayoutMode,
  reconcileEditorWorkspace,
  type EditorWorkspace,
} from '../../src/renderer/shell/adaptiveEditorShell';

function readSource(path: string): string {
  return readFileSync(path, 'utf8').replace(/\r\n/gu, '\n');
}

describe('UI-M2 adaptive EditorShell state', () => {
  it('keeps Auto deterministic and preserves its existing width heuristic', () => {
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

    expect(
      getEditorShellLayoutMode({ width: 1_024, height: 720 }, 'auto'),
    ).toBe(getEditorShellLayoutMode({ width: 1_024, height: 720 }, 'auto'));
  });

  it('gives explicit Desktop and Cloud Touch modes precedence over Auto', () => {
    expect(EDITOR_DEVICE_MODE_OPTIONS.map((option) => option.value)).toEqual([
      'auto',
      'desktop',
      'cloud-touch',
    ]);

    expect(
      getEditorShellLayoutMode(
        { width: 720, height: 1_280 },
        'desktop',
      ),
    ).toBe('desktop');
    expect(
      getEditorShellLayoutMode(
        { width: 1_280, height: 720 },
        'desktop',
      ),
    ).toBe('desktop');

    expect(
      getEditorShellLayoutMode(
        { width: 1_280, height: 720 },
        'cloud-touch',
      ),
    ).toBe('landscape');
    expect(
      getEditorShellLayoutMode(
        { width: 720, height: 1_280 },
        'cloud-touch',
      ),
    ).toBe('portrait');
    expect(
      getEditorShellLayoutMode(
        { width: 1_101, height: 720 },
        'cloud-touch',
      ),
    ).toBe('landscape');
    expect(
      getEditorShellLayoutMode(
        { width: 1_100, height: 720 },
        'cloud-touch',
      ),
    ).toBe('landscape');
  });

  it('preserves a legal workspace through an orientation round-trip', () => {
    const workspaces: readonly EditorWorkspace[] = [
      'canvas',
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
    const bar = readSource('src/renderer/shell/CompactProjectBar.tsx');
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
    expect(shell).toContain("useState<EditorDeviceMode>('auto')");
    expect(shell).toContain('data-editor-device-mode={deviceMode}');
    expect(shell).toContain('onDeviceModeChange={setDeviceMode}');
    expect(shell).toContain('data-active-workspace=');
    expect(shell).toContain('data-portrait-surface={portraitContextSurface}');
    expect(shell).not.toContain('portrait-canvas-context-actions');
    expect(shell).toContain(
      "setPortraitCanvasSurface(workspace === 'canvas' ? 'shots' : 'none')",
    );
    expect(shell).toContain(
      '<CanvasWorkspace\n                showHeading={false}\n                showToolbar={canvasToolbarVisible}',
    );
    expect(shell).toContain('hidden={isPortrait');
    expect(shell).toContain('aria-hidden={');
    expect(bar).toContain('EDITOR_DEVICE_MODE_OPTIONS');
    expect(bar).toContain('role="menuitemradio"');
    expect(bar).toContain('aria-checked={deviceMode === option.value}');
    expect(bar).toContain('data-testid="editor-device-mode-selector"');

    for (const workspace of [
      '画布',
      '素材',
      '属性',
      '时间轴',
    ]) {
      expect(switcher).toContain(`label: '${workspace}'`);
    }
    expect(switcher).not.toContain("label: 'Shots'");
    expect(adaptive).not.toContain("'shots' |");
    expect(switcher).toContain('<SegmentedTabs');
    expect(readSource('src/renderer/ui/SegmentedTabs.tsx')).toContain(
      'role="tablist"',
    );
    expect(adaptive).toContain('useSyncExternalStore');

    expect(left).toContain('shellMode?: EditorShellLayoutMode');
    expect(left).toContain('drawerOpen?: boolean');
    expect(left).toContain('onActiveActivityChange');
    expect(inspector).toContain('shellMode?: EditorShellLayoutMode');
    expect(inspector).toContain('compact?: boolean');
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

    const shell = readSource('src/renderer/shell/EditorShell.tsx');
    expect(shell).toContain('presentation/session state only');
    expect(shell).not.toContain('localStorage');
    expect(shell).not.toContain('sessionStorage');
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
    expect(styles).toMatch(
      /\.editor-layout\[data-shell-mode='portrait'\]\[data-active-workspace='timeline'\]\s*\{[\s\S]*?overflow-y:\s*auto;/u,
    );
    expect(styles).toMatch(
      /\.editor-body\[data-shell-mode='portrait'\]\[data-active-workspace='timeline'\]\s*\{[\s\S]*?visibility:\s*visible;[\s\S]*?pointer-events:\s*auto;/u,
    );
    expect(styles).toContain(
      "grid-template-columns: repeat(4, minmax(88px, 1fr));",
    );
  });
});
