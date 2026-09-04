import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Issue #195 review-follow-up contracts for the narrow Right Inspector Drawer
// (owning PR #194). Behavioral click/focus is exercised at the Phase D
// real-Electron checkpoint; these are source/CSS-level locks.
function readSource(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('Right Inspector narrow Drawer review follow-up #195 contracts', () => {
  const inspector = readSource('src/renderer/shell/RightInspector.tsx');
  const styles = readSource('src/renderer/styles.css');

  it('V-194-01: Properties drawer exposes one inline close entry', () => {
    expect(inspector).not.toContain('inspector-drawer-close');
    expect(inspector).toContain('data-testid="inspector-inline-close"');
    expect(inspector).toContain('onClick={() => setDrawerOpen(false)}');
    expect(styles).toMatch(
      /\.right-inspector-heading-close\s*\{[\s\S]*?width:\s*44px;/u,
    );
  });

  it('V-194-02: Drawer manages keyboard focus on open and close', () => {
    // Drawer is focusable so focus lands inside it (not on the hidden trigger).
    expect(inspector).toMatch(/tabIndex=\{-1\}/u);
    // Focus transfers into the drawer on open and back to the rail on close.
    expect(inspector).toMatch(/drawerRef\.current\?\.focus\(\)/u);
    expect(inspector).toMatch(/railRef\.current\?\.focus\(\)/u);
  });
});
