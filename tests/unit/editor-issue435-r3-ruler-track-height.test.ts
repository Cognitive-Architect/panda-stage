import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

describe('Issue #435 R3-A ruler-track height propagation', () => {
  it('lets the ruler-track consume its growing ruler-scroll parent', () => {
    const styles = source('src/renderer/styles.css');
    const start = styles.lastIndexOf('/* Issue #422 + #432 R3-A:');
    const end = styles.indexOf('/* Issue #398:', start);
    const r3 = styles.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);

    const scrollRule = r3.match(/\.timeline-ruler-scroll\s*\{[^}]*\}/u);
    const trackRule = r3.match(/\.timeline-ruler-track\s*\{[^}]*\}/u);
    const stackRule = r3.match(/\.timeline-track-stack\s*\{[^}]*\}/u);
    const lanesRule = r3.match(/\.timeline-lanes\s*\{[^}]*\}/u);
    const laneRule = r3.match(/\.timeline-lane\s*\{[^}]*\}/u);

    expect(scrollRule?.[0]).toContain('flex: 1 1 0;');
    expect(scrollRule?.[0]).toContain('height: auto;');

    // #434 measured this direct child at a stale 96px at every Timeline
    // height. The final route rule must replace that used height so the
    // existing downstream flex chain receives the parent's available height.
    expect(trackRule?.[0]).toContain('display: flex;');
    expect(trackRule?.[0]).toContain('height: 100%;');
    expect(trackRule?.[0]).toContain('min-height: 0;');
    expect(trackRule?.[0]).toContain('flex-direction: column;');
    expect(trackRule?.[0]).not.toContain('height: 96px;');

    expect(stackRule?.[0]).toContain('flex: 1 1 0;');
    expect(lanesRule?.[0]).toContain('flex: 1 1 0;');
    expect(laneRule?.[0]).toContain('flex: 1 1 0;');
  });
});
