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

describe('R2-H.2 shares the C03 unified candidate workbench', () => {
  const session = readFileSync(
    'src/renderer/fla-import/FlaCompatibilityReviewSession.tsx',
    'utf8',
  );
  const review = readFileSync('src/renderer/fla-import/FlaFrameSequenceReview.tsx', 'utf8');
  const assetLibrary = readFileSync(
    'src/renderer/features/assets/AssetLibrary.tsx',
    'utf8',
  );
  it('mounts both safe preview runners behind one candidate grid', () => {
    expect(session).toContain('FlaFrameSequenceReview');
    expect(session).toContain('FlaStaticSnapshotReview');
    expect(session).toContain('FlaUnifiedWorkbench');
    expect(session).toContain('presentation="unified-preview"');
    expect(session).toContain('onCandidatesChange={setSnapshotCandidates}');
    expect(session).toContain('onCandidatesChange={setSequenceCandidates}');
    expect(session).not.toContain('fla-render-mode-tabs');
    expect(session).toContain('FlaFrameSequenceCommitResponse');
    expect(session).toContain('onImported={(result) => onSequenceImported?.(result)}');
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

  it('supports Enter activation on sequence render, cancel, and rerender controls', () => {
    expect(review).toContain("if (event.key !== 'Enter' || event.repeat) return;");
    expect(review.match(/onKeyDown=\{\(event\) => handleSequenceActionKeyDown\(event, \(\) => void (?:renderSequence|cancelSequence|rerenderSequence)\(\)\)\}/gu)).toHaveLength(6);
  });

  it('wires G008 playback, manual stepping, frame count, visibility, and horizontal filmstrip follow', () => {
    expect(review).toContain('flaSequencePlaybackReducer');
    expect(review).toContain('data-testid="fla-frame-sequence-playback"');
    expect(review).toContain('data-testid="fla-frame-sequence-previous"');
    expect(review).toContain('data-testid="fla-frame-sequence-next"');
    expect(review).toContain('data-testid="fla-frame-sequence-frame-counter"');
    expect(review).toContain('selectedOnlyView');
    expect(review).toContain("document.visibilityState !== 'visible'");
    expect(review).toContain('strip.scrollLeft');

    const counterStart = review.indexOf('data-testid="fla-frame-sequence-frame-counter"');
    expect(counterStart).toBeGreaterThanOrEqual(0);
    expect(review.slice(counterStart - 260, counterStart + 170)).not.toContain('aria-live');
  });

  it('keeps the G009 sequence row concise and preserves the keyboard control order', () => {
    const start = review.indexOf('data-testid="fla-frame-sequence-start"');
    const rerender = review.indexOf('data-testid="fla-frame-sequence-rerender"');
    const playback = review.indexOf('{playbackButton}', rerender);
    const firstThumbnail = review.indexOf('data-testid={`fla-frame-sequence-filmstrip-item-${item.frameIndex}`}');

    expect(start).toBeGreaterThanOrEqual(0);
    expect(rerender).toBeGreaterThan(start);
    expect(playback).toBeGreaterThan(rerender);
    expect(firstThumbnail).toBeGreaterThan(playback);
    expect(review).toContain("presentation === 'unified-preview' ? null : <span>序列预览</span>");
    expect(review).toContain("presentation === 'unified-preview' ? ' sr-only' : ''");
    expect(review).toContain('aria-describedby={validation.message');
    expect(review).toContain('aria-invalid={!validation.valid}');
    expect(review).toContain('单次最多生成 {MAX_SEQUENCE_FRAMES} 帧。');
    expect(review).toContain("`${selectedPreviewIndex + 1}/${displayedSequenceItems.length}`");
    expect(review).toContain("presentation === 'unified-preview'");
    expect(review).toContain("? playbackState.isPlaying ? '⏸' : '▶'");
    expect(review).toContain(": playbackState.isPlaying ? '⏸ 暂停' : '▶ 播放'");
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
