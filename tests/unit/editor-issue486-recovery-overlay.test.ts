import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(path, 'utf8').replace(/\r\n/gu, '\n');
}

describe('Issue #486 recovery overlay contract', () => {
  const shell = source('src/renderer/shell/EditorShell.tsx');
  const banner = source('src/renderer/shell/RecoveryCandidateBanner.tsx');
  const drawer = source('src/renderer/shell/CompactProjectBar.tsx');
  const styles = source('src/renderer/styles.css');

  it('makes the dedicated Recovery Card the only recovery announcement owner', () => {
    expect(shell).not.toContain('检测到未保存的恢复内容');
    expect(shell).toContain(
      "setStatus(nextSession.recoveryCandidate ? '' : cleanStatus);",
    );
    expect(banner).toContain('role="alert"');
    expect(drawer).toContain('statusText');
    expect(drawer).toContain('data-testid="editor-action-status"');
  });

  it('keeps recovery in the landscape overlay without changing portrait flow', () => {
    expect(shell).toContain(
      "data-top-region-layout={isPortrait ? 'flow' : 'overlay'}",
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
      /\.editor-layout\[data-top-region-layout='overlay'\]\s*>\s*\.editor-top-region\s*>\s*\.recovery-prompt\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?top:\s*52px;[\s\S]*?left:\s*50%;[\s\S]*?pointer-events:\s*auto;/u,
    );
  });

  it('offsets the floating card only when the Quick Action Drawer is expanded', () => {
    expect(styles).toMatch(
      /\.editor-layout\[data-top-region-layout='overlay'\]:has\([\s\S]*?quick-action-drawer\[data-expanded='true'\][\s\S]*?\.recovery-prompt\s*\{[\s\S]*?top:\s*116px;/u,
    );
    expect(styles).toContain('transform: translateX(-50%);');
    expect(styles).toContain('display: flex;');
    expect(styles).toContain("content: '·';");
    expect(banner).toContain('发现可恢复内容');
    expect(banner).toContain('onClick={() => void onRestore()}');
    expect(banner).toContain('onClick={() => void onIgnore()}');
    expect(banner).toContain('className="recovery-details-content"');
  });
});
