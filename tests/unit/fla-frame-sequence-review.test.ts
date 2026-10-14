import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FlaFrameSequenceReview } from '../../src/renderer/fla-import/FlaFrameSequenceReview';

const noop = () => {};
const sequenceReviewProps = () => ({
  sessionId: '00000000-0000-4000-8000-000000000001',
  source: { basename: 'x.fla', sha256: 'a'.repeat(64) },
  snapshot: null,
  checkedCandidateKeys: new Set<string>(),
  importLocked: false,
  onToggleCandidate: noop,
  onReconcileCandidates: noop,
  onRegisterImportRunner: noop,
  onImported: noop,
});

describe('R2-H.2 component mounts (static render)', () => {
  it('renders the review root without throwing in the loading phase', () => {
    const html = renderToStaticMarkup(
      createElement(FlaFrameSequenceReview, sequenceReviewProps()),
    );
    expect(html).toContain('data-testid="fla-frame-sequence-review"');
    expect(html).toContain('fla-frame-sequence-loading');
  });
});

describe('R2-H.2 shares the compatibility review render workbench (zero-raster path)', () => {
  const session = readFileSync(
    'src/renderer/fla-import/FlaCompatibilityReviewSession.tsx',
    'utf8',
  );
  const review = readFileSync('src/renderer/fla-import/FlaFrameSequenceReview.tsx', 'utf8');
  const assetLibrary = readFileSync(
    'src/renderer/features/assets/AssetLibrary.tsx',
    'utf8',
  );
  it('keeps the R1/R2 siblings behind one shared mode shell', () => {
    expect(session).toContain('FlaFrameSequenceReview');
    expect(session).toContain('FlaStaticSnapshotReview');
    expect(session).toContain('FlaRenderWorkbench');
    expect(session).toContain('<div data-testid="fla-unified-snapshot-panel" hidden={renderMode !== \'snapshot\'}>');
    expect(session).toContain('<div data-testid="fla-unified-sequence-panel" hidden={renderMode !== \'sequence\'}>');
    expect(session).toContain('FlaFrameSequenceCommitResponse');
    // Both are rendered inside the zero-raster branch.
    expect(session).toContain('onImported={(response) => onSequenceImported?.(response)}');
  });

  it('wires a successful sequence commit into the AssetLibrary store bridge', () => {
    expect(assetLibrary).toContain('applyFlaFrameSequenceCommitResponse');
    expect(assetLibrary).toContain('onSequenceImported={(response) => {');
    expect(assetLibrary).toContain('setStatus(outcome.status);');
  });

  it('keeps sequence focus, preview target, operation target, and checked intent explicit', () => {
    expect(review).toContain('resolveVisibleSequenceFocus(');
    expect(review).toContain('isStaleAgainstIntent(renderedRange, currentIntent)');
    expect(review).toContain('displayedSequenceItems = sequenceIsCurrent ? orderedSequenceItems : []');
    expect(review).toContain('data-preview-target-id={previewTargetId ?? undefined}');
    expect(review).toContain('title={previewTarget?.userLabel}');
    expect(review).toContain('data-operation-target-id={target.renderTargetId}');
    expect(review).toContain('data-render-target-selected={entryTarget.renderTargetId === selectedTargetId ?');
    expect(review).toContain('checkedCandidateKeys.has(flaUnifiedCandidateSelectionKey(candidate))');
    expect(review).toContain('data-testid={`fla-frame-sequence-candidate-check-${entryTarget.renderTargetId}`}');
    expect(review).not.toContain('EMPTY_SEQUENCE_IMPORT_CHECKS');
  });
});

describe('R2-H.2 Problem A/B: gateway UI gating (#296)', () => {
  it('does not expose a commit/import action or progress region until a sequence is rendered', () => {
    const html = renderToStaticMarkup(
      createElement(FlaFrameSequenceReview, {
        ...sequenceReviewProps(),
      }),
    );
    // In the loading phase there is no commit candidate and no live
    // progress region — the user cannot import a stale/old range.
    expect(html).not.toContain('fla-frame-sequence-import');
    expect(html).not.toContain('fla-frame-sequence-progress');
  });

  it('renders the live progress region only during an active render', () => {
    // Static render never enters the "rendering" phase, so the progress
    // region is absent; this documents that progress is shown only while
    // a request is in flight (Problem B).
    const html = renderToStaticMarkup(
      createElement(FlaFrameSequenceReview, {
        ...sequenceReviewProps(),
      }),
    );
    expect(html).not.toContain('正在渲染序列');
  });
});
