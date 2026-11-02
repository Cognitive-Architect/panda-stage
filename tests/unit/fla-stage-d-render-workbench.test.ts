import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readOrderedStylesheetSource } from '../helpers/read-stylesheet-source';

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

describe('Issue #775 C03 preserves the Stage D render contracts', () => {
  it('mounts both existing render runners inside one unified workbench', () => {
    expect(session).toContain('<FlaUnifiedWorkbench');
    expect(session).toContain('<FlaStaticSnapshotReview');
    expect(session).toContain('<FlaFrameSequenceReview');
    expect(session).toContain('presentation="unified-preview"');
    expect(session).toContain('onCandidatesChange={setSnapshotCandidates}');
    expect(session).toContain('onCandidatesChange={setSequenceCandidates}');
    expect(session).toContain('showUnifiedSequencePreview={showGeneratedSequencePreview}');
    expect(session).not.toContain('FlaRenderWorkbench');
    expect(session).not.toContain('fla-import-workbench-tabs');
    expect(session).not.toContain('fla-render-mode-tabs');
    expect(session).toContain('embedded');
  });

  it('keeps zero-raster routing and the project mutation boundary unchanged', () => {
    expect(route).toContain("'v2r-target-discovery'");
    expect(route).toContain("'v1-raster-review'");
    expect(session).toContain('createFlaWorkbenchCandidates({');
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
    expect(snapshot).toContain('{stage.width} × {stage.height}');
    expect(snapshot).not.toContain('{stage.frameRate}');
    expect(snapshot).toContain('data-testid="fla-snapshot-target-count"');
    expect(snapshot).not.toContain('data-testid="fla-snapshot-zero-raster"');
    expect(snapshot).not.toContain('data-testid="fla-snapshot-readonly-note"');
    expect(snapshot).not.toContain('fla-review-select-all');
    expect(snapshot).not.toContain('fla-review-clear-all');
  });

  it('scans authored candidates, revalidates selected previews, and keeps sequence rendering explicit', () => {
    expect(snapshot).toContain('includeAuthoredStates: true');
    expect(snapshot).toContain('setCandidatePreview');
    expect(snapshot).toContain('expectedPreview.sha256');
    expect(snapshot).toContain('flaStaticSnapshotClient.cancel');
    expect(sequence).toContain('embedded?: boolean');
    expect(sequence).toContain("presentation === 'unified-preview'");
    expect(sequence).toContain('生成连续画面');
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
    expect(snapshot).toContain('checkedCandidateKeys.has(flaUnifiedCandidateSelectionKey(candidate))');
    expect(snapshot).toContain('candidate?.checked ?? false');
  });

  it('uses one scrollable candidate grid and moves preview above it at narrow widths', () => {
    expect(styles).toContain('/* Issue #396: Stage D zero-raster render workbench.');
    expect(styles).toMatch(
      /\.fla-c03-workbench\s*\{[\s\S]*?grid-template-columns:\s*minmax\(300px, 0\.9fr\) minmax\(0, 1\.25fr\);/u,
    );
    expect(styles).toContain('.fla-c03-candidate-grid');
    expect(styles).toContain('.fla-c03-import-footer');
    expect(styles).toContain('order: -1;');
    expect(styles).toMatch(
      /\.fla-snapshot-preview-stage\s*\{[\s\S]*?overflow:\s*hidden;/u,
    );
    expect(styles).toMatch(
      /\.fla-snapshot-preview-stage img\s*\{[^}]*min-width:\s*0;[^}]*min-height:\s*0;[^}]*max-width:\s*100%;[^}]*max-height:\s*100%;/u,
    );
    expect(styles).toContain('object-fit: contain;');
  });
});
