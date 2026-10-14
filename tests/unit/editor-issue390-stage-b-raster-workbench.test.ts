import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const session = readFileSync('src/renderer/fla-import/FlaCompatibilityReviewSession.tsx', 'utf8');
const unified = readFileSync('src/renderer/fla-import/FlaUnifiedWorkbench.tsx', 'utf8');
const importFlow = readFileSync('src/renderer/fla-import/fla-unified-import.ts', 'utf8');
const styles = readFileSync('src/renderer/styles/features/fla-import/c03-unified-workbench.css', 'utf8');

describe('Issue #390 raster candidates in the Issue #775 unified workbench', () => {
  it('keeps raster candidates in the single scrollable list beside one preview and footer', () => {
    expect(session).toContain('<FlaUnifiedWorkbench');
    expect(unified).toContain('className="fla-c03-browser"');
    expect(unified).toContain('data-testid="fla-c03-candidate-grid"');
    expect(unified).toContain('className="fla-c03-preview"');
    expect(unified).toContain('data-testid="fla-c03-import-footer"');
    expect(styles).toMatch(/\.fla-c03-candidate-grid\s*\{[\s\S]*?overflow:\s*auto;/u);
    expect(styles).toMatch(/\.fla-c03-workbench\s*\{[\s\S]*?grid-template-columns:\s*minmax\(300px, 0\.9fr\) minmax\(0, 1\.25fr\);/u);
    expect(unified).not.toContain('data-testid="fla-raster-overview"');
    expect(unified).not.toContain('data-testid="fla-raster-detail"');
  });

  it('keeps preview focus separate from explicit checkbox selection', () => {
    expect(unified).toContain('onClick={() => onFocusCandidate(candidate)}');
    expect(unified).toContain('onChange={(event) => onToggleCandidate(candidate, event.currentTarget.checked)}');
    expect(unified).toContain('aria-pressed={candidate.identityKey === focusedCandidateIdentityKey}');
    expect(unified).toContain('disabled={!candidate.selectable || locked}');
    expect(unified).not.toContain('onClickCapture');
    expect(unified).not.toContain('media.sourceReference');
  });

  it('uses the existing import boundary and does not mutate the renderer project directly', () => {
    expect(session).toContain('runFlaUnifiedImport({');
    expect(session).toContain('window.pandaStage.fla.commitSelected({');
    expect(session).toContain('confirmed: true');
    expect(importFlow).toContain("item.status === 'duplicate'");
    expect(importFlow).toContain('status: \'not-attempted\'');
    expect(session).not.toContain('updateProject');
    expect(session).not.toContain('window.pandaStage.assets');
    expect(unified).not.toContain('data-testid="fla-review-confirm"');
  });
});
