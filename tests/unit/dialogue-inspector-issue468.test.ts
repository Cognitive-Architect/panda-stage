import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

function presentationSource(dialogue: string, marker: string, end: string): string {
  const start = dialogue.indexOf(marker);
  const finish = dialogue.indexOf(end, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(finish).toBeGreaterThan(start);
  return dialogue.slice(start, finish);
}

describe('Issue #468 Subtitle Properties alignment repair', () => {
  it('keeps identity and copy as separate rows in both Properties presentations', () => {
    const dialogue = source(
      'src/renderer/features/dialogue/DialogueInspector.tsx',
    );
    const end = '\n  return (\n    <>\n      <div className="right-inspector-heading">';
    const portrait = presentationSource(
      dialogue,
      'if (propertiesPresentation)',
      'if (landscapePresentation)',
    );
    const landscape = presentationSource(
      dialogue,
      'if (landscapePresentation)',
      end,
    );

    for (const presentation of [portrait, landscape]) {
      expect(presentation).toContain('dialogue-properties-identity-row');
      expect(presentation).toContain('dialogue-properties-identity-copy');
      expect(presentation).toContain('dialogue-properties-inline-text');
      expect(presentation.indexOf('dialogue-properties-identity-row')).toBeLessThan(
        presentation.indexOf('dialogue-properties-inline-text'),
      );
    }

    expect(landscape).toContain('dialogue-landscape-properties-identity-row');
  });

  it('uses the section rhythm and shared heading hierarchy without alignment hacks', () => {
    const styles = source('src/renderer/styles.css');
    const issue468 = styles.slice(styles.lastIndexOf('/* Issue #468:'));
    const issue388 = styles.slice(styles.lastIndexOf('/* Issue #388:'));

    expect(issue468).toContain('grid-template-columns: minmax(0, 1fr);');
    expect(issue468).toContain('grid-column: 1;');
    expect(issue468).toContain('gap: 12px;');
    expect(issue468).toContain('font-size: 14px;');
    expect(issue468).toContain('font-weight: 700;');
    expect(issue468).toContain('line-height: 1.3;');
    expect(issue388).toContain('color: var(--ui-color-text-secondary);');
    expect(issue468).not.toContain('translateX');
    expect(issue468).not.toContain('position: absolute');
    expect(issue468).not.toContain('negative');
  });
});
