import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readSource(path: string): string {
  return readFileSync(path, 'utf8');
}

function count(source: string, pattern: RegExp): number {
  return source.match(pattern)?.length ?? 0;
}

describe('EditorShell Stage 2-B composition contract', () => {
  it('keeps App as one EditorShell product entry without the old long-page splice', () => {
    const app = readSource('src/renderer/App.tsx');

    expect(count(app, /<EditorShell/gu)).toBe(1);
    expect(app).not.toContain('beforeRecovery=');
    expect(app).not.toContain('afterRecovery=');
    expect(app).not.toContain('ActionPresetPanel');
    expect(app).not.toContain('HistoryControls');
    expect(app).not.toContain("features/canvas/CanvasStage");
    expect(app).toContain('debugSurface=');
    expect(app).toContain('gatePreview=');
  });

  it('builds one fixed top/body/bottom Grid with one real inspector', () => {
    const shell = readSource('src/renderer/shell/EditorShell.tsx');
    const left = readSource('src/renderer/shell/LeftWorkspace.tsx');
    const styles = readSource('src/renderer/styles.css');
    const bottom = readSource('src/renderer/shell/BottomWorkspace.tsx');

    for (const selector of [
      'data-testid="editor-layout"',
      'data-testid="editor-body"',
      '<RightInspector',
      '<BottomWorkspace',
    ]) {
      expect(shell).toContain(selector);
    }
    expect(shell.indexOf('<CompactProjectBar')).toBeLessThan(
      shell.indexOf('<LeftWorkspace'),
    );
    expect(shell).toContain('data-testid="editor-top-region"');
    expect(shell).not.toContain('<EditorTopBar');
    expect(shell).not.toContain('right-inspector-placeholder');
    expect(left).toContain('data-testid="left-workspace-scroll"');
    expect(styles).toMatch(
      /\.editor-layout\s*\{[\s\S]*?grid-template-rows:\s*auto minmax\(0, 1fr\) auto;/u,
    );
    expect(styles).toMatch(
      /\.editor-body\s*\{[\s\S]*?grid-template-columns:/u,
    );
    expect(bottom).toContain('data-testid="bottom-workspace"');
    expect(bottom).toContain('<HistoryControls');
    expect(styles).toMatch(
      /\.bottom-workspace\s*\{[\s\S]*?min-height:\s*52px;[\s\S]*?max-height:\s*76px;[\s\S]*?overflow:\s*hidden;/u,
    );
    expect(styles).toMatch(
      /\.bottom-workspace\s*>\s*\.history-controls\s*\{[\s\S]*?grid-template-columns:\s*auto minmax\(0, 1fr\) minmax\(0, 1\.3fr\);/u,
    );
    expect(styles).toMatch(
      /\.bottom-workspace\s*>\s*\.history-controls\s*\.history-actions\s*\{[\s\S]*?flex-wrap:\s*nowrap;/u,
    );
    expect(styles).toMatch(
      /\.bottom-workspace\s*>\s*\.history-controls\s*\{[\s\S]*?border:\s*0;[\s\S]*?background:\s*transparent;/u,
    );
    expect(styles).toMatch(
      /@media\s*\(max-width:\s*720px\)\s*\{[\s\S]*?\.bottom-workspace\s*>\s*\.history-controls\s*\{[\s\S]*?grid-template-areas:[\s\S]*?"heading actions"[\s\S]*?"status status";/u,
    );
    expect(styles).not.toMatch(
      /\.bottom-workspace\s*\{[^}]*overflow-y:\s*auto;/u,
    );
    expect(left).toContain('左侧工作区');
    expect(shell).toContain('右侧检查器');
    expect(bottom).toContain('aria-label="Bottom workspace"');
  });

  it('keeps Electron regression receipts attached to the live compact bottom owner', () => {
    const issue102Receipt = readSource('scripts/verify-issue102-task4.cjs');
    const issue109Receipt = readSource(
      'scripts/verify-issue109-resource-workspace.cjs',
    );
    const day24Receipt = readSource('scripts/verify-day24.cjs');

    for (const receipt of [issue102Receipt, issue109Receipt]) {
      expect(receipt).toContain(
        "bottom: box('[data-testid=\"bottom-workspace\"]')",
      );
      expect(receipt).toContain('assertCompactBottom');
      expect(receipt).toContain('scrollWidth <= sample.historyMetrics.clientWidth + 1');
      expect(receipt).toContain('app.exit(exitCode)');
      expect(receipt).not.toContain('bottom-workspace-placeholder');
    }
    expect(day24Receipt).toContain('.then(() => app.exit(0))');
    expect(day24Receipt).not.toContain('.then(() => app.quit())');
  });

  it('keeps CanvasWorkspace central and gates LegacyWorkspace behind a left compatibility entry', () => {
    const shell = readSource('src/renderer/shell/EditorShell.tsx');
    const left = readSource('src/renderer/shell/LeftWorkspace.tsx');
    const canvas = readSource('src/renderer/shell/CanvasWorkspace.tsx');
    const compatibility = readSource(
      'src/renderer/shell/LegacyCompatibilityActivity.tsx',
    );
    const dock = readSource(
      'src/renderer/shell/ResourceActivityDock.tsx',
    );
    const legacy = readSource('src/renderer/shell/LegacyWorkspace.tsx');
    const panel = readSource(
      'src/renderer/features/recovery/ProjectRecoveryPanel.tsx',
    );
    const styles = readSource('src/renderer/styles.css');

    expect(count(shell, /<CanvasWorkspace/gu)).toBe(1);
    expect(count(shell, /<LegacyWorkspace/gu)).toBe(0);
    expect(count(shell, /<LeftWorkspace/gu)).toBe(1);
    expect(left).toContain('data-testid="left-workspace-scroll"');
    expect(left).toContain('<ProjectRecoveryPanel');
    expect(left).toContain('<ResourceActivityDock');
    expect(left).toContain('<LegacyCompatibilityActivity');
    expect(compatibility).toContain(
      'data-testid="legacy-compatibility-activity"',
    );
    expect(compatibility).toContain(
      'data-testid="legacy-compatibility-toggle"',
    );
    expect(count(compatibility, /<LegacyWorkspace/gu)).toBe(1);
    expect(canvas).toContain('data-testid="canvas-workspace-scroll"');
    expect(count(canvas, /<CanvasStage/gu)).toBe(1);
    expect(legacy).toContain('className="legacy-workspace"');
    expect(legacy).toContain('data-testid="legacy-workspace-scroll"');
    expect(count(legacy, /data-testid="legacy-workspace-scroll"/gu)).toBe(1);
    expect(legacy).not.toContain('<ProjectRecoveryPanel');
    expect(legacy).toContain('<ActionPresetPanel');
    expect(count(legacy, /<CanvasStage/gu)).toBe(0);
    expect(panel).toContain('<RecentProjectsPanel');
    expect(panel).not.toContain('<AssetLibrary');
    expect(panel).not.toContain('<CharacterManager');
    expect(panel).not.toContain('<ShotManager');
    expect(panel).not.toContain('<CanvasStage');
    expect(dock).toContain('<ShotManager');
    expect(dock).toContain('<AssetLibrary');
    expect(dock).toContain('<CharacterManager');
    expect(dock).toContain('data-testid="resource-activity-panel"');
    expect(styles).toMatch(
      /\.left-workspace\s*\{[\s\S]*?overflow-y:\s*auto;/u,
    );
    expect(styles).toMatch(
      /\.left-workspace\s*\{[\s\S]*?overflow-x:\s*hidden;/u,
    );
    expect(styles).toMatch(
      /\.legacy-workspace\s*\{[\s\S]*?overflow-y:\s*auto;/u,
    );
    expect(styles).toMatch(
      /\.canvas-workspace\s*\{[\s\S]*?overflow-y:\s*auto;/u,
    );
  });

  it('locks the Stage 2-A resource activity cardinality and owner', () => {
    const left = readSource('src/renderer/shell/LeftWorkspace.tsx');
    const dock = readSource(
      'src/renderer/shell/ResourceActivityDock.tsx',
    );
    const panel = readSource(
      'src/renderer/features/recovery/ProjectRecoveryPanel.tsx',
    );

    expect(count(left, /data-testid="left-workspace-scroll"/gu)).toBe(1);
    expect(count(left, /<ProjectRecoveryPanel/gu)).toBe(1);
    expect(count(left, /<ResourceActivityDock/gu)).toBe(1);
    expect(count(dock, /<ShotManager/gu)).toBe(1);
    expect(count(dock, /<AssetLibrary/gu)).toBe(1);
    expect(count(dock, /<CharacterManager/gu)).toBe(1);
    expect(dock).toContain("useState<ResourceActivity>('shots')");
    expect(dock).not.toContain('display: none');
    expect(dock).not.toContain('hidden');
    expect(panel.match(/<RecentProjectsPanel/gu)).toHaveLength(1);
    expect(panel).not.toMatch(/<(?:ShotManager|AssetLibrary|CharacterManager|CanvasStage)/u);
  });

  it('keeps the compatibility tree absent by default without hiding a duplicate tree', () => {
    const shell = readSource('src/renderer/shell/EditorShell.tsx');
    const compatibility = readSource(
      'src/renderer/shell/LegacyCompatibilityActivity.tsx',
    );
    const styles = readSource('src/renderer/styles.css');

    expect(shell).not.toContain('CurrentNoProjectLegacySurface');
    expect(shell).toMatch(
      /page === 'project-center'[\s\S]*?<ProjectCenterScreen[\s\S]*?: projectSnapshot \?/u,
    );
    expect(shell).toContain('<CanvasWorkspace');
    expect(shell).not.toContain('<LegacyWorkspace');
    expect(compatibility).toContain('{active ? <LegacyWorkspace');
    expect(styles).not.toMatch(
      /\.legacy-workspace\s*\{[^}]*display:\s*none/u,
    );
  });

  it('keeps CanvasStage and HistoryControls unique in the central editor path', () => {
    const legacy = readSource('src/renderer/shell/LegacyWorkspace.tsx');
    const canvasWorkspace = readSource(
      'src/renderer/shell/CanvasWorkspace.tsx',
    );
    const panel = readSource(
      'src/renderer/features/recovery/ProjectRecoveryPanel.tsx',
    );
    const canvas = readSource(
      'src/renderer/features/canvas/CanvasStage.tsx',
    );
    const bottom = readSource('src/renderer/shell/BottomWorkspace.tsx');
    const shortcuts = readSource(
      'src/renderer/features/editor/useHistoryShortcuts.ts',
    );

    expect(count(legacy, /<CanvasStage/gu)).toBe(0);
    expect(count(canvasWorkspace, /<CanvasStage/gu)).toBe(1);
    expect(count(panel, /<CanvasStage/gu)).toBe(0);
    expect(count(canvasWorkspace + legacy + panel, /<CanvasStage/gu)).toBe(1);
    expect(legacy).not.toContain('<HistoryControls');
    expect(panel).not.toContain('<HistoryControls');
    expect(canvas).not.toContain('<HistoryControls');
    expect(count(bottom, /<HistoryControls/gu)).toBe(1);
    expect(count(shortcuts, /window\.addEventListener\(['"]keydown/gu)).toBe(1);
    expect(bottom).not.toMatch(/timeline|playhead|track/iu);
  });

  it('locks root scrolling and keeps debug and gateA as orthogonal overlays', () => {
    const shell = readSource('src/renderer/shell/EditorShell.tsx');
    const flags = readSource('src/renderer/shell/useDebugFlag.ts');
    const styles = readSource('src/renderer/styles.css');

    expect(styles).toMatch(
      /html,[\s\S]*?body,[\s\S]*?#root\s*\{[\s\S]*?height:\s*100%;[\s\S]*?min-height:\s*0;[\s\S]*?overflow:\s*hidden;/u,
    );
    expect(styles).toMatch(
      /\.editor-shell\s*\{[\s\S]*?height:\s*100vh;[\s\S]*?overflow:\s*hidden;/u,
    );
    expect(flags).toContain("parameters.get('debug') === '1'");
    expect(flags).toContain("parameters.get('gateA') === '1'");
    expect(flags).not.toContain('editorProjectStore');
    expect(flags).not.toContain('revision');
    expect(shell).toContain('data-testid="gate-preview-overlay"');
    expect(shell).toContain('data-testid="debug-probes"');
    expect(count(shell, /<CanvasWorkspace/gu)).toBe(1);
    expect(count(shell, /<LegacyWorkspace/gu)).toBe(0);
  });

  it('implements only the Stage 2-B central canvas migration', () => {
    const sources = [
      readSource('src/renderer/shell/EditorShell.tsx'),
      readSource('src/renderer/shell/CanvasWorkspace.tsx'),
      readSource('src/renderer/shell/BottomWorkspace.tsx'),
      readSource('src/renderer/shell/LegacyWorkspace.tsx'),
    ].join('\n');

    expect(sources).toContain('LeftWorkspace');
    expect(sources).toContain('CanvasWorkspace');
    expect(sources).toContain('BottomWorkspace');
    expect(sources).toContain('RightInspector');
    expect(sources).not.toContain('BottomHistory');
    expect(readSource('src/renderer/shell/LegacyWorkspace.tsx')).not.toContain(
      'CloseConfirmDialog',
    );
  });

  it('mounts the Stage 1B product preview overlay inside the editor layout only', () => {
    const shell = readSource('src/renderer/shell/EditorShell.tsx');
    const legacy = readSource('src/renderer/shell/LegacyWorkspace.tsx');
    const styles = readSource('src/renderer/styles.css');

    expect(count(shell, /<ProductPreviewOverlay/gu)).toBe(1);
    expect(legacy).not.toContain('ProductPreviewOverlay');
    // The overlay lives in the editor branch, never in the start screen.
    expect(shell.indexOf('<ProductPreviewOverlay')).toBeGreaterThan(
      shell.indexOf(': projectSnapshot ?'),
    );
    // It must not become a second permanent grid row.
    expect(styles).toMatch(
      /\.product-preview-overlay\s*\{[\s\S]*?position:\s*fixed;/u,
    );
    expect(styles).toMatch(
      /\.product-preview-overlay\s*\{[\s\S]*?inset:\s*0;/u,
    );
    // Grid contract from Stage 1A stays exactly three rows.
    expect(styles).toMatch(
      /\.editor-layout\s*\{[\s\S]*?grid-template-rows:\s*auto minmax\(0, 1fr\) auto;/u,
    );
  });

  it('mounts the Stage 1B close confirmation as a transient overlay only', () => {
    const shell = readSource('src/renderer/shell/EditorShell.tsx');
    const legacy = readSource('src/renderer/shell/LegacyWorkspace.tsx');
    const start = readSource('src/renderer/shell/StartScreen.tsx');
    const styles = readSource('src/renderer/styles.css');

    expect(count(shell, /<CloseConfirmDialog/gu)).toBe(1);
    expect(legacy).not.toContain('CloseConfirmDialog');
    expect(start).not.toContain('CloseConfirmDialog');
    // The dialog lives in the editor branch, never in the start screen.
    expect(shell.indexOf('<CloseConfirmDialog')).toBeGreaterThan(
      shell.indexOf(': projectSnapshot ?'),
    );
    // It is conditional, so it can never become a fourth grid row.
    expect(shell).toContain('{closeConfirmOpen ? (');
    expect(styles).toMatch(
      /\.close-confirm-overlay\s*\{[\s\S]*?position:\s*fixed;/u,
    );
    expect(styles).toMatch(
      /\.close-confirm-overlay\s*\{[\s\S]*?inset:\s*0;/u,
    );
    expect(styles).toMatch(
      /\.editor-layout\s*\{[\s\S]*?grid-template-rows:\s*auto minmax\(0, 1fr\) auto;/u,
    );
  });

  it('keeps Stage 2-C selector contracts on the visible owners', () => {
    const recent = readSource(
      'src/renderer/features/welcome/RecentProjectsPanel.tsx',
    );
    const shot = readSource('src/renderer/features/shots/ShotManager.tsx');
    const asset = readSource('src/renderer/features/assets/AssetLibrary.tsx');
    const character = readSource(
      'src/renderer/features/characters/CharacterManager.tsx',
    );
    const dock = readSource('src/renderer/shell/ResourceActivityDock.tsx');
    const compatibility = readSource(
      'src/renderer/shell/LegacyCompatibilityActivity.tsx',
    );

    for (const selector of [
      'data-testid="recent-projects-list"',
      'data-testid="recent-projects-path"',
      'data-testid="recent-projects-actions"',
      'data-testid="recent-projects-status"',
    ]) {
      expect(recent).toContain(selector);
    }
    expect(recent).toContain(
      'className="recent-projects-path recent-project-path"',
    );
    expect(recent).toContain(
      'className="recent-projects-actions recent-project-actions"',
    );
    expect(shot).toContain('data-testid="shot-manager"');
    expect(asset).toContain('data-testid="asset-library"');
    expect(character).toContain('data-testid="character-manager"');
    expect(dock.match(/<ShotManager/gu)).toHaveLength(1);
    expect(dock.match(/<AssetLibrary/gu)).toHaveLength(1);
    expect(dock.match(/<CharacterManager/gu)).toHaveLength(1);
    expect(compatibility).toContain('{active ? <LegacyWorkspace');
    expect(compatibility).not.toContain('display: none');
  });
});
