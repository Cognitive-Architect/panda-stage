import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readOrderedStylesheetSource } from '../helpers/read-stylesheet-source';

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
const styles = readOrderedStylesheetSource();
const previewTransaction = readFileSync(
  'src/renderer/fla-import/fla-static-snapshot-preview-transaction.ts',
  'utf8',
);

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
      'fla-snapshot-preview-image',
    ]) {
      expect(snapshot).toContain(`data-testid="${testId}"`);
    }
    expect(snapshot).toContain('fla-snapshot-candidates');
    expect(snapshot).toContain('data-testid="fla-snapshot-source-facts"');
    expect(snapshot).toContain('data-testid="fla-snapshot-target-count"');
    expect(snapshot).not.toContain('data-testid="fla-snapshot-zero-raster"');
    expect(snapshot).not.toContain('data-testid="fla-snapshot-readonly-note"');
    expect(snapshot).not.toContain('fla-review-select-all');
    expect(snapshot).not.toContain('fla-review-clear-all');
  });

  it('scans authored candidates, revalidates selected previews, and keeps sequence rendering in R2', () => {
    expect(snapshot).toContain('includeAuthoredStates: true');
    expect(snapshot).toContain('setCandidatePreview');
    expect(snapshot).toContain('expectedPreview.sha256');
    expect(snapshot).toContain('flaStaticSnapshotClient.cancel');
    expect(sequence).toContain('embedded?: boolean');
    expect(sequence).toContain("'fla-frame-sequence-review fla-render-workbench-panel'");
    expect(sequence).toContain('flaFrameSequenceClient');
  });

  it('keeps list thumbnails bounded while the focused preview uses full PNG bytes', () => {
    expect(snapshot).toContain('maxSide = 160');
    expect(snapshot).toContain('createCandidateThumbnailUrl(outcome.response.bytes)');
    expect(snapshot).toContain('createCandidateFullSizeUrl(response.bytes)');
    expect(snapshot).toContain('data-preview-resolution="full"');
    expect(snapshot).toContain('focusedCandidateIdentityKeyRef.current !== identityKey');
    expect(snapshot).toContain('URL.revokeObjectURL(fullSizePreview.url)');
    expect(snapshot).not.toContain('预览去重');
    expect(snapshot).not.toContain('sha256.slice(0, 12)');
    expect(snapshot).toContain('runFlaStaticSnapshotPreviewTransaction');
    expect(previewTransaction).toContain('class FlaStaticSnapshotPreviewQueue');
  });

  it('keeps preview focus inside the visible candidate filter and clears unmatched search state', () => {
    expect(snapshot).toContain('reconcileFlaWorkbenchFocus');
    expect(snapshot).toContain('focusedCandidateIdentityKeyRef.current = effectiveFocusedCandidateIdentityKey');
    expect(snapshot).toContain('focusedPreview?.key === effectiveFocusedCandidateIdentityKey');
    expect(snapshot).toContain('data-focused={focused ?');
    expect(snapshot).toContain('当前筛选无可预览素材');
    expect(snapshot).toContain('candidateSelection.checkedCandidateIds');
    expect(snapshot).toContain('candidate?.checked ?? false');
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
    expect(styles).toMatch(
      /\.fla-snapshot-preview-stage img\s*\{[^}]*min-width:\s*0;[^}]*min-height:\s*0;[^}]*max-width:\s*100%;[^}]*max-height:\s*100%;/u,
    );
    expect(styles).toContain('object-fit: contain;');
  });
});
