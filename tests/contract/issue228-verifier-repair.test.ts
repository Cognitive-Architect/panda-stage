import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const verifier = readFileSync(resolve(root, 'scripts', 'verify-issue102-task2.cjs'), 'utf8');

describe('Issue #228 Task 2 verifier repair contract', () => {
  it('measures the original top-chrome reclamation without weakening its threshold', () => {
    expect(verifier).toContain(
      '(baseline.oldProjectArea?.height ?? 0) - (clean.topRegion?.height ?? 0)',
    );
    expect(verifier).toMatch(/reclaimedTopChrome\s*>=\s*140/u);
    expect(verifier).toMatch(/clean\.compactBar\.height\s*<=\s*56\.5/u);
    expect(verifier).toMatch(/clean\.topRegion\.height\s*<=\s*56\.5/u);
  });

  it('retains editor-body and BottomWorkspace geometry as diagnostics only', () => {
    expect(verifier).toContain("document.querySelector('[data-testid=\"bottom-workspace\"]')");
    expect(verifier).toContain('clean.editorBodyNetGainComparedWithOld = editorBodyNetGain');
    expect(verifier).not.toMatch(/assert\(\s*editorBodyNetGain/u);
  });

  it('provides an explicit negative-proof flag and exits Electron with the final code', () => {
    expect(verifier).toContain("process.argv.includes('--force-failure')");
    expect(verifier).toContain("assert(!forceFailure, 'Forced Issue #228 verifier failure.')");
    expect(verifier).toContain('app.exit(exitCode)');
    expect(verifier).not.toContain('app.quit()');
    expect(verifier).not.toMatch(/setTimeout\(\(\)\s*=>\s*process\.exit/u);
  });

  it('uses saved truth without requiring the removed saved-state pill', () => {
    expect(verifier).toContain('clean.saveState === null');
    expect(verifier).toContain("clean.saveStateCode === 'saved'");
    expect(verifier).toContain(
      `document.querySelector('[data-testid="project-save-state"]') === null`,
    );
    expect(verifier).toContain(
      `getAttribute('data-save-state') === 'saved'`,
    );
    expect(verifier).not.toContain("clean.saveState === '已保存'");
  });
});
