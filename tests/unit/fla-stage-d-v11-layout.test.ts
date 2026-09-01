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

describe('Issue #397 Stage D v1.1 presentation contract', () => {
  it('keeps the beginner task hierarchy concise and searchable', () => {
    expect(workbench).toContain('FLA 渲染工作台');
    expect(workbench).toContain('<span> · 只读</span>');
    expect(workbench).toContain('源 FLA 保持不变');
    expect(session).toContain('FLA 渲染工作台');
    expect(snapshot).toContain('data-testid="fla-snapshot-target-search"');
    expect(snapshot).toContain('visibleEntries');
    expect(snapshot).toContain('target.frameCount} 帧');
    expect(snapshot).toContain('更多详情');
    expect(snapshot).not.toContain('>可预览</small>');
  });

  it('assigns scrolling to the bounded target/detail regions', () => {
    const v11 = styles.slice(styles.indexOf('/* Issue #397:'));
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
    expect(verifier).toContain('PREVIEW_NONE; COMMIT_ONE_STATIC_SNAPSHOT_IMAGE_ASSET');
  });
});
