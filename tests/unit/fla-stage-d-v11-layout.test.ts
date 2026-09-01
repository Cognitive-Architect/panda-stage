import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

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
const styles = readFileSync('src/renderer/styles.css', 'utf8');
const verifier = readFileSync('scripts/verify-issue396-stage-d.cjs', 'utf8');

describe('Issue #398 Stage D deletion-first presentation contract', () => {
  it('keeps one workbench identity and removes duplicated explanation', () => {
    expect(workbench).toContain('FLA 渲染工作台');
    expect(workbench).toContain('<span> · 只读</span>');
    expect(workbench).not.toContain('源 FLA 保持不变');
    expect(session).toContain("rasterRoute ? (");
    expect(session).not.toContain('fla-review-zero-raster-summary');
    expect(snapshot).toContain('data-testid="fla-snapshot-target-search"');
    expect(snapshot).toContain('data-testid="fla-snapshot-target-count"');
    expect(snapshot).not.toContain('data-testid="fla-snapshot-zero-raster"');
    expect(snapshot).not.toContain('data-testid="fla-snapshot-readonly-note"');
    expect(snapshot).not.toContain('data-testid="fla-snapshot-fidelity"');
    expect(snapshot).not.toContain('<dt>来源</dt>');
    expect(snapshot).toContain('data-testid="fla-snapshot-compatibility-details"');
    expect(snapshot).toContain('visibleEntries');
    expect(snapshot).toContain('target.frameCount} 帧');
    expect(snapshot).toContain('更多详情');
    expect(snapshot).toContain('snapshotFooterState');
    expect(snapshot).not.toContain('data-testid="fla-snapshot-action-guidance"');
  });

  it('assigns scrolling to the bounded target/detail regions', () => {
    const v11 = styles.slice(styles.indexOf('/* Issue #397:'));
    const v12 = styles.slice(styles.lastIndexOf('/* Issue #398'));
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
    expect(verifier).toContain('PREVIEW_NONE; COMMIT_ONE_STATIC_SNAPSHOT_IMAGE_ASSET');
  });
});
