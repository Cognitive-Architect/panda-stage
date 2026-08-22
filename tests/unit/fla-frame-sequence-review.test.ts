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

describe('R2-H.2 is mounted in the compatibility review (zero-raster path)', () => {
  const session = readFileSync(
    'src/renderer/fla-import/FlaCompatibilityReviewSession.tsx',
    'utf8',
  );
  it('renders the frame sequence review alongside the R1 snapshot review', () => {
    expect(session).toContain('FlaFrameSequenceReview');
    expect(session).toContain('FlaStaticSnapshotReview');
    // Both are rendered inside the zero-raster branch.
    expect(session).toContain('onImported={(response) => onSequenceImported?.(response)}');
  });
});
