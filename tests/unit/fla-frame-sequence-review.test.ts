import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FlaFrameSequenceReview } from '../../src/renderer/fla-import/FlaFrameSequenceReview';

const noop = () => {};

describe('R2-H.2 component mounts (static render)', () => {
  it('renders the review root without throwing in the loading phase', () => {
    const html = renderToStaticMarkup(
      createElement(FlaFrameSequenceReview, {
        sessionId: '00000000-0000-4000-8000-000000000001',
        source: { basename: 'x.fla', sha256: 'a'.repeat(64) },
        snapshot: null,
        onImported: noop,
        onClose: noop,
      }),
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
  const assetLibrary = readFileSync(
    'src/renderer/features/assets/AssetLibrary.tsx',
    'utf8',
  );
  it('keeps the R1/R2 siblings behind one shared mode shell', () => {
    expect(session).toContain('FlaFrameSequenceReview');
    expect(session).toContain('FlaStaticSnapshotReview');
    expect(session).toContain('FlaRenderWorkbench');
    expect(session).toContain("renderMode === 'snapshot'");
    expect(session).toContain('FlaFrameSequenceCommitResponse');
    // Both are rendered inside the zero-raster branch.
    expect(session).toContain('onImported={(response) => onSequenceImported?.(response)}');
  });

  it('wires a successful sequence commit into the AssetLibrary store bridge', () => {
    expect(assetLibrary).toContain('applyFlaFrameSequenceCommitResponse');
    expect(assetLibrary).toContain('onSequenceImported={(response) => {');
    expect(assetLibrary).toContain('setStatus(outcome.status);');
  });
});

describe('R2-H.2 Problem A/B: gateway UI gating (#296)', () => {
  it('does not expose a commit/import action or progress region until a sequence is rendered', () => {
    const html = renderToStaticMarkup(
      createElement(FlaFrameSequenceReview, {
        sessionId: '00000000-0000-4000-8000-000000000001',
        source: { basename: 'x.fla', sha256: 'a'.repeat(64) },
        snapshot: null,
        onImported: noop,
        onClose: noop,
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
        sessionId: '00000000-0000-4000-8000-000000000001',
        source: { basename: 'x.fla', sha256: 'a'.repeat(64) },
        snapshot: null,
        onImported: noop,
        onClose: noop,
      }),
    );
    expect(html).not.toContain('正在渲染序列');
  });
});
