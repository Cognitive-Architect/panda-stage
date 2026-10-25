import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FlaFrameSequenceReview } from '../../src/renderer/fla-import/FlaFrameSequenceReview';

const noop = () => {};
const sequenceReviewProps = () => ({
  sessionId: '00000000-0000-4000-8000-000000000001',
  source: { basename: 'x.fla', sha256: 'a'.repeat(64) },
  sourceFps: 24,
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
  const unifiedStyles = readFileSync(
    'src/renderer/styles/features/fla-import/c03-unified-workbench.css',
    'utf8',
  );
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

  it('keeps standard image import while defaulting the unified workbench to animation', () => {
    expect(review).toContain("useState(presentation === 'unified-preview')");
    expect(review).toContain('作为普通 PNG 图片');
    expect(review).toContain('作为动画素材');
    expect(review).toContain('aria-label="动画名称"');
    expect(review).toContain('sourceFpsAvailable');
    expect(review).toContain('data-testid="fla-frame-sequence-format-animation"');
    expect(review).toContain('data-testid="fla-frame-sequence-format-images"');
    expect(review).toContain("{presentation === 'unified-preview' ? '生成预览' : '生成连续画面'}");
    expect(review).toContain("!multiSelectMode && onImportSingle");
    expect(review).toContain("{effectiveImportAsAnimation ? '导入动画' : '导入图片'}");
    expect(session).toContain('sourceFps={ir.document.frameRate}');
    expect(session).toContain('onImportSingle={() => {');
    expect(session).toContain('void runImportAction([focusedSequenceItem])');
  });

  it('keeps source-FPS validation while hiding the numeric rate from normal copy and titles', () => {
    expect(review).toContain('sourceFpsAvailable');
    expect(review).not.toContain('sourceFps} fps');
    expect(review).not.toContain('按 ${sourceFps} FPS 保存动画');
    expect(review).toContain('源文件播放速度无法确认');
    expect(session).toContain('sourceFps={ir.document.frameRate}');
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

  it('serializes sequence rasterization with snapshot previews and skips canceled queued work', () => {
    expect(review).toContain("import { flaStaticSnapshotPreviewQueue } from './fla-static-snapshot-preview-transaction';");
    expect(review).toContain('await flaStaticSnapshotPreviewQueue.run(async () => {');
    expect(review).toContain('activeRequestIdRef.current !== requestId');
    expect(review).toContain("code: 'SEQUENCE_CANCELLED' as const");
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
    expect(review).toContain('sampleLoopingAnimationFrameIndex');
    expect(review).toContain('window.requestAnimationFrame(sample)');
    expect(review).not.toContain('window.setInterval');
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
    expect(review).toContain("presentation !== 'unified-preview' ? (");
    expect(review).toContain("presentation === 'unified-preview' ? ' sr-only' : ''");
    expect(review).toContain('aria-describedby={validation.message');
    expect(review).toContain('aria-invalid={!validation.valid}');
    expect(review).toContain('单次最多生成 {MAX_SEQUENCE_FRAMES} 帧。');
    expect(review).toContain('data-testid="fla-frame-sequence-frame-counter"');
    expect(review).toContain("presentation === 'unified-preview'");
    expect(review).toContain("? playbackState.isPlaying ? '⏸' : '▶'");
    expect(review).toContain(": playbackState.isPlaying ? '⏸ 暂停' : '▶ 播放'");
  });

  it('uses concise unified idle and range copy with a content-sized start input', () => {
    expect(review).toContain('showUnifiedGenerationHint');
    expect(review).toContain("(phase === 'selecting' || phase === 'preview-ready')");
    expect(review).toContain('data-testid="fla-frame-sequence-unified-idle-hint"');
    expect(review).toContain('单击下方按钮生成预览');
    expect(review).toContain('formatSequenceRangeSummaryForPresentation(');
    expect(review).toContain('getSequenceStartFrameInputWidthPx(startFrameIndex + 1)');
    expect(review).toContain("importKind={effectiveImportAsAnimation ? 'animation' : 'image'}");
    expect(unifiedStyles).toContain('width: 52px;');
    expect(unifiedStyles).toContain('min-height: 44px;');
    expect(unifiedStyles).toContain(
      '.fla-frame-sequence-review-unified-preview .fla-frame-sequence-filmstrip-region {',
    );
    expect(unifiedStyles).toContain('grid-template-rows: minmax(72px, 1fr);');
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
    const reviewSource = readFileSync('src/renderer/fla-import/FlaFrameSequenceReview.tsx', 'utf8');
    // Static render never enters the "rendering" phase, so the progress
    // region is absent; this documents that progress is shown only while
    // a request is in flight (Problem B).
    const html = renderToStaticMarkup(
      createElement(FlaFrameSequenceReview, {
        ...sequenceReviewProps(),
      }),
    );
    expect(html).not.toContain('fla-frame-sequence-central-progress');
    expect(html).not.toContain('fla-frame-sequence-progress');
    expect(reviewSource).toContain("const activeRenderIntent = phase === 'rendering' ? activeIntentRef.current : null;");
    expect(reviewSource).toContain('return { [activeRenderIntent.renderTargetId]: { status: \'checking\' as const } };');
    expect(reviewSource).toContain('activeRenderIntent.endFrameIndex - activeRenderIntent.startFrameIndex + 1');
    expect(reviewSource).toContain('currentIntent?.renderTargetId !== activeRenderIntent.renderTargetId');
    expect(reviewSource).toContain('`正在生成预览…（${previewTarget.userLabel}）`');
    expect(reviewSource).toContain("if (phase === 'committing' && !embedded)");
    expect(reviewSource).toContain("phase === 'committing' && embedded");
    expect(reviewSource).toContain('data-testid={phase === \'rendering\' ? \'fla-frame-sequence-central-progress\' : undefined}');
    expect(reviewSource).not.toContain('data-testid="fla-frame-sequence-progress"');
    expect(reviewSource).toContain('data-testid="fla-frame-sequence-cancel"');
    expect(reviewSource).not.toContain('className="fla-c03-sequence-actions" aria-live="polite"');
  });
});
