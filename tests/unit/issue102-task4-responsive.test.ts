import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readSource(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('Issue 102 Task 4 responsive contract', () => {
  it('defines the narrow cloud-PC layout and contained menu contract', () => {
    const styles = readSource('src/renderer/styles.css');

    expect(styles).toContain('.task4-hit-target');
    expect(styles).toContain('max-width: min(320px, calc(100vw - 24px));');
    expect(styles).toContain('@media (max-width: 1100px)');
    expect(styles).toMatch(
      /\.editor-body\s*\{[\s\S]*?grid-template-columns:[\s\S]*?minmax\(210px, 240px\)[\s\S]*?minmax\(140px, 160px\)/u,
    );
  });

  it('marks every Task 4 primary path surface as a measurable hit target', () => {
    const sources = [
      readSource('src/renderer/shell/NewProjectEntry.tsx'),
      readSource('src/renderer/shell/StartScreen.tsx'),
      readSource('src/renderer/features/welcome/RecentProjectsPanel.tsx'),
      readSource('src/renderer/shell/RecoveryCandidateBanner.tsx'),
      readSource('src/renderer/shell/CompactProjectBar.tsx'),
      readSource('src/renderer/shell/NewProjectDialog.tsx'),
      readSource('src/renderer/shell/CloseConfirmDialog.tsx'),
      readSource('src/renderer/shell/ProductPreviewOverlay.tsx'),
    ].join('\n');

    for (const target of [
      'new-project',
      'open-project',
      'recent-open',
      'recovery-restore',
      'project-center',
      'save-project',
      'product-preview',
      'close-project',
      'close-save',
    ]) {
      expect(sources).toContain(`data-task4-core="${target}"`);
    }
  });
});
