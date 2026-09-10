import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(path, 'utf8').replace(/\r\n/gu, '\n');
}

describe('Issue #456 Quick Action Drawer geometry contract', () => {
  const shell = source('src/renderer/shell/EditorShell.tsx');
  const styles = source('src/renderer/styles.css');
  const gate = source('scripts/verify-issue456-quick-action.cjs');

  it('keeps legitimate top surfaces in flow while mounting the drawer in the body overlay', () => {
    expect(shell).toContain(
      "data-top-region-layout={recoveryCandidate || isPortrait ? 'flow' : 'overlay'}",
    );
    expect(shell).toContain('data-testid="editor-top-region"');
    expect(shell).toContain('data-testid="editor-body"');
    expect(shell.indexOf('<CompactProjectBar')).toBeGreaterThan(
      shell.indexOf('data-testid="editor-body"'),
    );
    expect(shell.indexOf('<CompactProjectBar')).toBeLessThan(
      shell.indexOf('<LeftWorkspace'),
    );
    expect(shell).toContain('<RecoveryCandidateBanner');
    expect(shell).toContain('<AdaptiveWorkspaceSwitcher');
  });

  it('locks the overlay geometry so no normal-flow row or touch-target cavity remains', () => {
    expect(styles).toMatch(
      /\.editor-layout\s*\{[\s\S]*?position:\s*relative;/u,
    );
    expect(styles).toMatch(
      /\.editor-body\s*\{[\s\S]*?position:\s*relative;/u,
    );
    expect(styles).toMatch(
      /\.editor-layout\[data-top-region-layout='overlay'\]\s*\{[\s\S]*?grid-template-rows:\s*minmax\(0, 1fr\) auto;/u,
    );
    expect(styles).toMatch(
      /\.editor-layout\[data-top-region-layout='overlay'\]\s*>\s*\.editor-top-region\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?height:\s*0;[\s\S]*?pointer-events:\s*none;/u,
    );
    expect(styles).toMatch(
      /\.editor-body\s*>\s*\.quick-action-drawer\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?top:\s*0;[\s\S]*?left:\s*50%;/u,
    );
    expect(styles).toMatch(
      /\.quick-action-drawer\s*\{[\s\S]*?min-height:\s*0;/u,
    );
    expect(styles).toMatch(
      /\.quick-action-drawer\[data-expanded='false'\]\s*\.quick-action-drawer-surface\s*\{[\s\S]*?max-height:\s*0;[\s\S]*?padding-block:\s*0;[\s\S]*?border-width:\s*0;[\s\S]*?background:\s*transparent;/u,
    );
    expect(styles).toMatch(
      /\.quick-action-drawer\[data-expanded='false'\]\s*\.quick-action-drawer-handle\s*\{[\s\S]*?align-items:\s*flex-start;/u,
    );
    expect(styles).toMatch(
      /\.quick-action-drawer-handle\s*\{[\s\S]*?height:\s*var\(--ui-touch-icon\);[\s\S]*?min-height:\s*var\(--ui-touch-icon\);/u,
    );
    expect(styles).toContain(
      ".editor-layout[data-top-region-layout='flow'] > .editor-top-region",
    );
  });

  it('attaches a live dual-size Electron geometry gate', () => {
    expect(gate).toContain('1366, 768');
    expect(gate).toContain('1920, 1080');
    expect(gate).toContain('assertCanvasStable');
    expect(gate).toContain('Canvas top');
    expect(gate).toContain('Canvas height');
    expect(gate).toContain('topRegionLayout');
    expect(gate).toContain('clickPhysically');
    expect(gate).toContain('app.exit(exitCode)');
  });
});
