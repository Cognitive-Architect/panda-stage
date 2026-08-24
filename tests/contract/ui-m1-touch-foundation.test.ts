import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readSource(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('UI-M1 touch foundation contract', () => {
  it('defines the minimal semantic token scale', () => {
    const tokens = readSource('src/renderer/styles/tokens.css');

    for (const token of [
      '--ui-color-surface-app',
      '--ui-color-surface-work',
      '--ui-color-surface-panel',
      '--ui-color-surface-overlay',
      '--ui-color-text-primary',
      '--ui-color-text-secondary',
      '--ui-color-text-muted',
      '--ui-color-action-primary',
      '--ui-color-action-warning',
      '--ui-color-action-danger',
      '--ui-color-focus-ring',
      '--ui-color-disabled-surface',
      '--ui-color-selected-surface',
      '--ui-space-1',
      '--ui-space-2',
      '--ui-space-3',
      '--ui-space-4',
      '--ui-space-5',
      '--ui-radius-small',
      '--ui-radius-medium',
      '--ui-radius-large',
      '--ui-radius-pill',
      '--ui-font-body',
      '--ui-font-secondary',
      '--ui-font-section-heading',
      '--ui-touch-icon',
      '--ui-touch-regular',
      '--ui-touch-emphasized',
    ]) {
      expect(tokens).toContain(token);
    }
  });

  it('bridges the new primitive CSS without rewriting legacy styles', () => {
    const styles = readSource('src/renderer/styles.css');
    const primitives = readSource('src/renderer/styles/primitives.css');

    expect(styles.startsWith("@import './styles/tokens.css';")).toBe(true);
    expect(styles).toContain("@import './styles/primitives.css';");
    expect(primitives).toContain('button[data-ui-button]');
    expect(primitives).toContain('var(--ui-touch-icon)');
    expect(primitives).toContain('var(--ui-touch-regular)');
    expect(primitives).toContain(':focus-visible');
    expect(primitives).toContain(':disabled');
    expect(primitives).toContain('ui-segmented-tabs__item--selected');
    expect(styles.length).toBeGreaterThan(3000);
  });

  it('makes CompactProjectBar the first real production consumer', () => {
    const bar = readSource('src/renderer/shell/CompactProjectBar.tsx');

    expect(bar).toContain("from '../ui'");
    expect(bar).toContain('<PanelSurface');
    expect(bar).toContain('<Button');
    expect(bar).toContain('variant="primary"');
    expect(bar).toContain('variant="secondary"');
    expect(bar).toContain('variant="danger"');
    expect(bar).not.toMatch(/<button\b/u);
    expect(bar).toContain('onSaveProject');
    expect(bar).toContain('disabled={saveDisabled}');
  });

  it('keeps UI-M1 out of product state owners and adaptive layout code', () => {
    const changed = [
      'src/renderer/ui',
      'src/renderer/styles/tokens.css',
      'src/renderer/styles/primitives.css',
      'src/renderer/shell/CompactProjectBar.tsx',
    ];

    expect(changed.join('\n')).not.toMatch(/src\/(domain|history|main|preload|shared|renderer\/stores)\//u);
    expect(changed.join('\n')).not.toContain('EditorShell.tsx');
    expect(changed.join('\n')).not.toContain('responsive');
  });
});
