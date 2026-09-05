import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Issue #197 contracts: collapsing the Timeline must release real vertical
// space so the central Canvas grows. These are source/CSS-level locks with a
// numeric proof that the collapsed budget is strictly below the expanded one.
// Real geometry (measured boxes) is asserted by the Electron gate
// `scripts/verify-issue197-timeline-collapse.cjs`.
function readSource(path: string): string {
  return readFileSync(path, 'utf8');
}

/** Reads `min-height`/`max-height` (px) out of one CSS declaration block. */
function heightBudget(
  css: string,
  pattern: RegExp,
): { minHeight: number | null; maxHeight: number | null } {
  const block = pattern.exec(css);
  if (!block) throw new Error(`CSS block not found for ${String(pattern)}`);
  const body = block[1] ?? '';
  const min = /min-height:\s*(\d+)(?:px)?;/u.exec(body);
  const max = /max-height:\s*(\d+)(?:px)?;/u.exec(body);
  return {
    minHeight: min ? Number(min[1]) : null,
    maxHeight: max ? Number(max[1]) : null,
  };
}

function findResponsiveBlock(
  css: string,
  requiredSelectors: string[],
): string | null {
  const mediaBlockPattern = /@media\s*\(max-width:\s*720px\)\s*\{/gu;

  for (const match of css.matchAll(mediaBlockPattern)) {
    const bodyStart = (match.index ?? 0) + match[0].length;
    let depth = 1;

    for (let index = bodyStart; index < css.length; index += 1) {
      const character = css[index];
      if (character === '{') {
        depth += 1;
      } else if (character === '}') {
        depth -= 1;
        if (depth === 0) {
          const body = css.slice(bodyStart, index);
          if (requiredSelectors.every((selector) => body.includes(selector))) {
            return body;
          }
          break;
        }
      }
    }
  }

  return null;
}

describe('Issue 197 Timeline collapse releases vertical space to Canvas', () => {
  const styles = readSource('src/renderer/styles.css');
  const bottom = readSource('src/renderer/shell/BottomWorkspace.tsx');
  const timelineDock = readSource(
    'src/renderer/features/timeline/TimelineDock.tsx',
  );
  const timelineUi = readSource(
    'src/renderer/features/timeline/timelineUiStore.ts',
  );
  const gate = readSource('scripts/verify-issue197-timeline-collapse.cjs');

  const expandedBudget = heightBudget(
    styles,
    /\n\.bottom-workspace\s*\{([^}]*)\}/u,
  );
  const collapsedBudget = heightBudget(
    styles,
    /\n\.bottom-workspace\[data-timeline-expanded='false'\]\s*\{([^}]*)\}/u,
  );

  it('keeps the approved Day 26 expanded height contract untouched', () => {
    expect(expandedBudget.minHeight).toBe(132);
    expect(expandedBudget.maxHeight).toBe(168);
    expect(styles).toMatch(
      /\.bottom-workspace\s*\{[\s\S]*?min-height:\s*132px;[\s\S]*?max-height:\s*168px;[\s\S]*?overflow:\s*hidden;/u,
    );
  });

  it('proves the collapsed budget is strictly smaller than the expanded one', () => {
    // The collapsed ceiling sits below the expanded floor, so *any* collapsed
    // layout is necessarily shorter than *any* expanded layout.
    expect(collapsedBudget.minHeight).toBe(0);
    expect(collapsedBudget.maxHeight).not.toBeNull();
    expect(collapsedBudget.maxHeight as number).toBeLessThan(
      expandedBudget.minHeight as number,
    );
    // Keep enough room for the reopen entry + timecode + History row so the
    // collapsed surface is compact without clipping its own content.
    expect(collapsedBudget.maxHeight as number).toBeGreaterThanOrEqual(96);
  });

  it('proves the same collapsed < expanded relation in the 720px compact layout', () => {
    const narrowCss = findResponsiveBlock(styles, [
      '.bottom-workspace',
      ".bottom-workspace[data-timeline-expanded='false']",
    ]);
    expect(narrowCss).not.toBeNull();
    const narrowExpanded = heightBudget(
      narrowCss as string,
      /\.bottom-workspace\s*\{([^}]*)\}/u,
    );
    const narrowCollapsed = heightBudget(
      narrowCss as string,
      /\.bottom-workspace\[data-timeline-expanded='false'\]\s*\{([^}]*)\}/u,
    );
    expect(narrowExpanded.minHeight).toBe(128);
    expect(narrowCollapsed.maxHeight as number).toBeLessThan(
      narrowExpanded.minHeight as number,
    );
  });

  it('reserves one visible toolbar row in Cloud Touch landscape', () => {
    expect(styles).toMatch(
      /\.editor-shell\[data-editor-device-mode='cloud-touch'\]\[data-editor-shell-layout='landscape'\][\s\S]*?\.bottom-workspace\[data-resizable='true'\]\[data-timeline-expanded='false'\]\s*\{[\s\S]*?height:\s*50px;[\s\S]*?min-height:\s*50px;[\s\S]*?max-height:\s*50px;[\s\S]*?overflow:\s*hidden;/u,
    );
  });

  it('lets the released height flow into the Canvas row instead of the bottom owner', () => {
    // `.editor-layout` middle row is the only flexible row: when the auto-sized
    // bottom row shrinks, that row (which hosts `.editor-body` / Canvas) grows.
    expect(styles).toMatch(
      /\.editor-layout\s*\{[\s\S]*?grid-template-rows:\s*auto minmax\(0, 1fr\) auto;/u,
    );
    expect(styles).toMatch(/\.editor-body\s*\{[\s\S]*?min-height:\s*0;/u);
    // No fake release: the collapsed state must not simply pad/margin the dock.
    expect(styles).not.toMatch(
      /\.timeline-dock\[data-expanded='false'\]\s*\{[^}]*(?:margin|padding)/u,
    );
  });

  it('drives the collapsed layout from the one existing expand state owner', () => {
    expect(bottom).toContain("data-timeline-expanded={expanded ? 'true' : 'false'}");
    expect(bottom).toContain('useTimelineUi');
    // Exactly one collapse state owner: the bottom owner only reads it.
    expect(bottom).not.toMatch(/useState|setExpanded|createContext/u);
    expect(timelineUi).toContain('setExpanded');
    expect(timelineDock).toContain('timelineUiStore.setExpanded(!ui.expanded)');
  });

  it('keeps the open/close operation UI-only for project, dirty, revision and History', () => {
    // Asserts the absence of real writes/reads (identifiers and property
    // access), not the absence of the words in explanatory comments.
    for (const source of [bottom, timelineUi]) {
      expect(source).not.toContain('editorProjectStore');
      expect(source).not.toContain('updateProject');
      expect(source).not.toContain('historyStore');
      expect(source).not.toMatch(/\.dirty\b/u);
      expect(source).not.toMatch(/\.revision\b/u);
      expect(source).not.toMatch(/\bmarkDirty\b|\bcommit\(|\bpushHistory\b/u);
    }
  });

  it('keeps the collapsed reopen entry, timecode and History reachable', () => {
    // React removes only the ruler body when collapsed; the header (reopen
    // button + timecode) and the sibling History surface always stay mounted.
    expect(timelineDock).toMatch(/\{ui\.expanded \?[\s\S]*?\) : null\}/u);
    expect(timelineDock).toContain('data-testid="timeline-collapse"');
    expect(timelineDock).toContain('data-testid="timeline-timecode"');
    expect(timelineDock).toContain("{ui.expanded ? '收起时间轴' : '展开时间轴'}");
    expect(bottom).toContain('<HistoryControls');
    expect(styles).not.toMatch(
      /\.bottom-workspace\[data-timeline-expanded='false'\]\s*\{[^}]*display:\s*none/u,
    );
  });

  it('attaches a real Electron dual-state receipt for the new height contract', () => {
    expect(gate).toContain('[data-testid="timeline-collapse"]');
    expect(gate).toContain('data-timeline-expanded');
    expect(gate).toContain('assertCollapsedReleasesSpace');
    // The gate must compare live measurements, not re-assert the CSS numbers.
    expect(gate).toContain('collapsed.bottom.height < expanded.bottom.height');
    expect(gate).toContain('collapsed.editorBody.height > expanded.editorBody.height');
    expect(gate).toContain('collapsed.reopenVisible?.fullyVisible');
    expect(gate).toContain('collapsed.timecodeVisible?.fullyVisible');
    expect(gate).toContain('window.webContents.sendInputEvent');
    expect(gate).toContain('app.exit(exitCode)');
  });
});
