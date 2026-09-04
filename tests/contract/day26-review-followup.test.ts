import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Issue #195 review-follow-up contracts. These are source/CSS-level locks that
// pin the confirmed fixes from the verification matrix. Behavioral interaction
// (click/scroll/focus) is exercised at the Phase D real-Electron checkpoint.
function readSource(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('Day 26 review follow-up #195 contracts', () => {
  const styles = readSource('src/renderer/styles.css');
  const timelineDock = readSource(
    'src/renderer/features/timeline/TimelineDock.tsx',
  );
  const gate = readSource('scripts/verify-issue102-task4.cjs');
  const receipt = readSource('docs/test-receipts/DAY-26.md');

  it('V-193-02: Timeline collapse keeps the reopen affordance (header) visible', () => {
    // Collapsing must NOT hide the whole dock; only the ruler body is hidden,
    // so the header "expand timeline" button stays reachable.
    expect(styles).not.toMatch(
      /\.timeline-dock\[data-expanded='false'\]\s*\{\s*display:\s*none;/u,
    );
    expect(styles).toMatch(
      /\.timeline-dock\[data-expanded='false'\][\s\S]*?\.timeline-ruler-scroll[\s\S]*?display:\s*none;/u,
    );
    expect(timelineDock).toContain('data-testid="timeline-collapse"');
  });

  it('V-193-03: TimelineDock resets DOM scroll on shot switch', () => {
    // store resetForShot() zeroes scrollPx; mirror that into the real viewport
    // via an effect keyed on the active shot so the 0ms playhead stays visible.
    expect(timelineDock).toMatch(
      /useEffect\(\(\)\s*=>\s*\{[\s\S]*?scrollLeft = 0;[\s\S]*?\}, \[currentShotId\]\)/u,
    );
  });

  it('V-CI-01: Issue-102 gate accepts the Day-26 Timeline Shell height budget', () => {
    // Bottom workspace now uses the post-Stage-E LM-006 Cloud Touch landscape
    // contract (240px minimum, 280px normal); the focused gate allows the
    // normalized state with a small 300px verification ceiling.
    expect(gate).toMatch(
      /function assertCompactBottom\([^)]*maxHeight = 300\)/u,
    );
  });

  it('V-DOC-01: Day-26 receipt records real Git coordinates', () => {
    expect(receipt).toContain('37f30e528177a2752dd7d414ca60eb061232f57d');
    expect(receipt).not.toContain('鏈獙鏀舵湭浜х敓鏂?commit');
    expect(receipt).not.toMatch(/鏀跺嵎 HEAD[^\n]*323f36dc/u);
  });
});
