import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readSource(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('EditorShell Stage 1A-4 composition contract', () => {
  it('orders the editor top bar before the legacy presenter', () => {
    const shell = readSource('src/renderer/shell/EditorShell.tsx');

    expect(shell.indexOf('<EditorTopBar')).toBeGreaterThan(-1);
    expect(shell.indexOf('<ProjectRecoveryPanel')).toBeGreaterThan(
      shell.indexOf('<EditorTopBar'),
    );
    expect(shell).toContain('<RecoveryCandidateBanner');
    expect(shell).toContain('recoveryBanner=');
  });

  it('keeps formal editor controls in TopBar and legacy modules in the presenter', () => {
    const topBar = readSource('src/renderer/shell/EditorTopBar.tsx');
    const legacyPanel = readSource(
      'src/renderer/features/recovery/ProjectRecoveryPanel.tsx',
    );

    for (const selector of [
      'data-testid="editor-top-bar"',
      'id="recovery-heading"',
      'className="recovery-open-row"',
      'className="recovery-status-row"',
      'className="editor-save-button"',
    ]) {
      expect(topBar).toContain(selector);
      expect(legacyPanel).not.toContain(selector);
    }

    for (const component of [
      'RecentProjectsPanel',
      'AssetLibrary',
      'CharacterManager',
      'ShotManager',
      'CanvasStage',
    ]) {
      expect(legacyPanel).toContain(`<${component}`);
      expect(topBar).not.toContain(component);
    }
  });

  it('does not start the Stage 1A-5 grid or LegacyWorkspace implementation', () => {
    const sources = [
      readSource('src/renderer/shell/EditorShell.tsx'),
      readSource('src/renderer/shell/EditorTopBar.tsx'),
      readSource(
        'src/renderer/features/recovery/ProjectRecoveryPanel.tsx',
      ),
    ].join('\n');

    expect(sources).not.toContain('<LegacyWorkspace');
    expect(sources).not.toContain('legacy-workspace-scroll');
    expect(sources).not.toContain('grid-template');
  });
});
