import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const shell = readFileSync(
  'src/renderer/fla-import/FlaRenderWorkbench.tsx',
  'utf8',
);
const session = readFileSync(
  'src/renderer/fla-import/FlaCompatibilityReviewSession.tsx',
  'utf8',
);
const snapshot = readFileSync(
  'src/renderer/fla-import/FlaStaticSnapshotReview.tsx',
  'utf8',
);
const sequence = readFileSync(
  'src/renderer/fla-import/FlaFrameSequenceReview.tsx',
  'utf8',
);
const route = readFileSync(
  'src/renderer/fla-import/fla-content-route.ts',
  'utf8',
);
const styles = readFileSync('src/renderer/styles.css', 'utf8');

describe('Issue #396 Stage D render workbench contract', () => {
  it('provides one shared shell with mutually exclusive R1/R2 modes', () => {
    expect(shell).toContain('data-testid="fla-render-workbench"');
    expect(shell).toContain('data-testid="fla-render-mode-tabs"');
    expect(shell).toContain('data-testid="fla-render-mode-snapshot"');
    expect(shell).toContain('data-testid="fla-render-mode-sequence"');
    expect(shell).toContain('role="tablist"');
    expect(shell).toContain('role="tabpanel"');
    expect(session).toContain("renderMode === 'snapshot'");
    expect(session).toContain('<FlaStaticSnapshotReview');
    expect(session).toContain('<FlaFrameSequenceReview');
    expect(session).toContain('embedded');
  });

  it('keeps zero-raster routing and the project mutation boundary unchanged', () => {
    expect(route).toContain("'v2r-target-discovery'");
    expect(session).toContain('routeFlaInspection(response)');
    expect(session).toContain("contentRoute === 'v1-raster-review'");
    expect(snapshot).not.toContain('window.pandaStage.assets');
    expect(snapshot).not.toContain('updateProject');
    expect(snapshot).toContain('confirmedPreviewRequestId');
  });

  it('renders the Stage D source, preview, details, and action regions', () => {
    for (const testId of [
      'fla-snapshot-source-region',
      'fla-snapshot-targets',
      'fla-snapshot-preview-region',
      'fla-snapshot-preview-area',
      'fla-snapshot-details-region',
      'fla-snapshot-action-bar',
      'fla-snapshot-preview',
    ]) {
      expect(snapshot).toContain(`data-testid="${testId}"`);
    }
    expect(snapshot).toContain('ImageAsset');
    expect(snapshot).toContain('data-testid="fla-snapshot-source-facts"');
    expect(snapshot).toContain('data-testid="fla-snapshot-target-count"');
    expect(snapshot).not.toContain('data-testid="fla-snapshot-zero-raster"');
    expect(snapshot).not.toContain('data-testid="fla-snapshot-readonly-note"');
    expect(snapshot).not.toContain('fla-review-select-all');
    expect(snapshot).not.toContain('fla-review-clear-all');
  });

  it('invalidates preview candidates on target/frame changes and keeps R2 as the owner', () => {
    expect(snapshot).toContain('previewIsCurrent');
    expect(snapshot).toContain('setPreview(null)');
    expect(snapshot).toContain('flaStaticSnapshotClient.cancel');
    expect(snapshot).toContain('targetSelectedFrameIndex === selectedFrameIndex');
    expect(sequence).toContain('embedded?: boolean');
    expect(sequence).toContain("'fla-frame-sequence-review fla-render-workbench-panel'");
    expect(sequence).toContain('flaFrameSequenceClient');
  });

  it('uses a three-zone layout without adding a second scroll owner', () => {
    expect(styles).toContain('/* Issue #396: Stage D zero-raster render workbench.');
    expect(styles).toMatch(
      /\.fla-snapshot-workbench\s*\{[\s\S]*?grid-template-columns:\s*minmax\(230px, 0\.86fr\) minmax\(420px, 1\.7fr\) minmax\(230px, 0\.84fr\);/u,
    );
    expect(styles).toContain('.fla-snapshot-preview-stage');
    expect(styles).toContain('.fla-snapshot-action-bar');
    expect(styles).toMatch(
      /\.fla-snapshot-preview-stage\s*\{[\s\S]*?overflow:\s*hidden;/u,
    );
  });
});
