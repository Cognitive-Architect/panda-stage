import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readOrderedStylesheetSource } from '../helpers/read-stylesheet-source';

const snapshot = readFileSync(
  'src/renderer/fla-import/FlaStaticSnapshotReview.tsx',
  'utf8',
);
const workbench = readFileSync(
  'src/renderer/fla-import/FlaRenderWorkbench.tsx',
  'utf8',
);
const session = readFileSync(
  'src/renderer/fla-import/FlaCompatibilityReviewSession.tsx',
  'utf8',
);
const styles = readOrderedStylesheetSource();
const verifier = readFileSync('scripts/verify-issue396-stage-d.cjs', 'utf8');

describe('Issue #775 C03 preserves the Stage D render runners in one workbench', () => {
  it('replaces persistent route tabs while keeping the shared snapshot and sequence previews', () => {
    expect(workbench).toContain('组合素材');
    expect(session).toContain('FLA 导入工作台');
    expect(session).toContain('<FlaUnifiedWorkbench');
    expect(session).toContain('<FlaStaticSnapshotReview');
    expect(session).toContain('<FlaFrameSequenceReview');
    expect(session).toContain('presentation="unified-preview"');
    expect(session).not.toContain('<FlaRenderWorkbench');
    expect(session).not.toContain('data-testid="fla-workbench-tab-compositions"');
    expect(session).not.toContain('data-testid="fla-workbench-tab-source-assets"');
    expect(session).not.toContain('fla-render-mode-tabs');
    expect(workbench).toContain('<span> · 只读</span>');
    expect(session).not.toContain('fla-review-zero-raster-summary');
    expect(snapshot).toContain('data-testid="fla-snapshot-target-search"');
    expect(snapshot).toContain('data-testid="fla-snapshot-target-count"');
    expect(snapshot).not.toContain('data-testid="fla-snapshot-zero-raster"');
    expect(snapshot).not.toContain('data-testid="fla-snapshot-readonly-note"');
    expect(snapshot).not.toContain('data-testid="fla-snapshot-fidelity"');
    expect(snapshot).not.toContain('<dt>来源</dt>');
    expect(snapshot).toContain('data-testid="fla-snapshot-compatibility-details"');
    expect(snapshot).toContain('visibleGroups');
    expect(snapshot).toContain('target.frameCount} 帧');
    expect(snapshot).toContain('来源详情');
    expect(snapshot).toContain('fla-snapshot-action-state');
    expect(snapshot).not.toContain('data-testid="fla-snapshot-action-guidance"');
  });

  it('assigns scrolling to the bounded target/detail regions', () => {
    const v11 = styles.slice(styles.indexOf('/* Issue #397:'));
    const v12 = styles.slice(styles.lastIndexOf('/* Issue #398'));
    const u1 = styles.slice(styles.lastIndexOf('/* Issue #767 U1:'));
    expect(v11).toContain(".fla-review-session[data-workbench-route='render'] .fla-review-body");
    expect(v11).toMatch(
      /\.fla-review-session\[data-workbench-route='render'\] \.fla-review-body\s*\{[\s\S]*?overflow:\s*hidden;/u,
    );
    expect(v11).toMatch(
      /\.fla-review-session\[data-workbench-route='render'\] \.fla-snapshot-targets\s*\{[\s\S]*?overflow-y:\s*auto;/u,
    );
    expect(v11).toMatch(
      /\.fla-review-session\[data-workbench-route='render'\] \.fla-snapshot-preview-region\s*\{[\s\S]*?overflow:\s*hidden;/u,
    );
    expect(v11).toMatch(
      /\.fla-review-session\[data-workbench-route='render'\] \.fla-snapshot-action-bar\s*\{[\s\S]*?z-index:\s*2;/u,
    );
    expect(v12).toContain('/* Issue #398');
    expect(v12).toContain('grid-template-rows: minmax(0, 1fr);');
    expect(v12).toContain('.fla-snapshot-stage-fact');
    expect(u1).toMatch(
      /\.fla-review-portal \.fla-review-session\[data-workbench-route='render'\]\s*\{[\s\S]*?grid-template-rows:\s*auto minmax\(0, 1fr\);/u,
    );
  });

  it('proves the long-list layout and keeps the existing business path in the real verifier', () => {
    expect(verifier).toContain('SYNTHETIC_TARGET_COUNT = 25');
    expect(verifier).toContain('index === SYNTHETIC_TARGET_COUNT - 1 ? 3 : 1');
    expect(verifier).toContain('[data-testid="fla-c03-workbench"]');
    expect(verifier).toContain('[data-testid="fla-c03-candidate-grid"]');
    expect(verifier).toContain('[data-testid="fla-c03-import-footer"]');
    expect(verifier).toContain('const candidateDisplayLabel');
    expect(verifier).toContain("getAttribute('title')?.trim() ||");
    expect(verifier).toContain('const expectedAlt = candidateDisplayLabel(buttons[2]);');
    expect(verifier).toContain('const expectedAlt = candidateDisplayLabel(snapshotButton);');
    expect(verifier).toContain('const expectedAlt = candidateDisplayLabel(button);');
    expect(verifier).toContain("strong?.getAttribute('title')?.trim()");
    expect(verifier).toContain("element.getAttribute('title')?.trim() || element.textContent?.trim()");
    expect(verifier).toContain("document.querySelector('[data-testid=\"fla-c03-focused-label\"]')");
    expect(verifier).toContain('const generateActionVisible =');
    expect(verifier).toContain("await waitForCapture('sequence-pre-render-wide')");
    expect(verifier).toContain("await waitForCapture('sequence-pre-render-narrow')");
    expect(verifier).toContain('const focusBrowsePreserved');
    expect(verifier).toContain('const selectedSequenceVisible');
    expect(verifier).toContain('const sequenceReturnButton');
    expect(verifier).toContain('const selectionPreservedThroughAtoBtoA');
    expect(verifier).toContain('[data-testid="fla-frame-sequence-range"]');
    expect(verifier).toContain('retiredRenderTabsRemoved');
    expect(verifier).not.toContain('fla-render-mode-snapshot');
    expect(verifier).not.toContain('fla-render-mode-sequence');
    expect(verifier).toContain("await waitForCapture('top')");
    expect(verifier).toContain("await waitForCapture('bottom')");
    expect(verifier).toContain('targetListOwnsScroll');
    expect(verifier).toContain('lastTargetReachable');
    expect(verifier).toContain('previewStableWhileListScrolls');
    expect(verifier).toContain('footerStableWhileListScrolls');
    expect(verifier).toContain("await waitForCapture('receipt-846-top')");
    expect(verifier).toContain("await waitForCapture('receipt-846-scrolled')");
    expect(verifier).toContain("await waitForCapture('receipt-narrow-top')");
    expect(verifier).toContain("await waitForCapture('receipt-narrow-scrolled')");
    expect(verifier).toContain('receiptReachableAt846x653');
    expect(verifier).toContain('receiptReachableAtNarrowNative');
    expect(verifier).toContain('receiptTouchWorks');
    expect(verifier).toContain('width: 859, height: 689, maxViewportWidth: 900');
    expect(verifier).toContain('receiptReachability.viewport846x653.top.viewport.height === 653');
    expect(verifier).toContain('receiptReachability.narrowNative.bottom.viewport.height === receiptReachability.narrowNative.top.viewport.height');
    expect(verifier).toMatch(/async function driveKeyboardAtMarker\([\s\S]*?const deadline = Date\.now\(\) \+ 75_000;/u);
    expect(verifier).toContain('targetSearchWorks');
    expect(verifier).toContain('stageDv11Layout');
    expect(verifier).toContain('stageDv12Deletion');
    expect(verifier).toContain('deletionChecks');
    expect(verifier).toContain('unifiedImportShellVisible');
    expect(verifier).toContain('input[type="checkbox"]');
    expect(verifier).toContain('const selectTwoCandidates');
    expect(verifier).toContain('li[data-duplicate="true"]');
    expect(verifier).toContain('fla-unified-import-counts');
    expect(verifier).toContain('cancellationNoMutation');
    expect(verifier).toContain('duplicateGroupPreservesSourceIdentity');
    expect(verifier).toContain('exactDuplicateReused');
    expect(verifier).not.toContain('fla-snapshot-frame-next');
    expect(verifier).toContain('ONE_CONFIRM; COMMIT_SELECTED_STATIC_SNAPSHOT_IMAGE_ASSETS');
  });
});
