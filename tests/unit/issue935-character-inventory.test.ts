import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyVisualReviews,
  classifyFileEvidence,
  classifyTargetEvidence,
  enumerateFlaFiles,
  groupFilesBySha256,
  sampleFrameIndices,
} from '../../scripts/issue935-character-inventory-core.cjs';
import type { InventoryManifest, VisualReviewRecord } from '../../scripts/issue935-character-inventory-core.cjs';

const workRoots: string[] = [];

afterEach(() => {
  for (const root of workRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function makeWorkRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'panda-issue935-'));
  workRoots.push(root);
  return root;
}

describe('Issue #935 private FLA inventory core', () => {
  it('accepts a changed, source-traceable whole-body action after bounded visual review', () => {
    const result = classifyTargetEvidence({
      structuralDynamic: true,
      renderedFrameHashes: ['first-a', 'middle-b', 'last-c'],
      visualReview: 'FULL_BODY',
      sourceTraceable: true,
      previewSupported: true,
    });

    expect(result.classification).toBe('FULL_BODY_ACTION_CANDIDATE');
  });

  it('keeps a visibly changing legs-only action in the partial category', () => {
    const result = classifyTargetEvidence({
      structuralDynamic: true,
      renderedFrameHashes: ['first-leg', 'middle-leg', 'last-leg'],
      visualReview: 'PARTIAL_ONLY',
      sourceTraceable: true,
      previewSupported: true,
    });

    expect(result.classification).toBe('PARTIAL_ACTION_ONLY');
    expect(result.classification).not.toBe('FULL_BODY_ACTION_CANDIDATE');
  });

  it('does not accept full-body review when the sampled renders show no visible change', () => {
    const result = classifyTargetEvidence({
      structuralDynamic: true,
      renderedFrameHashes: ['same', 'same', 'same'],
      visualReview: 'FULL_BODY',
      sourceTraceable: true,
      previewSupported: true,
    });

    expect(result.classification).toBe('UNKNOWN_OR_UNSUPPORTED');
  });

  it('does not mistake a static multi-view source for movement', () => {
    const result = classifyTargetEvidence({
      structuralDynamic: false,
      frameContextChanged: false,
      previewSupported: true,
    });

    expect(result.classification).toBe('STATIC_OR_MULTIVIEW');
  });

  it('keeps corrupt or unsupported input unknown with its file-level reason', () => {
    const result = classifyFileEvidence([], 'failed: malformed archive');

    expect(result.classification).toBe('UNKNOWN_OR_UNSUPPORTED');
    expect(result.reason).toContain('malformed archive');
  });

  it('keeps a file-level main class unknown while any other dynamic target is unreviewed', () => {
    const result = classifyFileEvidence([
      { classification: 'PARTIAL_ACTION_ONLY', reason: 'reviewed partial action' },
      { classification: 'UNKNOWN_OR_UNSUPPORTED', reason: 'pending review' },
    ], 'success');

    expect(result.classification).toBe('UNKNOWN_OR_UNSUPPORTED');
  });

  it('recursively enumerates case-insensitive FLA extensions and preserves identical-file aliases', async () => {
    const root = makeWorkRoot();
    const nested = join(root, '子目录');
    mkdirSync(nested);
    writeFileSync(join(root, 'A.FLA'), 'same bytes');
    writeFileSync(join(nested, 'a-copy.fla'), 'same bytes');
    writeFileSync(join(nested, 'corrupt.Fla'), 'not an archive');
    writeFileSync(join(root, 'ignored.txt'), 'not a FLA');

    const enumeration = await enumerateFlaFiles(root);
    const files = enumeration.files.map((file) => file.relativePath).sort();
    const sameSha = createHash('sha256').update('same bytes').digest('hex');
    const aliases = groupFilesBySha256([
      { relativePath: 'A.FLA', sha256: sameSha },
      { relativePath: '子目录/a-copy.fla', sha256: sameSha },
      { relativePath: '子目录/corrupt.Fla', sha256: 'different' },
    ]);

    expect(files).toEqual(['A.FLA', '子目录/a-copy.fla', '子目录/corrupt.Fla']);
    expect(enumeration.complete).toBe(true);
    expect(aliases).toEqual([{ sha256: sameSha, relativePaths: ['A.FLA', '子目录/a-copy.fla'] }]);
  });

  it('applies visual review only to the matching source hash and target, then recommends the whole-body target', () => {
    const manifest: InventoryManifest = {
      files: [{
        sha256: 'a'.repeat(64),
        classification: 'UNKNOWN_OR_UNSUPPORTED',
        classificationReason: 'visual review pending',
        parserStatus: 'success',
        targets: [{
          renderTargetId: 'fla-render-target-abcdefgh',
          classification: 'UNKNOWN_OR_UNSUPPORTED',
          classificationReason: 'visual review pending',
          structuralDynamic: true,
          frameContextChanged: true,
          previewSupported: true,
          s2: { renderedFrameHashes: ['first', 'middle', 'last'] },
        }],
      }],
    };
    const reviews: VisualReviewRecord[] = [{
      sourceSha256: 'A'.repeat(64),
      renderTargetId: 'fla-render-target-abcdefgh',
      coverage: 'FULL_BODY',
      notes: 'Synthetic original fixture: head, torso, and lower body remain visible across samples.',
    }];

    applyVisualReviews(manifest, reviews);

    expect(manifest.files[0]?.targets?.[0]?.classification).toBe('FULL_BODY_ACTION_CANDIDATE');
    expect(manifest.summary?.recommendation).toMatchObject({ status: 'RECOMMEND_P01' });
  });

  it('selects no more than first, middle, and last sample points', () => {
    expect(sampleFrameIndices(1)).toEqual([0]);
    expect(sampleFrameIndices(21)).toEqual([0, 10, 20]);
  });
});
