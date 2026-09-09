import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

function sectionBetween(sourceText: string, startMarker: string, endMarker: string): string {
  const start = sourceText.lastIndexOf(startMarker);
  const end = sourceText.indexOf(endMarker, start + startMarker.length);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return sourceText.slice(start, end);
}

function declarationBlock(sourceText: string, selector: string): string {
  const start = sourceText.lastIndexOf(selector);
  const end = sourceText.indexOf('}', start + selector.length);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return sourceText.slice(start, end);
}

describe('Issue #469 Subtitle Properties identity and heading polish', () => {
  it('groups the landscape icon and speaker name before the flexible status space', () => {
    const styles = source('src/renderer/styles.css');
    const issue387 = sectionBetween(
      styles,
      '/* Issue #387:',
      '/* Issue #388:',
    );
    const issue468 = styles.slice(styles.lastIndexOf('/* Issue #468:'));
    const identityRow = declarationBlock(
      issue387,
      '.dialogue-landscape-properties-identity-row {',
    );

    expect(issue387).toContain(
      'grid-template-columns: auto auto minmax(0, 1fr);',
    );
    expect(issue468).toContain(
      'grid-template-columns: auto auto minmax(0, 1fr);',
    );
    expect(issue468).toContain('justify-self: end;');
    expect(identityRow).not.toContain('justify-content: space-between;');
    expect(identityRow).not.toContain('position: absolute');
    expect(identityRow).not.toContain('translateX');
  });

  it('normalizes the landscape speaker name and shared section heading hierarchy', () => {
    const styles = source('src/renderer/styles.css');
    const issue387 = sectionBetween(
      styles,
      '/* Issue #387:',
      '/* Issue #388:',
    );
    const issue388 = sectionBetween(
      styles,
      '/* Issue #388:',
      '/* Issue #441:',
    );
    const identityStrong = declarationBlock(
      issue387,
      '.dialogue-landscape-properties-identity-row\n  strong {',
    );

    expect(identityStrong).toContain('font-size: 14px;');
    expect(identityStrong).toContain('font-weight: 700;');
    expect(identityStrong).toContain('line-height: 1.3;');
    expect(issue388).toContain(
      '.dialogue-landscape-properties-timing-section\n  .dialogue-properties-section-heading',
    );
    expect(issue388).toContain('color: var(--ui-color-text-secondary);');
    expect(issue388).toContain('font-size: 14px;');
    expect(issue388).toContain('font-weight: 700;');
    expect(issue388).toContain('line-height: 1.3;');
    expect(styles).not.toMatch(
      /\.dialogue-landscape-properties-identity-row\s+strong\s*\{[^}]*font-size:\s*15px;/u,
    );
  });

  it('preserves the accepted #468 full-width textarea structure', () => {
    const styles = source('src/renderer/styles.css');
    const issue468 = styles.slice(styles.lastIndexOf('/* Issue #468:'));

    expect(issue468).toContain('grid-template-columns: minmax(0, 1fr);');
    expect(issue468).toContain('grid-column: 1;');
    expect(issue468).not.toContain('margin-left: -');
    expect(issue468).not.toContain('margin-right: -');
  });
});
