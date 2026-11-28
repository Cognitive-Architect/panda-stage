import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readOrderedStylesheetSource } from '../helpers/read-stylesheet-source';

function source(path: string): string {
  if (path === 'src/renderer/styles.css') return readOrderedStylesheetSource();
  return readFileSync(path, 'utf8').replace(/\r\n/gu, '\n');
}

describe('Workbench command bar geometry contract', () => {
  const shell = source('src/renderer/shell/EditorShell.tsx');
  const styles = source('src/renderer/styles/shell/layout/editor-workbench.css');
  const gate = source('scripts/verify-reshell-r01.cjs');

  it('keeps the project bar above the workbench panels and recovery in its own surface', () => {
    expect(shell).toContain(
      'data-top-region-layout="flow"',
    );
    expect(shell).not.toContain(
      "data-top-region-layout={recoveryCandidate || isPortrait ? 'flow' : 'overlay'}",
    );
    expect(shell).toContain('data-testid="editor-top-region"');
    expect(shell).toContain('data-testid="editor-body"');
    expect(shell.indexOf('<WorkbenchCommandBar')).toBeGreaterThan(
      shell.indexOf('data-testid="editor-body"'),
    );
    expect(shell.indexOf('<WorkbenchCommandBar')).toBeLessThan(
      shell.indexOf('<LeftWorkspace'),
    );
    expect(shell).toContain('<RecoveryCandidateBanner');
    expect(shell).toContain('<EditorWorkbench');
  });

  it('reserves a two-row header height and keeps dock content flexible', () => {
    expect(styles).toMatch(/\.editor-workbench \.workbench-body\s*\{[^}]*grid-template-rows: auto minmax\(0, 1fr\)/u);
    expect(styles).toContain('.workbench-menu-bar, .workbench-command-row');
    expect(styles).not.toContain('.quick-action-drawer');
  });

  it('uses the selected export format for the idle action name and tooltip', () => {
    const bar = source('src/renderer/shell/WorkbenchCommandBar.tsx');
    expect(bar).toContain("exportPreferences?.format ?? 'mp4'");
    expect(bar).toMatch(/mp4: '导出视频',[\s\S]*?'png-sequence': '导出 PNG 序列',[\s\S]*?'sprite-sheet': '导出精灵图'/u);
    expect(bar).toContain("exportBusy || exportOpen ? '显示导出任务'");
    expect(bar).toContain('title={exportLabel}');
    expect(bar).toContain(' />{exportLabel}');
  });

  it('attaches a live dual-size Electron geometry gate', () => {
    expect(gate).toContain('win.setSize(930, 700)');
    expect(gate).toContain('narrow workbench keeps export inside the command bar');
    expect(gate).toContain('app.exit(0)');
  });
});
