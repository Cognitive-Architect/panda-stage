import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

describe('Issue #433 R3 post-corrective pending-card layout', () => {
  it('keeps UNTIMED_SELECTED as a full-list state with an intrinsic selected action strip', () => {
    const sheet = source('src/renderer/features/dialogue/DialogueSheet.tsx');
    const list = sheet.slice(
      sheet.indexOf('<ul'),
      sheet.indexOf('</ul>') + '</ul>'.length,
    );

    expect(sheet).toContain(
      "const showInlineActions = timelineState === 'timeline-untimed-selected'",
    );
    expect(sheet).toContain(
      'unifiedTaskTray && !rightWorkspace && selectedUntimedDialogue',
    );
    expect(list).toContain('displayedUntimedDialogues.map');
    expect(list).toContain('data-testid="dialogue-untimed-select"');
    expect(list).toContain('className="dialogue-untimed-text"');
    expect(list).toContain('className="dialogue-untimed-affordance"');
    expect(list).toContain('selected && showInlineActions');
    expect(list).toContain('data-testid="dialogue-untimed-action-strip"');
  });

  it('uses flex-only sizing on actual flex items and leaves the list as the vertical scroll owner', () => {
    const styles = source('src/renderer/styles.css');
    const start = styles.indexOf('/* Issue #433 R3-B post-corrective:');
    const end = styles.indexOf('/* AUTHORING:', start);
    const repair = styles.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    const listRule = repair.match(
      /\.timeline-subtitle-queue\s+>\s+\.dialogue-untimed-queue\s*\{[^}]*\}/u,
    );
    const itemRule = repair.match(
      /\.dialogue-untimed-queue\s+>\s+\.dialogue-untimed-item\s*\{[^}]*\}/u,
    );

    expect(listRule?.[0]).toContain('display: flex;');
    expect(listRule?.[0]).toContain('flex-direction: column;');
    expect(listRule?.[0]).toContain('overflow-y: auto;');
    expect(listRule?.[0]).toContain('min-height: 0;');
    expect(itemRule?.[0]).toContain('flex: 0 0 auto;');
    expect(itemRule?.[0]).toContain('min-height: 76px;');
    expect(itemRule?.[0]).toContain('overflow: visible;');
    expect(repair).not.toContain('flex-shrink: 0;');
  });
});
