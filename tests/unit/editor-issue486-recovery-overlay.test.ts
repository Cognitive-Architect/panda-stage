import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readOrderedStylesheetSource } from '../helpers/read-stylesheet-source';

function source(path: string): string {
  if (path === 'src/renderer/styles.css') return readOrderedStylesheetSource();
  return readFileSync(path, 'utf8').replace(/\r\n/gu, '\n');
}

describe('Issue #486 recovery overlay contract', () => {
  const shell = source('src/renderer/shell/EditorShell.tsx');
  const banner = source('src/renderer/shell/RecoveryCandidateBanner.tsx');
  const drawer = source('src/renderer/shell/WorkbenchCommandBar.tsx');
  const styles = source('src/renderer/styles.css');

  it('makes the dedicated Recovery Card the only recovery announcement owner', () => {
    expect(shell).not.toContain('检测到未保存的恢复内容');
    expect(shell).toContain(
      "setStatus(nextSession.recoveryCandidate ? '' : cleanStatus);",
    );
    expect(banner).toContain('role="alert"');
    expect(drawer).toContain('feedback');
    expect(drawer).toContain('data-testid="editor-action-status"');
  });

  it('gives the workbench recovery feedback its own top region', () => {
    expect(shell).toContain(
      'data-top-region-layout="flow"',
    );
    expect(shell).not.toContain(
      "data-top-region-layout={recoveryCandidate || isPortrait ? 'flow' : 'overlay'}",
    );
    expect(styles).toMatch(
      /\.editor-layout\[data-top-region-layout='overlay'\]\s*\{[\s\S]*?grid-template-rows:\s*minmax\(0, 1fr\) auto;/u,
    );
    expect(styles).toMatch(
      /\.editor-layout\[data-top-region-layout='overlay'\]\s*>\s*\.editor-top-region\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?height:\s*0;[\s\S]*?overflow:\s*visible;/u,
    );
    expect(styles).toMatch(
      /\.editor-layout\[data-top-region-layout='overlay'\]\s*>\s*\.editor-top-region\s*>\s*\.recovery-prompt\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?top:\s*64px;[\s\S]*?left:\s*50%;[\s\S]*?pointer-events:\s*auto;/u,
    );
  });

  it('keeps the recovery card visible and actionable from the flow region', () => {
    expect(styles).not.toContain('.quick-action-drawer');
    expect(styles).toContain('transform: translateX(-50%);');
    expect(styles).toContain('display: flex;');
    expect(styles).toContain("content: '·';");
    expect(banner).toContain('发现可恢复内容');
    expect(banner).toContain('onClick={() => void onRestore()}');
    expect(banner).toContain('onClick={() => void onIgnore()}');
    expect(banner).toContain('className="recovery-details-content"');
  });
});
