import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const component = readFileSync(
  'src/renderer/fla-import/FlaCompatibilityReviewSession.tsx',
  'utf8',
);
const styles = readFileSync('src/renderer/styles.css', 'utf8');

describe('FLA Slice 2 review UX contract', () => {
  it('exposes full-card, thumbnail, and one checkbox selection paths without double toggling', () => {
    expect(component).toContain('data-selection-target="thumbnail"');
    expect(component).toContain('data-selection-target="checkbox"');
    expect(component).toContain('role="button"');
    expect(component).toContain('aria-pressed={selected}');
    expect(component).toContain('onClick={(event: ReactMouseEvent<HTMLElement>) =>');
    expect(component).toContain('onKeyDown={(event: ReactKeyboardEvent<HTMLElement>) =>');
    expect(component).toContain("target.closest('input, label, button, a')");
    expect(component.match(/onChange=\{onToggle\}/gu)).toHaveLength(1);
  });

  it('keeps the review wide, its media browser independently scrollable, and cards responsive', () => {
    expect(component).toContain('data-review-layout="overlay"');
    expect(component).toContain('data-scroll-region="fla-media"');
    expect(styles).toMatch(
      /\.fla-review-session\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?width:\s*min\(1080px, calc\(100vw - 32px\)\);/u,
    );
    expect(styles).toMatch(
      /\.fla-review-media-grid\s*\{[\s\S]*?overflow-x:\s*hidden;[\s\S]*?overflow-y:\s*auto;[\s\S]*?grid-template-columns:\s*repeat\(auto-fit, minmax\(220px, 1fr\)\);/u,
    );
    expect(styles).toMatch(
      /\.fla-review-compatibility > ul:first-of-type\s*\{[\s\S]*?repeat\(auto-fit, minmax\(140px, 1fr\)\);/u,
    );
    expect(styles).toMatch(
      /@media\s*\(max-width: 720px\)[\s\S]*?\.fla-review-media-grid\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\);/u,
    );
    expect(styles).toMatch(
      /\.fla-review-selection-toolbar button\s*\{[\s\S]*?min-height:\s*44px;/u,
    );
  });

  it('keeps the review action and compatibility surfaces in the non-mutating component', () => {
    expect(component).toContain('data-testid="fla-review-selected-count"');
    expect(component).toContain('data-testid="fla-review-select-all"');
    expect(component).toContain('data-testid="fla-review-clear-all"');
    expect(component).toContain('data-testid="fla-review-confirm"');
    expect(component).toContain('data-testid="fla-review-cancel"');
    expect(component).toContain('FLA_COMPATIBILITY_LABELS[status]');
    expect(component).not.toContain('window.pandaStage.assets');
    expect(component).not.toContain('updateProject');
  });
});
