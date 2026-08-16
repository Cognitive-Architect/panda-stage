import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readSource(path: string): string {
  return readFileSync(path, 'utf8');
}

function cssRule(styles: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const match = new RegExp(
    `(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`,
    'u',
  ).exec(styles);
  if (!match) throw new Error(`CSS rule not found: ${selector}`);
  return match[1] ?? '';
}

describe('Issue 220 Dialogue Sheet bottom-layout contract', () => {
  const styles = readSource('src/renderer/styles.css');
  const timelineRule = cssRule(styles, '.timeline-dock');
  const headerRule = cssRule(styles, '.timeline-header');
  const dialogueRule = cssRule(styles, '.dialogue-sheet');
  const historyRule = cssRule(
    styles,
    '.bottom-workspace > .history-controls',
  );

  it('keeps the fixed BottomWorkspace boundary and scrolls Timeline content inside it', () => {
    expect(styles).toMatch(
      /\.bottom-workspace\s*\{[\s\S]*?min-height:\s*132px;[\s\S]*?max-height:\s*168px;[\s\S]*?overflow:\s*hidden;/u,
    );
    expect(timelineRule).toContain('flex: 1 1 auto;');
    expect(timelineRule).toContain('min-height: 0;');
    expect(timelineRule).toContain('overflow-x: hidden;');
    expect(timelineRule).toContain('overflow-y: auto;');
  });

  it('keeps the Timeline header, ruler and History controls from shrinking or disappearing', () => {
    expect(headerRule).toContain('position: sticky;');
    expect(headerRule).toContain('top: 0;');
    expect(headerRule).toContain('flex: 0 0 auto;');
    expect(styles).toMatch(
      /\.timeline-ruler-scroll\s*\{[\s\S]*?flex:\s*0 0 64px;[\s\S]*?height:\s*64px;/u,
    );
    expect(historyRule).toContain('flex: 0 0 auto;');
  });

  it('keeps Dialogue authoring content as scrollable content instead of a clipped flex item', () => {
    expect(dialogueRule).toContain('flex: 0 0 auto;');
    expect(dialogueRule).toContain('min-width: 0;');
    expect(dialogueRule).toContain('min-height: 0;');
    expect(styles).toMatch(
      /\.dialogue-add\s*\{[\s\S]*?flex:\s*0 0 auto;[\s\S]*?min-width:\s*0;/u,
    );
    expect(styles).toMatch(
      /\.dialogue-batch\s*\{[\s\S]*?flex:\s*0 0 auto;[\s\S]*?min-width:\s*0;/u,
    );
  });

  it('keeps Day28 timing controls inside the narrow inspector width', () => {
    expect(styles).toMatch(
      /\.dialogue-timing-fields\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/u,
    );
    expect(styles).toMatch(
      /\.dialogue-timing-fields button\s*\{[\s\S]*?width:\s*100%;[\s\S]*?grid-column:\s*1 \/ -1;/u,
    );
  });
});
