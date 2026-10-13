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

describe('Issue #398 Stage D deletion-first presentation contract', () => {
  it('keeps one workbench identity and removes duplicated explanation', () => {
    expect(workbench).toContain('组合素材');
    expect(session).toContain('FLA 导入工作台');
    expect(session).toContain('data-testid="fla-workbench-tab-compositions"');
    expect(session).toContain('data-testid="fla-workbench-tab-source-assets"');
    expect(workbench).toContain('<span> · 只读</span>');
    expect(workbench).not.toContain('源 FLA 保持不变');
    expect(session).toContain("contentRoute === 'v1-raster-review'");
    expect(session).toContain('hidden={!rasterRoute');
    expect(session).toContain('hidden={!compositionRoute}');
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
    expect(verifier).toContain("await waitForCapture('top')");
    expect(verifier).toContain("await waitForCapture('bottom')");
    expect(verifier).toContain('targetListOwnsScroll');
    expect(verifier).toContain('lastTargetReachable');
    expect(verifier).toContain('previewStableWhileListScrolls');
    expect(verifier).toContain('footerStableWhileListScrolls');
    expect(verifier).toContain('targetSearchWorks');
    expect(verifier).toContain('stageDv11Layout');
    expect(verifier).toContain('stageDv12Deletion');
    expect(verifier).toContain('deletionChecks');
    expect(verifier).toContain('unifiedImportShellVisible');
    expect(verifier).toContain('input[type="checkbox"]');
    expect(verifier).toContain('const selectTwoCandidates');
    expect(verifier).toContain('li[data-duplicate="true"]');
    expect(verifier).toContain('fla-snapshot-import-counts');
    expect(verifier).toContain('cancellationNoMutation');
    expect(verifier).toContain('duplicateGroupPreservesSourceIdentity');
    expect(verifier).toContain('exactDuplicateReused');
    expect(verifier).not.toContain('fla-snapshot-frame-next');
    expect(verifier).toContain('ONE_CONFIRM; COMMIT_SELECTED_STATIC_SNAPSHOT_IMAGE_ASSETS');
  });
});
