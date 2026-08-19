import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const component = readFileSync(
  'src/renderer/fla-import/FlaCompatibilityReviewSession.tsx',
  'utf8',
);
const styles = readFileSync('src/renderer/styles.css', 'utf8');
const issue255Styles = styles.slice(styles.indexOf('/* Issue #255:'));

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

  it('owns one top-level foreground layer and suppresses background interaction', () => {
    expect(component).toContain('data-review-layout="portal"');
    expect(component).toContain('createPortal(surface, document.body)');
    expect(component).toContain('data-testid="fla-review-portal"');
    expect(component).toContain('data-testid="fla-review-backdrop"');
    expect(component).toContain('appRoot.inert = true');
    expect(component).toContain('appRoot.inert = wasInert');
    expect(issue255Styles).toMatch(
      /\.fla-review-portal\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?z-index:\s*1000;[\s\S]*?inset:\s*0;/u,
    );
    expect(issue255Styles).toMatch(
      /\.fla-review-portal \.fla-review-session\s*\{[\s\S]*?position:\s*relative;[\s\S]*?z-index:\s*1;/u,
    );
    expect(issue255Styles).toContain('.fla-review-backdrop');
  });

  it('uses one primary review-body scroll and keeps the action row out of that scroll', () => {
    expect(component).toContain('data-testid="fla-review-header"');
    expect(component).toContain('data-testid="fla-review-selection-toolbar"');
    expect(component).toContain('data-testid="fla-review-body"');
    expect(component.indexOf('data-testid="fla-review-selection-toolbar"')).toBeLessThan(
      component.indexOf('data-testid="fla-review-body"'),
    );
    expect(issue255Styles).toMatch(
      /\.fla-review-portal \.fla-review-session\s*\{[\s\S]*?grid-template-rows:\s*auto auto minmax\(0, 1fr\);/u,
    );
    expect(issue255Styles).toMatch(
      /\.fla-review-body\s*\{[\s\S]*?overflow-x:\s*hidden;[\s\S]*?overflow-y:\s*auto;[\s\S]*?overscroll-behavior:\s*contain;/u,
    );
    expect(issue255Styles).toMatch(
      /\.fla-review-body \.fla-review-media-grid\s*\{[\s\S]*?overflow:\s*visible;/u,
    );
  });

  it('compacts compatibility notes while preserving all statuses and actions', () => {
    expect(component).toContain('data-testid="fla-compatibility-notes"');
    expect(component).toContain('<summary>Compatibility notes ({warnings.length})</summary>');
    expect(component).toContain('data-testid="fla-compatibility-warnings"');
    expect(component).toContain('FLA_COMPATIBILITY_LABELS[status]');
    expect(component).toContain('data-testid="fla-review-selected-count"');
    expect(component).toContain('data-testid="fla-review-select-all"');
    expect(component).toContain('data-testid="fla-review-clear-all"');
    expect(component).toContain('data-testid="fla-review-confirm"');
    expect(component).toContain('data-testid="fla-review-cancel"');
    expect(issue255Styles).toContain('.fla-review-compatibility-notes summary');
    expect(component).not.toContain('window.pandaStage.assets');
    expect(component).not.toContain('updateProject');
  });
});
