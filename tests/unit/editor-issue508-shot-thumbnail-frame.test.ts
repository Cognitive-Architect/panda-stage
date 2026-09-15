import { describe, expect, it } from 'vitest';
import { readOrderedStylesheetSource } from '../helpers/read-stylesheet-source';

describe('Issue #508 ready Shot thumbnail frame polish', () => {
  it('removes the ready-only outer frame while retaining fallback framing', () => {
    const styles = readOrderedStylesheetSource();
    const readyPolish = styles.match(
      /\/\* Issue #508:[\s\S]*?\*\/\s*\.shot-thumbnail \{[\s\S]*?\n\}/u,
    )?.[0];

    expect(readyPolish).toBeDefined();
    expect(readyPolish).toContain('padding: 0;');
    expect(readyPolish).toContain('border: 0;');
    expect(readyPolish).toContain('background: transparent;');
    expect(readyPolish).toContain('place-content: stretch;');
    expect(readyPolish).toContain('gap: 0;');

    expect(styles).toMatch(
      /\.shot-thumbnail,\s*\.shot-thumbnail-placeholder \{[\s\S]*?padding: 7px;[\s\S]*?border: 1px dashed/u,
    );
    expect(styles).toMatch(
      /\.shot-thumbnail img \{[\s\S]*?object-fit: contain;/u,
    );
  });
});
