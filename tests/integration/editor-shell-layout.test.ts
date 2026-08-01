import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readSource(path: string): string {
  return readFileSync(path, 'utf8');
}

function count(source: string, pattern: RegExp): number {
  return source.match(pattern)?.length ?? 0;
}

describe('EditorShell Stage 1A-5 composition contract', () => {
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

  it('builds one fixed top/body/bottom Grid with visible placeholders', () => {
    const shell = readSource('src/renderer/shell/EditorShell.tsx');
    const styles = readSource('src/renderer/styles.css');

    for (const selector of [
      'data-testid="editor-layout"',
      'data-testid="editor-body"',
      'data-testid="left-workspace-placeholder"',
      'data-testid="right-inspector-placeholder"',
      'data-testid="bottom-workspace-placeholder"',
    ]) {
      expect(shell).toContain(selector);
    }
    expect(shell.indexOf('<EditorTopBar')).toBeLessThan(
      shell.indexOf('<LegacyWorkspace'),
    );
    expect(styles).toMatch(
      /\.editor-layout\s*\{[\s\S]*?grid-template-rows:\s*auto minmax\(0, 1fr\) auto;/u,
    );
    expect(styles).toMatch(
      /\.editor-body\s*\{[\s\S]*?grid-template-columns:/u,
    );
    expect(shell).toContain('左侧工作区');
    expect(shell).toContain('右侧检查器');
    expect(shell).toContain('底部工作区');
  });

  it('uses LegacyWorkspace as the only editor old-tree entry and nested scroller', () => {
    const shell = readSource('src/renderer/shell/EditorShell.tsx');
    const legacy = readSource('src/renderer/shell/LegacyWorkspace.tsx');
    const panel = readSource(
      'src/renderer/features/recovery/ProjectRecoveryPanel.tsx',
    );
    const styles = readSource('src/renderer/styles.css');

    expect(count(shell, /<LegacyWorkspace/gu)).toBe(1);
    expect(shell).not.toContain('<ProjectRecoveryPanel');
    expect(legacy).toContain('className="legacy-workspace"');
    expect(legacy).toContain('data-testid="legacy-workspace-scroll"');
    expect(count(legacy, /data-testid="legacy-workspace-scroll"/gu)).toBe(1);
    expect(count(legacy, /<ProjectRecoveryPanel/gu)).toBe(1);
    expect(legacy).toContain('<ActionPresetPanel');
    expect(panel).toContain('<RecentProjectsPanel');
    expect(panel).toContain('<AssetLibrary');
    expect(panel).toContain('<CharacterManager');
    expect(panel).toContain('<ShotManager');
    expect(styles).toMatch(
      /\.legacy-workspace\s*\{[\s\S]*?overflow-y:\s*auto;/u,
    );
    expect(styles).toMatch(
      /\.legacy-workspace\s*\{[\s\S]*?overflow-x:\s*hidden;/u,
    );
  });

  it('removes the no-project legacy transition without hiding a duplicate tree', () => {
    const shell = readSource('src/renderer/shell/EditorShell.tsx');
    const styles = readSource('src/renderer/styles.css');

    expect(shell).not.toContain('CurrentNoProjectLegacySurface');
    expect(shell).toMatch(
      /sessionRegion === 'start-screen'[\s\S]*?<StartScreen[\s\S]*?: projectSnapshot \?/u,
    );
    expect(shell.indexOf('<LegacyWorkspace')).toBeGreaterThan(
      shell.indexOf(': projectSnapshot ?'),
    );
    expect(styles).not.toMatch(
      /\.legacy-workspace\s*\{[\s\S]*?display:\s*none/u,
    );
  });

  it('keeps CanvasStage and HistoryControls at the authorized two-instance runtime baseline', () => {
    const legacy = readSource('src/renderer/shell/LegacyWorkspace.tsx');
    const panel = readSource(
      'src/renderer/features/recovery/ProjectRecoveryPanel.tsx',
    );
    const canvas = readSource(
      'src/renderer/features/canvas/CanvasStage.tsx',
    );

    expect(count(legacy, /<CanvasStage/gu)).toBe(1);
    expect(count(panel, /<CanvasStage/gu)).toBe(1);
    expect(count(legacy + panel, /<CanvasStage/gu)).toBe(2);
    expect(legacy).not.toContain('<HistoryControls');
    expect(panel).not.toContain('<HistoryControls');
    expect(count(canvas, /<HistoryControls/gu)).toBe(1);
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
    expect(count(shell, /<LegacyWorkspace/gu)).toBe(1);
  });

  it('does not implement later-stage workspace migrations', () => {
    const sources = [
      readSource('src/renderer/shell/EditorShell.tsx'),
      readSource('src/renderer/shell/LegacyWorkspace.tsx'),
    ].join('\n');

    expect(sources).not.toContain('LeftWorkspace');
    expect(sources).not.toContain('CanvasWorkspace');
    expect(sources).not.toContain('RightInspector');
    expect(sources).not.toContain('BottomHistory');
    expect(sources).not.toContain('CloseConfirmDialog');
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
});
